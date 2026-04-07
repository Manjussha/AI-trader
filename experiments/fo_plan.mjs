import { blackScholes } from '../src/greeks.js';

const NIFTY  = 23366;
const BNIFTY = 54062;
const IV_N   = 0.22;
const IV_BN  = 0.26;
const r      = 0.065;
const LOT_N  = 75;
const LOT_BN = 30;
const CAPITAL = 100000;
const T_weekly  = 7/365;
const T_monthly = 18/365;

const bs = (S, K, T, iv, type) => {
  const g = blackScholes(S, K, T, r, iv, type);
  return { p: Math.abs(parseFloat(g.premium)), d: parseFloat(g.delta), th: parseFloat(g.theta), v: parseFloat(g.vega) };
};

const ch = (premium, qty, side) => {
  const tv = premium * qty;
  const b  = Math.min(20, tv * 0.0005);
  const stt = side === 'sell' ? tv * 0.000625 : 0;
  const exc = tv * 0.00053;
  const gst = (b + exc) * 0.18;
  const stamp = side === 'buy' ? tv * 0.00003 : 0;
  return b + stt + exc + gst + stamp;
};

// TRADE 1: Bull Put Spread NIFTY
const t1s = bs(NIFTY, 23200, T_monthly, IV_N, 'put');
const t1b = bs(NIFTY, 22900, T_monthly, IV_N, 'put');
const t1cr = t1s.p - t1b.p;
const t1c  = ch(t1s.p, LOT_N, 'sell') + ch(t1b.p, LOT_N, 'buy');
const t1mp = t1cr * LOT_N - t1c;
const t1ml = (300 - t1cr) * LOT_N + t1c;
const t1mg = (300 - t1cr) * LOT_N;

// TRADE 2: Bear Call Spread NIFTY
const t2s = bs(NIFTY, 23800, T_monthly, IV_N, 'call');
const t2b = bs(NIFTY, 24100, T_monthly, IV_N, 'call');
const t2cr = t2s.p - t2b.p;
const t2c  = ch(t2s.p, LOT_N, 'sell') + ch(t2b.p, LOT_N, 'buy');
const t2mp = t2cr * LOT_N - t2c;
const t2ml = (300 - t2cr) * LOT_N + t2c;
const t2mg = (300 - t2cr) * LOT_N;

// TRADE 3: Iron Condor NIFTY
const ic1 = bs(NIFTY, 23000, T_monthly, IV_N, 'put');
const ic2 = bs(NIFTY, 22700, T_monthly, IV_N, 'put');
const ic3 = bs(NIFTY, 24000, T_monthly, IV_N, 'call');
const ic4 = bs(NIFTY, 24300, T_monthly, IV_N, 'call');
const ic_cr = (ic1.p - ic2.p) + (ic3.p - ic4.p);
const ic_c  = ch(ic1.p,LOT_N,'sell') + ch(ic2.p,LOT_N,'buy') + ch(ic3.p,LOT_N,'sell') + ch(ic4.p,LOT_N,'buy');
const ic_mp = ic_cr * LOT_N - ic_c;
const ic_ml = (300 - ic_cr) * LOT_N + ic_c;
const ic_mg = (300 - ic_cr) * LOT_N;

// TRADE 4: Bull Put Spread BANKNIFTY
const b1s = bs(BNIFTY, 53500, T_monthly, IV_BN, 'put');
const b1b = bs(BNIFTY, 52500, T_monthly, IV_BN, 'put');
const b1cr = b1s.p - b1b.p;
const b1c  = ch(b1s.p, LOT_BN, 'sell') + ch(b1b.p, LOT_BN, 'buy');
const b1mp = b1cr * LOT_BN - b1c;
const b1ml = (1000 - b1cr) * LOT_BN + b1c;
const b1mg = (1000 - b1cr) * LOT_BN;

// TRADE 5: Long Put NIFTY weekly
const t5  = bs(NIFTY, 23100, T_weekly, IV_N, 'put');
const t5c = ch(t5.p, LOT_N, 'buy');
const t5cost = t5.p * LOT_N + t5c;

console.log('=================================================================');
console.log('   F&O COMPLETE PLAN  |  Rs.1L CAPITAL  |  13 MAR 2026');
console.log('   NIFTY: 23,366  |  BANKNIFTY: 54,062  |  VIX: 21.79');
console.log('=================================================================');

