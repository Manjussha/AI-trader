/**
 * Historical Analysis Engine
 *
 * Core idea: "History repeats itself because human behaviour doesn't change."
 *
 * Three tools:
 *   1. historicalSimilarity  — Find past moments that look exactly like today.
 *                              Show what happened next (5d / 10d / 20d forward).
 *
 *   2. patternOutcomes       — For any candlestick pattern (Hammer, Engulfing…),
 *                              show every time it fired historically, win rate,
 *                              avg gain, avg loss, best / worst case.
 *
 *   3. supportTestHistory    — Every time price visited a key level, what happened?
 *                              Bounce, break, or consolidate?
 */

import { rsi, sma, bollingerBands, atr, volatility } from './analytics.js';
import { scanPatterns } from './patterns.js';

// ── Feature extraction for a single candle (given full history up to that point) ──
function extractFeatures(candles, idx) {
  if (idx < 25) return null;
  const slice  = candles.slice(0, idx + 1);
  const closes = slice.map(c => parseFloat(c.close)).filter(Boolean);
  const highs  = slice.map(c => parseFloat(c.high)).filter(Boolean);
  const lows   = slice.map(c => parseFloat(c.low)).filter(Boolean);
  const price  = closes[closes.length - 1];

  const rsiVal  = rsi(closes) ?? 50;
  const sma20v  = sma(closes, 20) ?? price;
  const sma50v  = closes.length >= 50 ? sma(closes, 50) ?? price : price;
  const bb      = bollingerBands(closes);
  const atrVal  = atr(slice, 14) ?? 1;
  const volat   = volatility(closes) ?? 20;

  // BB position: 0 = at lower band, 0.5 = at middle, 1 = at upper band
  const bbPos = bb ? Math.max(0, Math.min(1, (price - bb.lower) / (bb.upper - bb.lower))) : 0.5;

  return {
    rsi:         rsiVal / 100,                                     // 0–1
    bbPos,                                                          // 0–1
    vsSma20:     Math.max(-0.1, Math.min(0.1, (price - sma20v) / sma20v)), // clamped ±10%
    vsSma50:     Math.max(-0.2, Math.min(0.2, (price - sma50v) / sma50v)), // clamped ±20%
    atrPct:      Math.min(0.1, atrVal / price),                    // ATR as % of price
    volat:       Math.min(1, volat / 100),                         // 0–1
    price,
    date:        candles[idx].date || `idx-${idx}`,
  };
}

// Euclidean distance between two feature vectors (excluding price/date)
function distance(a, b) {
  const keys = ['rsi', 'bbPos', 'vsSma20', 'vsSma50', 'atrPct', 'volat'];
  // Weights — RSI and BB position matter most
  const w    = [2.0,    2.0,    1.5,       1.0,       0.5,      0.5];
  return Math.sqrt(keys.reduce((sum, k, i) => sum + w[i] * Math.pow(a[k] - b[k], 2), 0));
}

// Forward return N days after idx
function forwardReturn(candles, idx, days) {
  const futureIdx = idx + days;
  if (futureIdx >= candles.length) return null;
  const entry = parseFloat(candles[idx].close);
  const exit  = parseFloat(candles[futureIdx].close);
  return entry > 0 ? ((exit - entry) / entry) * 100 : null;
}

// ── 1. Historical Similarity ────────────────────────────────────────────────────
/**
 * Find the top N past moments that most closely resemble today's market setup.
 * Returns what actually happened in the following 5, 10, and 20 trading days.
 */
