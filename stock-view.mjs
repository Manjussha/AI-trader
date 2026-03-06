/**
 * STOCK TERMINAL VIEW — ASCII Candlestick Chart + Live Prediction
 * Usage: node stock-view.mjs TECHM
 *        node stock-view.mjs TECHM 1343 1246 1487   (entry sl t1)
 */
import { GrowwClient } from './src/groww-client.js';
import { readFileSync, existsSync } from 'fs';
import { rsi, ema, bollingerBands, atr } from './src/analytics.js';

const market  = new GrowwClient({ apiKey: '', totpSecret: '' });
const args    = process.argv.slice(2);
const SYMBOL  = (args[0] || 'TECHM').toUpperCase();
const ENTRY   = parseFloat(args[1]) || null;
const SL      = parseFloat(args[2]) || null;
const T1      = parseFloat(args[3]) || null;
const T2      = parseFloat(args[4]) || null;

// Load from cache if no args
const cache   = existsSync('./cache.json') ? JSON.parse(readFileSync('./cache.json','utf8')) : {};
const cached  = cache.stocks?.[SYMBOL];
const entryP  = ENTRY || cached?.levels?.entry || null;
const slP     = SL    || cached?.levels?.sl    || null;
const t1P     = T1    || cached?.levels?.t1    || null;
const t2P     = T2    || cached?.levels?.t2    || null;

// ── ANSI ──────────────────────────────────────────────────────────────────────
const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  red:'\x1b[91m', green:'\x1b[92m', yellow:'\x1b[93m',
  blue:'\x1b[94m', magenta:'\x1b[95m', cyan:'\x1b[96m',
  white:'\x1b[97m', gray:'\x1b[90m',
  bgRed:'\x1b[41m', bgGreen:'\x1b[42m', bgYellow:'\x1b[43m', bgBlue:'\x1b[44m',
};
const clr = () => process.stdout.write('\x1b[2J\x1b[H');
const w   = s  => process.stdout.write(String(s));
const col = (c,t) => `${c}${t}${C.reset}`;
const W   = () => process.stdout.columns || 100;
const H   = () => process.stdout.rows    || 36;

