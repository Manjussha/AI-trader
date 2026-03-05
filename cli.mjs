#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 *  AI TRADER — Interactive Terminal
 *
 *  Type commands or natural language. Works fully in terminal.
 *  No GUI, no extension, no Claude Desktop needed.
 *
 *  Usage:
 *    node cli.mjs           # interactive mode (REPL)
 *    node cli.mjs scan      # run one command and exit
 *    node cli.mjs analyze RELIANCE
 *    node cli.mjs advisor
 * ─────────────────────────────────────────────────────────────
 */

import readline from 'readline';
import dotenv   from 'dotenv';

import { GrowwClient }    from './src/groww-client.js';
import {
  rsi, sma, bollingerBands, atr, vwap, stochastic,
  superTrend, supportResistance, generateSignal, volatility, volumeAnomaly,
} from './src/analytics.js';
import { scanPatterns }      from './src/patterns.js';
import { historicalSimilarity } from './src/history-analyzer.js';
import { getFIIDII, getPCR } from './src/market-pulse.js';
import { getOILevels }       from './src/oi-analyzer.js';
import { backtestStrategy }  from './src/backtester.js';
import { paperBuy, paperSell, getPortfolio, resetPortfolio, getOrders, trailStopLoss } from './src/paper-trade.js';
import { getStats } from './src/trade-journal.js';

dotenv.config();

