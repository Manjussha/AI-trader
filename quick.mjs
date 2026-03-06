/**
 * QUICK ANALYSIS — Instant (<2s) using pre-cached indicators + live price only
 *
 * Usage:
 *   node quick.mjs TECHM           → instant analysis
 *   node quick.mjs TECHM buy       → analysis + paper buy
 *   node quick.mjs TECHM sell      → paper sell
 *   node quick.mjs scan            → top opportunities from cache
 *   node quick.mjs portfolio       → live P&L
 *   node quick.mjs nifty           → NIFTY snapshot + option levels
 *   node quick.mjs close PE        → close NIFTY PE
 */
import { readFileSync, existsSync } from 'fs';
import { GrowwClient } from './src/groww-client.js';
import { paperBuy, paperSell, paperSellOption, getPortfolio } from './src/paper-trade.js';

const CACHE_FILE = './cache.json';
const market     = new GrowwClient({ apiKey: '', totpSecret: '' });
const args       = process.argv.slice(2);
const cmd        = args[0]?.toUpperCase();
const action     = args[1]?.toLowerCase();

if (!cmd) {
  console.log('Usage: node quick.mjs <SYMBOL|scan|portfolio|nifty> [buy|sell]');
  process.exit(0);
}

// Load cache
const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : null;
if (!cache) { console.log('❌ No cache found. Run: node cache-refresh.mjs first'); process.exit(1); }

const cacheAge = Math.round((Date.now() - new Date(cache.refreshedAt)) / 60000);

// ── PORTFOLIO ─────────────────────────────────────────────────────────────────
if (cmd === 'PORTFOLIO') {
  const [liveIdx, ...q] = await Promise.all([
    market._nseRequest('/equity-stockIndices?index=NIFTY%2050'),
    ...['TECHM','WIPRO','BEL','NTPC'].map(s => market.getLivePriceNSE(s).catch(()=>null))
  ]);
  const niftyPrice = parseFloat(liveIdx?.data?.[0]?.lastPrice);
  const niftyPC    = parseFloat(liveIdx?.data?.[0]?.pChange);
  const livePrices = {};
  ['TECHM','WIPRO','BEL','NTPC'].forEach((s,i) => {
    if (q[i]) livePrices[s] = parseFloat(q[i].priceInfo?.lastPrice||0);
  });
  const spotDiff = niftyPrice - 24612;
  livePrices['NIFTY_24600_PE_27-Mar-2026'] = parseFloat(Math.max(5, 155 + 0.50*(-spotDiff)).toFixed(1));

  const p = getPortfolio(livePrices);
  const net = parseFloat(p.realizedPnl) + parseFloat(p.unrealizedPnl);
  const now = new Date().toLocaleTimeString('en-IN');

  console.log(`\n📊 PORTFOLIO @ ${now} | NIFTY ₹${niftyPrice} (${niftyPC}%)\n`);
  console.log(`Capital: ₹1,00,000 → Value: ₹${p.portfolioValue} | Cash: ₹${p.cash}`);
  console.log(`Net P&L: ${net>=0?'▲ +':'▼ '}₹${Math.abs(net).toFixed(0)} | Win Rate: ${p.winRate}\n`);
  p.holdings.filter(h=>h.type!=='OPTION').forEach(h => {
    const pnl = parseFloat(h.unrealizedPnl);
    console.log(`${pnl>=0?'▲':'▼'} ${h.symbol.padEnd(10)} ₹${h.ltp}  ${pnl>=0?'+':''}₹${pnl.toFixed(0)} (${h.pnlPct})`);
  });
  p.holdings.filter(h=>h.type==='OPTION').forEach(h => {
    const pnl = parseFloat(h.unrealizedPnl);
    console.log(`${pnl>=0?'▲':'▼'} NIFTY ${h.strike}${h.optType}  ₹${h.premium}→₹${h.currentPremium}  ${pnl>=0?'+':''}₹${pnl.toFixed(0)}`);
  });
  process.exit(0);
}

