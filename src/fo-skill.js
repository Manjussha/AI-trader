/**
 * F&O AI Skill — Complete Options Trading Brain
 * ─────────────────────────────────────────────
 * Covers: Strategy selection, Greeks, IV analysis, OI, PCR,
 * Max Pain, Skew, Risk sizing, Entry/Exit rules, Backtesting
 *
 * Usage:
 *   import { analyzeFO, suggestStrategy, sizePosition, scoreStrategy } from './src/fo-skill.js';
 */

// ─── BLACK-SCHOLES ENGINE ────────────────────────────────────────────────────

// Accurate CND using error function (erf) — avoids polynomial coefficient bugs
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const r = 1 - p * Math.exp(-x * x);
  return x >= 0 ? r : -r;
}
function cnd(x) { return (1 + erf(x / Math.sqrt(2))) / 2; }
function npdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

/**
 * Full Black-Scholes Greeks
 */
export function greeks(S, K, T, r, iv, type = 'CE') {
  if (T <= 0 || iv <= 0) {
    const intr = type === 'CE' ? Math.max(0, S - K) : Math.max(0, K - S);
    return { premium: intr, delta: type === 'CE' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0, rho: 0, iv, intrinsic: intr, timeValue: 0 };
  }
  const d1 = (Math.log(S / K) + (r + 0.5 * iv * iv) * T) / (iv * Math.sqrt(T));
  const d2 = d1 - iv * Math.sqrt(T);
  const premium = type === 'CE'
    ? S * cnd(d1) - K * Math.exp(-r * T) * cnd(d2)
    : K * Math.exp(-r * T) * cnd(-d2) - S * cnd(-d1);
  const delta = type === 'CE' ? cnd(d1) : cnd(d1) - 1;
  const gamma = npdf(d1) / (S * iv * Math.sqrt(T));
  const vega  = S * npdf(d1) * Math.sqrt(T) / 100;
  const theta = type === 'CE'
    ? (-(S * npdf(d1) * iv) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * cnd(d2)) / 365
    : (-(S * npdf(d1) * iv) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * cnd(-d2)) / 365;
  const rho = type === 'CE'
    ? K * T * Math.exp(-r * T) * cnd(d2) / 100
    : -K * T * Math.exp(-r * T) * cnd(-d2) / 100;
  return { premium, delta, gamma, theta, vega, rho, iv, intrinsic: type === 'CE' ? Math.max(0, S - K) : Math.max(0, K - S), timeValue: premium - Math.max(0, type === 'CE' ? S - K : K - S) };
}

/**
 * Implied Volatility — Newton-Raphson method
 */
export function impliedVol(marketPrice, S, K, T, r, type = 'CE', maxIter = 100) {
  let sigma = 0.20;
  for (let i = 0; i < maxIter; i++) {
    const g = greeks(S, K, T, r, sigma, type);
    const diff = g.premium - marketPrice;
    if (Math.abs(diff) < 0.001) break;
    const vega = g.vega * 100; // un-normalize
    if (Math.abs(vega) < 1e-10) break;
    sigma -= diff / vega;
    sigma = Math.max(0.001, Math.min(sigma, 5.0));
  }
  return sigma;
}

// ─── GROWW CHARGES ─────────────────────────────────────────────────────────

/**
 * Compute Groww F&O charges for a trade leg
 */
export function growwCharges(premium, qty, side) {
  const tv    = premium * qty;
  const brok  = Math.min(20, tv * 0.0005);           // ₹20 flat or 0.05%
  const stt   = side === 'sell' ? tv * 0.000625 : 0; // 0.0625% on sell
  const exc   = tv * 0.00053;                        // NSE 0.053%
  const gst   = (brok + exc) * 0.18;                // 18% on brok+exc
  const stamp = side === 'buy' ? tv * 0.00003 : 0;  // 0.003% on buy
  const sebi  = tv * 0.000001 * 100;
  const total = brok + stt + exc + gst + stamp + sebi;
  return { brok, stt, exc, gst, stamp, sebi, total, tradeValue: tv };
}

