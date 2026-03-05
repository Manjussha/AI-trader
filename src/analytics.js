/**
 * AI Analytics Engine for Trading
 * Provides technical analysis and AI-powered insights
 */

// Simple Moving Average
export function sma(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Exponential Moving Average
export function ema(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    emaVal = prices[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

// RSI (Relative Strength Index)
export function rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const recent = changes.slice(-period);
  const gains = recent.filter(c => c > 0);
  const losses = recent.filter(c => c < 0).map(c => Math.abs(c));
  const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / period : 0;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// MACD
export function macd(prices) {
  const ema12 = ema(prices, 12);
  const ema26 = ema(prices, 26);
  if (ema12 === null || ema26 === null) return null;
  const macdLine = ema12 - ema26;
  return { macdLine, ema12, ema26 };
}

// Bollinger Bands
export function bollingerBands(prices, period = 20, stdDevMultiplier = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: mean + stdDevMultiplier * stdDev,
    middle: mean,
    lower: mean - stdDevMultiplier * stdDev,
    bandwidth: (2 * stdDevMultiplier * stdDev) / mean * 100
  };
}

// Support & Resistance levels
export function supportResistance(highs, lows, period = 20) {
  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  return {
    resistance: Math.max(...recentHighs),
    support: Math.min(...recentLows),
    midpoint: (Math.max(...recentHighs) + Math.min(...recentLows)) / 2
  };
}

// Volatility (annualized)
export function volatility(prices, period = 20) {
  if (prices.length < period + 1) return null;
  const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
  const recent = returns.slice(-period);
  const mean = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (period - 1);
  return Math.sqrt(variance * 252) * 100; // annualized %
}

// Portfolio metrics
export function portfolioAnalysis(holdings) {
  if (!holdings || holdings.length === 0) return null;

  const totalInvested = holdings.reduce((sum, h) => sum + (h.averagePrice * h.quantity), 0);
  const currentValue = holdings.reduce((sum, h) => sum + (h.ltp * h.quantity), 0);
  const totalPnL = currentValue - totalInvested;
  const pnlPercent = (totalPnL / totalInvested) * 100;

  const gainers = holdings.filter(h => h.ltp > h.averagePrice);
  const losers = holdings.filter(h => h.ltp < h.averagePrice);

  // Sector concentration (if sector data available)
  const topHolding = holdings.reduce((max, h) =>
    (h.ltp * h.quantity) > (max.ltp * max.quantity) ? h : max, holdings[0]);

  return {
    totalInvested: totalInvested.toFixed(2),
    currentValue: currentValue.toFixed(2),
    totalPnL: totalPnL.toFixed(2),
    pnlPercent: pnlPercent.toFixed(2),
    gainersCount: gainers.length,
    losersCount: losers.length,
    topHolding: topHolding?.tradingSymbol || 'N/A',
    topHoldingWeight: ((topHolding?.ltp * topHolding?.quantity / currentValue) * 100).toFixed(1) + '%'
  };
}

// Generate trading signal
export function generateSignal(prices, volumes) {
  if (!prices || prices.length < 26) {
    return { signal: 'INSUFFICIENT_DATA', confidence: 0, reasons: [] };
  }

  const signals = [];
  const reasons = [];
  let bullish = 0, bearish = 0;

  // RSI signal
  const rsiVal = rsi(prices);
  if (rsiVal !== null) {
    if (rsiVal < 30) { bullish += 2; reasons.push(`RSI oversold (${rsiVal.toFixed(1)}) - BUY signal`); }
    else if (rsiVal > 70) { bearish += 2; reasons.push(`RSI overbought (${rsiVal.toFixed(1)}) - SELL signal`); }
    else { reasons.push(`RSI neutral (${rsiVal.toFixed(1)})`); }
  }

  // MACD signal
  const macdData = macd(prices);
  if (macdData) {
    if (macdData.macdLine > 0) { bullish += 1; reasons.push('MACD above zero - Bullish momentum'); }
    else { bearish += 1; reasons.push('MACD below zero - Bearish momentum'); }
  }

  // Moving average signal
  const sma20 = sma(prices, 20);
  const sma50 = sma(prices, Math.min(50, prices.length));
  const currentPrice = prices[prices.length - 1];
  if (sma20 && currentPrice > sma20) { bullish += 1; reasons.push('Price above 20-SMA - Bullish'); }
  else if (sma20) { bearish += 1; reasons.push('Price below 20-SMA - Bearish'); }

  // Bollinger Bands signal
  const bb = bollingerBands(prices);
  if (bb) {
    if (currentPrice < bb.lower) { bullish += 1; reasons.push('Price at Bollinger lower band - Potential reversal up'); }
    else if (currentPrice > bb.upper) { bearish += 1; reasons.push('Price at Bollinger upper band - Potential reversal down'); }
  }

  const total = bullish + bearish;
  const confidence = total > 0 ? Math.round((Math.max(bullish, bearish) / total) * 100) : 0;

  let signal = 'NEUTRAL';
  if (bullish > bearish && bullish >= 2) signal = 'BUY';
  else if (bearish > bullish && bearish >= 2) signal = 'SELL';

  return {
    signal,
    confidence,
    bullishFactors: bullish,
    bearishFactors: bearish,
    rsi: rsiVal?.toFixed(1),
    macd: macdData?.macdLine?.toFixed(2),
    sma20: sma20?.toFixed(2),
    bollingerBands: bb ? { upper: bb.upper.toFixed(2), middle: bb.middle.toFixed(2), lower: bb.lower.toFixed(2) } : null,
    reasons
  };
}

// Format currency in INR
export function formatINR(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
}

// Average True Range (ATR) — used for stop loss sizing by pro traders
export function atr(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trValues = [];
  for (let i = 1; i < candles.length; i++) {
    const high  = parseFloat(candles[i].high  || candles[i][2]);
    const low   = parseFloat(candles[i].low   || candles[i][3]);
    const close = parseFloat(candles[i-1].close || candles[i-1][4]);
    trValues.push(Math.max(high - low, Math.abs(high - close), Math.abs(low - close)));
  }
  // Simple ATR (SMA of TR for first, then Wilder's smoothing)
  const recent = trValues.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / period;
}

// VWAP — Volume Weighted Average Price (intraday benchmark)
export function vwap(candles) {
  if (!candles || candles.length === 0) return null;
  let cumPV = 0, cumVol = 0;
  for (const c of candles) {
    const typical = (parseFloat(c.high || c[2]) + parseFloat(c.low || c[3]) + parseFloat(c.close || c[4])) / 3;
    const vol     = parseFloat(c.volume || c[5] || 0);
    cumPV  += typical * vol;
    cumVol += vol;
  }
  return cumVol > 0 ? cumPV / cumVol : null;
}

// Stochastic Oscillator %K and %D
export function stochastic(closes, highs, lows, period = 14, smoothK = 3) {
  if (closes.length < period) return null;
  const kValues = [];
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i  - period + 1, i + 1));
    kValues.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  const kSlice = kValues.slice(-smoothK);
  const K = kSlice.reduce((a, b) => a + b, 0) / smoothK;
  const D = kValues.slice(-6, -smoothK).length >= 3
    ? kValues.slice(-6, -smoothK).reduce((a, b) => a + b, 0) / 3
    : K;
  return { K: K.toFixed(1), D: D.toFixed(1), oversold: K < 20, overbought: K > 80 };
}