// ── NIFTY SNAPSHOT ────────────────────────────────────────────────────────────
if (cmd === 'NIFTY') {
  const liveIdx = await market._nseRequest('/equity-stockIndices?index=NIFTY%2050');
  const n = liveIdx?.data?.[0];
  const price = parseFloat(n?.lastPrice);
  const stocks = liveIdx?.data?.slice(1)||[];
  const adv = stocks.filter(s=>s.pChange>0).length;
  const dec = stocks.filter(s=>s.pChange<0).length;

  // Option levels
  const atm = Math.round(price/50)*50;
  console.log(`\n⚡ NIFTY LIVE @ ${new Date().toLocaleTimeString('en-IN')}`);
  console.log(`Price: ₹${price} (${n?.pChange}%) | H:${n?.dayHigh} L:${n?.dayLow}`);
  console.log(`Breadth: ${adv}↑/${dec}↓ | ${adv>dec?'BULLISH':'BEARISH'} breadth`);
  console.log(`\nKey Levels:`);
  console.log(`  Resistance: ${parseFloat(n?.dayHigh).toFixed(0)} (day high)`);
  console.log(`  Current ATM: ${atm}`);
  console.log(`  Support: ${parseFloat(n?.dayLow).toFixed(0)} (day low)`);
  console.log(`\nOption Strikes (March expiry):`);
  console.log(`  Buy CE: ${atm+50} CE  |  Buy PE: ${atm} PE`);
  console.log(`  Bear spread: Sell ${atm} CE / Buy ${atm-50} CE`);
  process.exit(0);
}

// ── SCAN — Top setups from cache ──────────────────────────────────────────────
if (cmd === 'SCAN') {
  console.log(`\n⚡ TOP SETUPS (cache ${cacheAge}m ago)\n`);
  const ranked = Object.values(cache.stocks).sort((a,b) => b.score - a.score).slice(0,10);
  ranked.forEach((s,i) => {
    const sl  = s.levels.sl;
    const t1  = s.levels.t1;
    const rr  = ((t1 - s.lastClose)/(s.lastClose - sl)).toFixed(1);
    const bar = '█'.repeat(s.score)+'░'.repeat(10-s.score);
    console.log(`${i+1}. ${s.symbol.padEnd(12)} ₹${s.lastClose}  Score:${s.score}/10 [${bar}]  RSI:${s.rsi}  ${s.signal}`);
    console.log(`   SL:₹${sl}  T1:₹${t1}  R:R=1:${rr}  ${s.patterns.map(p=>p.name).join(', ')}`);
  });
  console.log(`\nRun: node quick.mjs <SYMBOL> buy  → instant paper trade`);
  process.exit(0);
}

// ── CLOSE PE ──────────────────────────────────────────────────────────────────
if (cmd === 'CLOSE' && action === 'pe') {
  const liveIdx = await market._nseRequest('/equity-stockIndices?index=NIFTY%2050');
  const niftyPrice = parseFloat(liveIdx?.data?.[0]?.lastPrice);
  const spotDiff   = niftyPrice - 24612;
  const peNow      = Math.max(5, 155 + 0.50 * (-spotDiff));
  const result     = paperSellOption({ symbol:'NIFTY', strike:24600, type:'PE', expiry:'27-Mar-2026', currentPremium: parseFloat(peNow.toFixed(1)), note:'Manual close' });
  if (result.success) {
    console.log(`✅ CLOSED NIFTY 24600 PE @ ₹${peNow.toFixed(1)}`);
    console.log(`Realized P&L: ${result.realizedPnl>=0?'+':''}₹${result.realizedPnl} | Cash: ₹${result.cashRemaining}`);
  } else console.log(`❌ ${result.error}`);
  process.exit(0);
}

// ── STOCK ANALYSIS ────────────────────────────────────────────────────────────
const cached = cache.stocks[cmd];
if (!cached) { console.log(`❌ ${cmd} not in cache. Add to WATCHLIST in cache-refresh.mjs and re-run.`); process.exit(1); }

// Fetch ONLY live price (fast ~400ms)
const t0 = Date.now();
const liveQ = await market.getLivePriceNSE(cmd).catch(async () => {
  // fallback: use NSE index data
  return null;
});
const livePrice = liveQ ? parseFloat(liveQ.priceInfo?.lastPrice) : cached.lastClose;
const dayHigh   = liveQ ? parseFloat(liveQ.priceInfo?.intraDayHighLow?.max) : null;
const dayLow    = liveQ ? parseFloat(liveQ.priceInfo?.intraDayHighLow?.min) : null;
const pChange   = liveQ ? parseFloat(liveQ.priceInfo?.pChange || 0) : 0;
const fetchMs   = Date.now() - t0;

// Update levels with live price
const { atr, sr, bb, vwap: vwapVal, ema, superTrend, rsi: rsiVal, signal } = {
  atr: cached.atr, sr: cached.sr, bb: cached.bb, vwap: cached.vwap,
  ema: cached.ema, superTrend: cached.superTrend, rsi: cached.rsi, signal: cached.signal
};
const sl = parseFloat((livePrice - 2 * atr).toFixed(2));
const t1 = parseFloat((livePrice + 1.5 * (livePrice - sl)).toFixed(2));
const t2 = parseFloat((livePrice + 3.0 * (livePrice - sl)).toFixed(2));
const riskPerShare = livePrice - sl;
const rr = ((t1 - livePrice) / riskPerShare).toFixed(1);

