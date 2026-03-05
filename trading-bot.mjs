#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 *  AUTONOMOUS TRADING BOT — Terminal Dashboard
 *  Runs continuously. No human intervention needed.
 *
 *  Usage:
 *    node trading-bot.mjs                       # watch mode (default)
 *    node trading-bot.mjs --mode paper          # auto paper trade signals
 *    node trading-bot.mjs --mode live           # real trades (careful!)
 *    node trading-bot.mjs --watchlist RELIANCE,TCS,INFY,HDFCBANK
 *    node trading-bot.mjs --interval 5          # scan every 5 min
 *    node trading-bot.mjs --capital 100000      # paper capital
 *    node trading-bot.mjs --risk 1              # 1% risk per trade
 *    node trading-bot.mjs --index "NIFTY BANK"  # index to screen
 *
 *  Works with any broker: set BROKER=groww/angelone/zerodha/upstox in .env
 * ─────────────────────────────────────────────────────────────
 */

import dotenv from 'dotenv';
import { writeFileSync, appendFileSync, existsSync } from 'fs';
import { join, dirname }    from 'path';
import { fileURLToPath }    from 'url';
import fetch                from 'node-fetch';

import { GrowwClient }      from './src/groww-client.js';
import {
  rsi, sma, ema, macd, bollingerBands, atr, vwap,
  stochastic, superTrend, supportResistance,
  volatility, generateSignal, calcPositionSize,
} from './src/analytics.js';
import { scanPatterns }     from './src/patterns.js';
import { paperBuy, paperSell, getPortfolio, resetPortfolio } from './src/paper-trade.js';
import { addTrade }         from './src/trade-journal.js';

dotenv.config();

const __dir  = dirname(fileURLToPath(import.meta.url));
const LOG    = join(__dir, 'bot.log');

// ── ANSI Colors ──────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
  bgGreen:  '\x1b[42m',
  bgRed:    '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlue:   '\x1b[44m',
};

// ── CLI Args ─────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };
  return {
    mode:      get('--mode',      'watch'),           // watch | paper | live
    watchlist: get('--watchlist', 'RELIANCE,TCS,INFY,HDFCBANK,SBIN,ICICIBANK').split(',').map(s => s.trim().toUpperCase()),
    interval:  parseInt(get('--interval', '5'), 10),  // minutes
    capital:   parseFloat(get('--capital',  '100000')),
    risk:      parseFloat(get('--risk',     '1')),     // % per trade
    index:     get('--index', 'NIFTY 50'),
    minScore:  parseInt(get('--min-score',  '6'), 10), // min confluence to alert
  };
}

const ARGS = parseArgs();

// ── Market Data (broker-independent public APIs) ─────────────
const market = new GrowwClient({
  apiKey:     process.env.GROWW_API_KEY     || '',
  totpSecret: process.env.TOTP_SECRET       || '',
});

// ── Logging ──────────────────────────────────────────────────
function log(msg, level = 'INFO') {
  const ts   = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const line = `[${ts}] [${level}] ${msg}`;
  appendFileSync(LOG, line + '\n');
  return line;
}

function print(msg)  { process.stdout.write(msg + '\n'); }
function clear()     { process.stdout.write('\x1Bc'); }

// ── Time helpers ─────────────────────────────────────────────
function istNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function isMarketHours() {
  const t = istNow();
  const d = t.getDay(); // 0=Sun, 6=Sat
  if (d === 0 || d === 6) return false;
  const h = t.getHours(), m = t.getMinutes();
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

function isPreMarket() {
  const t = istNow();
  const d = t.getDay();
  if (d === 0 || d === 6) return false;
  const mins = t.getHours() * 60 + t.getMinutes();
  return mins >= 8 * 60 + 45 && mins < 9 * 60 + 15;
}

function timeToNextMarket() {
  const t    = istNow();
  const mins = t.getHours() * 60 + t.getMinutes();
  const open = 9 * 60 + 15;
  if (mins < open) return `${Math.floor((open - mins) / 60)}h ${(open - mins) % 60}m`;
  return 'Tomorrow 9:15 AM IST';
}

// ── NSE News ─────────────────────────────────────────────────
async function fetchNews() {
  try {
    const res  = await fetch('https://finance.yahoo.com/rss/headline?s=%5ENSEI,%5EBSESN', {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000),
    });
    const xml  = await res.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, 5)
      .map(m => {
        const t = (m[1].match(/<title><!\[CDATA\[(.*?)\]\]>/) || m[1].match(/<title>(.*?)<\/title>/) || [])[1] || '';
        return t.trim();
      }).filter(Boolean);
  } catch { return []; }
}