// ── Colors ───────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',   bold:    '\x1b[1m',   dim:     '\x1b[2m',
  green:   '\x1b[32m',  red:     '\x1b[31m',  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',  blue:    '\x1b[34m',  magenta: '\x1b[35m',
  white:   '\x1b[37m',
};

const market = new GrowwClient({ apiKey: process.env.GROWW_API_KEY, totpSecret: process.env.TOTP_SECRET });


// ── Print helpers ─────────────────────────────────────────────
const p   = (...a) => console.log(...a);
const hr  = () => p(`${C.dim}${'─'.repeat(60)}${C.reset}`);
const hdr = t => { hr(); p(`${C.bold}${C.cyan}  ${t}${C.reset}`); hr(); };
const ok  = t => p(`${C.green}✓ ${t}${C.reset}`);
const err = t => p(`${C.red}✗ ${t}${C.reset}`);
const inf = t => p(`${C.dim}  ${t}${C.reset}`);

function formatPrice(n) {
  return `₹${parseFloat(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

function pChange(n) {
  const v = parseFloat(n);
  return v >= 0 ? `${C.green}+${v.toFixed(2)}%${C.reset}` : `${C.red}${v.toFixed(2)}%${C.reset}`;
}

// ── Command handlers ──────────────────────────────────────────

async function cmdStatus() {
  hdr('Market Status');
  try {
    const [nRaw, bnRaw, statusRaw] = await Promise.allSettled([
      market._nseRequest('/equity-stockIndices?index=NIFTY%2050'),
      market._nseRequest('/equity-stockIndices?index=NIFTY%20BANK'),
      market.getMarketStatus(),
    ]);
    const n  = nRaw.status  === 'fulfilled' ? nRaw.value?.data?.[0]  : null;
    const bn = bnRaw.status === 'fulfilled' ? bnRaw.value?.data?.[0] : null;
    const s  = statusRaw.status === 'fulfilled' ? statusRaw.value?.marketState?.[0] : null;

    if (s) p(`  Status: ${C.bold}${s.marketStatus || 'Unknown'}${C.reset}`);
    if (n)  p(`  NIFTY 50:   ${C.bold}${formatPrice(n.lastPrice)}${C.reset}  ${pChange(n.pChange)}  H:${n.dayHigh} L:${n.dayLow}`);
    if (bn) p(`  BANKNIFTY:  ${C.bold}${formatPrice(bn.lastPrice)}${C.reset}  ${pChange(bn.pChange)}  H:${bn.dayHigh} L:${bn.dayLow}`);
  } catch (e) { err(e.message); }
}

async function cmdAnalyze(symbol) {
  if (!symbol) { err('Usage: analyze SYMBOL'); return; }
  hdr(`Analyzing ${symbol.toUpperCase()}`);
  try {
    inf('Fetching data...');
    const [histRes, liveRes] = await Promise.allSettled([
      market.getHistoricalDataYahoo(symbol, 'NSE', 90, '1d'),
      market.getLivePriceNSE(symbol),
    ]);
    const candles = histRes.status === 'fulfilled' ? histRes.value.candles : [];
    const live    = liveRes.status === 'fulfilled' ? liveRes.value : null;

    const closes  = candles.map(c => parseFloat(c.close)).filter(Boolean);
    const highs   = candles.map(c => parseFloat(c.high)).filter(Boolean);
    const lows    = candles.map(c => parseFloat(c.low)).filter(Boolean);
    const vols    = candles.map(c => c.volume || 0);
    const price   = live?.priceInfo?.lastPrice || live?.lastPrice || closes[closes.length - 1] || 0;

    if (closes.length < 20) { err('Not enough data'); return; }

    const rsiVal  = rsi(closes);
    const sig     = closes.length >= 26 ? generateSignal(closes, vols) : null;
    const bb      = bollingerBands(closes);
    const sma20v  = sma(closes, 20);
    const sma50v  = closes.length >= 50 ? sma(closes, 50) : null;
    const atrVal  = atr(candles, 14);
    const sr      = supportResistance(highs, lows);
    const st      = superTrend(candles);
    const stoch   = stochastic(closes, highs, lows);
    const vwapVal = vwap(candles.slice(-20));
    const volat   = volatility(closes);
    const patts   = scanPatterns(candles).filter(p => !p.barsAgo);

    const sigColor = sig?.signal === 'BUY' ? C.green : sig?.signal === 'SELL' ? C.red : C.yellow;

    p(`\n  ${C.bold}${symbol.toUpperCase()}${C.reset}  ${C.bold}${C.cyan}${formatPrice(price)}${C.reset}`);
    p(`  Signal: ${sigColor}${C.bold}${sig?.signal || 'N/A'}${C.reset}  (${sig?.confidence || 0}% confidence)`);
    p('');
    p(`  ${C.bold}Indicators${C.reset}`);
    p(`  RSI(14):    ${rsiVal < 30 ? C.green : rsiVal > 70 ? C.red : C.yellow}${rsiVal?.toFixed(1)}${C.reset}  ${rsiVal < 30 ? '← Oversold' : rsiVal > 70 ? '← Overbought' : ''}`);
    p(`  SMA20:      ${formatPrice(sma20v)}  ${price > sma20v ? C.green + 'Price ABOVE' : C.red + 'Price BELOW'}${C.reset}`);
    if (sma50v) p(`  SMA50:      ${formatPrice(sma50v)}  ${price > sma50v ? C.green + 'Price ABOVE' : C.red + 'Price BELOW'}${C.reset}`);
    p(`  ATR(14):    ₹${atrVal?.toFixed(2)}`);
    p(`  VWAP:       ${formatPrice(vwapVal)}  ${price > vwapVal ? C.green + '▲ Above' : C.red + '▼ Below'}${C.reset}`);
    p(`  Stochastic: %K ${stoch?.K}  %D ${stoch?.D}  ${stoch?.oversold ? C.green + '← Oversold' : stoch?.overbought ? C.red + '← Overbought' : ''}${C.reset}`);
    p(`  SuperTrend: ${st?.trend === 'BULLISH' ? C.green : C.red}${st?.trend}${C.reset}`);
    p(`  Volatility: ${volat?.toFixed(1)}% annual`);

    if (bb) {
      p('');
      p(`  ${C.bold}Bollinger Bands${C.reset}`);
      p(`  Upper: ${formatPrice(bb.upper)}  Middle: ${formatPrice(bb.middle)}  Lower: ${formatPrice(bb.lower)}`);
      const bbPct = ((price - bb.lower) / (bb.upper - bb.lower) * 100).toFixed(0);
      p(`  Position: ${bbPct}% of range (0=lower band, 100=upper band)`);
    }

    p('');
    p(`  ${C.bold}Key Levels${C.reset}`);
    p(`  Support:    ${C.green}${formatPrice(sr?.support)}${C.reset}`);
    p(`  Resistance: ${C.red}${formatPrice(sr?.resistance)}${C.reset}`);

    if (atrVal) {
      p('');
      p(`  ${C.bold}ATR Trade Plan${C.reset}`);
      p(`  Entry:  ${formatPrice(price)}`);
      p(`  SL:     ${C.red}${formatPrice(price - 2 * atrVal)} (2×ATR below)${C.reset}`);
      p(`  T1:     ${C.green}${formatPrice(price + 1.5 * atrVal)} (1.5R)${C.reset}`);
      p(`  T2:     ${C.green}${formatPrice(price + 3 * atrVal)} (3R)${C.reset}`);
    }

    if (patts.length) {
      p('');
      p(`  ${C.bold}Patterns${C.reset}`);
      for (const pt of patts) {
        const pc = pt.sentiment === 'BULLISH' ? C.green : pt.sentiment === 'BEARISH' ? C.red : C.yellow;
        p(`  ${pc}${pt.pattern}${C.reset}  (${pt.strength})`);
      }
    }

    sig?.reasons?.length && (p(''), p(`  ${C.bold}Signal Reasons${C.reset}`), sig.reasons.forEach(r => inf(r)));
  } catch (e) { err(e.message); }
}

async function cmdScan(watchlistStr) {
  const watchlist = watchlistStr
    ? watchlistStr.split(',').map(s => s.trim().toUpperCase())
    : ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'SBIN', 'ICICIBANK', 'AXISBANK', 'WIPRO'];

  hdr(`Scanning ${watchlist.length} stocks`);
  inf('Fetching data... (may take 30s)');

  const results = [];
  for (const sym of watchlist) {
    try {
      const [histRes, liveRes] = await Promise.allSettled([
        market.getHistoricalDataYahoo(sym, 'NSE', 60, '1d'),
        market.getLivePriceNSE(sym),
      ]);
      const candles = histRes.status === 'fulfilled' ? histRes.value.candles : [];
      const live    = liveRes.status === 'fulfilled' ? liveRes.value : null;
      const closes  = candles.map(c => parseFloat(c.close)).filter(Boolean);
      const highs   = candles.map(c => parseFloat(c.high)).filter(Boolean);
      const lows    = candles.map(c => parseFloat(c.low)).filter(Boolean);
      const vols    = candles.map(c => c.volume || 0);
      if (closes.length < 20) continue;

      const price   = live?.priceInfo?.lastPrice || live?.lastPrice || closes[closes.length - 1];
      const rsiVal  = rsi(closes);
      const sig     = closes.length >= 26 ? generateSignal(closes, vols) : null;
      const atrVal  = atr(candles, 14);
      const sr      = supportResistance(highs, lows);
      const st      = superTrend(candles);
      const vwapVal = vwap(candles.slice(-20));
      const bb      = bollingerBands(closes);
      const stoch   = stochastic(closes, highs, lows);
      const patts   = scanPatterns(candles).filter(p => !p.barsAgo);

      let score = 0;
      if (sig?.signal === 'BUY')                             score += 2;
      if (rsiVal < 35)                                       score += 2;
      else if (rsiVal < 45)                                  score += 1;
      if (stoch?.oversold)                                   score += 1;
      if (st?.trend === 'BULLISH')                           score += 1;
      if (price > vwapVal)                                   score += 1;
      if (bb && price < bb.lower)                            score += 1;
      if (sr && Math.abs(price - sr.support) / sr.support < 0.015) score += 1;
      if (patts.some(p => p.sentiment === 'BULLISH' && p.strength === 'STRONG')) score += 1;

      results.push({
        symbol: sym, price, score, rsi: rsiVal?.toFixed(1),
        signal: sig?.signal, atr: atrVal?.toFixed(2),
        support: sr?.support?.toFixed(2), resistance: sr?.resistance?.toFixed(2),
        supertrend: st?.trend, aboveVWAP: price > vwapVal,
        sl_atr: atrVal ? (price - 2 * atrVal).toFixed(2) : null,
        t1: atrVal ? (price + 1.5 * atrVal).toFixed(2) : null,
        t2: atrVal ? (price + 3 * atrVal).toFixed(2) : null,
        patterns: patts.map(p => p.pattern),
        bias: score >= 6 ? 'STRONG_BUY' : score >= 4 ? 'BUY' : score <= 2 ? 'SELL' : 'NEUTRAL',
      });
    } catch {}
  }

  results.sort((a, b) => b.score - a.score);
  p('');
  p(`  ${'SYMBOL'.padEnd(12)} ${'PRICE'.padStart(9)}  RSI   SCORE   SIGNAL       VWAP  TREND`);
  hr();
  for (const s of results) {
    const biasC = s.bias === 'STRONG_BUY' ? C.green + C.bold : s.bias === 'BUY' ? C.green : s.bias === 'SELL' ? C.red : C.yellow;
    const bar   = '█'.repeat(s.score) + '░'.repeat(10 - s.score);
    p(`  ${C.bold}${s.symbol.padEnd(12)}${C.reset} ${C.cyan}${String(s.price).padStart(9)}${C.reset}  ${s.rsi.padStart(4)}  [${C.cyan}${bar}${C.reset}]${s.score}/10  ${biasC}${(s.bias || 'NEUTRAL').padEnd(10)}${C.reset}  ${s.aboveVWAP ? C.green + '▲' : C.red + '▼'}${C.reset}  ${s.supertrend === 'BULLISH' ? C.green : C.red}${s.supertrend || '?'}${C.reset}`);
    if (s.score >= 6) inf(`    SL:₹${s.sl_atr} | T1:₹${s.t1} | T2:₹${s.t2}${s.patterns.length ? ` | ${s.patterns.join(', ')}` : ''}`);
  }
}

async function cmdHistory(symbol) {
  if (!symbol) { err('Usage: history SYMBOL'); return; }
  hdr(`Historical Similarity — ${symbol.toUpperCase()}`);
  inf('Analysing 365 days of history...');
  try {
    const hist   = await market.getHistoricalDataYahoo(symbol, 'NSE', 365, '1d');
    const result = historicalSimilarity(hist.candles, 5);
    if (result.error) { err(result.error); return; }

    p(`\n  ${C.bold}Today's Setup${C.reset}`);
    p(`  Price: ${formatPrice(result.currentSetup.price)}  RSI: ${result.currentSetup.rsi}  BB: ${result.currentSetup.bbPos}`);
    p(`\n  ${C.bold}5 Most Similar Past Moments${C.reset}`);
    hr();
    for (const m of result.historicalMatches) {
      const c10 = parseFloat(m.after10d) >= 0 ? C.green : C.red;
      p(`  ${m.date.slice(0, 10)}  ₹${m.price}  RSI:${m.rsi}  Similarity:${m.similarity}`);
      p(`    5d: ${m.after5d}  10d: ${c10}${m.after10d}${C.reset}  20d: ${m.after20d}  → ${m.outcome}`);
    }
    p('');
    const vc = parseInt(result.stats.winRate) >= 60 ? C.green : C.red;
    p(`  ${C.bold}Historical Edge${C.reset}`);
    p(`  Win Rate: ${vc}${result.stats.winRate}${C.reset}  |  Avg 10d Return: ${result.stats.avgReturn10d}`);
    p(`  Best: ${C.green}${result.stats.bestCase10d}${C.reset}  |  Worst: ${C.red}${result.stats.worstCase10d}${C.reset}`);
    p('');
    p(`  ${C.bold}${result.verdict}${C.reset}`);
  } catch (e) { err(e.message); }
}

