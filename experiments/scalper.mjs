import { GrowwClient } from '../src/groww-client.js';
import { paperBuyOption, paperSellOption, getPortfolio } from '../src/paper-trade.js';

const market = new GrowwClient({ apiKey: '', totpSecret: '' });
await market.warmUp(); // pre-warm NSE cookies + TLS connections

// ── CONFIG ──────────────────────────────────────────────────────
const SL_POINTS   = 5;    // exit if NIFTY moves 5 pts AGAINST trade
const TGT_POINTS  = 10;   // exit if NIFTY moves 10 pts IN FAVOR
const DELTA       = 0.40; // approx delta for near-ATM options
const LOT_SIZE    = 75;
const LOTS        = 1;
// ────────────────────────────────────────────────────────────────

async function getNifty() {
  const n50 = await market._nseRequest('/equity-stockIndices?index=NIFTY%2050');
  return n50.data[0].lastPrice;
}

function roundToStrike(nifty, dir) {
  // Round to nearest 50 for strike selection
  const base = Math.round(nifty / 50) * 50;
  return dir === 'PE' ? base : base;
}

async function runScalp(direction) {
  const entryNifty = await getNifty();
  const optType    = direction; // 'CE' or 'PE'
  const strike     = roundToStrike(entryNifty, optType);
  const entryPrem  = optType === 'PE' ? 80 : 80; // estimated near-ATM premium
  const time       = new Date().toLocaleTimeString('en-IN');

  // SL and target in NIFTY points
  const slNifty  = optType === 'PE' ? entryNifty + SL_POINTS  : entryNifty - SL_POINTS;
  const tgtNifty = optType === 'PE' ? entryNifty - TGT_POINTS : entryNifty + TGT_POINTS;

  // SL and target in premium
  const slPrem  = Math.max(5, entryPrem - (SL_POINTS  * DELTA));
  const tgtPrem = entryPrem + (TGT_POINTS * DELTA);

  const slPnl  = (slPrem  - entryPrem) * LOT_SIZE * LOTS;
  const tgtPnl = (tgtPrem - entryPrem) * LOT_SIZE * LOTS;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`🎯 SCALP TRADE — ${optType} | ${time}`);
  console.log(`${'='.repeat(50)}`);
  console.log(`NIFTY Entry : ${entryNifty}`);
  console.log(`Strike      : ${strike}${optType}`);
  console.log(`Premium     : ₹${entryPrem}`);
  console.log(`SL          : NIFTY ${optType==='PE'?'above':'below'} ${slNifty} → prem ₹${slPrem.toFixed(0)} → Loss ₹${slPnl.toFixed(0)}`);
  console.log(`TARGET      : NIFTY ${optType==='PE'?'below':'above'} ${tgtNifty} → prem ₹${tgtPrem.toFixed(0)} → Profit ₹${tgtPnl.toFixed(0)}`);
  console.log(`R:R         : 1:${Math.abs(tgtPnl/slPnl).toFixed(1)}`);

  // Execute buy
  paperBuyOption({
    symbol: 'NIFTY', strike, type: optType,
    expiry: '13-Mar-2026', lots: LOTS, lotSize: LOT_SIZE,
    premium: entryPrem,
    note: `Scalp|SL:${slNifty}|Tgt:${tgtNifty}`
  });

  console.log(`\n✅ ENTERED. Monitoring every 5s...`);
  console.log(`${'─'.repeat(50)}`);

  // Monitor loop
  let exitReason = null;
  let exitNifty  = null;
  let exitPrem   = null;

  while (!exitReason) {
    await new Promise(r => setTimeout(r, 1000)); // check every 1s
    const nifty = await getNifty();
    const move  = optType === 'PE' ? entryNifty - nifty : nifty - entryNifty;
    const curPrem = Math.max(5, entryPrem + (move * DELTA));
    const curPnl  = (curPrem - entryPrem) * LOT_SIZE * LOTS;
    const t = new Date().toLocaleTimeString('en-IN');
    const arrow = optType === 'PE'
      ? (nifty < entryNifty ? '✅↓' : '⚠️↑')
      : (nifty > entryNifty ? '✅↑' : '⚠️↓');

    console.log(`[${t}] NIFTY:${nifty} ${arrow} | Prem:₹${curPrem.toFixed(0)} | PnL:₹${curPnl.toFixed(0)}`);

    // Check SL
    if (optType === 'PE' && nifty >= slNifty) {
      exitReason = '🔴 STOP LOSS HIT'; exitNifty = nifty; exitPrem = slPrem;
    } else if (optType === 'CE' && nifty <= slNifty) {
      exitReason = '🔴 STOP LOSS HIT'; exitNifty = nifty; exitPrem = slPrem;
    }
    // Check Target
    if (optType === 'PE' && nifty <= tgtNifty) {
      exitReason = '🟢 TARGET HIT'; exitNifty = nifty; exitPrem = tgtPrem;
    } else if (optType === 'CE' && nifty >= tgtNifty) {
      exitReason = '🟢 TARGET HIT'; exitNifty = nifty; exitPrem = tgtPrem;
    }
  }

  // Exit
  const finalPnl = (exitPrem - entryPrem) * LOT_SIZE * LOTS;
  paperSellOption({
    symbol: 'NIFTY', strike, type: optType,
    expiry: '13-Mar-2026', currentPremium: exitPrem,
    note: exitReason
  });

  const p = getPortfolio();
  console.log(`\n${'='.repeat(50)}`);
  console.log(`${exitReason}`);
  console.log(`Exit NIFTY  : ${exitNifty}`);
  console.log(`Exit Premium: ₹${exitPrem.toFixed(0)}`);
  console.log(`Trade P&L   : ₹${finalPnl.toFixed(0)}`);
  console.log(`Portfolio   : ₹${p.portfolioValue} | Total PnL: ₹${p.realizedPnl}`);
  console.log(`${'='.repeat(50)}`);
}