console.log('\n--- TRADE 1 --- BULL PUT SPREAD  NIFTY Monthly  [ACTIVE NOW]');
console.log('    Bias: NIFTY will NOT fall below 23,200 in 18 days');
console.log(`    Sell 23200PE @ Rs.${t1s.p.toFixed(1)}  |  Buy 22900PE @ Rs.${t1b.p.toFixed(1)}`);
console.log(`    Net Credit : Rs.${t1mp.toFixed(0)}  |  Max Loss: Rs.${t1ml.toFixed(0)}  |  Margin: Rs.${t1mg.toFixed(0)}`);
console.log(`    Breakeven  : ${(23200 - t1cr).toFixed(0)}  (buffer: ${(NIFTY - (23200-t1cr)).toFixed(0)} pts from spot)`);
console.log(`    Target     : Rs.${(t1mp * 0.5).toFixed(0)} (50% profit)`);
console.log(`    Stop       : Exit if NIFTY 15-min candle closes below 23,200`);

console.log('\n--- TRADE 2 --- BEAR CALL SPREAD  NIFTY Monthly  [ENTER ON BOUNCE]');
console.log('    Bias: Bounce will stall at 23,700-24,000 resistance');
console.log(`    Sell 23800CE @ Rs.${t2s.p.toFixed(1)}  |  Buy 24100CE @ Rs.${t2b.p.toFixed(1)}`);
console.log(`    Net Credit : Rs.${t2mp.toFixed(0)}  |  Max Loss: Rs.${t2ml.toFixed(0)}  |  Margin: Rs.${t2mg.toFixed(0)}`);
console.log(`    Breakeven  : ${(23800 + t2cr).toFixed(0)}`);
console.log(`    Enter when : NIFTY bounces to 23,600-23,700 zone`);
console.log(`    Stop       : NIFTY daily close above 23,900`);

console.log('\n--- TRADE 3 --- IRON CONDOR  NIFTY Monthly  [ENTER TOMORROW IF STABLE]');
console.log('    Bias: NIFTY ranges 23,000 to 24,000 for 18 days');
console.log(`    PUT  side: Sell 23000PE Rs.${ic1.p.toFixed(1)} / Buy 22700PE Rs.${ic2.p.toFixed(1)}`);
console.log(`    CALL side: Sell 24000CE Rs.${ic3.p.toFixed(1)} / Buy 24300CE Rs.${ic4.p.toFixed(1)}`);
console.log(`    Net Credit : Rs.${ic_mp.toFixed(0)}  |  Max Loss: Rs.${ic_ml.toFixed(0)}  |  Margin: Rs.${ic_mg.toFixed(0)}`);
console.log(`    Profit zone: 23,000 to 24,000  (1000 pt range!)`);
console.log(`    Note       : Use this INSTEAD of T1+T2 if you want 1 clean trade`);

console.log('\n--- TRADE 4 --- BULL PUT SPREAD  BANKNIFTY Monthly  [ENTER WHEN STABLE]');
console.log('    Bias: BANKNIFTY -1.89% today, deeper oversold, faster bounce');
console.log(`    Sell 53500PE @ Rs.${b1s.p.toFixed(1)}  |  Buy 52500PE @ Rs.${b1b.p.toFixed(1)}`);
console.log(`    Net Credit : Rs.${b1mp.toFixed(0)}  |  Max Loss: Rs.${b1ml.toFixed(0)}  |  Margin: Rs.${b1mg.toFixed(0)}`);
console.log(`    Breakeven  : ${(53500 - b1cr).toFixed(0)}  (buffer: ${(BNIFTY - (53500-b1cr)).toFixed(0)} pts)`);
console.log(`    Enter when : BANKNIFTY holds above 54,000 for 30 min`);
console.log(`    Stop       : BANKNIFTY 15-min close below 53,500`);

console.log('\n--- TRADE 5 --- LONG PUT  NIFTY Weekly  [ONLY IF 23,300 BREAKS]');
console.log('    Bias: Momentum breakdown trade — intraday only');
console.log(`    Buy 23100PE Weekly @ Rs.${t5.p.toFixed(1)} = Rs.${t5cost.toFixed(0)} per lot`);
console.log(`    Delta  : ${t5.d.toFixed(3)} | Theta: Rs.${Math.abs(t5.th * LOT_N).toFixed(0)}/day`);
console.log(`    Target : NIFTY 23,000  |  Stop: NIFTY reclaims 23,400`);
console.log('    RULE   : EXIT BY 3 PM. DO NOT hold overnight.');