async function cmdPortfolio() {
  hdr('Paper Portfolio');
  try {
    const p2 = getPortfolio();
    const pnlC = parseFloat(p2.totalPnl) >= 0 ? C.green : C.red;
    p(`  Cash:   ${C.cyan}${formatPrice(p2.cash)}${C.reset}`);
    p(`  Value:  ${C.cyan}${formatPrice(p2.portfolioValue)}${C.reset}`);
    p(`  P&L:    ${pnlC}${formatPrice(p2.totalPnl)} (${p2.totalReturn})${C.reset}`);
    p(`  Trades: ${p2.totalTrades}  |  Wins: ${p2.wins}  |  Win Rate: ${p2.winRate}`);
    if (p2.holdings?.length) {
      p('');
      p(`  ${'SYMBOL'.padEnd(12)} ${'QTY'.padStart(6)}  ${'AVG'.padStart(9)}  ${'LTP'.padStart(9)}  P&L`);
      hr();
      for (const h of p2.holdings) {
        const hc = parseFloat(h.unrealizedPnl) >= 0 ? C.green : C.red;
        p(`  ${C.bold}${h.symbol.padEnd(12)}${C.reset} ${String(h.qty).padStart(6)}  ${String(h.avgPrice).padStart(9)}  ${String(h.ltp).padStart(9)}  ${hc}${formatPrice(h.unrealizedPnl)} (${h.pnlPct})${C.reset}`);
      }
    }
  } catch (e) { err(e.message); }
}

