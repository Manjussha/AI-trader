/**
 * Market Pulse — FII/DII activity + Put-Call Ratio
 * All data from NSE India public API (no auth needed).
 *
 * Usage:
 *   import { getFIIDII, getPCR } from './src/market-pulse.js';
 *   const nseGet = market._nseRequest.bind(market);
 *   const fii = await getFIIDII(nseGet);
 *   const pcr = await getPCR(nseGet, 'NIFTY');
 */

/**
 * Last 5 days FII/DII net buy/sell data.
 * Returns { fii[], dii[], fiiNet5d, diiNet5d, fiiBias, diiBias, marketBias }
 */
export async function getFIIDII(nseGet) {
  try {
    const data = await nseGet('/fiidiiTradeReact');
    if (!Array.isArray(data)) return null;

    const parse = (val) => parseFloat((val || '0').toString().replace(/,/g, ''));

    const fiiRows = data.filter(r => r.category?.includes('FII') || r.category?.includes('FPI'));
    const diiRows = data.filter(r => r.category?.includes('DII'));

    const fmt = rows => rows.slice(0, 5).map(r => ({
      date:  r.date,
      buy:   parse(r.buyValue),
      sell:  parse(r.sellValue),
      net:   parse(r.netValue),
    }));

    const fii = fmt(fiiRows);
    const dii = fmt(diiRows);

    const fiiNet5d = fii.reduce((s, r) => s + r.net, 0);
    const diiNet5d = dii.reduce((s, r) => s + r.net, 0);

    return {
      fii, dii,
      fiiNet5d:   fiiNet5d.toFixed(0),
      diiNet5d:   diiNet5d.toFixed(0),
      fiiBias:    fiiNet5d >= 0 ? 'BUYING' : 'SELLING',
      diiBias:    diiNet5d >= 0 ? 'BUYING' : 'SELLING',
      marketBias: fiiNet5d + diiNet5d >= 0 ? 'BULLISH' : 'BEARISH',
    };
  } catch { return null; }
}

/**
 * Put-Call Ratio from NIFTY or BANKNIFTY option chain.
 * PCR > 1.2 → market oversold (bullish reversal likely)
 * PCR < 0.7 → market overbought (bearish reversal likely)
 */
export async function getPCR(nseOptionChain, symbol = 'NIFTY') {
  try {
    const data    = await nseOptionChain(symbol, true);
    const records = data?.records?.data || [];
    const spot    = data?.records?.underlyingValue;

    let totalPEOI = 0, totalCEOI = 0;
    let totalPEVol = 0, totalCEVol = 0;

    for (const item of records) {
      totalPEOI  += item.PE?.openInterest        || 0;
      totalCEOI  += item.CE?.openInterest        || 0;
      totalPEVol += item.PE?.totalTradedVolume   || 0;
      totalCEVol += item.CE?.totalTradedVolume   || 0;
    }

    const pcrOI  = totalCEOI  > 0 ? totalPEOI  / totalCEOI  : 0;
    const pcrVol = totalCEVol > 0 ? totalPEVol / totalCEVol : 0;

    const sentiment =
      pcrOI > 1.2 ? 'BULLISH' :
      pcrOI < 0.7 ? 'BEARISH' : 'NEUTRAL';

    const note =
      pcrOI > 1.5 ? 'Extremely oversold — strong reversal expected' :
      pcrOI > 1.2 ? 'Bearish sentiment heavy — bulls may take over' :
      pcrOI < 0.5 ? 'Extremely overbought — sharp fall possible' :
      pcrOI < 0.7 ? 'Bullish optimism high — bears may push back' :
                    'Balanced market — no strong directional bias';

    return {
      symbol, spot,
      pcrOI:     pcrOI.toFixed(2),
      pcrVol:    pcrVol.toFixed(2),
      sentiment,
      note,
      totalPEOI: Math.round(totalPEOI / 100),   // in hundreds (standard display)
      totalCEOI: Math.round(totalCEOI / 100),
    };
  } catch { return null; }
}
