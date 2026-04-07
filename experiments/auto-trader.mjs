/**
 * AUTO TRADER — NIFTY Options Scalper
 * Run: node auto-trader.mjs
 * Live dashboard — no need to ask for updates!
 */

import { GrowwClient } from '../src/groww-client.js';
import { paperBuyOption, paperSellOption, getPortfolio } from '../src/paper-trade.js';

// ══════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════
const CONFIG = {
  SL_POINTS       : 5,
  TGT_POINTS      : 10,
  MIN_SCORE       : 4,
  SCAN_INTERVAL   : 3,
  MONITOR_INTERVAL: 1,
  COOLDOWN        : 45,
  MAX_TRADES      : 20,
  LOT_SIZE        : 75,
  LOTS            : 1,
  DELTA           : 0.40,
  ENTRY_PREMIUM   : 80,
  EXPIRY          : '13-Mar-2026',
  // Broker charges per leg (buy OR sell)
  BROKERAGE       : 20,          // ₹20 flat per order
  GST_RATE        : 0.18,        // 18% GST on brokerage
};

// ₹20 + 18% GST = ₹23.60 per leg × 2 legs = ₹47.20 per round trip
const CHARGES_PER_TRADE = +(CONFIG.BROKERAGE * (1 + CONFIG.GST_RATE) * 2).toFixed(2); // ₹47.20

const market = new GrowwClient({ apiKey: '', totpSecret: '' });
await market.warmUp(); // pre-warm NSE cookies + TLS connections
const sleep  = ms => new Promise(r => setTimeout(r, ms));
const ts     = () => new Date().toLocaleTimeString('en-IN');
const W = process.stdout.columns || 60;
const HR  = (c='─') => c.repeat(W);

// ── CLEAR SCREEN & DRAW DASHBOARD ──────────────────────────
function drawDashboard({ nifty, pChange, bnPChange, posInRange, fromHigh, fromLow,
                          tradeNum, dir, entryNifty, slNifty, tgtNifty,
                          curPrem, pnl, wins, losses, totalPnl, portfolio,
                          state, signal, cooldownLeft }) {
  console.clear();
  const now = new Date().toLocaleTimeString('en-IN');

  // Header
  console.log(HR('═'));
  console.log(`  🤖 NIFTY AUTO TRADER          ${now}`);
  console.log(`  SL: ${CONFIG.SL_POINTS}pts | Target: ${CONFIG.TGT_POINTS}pts | Min Score: ${CONFIG.MIN_SCORE}/8`);
  console.log(HR('═'));

  // Market
  const nDir = pChange < 0 ? '🔴' : '🟢';
  const bDir = bnPChange < 0 ? '🔴' : '🟢';
  console.log(`  MARKET`);
  console.log(`  ${nDir} NIFTY     : ${nifty}   ${pChange.toFixed(2)}%`);
  console.log(`  ${bDir} BANKNIFTY : ${bnPChange.toFixed(2)}%`);
  console.log(`  Day Range  : ${posInRange.toFixed(0)}% | ↑${fromHigh.toFixed(0)} to High | ↓${fromLow.toFixed(0)} to Low`);
  console.log(HR());

  // Current trade
  if (state === 'TRADING') {
    const pnlIcon = pnl >= 0 ? '🟢' : '🔴';
    const arrow   = dir === 'PE' ? (nifty < entryNifty ? '✅ Falling' : '⚠️  Rising')
                                 : (nifty > entryNifty ? '✅ Rising'  : '⚠️  Falling');
    console.log(`  TRADE #${tradeNum} — ${dir} | ${arrow}`);
    console.log(`  Entry   : ${entryNifty}   Premium: ₹${CONFIG.ENTRY_PREMIUM}`);
    console.log(`  Current : ${nifty}        Premium: ₹${curPrem.toFixed(0)}`);
    console.log(`  SL      : ${slNifty}  ${nifty > slNifty && dir==='PE' ? '⚠️  DANGER' : ''}`);
    console.log(`  Target  : ${tgtNifty}`);
    console.log(`  ${pnlIcon} Live P&L : ₹${pnl.toFixed(0)}`);
  } else if (state === 'SCANNING') {
    console.log(`  SCANNING — looking for score ≥ ${CONFIG.MIN_SCORE}/8`);
    if (signal) {
      console.log(`  Current  : ${signal.dir} ${signal.score}/8 — ${signal.score >= CONFIG.MIN_SCORE ? '🔥 ENTERING!' : 'waiting...'}`);
      console.log(`  Signals  : ${signal.reasons.slice(0,2).join(' | ')}`);
    }
  } else if (state === 'COOLDOWN') {
    console.log(`  ⏳ COOLDOWN — next scan in ${cooldownLeft}s`);
  }

  console.log(HR());

  // Session stats
  const total = wins + losses;
  const wr    = total ? ((wins / total) * 100).toFixed(0) : 0;
  const pnlIcon = totalPnl >= 0 ? '🟢' : '🔴';
  console.log(`  SESSION STATS`);
  console.log(`  Trades   : ${total}  |  W: ${wins}  L: ${losses}  |  Win Rate: ${wr}%`);
  console.log(`  Charges  : -₹${(total * CHARGES_PER_TRADE).toFixed(2)}  (₹47.20/trade)`);
  console.log(`  ${pnlIcon} Net P&L  : ₹${totalPnl.toFixed(0)}`);
  console.log(`  Portfolio: ₹${portfolio}`);
  console.log(HR('═'));
  console.log(`  Press Ctrl+C to stop`);
}

