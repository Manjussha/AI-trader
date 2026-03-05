/**
 * Candlestick Pattern Recognition Engine
 * Professional-grade patterns used by institutional traders
 */

// ── Helpers ──────────────────────────────────────────────────────────────────
const body      = c => Math.abs(c.close - c.open);
const range     = c => c.high - c.low;
const upperWick = c => c.high - Math.max(c.open, c.close);
const lowerWick = c => Math.min(c.open, c.close) - c.low;
const isBull    = c => c.close > c.open;
const isBear    = c => c.close < c.open;
const midpoint  = c => (c.open + c.close) / 2;
const bodyPct   = c => range(c) > 0 ? body(c) / range(c) : 0;

// ── Single Candle Patterns ────────────────────────────────────────────────────

export function isDoji(c) {
  // Body < 10% of range, wicks on both sides
  return bodyPct(c) < 0.10 && range(c) > 0;
}

export function isHammer(c) {
  // Bullish reversal: small body at top, long lower wick (2x+ body), small upper wick
  const b = body(c), lw = lowerWick(c), uw = upperWick(c);
  return b > 0 && lw >= 2 * b && uw <= 0.3 * b && bodyPct(c) < 0.4;
}

export function isInvertedHammer(c) {
  const b = body(c), lw = lowerWick(c), uw = upperWick(c);
  return b > 0 && uw >= 2 * b && lw <= 0.3 * b && bodyPct(c) < 0.4;
}

export function isShootingStar(c) {
  // Bearish reversal: small body at bottom, long upper wick
  const b = body(c), lw = lowerWick(c), uw = upperWick(c);
  return b > 0 && uw >= 2 * b && lw <= 0.3 * b && isBear(c);
}

export function isHangingMan(c) {
  const b = body(c), lw = lowerWick(c), uw = upperWick(c);
  return b > 0 && lw >= 2 * b && uw <= 0.3 * b && bodyPct(c) < 0.4 && isBear(c);
}

export function isMarubozu(c) {
  // Full body candle — no wicks, strong conviction
  return bodyPct(c) > 0.90 && range(c) > 0;
}

export function isSpinningTop(c) {
  // Small body, almost equal wicks — indecision
  const b = body(c), lw = lowerWick(c), uw = upperWick(c);
  return bodyPct(c) < 0.30 && Math.abs(uw - lw) < 0.2 * range(c);
}

// ── Two Candle Patterns ───────────────────────────────────────────────────────

export function isBullishEngulfing(prev, curr) {
  return isBear(prev) && isBull(curr) &&
    curr.open < prev.close && curr.close > prev.open &&
    body(curr) > body(prev);
}

export function isBearishEngulfing(prev, curr) {
  return isBull(prev) && isBear(curr) &&
    curr.open > prev.close && curr.close < prev.open &&
    body(curr) > body(prev);
}

export function isBullishHarami(prev, curr) {
  // Small bullish candle inside large bearish body
  return isBear(prev) && isBull(curr) &&
    curr.open > prev.close && curr.close < prev.open &&
    body(curr) < 0.5 * body(prev);
}

export function isBearishHarami(prev, curr) {
  return isBull(prev) && isBear(curr) &&
    curr.open < prev.close && curr.close > prev.open &&
    body(curr) < 0.5 * body(prev);
}

export function isPiercing(prev, curr) {
  // Bullish: bearish prev, bullish curr opens below prev low, closes above midpoint
  return isBear(prev) && isBull(curr) &&
    curr.open < prev.low &&
    curr.close > midpoint(prev) && curr.close < prev.open;
}

export function isDarkCloudCover(prev, curr) {
  return isBull(prev) && isBear(curr) &&
    curr.open > prev.high &&
    curr.close < midpoint(prev) && curr.close > prev.open;
}

export function isTweezerBottom(prev, curr) {
  return isBear(prev) && isBull(curr) &&
    Math.abs(prev.low - curr.low) / prev.low < 0.002;
}

export function isTweezerTop(prev, curr) {
  return isBull(prev) && isBear(curr) &&
    Math.abs(prev.high - curr.high) / prev.high < 0.002;
}

// ── Three Candle Patterns ─────────────────────────────────────────────────────

export function isMorningStar(c1, c2, c3) {
  // Bearish, small/doji, bullish — strong reversal
  return isBear(c1) && body(c1) > 0.3 * range(c1) &&
    body(c2) < 0.3 * range(c1) &&  // small middle candle
    isBull(c3) && body(c3) > 0.3 * range(c3) &&
    c3.close > midpoint(c1);
}

export function isEveningStar(c1, c2, c3) {
  return isBull(c1) && body(c1) > 0.3 * range(c1) &&
    body(c2) < 0.3 * range(c1) &&
    isBear(c3) && body(c3) > 0.3 * range(c3) &&
    c3.close < midpoint(c1);
}

