// F&O full research + 10-min outlook
import { GrowwClient } from '../src/groww-client.js';
import { rsi, macd, bollingerBands, atr, vwap, stochastic, superTrend, supportResistance, volatility, generateSignal } from '../src/analytics.js';
import { scanPatterns } from '../src/patterns.js';
import { detectRegime, suggestStrategy, analyzePCR, ivPercentile, analyzeFO } from '../src/fo-skill.js';

const m = new GrowwClient({ apiKey: '', totpSecret: '' });
const pad = (s, n) => String(s).padEnd(n);
const fmt = n => (typeof n === 'number' ? n.toFixed(2) : n);

async function getIdx(name, urlName) {
  try {
    const d = await m._nseRequest(`/equity-stockIndices?index=${encodeURIComponent(urlName)}`);
    const row = d?.data?.find(x => x.symbol === name || x.priority === 1) || d?.data?.[0];
    return row;
  } catch (e) { return null; }
}

async function yahooRaw(sym, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
  const data = await res.json();
  const r = data?.chart?.result?.[0];
  if (!r || !r.timestamp) return null;
  const o = r.indicators?.quote?.[0];
  return r.timestamp.map((t, i) => ({
    date: new Date(t * 1000).toISOString(),
    open: o?.open?.[i], high: o?.high?.[i], low: o?.low?.[i],
    close: o?.close?.[i], volume: o?.volume?.[i] || 0
  })).filter(c => c.close != null);
}

async function histYahoo(sym) { try { return await yahooRaw(sym, '3mo', '1d'); } catch (e) { return null; } }
async function histIntraday(sym) { try { return await yahooRaw(sym, '1d', '5m'); } catch (e) { return null; } }

function analyze(name, spot, dayCandles, intradayCandles) {
  const closes = dayCandles.map(c => c.close);
  const highs = dayCandles.map(c => c.high);
  const lows = dayCandles.map(c => c.low);
  const vols = dayCandles.map(c => c.volume);

  const r = rsi(closes);
  const mc = macd(closes);
  const bb = bollingerBands(closes);
  const a = atr(dayCandles, 14);
  const st = superTrend(dayCandles);
  const stoch = stochastic(closes, highs, lows);
  const sr = supportResistance(highs, lows);
  const v = volatility(closes);
  const vw = vwap(dayCandles.slice(-20));
  const sig = generateSignal(closes, vols);
  const patterns = scanPatterns(dayCandles).slice(0, 3);
  const wkRsi = rsi(closes.slice(-30));

  // Intraday 10-min outlook
  let intraOutlook = null;
  if (intradayCandles && intradayCandles.length >= 20) {
    const ic = intradayCandles;
    const icCloses = ic.map(c => c.close);
    const icHighs = ic.map(c => c.high);
    const icLows = ic.map(c => c.low);
    const iRsi = rsi(icCloses, 14);
    const iMacd = macd(icCloses);
    const iAtr = atr(ic, 14);
    const iSt = superTrend(ic);
    const iStoch = stochastic(icCloses, icHighs, icLows);
    const iBB = bollingerBands(icCloses);
    const iVwap = vwap(ic.slice(-20));
    const last5 = icCloses.slice(-5);
    const mom5 = ((last5[last5.length - 1] - last5[0]) / last5[0]) * 100;
    const last = ic[ic.length - 1];
    const avgVol = ic.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    const lastVol = last.volume;
    const volSpike = lastVol / avgVol;

    // Direction scoring
    let bull = 0, bear = 0;
    if (iRsi > 55) bull++; if (iRsi < 45) bear++;
    if (iRsi > 70) bear++; if (iRsi < 30) bull++;
    if (iMacd.histogram > 0) bull++; else bear++;
    if (iSt.trend === 'BULLISH') bull++; else bear++;
    if (iStoch.K > iStoch.D && iStoch.K < 80) bull++;
    if (iStoch.K < iStoch.D && iStoch.K > 20) bear++;
    if (last.close > iVwap) bull++; else bear++;
    if (last.close > iBB.middle) bull++; else bear++;
    if (mom5 > 0.1) bull++; if (mom5 < -0.1) bear++;
    if (volSpike > 1.5 && last.close > last.open) bull++;
    if (volSpike > 1.5 && last.close < last.open) bear++;

    const bias = bull > bear ? 'BULLISH' : bear > bull ? 'BEARISH' : 'NEUTRAL';
    const strength = Math.abs(bull - bear);
    const expectedRange = iAtr * 0.5; // ~10min = ~2 candles of 5m
    const target = bias === 'BULLISH' ? spot + expectedRange : bias === 'BEARISH' ? spot - expectedRange : spot;

    intraOutlook = { iRsi, iMacd, iAtr, iSt, iStoch, iVwap, mom5, volSpike, bull, bear, bias, strength, expectedRange, target };
  }

  return { name, spot, r, mc, bb, a, st, stoch, sr, v, vw, sig, patterns, wkRsi, intraOutlook };
}

