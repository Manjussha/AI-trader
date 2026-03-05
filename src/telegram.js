/**
 * Telegram Bot — Two-way trading control
 * Sends alerts TO you. Takes commands FROM you.
 *
 * Setup:
 *   1. Message @BotFather on Telegram → /newbot → get token
 *   2. Message your bot → run: node -e "import('./src/telegram.js').then(m=>m.getMyId())"
 *   3. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env
 */
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BASE    = `https://api.telegram.org/bot${TOKEN}`;

// ── Core API ─────────────────────────────────────────────────
async function tg(method, body = {}) {
  if (!TOKEN) return null;
  try {
    const res = await fetch(`${BASE}/${method}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(8000),
    });
    return res.json();
  } catch { return null; }
}

export async function send(text, chatId = CHAT_ID, extra = {}) {
  if (!TOKEN || !chatId) return null;
  return tg('sendMessage', {
    chat_id:    chatId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

export async function getUpdates(offset = 0) {
  const res = await tg('getUpdates', { offset, timeout: 10, allowed_updates: ['message'] });
  return res?.result || [];
}

// Helper — run once to find your chat ID
export async function getMyId() {
  const updates = await tg('getUpdates', { timeout: 20 });
  if (!updates?.result?.length) {
    console.log('No messages yet. Send any message to your bot first, then run again.');
    return;
  }
  const msg = updates.result[updates.result.length - 1].message;
  console.log(`Your Chat ID: ${msg.chat.id}  |  Username: @${msg.chat.username || msg.from.first_name}`);
  console.log(`Add to .env:  TELEGRAM_CHAT_ID=${msg.chat.id}`);
}

// ── Alert formatters ─────────────────────────────────────────
export function alertMessage(s) {
  const icon = s.score >= 8 ? '🔥' : s.score >= 6 ? '⚡' : '📊';
  const bias = s.bias === 'STRONG_BUY' ? '🟢 STRONG BUY' : s.bias === 'BUY' ? '🟢 BUY' : s.bias === 'SELL' ? '🔴 SELL' : '🟡 NEUTRAL';
  return [
    `${icon} <b>${s.symbol}</b>  Score: ${s.score}/10`,
    `${bias}  |  RSI: ${s.rsi}`,
    ``,
    `💰 Price: ₹${s.price}`,
    `🛡 Stop Loss: ₹${s.sl_atr}`,
    `🎯 T1: ₹${s.t1}  |  T2: ₹${s.t2}`,
    `📐 ATR: ${s.atr}  |  VWAP: ${s.aboveVWAP ? '▲ Above' : '▼ Below'}`,
    s.patterns.length ? `🕯 ${s.patterns.join(', ')}` : '',
    ``,
    `<i>Reply: /paper_buy ${s.symbol} or /analyze ${s.symbol}</i>`,
  ].filter(Boolean).join('\n');
}

export function portfolioMessage(p) {
  const pnlSign = parseFloat(p.totalPnl) >= 0 ? '🟢 +' : '🔴 ';
  const lines = [
    `📊 <b>Paper Portfolio</b>`,
    ``,
    `💵 Cash: ₹${p.cash}`,
    `📈 Value: ₹${p.portfolioValue}`,
    `${pnlSign}P&amp;L: ₹${p.totalPnl} (${p.totalReturn})`,
    `🏆 Win Rate: ${p.winRate}  |  Trades: ${p.totalTrades}`,
    ``,
  ];
  if (p.holdings?.length) {
    lines.push(`<b>Holdings:</b>`);
    for (const h of p.holdings) {
      const ph = parseFloat(h.unrealizedPnl) >= 0 ? '🟢' : '🔴';
      lines.push(`${ph} ${h.symbol}  ×${h.qty}  avg:₹${h.avgPrice} → ₹${h.ltp}  (${h.pnlPct})`);
    }
  } else {
    lines.push(`No open holdings.`);
  }
  return lines.join('\n');
}

export function marketMessage(nifty, bn) {
  const nc = parseFloat(nifty?.pChange || 0) >= 0 ? '🟢' : '🔴';
  const bc = parseFloat(bn?.pChange    || 0) >= 0 ? '🟢' : '🔴';
  return [
    `📊 <b>Market Snapshot</b>`,
    ``,
    `${nc} NIFTY 50:  ₹${nifty?.level}  (${nifty?.pChange >= 0 ? '+' : ''}${nifty?.pChange}%)`,
    `  H: ${nifty?.high}  L: ${nifty?.low}`,
    ``,
    `${bc} BANKNIFTY: ₹${bn?.level}  (${bn?.pChange >= 0 ? '+' : ''}${bn?.pChange}%)`,
    `  H: ${bn?.high}  L: ${bn?.low}`,
  ].join('\n');
}

export function scanResultMessage(results) {
  if (!results.length) return '📊 No setups found matching criteria right now.';
  const lines = [`⚡ <b>Scan Results</b> (${results.length} setups)\n`];
  for (const s of results.slice(0, 5)) {
    const icon = s.score >= 7 ? '🔥' : '⚡';
    lines.push(`${icon} <b>${s.symbol}</b>  ${s.score}/10  RSI:${s.rsi}  ₹${s.price}`);
    lines.push(`   SL:₹${s.sl_atr} T1:₹${s.t1} T2:₹${s.t2}`);
    if (s.patterns.length) lines.push(`   🕯 ${s.patterns.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── Help message ─────────────────────────────────────────────
export const HELP = `🤖 <b>Trading Bot Commands</b>

<b>Market</b>
/status          — NIFTY + BANKNIFTY live
/scan            — Scan default watchlist
/scan SYM1,SYM2  — Scan specific stocks
/gainers         — Top gainers today
/losers          — Top losers today
/sectors         — Sector rotation

<b>Analysis</b>
/analyze SYMBOL     — Deep pro analysis
/history SYMBOL     — Historical similarity
/patterns SYMBOL    — Candlestick patterns
/levels SYMBOL      — Key price zones

<b>Paper Trading</b>
/portfolio            — View portfolio + P&L
/paper_buy SYM QTY   — Buy at live price
/paper_sell SYM QTY  — Sell at live price
/orders               — Recent order history

<b>Bot Control</b>
/pause   — Pause auto-scanning alerts
/resume  — Resume auto-scanning
/help    — This message

<i>Bot scans every 5 min during market hours and alerts you on score ≥ 6.</i>`;
