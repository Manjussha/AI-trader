/**
 * Background Cache Refresher
 * Run once: node cache-refresh.mjs
 * Pre-fetches historical + indicators for watchlist → saves to cache.json
 * Takes 20-30s to run, but then all quick commands are instant (<2s)
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { GrowwClient } from './src/groww-client.js';
import { rsi, macd, bollingerBands, atr, superTrend, vwap,
         supportResistance, ema, sma, stochastic, generateSignal } from './src/analytics.js';
import { scanPatterns } from './src/patterns.js';

const CACHE_FILE = './cache.json';
const WATCHLIST  = [
  'NIFTY',                                          // index
  'TECHM','WIPRO','BEL','NTPC',                     // current holdings
  'INFY','TCS','HCLTECH',                            // IT
  'RELIANCE','HINDALCO',                             // momentum
  'ICICIBANK','HDFCBANK','AXISBANK','SBIN',          // banking
  'ANGELONE','BAJFINANCE','BAJAJFINSV',              // finance
  'ADANIENT','TATASTEEL','JSWSTEEL',                 // metal/infra
  'SUNPHARMA','CIPLA','DRREDDY',                     // pharma
  'BDL','HAL','RVNL','POWERGRID','COALINDIA',        // PSU
];

const market = new GrowwClient({ apiKey: '', totpSecret: '' });

async function analyzeStock(symbol) {
  const hist = await market.getHistoricalDataYahoo(symbol, 'NSE', 90, '1d');
  const candles = hist.candles;
  if (!candles || candles.length < 20) return null;

  const closes = candles.map(c => parseFloat(c.close));
  const highs  = candles.map(c => parseFloat(c.high));
  const lows   = candles.map(c => parseFloat(c.low));
  const vols   = candles.map(c => parseFloat(c.volume));

  const rsiVal  = rsi(closes);
  const macdVal = macd(closes);
  const bb      = bollingerBands(closes);
  const atrVal  = atr(candles, 14);
  const st      = superTrend(candles);
  const sr      = supportResistance(highs, lows);
  const vwapVal = vwap(candles.slice(-20));
  const ema9v   = ema(closes, 9);
  const ema21v  = ema(closes, 21);
  const sma50v  = sma(closes, 50);
  const signal  = generateSignal(closes, vols);
  const patterns= scanPatterns(candles.slice(-5));
  const stoch   = stochastic(closes, highs, lows);

  const avgVol20 = vols.slice(-20).reduce((a,b)=>a+b,0)/20;
  const last5    = closes.slice(-5);
  const live     = closes[closes.length-1];

  // Confluence score
  let score = 0;
  if (signal.signal === 'BUY')  score += 2;
  if (rsiVal < 35) score += 2; else if (rsiVal < 45) score += 1;
  if (stoch.oversold) score += 1;
  if (st?.trend === 'BULLISH') score += 1;
  if (live > vwapVal) score += 1;
  if (live < bb.lower) score += 1;
  if (Math.abs(live - sr.support) / sr.support < 0.015) score += 1;
  const bullPat = patterns.filter(p => p.sentiment === 'BULLISH' && p.barsAgo <= 3);
  if (bullPat.length > 0) score += 1;

  const sl = parseFloat((live - 2 * atrVal).toFixed(2));
  const t1 = parseFloat((live + 1.5 * (live - sl)).toFixed(2));
  const t2 = parseFloat((live + 3.0 * (live - sl)).toFixed(2));

  return {
    symbol,
    cachedAt: new Date().toISOString(),
    lastClose: live,
    rsi:       parseFloat(rsiVal?.toFixed(2)),
    macd:      { macd: parseFloat(macdVal.macd?.toFixed(2)), signal: parseFloat(macdVal.signal?.toFixed(2)), hist: parseFloat(macdVal.histogram?.toFixed(2)) },
    bb:        { upper: parseFloat(bb.upper?.toFixed(2)), middle: parseFloat(bb.middle?.toFixed(2)), lower: parseFloat(bb.lower?.toFixed(2)) },
    atr:       parseFloat(atrVal?.toFixed(2)),
    superTrend:{ trend: st?.trend, line: parseFloat(st?.line?.toFixed(2)) },
    vwap:      parseFloat(vwapVal?.toFixed(2)),
    ema:       { e9: parseFloat(ema9v?.toFixed(2)), e21: parseFloat(ema21v?.toFixed(2)), s50: parseFloat(sma50v?.toFixed(2)) },
    sr:        { support: parseFloat(sr.support?.toFixed(2)), resistance: parseFloat(sr.resistance?.toFixed(2)) },
    signal:    signal.signal,
    confidence:signal.confidence,
    score,
    patterns:  bullPat.map(p => ({ name: p.pattern, strength: p.strength })),
    levels:    { entry: live, sl, t1, t2 },
    avgVol20:  Math.round(avgVol20),
    last5closes: last5.map(c => parseFloat(c.toFixed(2))),
  };
}

async function main() {
  console.log(`🔄 Cache refresh started — ${WATCHLIST.length} symbols`);
  console.log('This takes ~30s. Run this once before trading session.\n');

  const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};
  cache.refreshedAt = new Date().toISOString();
  cache.stocks = cache.stocks || {};

  // Also fetch NIFTY index data
  try {
    const niftyData = await market._nseRequest('/equity-stockIndices?index=NIFTY%2050');
    const n = niftyData?.data?.[0];
    cache.nifty = {
      price: parseFloat(n?.lastPrice), open: parseFloat(n?.open),
      high: parseFloat(n?.dayHigh), low: parseFloat(n?.dayLow),
      pChange: parseFloat(n?.pChange), prevClose: parseFloat(n?.previousClose),
    };
    const stocks = niftyData?.data?.slice(1) || [];
    cache.breadth = {
      advances: stocks.filter(s => s.pChange > 0).length,
      declines:  stocks.filter(s => s.pChange < 0).length,
    };
    console.log(`✓ NIFTY: ₹${cache.nifty.price} (${cache.nifty.pChange}%)`);
  } catch(e) { console.log('NIFTY fetch error:', e.message); }

  // Analyze each stock
  for (const sym of WATCHLIST) {
    if (sym === 'NIFTY') continue;
    try {
      const data = await analyzeStock(sym);
      if (data) {
        cache.stocks[sym] = data;
        const scoreBar = '█'.repeat(data.score) + '░'.repeat(10 - data.score);
        console.log(`✓ ${sym.padEnd(12)} RSI:${data.rsi?.toFixed(0).padEnd(4)} Score:${data.score}/10 [${scoreBar}] ${data.signal}`);
      }
    } catch(e) {
      console.log(`✗ ${sym}: ${e.message}`);
    }
  }

  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log(`\n✅ Cache saved → cache.json (${Object.keys(cache.stocks).length} stocks)`);
  console.log('Now use: node quick.mjs <SYMBOL> for instant analysis!');
}

main();
