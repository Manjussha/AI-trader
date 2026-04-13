"""
Market event watcher — runs as a background asyncio task.
Polls /api/ticks every 2s, tracks state, emits events via broadcast callback.

Events broadcast as: {type:'market_event', level, symbol, text, ts}
levels: 'info' | 'warn' | 'alert'
"""
import asyncio
import time
from dashboard import bridge

POLL_INTERVAL = 2.0           # seconds between NSE polls
ROLLING_WINDOW = 120.0        # seconds for cumulative move alerts
MOVE_THRESHOLD_PCT = 0.20     # % cumulative move to trigger alert
VIX_SPIKE_THRESHOLD = 5.0     # % change on VIX to trigger
COOLDOWN_SEC = 60             # min seconds between repeat alerts of same kind

_task: asyncio.Task | None = None
_stop = False


class SymbolState:
    __slots__ = ('last', 'day_high', 'day_low', 'window_start', 'window_price',
                 'last_alert_ts', 'last_alert_key')

    def __init__(self):
        self.last = None
        self.day_high = None
        self.day_low = None
        self.window_start = 0.0
        self.window_price = None
        self.last_alert_ts = {}  # key -> ts
        self.last_alert_key = None

    def can_alert(self, key: str) -> bool:
        now = time.time()
        ts = self.last_alert_ts.get(key, 0)
        if now - ts < COOLDOWN_SEC:
            return False
        self.last_alert_ts[key] = now
        return True


async def _watcher_loop(broadcast):
    state: dict[str, SymbolState] = {
        'NIFTY': SymbolState(),
        'BANKNIFTY': SymbolState(),
        'FINNIFTY': SymbolState(),
        'VIX': SymbolState(),
    }
    vix_alerted = False

    print('[watcher] market event watcher started')

    while not _stop:
        try:
            resp = await bridge.get_ticks()
            ticks = resp.get('ticks') or {}
            now = time.time()

            for sym, s in state.items():
                t = ticks.get(sym)
                if not t or t.get('last') is None:
                    continue
                last = float(t['last'])
                pct = float(t.get('pct') or 0.0)
                high = float(t.get('high') or last)
                low = float(t.get('low') or last)
                prev_close = float(t.get('prev') or last)

                # ── Initialize window on first tick ─────────────────────
                if s.last is None:
                    s.last = last
                    s.day_high = high
                    s.day_low = low
                    s.window_start = now
                    s.window_price = last
                    continue

                # ── VIX spike (one-shot per session) ────────────────────
                if sym == 'VIX' and not vix_alerted and abs(pct) >= VIX_SPIKE_THRESHOLD:
                    vix_alerted = True
                    await broadcast({
                        'type': 'market_event',
                        'level': 'warn' if pct > 0 else 'info',
                        'symbol': 'VIX',
                        'text': f"INDIA VIX {('+' if pct>=0 else '')}{pct:.2f}% → {last:.2f}. " +
                                ("Volatility rising — prefer defined-risk spreads." if pct > 0
                                 else "Volatility cooling — directional plays safer."),
                        'ts': now * 1000,
                    })

                # ── New day high / day low (spot indices only) ──────────
                if sym != 'VIX':
                    if s.day_high is not None and last > s.day_high + 0.01 and s.can_alert('new_high'):
                        await broadcast({
                            'type': 'market_event',
                            'level': 'info',
                            'symbol': sym,
                            'text': f"{sym} broke day high → {last:.2f} (prev HoD {s.day_high:.2f})",
                            'ts': now * 1000,
                        })
                    if s.day_low is not None and last < s.day_low - 0.01 and s.can_alert('new_low'):
                        await broadcast({
                            'type': 'market_event',
                            'level': 'warn',
                            'symbol': sym,
                            'text': f"{sym} broke day low → {last:.2f} (prev LoD {s.day_low:.2f})",
                            'ts': now * 1000,
                        })

                s.day_high = max(s.day_high or last, last, high)
                s.day_low  = min(s.day_low  or last, last, low)

                # ── Rolling window cumulative move ──────────────────────
                if sym != 'VIX':
                    elapsed = now - s.window_start
                    if elapsed >= ROLLING_WINDOW:
                        if s.window_price:
                            move_pct = ((last - s.window_price) / s.window_price) * 100.0
                            if abs(move_pct) >= MOVE_THRESHOLD_PCT:
                                key = 'move_up' if move_pct > 0 else 'move_down'
                                if s.can_alert(key):
                                    direction = 'surged' if move_pct > 0 else 'dropped'
                                    level = 'info' if move_pct > 0 else 'warn'
                                    await broadcast({
                                        'type': 'market_event',
                                        'level': level,
                                        'symbol': sym,
                                        'text': f"{sym} {direction} {('+' if move_pct>=0 else '')}{move_pct:.2f}% in {int(elapsed)}s → {last:.2f}",
                                        'ts': now * 1000,
                                    })
                        s.window_start = now
                        s.window_price = last

                s.last = last

            # ── Paper portfolio P&L threshold alerts ────────────────────
            try:
                pr = await bridge.get_portfolio()
                pdata = pr.get('data') or {}
                for h in pdata.get('holdings') or []:
                    if h.get('type') != 'OPTION':
                        continue
                    pnl_pct_str = str(h.get('pnlPct', '0%')).replace('%', '')
                    try:
                        pnl_pct = float(pnl_pct_str)
                    except ValueError:
                        continue
                    key = f"{h.get('symbol')}_{h.get('strike')}_{h.get('optType')}"
                    ss_key = f"PAPER_{key}"
                    if ss_key not in state:
                        state[ss_key] = SymbolState()
                    ps = state[ss_key]
                    if pnl_pct >= 15 and ps.can_alert('profit15'):
                        await broadcast({
                            'type': 'market_event',
                            'level': 'info',
                            'symbol': key,
                            'text': f"💰 {key}: +{pnl_pct:.1f}% — consider scaling out half at +20%",
                            'ts': time.time() * 1000,
                        })
                    elif pnl_pct <= -10 and ps.can_alert('loss10'):
                        await broadcast({
                            'type': 'market_event',
                            'level': 'alert',
                            'symbol': key,
                            'text': f"🛑 {key}: {pnl_pct:.1f}% — approaching stop (-15%). Review exit.",
                            'ts': time.time() * 1000,
                        })
            except Exception as e:
                pass  # portfolio check is best-effort

        except Exception as e:
            print(f'[watcher] error: {e}')

        await asyncio.sleep(POLL_INTERVAL)

    print('[watcher] stopped')


def start(broadcast):
    global _task, _stop
    _stop = False
    if _task and not _task.done():
        return
    _task = asyncio.create_task(_watcher_loop(broadcast))


async def stop():
    global _stop, _task
    _stop = True
    if _task:
        try:
            await asyncio.wait_for(_task, timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            pass
    _task = None