async function cmdPaperBuy(symbol, qtyStr) {
  if (!symbol || !qtyStr) { err('Usage: buy SYMBOL QTY'); return; }
  const qty = parseInt(qtyStr, 10);
  if (isNaN(qty) || qty < 1) { err('Invalid quantity'); return; }
  try {
    const liveData = await market.getLivePriceNSE(symbol);
    const price    = liveData?.priceInfo?.lastPrice || liveData?.lastPrice;
    if (!price) { err('Could not fetch live price'); return; }
    const result   = paperBuy({ symbol: symbol.toUpperCase(), qty, price, note: 'CLI buy' });
    if (result.success) {
      ok(`Bought ${qty} × ${symbol.toUpperCase()} at ${formatPrice(price)}`);
      inf(`Total cost: ${formatPrice(price * qty)}  |  Cash remaining: ${formatPrice(result.cashRemaining)}`);
    } else {
      err(result.error);
    }
  } catch (e) { err(e.message); }
}

async function cmdPaperSell(symbol, qtyStr) {
  if (!symbol || !qtyStr) { err('Usage: sell SYMBOL QTY'); return; }
  const qty = parseInt(qtyStr, 10);
  if (isNaN(qty) || qty < 1) { err('Invalid quantity'); return; }
  try {
    const liveData = await market.getLivePriceNSE(symbol);
    const price    = liveData?.priceInfo?.lastPrice || liveData?.lastPrice;
    if (!price) { err('Could not fetch live price'); return; }
    const result   = paperSell({ symbol: symbol.toUpperCase(), qty, price, note: 'CLI sell' });
    if (result.success) {
      const pnlC = parseFloat(result.realizedPnl) >= 0 ? C.green : C.red;
      ok(`Sold ${qty} × ${symbol.toUpperCase()} at ${formatPrice(price)}`);
      p(`  Realized P&L: ${pnlC}${formatPrice(result.realizedPnl)}${C.reset}  |  Cash: ${formatPrice(result.cashRemaining)}`);
    } else {
      err(result.error);
    }
  } catch (e) { err(e.message); }
}