function printIdx(x) {
  console.log(`\n━━━ ${x.name} ━━━`);
  console.log(`Spot: ${fmt(x.spot)}   RSI(14): ${fmt(x.r)}   Weekly RSI: ${fmt(x.wkRsi)}`);
  console.log(`MACD: ${fmt(x.mc.macd)}  Signal: ${fmt(x.mc.signal)}  Hist: ${fmt(x.mc.histogram)}`);
  console.log(`BB:   U=${fmt(x.bb.upper)}  M=${fmt(x.bb.middle)}  L=${fmt(x.bb.lower)}   ATR: ${fmt(x.a)}`);
  console.log(`Stoch: K=${fmt(x.stoch.K)} D=${fmt(x.stoch.D)}  ${x.stoch.oversold?'OVERSOLD':x.stoch.overbought?'OVERBOUGHT':''}`);
  console.log(`SuperTrend: ${x.st.trend}   VWAP(20): ${fmt(x.vw)}   Vol%: ${fmt(x.v)}`);
  console.log(`Support: ${fmt(x.sr.support)}   Resistance: ${fmt(x.sr.resistance)}`);
  console.log(`Daily Signal: ${x.sig.signal} (${x.sig.confidence}%)  → ${x.sig.reasons.join(' | ')}`);
  if (x.patterns.length) console.log(`Patterns: ${x.patterns.map(p => `${p.pattern}[${p.sentiment}/${p.strength}]`).join(', ')}`);

  if (x.intraOutlook) {
    const o = x.intraOutlook;
    console.log(`\n  ▸ INTRADAY (5m):`);
    console.log(`    RSI: ${fmt(o.iRsi)}  MACD Hist: ${fmt(o.iMacd.histogram)}  ST: ${o.iSt.trend}`);
    console.log(`    Stoch: K=${fmt(o.iStoch.K)} D=${fmt(o.iStoch.D)}   VWAP: ${fmt(o.iVwap)}   ATR(5m): ${fmt(o.iAtr)}`);
    console.log(`    5-candle mom: ${fmt(o.mom5)}%   Vol spike: ${fmt(o.volSpike)}x`);
    console.log(`    ⚡ 10-MIN BIAS: ${o.bias}  (Bull:${o.bull} Bear:${o.bear} → strength ${o.strength})`);
    console.log(`    Expected range: ±${fmt(o.expectedRange)}   Target: ~${fmt(o.target)}`);
  }
}