export function historicalSimilarity(candles, topN = 5) {
  if (!candles || candles.length < 60) return { error: 'Need at least 60 candles' };

  const lastIdx    = candles.length - 1;
  const current    = extractFeatures(candles, lastIdx);
  if (!current) return { error: 'Not enough data to extract features' };

  // Score every historical candle (skip last 20 so we can measure forward returns)
  const candidates = [];
  for (let i = 26; i <= lastIdx - 21; i++) {
    const feat = extractFeatures(candles, i);
    if (!feat) continue;
    const dist = distance(current, feat);
    candidates.push({ idx: i, dist, feat });
  }

  // Sort by similarity (lowest distance = most similar)
  candidates.sort((a, b) => a.dist - b.dist);
  const top = candidates.slice(0, topN);

  // Build result with forward outcomes
  const matches = top.map(m => {
    const r5  = forwardReturn(candles, m.idx, 5);
    const r10 = forwardReturn(candles, m.idx, 10);
    const r20 = forwardReturn(candles, m.idx, 20);
    return {
      date:        m.feat.date,
      price:       m.feat.price.toFixed(2),
      similarity:  `${(100 - m.dist * 100).toFixed(0)}%`,
      rsi:         (m.feat.rsi * 100).toFixed(1),
      bbPos:       m.feat.bbPos < 0.33 ? 'near lower' : m.feat.bbPos > 0.67 ? 'near upper' : 'middle',
      after5d:     r5  !== null ? `${r5  >= 0 ? '+' : ''}${r5.toFixed(2)}%` : 'N/A',
      after10d:    r10 !== null ? `${r10 >= 0 ? '+' : ''}${r10.toFixed(2)}%` : 'N/A',
      after20d:    r20 !== null ? `${r20 >= 0 ? '+' : ''}${r20.toFixed(2)}%` : 'N/A',
      outcome:     r10 !== null ? (r10 >= 1 ? 'WENT UP' : r10 <= -1 ? 'WENT DOWN' : 'SIDEWAYS') : 'N/A',
    };
  });

  // Aggregate statistics
  const outcomes = matches.map(m => m.outcome);
  const up       = outcomes.filter(o => o === 'WENT UP').length;
  const down     = outcomes.filter(o => o === 'WENT DOWN').length;
  const side     = outcomes.filter(o => o === 'SIDEWAYS').length;

  const r10vals  = matches.map(m => parseFloat(m.after10d)).filter(v => !isNaN(v));
  const avgR10   = r10vals.length ? (r10vals.reduce((a, b) => a + b, 0) / r10vals.length).toFixed(2) : null;
  const bestR10  = r10vals.length ? Math.max(...r10vals).toFixed(2) : null;
  const worstR10 = r10vals.length ? Math.min(...r10vals).toFixed(2) : null;

  const currentRsi = (current.rsi * 100).toFixed(1);
  const bbLabel    = current.bbPos < 0.33 ? 'near lower band (oversold zone)'
    : current.bbPos > 0.67 ? 'near upper band (overbought zone)' : 'in middle of bands';

  return {
    currentSetup: {
      price:    current.price.toFixed(2),
      date:     current.date,
      rsi:      currentRsi,
      bbPos:    bbLabel,
      vsSma20:  `${(current.vsSma20 * 100).toFixed(1)}%`,
    },
    historicalMatches: matches,
    stats: {
      totalMatches: matches.length,
      wentUp:    `${up}/${matches.length}`,
      wentDown:  `${down}/${matches.length}`,
      sideways:  `${side}/${matches.length}`,
      winRate:   matches.length ? `${((up / matches.length) * 100).toFixed(0)}%` : '0%',
      avgReturn10d:  avgR10   !== null ? `${avgR10 >= 0 ? '+' : ''}${avgR10}%` : 'N/A',
      bestCase10d:   bestR10  !== null ? `+${bestR10}%` : 'N/A',
      worstCase10d:  worstR10 !== null ? `${worstR10}%` : 'N/A',
    },
    verdict: up > down
      ? `BULLISH PRECEDENT — In ${up} out of ${matches.length} similar past setups, price went UP within 10 days. Avg gain: ${avgR10}%`
      : down > up
      ? `BEARISH PRECEDENT — In ${down} out of ${matches.length} similar past setups, price went DOWN within 10 days.`
      : `MIXED HISTORY — Similar setups had no clear directional edge. Wait for clearer confirmation.`,
  };
}

// ── 2. Pattern Outcomes ────────────────────────────────────────────────────────
/**
 * Find every time a candlestick pattern fired historically.
 * Calculate win rate, avg return, time to target.
 */
