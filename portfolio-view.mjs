/**
 * PORTFOLIO TERMINAL VIEW — Live P&L + NIFTY Overview
 * Usage: node portfolio-view.mjs
 */
import { GrowwClient } from './src/groww-client.js';
import { getPortfolio } from './src/paper-trade.js';

const market = new GrowwClient({ apiKey: '', totpSecret: '' });

const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  red:'\x1b[91m', green:'\x1b[92m', yellow:'\x1b[93m',
  blue:'\x1b[94m', magenta:'\x1b[95m', cyan:'\x1b[96m',
  white:'\x1b[97m', gray:'\x1b[90m',
  bgRed:'\x1b[41m', bgGreen:'\x1b[42m', bgBlue:'\x1b[44m', bgGray:'\x1b[100m',
};
const clr = () => process.stdout.write('\x1b[2J\x1b[H');
const w   = s  => process.stdout.write(String(s));
const col = (c, t) => `${c}${t}${C.reset}`;
const W   = () => process.stdout.columns || 90;

// Sparkline history
const niftyHist = [];
const pnlHist   = [];

function sparkline(data, width = 20) {
  if (data.length < 2) return col(C.gray, '─'.repeat(width));
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const bars  = ['▁','▂','▃','▄','▅','▆','▇','█'];
  const step  = Math.max(1, Math.ceil(data.length / width));
  let out = '';
  for (let i = 0; i < width; i++) {
    const v   = data[Math.min(data.length-1, i*step)];
    const idx = Math.min(7, Math.floor(((v-min)/range)*7));
    const trend = data[data.length-1] >= data[0];
    out += (trend ? C.green : C.red) + bars[idx] + C.reset;
  }
  return out;
}

function pnlMiniBar(pnl, maxAbs = 3000, width = 30) {
  const pct    = Math.min(1, Math.abs(pnl) / maxAbs);
  const filled = Math.round(pct * width);
  if (pnl >= 0) return col(C.green, '▓'.repeat(filled)) + col(C.gray, '░'.repeat(width-filled));
  return col(C.gray, '░'.repeat(width-filled)) + col(C.red, '▓'.repeat(filled));
}

function candleRow(candles, width = 40) {
  // Mini inline candle row for NIFTY
  const n = Math.min(candles.length, Math.floor(width / 2));
  const data = candles.slice(-n);
  let out = '';
  data.forEach(c => {
    const bull = parseFloat(c.close) >= parseFloat(c.open);
    out += (bull ? col(C.green, '▲') : col(C.red, '▼')) + ' ';
  });
  return out;
}

let niftyCandles = [];
let lastHistFetch = 0;
let tickCount = 0;