// Live confluence recalc
let score = cached.score;
if (livePrice < bb.lower)  score = Math.min(10, score + 1);
if (livePrice > vwapVal)   score = Math.min(10, score + 1);
else                       score = Math.max(0, score - 1);
if (Math.abs(livePrice - sr.support)/sr.support < 0.015) score = Math.min(10, score+1);

const scoreBar = '█'.repeat(score)+'░'.repeat(10-score);
const verdict  = score >= 7 ? '🟢 STRONG BUY' : score >= 5 ? '🟡 BUY' : score >= 3 ? '🟠 NEUTRAL' : '🔴 AVOID';

console.log(`\n⚡ ${cmd} — ${fetchMs}ms fetch\n`);
console.log(`Price : ₹${livePrice}  ${pChange>=0?'▲':'▼'} ${pChange}%  |  H:${dayHigh||'—'} L:${dayLow||'—'}`);
console.log(`Signal: ${verdict}  [${scoreBar}] ${score}/10`);
console.log(`\nIndicators (cached ${cacheAge}m ago):`);
console.log(`  RSI      : ${rsiVal}  ${rsiVal<35?'⚠️ OVERSOLD':rsiVal>65?'⚠️ OVERBOUGHT':'—'}`);
console.log(`  MACD     : Hist ${cached.macd.hist}  ${cached.macd.hist>0?'▲ BULLISH':'▼ BEARISH'}`);
console.log(`  BB       : ${bb.upper} / ${bb.middle} / ${bb.lower}  ${livePrice<bb.lower?'🔥 BELOW LOWER':'—'}`);
console.log(`  EMA9/21  : ${ema.e9} / ${ema.e21}  ${livePrice>ema.e9?'Above EMA9 ✓':'Below EMA9 ✗'}`);
console.log(`  SMA50    : ${ema.s50}  ${livePrice>ema.s50?'Above ✓':'Below ✗'}`);
console.log(`  SuperTrend: ${superTrend.trend}`);
console.log(`  VWAP     : ${vwapVal}  ${livePrice>vwapVal?'Above ✓':'Below ✗'}`);
console.log(`  Support  : ${sr.support}  Resistance: ${sr.resistance}`);
console.log(`  ATR      : ₹${atr}/day`);
if (cached.patterns.length>0) console.log(`  Patterns : ${cached.patterns.map(p=>p.name).join(', ')}`);

console.log(`\nTrade Levels:`);
console.log(`  Entry : ₹${livePrice}`);
console.log(`  SL    : ₹${sl}  (2×ATR = ₹${(2*atr).toFixed(1)} risk)`);
console.log(`  T1    : ₹${t1}  (+${(t1-livePrice).toFixed(1)} pts)`);
console.log(`  T2    : ₹${t2}  (+${(t2-livePrice).toFixed(1)} pts)`);
console.log(`  R:R   : 1:${rr}`);

// Position sizing (₹1000 risk)
const qty = Math.max(1, Math.floor(1000 / riskPerShare));
console.log(`  Qty   : ${qty} shares (₹1000 risk = 1% of ₹1L capital)`);
console.log(`  Cost  : ₹${(qty * livePrice).toFixed(0)}`);

// ── BUY action ──────────────────────────────────────────────────────────────
if (action === 'buy') {
  const result = paperBuy({ symbol: cmd, qty, price: livePrice, note: `Quick trade | SL:${sl} T1:${t1} T2:${t2}` });
  if (result.success) {
    console.log(`\n✅ PAPER BUY EXECUTED`);
    console.log(`   ${cmd} x${qty} @ ₹${livePrice} | Cost: ₹${(qty*livePrice).toFixed(0)}`);
    console.log(`   SL: ₹${sl} | T1: ₹${t1} | Cash left: ₹${result.cashRemaining}`);
  } else {
    console.log(`\n❌ ${result.error}`);
  }
}

// ── SELL action ─────────────────────────────────────────────────────────────
if (action === 'sell') {
  const p = getPortfolio();
  const holding = p.holdings.find(h => h.symbol === cmd);
  if (!holding) { console.log(`\n❌ No holding found for ${cmd}`); process.exit(1); }
  const result = paperSell({ symbol: cmd, qty: holding.qty, price: livePrice, note: 'Quick sell' });
  if (result.success) {
    console.log(`\n✅ PAPER SELL EXECUTED`);
    console.log(`   ${cmd} x${holding.qty} @ ₹${livePrice} | P&L: ${result.realizedPnl>=0?'+':''}₹${result.realizedPnl}`);
    console.log(`   Cash: ₹${result.cashRemaining}`);
  } else {
    console.log(`\n❌ ${result.error}`);
  }
}