export function patternOutcomes(candles, patternName, forwardDays = 10) {
  if (!candles || candles.length < 30) return { error: 'Need at least 30 candles' };

  const occurrences = [];

  for (let i = 3; i <= candles.length - forwardDays - 1; i++) {
    const slice    = candles.slice(0, i + 1);
    const patterns = scanPatterns(slice);
    const found    = patterns.find(p => p.barsAgo === 0 && p.pattern.toLowerCase().includes(patternName.toLowerCase()));
    if (!found) continue;

    const entryPrice = parseFloat(candles[i].close);
    const fwdReturn  = forwardReturn(candles, i, forwardDays);

    // Check if target was hit before stop (using ATR-based levels)
    const closes    = slice.map(c => parseFloat(c.close)).filter(Boolean);
    const atrVal    = atr(slice, 14) ?? entryPrice * 0.01;
    const target    = entryPrice + 2 * atrVal;
    const stopLoss  = entryPrice - 1 * atrVal;

    let hitTarget = false, hitStop = false, daysToTarget = null;
    for (let j = 1; j <= forwardDays && i + j < candles.length; j++) {
      const h = parseFloat(candles[i + j].high);
      const l = parseFloat(candles[i + j].low);
      if (!hitTarget && h >= target)  { hitTarget = true; daysToTarget = j; }
      if (!hitStop   && l <= stopLoss) { hitStop   = true; }
    }

    occurrences.push({
      date:        candles[i].date || `idx-${i}`,
      entryPrice:  entryPrice.toFixed(2),
      fwdReturn:   fwdReturn !== null ? parseFloat(fwdReturn.toFixed(2)) : null,
      hitTarget,
      hitStop,
      daysToTarget,
      outcome:     hitTarget && !hitStop ? 'TARGET HIT'
        : hitStop && !hitTarget ? 'STOP HIT'
        : fwdReturn !== null && fwdReturn > 0 ? 'POSITIVE (no target)' : 'NEGATIVE',
    });
  }

  if (occurrences.length === 0) {
    return { patternName, message: `No "${patternName}" occurrences found in this data.` };
  }

  const wins     = occurrences.filter(o => o.fwdReturn !== null && o.fwdReturn > 0);
  const losses   = occurrences.filter(o => o.fwdReturn !== null && o.fwdReturn < 0);
  const returns  = occurrences.map(o => o.fwdReturn).filter(v => v !== null);
  const avgRet   = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const avgWin   = wins.length   ? wins.reduce((a, b) => a + (b.fwdReturn || 0), 0) / wins.length : 0;
  const avgLoss  = losses.length ? losses.reduce((a, b) => a + (b.fwdReturn || 0), 0) / losses.length : 0;
  const targHit  = occurrences.filter(o => o.hitTarget).length;
  const stopHit  = occurrences.filter(o => o.hitStop && !o.hitTarget).length;
  const avgDays  = occurrences.filter(o => o.daysToTarget).reduce((a, b) => a + (b.daysToTarget || 0), 0)
                 / (occurrences.filter(o => o.daysToTarget).length || 1);

  const profitFactor = avgLoss !== 0 ? Math.abs((avgWin * wins.length) / (avgLoss * losses.length)) : Infinity;

  return {
    patternName,
    forwardDays,
    totalOccurrences: occurrences.length,
    winRate:          `${((wins.length / occurrences.length) * 100).toFixed(1)}%`,
    targetHitRate:    `${((targHit / occurrences.length) * 100).toFixed(1)}%`,
    stopHitRate:      `${((stopHit / occurrences.length) * 100).toFixed(1)}%`,
    avgReturn:        `${avgRet >= 0 ? '+' : ''}${avgRet.toFixed(2)}%`,
    avgWin:           `+${avgWin.toFixed(2)}%`,
    avgLoss:          `${avgLoss.toFixed(2)}%`,
    bestCase:         `+${Math.max(...returns).toFixed(2)}%`,
    worstCase:        `${Math.min(...returns).toFixed(2)}%`,
    profitFactor:     isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞',
    avgDaysToTarget:  avgDays > 0 ? `${avgDays.toFixed(1)} trading days` : 'N/A',
    reliability:      wins.length / occurrences.length >= 0.6 ? 'HIGH (>60% win rate)'
      : wins.length / occurrences.length >= 0.45 ? 'MEDIUM (45–60%)'
      : 'LOW (<45%) — needs confirmation',
    recent: occurrences.slice(-5).reverse(),
    allOccurrences: occurrences,
  };
}

// ── 3. Support / Resistance Test History ───────────────────────────────────────
/**
 * Find every time price visited a key price level (±tolerance%).
 * Show whether it bounced, broke through, or consolidated.
 */