// ── MARKET DATA ─────────────────────────────────────────────
async function getMarketData() {
  const [n50, nBank] = await Promise.all([
    market._nseRequest('/equity-stockIndices?index=NIFTY%2050'),
    market._nseRequest('/equity-stockIndices?index=NIFTY%20BANK'),
  ]);
  const n = n50.data[0], b = nBank.data[0];
  return {
    nifty      : n.lastPrice,
    pChange    : n.pChange,
    dayHigh    : n.dayHigh,
    dayLow     : n.dayLow,
    bnPChange  : b.pChange,
    range      : n.dayHigh - n.dayLow,
    posInRange : ((n.lastPrice - n.dayLow) / (n.dayHigh - n.dayLow) * 100),
    fromHigh   : n.dayHigh - n.lastPrice,
    fromLow    : n.lastPrice - n.dayLow,
  };
}

// ── SIGNAL SCORE ─────────────────────────────────────────────
function scoreSignal(d) {
  let pe = 0, ce = 0, reasons = [];

  if (d.pChange < -1.5)       { pe += 2; reasons.push(`Bearish ${d.pChange.toFixed(1)}% →PE+2`); }
  else if (d.pChange > 1.5)   { ce += 2; reasons.push(`Bullish +${d.pChange.toFixed(1)}% →CE+2`); }
  else if (d.pChange < -0.5)  { pe += 1; reasons.push(`Mild bear →PE+1`); }
  else if (d.pChange > 0.5)   { ce += 1; reasons.push(`Mild bull →CE+1`); }

  if (d.posInRange > 75)      { pe += 2; reasons.push(`High in range ${d.posInRange.toFixed(0)}% →PE+2`); }
  else if (d.posInRange < 25) { ce += 2; reasons.push(`Low in range ${d.posInRange.toFixed(0)}% →CE+2`); }
  else if (d.posInRange > 60) { pe += 1; reasons.push(`Upper-mid →PE+1`); }
  else if (d.posInRange < 40) { ce += 1; reasons.push(`Lower-mid →CE+1`); }

  if (d.fromHigh < 30)        { pe += 2; reasons.push(`Near HIGH ${d.fromHigh.toFixed(0)}pts →PE+2`); }
  if (d.fromLow < 30)         { ce += 2; reasons.push(`Near LOW ${d.fromLow.toFixed(0)}pts →CE+2`); }

  if (d.bnPChange < -2)       { pe += 1; reasons.push(`BankNifty ${d.bnPChange.toFixed(1)}% →PE+1`); }
  else if (d.bnPChange > 2)   { ce += 1; reasons.push(`BankNifty +${d.bnPChange.toFixed(1)}% →CE+1`); }

  const dir   = pe >= ce ? 'PE' : 'CE';
  const score = pe >= ce ? pe : ce;
  return { dir, score, peScore: pe, ceScore: ce, reasons };
}