// ─── STRATEGY BUILDERS ────────────────────────────────────────────────────

/**
 * Bull Put Spread — sell lower put, buy even lower put
 * Bullish/Neutral | Credit received | Defined risk
 */
export function bullPutSpread({ spot, sellStrike, buyStrike, T, iv, r = 0.065, lot }) {
  const sell = greeks(spot, sellStrike, T, r, iv, 'PE');
  const buy  = greeks(spot, buyStrike,  T, r, iv, 'PE');
  const credit  = sell.premium - buy.premium;
  const width   = sellStrike - buyStrike;
  const cSell   = growwCharges(sell.premium, lot, 'sell');
  const cBuy    = growwCharges(buy.premium,  lot, 'buy');
  const charges = cSell.total + cBuy.total;
  return {
    strategy: 'Bull Put Spread',
    bias: 'BULLISH/NEUTRAL',
    legs: [
      { type: 'SELL', strike: sellStrike, optType: 'PE', premium: sell.premium, delta: sell.delta, theta: sell.theta },
      { type: 'BUY',  strike: buyStrike,  optType: 'PE', premium: buy.premium,  delta: buy.delta,  theta: buy.theta },
    ],
    credit,
    maxProfit:  credit * lot - charges,
    maxLoss:    (width - credit) * lot + charges,
    margin:     (width - credit) * lot,
    breakeven:  sellStrike - credit,
    charges,
    netDelta:   sell.delta - buy.delta,
    netTheta:   (sell.theta - buy.theta) * lot,
    profitProb: cnd((sellStrike - spot - credit) / (spot * iv * Math.sqrt(T))) * -1 + 1,
  };
}

/**
 * Bear Call Spread — sell lower call, buy higher call
 * Bearish/Neutral | Credit received | Defined risk
 */
export function bearCallSpread({ spot, sellStrike, buyStrike, T, iv, r = 0.065, lot }) {
  const sell = greeks(spot, sellStrike, T, r, iv, 'CE');
  const buy  = greeks(spot, buyStrike,  T, r, iv, 'CE');
  const credit  = sell.premium - buy.premium;
  const width   = buyStrike - sellStrike;
  const cSell   = growwCharges(sell.premium, lot, 'sell');
  const cBuy    = growwCharges(buy.premium,  lot, 'buy');
  const charges = cSell.total + cBuy.total;
  return {
    strategy: 'Bear Call Spread',
    bias: 'BEARISH/NEUTRAL',
    legs: [
      { type: 'SELL', strike: sellStrike, optType: 'CE', premium: sell.premium, delta: sell.delta, theta: sell.theta },
      { type: 'BUY',  strike: buyStrike,  optType: 'CE', premium: buy.premium,  delta: buy.delta,  theta: buy.theta },
    ],
    credit,
    maxProfit:  credit * lot - charges,
    maxLoss:    (width - credit) * lot + charges,
    margin:     (width - credit) * lot,
    breakeven:  sellStrike + credit,
    charges,
    netDelta:   sell.delta - buy.delta,
    netTheta:   (sell.theta - buy.theta) * lot,
  };
}

/**
 * Iron Condor — bull put spread + bear call spread
 * Neutral | Best in low-volatility, range-bound markets
 */
export function ironCondor({ spot, putSell, putBuy, callSell, callBuy, T, iv, r = 0.065, lot }) {
  const ps = bullPutSpread({ spot, sellStrike: putSell,  buyStrike: putBuy,   T, iv, r, lot });
  const cs = bearCallSpread({ spot, sellStrike: callSell, buyStrike: callBuy, T, iv, r, lot });
  const totalCredit  = ps.credit + cs.credit;
  const totalCharges = ps.charges + cs.charges;
  const spreadWidth  = Math.max(putSell - putBuy, callBuy - callSell);
  return {
    strategy: 'Iron Condor',
    bias: 'NEUTRAL',
    legs: [...ps.legs, ...cs.legs],
    credit: totalCredit,
    maxProfit:   totalCredit * lot - totalCharges,
    maxLoss:     (spreadWidth - totalCredit) * lot + totalCharges,
    margin:      (spreadWidth - totalCredit) * lot,
    profitZone:  [putSell - totalCredit, callSell + totalCredit],
    putBreakeven:  putSell - totalCredit,
    callBreakeven: callSell + totalCredit,
    charges: totalCharges,
    netTheta: (ps.netTheta + cs.netTheta),
  };
}