async function cmdGainers() {
  hdr('Top Gainers — NIFTY 50');
  try {
    const list = await market.getTopGainers('NIFTY 50', 10);
    for (const s of list) p(`  ${C.bold}${s.symbol.padEnd(14)}${C.reset} ${formatPrice(s.lastPrice).padStart(12)}  ${pChange(s.pChange)}  Vol: ${(s.volume || 0).toLocaleString('en-IN')}`);
  } catch (e) { err(e.message); }
}

async function cmdLosers() {
  hdr('Top Losers — NIFTY 50');
  try {
    const list = await market.getTopLosers('NIFTY 50', 10);
    for (const s of list) p(`  ${C.bold}${s.symbol.padEnd(14)}${C.reset} ${formatPrice(s.lastPrice).padStart(12)}  ${pChange(s.pChange)}  Vol: ${(s.volume || 0).toLocaleString('en-IN')}`);
  } catch (e) { err(e.message); }
}

async function cmdFII() {
  hdr('FII / DII Activity (Last 5 Days)');
  const nseGet = market._nseRequest.bind(market);
  const data   = await getFIIDII(nseGet);
  if (!data) { err('Could not fetch FII/DII data'); return; }

  const bias = data.marketBias === 'BULLISH' ? C.green : C.red;
  p(`  Market Bias: ${bias}${C.bold}${data.marketBias}${C.reset}  |  FII 5d net: ${parseFloat(data.fiiNet5d) >= 0 ? C.green : C.red}₹${data.fiiNet5d} Cr${C.reset}  |  DII 5d net: ${parseFloat(data.diiNet5d) >= 0 ? C.green : C.red}₹${data.diiNet5d} Cr${C.reset}`);
  p('');
  p(`  ${C.bold}FII/FPI${C.reset}  ${data.fiiBias === 'BUYING' ? C.green : C.red}${data.fiiBias}${C.reset}`);
  p(`  ${'Date'.padEnd(14)} ${'Buy (Cr)'.padStart(12)}  ${'Sell (Cr)'.padStart(12)}  ${'Net (Cr)'.padStart(12)}`);
  hr();
  for (const r of data.fii) {
    const nc = r.net >= 0 ? C.green : C.red;
    p(`  ${r.date.padEnd(14)} ${String(r.buy.toFixed(0)).padStart(12)}  ${String(r.sell.toFixed(0)).padStart(12)}  ${nc}${String(r.net.toFixed(0)).padStart(12)}${C.reset}`);
  }
  p('');
  p(`  ${C.bold}DII${C.reset}  ${data.diiBias === 'BUYING' ? C.green : C.red}${data.diiBias}${C.reset}`);
  p(`  ${'Date'.padEnd(14)} ${'Buy (Cr)'.padStart(12)}  ${'Sell (Cr)'.padStart(12)}  ${'Net (Cr)'.padStart(12)}`);
  hr();
  for (const r of data.dii) {
    const nc = r.net >= 0 ? C.green : C.red;
    p(`  ${r.date.padEnd(14)} ${String(r.buy.toFixed(0)).padStart(12)}  ${String(r.sell.toFixed(0)).padStart(12)}  ${nc}${String(r.net.toFixed(0)).padStart(12)}${C.reset}`);
  }
}

async function cmdPCR(symbol = 'NIFTY') {
  hdr(`Put-Call Ratio — ${symbol.toUpperCase()}`);
  const nseGet = market._nseRequest.bind(market);
  const data   = await getPCR(nseGet, symbol.toUpperCase());
  if (!data) { err('Could not fetch option chain data'); return; }

  const sc = data.sentiment === 'BULLISH' ? C.green : data.sentiment === 'BEARISH' ? C.red : C.yellow;
  p(`  Spot: ${C.cyan}${C.bold}₹${data.spot}${C.reset}   PCR (OI): ${sc}${C.bold}${data.pcrOI}${C.reset}   PCR (Vol): ${data.pcrVol}`);
  p(`  Sentiment: ${sc}${C.bold}${data.sentiment}${C.reset}`);
  p(`  ${C.dim}${data.note}${C.reset}`);
  p('');
  p(`  ${C.dim}Total PE OI: ${data.totalPEOI.toLocaleString('en-IN')}  |  Total CE OI: ${data.totalCEOI.toLocaleString('en-IN')}${C.reset}`);
  p('');
  p(`  ${C.dim}PCR Guide: >1.5 very bullish  |  >1.2 bullish  |  0.7-1.2 neutral  |  <0.7 bearish  |  <0.5 very bearish${C.reset}`);
}

