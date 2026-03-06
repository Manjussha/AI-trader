/**
 * LIVE TRADING MONITOR — Real-time CLI Dashboard
 * Updates every 5 seconds in-place (no scroll)
 * Shows: Prediction vs Reality, Portfolio, Alerts
 *
 * Usage: node monitor.mjs
 */
import { GrowwClient } from './src/groww-client.js';
import { getPortfolio } from './src/paper-trade.js';
import { readFileSync, existsSync } from 'fs';

const market = new GrowwClient({ apiKey: '', totpSecret: '' });

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[91m',
  green:   '\x1b[92m',
  yellow:  '\x1b[93m',
  blue:    '\x1b[94m',
  magenta: '\x1b[95m',
  cyan:    '\x1b[96m',
  white:   '\x1b[97m',
  gray:    '\x1b[90m',
  bgRed:   '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue:  '\x1b[44m',
  bgGray:  '\x1b[100m',
};
const clr    = () => process.stdout.write('\x1b[2J\x1b[H');
const moveTo = (r,c) => process.stdout.write(`\x1b[${r};${c}H`);
const w      = (s) => process.stdout.write(s);
const col    = (color, text) => `${color}${text}${C.reset}`;
const bold   = (text) => `${C.bold}${text}${C.reset}`;

// ── Bar generators ────────────────────────────────────────────────────────────
function priceBar(current, min, max, width = 30) {
  const pct = Math.max(0, Math.min(1, (current - min) / (max - min)));
  const filled = Math.round(pct * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const color = pct < 0.3 ? C.red : pct > 0.7 ? C.green : C.yellow;
  return `${color}${bar}${C.reset}`;
}

function pnlBar(pnl, maxAbs = 2000, width = 20) {
  const pct = Math.min(1, Math.abs(pnl) / maxAbs);
  const filled = Math.round(pct * width);
  if (pnl >= 0) return col(C.green, '▓'.repeat(filled)) + col(C.gray, '░'.repeat(width - filled));
  return col(C.gray, '░'.repeat(width - filled)) + col(C.red, '▓'.repeat(filled));
}

function miniSparkline(prices, width = 15) {
  if (!prices || prices.length < 2) return '─'.repeat(width);
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;
  const chars = ['▁','▂','▃','▄','▅','▆','▇','█'];
  const step  = Math.max(1, Math.floor(prices.length / width));
  let spark   = '';
  for (let i = 0; i < width; i++) {
    const v    = prices[Math.min(prices.length - 1, i * step)];
    const idx  = Math.min(7, Math.floor(((v - min) / range) * 7));
    spark += chars[idx];
  }
  const trend = prices[prices.length-1] > prices[0];
  return (trend ? C.green : C.red) + spark + C.reset;
}

function diffArrow(predicted, actual) {
  const diff = actual - predicted;
  const pct  = (diff / predicted * 100).toFixed(1);
  if (Math.abs(diff) < 2) return col(C.gray, `≈ on track (${pct}%)`);
  return diff > 0
    ? col(C.green, `▲ +${diff.toFixed(1)} above pred (${pct}%)`)
    : col(C.red,   `▼ ${diff.toFixed(1)} below pred (${pct}%)`);
}

// ── Predictions (set when monitor starts, compared each tick) ──────────────
const PREDICTIONS = {
  nifty: {
    label:      'NIFTY 10-min prediction',
    startPrice: 24615,
    startTime:  Date.now(),
    bullTarget: 24650,
    bearTarget: 24575,
    neutral:    24620,
    scenario:   'SIDEWAYS→BEARISH',
    confidence: 65,
  },
  stocks: {
    TECHM:   { entry: 1343, sl: 1246.59, t1: 1487.62, t2: 1632.23, predDir: 'UP',  reason: 'RSI 22 oversold bounce' },
    WIPRO:   { entry: 197.15, sl: 186.38, t1: 213.31, t2: 229.46, predDir: 'UP',  reason: 'IT sector strength' },
    BEL:     { entry: 471.25, sl: 447.41, t1: 507.01, t2: 542.77, predDir: 'UP',  reason: 'Defence PSU momentum' },
    NTPC:    { entry: 384.20, sl: 366.62, t1: 410.57, t2: 436.94, predDir: 'UP',  reason: 'Power sector bull' },
  },
};

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  ticks:     0,
  niftyHist: [],
  alerts:    [],
  startTime: Date.now(),
  prevNifty: null,
};

// ── Main render ───────────────────────────────────────────────────────────────
async function render() {
  state.ticks++;

  // Fetch live data
  const [liveIdx, ...quotes] = await Promise.all([
    market._nseRequest('/equity-stockIndices?index=NIFTY%2050'),
    ...['TECHM','WIPRO','BEL','NTPC'].map(s => market.getLivePriceNSE(s).catch(()=>null))
  ]).catch(() => [null]);

  const nifty      = liveIdx?.data?.[0];
  const niftyPrice = parseFloat(nifty?.lastPrice) || 0;
  const niftyPC    = parseFloat(nifty?.pChange) || 0;
  const niftyHigh  = parseFloat(nifty?.dayHigh) || 0;
  const niftyLow   = parseFloat(nifty?.dayLow) || 0;
  const niftyOpen  = parseFloat(nifty?.open) || 0;
  const niftyStocks= liveIdx?.data?.slice(1) || [];
  const advances   = niftyStocks.filter(s => s.pChange > 0).length;
  const declines   = niftyStocks.filter(s => s.pChange < 0).length;

  // Build live prices map
  const liveMap = {};
  ['TECHM','WIPRO','BEL','NTPC'].forEach((s,i) => {
    const q = quotes[i+0]; // offset 0 since liveIdx is index 0
    if (q) liveMap[s] = parseFloat(q.priceInfo?.lastPrice || 0);
  });

  // Prices from NSE quotes (reindex since liveIdx is first)
  const stockQuotes = quotes;
  ['TECHM','WIPRO','BEL','NTPC'].forEach((s,i) => {
    const q = stockQuotes[i];
    if (q) liveMap[s] = parseFloat(q.priceInfo?.lastPrice || 0);
  });

  // PE option estimate
  const spotDiff = niftyPrice - 24612;
  const peNow    = Math.max(5, 155 + 0.50 * (-spotDiff));
  liveMap['NIFTY_24600_PE_27-Mar-2026'] = parseFloat(peNow.toFixed(1));

  // Portfolio
  const p         = getPortfolio(liveMap);
  const realized  = parseFloat(p.realizedPnl);
  const unrealized= parseFloat(p.unrealizedPnl);
  const netPnl    = realized + unrealized;

  // NIFTY history for sparkline
  state.niftyHist.push(niftyPrice);
  if (state.niftyHist.length > 60) state.niftyHist.shift();

  // Alerts
  const newAlerts = [];
  if (niftyPrice < 24575) newAlerts.push({ type:'DANGER', msg:'🚨 NIFTY 24,575 SUPPORT BROKEN!' });
  if (niftyPrice > 24700) newAlerts.push({ type:'PROFIT', msg:'✅ NIFTY hit day high 24,700' });
  if (peNow <= 77)        newAlerts.push({ type:'DANGER', msg:'🚨 PE SL HIT — EXIT NOW @ ₹77' });
  if (peNow >= 200)       newAlerts.push({ type:'PROFIT', msg:'✅ PE TARGET ₹200 — BOOK PROFIT' });
  Object.entries(PREDICTIONS.stocks).forEach(([sym, pred]) => {
    const live = liveMap[sym];
    if (!live) return;
    if (live <= pred.sl) newAlerts.push({ type:'DANGER', msg:`🚨 ${sym} SL HIT @ ₹${live}` });
    if (live >= pred.t1) newAlerts.push({ type:'PROFIT', msg:`✅ ${sym} T1 HIT @ ₹${live}` });
  });
  state.alerts = [...newAlerts, ...state.alerts].slice(0, 6);

  const now     = new Date().toLocaleTimeString('en-IN');
  const elapsed = Math.round((Date.now() - state.startTime) / 1000);
  const mins    = Math.floor(elapsed/60), secs = elapsed%60;
  const W       = process.stdout.columns || 120;

  // ── DRAW ──────────────────────────────────────────────────────────────────
  clr();

  // ── HEADER ────────────────────────────────────────────────────────────────
  const title = ` AI TRADING MONITOR `;
  const sub   = ` ${now}  |  Tick #${state.ticks}  |  Running: ${mins}m${secs}s  |  q to quit `;
  w(col(C.bgBlue, C.bold + title.padEnd(W)) + '\n');
  w(col(C.gray, sub) + '\n');
  w(col(C.gray, '─'.repeat(W)) + '\n');

  // ── NIFTY SECTION ─────────────────────────────────────────────────────────
  const niftyColor  = niftyPC >= 0 ? C.green : C.red;
  const niftyArrow  = niftyPC >= 0 ? '▲' : '▼';
  const vsOpen      = (niftyPrice - niftyOpen).toFixed(0);
  const vsOpenStr   = vsOpen >= 0 ? `+${vsOpen}` : vsOpen;

  w(bold(col(C.cyan, ' NIFTY 50')) + '\n');
  w(` ${col(niftyColor, bold(`₹${niftyPrice}`))}  ${col(niftyColor, `${niftyArrow} ${niftyPC}%`)}  `);
  w(`${col(C.gray, 'O:')}${niftyOpen}  ${col(C.gray, 'H:')}${col(C.green,niftyHigh)}  ${col(C.gray,'L:')}${col(C.red,niftyLow)}  vs Open: ${col(niftyPC>=0?C.green:C.red, vsOpenStr+'pts')}\n`);

  // Price bar: day low to high
  w(` ${col(C.red,'L:'+niftyLow)} ${priceBar(niftyPrice, niftyLow, niftyHigh, 40)} ${col(C.green,'H:'+niftyHigh)}\n`);
  w(` Sparkline(${state.niftyHist.length} ticks): ${miniSparkline(state.niftyHist, 40)}\n`);
  w(` Breadth: ${col(C.green, advances+'↑')} / ${col(C.red, declines+'↓')}  ${advances > declines ? col(C.green,'BULLISH') : col(C.red,'BEARISH')}\n`);

  // ── PREDICTION vs REALITY ─────────────────────────────────────────────────
  w('\n' + col(C.gray, '─'.repeat(W)) + '\n');
  w(bold(col(C.magenta, ' PREDICTION vs REALITY\n')));

  const pred    = PREDICTIONS.nifty;
  const elapsed10m = Math.min(1, (Date.now() - pred.startTime) / 600000);
  const predNow = pred.startPrice + (pred.neutral - pred.startPrice) * elapsed10m;

  w(` Scenario : ${col(C.yellow, pred.scenario)}  (${pred.confidence}% confidence)\n`);
  w(` Predicted: ₹${predNow.toFixed(0)} at this point  →  Actual: ₹${niftyPrice}  ${diffArrow(predNow, niftyPrice)}\n`);
  w(` Bull target ${col(C.green,'₹'+pred.bullTarget)}  ←  NOW ₹${niftyPrice}  →  Bear target ${col(C.red,'₹'+pred.bearTarget)}\n`);

  // Prediction progress bar
  const predMin = Math.min(pred.bearTarget, pred.bullTarget) - 30;
  const predMax = Math.max(pred.bearTarget, pred.bullTarget) + 30;
  w(` ${col(C.red,'Bear')} ${priceBar(niftyPrice, predMin, predMax, 44)} ${col(C.green,'Bull')}\n`);
  w(` ${col(C.gray, '      '+(pred.bearTarget+'').padStart(8)+'pts ← current →'+(pred.bullTarget+'').padStart(6)+'pts')}\n`);

  // ── POSITIONS ─────────────────────────────────────────────────────────────
  w('\n' + col(C.gray, '─'.repeat(W)) + '\n');
  w(bold(col(C.cyan, ' LIVE POSITIONS\n')));

  // Header
  w(col(C.gray, ` ${'SYMBOL'.padEnd(10)} ${'ENTRY'.padStart(8)} ${'LTP'.padStart(8)} ${'SL'.padStart(8)} ${'T1'.padStart(8)} ${'P&L'.padStart(8)}  PROGRESS\n`));

  const equityHoldings = p.holdings.filter(h => h.type !== 'OPTION');
  equityHoldings.forEach(h => {
    const sym    = h.symbol;
    const pred2  = PREDICTIONS.stocks[sym];
    const ltp    = parseFloat(h.ltp);
    const entry  = parseFloat(h.avgPrice);
    const pnl    = parseFloat(h.unrealizedPnl);
    const pnlStr = (pnl >= 0 ? '+' : '') + '₹' + pnl.toFixed(0);
    const pnlCol = pnl >= 0 ? C.green : C.red;

    // Progress: SL → Entry → T1
    let progress = '';
    if (pred2) {
      const rangeTotal = pred2.t1 - pred2.sl;
      const progressPct= Math.max(0, Math.min(1, (ltp - pred2.sl) / rangeTotal));
      const barWidth   = 20;
      const filled     = Math.round(progressPct * barWidth);
      const entryPos   = Math.round((pred2.entry - pred2.sl) / rangeTotal * barWidth);
      let bar = '';
      for (let i = 0; i < barWidth; i++) {
        if (i === entryPos) bar += col(C.yellow, '│');
        else if (i < filled) bar += col(ltp >= entry ? C.green : C.red, '█');
        else bar += col(C.gray, '░');
      }
      const pct = (progressPct * 100).toFixed(0);
      progress = `${bar} ${pct}%`;

      // Status tag
      let tag = '';
      if (ltp <= pred2.sl)      tag = col(C.bgRed,   ' SL HIT ');
      else if (ltp >= pred2.t1) tag = col(C.bgGreen,  ' T1 HIT ');
      else if (ltp >= entry)    tag = col(C.green,    ' IN PROFIT');
      else                      tag = col(C.red,      ' BELOW ENTRY');
      progress += ' ' + tag;
    }

    w(` ${col(C.white, sym.padEnd(10))} ${('₹'+entry).padStart(8)} ${col(pnlCol, ('₹'+ltp).padStart(8))} `);
    w(`${col(C.red, ('₹'+(pred2?.sl||'—')).padStart(8))} ${col(C.green, ('₹'+(pred2?.t1||'—')).padStart(8))} `);
    w(`${col(pnlCol, pnlStr.padStart(8))}  ${progress}\n`);
  });

  // Options
  const optHoldings = p.holdings.filter(h => h.type === 'OPTION');
  if (optHoldings.length > 0) {
    w('\n' + col(C.gray, ` ${'OPTION'.padEnd(16)} ${'ENTRY'.padStart(8)} ${'NOW'.padStart(8)} ${'SL'.padStart(8)} ${'TARGET'.padStart(8)} ${'P&L'.padStart(8)}\n`));
    optHoldings.forEach(h => {
      const pnl    = parseFloat(h.unrealizedPnl);
      const pnlStr = (pnl >= 0 ? '+' : '') + '₹' + pnl.toFixed(0);
      const pnlCol = pnl >= 0 ? C.green : C.red;
      const slP    = h.optType === 'CE' ? 55 : 77;
      const tgtP   = h.optType === 'CE' ? 165 : 230;
      const nowP   = parseFloat(h.currentPremium);
      const slHit  = nowP <= slP ? col(C.bgRed,' SL! ') : col(C.gray,'  ✓  ');
      const tgtHit = nowP >= tgtP ? col(C.bgGreen,' TGT ') : '';

      const barMin = slP, barMax = tgtP;
      const optBar = priceBar(nowP, barMin, barMax, 15);

      w(` ${col(C.magenta, `NIFTY ${h.strike}${h.optType}`.padEnd(16))} `);
      w(`${('₹'+h.premium).padStart(8)} ${col(pnlCol, ('₹'+nowP).padStart(8))} `);
      w(`${col(C.red,('₹'+slP).padStart(8))} ${col(C.green,('₹'+tgtP).padStart(8))} `);
      w(`${col(pnlCol, pnlStr.padStart(8))}  ${optBar} ${slHit}${tgtHit}\n`);
    });
  }

  // ── P&L SUMMARY ───────────────────────────────────────────────────────────
  w('\n' + col(C.gray, '─'.repeat(W)) + '\n');
  const netCol = netPnl >= 0 ? C.green : C.red;
  w(` ${bold('P&L')}  `);
  w(`Realized: ${col(C.green, '+₹'+realized.toFixed(0))}  `);
  w(`Unrealized: ${col(unrealized>=0?C.green:C.red, (unrealized>=0?'+':'')+'₹'+unrealized.toFixed(0))}  `);
  w(`${bold(col(netCol, 'NET: '+(netPnl>=0?'+':'')+'₹'+netPnl.toFixed(0)))}  `);
  w(`Portfolio: ${col(C.blue, '₹'+p.portfolioValue)}  Cash: ${col(C.gray, '₹'+p.cash)}\n`);
  w(` ${pnlBar(netPnl, 3000, 40)}  ${col(netCol, (netPnl>=0?'+':'')+netPnl.toFixed(0)+'  ('+(netPnl/1000*100/100).toFixed(2)+'%)')}\n`);

  // ── ALERTS ────────────────────────────────────────────────────────────────
  if (state.alerts.length > 0) {
    w('\n' + col(C.gray, '─'.repeat(W)) + '\n');
    w(bold(col(C.yellow, ' ALERTS\n')));
    state.alerts.forEach(a => {
      const c = a.type === 'DANGER' ? C.red : C.green;
      w(` ${col(c, a.msg)}\n`);
    });
  }

  // ── QUICK COMMANDS ────────────────────────────────────────────────────────
  w('\n' + col(C.gray, '─'.repeat(W)) + '\n');
  w(col(C.gray, ` Commands: [b]ounce buy  [s]ell all  [c]lose PE  [r]efresh cache  [q]uit  |  Auto-refresh: 5s\n`));

  state.prevNifty = niftyPrice;
}

// ── KEYBOARD INPUT ────────────────────────────────────────────────────────────
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (key) => {
    if (key === 'q' || key === '\u0003') {
      clr();
      console.log(col(C.yellow, '\nMonitor stopped. Portfolio saved.'));
      process.exit(0);
    }
    if (key === 'r') {
      w('\n' + col(C.yellow, ' Refreshing cache...\n'));
      const { execSync } = await import('child_process');
      try { execSync('node cache-refresh.mjs', { timeout: 60000 }); }
      catch(e) {}
      await render();
    }
    if (key === 'c') {
      const liveIdx = await market._nseRequest('/equity-stockIndices?index=NIFTY%2050');
      const niftyPrice = parseFloat(liveIdx?.data?.[0]?.lastPrice);
      const spotDiff   = niftyPrice - 24612;
      const peNow      = Math.max(5, 155 + 0.50 * (-spotDiff));
      const { paperSellOption } = await import('./src/paper-trade.js');
      const r = paperSellOption({ symbol:'NIFTY', strike:24600, type:'PE', expiry:'27-Mar-2026', currentPremium: parseFloat(peNow.toFixed(1)), note:'Monitor close' });
      state.alerts.unshift({ type: r.success ? 'PROFIT' : 'DANGER', msg: r.success ? `✅ PE closed @ ₹${peNow.toFixed(1)} | P&L: ₹${r.realizedPnl}` : `❌ ${r.error}` });
      await render();
    }
  });
}

// ── MAIN LOOP ─────────────────────────────────────────────────────────────────
console.log(col(C.cyan, 'Starting monitor...\n'));
await render();
const loop = setInterval(async () => {
  try { await render(); }
  catch(e) { state.alerts.unshift({ type:'DANGER', msg:`Error: ${e.message}` }); }
}, 5000);

process.on('SIGINT', () => {
  clearInterval(loop);
  clr();
  console.log(col(C.yellow, 'Monitor stopped.'));
  process.exit(0);
});
