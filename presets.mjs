/**
 * PREDEFINED TRADE PRESETS — Execute standard strategies instantly
 *
 * Usage:
 *   node presets.mjs bounce TECHM        → oversold bounce trade
 *   node presets.mjs breakdown ICICIBANK → breakdown short/PE trade
 *   node presets.mjs momentum BEL        → momentum continuation
 *   node presets.mjs nifty-bounce        → NIFTY CE bounce trade
 *   node presets.mjs nifty-break         → NIFTY PE breakdown trade
 *   node presets.mjs nifty-straddle      → Both CE+PE (range play)
 *   node presets.mjs exit-all            → Close all paper positions
 *   node presets.mjs status              → Quick status of all presets
 */
import { GrowwClient } from './src/groww-client.js';
import { paperBuy, paperSell, paperBuyOption, paperSellOption, getPortfolio } from './src/paper-trade.js';
import { readFileSync, existsSync } from 'fs';

const market = new GrowwClient({ apiKey: '', totpSecret: '' });
const args   = process.argv.slice(2);
const preset = args[0]?.toLowerCase();
const symbol = args[1]?.toUpperCase();
const cache  = existsSync('./cache.json') ? JSON.parse(readFileSync('./cache.json','utf8')) : {};

// ── HELPERS ──────────────────────────────────────────────────────────────────
async function getLive(sym) {
  const q = await market.getLivePriceNSE(sym).catch(()=>null);
  return q ? parseFloat(q.priceInfo?.lastPrice) : null;
}
async function getNifty() {
  const d = await market._nseRequest('/equity-stockIndices?index=NIFTY%2050');
  return d?.data?.[0];
}
function getATR(sym) { return cache.stocks?.[sym]?.atr || 10; }

// ── PRESETS ──────────────────────────────────────────────────────────────────

// BOUNCE: RSI oversold + near support → buy dip
if (preset === 'bounce') {
  if (!symbol) { console.log('Usage: node presets.mjs bounce SYMBOL'); process.exit(1); }
  const live = await getLive(symbol);
  const atr  = getATR(symbol);
  const sl   = parseFloat((live - 1.5 * atr).toFixed(2));
  const t1   = parseFloat((live + 2.0 * (live - sl)).toFixed(2));
  const t2   = parseFloat((live + 4.0 * (live - sl)).toFixed(2));
  const qty  = Math.max(1, Math.floor(1000 / (live - sl)));

  console.log(`\n🎯 BOUNCE PRESET — ${symbol}`);
  console.log(`Strategy: Oversold bounce — buy at support, quick exit at T1`);
  console.log(`Entry: ₹${live} | SL: ₹${sl} (1.5×ATR) | T1: ₹${t1} | T2: ₹${t2}`);
  console.log(`Qty: ${qty} | Risk: ₹${((live-sl)*qty).toFixed(0)} | Hold: 1–3 days`);

  const r = paperBuy({ symbol, qty, price: live, productType:'CNC', note:`BOUNCE preset | SL:${sl} T1:${t1}` });
  if (r.success) console.log(`✅ BOUGHT ${symbol} x${qty} @ ₹${live} | Cash: ₹${r.cashRemaining}`);
  else console.log(`❌ ${r.error}`);
}

// MOMENTUM: trending stock, buy breakout continuation
else if (preset === 'momentum') {
  if (!symbol) { console.log('Usage: node presets.mjs momentum SYMBOL'); process.exit(1); }
  const live = await getLive(symbol);
  const atr  = getATR(symbol);
  const sl   = parseFloat((live - 2 * atr).toFixed(2));
  const t1   = parseFloat((live + 1.5 * (live - sl)).toFixed(2));
  const t2   = parseFloat((live + 3.0 * (live - sl)).toFixed(2));
  const qty  = Math.max(1, Math.floor(1000 / (live - sl)));

  console.log(`\n🚀 MOMENTUM PRESET — ${symbol}`);
  console.log(`Strategy: Trend continuation — ride the momentum with tight SL`);
  console.log(`Entry: ₹${live} | SL: ₹${sl} (2×ATR) | T1: ₹${t1} | T2: ₹${t2}`);
  console.log(`Qty: ${qty} | Risk: ₹${((live-sl)*qty).toFixed(0)} | Hold: intraday–2 days`);

  const r = paperBuy({ symbol, qty, price: live, note:`MOMENTUM preset | SL:${sl} T1:${t1}` });
  if (r.success) console.log(`✅ BOUGHT ${symbol} x${qty} @ ₹${live} | Cash: ₹${r.cashRemaining}`);
  else console.log(`❌ ${r.error}`);
}

