/**
 * TRADING WEB DASHBOARD
 * Run: node server-dashboard.mjs
 * Opens: http://localhost:3000
 */
import http from 'http';
import { URL } from 'url';
import { GrowwClient } from './src/groww-client.js';
import { getPortfolio } from './src/paper-trade.js';
import { readFileSync, existsSync } from 'fs';
import { exec } from 'child_process';

const PORT   = 3000;
const market = new GrowwClient({ apiKey: '', totpSecret: '' });
const cache  = existsSync('./cache.json') ? JSON.parse(readFileSync('./cache.json','utf8')) : {};
const STOCKS = ['TECHM','WIPRO','BEL','NTPC'];

// ── In-memory candle cache ────────────────────────────────────────────────────
const _candles = {}, _candleTs = {};

async function fetchCandles(symbol) {
  const isIdx = symbol === 'NIFTY';
  const ySym  = isIdx ? 'NIFTYBEES' : symbol;
  if (!_candles[symbol] || Date.now() - (_candleTs[symbol]||0) > 300000) {
    try {
      const h = await market.getHistoricalDataYahoo(ySym, 'NSE', 60, '1d');
      _candles[symbol] = (h.candles || []).map(c => {
        const d = c.date ? new Date(c.date) : new Date(c.timestamp*1000);
        d.setUTCHours(0,0,0,0);
        return {
          time:  Math.floor(d.getTime()/1000),
          open:  parseFloat(c.open),
          high:  parseFloat(c.high),
          low:   parseFloat(c.low),
          close: parseFloat(c.close),
        };
      }).filter(c => c.time > 0 && !isNaN(c.close))
        .sort((a,b) => a.time - b.time);
      _candleTs[symbol] = Date.now();
    } catch(e) { _candles[symbol] = []; }
  }
  return _candles[symbol];
}

// ── Tick history (last 30 min per symbol) ─────────────────────────────────────
const tickHistory = {};  // { TECHM: [{time, value}, ...], ... }
const TICK_WINDOW = 30 * 60; // 30 minutes in seconds

function storeTick(sym, price) {
  if (!tickHistory[sym]) tickHistory[sym] = [];
  const now = Math.floor(Date.now() / 1000);
  tickHistory[sym].push({ time: now, value: price });
  // Drop ticks older than 30 min
  const cutoff = now - TICK_WINDOW;
  tickHistory[sym] = tickHistory[sym].filter(t => t.time >= cutoff);
}

// ── Live data fetch ───────────────────────────────────────────────────────────
async function getLive() {
  const out = { nifty: null, stocks: {}, portfolio: null, ticks: {}, ts: Date.now() };

  // NIFTY
  try {
    const d  = await market._nseRequest('/equity-stockIndices?index=NIFTY%2050');
    const n  = d?.data?.[0];
    const ss = d?.data?.slice(1) || [];
    out.nifty = {
      price:  parseFloat(n?.lastPrice),
      pChange:parseFloat(n?.pChange||0),
      high:   parseFloat(n?.dayHigh),
      low:    parseFloat(n?.dayLow),
      open:   parseFloat(n?.open),
      adv:    ss.filter(s=>s.pChange>0).length,
      dec:    ss.filter(s=>s.pChange<0).length,
      strUp:  ss.filter(s=>s.pChange>1).length,
      strDn:  ss.filter(s=>s.pChange<-1).length,
    };
  } catch(e) {}

  // Stocks
  await Promise.all(STOCKS.map(async sym => {
    try {
      const q = await market.getLivePriceNSE(sym);
      const c = cache.stocks?.[sym];
      out.stocks[sym] = {
        price:   parseFloat(q.priceInfo?.lastPrice),
        pChange: parseFloat(q.priceInfo?.pChange||0),
        high:    parseFloat(q.priceInfo?.intraDayHighLow?.max),
        low:     parseFloat(q.priceInfo?.intraDayHighLow?.min),
        open:    parseFloat(q.priceInfo?.open),
        volume:  parseFloat(q.priceInfo?.totalTradedVolume||0),
        levels:  c?.levels  || null,
        score:   c?.score   || 0,
        rsi:     c?.indicators?.rsi || null,
        signal:  c?.signal  || 'HOLD',
      };
    } catch(e) { out.stocks[sym] = null; }
  }));

  // Store ticks & include history
  STOCKS.forEach(sym => {
    if (out.stocks[sym]?.price) storeTick(sym, out.stocks[sym].price);
    out.ticks[sym] = tickHistory[sym] || [];
  });
  if (out.nifty?.price) storeTick('NIFTY', out.nifty.price);
  out.ticks['NIFTY'] = tickHistory['NIFTY'] || [];

  // Portfolio
  try {
    const lp = {};
    STOCKS.forEach(s => { if (out.stocks[s]) lp[s] = out.stocks[s].price; });
    out.portfolio = getPortfolio(lp);
  } catch(e) {}

  return out;
}