export function supportTestHistory(candles, level, tolerancePct = 1.5) {
  if (!candles || candles.length < 20) return { error: 'Need at least 20 candles' };

  const tol      = level * (tolerancePct / 100);
  const visits   = [];
  let   lastVisit = -5; // prevent counting consecutive candles as separate visits

  for (let i = 1; i < candles.length - 3; i++) {
    const low  = parseFloat(candles[i].low);
    const high = parseFloat(candles[i].high);
    const close = parseFloat(candles[i].close);

    const touched = (low <= level + tol && low >= level - tol) || (high >= level - tol && high <= level + tol);
    if (!touched || i - lastVisit < 4) continue;
    lastVisit = i;

    // What happened in the next 5 candles?
    const next5  = candles.slice(i + 1, i + 6);
    const closes = next5.map(c => parseFloat(c.close)).filter(Boolean);
    if (closes.length === 0) continue;

    const maxFwd  = Math.max(...closes);
    const minFwd  = Math.min(...closes);
    const lastFwd = closes[closes.length - 1];

    // Classify outcome
    const brokeBelow = minFwd < level - tol;
    const bounced    = maxFwd > level + tol * 2;
    const outcome    = brokeBelow ? 'BROKE BELOW' : bounced ? 'BOUNCED' : 'CONSOLIDATED';

    const closePos = close >= level ? 'above' : 'below';
    visits.push({
      date:      candles[i].date || `idx-${i}`,
      price:     close.toFixed(2),
      closedAt:  closePos,
      outcome,
      maxBounce: bounced    ? `+${(((maxFwd - level) / level) * 100).toFixed(1)}%` : null,
      breakDepth: brokeBelow ? `-${(((level - minFwd) / level) * 100).toFixed(1)}%` : null,
      nextCloseReturn: lastFwd > 0 ? `${(((lastFwd - close) / close) * 100).toFixed(2)}%` : null,
    });
  }

  if (visits.length === 0) {
    return { level, message: `Price never visited ₹${level} (±${tolerancePct}%) in this dataset.` };
  }

  const bounces    = visits.filter(v => v.outcome === 'BOUNCED');
  const breaks     = visits.filter(v => v.outcome === 'BROKE BELOW');
  const sides      = visits.filter(v => v.outcome === 'CONSOLIDATED');
  const bounceRate = ((bounces.length / visits.length) * 100).toFixed(0);

  const levelType = bounces.length >= breaks.length * 2 ? 'STRONG SUPPORT' :
    breaks.length >= bounces.length * 2 ? 'WEAK SUPPORT (broke often)' : 'MODERATE SUPPORT';

  return {
    level,
    tolerancePct: `±${tolerancePct}%`,
    totalVisits:  visits.length,
    bounced:      bounces.length,
    brokBelow:    breaks.length,
    consolidated: sides.length,
    bounceRate:   `${bounceRate}%`,
    levelStrength: levelType,
    verdict: bounces.length > breaks.length
      ? `HISTORICALLY STRONG LEVEL — Bounced ${bounces.length}/${visits.length} times. ${bounceRate}% bounce rate. BUY near ₹${level} with SL just below.`
      : `WEAK LEVEL — Broke through ${breaks.length}/${visits.length} times. Don't rely on this as support. Wait for price to reclaim it.`,
    visits: visits.reverse(),
  };
}

// ── 4. Price Zone Memory ───────────────────────────────────────────────────────
/**
 * Given current price, find the nearest significant historical levels
 * (highs/lows that were tested multiple times) and their test history.
 */
export function priceZoneMap(candles, lookback = 60) {
  if (!candles || candles.length < 30) return { error: 'Not enough candles' };

  const recent  = candles.slice(-lookback);
  const highs   = recent.map(c => parseFloat(c.high)).filter(Boolean);
  const lows    = recent.map(c => parseFloat(c.low)).filter(Boolean);
  const closes  = recent.map(c => parseFloat(c.close)).filter(Boolean);
  const price   = closes[closes.length - 1];

  // Cluster price levels — group levels within 0.5% of each other
  const allLevels = [...highs, ...lows];
  const clusters  = [];
  for (const lvl of allLevels) {
    const existing = clusters.find(c => Math.abs(c.level - lvl) / lvl < 0.005);
    if (existing) { existing.count++; existing.total += lvl; existing.level = existing.total / existing.count; }
    else clusters.push({ level: lvl, count: 1, total: lvl });
  }

  // Only keep levels tested 3+ times
  const significant = clusters
    .filter(c => c.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map(c => ({
      level:   parseFloat(c.level.toFixed(2)),
      tests:   c.count,
      type:    c.level > price ? 'RESISTANCE' : 'SUPPORT',
      distPct: `${(Math.abs(c.level - price) / price * 100).toFixed(1)}%`,
    }));

  return {
    currentPrice: price.toFixed(2),
    significantLevels: significant,
    nearestSupport:    significant.filter(l => l.type === 'SUPPORT').sort((a, b) => b.level - a.level)[0] || null,
    nearestResistance: significant.filter(l => l.type === 'RESISTANCE').sort((a, b) => a.level - b.level)[0] || null,
  };
}