async function cmdOI(symbol = 'NIFTY') {
  hdr(`Open Interest Analysis — ${symbol.toUpperCase()}`);
  inf('Fetching option chain...');
  const nseGet = market._nseRequest.bind(market);
  const data   = await getOILevels(nseGet, symbol.toUpperCase());
  if (!data || data.error) { err(data?.error || 'Could not fetch OI data'); return; }

  const bc = data.bias === 'BULLISH' ? C.green : data.bias === 'BEARISH' ? C.red : C.yellow;
  p(`  Spot: ${C.cyan}${C.bold}₹${data.spot}${C.reset}   Expiry: ${C.dim}${data.expiry}${C.reset}   Max Pain: ${C.yellow}${C.bold}₹${data.maxPain}${C.reset}   Bias: ${bc}${data.bias}${C.reset}`);
  p(`  ${C.dim}${data.interpretation}${C.reset}`);
  p('');
  p(`  ${C.bold}${C.red}Resistance (high CE OI)${C.reset}`);
  for (const r of data.resistance)
    p(`    ₹${r.strike}  OI: ${r.oi}K  ${r.change === 'ADDING' ? C.red + 'ADDING (bearish wall building)' : C.green + 'SHEDDING (resistance weakening)'}${C.reset}`);
  p('');
  p(`  ${C.bold}${C.green}Support (high PE OI)${C.reset}`);
  for (const s of data.support)
    p(`    ₹${s.strike}  OI: ${s.oi}K  ${s.change === 'ADDING' ? C.green + 'ADDING (support building)' : C.red + 'SHEDDING (support crumbling)'}${C.reset}`);
  if (data.ceUnwinding?.length) {
    p('');
    p(`  ${C.dim}CE unwinding above spot (resistance easing — bullish): ${data.ceUnwinding.map(s => `₹${s.strike}`).join(', ')}${C.reset}`);
  }
}

async function cmdBacktest(symbol, days = '365') {
  if (!symbol) { err('Usage: backtest SYMBOL [days]'); return; }
  const lookback = parseInt(days, 10);
  hdr(`Backtest — ${symbol.toUpperCase()} (${lookback} days)`);
  inf(`Fetching ${lookback} days of history...`);
  try {
    const hist   = await market.getHistoricalDataYahoo(symbol, 'NSE', lookback, '1d');
    const candles = hist.candles;
    if (candles.length < 60) { err('Not enough data for backtest'); return; }

    inf(`Running confluence strategy on ${candles.length} candles...`);
    const result = backtestStrategy(candles, { minScore: 6, capital: 100000, riskPct: 1 });
    const st     = result.stats;
    const wc     = parseFloat(st.returns) >= 0 ? C.green : C.red;
    const pfc    = parseFloat(st.profitFactor) >= 1.5 ? C.green : C.red;

    p('');
    p(`  ${C.bold}Results (confluence score ≥ 6, 1% risk/trade, ₹1L capital)${C.reset}`);
    hr();
    p(`  Trades:         ${st.totalTrades}  (${st.wins}W / ${st.losses}L)`);
    p(`  Win Rate:       ${parseFloat(st.winRate) >= 50 ? C.green : C.red}${st.winRate}${C.reset}`);
    p(`  Profit Factor:  ${pfc}${st.profitFactor}${C.reset}   ${C.dim}(>1.5 = good strategy)${C.reset}`);
    p(`  Expectancy:     ${st.expectancy} per trade`);
    p(`  Avg Win:        ${C.green}${st.avgWin}${C.reset}   Avg Loss: ${C.red}${st.avgLoss}${C.reset}`);
    p(`  Max Drawdown:   ${C.red}${st.maxDrawdown}${C.reset}`);
    p(`  Total Return:   ${wc}${st.returns}${C.reset}  (₹${Number(st.totalPnl).toLocaleString('en-IN')} P&L)`);
    p('');

    if (result.trades.length > 0) {
      p(`  ${C.bold}Last 5 Trades${C.reset}`);
      hr();
      for (const t of result.trades.slice(-5)) {
        const tc = t.win ? C.green : C.red;
        p(`  ${t.entryDate}  Entry:₹${t.entry}  Exit:₹${t.exit}  ${tc}P&L:₹${t.pnl} (${t.pnlPct}%)${C.reset}  [${t.reason}] Score:${t.score}`);
      }
    }
  } catch (e) { err(e.message); }
}