// ── ASCII CANDLESTICK RENDERER ────────────────────────────────────────────────
function renderCandleChart(candles, extraLevels = {}, chartW, chartH) {
  if (!candles || candles.length < 3) return ['No data'];

  const numCandles = Math.min(candles.length, Math.floor(chartW / 3));
  const data       = candles.slice(-numCandles);

  // Price range with padding
  let priceMin = Math.min(...data.map(c => parseFloat(c.low)));
  let priceMax = Math.max(...data.map(c => parseFloat(c.high)));

  // Include levels in range
  Object.values(extraLevels).forEach(v => {
    if (v && !isNaN(v)) {
      priceMin = Math.min(priceMin, v);
      priceMax = Math.max(priceMax, v);
    }
  });
  const pad    = (priceMax - priceMin) * 0.05;
  priceMin    -= pad;
  priceMax    += pad;
  const range  = priceMax - priceMin || 1;

  // Helper: price → row (0=top, chartH-1=bottom)
  const toRow = p => Math.round((1 - (p - priceMin) / range) * (chartH - 1));

  // Build 2D grid: [row][col] = { char, color }
  const grid = Array.from({ length: chartH }, () =>
    Array.from({ length: chartW }, () => ({ ch: ' ', color: '' }))
  );

  const setCell = (r, c, ch, color = '') => {
    if (r >= 0 && r < chartH && c >= 0 && c < chartW)
      grid[r][c] = { ch, color };
  };

  // Draw horizontal level lines FIRST (behind candles)
  const levelDefs = [
    { price: extraLevels.t2,    char: '·', color: C.blue,    label: 'T2' },
    { price: extraLevels.t1,    char: '·', color: C.green,   label: 'T1' },
    { price: extraLevels.entry, char: '─', color: C.yellow,  label: 'EN' },
    { price: extraLevels.sl,    char: '·', color: C.red,     label: 'SL' },
    { price: extraLevels.pred,  char: '╌', color: C.magenta, label: 'PR' },
  ];

  levelDefs.forEach(({ price, char, color, label }) => {
    if (!price || isNaN(price)) return;
    const r = toRow(price);
    for (let c = 0; c < chartW - 3; c++) setCell(r, c, char, color);
    // label on right
    if (label) {
      [...label].forEach((ch, i) => setCell(r, chartW - 3 + i, ch, color + C.bold));
    }
  });

  // Draw candles
  data.forEach((candle, i) => {
    const open  = parseFloat(candle.open);
    const high  = parseFloat(candle.high);
    const low   = parseFloat(candle.low);
    const close = parseFloat(candle.close);
    const bull  = close >= open;
    const color = bull ? C.green : C.red;

    const colStart = i * 3;
    const bodyTop  = toRow(Math.max(open, close));
    const bodyBot  = toRow(Math.min(open, close));
    const wickTop  = toRow(high);
    const wickBot  = toRow(low);
    const midCol   = colStart + 1;

    // Upper wick
    for (let r = wickTop; r < bodyTop; r++) setCell(r, midCol, '│', color);
    // Body
    for (let r = bodyTop; r <= bodyBot; r++) {
      setCell(r, colStart,     '█', color);
      setCell(r, colStart + 1, '█', color);
      setCell(r, colStart + 2, '█', color);
    }
    // Empty body for doji
    if (bodyTop === bodyBot) {
      setCell(bodyTop, colStart,     '─', color);
      setCell(bodyTop, colStart + 1, '─', color);
      setCell(bodyTop, colStart + 2, '─', color);
    }
    // Lower wick
    for (let r = bodyBot + 1; r <= wickBot; r++) setCell(r, midCol, '│', color);
  });

  // Y-axis price labels (left side, every ~4 rows)
  const lines = [];
  for (let r = 0; r < chartH; r++) {
    const price = priceMax - (r / (chartH - 1)) * range;
    const label = (r % 4 === 0) ? price.toFixed(1).padStart(7) + '┤' : '        ';
    let line = col(C.gray, label);
    for (let c = 0; c < chartW; c++) {
      const cell = grid[r][c];
      line += cell.color + cell.ch + C.reset;
    }
    lines.push(line);
  }
  return lines;
}

// ── MINI PRICE HISTORY ────────────────────────────────────────────────────────
const priceHistory = [];       // stores { time, price } every tick
const predHistory  = [];       // predicted price at each tick

// ── MAIN RENDER ───────────────────────────────────────────────────────────────
let tickCount = 0;
let dailyCandles = [];
let lastFetchTime = 0;