(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  F&O MARKET RESEARCH  —  ' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
  console.log('═══════════════════════════════════════════════════════');

  // Market status
  const status = await m.getMarketStatus().catch(() => null);
  if (status) {
    console.log('\nMARKET STATUS:');
    (status.marketState || status.marketStatus || []).slice(0, 4).forEach(s => {
      console.log(`  ${pad(s.market || s.index || '', 20)} ${s.marketStatus || s.status || ''}`);
    });
  }

  // VIX
  let vix = null;
  try {
    const v = await m._nseRequest('/allIndices');
    const vixRow = v?.data?.find(d => /VIX/i.test(d.index || d.indexName || ''));
    vix = vixRow ? +vixRow.last : null;
    if (vix) console.log(`\nINDIA VIX: ${fmt(vix)}`);
  } catch (e) {}

  // Indices
  const [niftyRow, bankRow, finRow] = await Promise.all([
    getIdx('NIFTY 50', 'NIFTY 50'),
    getIdx('NIFTY BANK', 'NIFTY BANK'),
    getIdx('NIFTY FIN SERVICE', 'NIFTY FIN SERVICE'),
  ]);

  const indices = [
    { name: 'NIFTY 50', row: niftyRow, sym: '^NSEI', lot: 75 },
    { name: 'BANKNIFTY', row: bankRow, sym: '^NSEBANK', lot: 30 },
    { name: 'FINNIFTY', row: finRow, sym: 'NIFTY_FIN_SERVICE.NS', lot: 40 },
  ];

  if (niftyRow) {
    console.log(`\nNIFTY:     ${fmt(niftyRow.lastPrice)}   ${fmt(niftyRow.change)} (${fmt(niftyRow.pChange)}%)`);
    console.log(`           H: ${fmt(niftyRow.dayHigh)}  L: ${fmt(niftyRow.dayLow)}   Open: ${fmt(niftyRow.open)}   Prev: ${fmt(niftyRow.previousClose)}`);
  }
  if (bankRow) {
    console.log(`BANKNIFTY: ${fmt(bankRow.lastPrice)}   ${fmt(bankRow.change)} (${fmt(bankRow.pChange)}%)`);
    console.log(`           H: ${fmt(bankRow.dayHigh)}  L: ${fmt(bankRow.dayLow)}   Open: ${fmt(bankRow.open)}   Prev: ${fmt(bankRow.previousClose)}`);
  }
  if (finRow) {
    console.log(`FINNIFTY:  ${fmt(finRow.lastPrice)}   ${fmt(finRow.change)} (${fmt(finRow.pChange)}%)`);
  }

  // Per-index deep analysis
  for (const idx of indices) {
    if (!idx.row) continue;
    const [day, intra] = await Promise.all([
      histYahoo(idx.sym).catch(() => null),
      histIntraday(idx.sym).catch(() => null),
    ]);
    if (!day || day.length < 30) { console.log(`\n${idx.name}: insufficient history (${day?.length||0} candles)`); continue; }
    const spot = +idx.row.lastPrice;
    const res = analyze(idx.name, spot, day, intra);
    printIdx(res);

    // F&O strategy suggestion
    try {
      const ivEst = (res.v / 100) || 0.18;
      const regime = detectRegime({
        rsi: res.r, macdHist: res.mc.histogram, atr: res.a,
        atrAvg: res.a, bbWidth: (res.bb.upper - res.bb.lower) / res.bb.middle,
        superTrend: res.st.trend, weeklyRsi: res.wkRsi, vix: vix || 14
      });
      const strat = suggestStrategy({
        spot, regime, iv: ivEst, vix: vix || 14,
        rsi: res.r, daysToExpiry: 7, capital: 200000, lotSize: idx.lot
      });
      console.log(`\n  ▸ Regime: ${regime}`);
      console.log(`  ▸ Top strategies (IV est ${(ivEst*100).toFixed(1)}%, DTE 7):`);
      (strat || []).slice(0, 3).forEach((s, i) => {
        console.log(`     ${i+1}. ${s.name || s.strategy}  — score ${s.score ?? ''}  ${s.reason || ''}`);
      });
    } catch (e) { console.log(`  (strategy err: ${e.message})`); }
  }

  // PCR
  try {
    const pcrData = await m._nseRequest('/option-chain-indices?symbol=NIFTY').catch(() => null);
    if (pcrData?.filtered?.CE && pcrData?.filtered?.PE) {
      const ceOi = pcrData.filtered.CE.totOI || 0;
      const peOi = pcrData.filtered.PE.totOI || 0;
      const pcr = peOi / ceOi;
      console.log(`\n━━━ NIFTY OPTION CHAIN ━━━`);
      console.log(`Total CE OI: ${ceOi.toLocaleString()}`);
      console.log(`Total PE OI: ${peOi.toLocaleString()}`);
      console.log(`PCR: ${fmt(pcr)}   → ${analyzePCR(pcr).interpretation || analyzePCR(pcr)}`);
    }
  } catch (e) { console.log(`\n(option chain err: ${e.message})`); }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' DONE. Not financial advice. Always size with 1% risk.');
  console.log('═══════════════════════════════════════════════════════\n');
})().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