// ── Analyse one stock ─────────────────────────────────────────
async function analyseStock(symbol) {
  try {
    const [histRes, liveRes] = await Promise.allSettled([
      market.getHistoricalDataYahoo(symbol, 'NSE', 60, '1d'),
      market.getLivePriceNSE(symbol),
    ]);

    if (histRes.status !== 'fulfilled') return null;
    const candles = histRes.value.candles;
    const live    = liveRes.status === 'fulfilled' ? liveRes.value : null;

    const closes  = candles.map(c => parseFloat(c.close)).filter(Boolean);
    const highs   = candles.map(c => parseFloat(c.high)).filter(Boolean);
    const lows    = candles.map(c => parseFloat(c.low)).filter(Boolean);
    const vols    = candles.map(c => c.volume || 0);

    if (closes.length < 20) return null;

    const price   = live?.priceInfo?.lastPrice || live?.lastPrice || closes[closes.length - 1];
    const rsiVal  = rsi(closes);
    const sig     = closes.length >= 26 ? generateSignal(closes, vols) : null;
    const bb      = bollingerBands(closes);
    const sma20v  = sma(closes, 20);
    const atrVal  = atr(candles, 14);
    const sr      = supportResistance(highs, lows);
    const st      = superTrend(candles);
    const stoch   = stochastic(closes, highs, lows);
    const vwapVal = vwap(candles.slice(-20));
    const patts   = scanPatterns(candles).filter(p => !p.barsAgo);

    // Confluence score
    let score = 0;
    if (sig?.signal === 'BUY')           score += 2;
    if (rsiVal < 35)                     score += 2;
    else if (rsiVal < 45)                score += 1;
    if (stoch?.oversold)                 score += 1;
    if (st?.trend === 'BULLISH')         score += 1;
    if (price > vwapVal)                 score += 1;
    if (bb && price < bb.lower)          score += 1;
    if (sr && Math.abs(price - sr.support) / sr.support < 0.015) score += 1;
    if (patts.some(p => p.sentiment === 'BULLISH' && p.strength === 'STRONG')) score += 1;

    return {
      symbol, price, score,
      rsi:        rsiVal?.toFixed(1),
      signal:     sig?.signal,
      confidence: sig?.confidence,
      atr:        atrVal?.toFixed(2),
      support:    sr?.support?.toFixed(2),
      resistance: sr?.resistance?.toFixed(2),
      vwap:       vwapVal?.toFixed(2),
      aboveVWAP:  price > vwapVal,
      stoch,
      supertrend: st?.trend,
      patterns:   patts.map(p => p.pattern),
      bb_pos:     bb ? (price < bb.lower ? 'BELOW_BB' : price > bb.upper ? 'ABOVE_BB' : 'INSIDE_BB') : null,
      bias:       score >= 6 ? 'STRONG_BUY' : score >= 4 ? 'BUY' : score <= 2 ? 'SELL' : 'NEUTRAL',
      sl_atr:     atrVal ? (price - 2 * atrVal).toFixed(2) : null,
      t1:         atrVal ? (price + 1.5 * atrVal).toFixed(2) : null,
      t2:         atrVal ? (price + 3 * atrVal).toFixed(2) : null,
    };
  } catch { return null; }
}

