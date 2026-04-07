function erf(x) {
  const t = 1/(1+0.3275911*Math.abs(x));
  const p = t*(0.254829592+t*(-0.284496736+t*(1.421413741+t*(-1.453152027+t*1.061405429))));
  const result = 1 - p*Math.exp(-x*x);
  return x >= 0 ? result : -result;
}
const Ncdf = x => (1 + erf(x/Math.sqrt(2)))/2;

function bsPrice(S, K, T, rr, iv, type) {
  const d1 = (Math.log(S/K) + (rr + iv*iv/2)*T) / (iv*Math.sqrt(T));
  const d2 = d1 - iv*Math.sqrt(T);
  return type === 'call'
    ? S*Ncdf(d1) - K*Math.exp(-rr*T)*Ncdf(d2)
    : K*Math.exp(-rr*T)*Ncdf(-d2) - S*Ncdf(-d1);
}

// Fetch live NIFTY
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const res = await fetch(`${YAHOO}/%5ENSEI?interval=5m&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
const data = await res.json();
const rr = data.chart.result[0];
const qq = rr.indicators.quote[0];
const candles = rr.timestamp.map((t,i) => ({
  time: new Date(t*1000).toISOString().slice(11,16),
  open: qq.open[i], high: qq.high[i], low: qq.low[i], close: qq.close[i]
})).filter(c => c.close);

const cur     = candles.at(-1).close;
const dayLow  = Math.min(...candles.map(c => c.low));
const dayHigh = Math.max(...candles.map(c => c.high));

// Trade params
const SELL_K  = 23200;
const BUY_K   = 22900;
const e_sell  = 57.36;
const e_buy   = 27.54;
const e_cred  = e_sell - e_buy;
const LOT     = 75;
const CHGS    = 11.13;
const MAX_P   = e_cred * LOT - CHGS;
const MAX_L   = (300 - e_cred) * LOT + CHGS;
const T_left  = 17/365;
const IV      = 0.22;
const RF      = 0.065;

// Current P&L
const s_cur = bsPrice(cur, SELL_K, T_left, RF, IV, 'put');
const b_cur = bsPrice(cur, BUY_K,  T_left, RF, IV, 'put');
const cur_pnl = ((e_sell - s_cur) + (b_cur - e_buy)) * LOT - CHGS;

console.log('════════════════════════════════════════════════════════');
console.log('  STOP LOSS & EXIT PLAN  |  BULL PUT SPREAD');
console.log('  NIFTY 23200PE/22900PE  |  Entry: 13 Mar 2026');
console.log('════════════════════════════════════════════════════════');
console.log('');
console.log(`  NIFTY Now  : ${cur.toFixed(0)}  (Day H:${dayHigh.toFixed(0)} L:${dayLow.toFixed(0)})`);
console.log(`  Entry was  : 23,366  |  Moved: ${(cur-23366).toFixed(0)} pts`);
console.log(`  Current P&L: ${cur_pnl >= 0 ? '+' : ''}Rs.${cur_pnl.toFixed(0)}`);
console.log(`  Max Profit : Rs.${MAX_P.toFixed(0)}`);
console.log(`  Max Loss   : Rs.${MAX_L.toFixed(0)}`);
console.log('');
console.log('════════════════════════════════════════════════════════');
console.log('  EXIT LEVELS');
console.log('════════════════════════════════════════════════════════');
console.log('');
console.log('  PROFIT EXITS');
console.log('  ─────────────────────────────────────────────────────');

// Find NIFTY levels for 30%, 50%, 75%, max profit
const targets = [
  { pct: 30, label: 'Conservative (30%)' },
  { pct: 50, label: 'RECOMMENDED (50%)' },
  { pct: 75, label: 'Aggressive (75%)' },
  { pct: 100, label: 'Max Profit' },
];
for (const tgt of targets) {
  const targetPnl = MAX_P * tgt.pct / 100;
  for (let nf = 24000; nf >= 22500; nf -= 5) {
    const s = bsPrice(nf, SELL_K, T_left, RF, IV, 'put');
    const b = bsPrice(nf, BUY_K,  T_left, RF, IV, 'put');
    const pnl = ((e_sell - s) + (b - e_buy)) * LOT - CHGS;
    if (pnl >= targetPnl) {
      const gap = nf - cur;
      const status = nf <= cur ? 'ALREADY REACHED' : `NIFTY needs +${gap.toFixed(0)} pts`;
      console.log(`  ${tgt.label.padEnd(22)} Rs.${targetPnl.toFixed(0).padStart(5)} → NIFTY >= ${nf}  [${status}]`);
      break;
    }
  }
}

console.log('');
console.log('  ALSO EXIT ON TIME (regardless of price)');
console.log('  ─────────────────────────────────────────────────────');
console.log('  3 days before expiry  → Theta risk spikes — MUST EXIT');
console.log('  Expiry day            → Close spread by 3:15 PM');

console.log('');
console.log('  STOP LOSS EXITS');
console.log('  ─────────────────────────────────────────────────────');

const slLevels = [
  { nf: 23200, label: 'PRIMARY SL (spread sell strike hit)' },
  { nf: 23100, label: 'Partial Loss (price near 23,100)' },
  { nf: 23000, label: 'Heavy Loss zone' },
  { nf: 22900, label: 'MAX LOSS (buy strike hit)' },
];
for (const sl of slLevels) {
  const s = bsPrice(sl.nf, SELL_K, T_left, RF, IV, 'put');
  const b = bsPrice(sl.nf, BUY_K,  T_left, RF, IV, 'put');
  const pnl = ((e_sell - s) + (b - e_buy)) * LOT - CHGS;
  const gap = sl.nf - cur;
  console.log(`  NIFTY ${sl.nf}  →  P&L: Rs.${pnl.toFixed(0).padStart(7)}  Gap: ${gap.toFixed(0).padStart(5)} pts  [${sl.label}]`);
}

console.log('');
console.log('════════════════════════════════════════════════════════');
console.log('  STOP LOSS RULES  (what to watch)');
console.log('════════════════════════════════════════════════════════');
console.log('');
console.log('  RULE 1 — PRICE SL (Primary)');
console.log(`  ► If NIFTY closes any 15-min candle below 23,200`);
console.log(`    → EXIT IMMEDIATELY both legs`);
console.log(`    → That is ${(cur - 23200).toFixed(0)} pts from current price`);
console.log('');
console.log('  RULE 2 — PREMIUM SL (for spread value)');
console.log(`  ► If spread debit crosses Rs.${(MAX_L * 0.5).toFixed(0)} (50% of max loss)`);
console.log(`    → This means spread bought at Rs.${e_cred.toFixed(1)} is now costing Rs.${(e_cred + (300-e_cred)*0.5).toFixed(1)}`);
console.log(`    → EXIT — don't let it go to max loss`);
console.log('');
console.log('  RULE 3 — NEWS SL');
console.log('  ► If Iran confirms Hormuz blockade OR Brent > $110');
console.log('    → Exit immediately — news risk overrides technicals');
console.log('');
console.log('  RULE 4 — TIME SL');
console.log('  ► Exit 3 days before expiry (to avoid gamma risk)');
console.log('  ► Never hold options spread to expiry day');
console.log('');
console.log('════════════════════════════════════════════════════════');
console.log('  DECISION TABLE RIGHT NOW');
console.log('════════════════════════════════════════════════════════');
console.log('');
console.log('  NIFTY Level    Action');
console.log('  ─────────────────────────────────────────────────────');

const decisions = [
  [23600, '✅ HOLD — consider booking 50% profit'],
  [23500, '✅ HOLD — nearing 50% target'],
  [23400, '✅ HOLD — still safe, 227 pts above SL'],
  [23327, '✅ HOLD — current price, 127 pts above SL'],
  [23250, '⚠️  ALERT — only 50 pts above SL, monitor closely'],
  [23200, '🚨 SL TRIGGERED — EXIT both legs NOW'],
  [23100, '🔴 LATE EXIT — damage control, exit immediately'],
  [22900, '❌ MAX LOSS — exit, accept Rs.' + MAX_L.toFixed(0) + ' loss'],
];
decisions.forEach(([nf, action]) => {
  const marker = nf === Math.round(cur/50)*50 ? ' ← YOU ARE HERE' : '';
  console.log(`  ${nf}             ${action}${marker}`);
});

console.log('');
console.log('════════════════════════════════════════════════════════');
console.log('  QUICK SUMMARY');
console.log('════════════════════════════════════════════════════════');
console.log(`  Entry credit    : Rs.${(e_cred*LOT).toFixed(0)}  (Rs.${e_cred.toFixed(2)}/share)`);
console.log(`  Current P&L     : ${cur_pnl>=0?'+':''}Rs.${cur_pnl.toFixed(0)}`);
console.log(`  BOOK PROFIT AT  : Rs.${(MAX_P*0.5).toFixed(0)}  (when NIFTY > ~23,400)`);
console.log(`  STOP LOSS AT    : NIFTY 23,200  (Rs.${(MAX_L*0.5).toFixed(0)} max SL)`);
console.log(`  SL distance now : ${(cur - 23200).toFixed(0)} pts  |  Target distance: minimal`);
console.log('');
