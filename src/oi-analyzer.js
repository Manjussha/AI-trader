/**
 * Open Interest Analyzer — NSE Option Chain
 * Identifies key support/resistance from OI buildup, max pain, unwinding.
 *
 * Usage:
 *   import { getOILevels } from './src/oi-analyzer.js';
 *   const nseGet = market._nseRequest.bind(market);
 *   const oi = await getOILevels(nseGet, 'NIFTY');
 */

export async function getOILevels(nseOptionChain, symbol = 'NIFTY') {
  try {
    const data      = await nseOptionChain(symbol, true);
    const allRec    = data?.records?.data || [];
    const spot      = data?.records?.underlyingValue;
    const expiries  = data?.records?.expiryDates || [];
    const nearExpiry = expiries[0];

    // Use nearest expiry — v3 API uses 'expiryDates' (plural) on each record
    const records = allRec.filter(r => (r.expiryDates || r.expiryDate) === nearExpiry);

    const strikes = records.map(item => ({
      strike:     item.strikePrice ?? item.CE?.strikePrice ?? item.PE?.strikePrice,
      ceOI:       item.CE?.openInterest        || 0,
      ceOIChg:    item.CE?.changeinOpenInterest || 0,
      ceLTP:      item.CE?.lastPrice           || 0,
      peOI:       item.PE?.openInterest        || 0,
      peOIChg:    item.PE?.changeinOpenInterest || 0,
      peLTP:      item.PE?.lastPrice           || 0,
    })).filter(s => s.ceOI > 0 || s.peOI > 0);

    // Top CE OI strikes = resistance walls
    const resistance = [...strikes]
      .sort((a, b) => b.ceOI - a.ceOI)
      .slice(0, 3)
      .map(s => ({
        strike:  s.strike,
        oi:      Math.round(s.ceOI / 100),
        change:  s.ceOIChg > 0 ? 'ADDING' : 'SHEDDING',
        ltp:     s.ceLTP,
      }));

    // Top PE OI strikes = support walls
    const support = [...strikes]
      .sort((a, b) => b.peOI - a.peOI)
      .slice(0, 3)
      .map(s => ({
        strike:  s.strike,
        oi:      Math.round(s.peOI / 100),
        change:  s.peOIChg > 0 ? 'ADDING' : 'SHEDDING',
        ltp:     s.peLTP,
      }));

    // Fresh CE buildup (resistance building) — bearish
    const ceBuildup = [...strikes]
      .filter(s => s.ceOIChg > 0 && s.strike > spot)
      .sort((a, b) => b.ceOIChg - a.ceOIChg)
      .slice(0, 2);

    // Fresh PE buildup (support building) — bullish
    const peBuildup = [...strikes]
      .filter(s => s.peOIChg > 0 && s.strike < spot)
      .sort((a, b) => b.peOIChg - a.peOIChg)
      .slice(0, 2);

    // CE unwinding (resistance weakening) — bullish
    const ceUnwinding = [...strikes]
      .filter(s => s.ceOIChg < 0 && s.strike > spot)
      .sort((a, b) => a.ceOIChg - b.ceOIChg)
      .slice(0, 2);

    // PE unwinding (support crumbling) — bearish
    const peUnwinding = [...strikes]
      .filter(s => s.peOIChg < 0 && s.strike < spot)
      .sort((a, b) => a.peOIChg - b.peOIChg)
      .slice(0, 2);

    // Max pain — strike where total P&L loss for option buyers is maximum
    // (i.e., option writers profit most here — price tends to gravitate toward this)
    let minBuyerValue = Infinity, maxPain = spot;
    for (const { strike } of strikes) {
      let buyerLoss = 0;
      for (const s of strikes) {
        // CE buyers lose if strike > expiry price
        if (s.strike < strike) buyerLoss += s.ceOI * (strike - s.strike);
        // PE buyers lose if strike < expiry price
        if (s.strike > strike) buyerLoss += s.peOI * (s.strike - strike);
      }
      if (buyerLoss < minBuyerValue) { minBuyerValue = buyerLoss; maxPain = strike; }
    }

    const bias = ceBuildup.length > peBuildup.length ? 'BEARISH' :
                 peBuildup.length > ceBuildup.length ? 'BULLISH' : 'NEUTRAL';

    return {
      symbol, spot, expiry: nearExpiry, maxPain,
      resistance, support,
      ceBuildup, peBuildup, ceUnwinding, peUnwinding,
      bias,
      interpretation: maxPain > spot
        ? `Max pain ₹${maxPain} above spot — market may drift UP toward ₹${maxPain} by expiry`
        : maxPain < spot
        ? `Max pain ₹${maxPain} below spot — market may drift DOWN toward ₹${maxPain} by expiry`
        : `Spot at max pain ₹${maxPain} — expect consolidation`,
    };
  } catch (e) { return { error: e.message }; }
}