// ── Dashboard render ──────────────────────────────────────────
function renderHeader(snap) {
  const now  = istNow().toLocaleTimeString('en-IN');
  const mkts = isMarketHours() ? `${C.green}${C.bold} MARKET OPEN ` : `${C.red}${C.bold} MARKET CLOSED `;
  const nifty = snap.nifty;
  const bn    = snap.bn;

  print(`${C.bold}${C.cyan}${'═'.repeat(72)}${C.reset}`);
  print(`${C.bold}${C.cyan}  AUTONOMOUS TRADING BOT${C.reset}  ${C.dim}mode: ${ARGS.mode.toUpperCase()} | interval: ${ARGS.interval}m | ${now} IST${C.reset}`);
  print(`${C.bold}${C.cyan}${'═'.repeat(72)}${C.reset}`);

  if (nifty) {
    const nc = parseFloat(nifty.pChange) >= 0 ? C.green : C.red;
    const bc = parseFloat(bn?.pChange || 0) >= 0 ? C.green : C.red;
    print(`  ${C.bold}NIFTY${C.reset}  ${nc}${nifty.level}  ${nifty.pChange >= 0 ? '+' : ''}${nifty.pChange}%${C.reset}  ${C.dim}H:${nifty.high} L:${nifty.low}${C.reset}   ${C.bold}BANKNIFTY${C.reset}  ${bc}${bn?.level}  ${bn?.pChange >= 0 ? '+' : ''}${bn?.pChange}%${C.reset}`);
  }
  print(`  Market: ${mkts}${C.reset}  ${C.dim}scan #${snap.scanCount} | alerts: ${snap.alertCount}${C.reset}`);
  print(`${C.dim}${'─'.repeat(72)}${C.reset}`);
}

function renderStock(s) {
  if (!s) return;
  const biasColor = s.bias === 'STRONG_BUY' ? C.green + C.bold
    : s.bias === 'BUY' ? C.green
    : s.bias === 'SELL' ? C.red
    : C.yellow;

  const scoreBar = '█'.repeat(s.score) + '░'.repeat(Math.max(0, 10 - s.score));
  const vwapInd  = s.aboveVWAP ? `${C.green}▲VWAP${C.reset}` : `${C.red}▼VWAP${C.reset}`;
  const stInd    = s.supertrend === 'BULLISH' ? `${C.green}ST↑${C.reset}` : `${C.red}ST↓${C.reset}`;
  const pattStr  = s.patterns.length ? `${C.magenta}${s.patterns.slice(0,2).join(', ')}${C.reset}` : '';

  print(
    `  ${C.bold}${s.symbol.padEnd(12)}${C.reset}` +
    `${C.cyan}₹${String(s.price).padStart(8)}${C.reset}  ` +
    `RSI:${s.rsi?.padStart(5)}  ` +
    `${biasColor}${s.bias.padEnd(10)}${C.reset}  ` +
    `[${C.cyan}${scoreBar}${C.reset}] ${s.score}/10  ` +
    `${vwapInd} ${stInd}  ${pattStr}`
  );

  if (s.score >= ARGS.minScore) {
    print(
      `  ${C.dim}    SL:₹${s.sl_atr} | T1:₹${s.t1} | T2:₹${s.t2} | ATR:${s.atr} | Sup:₹${s.support} | Res:₹${s.resistance}${C.reset}`
    );
  }
}

function renderAlerts(alerts) {
  if (alerts.length === 0) return;
  print(`\n${C.bold}${C.yellow}  ALERTS (score >= ${ARGS.minScore})${C.reset}`);
  print(`${C.yellow}${'─'.repeat(72)}${C.reset}`);
  for (const a of alerts) {
    const icon = a.bias === 'STRONG_BUY' ? '★' : '▲';
    print(`  ${C.green}${icon} ${C.bold}${a.symbol}${C.reset}  Score:${a.score}/10  ₹${a.price}  RSI:${a.rsi}  ${a.patterns.join(', ')}`);
    print(`    ${C.dim}Entry:₹${a.price} | SL:₹${a.sl_atr} | T1:₹${a.t1} | T2:₹${a.t2}${C.reset}`);
    log(`ALERT: ${a.symbol} score=${a.score} price=${a.price} rsi=${a.rsi} bias=${a.bias}`, 'ALERT');
  }
}

function renderPortfolio() {
  try {
    const p = getPortfolio();
    const pnlColor = parseFloat(p.totalPnl) >= 0 ? C.green : C.red;
    print(`\n${C.bold}  PAPER PORTFOLIO${C.reset}  Cash:${C.cyan}₹${p.cash}${C.reset}  Value:${C.cyan}₹${p.portfolioValue}${C.reset}  P&L:${pnlColor}₹${p.totalPnl}${C.reset}  WinRate:${p.winRate}  Trades:${p.totalTrades}`);
    if (p.holdings.length > 0) {
      for (const h of p.holdings) {
        const pc = parseFloat(h.unrealizedPnl) >= 0 ? C.green : C.red;
        print(`    ${h.symbol.padEnd(12)} qty:${h.qty}  avg:₹${h.avgPrice}  ltp:₹${h.ltp}  ${pc}P&L:₹${h.unrealizedPnl} (${h.pnlPct})${C.reset}`);
      }
    }
  } catch {}
}