// ── MAIN ─────────────────────────────────────────────────────
async function main() {
  let wins = 0, losses = 0, totalPnl = 0, totalCharges = 0, tradeCount = 0;

  while (tradeCount < CONFIG.MAX_TRADES) {
    // Market hours check
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    if (h < 9 || (h === 9 && m < 15) || h > 15 || (h === 15 && m >= 20)) {
      console.clear();
      console.log('Market closed. Auto trader waiting...');
      await sleep(60000);
      continue;
    }

    try {
      // ── SCAN LOOP ──────────────────────────────────────────
      let signal = null, d = null;
      while (true) {
        d = await getMarketData();
        signal = scoreSignal(d);
        const p = getPortfolio();
        drawDashboard({ ...d, tradeNum: tradeCount+1, dir: signal.dir,
          entryNifty: null, slNifty: null, tgtNifty: null,
          curPrem: null, pnl: null,
          wins, losses, totalPnl, portfolio: p.portfolioValue,
          state: 'SCANNING', signal });
        if (signal.score >= CONFIG.MIN_SCORE) break;
        await sleep(CONFIG.SCAN_INTERVAL * 1000);
      }

      // ── ENTER TRADE ────────────────────────────────────────
      tradeCount++;
      const { dir } = signal;
      const entryNifty = d.nifty;
      const strike     = Math.round(entryNifty / 50) * 50;
      const slNifty    = dir === 'PE' ? entryNifty + CONFIG.SL_POINTS  : entryNifty - CONFIG.SL_POINTS;
      const tgtNifty   = dir === 'PE' ? entryNifty - CONFIG.TGT_POINTS : entryNifty + CONFIG.TGT_POINTS;
      const slPrem     = Math.max(5, CONFIG.ENTRY_PREMIUM - CONFIG.SL_POINTS  * CONFIG.DELTA);
      const tgtPrem    = CONFIG.ENTRY_PREMIUM + CONFIG.TGT_POINTS * CONFIG.DELTA;

      paperBuyOption({
        symbol: 'NIFTY', strike, type: dir, expiry: CONFIG.EXPIRY,
        lots: CONFIG.LOTS, lotSize: CONFIG.LOT_SIZE, premium: CONFIG.ENTRY_PREMIUM,
        note: `AutoTrade#${tradeCount}|SL:${slNifty}|Tgt:${tgtNifty}`
      });

      // ── MONITOR LOOP ───────────────────────────────────────
      let exitResult = null;
      while (!exitResult) {
        await sleep(CONFIG.MONITOR_INTERVAL * 1000);
        const [live, nBank] = await Promise.all([
          market._nseRequest('/equity-stockIndices?index=NIFTY%2050'),
          market._nseRequest('/equity-stockIndices?index=NIFTY%20BANK'),
        ]);
        const nifty = live.data[0].lastPrice;
        const move  = dir === 'PE' ? entryNifty - nifty : nifty - entryNifty;
        const curPrem = Math.max(5, CONFIG.ENTRY_PREMIUM + move * CONFIG.DELTA);
        const pnl     = (curPrem - CONFIG.ENTRY_PREMIUM) * CONFIG.LOT_SIZE * CONFIG.LOTS;
        const p       = getPortfolio();

        drawDashboard({
          nifty, pChange: live.data[0].pChange,
          bnPChange: nBank.data[0].pChange,
          posInRange: ((nifty - live.data[0].dayLow) / (live.data[0].dayHigh - live.data[0].dayLow) * 100),
          fromHigh: live.data[0].dayHigh - nifty,
          fromLow: nifty - live.data[0].dayLow,
          tradeNum: tradeCount, dir, entryNifty, slNifty, tgtNifty,
          curPrem, pnl,
          wins, losses, totalPnl, portfolio: p.portfolioValue,
          state: 'TRADING', signal: null
        });

        const slHit  = dir === 'PE' ? nifty >= slNifty  : nifty <= slNifty;
        const tgtHit = dir === 'PE' ? nifty <= tgtNifty : nifty >= tgtNifty;
        if (slHit)  exitResult = { reason: '🔴 STOP LOSS', exitPrem: slPrem,  exitNifty: nifty };
        if (tgtHit) exitResult = { reason: '🟢 TARGET HIT', exitPrem: tgtPrem, exitNifty: nifty };
      }

      // ── EXIT ───────────────────────────────────────────────
      const grossPnl  = (exitResult.exitPrem - CONFIG.ENTRY_PREMIUM) * CONFIG.LOT_SIZE * CONFIG.LOTS;
      const netPnl    = grossPnl - CHARGES_PER_TRADE;
      paperSellOption({
        symbol: 'NIFTY', strike, type: dir, expiry: CONFIG.EXPIRY,
        currentPremium: exitResult.exitPrem, note: exitResult.reason
      });
      totalPnl += netPnl;
      totalCharges += CHARGES_PER_TRADE;
      if (netPnl > 0) wins++; else losses++;

      // Show result briefly
      const p = getPortfolio();
      console.clear();
      console.log(HR('═'));
      console.log(`  ${exitResult.reason}`);
      console.log(`  Trade #${tradeCount} | ${dir} | Exit NIFTY: ${exitResult.exitNifty}`);
      console.log(`  Gross P&L  : ₹${grossPnl.toFixed(0)}`);
      console.log(`  Charges    : -₹${CHARGES_PER_TRADE} (₹20×2 + 18% GST)`);
      console.log(`  Net P&L    : ₹${netPnl.toFixed(2)}`);
      console.log(`  Session    : W:${wins} L:${losses} | Net:₹${totalPnl.toFixed(0)}`);
      console.log(`  Portfolio  : ₹${p.portfolioValue}`);
      console.log(HR('═'));

      // ── COOLDOWN ───────────────────────────────────────────
      for (let i = CONFIG.COOLDOWN; i > 0; i -= 5) {
        const p2 = getPortfolio();
        drawDashboard({ nifty: exitResult.exitNifty, pChange: 0, bnPChange: 0,
          posInRange: 0, fromHigh: 0, fromLow: 0,
          tradeNum: tradeCount+1, dir: null, entryNifty: null,
          slNifty: null, tgtNifty: null, curPrem: null, pnl: null,
          wins, losses, totalPnl, portfolio: p2.portfolioValue,
          state: 'COOLDOWN', signal: null, cooldownLeft: i });
        await sleep(5000);
      }

    } catch (e) {
      console.error(`Error: ${e.message} — retrying in 10s`);
      await sleep(10000);
    }
  }

  // Final report
  const p = getPortfolio();
  console.clear();
  console.log(HR('═'));
  console.log('  📈 FINAL SESSION REPORT');
  console.log(HR());
  console.log(`  Trades    : ${wins+losses} | W: ${wins} | L: ${losses} | WinRate: ${((wins/(wins+losses||1))*100).toFixed(0)}%`);
  console.log(`  Brokerage : -₹${totalCharges.toFixed(2)}  (₹20 + 18% GST per leg × 2)`);
  console.log(`  Net P&L   : ₹${totalPnl.toFixed(2)}`);
  console.log(`  Portfolio : ₹${p.portfolioValue}`);
  console.log(HR('═'));
}

main().catch(console.error);