export function isThreeWhiteSoldiers(c1, c2, c3) {
  return isBull(c1) && isBull(c2) && isBull(c3) &&
    c2.open > c1.open && c2.close > c1.close &&
    c3.open > c2.open && c3.close > c2.close &&
    bodyPct(c1) > 0.5 && bodyPct(c2) > 0.5 && bodyPct(c3) > 0.5;
}

export function isThreeBlackCrows(c1, c2, c3) {
  return isBear(c1) && isBear(c2) && isBear(c3) &&
    c2.open < c1.open && c2.close < c1.close &&
    c3.open < c2.open && c3.close < c2.close &&
    bodyPct(c1) > 0.5 && bodyPct(c2) > 0.5 && bodyPct(c3) > 0.5;
}

export function isMorningDojiStar(c1, c2, c3) {
  return isBear(c1) && isDoji(c2) && isBull(c3) &&
    c3.close > midpoint(c1);
}

export function isEveningDojiStar(c1, c2, c3) {
  return isBull(c1) && isDoji(c2) && isBear(c3) &&
    c3.close < midpoint(c1);
}

export function isThreeInsideUp(c1, c2, c3) {
  return isBullishHarami(c1, c2) && isBull(c3) && c3.close > c1.open;
}

export function isThreeInsideDown(c1, c2, c3) {
  return isBearishHarami(c1, c2) && isBear(c3) && c3.close < c1.open;
}

// ── Full Pattern Scanner ──────────────────────────────────────────────────────

export function scanPatterns(candles) {
  if (!candles || candles.length < 3) return [];

  // Normalize candles: { open, high, low, close, date, volume }
  const cs = candles.map(c => ({
    open:   parseFloat(c.open  || c[1]),
    high:   parseFloat(c.high  || c[2]),
    low:    parseFloat(c.low   || c[3]),
    close:  parseFloat(c.close || c[4]),
    volume: parseFloat(c.volume || c[5] || 0),
    date:   c.date || c[0] || '',
  })).filter(c => c.open && c.high && c.low && c.close);

  const results = [];
  const last = cs.length - 1;

  const push = (pattern, sentiment, strength, candle) => results.push({
    pattern, sentiment, strength,
    date: candle.date,
    price: candle.close,
  });

  // Single candle — on last candle
  const c = cs[last];
  if (isDoji(c))           push('Doji',            'NEUTRAL', 'WEAK',   c);
  if (isHammer(c))         push('Hammer',           'BULLISH', 'STRONG', c);
  if (isInvertedHammer(c)) push('Inverted Hammer',  'BULLISH', 'MEDIUM', c);
  if (isShootingStar(c))   push('Shooting Star',    'BEARISH', 'STRONG', c);
  if (isHangingMan(c))     push('Hanging Man',      'BEARISH', 'MEDIUM', c);
  if (isMarubozu(c))       push(isBull(c) ? 'Bullish Marubozu' : 'Bearish Marubozu',
                               isBull(c) ? 'BULLISH' : 'BEARISH', 'STRONG', c);
  if (isSpinningTop(c))    push('Spinning Top',     'NEUTRAL', 'WEAK',   c);

  // Two candle — last two
  if (last >= 1) {
    const p = cs[last - 1];
    if (isBullishEngulfing(p, c))  push('Bullish Engulfing',   'BULLISH', 'STRONG', c);
    if (isBearishEngulfing(p, c))  push('Bearish Engulfing',   'BEARISH', 'STRONG', c);
    if (isBullishHarami(p, c))     push('Bullish Harami',      'BULLISH', 'MEDIUM', c);
    if (isBearishHarami(p, c))     push('Bearish Harami',      'BEARISH', 'MEDIUM', c);
    if (isPiercing(p, c))          push('Piercing Line',       'BULLISH', 'STRONG', c);
    if (isDarkCloudCover(p, c))    push('Dark Cloud Cover',    'BEARISH', 'STRONG', c);
    if (isTweezerBottom(p, c))     push('Tweezer Bottom',      'BULLISH', 'MEDIUM', c);
    if (isTweezerTop(p, c))        push('Tweezer Top',         'BEARISH', 'MEDIUM', c);
  }

  // Three candle — last three
  if (last >= 2) {
    const c1 = cs[last - 2], c2 = cs[last - 1], c3 = cs[last];
    if (isMorningStar(c1, c2, c3))        push('Morning Star',          'BULLISH', 'STRONG', c3);
    if (isEveningStar(c1, c2, c3))        push('Evening Star',          'BEARISH', 'STRONG', c3);
    if (isThreeWhiteSoldiers(c1, c2, c3)) push('Three White Soldiers',  'BULLISH', 'STRONG', c3);
    if (isThreeBlackCrows(c1, c2, c3))    push('Three Black Crows',     'BEARISH', 'STRONG', c3);
    if (isMorningDojiStar(c1, c2, c3))    push('Morning Doji Star',     'BULLISH', 'STRONG', c3);
    if (isEveningDojiStar(c1, c2, c3))    push('Evening Doji Star',     'BEARISH', 'STRONG', c3);
    if (isThreeInsideUp(c1, c2, c3))      push('Three Inside Up',       'BULLISH', 'STRONG', c3);
    if (isThreeInsideDown(c1, c2, c3))    push('Three Inside Down',     'BEARISH', 'STRONG', c3);
  }

  // Also scan recent 10 candles for patterns
  for (let i = Math.max(0, last - 10); i < last - 2; i++) {
    const c1 = cs[i], c2 = cs[i+1], c3 = cs[i+2];
    const age = last - i;
    if (isMorningStar(c1, c2, c3))        results.push({ pattern: 'Morning Star',         sentiment: 'BULLISH', strength: 'STRONG', date: c3.date, price: c3.close, barsAgo: age });
    if (isEveningStar(c1, c2, c3))        results.push({ pattern: 'Evening Star',         sentiment: 'BEARISH', strength: 'STRONG', date: c3.date, price: c3.close, barsAgo: age });
    if (isThreeWhiteSoldiers(c1, c2, c3)) results.push({ pattern: 'Three White Soldiers', sentiment: 'BULLISH', strength: 'STRONG', date: c3.date, price: c3.close, barsAgo: age });
    if (isThreeBlackCrows(c1, c2, c3))    results.push({ pattern: 'Three Black Crows',    sentiment: 'BEARISH', strength: 'STRONG', date: c3.date, price: c3.close, barsAgo: age });
  }

  return results;
}