// Williams %R
export function williamsR(closes, highs, lows, period = 14) {
  if (closes.length < period) return null;
  const hh = Math.max(...highs.slice(-period));
  const ll = Math.min(...lows.slice(-period));
  const last = closes[closes.length - 1];
  return hh === ll ? -50 : ((hh - last) / (hh - ll)) * -100;
}

// Chandelier Exit — trailing stop based on ATR
export function chandelierExit(candles, period = 22, multiplier = 3) {
  if (!candles || candles.length < period) return null;
  const atrVal  = atr(candles, period);
  if (!atrVal) return null;
  const recentHighs = candles.slice(-period).map(c => parseFloat(c.high || c[2]));
  const recentLows  = candles.slice(-period).map(c => parseFloat(c.low  || c[3]));
  const highestHigh = Math.max(...recentHighs);
  const lowestLow   = Math.min(...recentLows);
  return {
    longStop:  (highestHigh - multiplier * atrVal).toFixed(2),
    shortStop: (lowestLow  + multiplier * atrVal).toFixed(2),
    atr:       atrVal.toFixed(2),
  };
}

// Position size calculator — core risk management
export function calcPositionSize({ capital, riskPct, entryPrice, stopLossPrice }) {
  const riskAmount   = capital * (riskPct / 100);
  const riskPerShare = Math.abs(entryPrice - stopLossPrice);
  if (riskPerShare === 0) return null;
  const qty          = Math.floor(riskAmount / riskPerShare);
  const totalCost    = qty * entryPrice;
  const maxLoss      = qty * riskPerShare;
  return {
    qty,
    totalCost:    totalCost.toFixed(2),
    maxLoss:      maxLoss.toFixed(2),
    riskPct:      ((maxLoss / capital) * 100).toFixed(2) + '%',
    capitalUsed:  ((totalCost / capital) * 100).toFixed(1) + '%',
  };
}

// SuperTrend indicator
export function superTrend(candles, period = 7, multiplier = 3) {
  if (!candles || candles.length < period + 1) return null;
  const atrVal = atr(candles, period);
  if (!atrVal) return null;
  const last  = candles[candles.length - 1];
  const hl2   = (parseFloat(last.high || last[2]) + parseFloat(last.low || last[3])) / 2;
  const close = parseFloat(last.close || last[4]);
  const upperBand = hl2 + multiplier * atrVal;
  const lowerBand = hl2 - multiplier * atrVal;
  const trend = close > lowerBand ? 'BULLISH' : 'BEARISH';
  return { trend, upperBand: upperBand.toFixed(2), lowerBand: lowerBand.toFixed(2), atr: atrVal.toFixed(2) };
}