async function cmdVolume(symbol) {
  if (!symbol) { err('Usage: volume SYMBOL'); return; }
  hdr(`Volume Analysis — ${symbol.toUpperCase()}`);
  try {
    const hist    = await market.getHistoricalDataYahoo(symbol, 'NSE', 30, '1d');
    const candles = hist.candles;
    const vols    = candles.map(c => c.volume || 0);
    const va      = volumeAnomaly(vols, 20);
    if (!va) { err('Not enough data'); return; }

    const sc = va.strength === 'STRONG' ? C.red + C.bold : va.strength === 'MODERATE' ? C.yellow : C.dim;
    p(`  Today's Volume: ${C.bold}${va.todayVolume.toLocaleString('en-IN')}${C.reset}`);
    p(`  20d Avg Volume: ${va.avgVolume.toLocaleString('en-IN')}`);
    p(`  Volume Ratio:   ${sc}${va.ratio}x${C.reset}  ${va.strength}`);
    p('');
    if (va.isAnomaly) {
      p(`  ${C.yellow}Volume spike detected! (${va.ratio}x avg)${C.reset}`);
      p(`  ${C.dim}High volume often precedes or confirms a significant price move.${C.reset}`);
      p(`  ${C.dim}Combine with price action — breakout + high volume = strong signal.${C.reset}`);
    } else {
      p(`  ${C.dim}Volume normal — no anomaly detected.${C.reset}`);
    }
  } catch (e) { err(e.message); }
}

async function cmdTrail(symbol, atrMult = '2') {
  if (!symbol) { err('Usage: trail SYMBOL [atr_multiplier]'); return; }
  hdr(`Trail Stop Loss — ${symbol.toUpperCase()}`);
  try {
    const [histRes, liveRes] = await Promise.allSettled([
      market.getHistoricalDataYahoo(symbol, 'NSE', 30, '1d'),
      market.getLivePriceNSE(symbol),
    ]);
    const candles  = histRes.status === 'fulfilled' ? histRes.value.candles : [];
    const live     = liveRes.status === 'fulfilled' ? liveRes.value : null;
    const price    = live?.priceInfo?.lastPrice || live?.lastPrice || parseFloat(candles.at(-1)?.close);
    const atrValue = atr(candles, 14);
    if (!price || !atrValue) { err('Could not fetch price/ATR'); return; }

    const result = trailStopLoss(symbol.toUpperCase(), price, atrValue, parseFloat(atrMult));
    if (result.success) {
      ok(result.message);
      p(`  Current Price: ${C.cyan}₹${price}${C.reset}   ATR: ₹${atrValue.toFixed(2)}`);
      p(`  Old SL: ${C.dim}₹${result.oldSL}${C.reset}   New SL: ${C.green}₹${result.newSL}${C.reset}`);
    } else {
      inf(result.message || result.error);
    }
  } catch (e) { err(e.message); }
}

async function cmdAdvisor() {
  hdr('AI Trading Advisor');
  inf('Use Claude Code directly for AI analysis:');
  p('');
  p(`  ${C.cyan}Open a terminal in this folder and run:${C.reset}`);
  p(`  ${C.bold}  claude${C.reset}`);
  p(`  ${C.dim}  Then ask anything — Claude knows all the tools, indicators, and your trading style.${C.reset}`);
  p(`  ${C.dim}  Example: "analyze RELIANCE and give me entry/SL/target"${C.reset}`);
  p(`  ${C.dim}           "what stocks look good today for intraday?"${C.reset}`);
  p(`  ${C.dim}           "scan NIFTY 50 for oversold setups"${C.reset}`);
  p('');
}

// ── Natural language fallback ────────────────────────────────
function askClaude(input) {
  p('');
  p(`  ${C.yellow}For AI questions, use Claude Code directly:${C.reset}`);
  p(`  ${C.bold}  claude${C.reset}  ${C.dim}(open in this folder)${C.reset}`);
  p(`  ${C.dim}  Then ask: "${input}"${C.reset}`);
  p('');
  p(`  ${C.dim}Or use a structured command — type ${C.reset}${C.bold}help${C.reset}${C.dim} to see all commands.${C.reset}`);
  p('');
}

