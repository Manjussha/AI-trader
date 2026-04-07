"""
Async HTTP client for the Node.js trading bridge (port 3001).
All trading operations go through here.
"""
import httpx
import asyncio

BRIDGE_URL = "http://localhost:3001"
TIMEOUT = 15.0
MAX_RETRIES = 2

_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(base_url=BRIDGE_URL, timeout=TIMEOUT)
    return _client


async def close():
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None


async def _get(path: str, retries: int = MAX_RETRIES) -> dict:
    for attempt in range(retries + 1):
        try:
            r = await get_client().get(path)
            return r.json()
        except (httpx.ConnectError, httpx.ReadTimeout) as e:
            if attempt == retries:
                return {"success": False, "error": f"Bridge unreachable: {e}"}
            await asyncio.sleep(0.5)


async def _post(path: str, data: dict, retries: int = MAX_RETRIES) -> dict:
    for attempt in range(retries + 1):
        try:
            r = await get_client().post(path, json=data)
            return r.json()
        except (httpx.ConnectError, httpx.ReadTimeout) as e:
            if attempt == retries:
                return {"success": False, "error": f"Bridge unreachable: {e}"}
            await asyncio.sleep(0.5)


# ── Health ────────────────────────────────────────────────────────────────────
async def health() -> dict:
    return await _get("/api/health")


# ── Market Data ───────────────────────────────────────────────────────────────
async def get_nifty() -> dict:
    return await _get("/api/nifty")


async def get_banknifty() -> dict:
    return await _get("/api/banknifty")


async def get_quote(symbol: str) -> dict:
    return await _get(f"/api/quote/{symbol}")


async def get_historical(symbol: str, days: int = 90, interval: str = "1d") -> dict:
    return await _get(f"/api/historical/{symbol}?days={days}&interval={interval}")


async def get_gainers() -> dict:
    return await _get("/api/gainers")


async def get_losers() -> dict:
    return await _get("/api/losers")


async def get_market_status() -> dict:
    return await _get("/api/market-status")


# ── Technical Analysis ────────────────────────────────────────────────────────
async def get_analytics(symbol: str, days: int = 90) -> dict:
    return await _get(f"/api/analytics/{symbol}?days={days}")


async def get_patterns(symbol: str) -> dict:
    return await _get(f"/api/patterns/{symbol}")


async def get_history_analysis(symbol: str) -> dict:
    return await _get(f"/api/history/{symbol}")


# ── Greeks & F&O ─────────────────────────────────────────────────────────────
async def calc_greeks(spot, strike, T, iv, type_="CE", r=0.065) -> dict:
    return await _post("/api/greeks", {"spot": spot, "strike": strike, "T": T, "iv": iv, "type": type_, "r": r})


async def analyze_fo(params: dict) -> dict:
    return await _post("/api/fo/analyze", params)


async def suggest_strategy(params: dict) -> dict:
    return await _post("/api/fo/suggest", params)


# ── Paper Trading ─────────────────────────────────────────────────────────────
async def get_portfolio() -> dict:
    return await _get("/api/paper/portfolio")


async def get_orders(limit: int = 20) -> dict:
    return await _get(f"/api/paper/orders?limit={limit}")


async def paper_buy(params: dict) -> dict:
    return await _post("/api/paper/buy", params)


async def paper_sell(params: dict) -> dict:
    return await _post("/api/paper/sell", params)


async def paper_buy_option(params: dict) -> dict:
    return await _post("/api/paper/buy-option", params)


async def paper_sell_option(params: dict) -> dict:
    return await _post("/api/paper/sell-option", params)


async def reset_portfolio(capital: int = 100000) -> dict:
    return await _post("/api/paper/reset", {"capital": capital})


# ── Journal ───────────────────────────────────────────────────────────────────
async def get_journal_stats() -> dict:
    return await _get("/api/journal/stats")


async def get_open_trades() -> dict:
    return await _get("/api/journal/open")


# ── Position Sizing ──────────────────────────────────────────────────────────
async def calc_position_size(params: dict) -> dict:
    return await _post("/api/position-size", params)