// NIFTY BOUNCE: RSI oversold, buy ATM CE
else if (preset === 'nifty-bounce') {
  const n      = await getNifty();
  const price  = parseFloat(n?.lastPrice);
  const atm    = Math.round(price / 50) * 50;
  const strike = atm + 50;        // slightly OTM call
  const premium= 110;             // estimated
  const slPrem = Math.round(premium * 0.5);
  const tgtPrem= Math.round(premium * 1.6);

  console.log(`\n📈 NIFTY BOUNCE PRESET`);
  console.log(`Strategy: Buy ${strike} CE — expecting bounce from support`);
  console.log(`NIFTY Spot: ₹${price} | Strike: ${strike} CE | Premium: ~₹${premium}`);
  console.log(`SL: ₹${slPrem} (50% of premium) | Target: ₹${tgtPrem} (60% gain)`);
  console.log(`Max loss: ₹${premium*75} | Target profit: ₹${(tgtPrem-premium)*75}`);

  const r = paperBuyOption({ symbol:'NIFTY', strike, type:'CE', expiry:'27-Mar-2026', qty:75, premium, lots:1, lotSize:75, note:'NIFTY-BOUNCE preset' });
  if (r.success) console.log(`✅ BOUGHT NIFTY ${strike} CE @ ₹${premium} | Cash: ₹${r.cashRemaining}`);
  else console.log(`❌ ${r.error}`);
}

// NIFTY BREAKDOWN: bearish market, buy ATM PE
else if (preset === 'nifty-break') {
  const n      = await getNifty();
  const price  = parseFloat(n?.lastPrice);
  const atm    = Math.round(price / 50) * 50;
  const strike = atm;             // ATM put
  const premium= 155;
  const slPrem = Math.round(premium * 0.5);
  const tgtPrem= Math.round(premium * 1.6);

  console.log(`\n📉 NIFTY BREAKDOWN PRESET`);
  console.log(`Strategy: Buy ${strike} PE — expecting breakdown below support`);
  console.log(`NIFTY Spot: ₹${price} | Strike: ${strike} PE | Premium: ~₹${premium}`);
  console.log(`SL: ₹${slPrem} | Target: ₹${tgtPrem} | Watch: day low support`);
  console.log(`Max loss: ₹${premium*75} | Target profit: ₹${(tgtPrem-premium)*75}`);

  const r = paperBuyOption({ symbol:'NIFTY', strike, type:'PE', expiry:'27-Mar-2026', qty:75, premium, lots:1, lotSize:75, note:'NIFTY-BREAK preset' });
  if (r.success) console.log(`✅ BOUGHT NIFTY ${strike} PE @ ₹${premium} | Cash: ₹${r.cashRemaining}`);
  else console.log(`❌ ${r.error}`);
}