/**
 * Long Straddle — buy ATM call + put
 * Volatility play — profit from big move either direction
 */
export function longStraddle({ spot, strike, T, iv, r = 0.065, lot }) {
  const call = greeks(spot, strike, T, r, iv, 'CE');
  const put  = greeks(spot, strike, T, r, iv, 'PE');
  const cost = call.premium + put.premium;
  const cCall = growwCharges(call.premium, lot, 'buy');
  const cPut  = growwCharges(put.premium,  lot, 'buy');
  const charges = cCall.total + cPut.total;
  return {
    strategy: 'Long Straddle',
    bias: 'VOLATILE (direction-neutral)',
    legs: [
      { type: 'BUY', strike, optType: 'CE', premium: call.premium, delta: call.delta },
      { type: 'BUY', strike, optType: 'PE', premium: put.premium,  delta: put.delta },
    ],
    cost,
    maxLoss:    cost * lot + charges,
    maxProfit:  Infinity,
    upperBE:    strike + cost,
    lowerBE:    strike - cost,
    beMoveNeeded: (cost / spot * 100).toFixed(2) + '%',
    charges,
    netVega:    (call.vega + put.vega) * lot,
    netTheta:   (call.theta + put.theta) * lot,
  };
}

/**
 * Long Strangle — buy OTM call + OTM put (cheaper than straddle)
 */
export function longStrangle({ spot, callStrike, putStrike, T, iv, r = 0.065, lot }) {
  const call = greeks(spot, callStrike, T, r, iv, 'CE');
  const put  = greeks(spot, putStrike,  T, r, iv, 'PE');
  const cost = call.premium + put.premium;
  const charges = growwCharges(call.premium, lot, 'buy').total + growwCharges(put.premium, lot, 'buy').total;
  return {
    strategy: 'Long Strangle',
    bias: 'VOLATILE (direction-neutral)',
    legs: [
      { type: 'BUY', strike: callStrike, optType: 'CE', premium: call.premium },
      { type: 'BUY', strike: putStrike,  optType: 'PE', premium: put.premium },
    ],
    cost,
    maxLoss:  cost * lot + charges,
    maxProfit: Infinity,
    upperBE:  callStrike + cost,
    lowerBE:  putStrike - cost,
    charges,
    netVega:  (call.vega + put.vega) * lot,
    netTheta: (call.theta + put.theta) * lot,
  };
}

/**
 * Calendar Spread — sell near-term, buy far-term (same strike)
 * Theta play — profit from time decay differential
 */
export function calendarSpread({ spot, strike, T_near, T_far, iv_near, iv_far, r = 0.065, lot, type = 'CE' }) {
  const near = greeks(spot, strike, T_near, r, iv_near, type);
  const far  = greeks(spot, strike, T_far,  r, iv_far,  type);
  const debit = far.premium - near.premium;
  const charges = growwCharges(near.premium, lot, 'sell').total + growwCharges(far.premium, lot, 'buy').total;
  return {
    strategy: `Calendar Spread (${type})`,
    bias: 'NEUTRAL (theta + vol play)',
    legs: [
      { type: 'SELL', strike, optType: type, expiry: 'NEAR', premium: near.premium, theta: near.theta },
      { type: 'BUY',  strike, optType: type, expiry: 'FAR',  premium: far.premium,  theta: far.theta },
    ],
    debit,
    maxLoss:   debit * lot + charges,
    netTheta:  (far.theta - near.theta) * lot,
    charges,
    bestAt:    strike,
    note:      'Profit if spot stays near strike. Benefits from IV expansion on far leg.',
  };
}