// ── HTML Dashboard ────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Trading Dashboard</title>
<script src="https://unpkg.com/lightweight-charts@4.1.1/dist/lightweight-charts.standalone.production.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#0f1117;color:#d1d4dc;font-family:'Segoe UI',monospace;font-size:13px;overflow:hidden;}
/* Header */
#header{background:#1a1d2e;padding:8px 16px;display:flex;align-items:center;gap:20px;border-bottom:1px solid #2a2e39;height:52px;}
.logo{color:#2196f3;font-weight:700;font-size:15px;letter-spacing:1px;white-space:nowrap;}
.nifty-price{font-size:20px;font-weight:700;}
.nifty-change{font-size:12px;margin-top:1px;}
.up{color:#26a69a;} .dn{color:#ef5350;} .neu{color:#888;}
.breadth-wrap{display:flex;flex-direction:column;gap:3px;}
.breadth-bar{width:140px;height:6px;border-radius:3px;overflow:hidden;display:flex;}
#clock{margin-left:auto;color:#666;font-size:11px;white-space:nowrap;}
/* Layout */
#main{display:grid;grid-template-columns:1fr 260px;height:calc(100vh - 52px);}
#charts-grid{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:1px;background:#0a0d14;overflow:hidden;}
/* Chart pane */
.chart-pane{background:#0f1117;display:flex;flex-direction:column;overflow:hidden;}
.chart-header{padding:6px 10px;background:#1a1d2e;display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0;}
.ch-sym{font-weight:700;font-size:14px;}
.ch-price{font-size:16px;font-weight:600;}
.ch-chg{font-size:11px;}
.ch-ohlc{font-size:10px;color:#666;margin-left:4px;}
.score-badge{background:#2a2e39;padding:1px 6px;border-radius:8px;font-size:10px;margin-left:auto;}
.chart-levels{padding:3px 10px;background:#111420;display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0;border-bottom:1px solid #1e2130;}
.lv{padding:1px 5px;border-radius:3px;font-size:10px;}
.lv-sl{background:rgba(239,83,80,.15);color:#ef5350;}
.lv-en{background:rgba(255,193,7,.15);color:#ffc107;}
.lv-t1{background:rgba(38,166,154,.15);color:#26a69a;}
.lv-t2{background:rgba(33,150,243,.15);color:#2196f3;}
.lv-rsi{color:#aaa;}
.lv-sig-buy{color:#26a69a;font-weight:700;}
.lv-sig-sell{color:#ef5350;font-weight:700;}
.lv-sig-hold{color:#ffc107;}
.chart-wrap{flex:1;min-height:0;position:relative;}
/* Sidebar */
#sidebar{background:#13162a;border-left:1px solid #2a2e39;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;}
.s-title{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#444;margin-bottom:2px;}
.pnl-card{background:#1a1d2e;border-radius:6px;padding:10px;}
.pnl-net{font-size:24px;font-weight:700;margin:4px 0;}
.pnl-row{display:flex;justify-content:space-between;font-size:11px;color:#666;padding:2px 0;}
.holding-card{background:#1a1d2e;border-radius:6px;padding:8px;display:flex;justify-content:space-between;align-items:center;}
.h-left .h-sym{font-weight:700;font-size:13px;}
.h-left .h-meta{font-size:10px;color:#666;margin-top:1px;}
.h-prog{height:2px;background:#2a2e39;border-radius:1px;margin-top:4px;width:120px;}
.h-prog-fill{height:100%;border-radius:1px;transition:width .5s;}
.h-pnl{font-size:14px;font-weight:700;}
.breadth-card{background:#1a1d2e;border-radius:6px;padding:8px;font-size:11px;line-height:2;}
/* Status */
#status-bar{position:fixed;bottom:0;left:0;right:0;background:#0a0d14;border-top:1px solid #1e2130;padding:3px 12px;font-size:10px;color:#444;display:flex;align-items:center;gap:6px;}
.spinner{width:8px;height:8px;border:1px solid #333;border-top-color:#2196f3;border-radius:50%;animation:spin .8s linear infinite;display:inline-block;}
@keyframes spin{to{transform:rotate(360deg);}}
</style>
</head>
<body>

<div id="header">
  <div class="logo">⚡ AI TRADER</div>
  <div>
    <div id="nifty-price" class="nifty-price neu">—</div>
    <div id="nifty-change" class="nifty-change neu">NIFTY 50</div>
  </div>
  <div class="breadth-wrap">
    <div id="breadth-text" style="font-size:11px;color:#888;">Adv/Dec: —</div>
    <div class="breadth-bar" id="breadth-bar"></div>
  </div>
  <div id="nifty-ohlc" style="font-size:10px;color:#555;"></div>
  <div id="clock">—</div>
</div>

<div id="main">
  <div id="charts-grid">
    ${['TECHM','WIPRO','BEL','NTPC'].map(sym => `
    <div class="chart-pane" id="pane-${sym}">
      <div class="chart-header">
        <span class="ch-sym">${sym}</span>
        <span class="ch-price neu" id="price-${sym}">—</span>
        <span class="ch-chg neu" id="chg-${sym}">—</span>
        <span class="ch-ohlc" id="ohlc-${sym}"></span>
        <span class="score-badge" id="score-${sym}">—/10</span>
      </div>
      <div class="chart-levels" id="levels-${sym}">Loading...</div>
      <div class="chart-wrap" id="chart-${sym}"></div>
    </div>`).join('')}
  </div>

  <div id="sidebar">
    <div>
      <div class="s-title">Portfolio P&amp;L</div>
      <div class="pnl-card">
        <div style="color:#555;font-size:10px;">NET TODAY</div>
        <div class="pnl-net" id="pnl-net">—</div>
        <div class="pnl-row"><span>Realized</span><span id="pnl-real" class="up">—</span></div>
        <div class="pnl-row"><span>Unrealized</span><span id="pnl-unreal">—</span></div>
        <div class="pnl-row"><span>Value</span><span id="pnl-value">—</span></div>
        <div class="pnl-row"><span>Cash</span><span id="pnl-cash">—</span></div>
        <div class="pnl-row"><span>Win Rate</span><span id="pnl-wr">—</span></div>
      </div>
    </div>
    <div>
      <div class="s-title">Positions</div>
      <div id="holdings" style="display:flex;flex-direction:column;gap:4px;"></div>
    </div>
    <div>
      <div class="s-title">Market Breadth</div>
      <div class="breadth-card" id="breadth-detail">—</div>
    </div>
  </div>
</div>

<div id="status-bar"><span class="spinner" id="spinner"></span><span id="status-txt">Loading data...</span></div>

<script>
const STOCKS = ['TECHM','WIPRO','BEL','NTPC'];
const charts = {}, areaSeries = {}, priceLines = {};

// ── Create charts (area series) ───────────────────────────────────────────────
STOCKS.forEach(sym => {
  const el = document.getElementById('chart-'+sym);
  const chart = LightweightCharts.createChart(el, {
    layout:{ background:{color:'#0f1117'}, textColor:'#d1d4dc' },
    grid:{ vertLines:{color:'#1e2130'}, horzLines:{color:'#1e2130'} },
    crosshair:{ mode: 1 },
    rightPriceScale:{ borderColor:'#2a2e39', minimumWidth:65 },
    timeScale:{ borderColor:'#2a2e39', timeVisible:true, secondsVisible:true, rightOffset:5 },
    handleScroll:true, handleScale:true,
  });
  const as = chart.addAreaSeries({
    lineColor:'#2196f3',
    topColor:'rgba(33,150,243,0.3)',
    bottomColor:'rgba(33,150,243,0.0)',
    lineWidth:2,
    crosshairMarkerVisible:true,
  });
  charts[sym] = chart;
  areaSeries[sym] = as;
  priceLines[sym] = {};
  new ResizeObserver(() => {
    chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
  }).observe(el);
});

// ── Load historical prices ────────────────────────────────────────────────────
// No candle preload needed — chart builds from live ticks

// ── Set price level lines ─────────────────────────────────────────────────────
function setLevels(sym, levels) {
  if (!levels) return;
  const defs = [
    { key:'sl',    price: levels.sl,    color:'#ef5350', label:'SL',    style: 2 },
    { key:'entry', price: levels.entry, color:'#ffc107', label:'Entry', style: 0 },
    { key:'t1',    price: levels.t1,    color:'#26a69a', label:'T1',    style: 2 },
    { key:'t2',    price: levels.t2,    color:'#2196f3', label:'T2',    style: 1 },
  ];
  defs.forEach(({ key, price, color, label, style }) => {
    if (!price || isNaN(price)) return;
    try { if (priceLines[sym][key]) areaSeries[sym].removePriceLine(priceLines[sym][key]); } catch(e){}
    priceLines[sym][key] = areaSeries[sym].createPriceLine({ price, color, lineWidth:1, lineStyle:style, axisLabelVisible:true, title:label });
  });
}

// ── Update live data in UI ────────────────────────────────────────────────────
function applyLive(data) {
  // NIFTY header
  if (data.nifty) {
    const n = data.nifty;
    const up = n.pChange >= 0;
    document.getElementById('nifty-price').textContent = '\u20b9' + (n.price||0).toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2});
    document.getElementById('nifty-price').className = 'nifty-price ' + (up?'up':'dn');
    document.getElementById('nifty-change').textContent = (up?'\u25b2':'\u25bc') + ' ' + Math.abs(n.pChange).toFixed(2) + '%  NIFTY 50';
    document.getElementById('nifty-change').className = 'nifty-change ' + (up?'up':'dn');
    document.getElementById('nifty-ohlc').textContent = 'O:' + n.open + '  H:' + n.high + '  L:' + n.low;
    const total = (n.adv+n.dec)||1;
    const advPct = Math.round(n.adv/total*100);
    document.getElementById('breadth-text').textContent = 'Adv ' + n.adv + ' \u2191  Dec ' + n.dec + ' \u2193';
    document.getElementById('breadth-bar').innerHTML =
      '<div style="flex:'+advPct+';background:#26a69a;"></div>' +
      '<div style="flex:'+(100-advPct)+';background:#ef5350;"></div>';
    document.getElementById('breadth-detail').innerHTML =
      '<span class="up">\u25b2 ' + n.adv + ' advancing</span><br>' +
      '<span class="dn">\u25bc ' + n.dec + ' declining</span><br>' +
      '<span class="up">Strong up (>1%): ' + n.strUp + '</span><br>' +
      '<span class="dn">Strong dn (<-1%): ' + n.strDn + '</span>';
  }

  // Stock panes
  STOCKS.forEach(sym => {
    const s = data.stocks?.[sym];
    if (!s) return;
    const up = s.pChange >= 0;
    const cl = up ? '#26a69a' : '#ef5350';

    document.getElementById('price-'+sym).textContent = '\u20b9' + (s.price||0).toFixed(2);
    document.getElementById('price-'+sym).style.color = cl;
    document.getElementById('chg-'+sym).textContent = (up?'\u25b2':'\u25bc') + ' ' + Math.abs(s.pChange).toFixed(2) + '%';
    document.getElementById('chg-'+sym).style.color = cl;
    document.getElementById('ohlc-'+sym).textContent = 'O:' + s.open + ' H:' + s.high + ' L:' + s.low;
    document.getElementById('score-'+sym).textContent = (s.score||0) + '/10';

    // Levels bar
    const lv = s.levels;
    const sigCl = s.signal === 'BUY' ? 'lv-sig-buy' : s.signal === 'SELL' ? 'lv-sig-sell' : 'lv-sig-hold';
    document.getElementById('levels-'+sym).innerHTML =
      (lv ? [
        '<span class="lv lv-sl">SL \u20b9'+lv.sl+'</span>',
        '<span class="lv lv-en">EN \u20b9'+lv.entry+'</span>',
        '<span class="lv lv-t1">T1 \u20b9'+lv.t1+'</span>',
        lv.t2 ? '<span class="lv lv-t2">T2 \u20b9'+lv.t2+'</span>' : '',
      ].join('') : '') +
      (s.rsi ? '<span class="lv lv-rsi"> RSI:' + s.rsi.toFixed(1) + '</span>' : '') +
      ' <span class="lv '+sigCl+'">'+s.signal+'</span>';

    if (lv) setLevels(sym, lv);

    // Load full tick history (last 30 min) from server
    try {
      const ticks = data.ticks?.[sym] || [];
      if (ticks.length > 0) {
        areaSeries[sym].setData(ticks);
        charts[sym].timeScale().scrollToRealTime();
      }
      // Tint line green/red based on vs entry
      const lv = s.levels;
      const lineColor = lv ? (s.price >= lv.entry ? '#26a69a' : '#ef5350') : '#2196f3';
      const topColor  = lv ? (s.price >= lv.entry ? 'rgba(38,166,154,0.25)' : 'rgba(239,83,80,0.25)') : 'rgba(33,150,243,0.25)';
      areaSeries[sym].applyOptions({ lineColor, topColor, bottomColor: 'rgba(0,0,0,0)' });
    } catch(e) { console.warn('chart update', sym, e.message); }
  });

  // Portfolio sidebar
  if (data.portfolio) {
    const p = data.portfolio;
    const net = parseFloat(p.realizedPnl||0) + parseFloat(p.unrealizedPnl||0);
    const netC = net >= 0 ? '#26a69a' : '#ef5350';
    document.getElementById('pnl-net').textContent = (net>=0?'+':'')+'\u20b9'+Math.abs(net).toFixed(0);
    document.getElementById('pnl-net').style.color = netC;
    document.getElementById('pnl-real').textContent   = '+\u20b9' + parseFloat(p.realizedPnl||0).toFixed(0);
    document.getElementById('pnl-unreal').textContent = (parseFloat(p.unrealizedPnl||0)>=0?'+':'')+'\u20b9'+parseFloat(p.unrealizedPnl||0).toFixed(0);
    document.getElementById('pnl-unreal').style.color = parseFloat(p.unrealizedPnl||0)>=0?'#26a69a':'#ef5350';
    document.getElementById('pnl-value').textContent  = '\u20b9' + p.portfolioValue;
    document.getElementById('pnl-cash').textContent   = '\u20b9' + p.cash;
    document.getElementById('pnl-wr').textContent     = p.winRate || '—';

    document.getElementById('holdings').innerHTML = (p.holdings||[]).map(h => {
      const pnl   = parseFloat(h.unrealizedPnl||0);
      const pnlC  = pnl >= 0 ? '#26a69a' : '#ef5350';
      const ltp   = parseFloat(h.ltp||0);
      const entry = parseFloat(h.avgPrice||0);
      const sl    = data.stocks?.[h.symbol]?.levels?.sl || 0;
      const t1    = data.stocks?.[h.symbol]?.levels?.t1 || ltp*1.05;
      const range = Math.abs(t1-sl)||1;
      const prog  = Math.max(0, Math.min(100, (ltp-sl)/range*100));
      return '<div class="holding-card">' +
        '<div class="h-left">' +
          '<div class="h-sym">' + h.symbol + '</div>' +
          '<div class="h-meta">' + h.qty + ' qty \u00b7 avg \u20b9' + entry.toFixed(1) + '</div>' +
          '<div class="h-prog"><div class="h-prog-fill" style="width:'+prog+'%;background:'+pnlC+'"></div></div>' +
        '</div>' +
        '<div class="h-pnl" style="color:'+pnlC+'">'+(pnl>=0?'+':'')+'\u20b9'+pnl.toFixed(0)+'</div>' +
      '</div>';
    }).join('');
  }
}

// ── Clock ─────────────────────────────────────────────────────────────────────
setInterval(() => {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-IN') + '  IST';
}, 1000);

// ── Poll live data every 5s ───────────────────────────────────────────────────
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  document.getElementById('spinner').style.display = 'inline-block';
  try {
    const r    = await fetch('/api/live');
    const data = await r.json();
    try { applyLive(data); } catch(e2) { console.error('applyLive error:', e2); }
    document.getElementById('status-txt').textContent = 'Live  \u2022  ' + new Date().toLocaleTimeString('en-IN');
    document.getElementById('status-txt').style.color = '#26a69a';
  } catch(e) {
    document.getElementById('status-txt').textContent = 'Fetch error: ' + e.message;
    document.getElementById('status-txt').style.color = '#ef5350';
  } finally {
    document.getElementById('spinner').style.display = 'none';
    refreshing = false;
  }
}

// ── Manual refresh button ─────────────────────────────────────────────────────
document.addEventListener('keydown', e => { if (e.key === 'r' || e.key === 'R') refresh(); });

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  document.getElementById('status-txt').textContent = 'Fetching live prices...';
  await refresh();
  setInterval(refresh, 5000);
})();
</script>
</body>
</html>`;

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);

  } else if (url.pathname === '/api/live') {
    try {
      const data = await getLive();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }

  } else if (url.pathname.startsWith('/api/candles/')) {
    const sym = decodeURIComponent(url.pathname.split('/').pop()).toUpperCase();
    try {
      const candles = await fetchCandles(sym);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(candles));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }

  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log('\n  Trading Dashboard ready!');
  console.log(`  http://localhost:${PORT}\n`);
  console.log('  Press Ctrl+C to stop\n');
  exec(`start http://localhost:${PORT}`);
});