async function render() {
  tickCount++;
  const now = new Date().toLocaleTimeString('en-IN');

  // Fetch NIFTY candles every 5 min
  if (Date.now() - lastHistFetch > 300000) {
    try {
      const hist  = await market.getHistoricalDataYahoo('NIFTYBEES', 'NSE', 20, '1d');
      niftyCandles= hist.candles || [];
      lastHistFetch = Date.now();
    } catch(e) {}
  }

  // Live NIFTY + stocks
  const [liveIdx, ...quotes] = await Promise.all([
    market._nseRequest('/equity-stockIndices?index=NIFTY%2050'),
    ...['TECHM','WIPRO','BEL','NTPC'].map(s => market.getLivePriceNSE(s).catch(()=>null))
  ]);

  const nifty     = liveIdx?.data?.[0];
  const niftyPrc  = parseFloat(nifty?.lastPrice);
  const niftyPC   = parseFloat(nifty?.pChange);
  const niftyH    = parseFloat(nifty?.dayHigh);
  const niftyL    = parseFloat(nifty?.dayLow);
  const niftyO    = parseFloat(nifty?.open);
  const niftyStks = liveIdx?.data?.slice(1) || [];
  const adv       = niftyStks.filter(s=>s.pChange>0).length;
  const dec       = niftyStks.filter(s=>s.pChange<0).length;
  const strUp     = niftyStks.filter(s=>s.pChange>1).length;
  const strDn     = niftyStks.filter(s=>s.pChange<-1).length;

  // Live prices map
  const livePrices = {};
  ['TECHM','WIPRO','BEL','NTPC'].forEach((s,i) => {
    if (quotes[i]) livePrices[s] = parseFloat(quotes[i].priceInfo?.lastPrice || 0);
  });
  const spotDiff = niftyPrc - 24612;
  livePrices['NIFTY_24600_PE_27-Mar-2026'] = Math.max(5, 155 + 0.50*(-spotDiff));

  const p        = getPortfolio(livePrices);
  const realized = parseFloat(p.realizedPnl);
  const unreal   = parseFloat(p.unrealizedPnl);
  const net      = realized + unreal;
  const netPct   = (net / 100000 * 100).toFixed(2);

  niftyHist.push(niftyPrc);
  if (niftyHist.length > 80) niftyHist.shift();
  pnlHist.push(net);
  if (pnlHist.length > 80) pnlHist.shift();

  const termW = W();
  clr();

  // ── HEADER ──────────────────────────────────────────────────────────────────
  w(col(C.bgBlue+C.bold+C.white, ` 📊 PORTFOLIO LIVE  |  ${now}  |  Tick #${tickCount} `.padEnd(termW)) + '\n');
  w(col(C.gray, '─'.repeat(termW)) + '\n');

  // ── NIFTY SECTION ────────────────────────────────────────────────────────────
  const nCol = niftyPC >= 0 ? C.green : C.red;
  w(col(C.bold, ' NIFTY 50 ') + col(nCol+C.bold, `₹${niftyPrc}`) + `  ${col(nCol, (niftyPC>=0?'▲':'▼')+' '+niftyPC+'%')}  `);
  w(`O:${niftyO}  ${col(C.green,'H:'+niftyH)}  ${col(C.red,'L:'+niftyL)}\n`);

  // NIFTY sparkline
  w(' Trend  : ' + sparkline(niftyHist, termW-12) + '\n');

  // Breadth bar
  const breadthW = termW - 20;
  const advPct   = Math.round((adv/(adv+dec||1))*breadthW);
  const decPct   = breadthW - advPct;
  w(` Breadth: ${col(C.green, '█'.repeat(advPct))}${col(C.red, '█'.repeat(decPct))}  ${col(C.green,adv+'▲')} ${col(C.red,dec+'▼')}  Strong:${col(C.green,strUp+'▲')} ${col(C.red,strDn+'▼')}\n`);

  // Mini NIFTY candles
  if (niftyCandles.length > 0) w(' Last 20d: ' + candleRow(niftyCandles, termW-12) + '\n');

  w(col(C.gray, '─'.repeat(termW)) + '\n');

  // ── POSITIONS ────────────────────────────────────────────────────────────────
  w(col(C.bold+C.cyan, ' POSITIONS\n'));

  // Equity
  const entries = [
    { sym:'TECHM',  entry:1343,   sl:1246.59, t1:1487.62 },
    { sym:'WIPRO',  entry:197.15, sl:186.38,  t1:213.31  },
    { sym:'BEL',    entry:471.25, sl:447.41,  t1:507.01  },
    { sym:'NTPC',   entry:384.20, sl:366.62,  t1:410.57  },
  ];

  entries.forEach(meta => {
    const h = p.holdings.find(h => h.symbol === meta.sym);
    if (!h) return;
    const ltp  = parseFloat(h.ltp);
    const pnl  = parseFloat(h.unrealizedPnl);
    const pnlC = pnl >= 0 ? C.green : C.red;
    const range= meta.t1 - meta.sl;
    const prog = Math.max(0, Math.min(1, (ltp - meta.sl) / range));
    const bW   = 22;
    const fill = Math.round(prog * bW);
    const entP = Math.round(Math.abs(meta.entry - meta.sl) / range * bW);

    let bar = '';
    for (let i = 0; i < bW; i++) {
      if (i === entP) bar += col(C.yellow, '│');
      else if (i < fill) bar += col(ltp >= meta.entry ? C.green : C.red, '█');
      else bar += col(C.gray, '░');
    }

    // Status
    let status = '';
    if (ltp <= meta.sl)     status = col(C.bgRed,   ' SL! ');
    else if (ltp >= meta.t1)status = col(C.bgGreen, ' T1! ');
    else if (ltp >= meta.entry) status = col(C.green, '  ▲  ');
    else                    status = col(C.red,    '  ▼  ');

    w(` ${col(C.white+C.bold, meta.sym.padEnd(8))} ₹${String(ltp).padEnd(8)} ${col(pnlC, ((pnl>=0?'+':'')+'₹'+pnl.toFixed(0)).padEnd(8))} ${bar} ${status}\n`);
    w(col(C.gray, `          SL:₹${meta.sl}  EN:₹${meta.entry}  T1:₹${meta.t1}\n`));
  });

  // Options
  p.holdings.filter(h => h.type === 'OPTION').forEach(h => {
    const pnl  = parseFloat(h.unrealizedPnl);
    const pnlC = pnl >= 0 ? C.green : C.red;
    const slP  = h.optType==='CE' ? 55 : 77;
    const tP   = h.optType==='CE' ? 165 : 230;
    const nowP = parseFloat(h.currentPremium);
    const prog = Math.max(0, Math.min(1, (nowP - slP) / (tP - slP)));
    const bW   = 22;
    const fill = Math.round(prog * bW);
    const enP  = Math.round(Math.abs(parseFloat(h.premium) - slP) / (tP - slP) * bW);
    let bar = '';
    for (let i = 0; i < bW; i++) {
      if (i === enP) bar += col(C.yellow, '│');
      else if (i < fill) bar += col(pnl>=0?C.green:C.red, '█');
      else bar += col(C.gray, '░');
    }
    w(` ${col(C.magenta+C.bold, `NIFTY ${h.strike}${h.optType}`.padEnd(8))} ₹${String(nowP).padEnd(8)} ${col(pnlC, ((pnl>=0?'+':'')+'₹'+pnl.toFixed(0)).padEnd(8))} ${bar}\n`);
    w(col(C.gray, `          SL:₹${slP}  EN:₹${h.premium}  T1:₹${tP}\n`));
  });

  w(col(C.gray, '─'.repeat(termW)) + '\n');

  // ── P&L SUMMARY ──────────────────────────────────────────────────────────────
  const netC = net >= 0 ? C.green : C.red;
  w(col(C.bold, ' P&L SUMMARY\n'));
  w(` Realized  : ${col(C.green, '+₹'+realized.toFixed(0).padEnd(10))} (CE booked ✅)\n`);
  w(` Unrealized: ${col(unreal>=0?C.green:C.red, (unreal>=0?'+':'')+' ₹'+unreal.toFixed(0))}\n`);
  w(` NET TODAY : ${col(netC+C.bold, (net>=0?'+':'')+' ₹'+net.toFixed(0)+'  ('+netPct+'%)')}\n`);
  w(' P&L chart : ' + sparkline(pnlHist, termW-14) + '\n');
  w(' ' + pnlMiniBar(net, 3000, termW-2) + '\n');
  w(col(C.gray, '─'.repeat(termW)) + '\n');

  // ── CAPITAL BREAKDOWN ─────────────────────────────────────────────────────────
  const deployed = 100000 - parseFloat(p.cash);
  const depPct   = Math.round(deployed/1000);
  const cashPct  = 100 - depPct;
  w(` Capital : ₹1,00,000  →  Value: ${col(netC, '₹'+p.portfolioValue)}\n`);
  w(` Deployed: ${col(C.blue, '█'.repeat(Math.min(depPct,termW-30)))}${col(C.gray,'░'.repeat(Math.max(0,cashPct)))}  ${col(C.blue,deployed.toFixed(0))} deployed  ${col(C.gray,'₹'+p.cash)} cash\n`);
  w(col(C.gray, '─'.repeat(termW)) + '\n');
  w(col(C.gray, ` Win Rate: ${p.winRate}  Trades: ${p.totalTrades}  |  [q] quit\n`));
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', key => {
    if (key==='q'||key==='\u0003') { clr(); process.exit(0); }
  });
}

console.log('Loading portfolio...');
await render();
const loop = setInterval(async () => {
  try { await render(); } catch(e) {}
}, 5000);
process.on('SIGINT', () => { clearInterval(loop); clr(); process.exit(0); });