// ── Command router ────────────────────────────────────────────
async function route(input) {
  const trimmed = input.trim();
  if (!trimmed) return;

  const parts  = trimmed.split(/\s+/);
  const cmd    = parts[0].toLowerCase();
  const args   = parts.slice(1);

  switch (cmd) {
    case 'status':   case 's':           return cmdStatus();
    case 'scan':                          return cmdScan(args[0]);
    case 'analyze':  case 'a':           return cmdAnalyze(args[0]);
    case 'history':  case 'h':           return cmdHistory(args[0]);
    case 'buy':                           return cmdPaperBuy(args[0], args[1]);
    case 'sell':                          return cmdPaperSell(args[0], args[1]);
    case 'portfolio': case 'p':          return cmdPortfolio();
    case 'gainers':  case 'g':           return cmdGainers();
    case 'losers':   case 'l':           return cmdLosers();
    case 'advisor':  case 'ai':          return cmdAdvisor();
    case 'fii':                           return cmdFII();
    case 'pcr':                           return cmdPCR(args[0] || 'NIFTY');
    case 'oi':                            return cmdOI(args[0] || 'NIFTY');
    case 'backtest': case 'bt':          return cmdBacktest(args[0], args[1]);
    case 'volume':   case 'vol':         return cmdVolume(args[0]);
    case 'trail':                         return cmdTrail(args[0], args[1]);
    case 'reset':
      resetPortfolio(parseFloat(args[0] || '100000'));
      ok(`Portfolio reset with ₹${(parseFloat(args[0] || '100000')).toLocaleString('en-IN')}`);
      return;
    case 'orders': {
      hdr('Recent Paper Orders');
      const orders = getOrders(10);
      for (const o of orders) {
        const tc = o.type === 'BUY' ? C.green : C.red;
        p(`  ${tc}${o.type}${C.reset}  ${o.symbol}  ×${o.qty}  @₹${o.execPrice}  ${o.timestamp?.slice(0, 16)}`);
      }
      return;
    }
    case 'stats': {
      hdr('Journal Performance Stats');
      const st = getStats();
      if (st.message) { inf(st.message); return; }
      p(`  Trades: ${st.totalTrades}  Wins: ${st.wins}  Win Rate: ${C.cyan}${st.winRate}${C.reset}`);
      p(`  Avg Win: ${C.green}${st.avgWin}%${C.reset}  Avg Loss: ${C.red}${st.avgLoss}%${C.reset}`);
      p(`  Profit Factor: ${C.cyan}${st.profitFactor}${C.reset}  Expectancy: ${st.expectancy}`);
      p(`  Max Drawdown: ${C.red}${st.maxDrawdown}${C.reset}  Best Trade: ${C.green}${st.bestTrade}${C.reset}`);
      return;
    }
    case 'clear': case 'cls':  process.stdout.write('\x1Bc'); return;
    case 'quit':  case 'exit': case 'q':
      p(`\n${C.dim}  Bye. Stay disciplined.${C.reset}\n`);
      process.exit(0);
    case 'help': case '?':
      hdr('Commands');
      const cmds = [
        ['status / s',          'NIFTY + BANKNIFTY live prices'],
        ['scan [SYM1,SYM2]',   'Scan watchlist for setups'],
        ['analyze / a SYMBOL',  'Deep technical analysis'],
        ['history / h SYMBOL',  'Historical similarity — what happened in similar setups'],
        ['gainers / g',         'Top gainers today'],
        ['losers / l',          'Top losers today'],
        ['advisor / ai',        'AI trade plan (open claude in this folder)'],
        ['fii',                 'FII/DII net buy/sell last 5 days'],
        ['pcr [NIFTY|BANKNIFTY]','Put-Call Ratio — market sentiment'],
        ['oi [NIFTY|BANKNIFTY]','OI levels — support/resistance/max pain'],
        ['volume / vol SYMBOL', 'Volume anomaly — is unusual volume present?'],
        ['backtest / bt SYMBOL [days]', 'Backtest confluence strategy on history'],
        ['buy SYMBOL QTY',      'Paper buy at live price'],
        ['sell SYMBOL QTY',     'Paper sell at live price'],
        ['trail SYMBOL [mult]', 'Trail stop loss up by ATR (default 2×ATR)'],
        ['portfolio / p',       'Paper trading portfolio + P&L'],
        ['orders',              'Recent paper order history'],
        ['stats',               'Journal win rate, profit factor, drawdown'],
        ['reset [AMOUNT]',      'Reset paper portfolio (default ₹1,00,000)'],
        ['clear',               'Clear screen'],
        ['quit / q',            'Exit'],
      ];
      for (const [c, d] of cmds) p(`  ${C.cyan}${c.padEnd(22)}${C.reset}${C.dim}${d}${C.reset}`);
      return;
    default:
      // Natural language — send to Claude
      return askClaude(trimmed);
  }
}

// ── Startup banner ────────────────────────────────────────────
function banner() {
  p('');
  p(`${C.bold}${C.cyan}  ╔══════════════════════════════════════════════════════╗`);
  p(`  ║        AI TRADER — Interactive Terminal               ║`);
  p(`  ╚══════════════════════════════════════════════════════╝${C.reset}`);
  p(`  ${C.dim}Type commands or plain English — uses Claude Code CLI for AI.${C.reset}`);
  p(`  ${C.dim}'help' for all commands.${C.reset}`);
  p('');
}

// ── One-shot mode (node cli.mjs scan) ────────────────────────
const oneShot = process.argv.slice(2);
if (oneShot.length > 0) {
  await route(oneShot.join(' '));
  process.exit(0);
}

// ── Interactive REPL ──────────────────────────────────────────
banner();

const rl = readline.createInterface({
  input:    process.stdin,
  output:   process.stdout,
  prompt:   `${C.bold}${C.cyan}trader>${C.reset} `,
  terminal: true,
});

rl.prompt();

rl.on('line', async (line) => {
  await route(line);
  p('');
  rl.prompt();
});

rl.on('close', () => {
  p(`\n${C.dim}  Bye. Stay disciplined.${C.reset}\n`);
  process.exit(0);
});