// ── Pattern Education ─────────────────────────────────────────────────────────
export const PATTERN_GUIDE = {
  'Hammer':              { what: 'Bullish reversal at bottom. Long lower wick = buyers fought back strongly.', action: 'BUY on next candle confirmation. SL below hammer low.' },
  'Shooting Star':       { what: 'Bearish reversal at top. Long upper wick = sellers rejected higher prices.', action: 'SELL/SHORT. SL above shooting star high.' },
  'Bullish Engulfing':   { what: 'Bulls completely overpowered bears. Strong trend reversal signal.', action: 'BUY. SL below engulfing candle low. High reliability.' },
  'Bearish Engulfing':   { what: 'Bears completely overpowered bulls. Strong downtrend starting.', action: 'SELL. SL above engulfing candle high.' },
  'Morning Star':        { what: '3-candle reversal: down, pause, up. One of the most reliable bullish reversals.', action: 'BUY on 3rd candle close. SL below middle candle.' },
  'Evening Star':        { what: '3-candle reversal: up, pause, down. Reliable bearish reversal.', action: 'SELL on 3rd candle. SL above middle candle.' },
  'Three White Soldiers':{ what: '3 consecutive strong bullish candles. Powerful uptrend confirmation.', action: 'BUY or add to longs. Very strong momentum signal.' },
  'Three Black Crows':   { what: '3 consecutive strong bearish candles. Powerful downtrend signal.', action: 'SELL or add to shorts. Strong momentum down.' },
  'Doji':                { what: 'Indecision. Bulls and bears equally matched. Watch next candle for direction.', action: 'WAIT. Trade breakout of next candle.' },
  'Bullish Marubozu':    { what: 'Full bull candle, no wicks. Complete buyer control. Strong momentum.', action: 'BUY. Trend continuation likely.' },
  'Bearish Marubozu':    { what: 'Full bear candle, no wicks. Complete seller control.', action: 'SELL. Trend continuation likely.' },
  'Piercing Line':       { what: 'Bullish reversal: bear candle, then bull opens lower but closes above midpoint.', action: 'BUY with SL below low.' },
  'Dark Cloud Cover':    { what: 'Bearish reversal: bull candle, then bear opens higher but closes below midpoint.', action: 'SELL with SL above high.' },
  'Tweezer Bottom':      { what: 'Two candles test same low, second rejects it. Support confirmed.', action: 'BUY above the high of 2nd candle.' },
  'Tweezer Top':         { what: 'Two candles test same high, second rejects it. Resistance confirmed.', action: 'SELL below low of 2nd candle.' },
  'Spinning Top':        { what: 'Indecision with equal wicks. Trend may be losing steam.', action: 'WAIT for next candle direction.' },
  'Hanging Man':         { what: 'Looks like hammer but appears AFTER uptrend. Bearish warning.', action: 'Tighten stops if long. Potential reversal.' },
  'Inverted Hammer':     { what: 'Appears after downtrend. Buyers tried to push up. Needs confirmation.', action: 'BUY only on next bullish candle confirmation.' },
  'Morning Doji Star':   { what: 'Like Morning Star but middle is Doji. Even stronger reversal.', action: 'Strong BUY signal. High reliability.' },
  'Evening Doji Star':   { what: 'Like Evening Star but middle is Doji. Even stronger reversal.', action: 'Strong SELL signal. High reliability.' },
  'Three Inside Up':     { what: 'Harami confirmed by 3rd bullish candle. Trend reversal confirmed.', action: 'BUY on 3rd candle. Confirmed reversal.' },
  'Three Inside Down':   { what: 'Harami confirmed by 3rd bearish candle. Trend reversal confirmed.', action: 'SELL on 3rd candle. Confirmed reversal.' },
};