// ── PREDICTION ──────────────────────────────────────────────────
async function predict() {
  const [n50, nBank] = await Promise.all([
    market._nseRequest('/equity-stockIndices?index=NIFTY%2050'),
    market._nseRequest('/equity-stockIndices?index=NIFTY%20BANK'),
  ]);
  const n = n50.data[0];
  const b = nBank.data[0];
  const distFromHigh = n.dayHigh - n.lastPrice;
  const distFromLow  = n.lastPrice - n.dayLow;
  const range        = n.dayHigh - n.dayLow;
  const pos          = ((n.lastPrice - n.dayLow) / range * 100).toFixed(0);

  console.log(`\nPREDICTION INPUTS:`);
  console.log(`NIFTY: ${n.lastPrice} | ${n.pChange}% | Pos in range: ${pos}%`);
  console.log(`BANKNIFTY: ${b.lastPrice} | ${b.pChange}%`);
  console.log(`From High: -${distFromHigh.toFixed(0)} | From Low: +${distFromLow.toFixed(0)}`);

  // Simple logic
  if (distFromHigh < 30) {
    console.log(`\n📊 BIAS: SHORT → Buy PE (near day high, expect rejection)`);
    return 'PE';
  } else if (distFromLow < 30) {
    console.log(`\n📊 BIAS: LONG → Buy CE (near day low, expect bounce)`);
    return 'CE';
  } else if (n.pChange < -2 && pos > 60) {
    console.log(`\n📊 BIAS: SHORT → Buy PE (strong down trend, price high in range)`);
    return 'PE';
  } else if (n.pChange < -2 && pos < 40) {
    console.log(`\n📊 BIAS: LONG → Buy CE (oversold in range, bounce likely)`);
    return 'CE';
  } else {
    console.log(`\n📊 BIAS: NEUTRAL → Defaulting to PE (bearish day)`);
    return 'PE';
  }
}

// ── MAIN ────────────────────────────────────────────────────────
console.log('🤖 NIFTY SCALPER — SL:5pts | Target:10pts');
console.log('Auto exits on SL or target. Checking every 5 seconds.\n');

const direction = await predict();
await runScalp(direction);