async function render() {
  tickCount++;
  const now    = new Date();
  const timeStr= now.toLocaleTimeString('en-IN');

  // Detect NIFTY index symbols
  const isIndex = SYMBOL === 'NIFTY_INDEX' || SYMBOL === 'NIFTY50' || SYMBOL === 'BANKNIFTY';
  const yahooSym = isIndex ? 'NIFTYBEES' : SYMBOL;

  // Fetch historical candles every 5 minutes, live price every tick
  if (Date.now() - lastFetchTime > 300000 || dailyCandles.length === 0) {
    try {
      const hist   = await market.getHistoricalDataYahoo(yahooSym, 'NSE', 30, '1d');
      dailyCandles = hist.candles || [];
      lastFetchTime= Date.now();
    } catch(e) {}
  }

  // Live price always
  let livePrice = null, dayHigh = null, dayLow = null, dayOpen = null, pChange = 0, volume = 0;
  try {
    if (isIndex) {
      const indexName = SYMBOL === 'BANKNIFTY' ? 'NIFTY%20BANK' : 'NIFTY%2050';
      const data = await market._nseRequest(`/equity-stockIndices?index=${indexName}`);
      const n    = data?.data?.[0];
      livePrice  = parseFloat(n?.lastPrice);
      dayHigh    = parseFloat(n?.dayHigh);
      dayLow     = parseFloat(n?.dayLow);
      dayOpen    = parseFloat(n?.open);
      pChange    = parseFloat(n?.pChange || 0);
      volume     = 0;
    } else {
      const q  = await market.getLivePriceNSE(SYMBOL);
      livePrice= parseFloat(q.priceInfo?.lastPrice);
      dayHigh  = parseFloat(q.priceInfo?.intraDayHighLow?.max);
      dayLow   = parseFloat(q.priceInfo?.intraDayHighLow?.min);
      dayOpen  = parseFloat(q.priceInfo?.open);
      pChange  = parseFloat(q.priceInfo?.pChange || 0);
      volume   = parseFloat(q.priceInfo?.totalTradedVolume || 0);
    }
  } catch(e) {
    livePrice= dailyCandles.length ? parseFloat(dailyCandles[dailyCandles.length-1].close) : 0;
  }

  // Update live candle in dataset
  const liveCandle = {
    open:  dayOpen  || livePrice,
    high:  dayHigh  || livePrice,
    low:   dayLow   || livePrice,
    close: livePrice,
    volume,
  };
  const candles = [...dailyCandles.slice(-29), liveCandle];

  // Price history
  priceHistory.push({ time: timeStr, price: livePrice });
  if (priceHistory.length > 200) priceHistory.shift();

  // Indicators from candles
  const closes = candles.map(c => parseFloat(c.close));
  const rsiVal = rsi(closes);
  const ema9v  = ema(closes, 9);
  const ema21v = ema(closes, 21);
  const bb     = bollingerBands(closes);
  const atrVal = atr(candles, 14);

  // Predicted price (simple linear from entry direction)
  let predPrice = null;
  if (entryP && slP && t1P) {
    const dir    = t1P > entryP ? 1 : -1;
    const elapsed= Math.min(1, tickCount / 60); // normalize over 60 ticks
    predPrice    = entryP + dir * Math.abs(t1P - entryP) * elapsed * 0.4;
  }
  if (predPrice) predHistory.push(predPrice);

  // P&L
  const pnl    = entryP ? ((livePrice - entryP) * (t1P > entryP ? 1 : -1)) : 0;
  const pnlPct = entryP ? ((livePrice - entryP) / entryP * 100).toFixed(2) : '0';
  const pnlCol = pnl >= 0 ? C.green : C.red;

  // Layout dimensions
  const termW   = W();
  const termH   = H();
  const chartW  = termW - 12;   // leave space for Y labels
  const chartH  = Math.max(12, termH - 16);

  clr();

  // ── HEADER ──────────────────────────────────────────────────────────────────
  const headerBg = pChange >= 0 ? C.bgGreen : C.bgRed;
  const priceStr = `  ${SYMBOL}  ₹${livePrice}  ${pChange >= 0 ? '▲' : '▼'} ${Math.abs(pChange).toFixed(2)}%  `;
  w(col(headerBg + C.bold + C.white, priceStr.padEnd(termW)) + '\n');

  // ── OHLCV row ────────────────────────────────────────────────────────────────
  w(col(C.gray,` O:${dayOpen}  `)+col(C.green,`H:${dayHigh}  `)+col(C.red,`L:${dayLow}  `)+col(C.gray,`Vol:${(volume/1e6).toFixed(2)}M  `)+col(C.gray,`ATR:₹${atrVal?.toFixed(1)}  `)+timeStr+'\n');

  // ── INDICATORS row ───────────────────────────────────────────────────────────
  const rsiColor = rsiVal < 30 ? C.red : rsiVal > 70 ? C.green : C.yellow;
  const bbStr = bb ? `BB:${bb.lower?.toFixed(1)}─${bb.middle?.toFixed(1)}─${bb.upper?.toFixed(1)}` : 'BB:N/A';
  w(` RSI:${col(rsiColor, rsiVal?.toFixed(1))}  EMA9:${col(livePrice>ema9v?C.green:C.red, ema9v?.toFixed(1))}  EMA21:${col(livePrice>ema21v?C.green:C.red, ema21v?.toFixed(1))}  ${bbStr}\n`);
  w(col(C.gray, '─'.repeat(termW)) + '\n');

  // ── CANDLESTICK CHART ────────────────────────────────────────────────────────
  const levels = { entry: entryP, sl: slP, t1: t1P, t2: t2P, pred: predPrice };
  const chartLines = renderCandleChart(candles, levels, chartW, chartH);
  chartLines.forEach(line => w(line + '\n'));

  // ── X-AXIS (date labels) ─────────────────────────────────────────────────────
  w(col(C.gray, '        '));
  const step = Math.max(1, Math.floor(candles.length / 6));
  const labelPositions = [];
  for (let i = 0; i < candles.length; i += step) labelPositions.push(i);

  let xLine = '        ';
  candles.forEach((c, i) => {
    const label = labelPositions.includes(i) ? (c.date||'').slice(5) : '   ';
    xLine += label.slice(0,3);
  });
  w(col(C.gray, xLine.slice(0, termW)) + '\n');
  w(col(C.gray, '─'.repeat(termW)) + '\n');

  // ── PREDICTION vs REALITY ────────────────────────────────────────────────────
  if (entryP) {
    const diff    = livePrice - (predPrice || entryP);
    const onTrack = Math.abs(diff) < atrVal * 0.5;
    w(col(C.bold, ' PREDICTION '));
    w(`Entry:${col(C.yellow,'₹'+entryP)}  `);
    w(`SL:${col(C.red,'₹'+slP)}  `);
    w(`T1:${col(C.green,'₹'+t1P)}  `);
    if (t2P) w(`T2:${col(C.blue,'₹'+t2P)}  `);
    w('\n');

    if (predPrice) {
      const status = diff > 0
        ? col(C.green,  `▲ +${diff.toFixed(1)} ahead of prediction`)
        : diff < -atrVal*0.3
          ? col(C.red,  `▼ ${diff.toFixed(1)} lagging prediction`)
          : col(C.gray, `≈ on track`);
      w(` Pred:₹${predPrice.toFixed(1)} → Actual:₹${livePrice}  ${status}\n`);
    }

    // Progress: SL ─────────── ENTRY │ ──────── T1
    const totalRange = Math.abs(t1P - slP);
    const progress   = Math.max(0, Math.min(1, (livePrice - slP) / totalRange));
    const barW       = termW - 30;
    const filled     = Math.round(progress * barW);
    const entryBar   = Math.round(Math.abs(entryP - slP) / totalRange * barW);

    let bar = '';
    for (let i = 0; i < barW; i++) {
      if (i === entryBar) bar += col(C.yellow, '│');
      else if (i < filled) bar += col(livePrice >= entryP ? C.green : C.red, '█');
      else bar += col(C.gray, '░');
    }
    w(` ${col(C.red,'SL')} ${bar} ${col(C.green,'T1')}  ${col(pnlCol, (pnl>=0?'+':'')+pnl.toFixed(0))}\n`);

    // Risk/Reward
    const riskPts   = Math.abs(entryP - slP);
    const rewardPts = Math.abs(t1P - entryP);
    w(col(C.gray, ` Risk:₹${riskPts.toFixed(1)}  Reward:₹${rewardPts.toFixed(1)}  R:R=1:${(rewardPts/riskPts).toFixed(1)}  `));
    w(col(pnlCol, `P&L: ${pnl>=0?'+':''}${pnl.toFixed(2)} (${pnlPct}%)\n`));
  }

  // ── ALERTS ───────────────────────────────────────────────────────────────────
  w(col(C.gray, '─'.repeat(termW)) + '\n');
  if (slP && livePrice <= slP)
    w(col(C.bgRed + C.bold, ` 🚨 STOP LOSS HIT @ ₹${livePrice}  EXIT NOW! `.padEnd(termW)) + '\n');
  else if (t1P && livePrice >= t1P)
    w(col(C.bgGreen + C.bold, ` ✅ TARGET 1 HIT @ ₹${livePrice}  BOOK PROFIT `.padEnd(termW)) + '\n');
  else
    w(col(C.gray, ` Tick #${tickCount}  |  [q] quit  |  Refreshes every 5s `.padEnd(termW)) + '\n');
}

// ── KEYBOARD ──────────────────────────────────────────────────────────────────
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', key => {
    if (key === 'q' || key === '\u0003') { clr(); process.exit(0); }
  });
}

// ── LOOP ──────────────────────────────────────────────────────────────────────
console.log(`Loading ${SYMBOL}...`);
await render();
const loop = setInterval(async () => {
  try { await render(); } catch(e) {}
}, 5000);

process.on('SIGINT', () => { clearInterval(loop); clr(); process.exit(0); });