function renderNews(news) {
  if (!news?.length) return;
  print(`\n${C.bold}${C.dim}  NEWS${C.reset}`);
  for (const n of news.slice(0, 3)) print(`  ${C.dim}• ${n}${C.reset}`);
}

// ── Auto Paper Trade ─────────────────────────────────────────
async function autoPaperTrade(alerts) {
  if (ARGS.mode !== 'paper') return;
  for (const s of alerts.filter(a => a.score >= 7 && a.bias === 'STRONG_BUY')) {
    const port  = getPortfolio();
    if (port.holdings[s.symbol]) continue; // already holding

    const sl      = parseFloat(s.sl_atr);
    const sizing  = calcPositionSize({ capital: parseFloat(port.cash), riskPct: ARGS.risk, entryPrice: s.price, stopLossPrice: sl });
    if (!sizing || sizing.qty < 1) continue;

    const result  = paperBuy({ symbol: s.symbol, qty: sizing.qty, price: s.price, note: `Bot: score=${s.score} rsi=${s.rsi} ${s.patterns.join(',')}` });
    if (result.success) {
      addTrade({ symbol: s.symbol, type: 'BUY', segment: 'EQUITY', entry: s.price, target: parseFloat(s.t2), stopLoss: sl, qty: sizing.qty, setup: `Auto: score=${s.score}`, entryReason: `RSI:${s.rsi} Patterns:${s.patterns.join(',')}` });
      print(`\n  ${C.bgGreen}${C.bold} PAPER BUY ${C.reset}  ${s.symbol} × ${sizing.qty}  @₹${s.price}  SL:₹${sl}  T2:₹${s.t2}`);
      log(`PAPER BUY: ${s.symbol} qty=${sizing.qty} entry=${s.price} sl=${sl}`, 'TRADE');
    }
  }
}

// ── Market indices ────────────────────────────────────────────
async function fetchIndices() {
  const [nRaw, bnRaw] = await Promise.allSettled([
    market._nseRequest('/equity-stockIndices?index=NIFTY%2050'),
    market._nseRequest('/equity-stockIndices?index=NIFTY%20BANK'),
  ]);
  const n  = nRaw.status  === 'fulfilled' ? nRaw.value?.data?.[0]  : null;
  const bn = bnRaw.status === 'fulfilled' ? bnRaw.value?.data?.[0] : null;
  return {
    nifty: n  ? { level: n.lastPrice,  pChange: n.pChange?.toFixed(2),  high: n.dayHigh,  low: n.dayLow  } : null,
    bn:    bn ? { level: bn.lastPrice, pChange: bn.pChange?.toFixed(2), high: bn.dayHigh, low: bn.dayLow } : null,
  };
}

// ── Main scan loop ────────────────────────────────────────────
let scanCount = 0, alertCount = 0;
let lastNews   = [];
let lastIndices = { nifty: null, bn: null };

async function scan() {
  scanCount++;

  // Fetch indices + news in background
  const [indicesRes, newsRes] = await Promise.allSettled([fetchIndices(), fetchNews()]);
  if (indicesRes.status === 'fulfilled') lastIndices = indicesRes.value;
  if (newsRes.status   === 'fulfilled') lastNews     = newsRes.value;

  const snap = { ...lastIndices, scanCount, alertCount };

  // Analyse all watchlist stocks in parallel
  const analyses = (await Promise.allSettled(ARGS.watchlist.map(s => analyseStock(s))))
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const alerts = analyses.filter(s => s.score >= ARGS.minScore);
  alertCount   = alerts.length;
  snap.alertCount = alertCount;

  // Render dashboard
  clear();
  renderHeader(snap);
  print(`\n${C.bold}  WATCHLIST SCAN${C.reset}  ${C.dim}(sorted by confluence score)${C.reset}`);
  print(`${C.dim}${'─'.repeat(72)}${C.reset}`);
  for (const s of analyses) renderStock(s);

  renderAlerts(alerts);
  if (ARGS.mode === 'paper') renderPortfolio();
  renderNews(lastNews);

  print(`\n${C.dim}${'─'.repeat(72)}`);
  print(`  Next scan: ${ARGS.interval}m  |  Log: bot.log  |  Ctrl+C to stop${C.reset}`);

  // Auto paper trade on strong signals
  await autoPaperTrade(alerts);

  log(`Scan #${scanCount} — analysed:${analyses.length} alerts:${alerts.length} NIFTY:${snap.nifty?.level}`);
}