console.log('\n=================================================================');
console.log('CAPITAL ALLOCATION  (Rs.1,00,000)');
console.log('=================================================================');
console.log(`  T1 NIFTY Bull Put  (NOW)        : Rs.${t1mg.toFixed(0).padStart(6)}  (${(t1mg/CAPITAL*100).toFixed(1)}%)`);
console.log(`  T2 NIFTY Bear Call (on bounce)  : Rs.${t2mg.toFixed(0).padStart(6)}  (${(t2mg/CAPITAL*100).toFixed(1)}%)`);
console.log(`  T4 BNIFTY Bull Put (when stable) : Rs.${b1mg.toFixed(0).padStart(6)}  (${(b1mg/CAPITAL*100).toFixed(1)}%)`);
console.log(`  T5 Long Put (only if breakdown)  : Rs.${t5cost.toFixed(0).padStart(6)}  (${(t5cost/CAPITAL*100).toFixed(1)}%) conditional`);
const used = t1mg + t2mg + b1mg;
console.log('  ---------------------------------------------------------');
console.log(`  T1+T2+T4 total margin used      : Rs.${used.toFixed(0).padStart(6)}  (${(used/CAPITAL*100).toFixed(1)}%)`);
console.log(`  Emergency buffer (FREE)         : Rs.${(CAPITAL-used).toFixed(0).padStart(6)}  (${((CAPITAL-used)/CAPITAL*100).toFixed(1)}%)`);

console.log('\n=================================================================');
console.log('MAX PROFIT POTENTIAL');
console.log('=================================================================');
const totalP = t1mp + t2mp + b1mp;
console.log(`  T1 NIFTY Bull Put Spread  : Rs.${t1mp.toFixed(0)}`);
console.log(`  T2 NIFTY Bear Call Spread : Rs.${t2mp.toFixed(0)}`);
console.log(`  T4 BNIFTY Bull Put Spread : Rs.${b1mp.toFixed(0)}`);
console.log('  ---------------------------------------------------------');
console.log(`  TOTAL MAX PROFIT          : Rs.${totalP.toFixed(0)}`);
console.log(`  Return on capital         : ${(totalP/CAPITAL*100).toFixed(1)}% in 18 days`);
console.log(`  Approx monthly return     : ${(totalP/CAPITAL*100).toFixed(1)}% = Rs.${totalP.toFixed(0)} on Rs.1L`);

console.log('\n=================================================================');
console.log('EXECUTION TIMELINE TODAY');
console.log('=================================================================');
console.log('  11:20 AM  T1 ACTIVE. Watch 23,300 support. Do nothing else.');
console.log('  11:30 AM  Check 15-min candle. Green = T1 safe. Red = alert.');
console.log('  12:00 PM  If BNIFTY holding 54,000 enter T4 (BNIFTY spread).');
console.log('  2:00 PM   If NIFTY bounced to 23,600+ enter T2 (Bear Call).');
console.log('  3:00 PM   CLOSE any intraday T5 Long Put if triggered.');
console.log('  TOMORROW  Evaluate Iron Condor T3 if overnight range confirms.');

console.log('\n=================================================================');
console.log('COMBINED P&L SCENARIOS AT EXPIRY (T1 + T2 + T4)');
console.log('=================================================================');
console.log('  NIFTY/BNIFTY    T1 P&L      T2 P&L     T4 P&L     TOTAL');
console.log('  --------------  ----------  ---------  ---------  ---------');
const scenarios = [
  [24000, 55000, 'Bull - rally'],
  [23700, 54500, 'Mild bounce'],
  [23400, 54100, 'Flat/sideways'],
  [23200, 53600, 'At support'],
  [23000, 53000, 'Breakdown'],
  [22700, 52000, 'Crash'],
];
scenarios.forEach(([nf, bn, label]) => {
  const p1 = nf >= 23200 ? t1mp : nf <= 22900 ? -t1ml : ((nf-23200)*LOT_N + t1mp - (0-t1mp));
  const t1pnl = nf >= 23200 ? t1mp : nf <= 22900 ? -t1ml : (nf-23200)*LOT_N - t1c + t1cr*LOT_N - t1c;
  const t1real = nf >= 23200 ? t1mp : nf <= 22900 ? -t1ml : (t1cr*LOT_N - Math.max(0,23200-nf)*LOT_N) - t1c;
  const t2real = nf <= 23800 ? t2mp : nf >= 24100 ? -t2ml : (t2cr*LOT_N - Math.max(0,nf-23800)*LOT_N) - t2c;
  const b1real = bn >= 53500 ? b1mp : bn <= 52500 ? -b1ml : (b1cr*LOT_BN - Math.max(0,53500-bn)*LOT_BN) - b1c;
  const total = t1real + t2real + b1real;
  const icon = total > 0 ? '[+]' : '[-]';
  console.log(`  ${label.padEnd(14)}  Rs.${t1real.toFixed(0).padStart(7)}  Rs.${t2real.toFixed(0).padStart(7)}  Rs.${b1real.toFixed(0).padStart(7)}  Rs.${total.toFixed(0).padStart(7)} ${icon}`);
});