// ─── MARKET REGIME DETECTOR ─────────────────────────────────────────────────

/**
 * Detect current market regime from indicators
 * Returns: TRENDING_UP | TRENDING_DOWN | VOLATILE | RANGE_BOUND
 */
export function detectRegime({ rsi, macdHist, atr, atrAvg, bbWidth, superTrend, weeklyRsi, vix }) {
  const scores = { TRENDING_UP: 0, TRENDING_DOWN: 0, VOLATILE: 0, RANGE_BOUND: 0 };

  if (rsi > 55) scores.TRENDING_UP += 2;
  if (rsi < 45) scores.TRENDING_DOWN += 2;
  if (rsi > 30 && rsi < 70) scores.RANGE_BOUND += 1;

  if (macdHist > 0) scores.TRENDING_UP += 1;
  if (macdHist < 0) scores.TRENDING_DOWN += 1;

  const atrRatio = atr / atrAvg;
  if (atrRatio > 1.5) scores.VOLATILE += 3;
  if (atrRatio < 0.8) scores.RANGE_BOUND += 2;

  if (bbWidth > 0.04) scores.VOLATILE += 2;
  if (bbWidth < 0.02) scores.RANGE_BOUND += 2;

  if (superTrend === 'BULLISH') scores.TRENDING_UP += 2;
  if (superTrend === 'BEARISH') scores.TRENDING_DOWN += 2;

  if (weeklyRsi > 55) scores.TRENDING_UP += 1;
  if (weeklyRsi < 45) scores.TRENDING_DOWN += 1;

  if (vix > 20) scores.VOLATILE += 2;
  if (vix < 14) scores.RANGE_BOUND += 2;

  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

// ─── STRATEGY SELECTOR ───────────────────────────────────────────────────────

/**
 * AI Strategy Selector — picks best strategy based on regime + IV + bias
 */
export function suggestStrategy({ spot, regime, iv, vix, rsi, daysToExpiry, capital, lotSize, bias = 'NEUTRAL' }) {
  const T = daysToExpiry / 365;
  const margin = capital * 0.20; // max 20% per trade
  const strategies = [];

  // High IV → sell premium
  const ivHigh = iv > 0.20;
  // Low IV → buy premium
  const ivLow  = iv < 0.14;
  // Oversold
  const oversold     = rsi < 30;
  const overbought   = rsi > 70;
  const deepOversold = rsi < 20;

  if (regime === 'TRENDING_UP' || oversold || bias === 'BULLISH') {
    if (ivHigh) {
      strategies.push({
        name: 'Bull Put Spread',
        reason: `High IV (${(iv*100).toFixed(0)}%) → sell premium. RSI ${rsi.toFixed(0)} = oversold bounce likely.`,
        priority: deepOversold ? 1 : 2,
        sellStrike: Math.round(spot * 0.99 / 50) * 50,
        buyStrike:  Math.round(spot * 0.975 / 50) * 50,
        risk: 'LOW',
        type: 'CREDIT',
      });
    }
    if (ivLow) {
      strategies.push({
        name: 'Long Call',
        reason: `Low IV (${(iv*100).toFixed(0)}%) → cheap to buy options. Bullish bias.`,
        priority: 3,
        strike: Math.round(spot * 1.01 / 50) * 50,
        risk: 'MEDIUM',
        type: 'DEBIT',
      });
    }
  }

  if (regime === 'TRENDING_DOWN' || overbought || bias === 'BEARISH') {
    if (ivHigh) {
      strategies.push({
        name: 'Bear Call Spread',
        reason: `Bearish regime + high IV → sell call spread at resistance.`,
        priority: 2,
        sellStrike: Math.round(spot * 1.015 / 50) * 50,
        buyStrike:  Math.round(spot * 1.03 / 50) * 50,
        risk: 'LOW',
        type: 'CREDIT',
      });
    }
    if (ivLow) {
      strategies.push({
        name: 'Long Put',
        reason: `Low IV → cheap puts. Bearish breakdown play.`,
        priority: 3,
        strike: Math.round(spot * 0.99 / 50) * 50,
        risk: 'MEDIUM',
        type: 'DEBIT',
      });
    }
  }

  if (regime === 'RANGE_BOUND' && ivHigh) {
    strategies.push({
      name: 'Iron Condor',
      reason: `Range-bound + high IV → sell both sides. Max theta capture.`,
      priority: 1,
      putSell:  Math.round(spot * 0.985 / 50) * 50,
      putBuy:   Math.round(spot * 0.970 / 50) * 50,
      callSell: Math.round(spot * 1.015 / 50) * 50,
      callBuy:  Math.round(spot * 1.030 / 50) * 50,
      risk: 'MEDIUM',
      type: 'CREDIT',
    });
  }

  if (regime === 'VOLATILE' && ivLow) {
    strategies.push({
      name: 'Long Straddle',
      reason: `High volatility regime + low IV → buy vol before it spikes.`,
      priority: 2,
      strike: Math.round(spot / 50) * 50,
      risk: 'HIGH',
      type: 'DEBIT',
    });
  }

  if (regime === 'VOLATILE' && ivHigh) {
    strategies.push({
      name: 'Iron Condor (tight)',
      reason: `Volatile but IV high → fade the vol, sell tight condor for premium.`,
      priority: 3,
      note: 'Risky — only if you have a strong range-bound view despite volatility.',
      risk: 'HIGH',
      type: 'CREDIT',
    });
  }

  // Always add default safe option
  if (!strategies.length) {
    strategies.push({
      name: 'Cash / Wait',
      reason: 'No clear edge. Preserve capital.',
      priority: 1,
      risk: 'ZERO',
      type: 'NONE',
    });
  }

  return strategies.sort((a, b) => a.priority - b.priority);
}

// ─── RISK SIZING ─────────────────────────────────────────────────────────────

/**
 * Kelly Criterion for options — determines optimal position size
 * f* = (p*b - q) / b  where p=winProb, b=win/loss ratio, q=1-p
 */
export function kellyCriterion({ winRate, avgWin, avgLoss, capitalFraction = 0.25 }) {
  const p = winRate / 100;
  const q = 1 - p;
  const b = avgWin / Math.abs(avgLoss);
  const kelly = (p * b - q) / b;
  // Half-Kelly for safety
  const halfKelly = kelly * 0.5;
  return {
    kelly:      Math.max(0, kelly),
    halfKelly:  Math.max(0, halfKelly),
    suggested:  Math.min(halfKelly, capitalFraction),
    note:       kelly > 0 ? `Bet ${(halfKelly*100).toFixed(1)}% of capital per trade` : 'Negative edge — do not trade',
  };
}

/**
 * Position sizer for options — respects 1-2% capital risk rule
 */
export function sizePosition({ capital, riskPct = 1, maxLossPerLot, lotSize }) {
  const maxRisk  = capital * riskPct / 100;
  const lots     = Math.floor(maxRisk / maxLossPerLot);
  const actualLots = Math.max(1, lots);
  return {
    lots:         actualLots,
    qty:          actualLots * lotSize,
    capitalAtRisk: maxLossPerLot * actualLots,
    riskPct:      (maxLossPerLot * actualLots / capital * 100).toFixed(2) + '%',
    margin:       maxLossPerLot * actualLots,
  };
}

/**
 * Value at Risk (VaR) for options position — 95% confidence
 */
export function optionsVaR({ premium, delta, gamma, vega, spot, iv, T, qty, confidenceLevel = 0.95 }) {
  // 1-day VaR using delta-gamma approximation
  const zScore    = 1.645; // 95% confidence
  const dailyMove = spot * iv / Math.sqrt(252);
  const deltaVaR  = Math.abs(delta) * dailyMove * zScore * qty;
  const gammaAdj  = 0.5 * gamma * Math.pow(dailyMove * zScore, 2) * qty;
  const vegaVaR   = Math.abs(vega) * 0.01 * qty * 100; // 1% IV move
  const totalVaR  = deltaVaR + gammaAdj + vegaVaR;
  return {
    deltaVaR:   deltaVaR.toFixed(0),
    gammaAdjust: gammaAdj.toFixed(0),
    vegaVaR:    vegaVaR.toFixed(0),
    totalVaR:   totalVaR.toFixed(0),
    note:       `95% chance loss won't exceed Rs.${totalVaR.toFixed(0)} in 1 day`,
  };
}

// ─── IV SURFACE ANALYSIS ─────────────────────────────────────────────────────

/**
 * IV Skew Analysis — measures put/call IV difference
 * Negative skew = market fears downside (normal)
 * Skew > -2% = bullish, Skew < -5% = fearful
 */
export function ivSkew({ spot, strikes, ivMap }) {
  const atmStrike   = strikes.reduce((a, b) => Math.abs(a - spot) < Math.abs(b - spot) ? a : b);
  const otmPutStrike  = strikes.filter(k => k < spot).sort((a,b) => b - a)[0];
  const otmCallStrike = strikes.filter(k => k > spot).sort((a,b) => a - b)[0];

  const ivATM  = ivMap[atmStrike]   || 0;
  const ivPut  = ivMap[otmPutStrike] || 0;
  const ivCall = ivMap[otmCallStrike] || 0;

  const putSkew  = ((ivPut  - ivATM) / ivATM * 100).toFixed(2);
  const callSkew = ((ivCall - ivATM) / ivATM * 100).toFixed(2);
  const skewRatio = ivPut / ivCall;

  return {
    atmIV:     ivATM,
    putSkew:   `${putSkew}%`,
    callSkew:  `${callSkew}%`,
    skewRatio: skewRatio.toFixed(2),
    interpretation: skewRatio > 1.3
      ? 'FEAR (high put premium — market expects downside)'
      : skewRatio < 0.9
        ? 'COMPLACENT (low put demand — caution reversal risk)'
        : 'BALANCED (normal market conditions)',
  };
}

/**
 * IV Percentile — where is current IV vs last year?
 * IV < 30th percentile → buy vol | IV > 70th percentile → sell vol
 */
export function ivPercentile(currentIV, historicalIVs) {
  const sorted = [...historicalIVs].sort((a, b) => a - b);
  const rank   = sorted.filter(v => v <= currentIV).length;
  const pct    = (rank / sorted.length * 100).toFixed(0);
  return {
    ivPercentile: pct + '%',
    currentIV:    (currentIV * 100).toFixed(1) + '%',
    recommendation: pct < 30 ? 'BUY premium (IV is cheap)' : pct > 70 ? 'SELL premium (IV is expensive)' : 'NEUTRAL',
    interpretation: pct < 30 ? 'Straddle/Strangle/Long options' : pct > 70 ? 'Iron Condor/Spreads' : 'Credit spreads OK',
  };
}

// ─── PCR & MAX PAIN ──────────────────────────────────────────────────────────

/**
 * Put-Call Ratio analysis
 */
export function analyzePCR(pcr) {
  let signal, strength;
  if (pcr > 1.5) { signal = 'EXTREMELY BEARISH (contrarian BULLISH)'; strength = 'STRONG'; }
  else if (pcr > 1.2) { signal = 'BEARISH (mildly contrarian bullish)'; strength = 'MODERATE'; }
  else if (pcr > 0.9) { signal = 'NEUTRAL'; strength = 'WEAK'; }
  else if (pcr > 0.7) { signal = 'BULLISH (mildly contrarian bearish)'; strength = 'MODERATE'; }
  else { signal = 'EXTREMELY BULLISH (contrarian BEARISH)'; strength = 'STRONG'; }
  return { pcr: pcr.toFixed(2), signal, strength, note: 'PCR > 1 = more puts than calls = bearish sentiment (but often means bottom near)' };
}

/**
 * Max Pain Calculator — strike at which option buyers lose most
 * Market gravitates toward max pain at expiry
 */
export function calcMaxPain(optionChain) {
  const strikes = [...new Set(optionChain.map(r => r.strikePrice))].sort((a, b) => a - b);
  let minPain = Infinity, maxPainStrike = 0;
  strikes.forEach(k => {
    let pain = 0;
    optionChain.forEach(r => {
      if (r.CE?.openInterest) pain += r.CE.openInterest * Math.max(0, k - r.strikePrice);
      if (r.PE?.openInterest) pain += r.PE.openInterest * Math.max(0, r.strikePrice - k);
    });
    if (pain < minPain) { minPain = pain; maxPainStrike = k; }
  });
  return maxPainStrike;
}

// ─── COMPLETE F&O ANALYZER ───────────────────────────────────────────────────

/**
 * Master F&O Analyzer — combines everything into a trade recommendation
 */
export async function analyzeFO({ symbol, spot, iv, vix, rsi, macdHist, atr, atrAvg,
  bbWidth, superTrend, weeklyRsi, daysToExpiry, capital, lotSize, pcr, optionChain }) {

  // 1. Detect regime
  const regime = detectRegime({ rsi, macdHist, atr, atrAvg, bbWidth, superTrend, weeklyRsi, vix });

  // 2. IV analysis
  const ivPct = iv > 0.20 ? 'HIGH' : iv < 0.14 ? 'LOW' : 'MODERATE';
  const ivAction = ivPct === 'HIGH' ? 'SELL premium (spreads/condors)' : ivPct === 'LOW' ? 'BUY premium (straddle/directional)' : 'Credit spreads OK';

  // 3. PCR signal
  const pcrAnalysis = pcr ? analyzePCR(pcr) : null;

  // 4. Max pain
  const maxPain = optionChain ? calcMaxPain(optionChain) : null;

  // 5. Strategy suggestions
  const strategies = suggestStrategy({ spot, regime, iv, vix, rsi, daysToExpiry, capital, lotSize });
  const best = strategies[0];

  // 6. Build best strategy
  let strategyDetails = null;
  const T = daysToExpiry / 365;
  if (best.name === 'Bull Put Spread') {
    strategyDetails = bullPutSpread({ spot, sellStrike: best.sellStrike, buyStrike: best.buyStrike, T, iv, lot: lotSize });
  } else if (best.name === 'Bear Call Spread') {
    strategyDetails = bearCallSpread({ spot, sellStrike: best.sellStrike, buyStrike: best.buyStrike, T, iv, lot: lotSize });
  } else if (best.name === 'Iron Condor') {
    strategyDetails = ironCondor({ spot, putSell: best.putSell, putBuy: best.putBuy, callSell: best.callSell, callBuy: best.callBuy, T, iv, lot: lotSize });
  }

  // 7. Position sizing
  const sizing = strategyDetails ? sizePosition({
    capital, riskPct: 1,
    maxLossPerLot: strategyDetails.maxLoss,
    lotSize,
  }) : null;

  return {
    symbol,
    spot,
    timestamp: new Date().toISOString(),
    regime,
    ivLevel:    ivPct,
    ivValue:    (iv * 100).toFixed(1) + '%',
    ivAction,
    vix,
    pcr:        pcrAnalysis,
    maxPain,
    topStrategy: best.name,
    reason:     best.reason,
    strategies,
    details:    strategyDetails,
    sizing,
    exitRules: {
      profitTarget: '50% of max profit',
      stopLoss:     strategyDetails ? `Exit if loss > Rs.${(strategyDetails.maxLoss * 0.5).toFixed(0)}` : 'N/A',
      timeSL:       '3 days before expiry',
      newsSL:       'Exit on major adverse news immediately',
    },
  };
}

// ─── BACKTESTER FOR F&O ──────────────────────────────────────────────────────

/**
 * Backtest Bull Put Spread historically
 * Uses daily OHLCV candles to simulate entries on oversold + exits at target/SL
 */
export function backtestBullPutSpread(candles, {
  rsiEntry = 30,      // Enter when RSI < this
  spreadWidthPct = 0.013, // spread width as % of spot
  ivEstimate = 0.22,
  daysToExpiry = 18,
  profitTargetPct = 0.5,  // exit at 50% max profit
  slMultiplier = 0.5,     // exit if loss > 50% max loss
  capital = 100000,
  lotSize = 75,
}) {
  const results = [];
  let wins = 0, losses = 0, totalPnl = 0;

  for (let i = 50; i < candles.length - daysToExpiry; i++) {
    const slice  = candles.slice(0, i + 1);
    const closes = slice.map(c => parseFloat(c.close));

    // Simple RSI calculation
    const gains = [], losses2 = [];
    for (let j = closes.length - 14; j < closes.length; j++) {
      const diff = closes[j] - closes[j-1];
      if (diff > 0) gains.push(diff); else losses2.push(Math.abs(diff));
    }
    const avgGain = gains.reduce((s,v) => s+v, 0) / 14;
    const avgLoss = losses2.reduce((s,v) => s+v, 0) / 14;
    const rsiVal  = 100 - (100 / (1 + avgGain / (avgLoss || 0.001)));

    if (rsiVal > rsiEntry) continue; // Only enter oversold

    const spot       = closes[closes.length - 1];
    const sellStrike = Math.round(spot * (1 - spreadWidthPct * 0.5) / 50) * 50;
    const buyStrike  = Math.round(spot * (1 - spreadWidthPct * 1.5) / 50) * 50;
    const T = daysToExpiry / 365;

    const trade = bullPutSpread({ spot, sellStrike, buyStrike, T, iv: ivEstimate, lot: lotSize });
    const profitTarget = trade.maxProfit * profitTargetPct;
    const slLevel      = -trade.maxLoss * slMultiplier;

    // Simulate holding until exit condition
    let exitPnl = trade.maxProfit; // assume hold to expiry
    let exitDay = daysToExpiry;
    let exitReason = 'EXPIRY';

    for (let j = 1; j <= daysToExpiry; j++) {
      if (i + j >= candles.length) break;
      const futureSpot = parseFloat(candles[i + j].close);
      const T_rem = (daysToExpiry - j) / 365;
      const s = bullPutSpread({ spot: futureSpot, sellStrike, buyStrike, T: T_rem, iv: ivEstimate, lot: lotSize });
      const unrealPnl = s.maxProfit - trade.maxProfit + (trade.credit - s.credit) * lotSize;

      if (unrealPnl >= profitTarget) {
        exitPnl = profitTarget; exitDay = j; exitReason = 'TARGET'; break;
      }
      if (unrealPnl <= slLevel) {
        exitPnl = slLevel; exitDay = j; exitReason = 'STOP LOSS'; break;
      }
    }

    if (exitPnl > 0) wins++; else losses++;
    totalPnl += exitPnl;
    results.push({
      entryDate:  candles[i].date,
      spot:       spot.toFixed(0),
      sellStrike, buyStrike,
      rsi:        rsiVal.toFixed(1),
      maxProfit:  trade.maxProfit.toFixed(0),
      exitDay,
      exitReason,
      pnl:        exitPnl.toFixed(0),
    });
  }

  const total = wins + losses;
  return {
    trades:    results.slice(-20), // last 20
    stats: {
      total,
      wins,
      losses,
      winRate:    total ? (wins / total * 100).toFixed(1) + '%' : '0%',
      totalPnl:   totalPnl.toFixed(0),
      avgPnl:     total ? (totalPnl / total).toFixed(0) : 0,
      profitFactor: losses > 0 ? (wins / losses).toFixed(2) : 'INF',
    },
  };
}