// ── Startup ───────────────────────────────────────────────────
async function startup() {
  clear();
  print(`${C.bold}${C.cyan}`);
  print(`  ████████╗██████╗  █████╗ ██████╗ ██╗███╗   ██╗ ██████╗     ██████╗  ██████╗ ████████╗`);
  print(`     ██╔══╝██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║██╔════╝     ██╔══██╗██╔═══██╗╚══██╔══╝`);
  print(`     ██║   ██████╔╝███████║██║  ██║██║██╔██╗ ██║██║  ███╗    ██████╔╝██║   ██║   ██║   `);
  print(`     ██║   ██╔══██╗██╔══██║██║  ██║██║██║╚██╗██║██║   ██║    ██╔══██╗██║   ██║   ██║   `);
  print(`     ██║   ██║  ██║██║  ██║██████╔╝██║██║ ╚████║╚██████╔╝    ██████╔╝╚██████╔╝   ██║   `);
  print(`     ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝╚═╝  ╚═══╝ ╚═════╝     ╚═════╝  ╚═════╝    ╚═╝   `);
  print(`${C.reset}`);
  print(`  ${C.bold}Mode:${C.reset} ${ARGS.mode.toUpperCase()}   ${C.bold}Watchlist:${C.reset} ${ARGS.watchlist.join(', ')}   ${C.bold}Interval:${C.reset} ${ARGS.interval}m   ${C.bold}Min Score:${C.reset} ${ARGS.minScore}/10`);
  if (ARGS.mode === 'paper') {
    print(`  ${C.bold}Capital:${C.reset} ₹${ARGS.capital.toLocaleString('en-IN')}   ${C.bold}Risk/trade:${C.reset} ${ARGS.risk}%`);
    resetPortfolio(ARGS.capital);
    print(`  ${C.green}Paper portfolio reset to ₹${ARGS.capital.toLocaleString('en-IN')}${C.reset}`);
  }
  if (ARGS.mode === 'live') {
    print(`  ${C.bgRed}${C.bold}  LIVE MODE — REAL ORDERS WILL BE PLACED  ${C.reset}`);
    print(`  ${C.yellow}You have 5 seconds to Ctrl+C to abort...${C.reset}`);
    await new Promise(r => setTimeout(r, 5000));
  }
  print(`\n  ${C.dim}Starting first scan...${C.reset}\n`);
  await new Promise(r => setTimeout(r, 1500));
}

// ── Main loop ─────────────────────────────────────────────────
async function main() {
  await startup();

  const runScan = async () => {
    try {
      if (!isMarketHours() && !isPreMarket()) {
        clear();
        const ist = istNow().toLocaleTimeString('en-IN');
        print(`${C.bold}${C.dim}  Market is closed. ${C.reset}${C.dim}Current IST: ${ist}  |  Opens in: ${timeToNextMarket()}${C.reset}`);
        print(`  ${C.dim}Bot is running. Will auto-start when market opens. Ctrl+C to stop.${C.reset}`);
        log('Market closed — waiting');
        return;
      }
      await scan();
    } catch (e) {
      print(`  ${C.red}Scan error: ${e.message}${C.reset}`);
      log(`Scan error: ${e.message}`, 'ERROR');
    }
  };

  await runScan();
  setInterval(runScan, ARGS.interval * 60 * 1000);
}

process.on('SIGINT', () => {
  print(`\n\n  ${C.yellow}Bot stopped. Total scans: ${scanCount}  Alerts: ${alertCount}${C.reset}`);
  if (ARGS.mode === 'paper') {
    const p = getPortfolio();
    print(`  ${C.bold}Final Portfolio:${C.reset}  Value:₹${p.portfolioValue}  P&L:₹${p.totalPnl}  WinRate:${p.winRate}`);
  }
  print(`  ${C.dim}Log saved to: bot.log${C.reset}\n`);
  process.exit(0);
});

main().catch(e => { console.error(e); process.exit(1); });