// NIFTY STRADDLE: uncertain market, buy both CE+PE
else if (preset === 'nifty-straddle') {
  const n      = await getNifty();
  const price  = parseFloat(n?.lastPrice);
  const atm    = Math.round(price / 50) * 50;
  const cePrem = 110;
  const pePrem = 155;
  const total  = (cePrem + pePrem) * 75;

  console.log(`\n⚡ NIFTY STRADDLE PRESET`);
  console.log(`Strategy: Buy both CE+PE — profit if NIFTY moves >2% either way`);
  console.log(`NIFTY: ₹${price} | CE: ${atm+50} @ ₹${cePrem} | PE: ${atm} @ ₹${pePrem}`);
  console.log(`Total premium: ₹${total} | Break-even move: ±${((cePrem+pePrem)/price*100).toFixed(1)}%`);

  const r1 = paperBuyOption({ symbol:'NIFTY', strike:atm+50, type:'CE', expiry:'27-Mar-2026', qty:75, premium:cePrem, lots:1, lotSize:75, note:'STRADDLE-CE' });
  const r2 = paperBuyOption({ symbol:'NIFTY', strike:atm,    type:'PE', expiry:'27-Mar-2026', qty:75, premium:pePrem, lots:1, lotSize:75, note:'STRADDLE-PE' });
  if (r1.success) console.log(`✅ CE: NIFTY ${atm+50} CE @ ₹${cePrem}`);
  if (r2.success) console.log(`✅ PE: NIFTY ${atm} PE @ ₹${pePrem} | Cash: ₹${r2.cashRemaining}`);
}

// EXIT ALL: close everything
else if (preset === 'exit-all') {
  const n      = await getNifty();
  const nPrice = parseFloat(n?.lastPrice);
  const p      = getPortfolio();
  console.log(`\n🔴 EXIT ALL POSITIONS`);

  // Close options first
  for (const h of p.holdings.filter(h=>h.type==='OPTION')) {
    const spotDiff  = nPrice - 24612;
    const nowPrem   = h.optType==='CE' ? Math.max(5, 110+0.42*spotDiff) : Math.max(5, 155+0.50*(-spotDiff));
    const r = paperSellOption({ symbol:'NIFTY', strike:h.strike, type:h.optType, expiry:h.expiry, currentPremium:parseFloat(nowPrem.toFixed(1)), note:'EXIT-ALL' });
    if (r.success) console.log(`✅ Closed NIFTY ${h.strike}${h.optType} @ ₹${nowPrem.toFixed(1)} | P&L: ${r.realizedPnl>=0?'+':''}₹${r.realizedPnl}`);
  }

  // Close equities
  for (const h of p.holdings.filter(h=>h.type!=='OPTION')) {
    const live = await getLive(h.symbol).catch(()=>parseFloat(h.ltp));
    const r = paperSell({ symbol:h.symbol, qty:h.qty, price:live||parseFloat(h.ltp), note:'EXIT-ALL' });
    if (r.success) console.log(`✅ Sold ${h.symbol} x${h.qty} @ ₹${live} | P&L: ${r.realizedPnl>=0?'+':''}₹${r.realizedPnl}`);
  }

  const final = getPortfolio();
  const net = parseFloat(final.realizedPnl);
  console.log(`\n📊 FINAL: Cash ₹${final.cash} | Realized P&L: ${net>=0?'+':''}₹${net}`);
}

// STATUS
else if (preset === 'status') {
  const p   = getPortfolio();
  const net = parseFloat(p.realizedPnl) + parseFloat(p.unrealizedPnl);
  console.log(`\n📊 STATUS @ ${new Date().toLocaleTimeString('en-IN')}`);
  console.log(`Open positions: ${p.holdings.length} | Net P&L: ${net>=0?'+':''}₹${net.toFixed(0)}`);
  p.holdings.forEach(h => {
    if (h.type==='OPTION') console.log(`  NIFTY ${h.strike}${h.optType} | Entry:₹${h.premium}`);
    else console.log(`  ${h.symbol} x${h.qty} @ ₹${h.avgPrice} | P&L:${h.unrealizedPnl}`);
  });
}

else {
  console.log(`\nAvailable presets:`);
  console.log(`  node presets.mjs bounce SYMBOL      — oversold bounce buy`);
  console.log(`  node presets.mjs momentum SYMBOL    — trend continuation buy`);
  console.log(`  node presets.mjs nifty-bounce       — buy NIFTY CE`);
  console.log(`  node presets.mjs nifty-break        — buy NIFTY PE`);
  console.log(`  node presets.mjs nifty-straddle     — buy CE+PE both`);
  console.log(`  node presets.mjs exit-all           — close everything`);
  console.log(`  node presets.mjs status             — open positions`);
}
