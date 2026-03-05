/**
 * Strategy Backtester
 * Runs the same confluence scoring logic used by the bot on historical candles.
 * Simulates entries/exits with ATR-based SL and target.
 *
 * Usage:
 *   import { backtestStrategy } from './src/backtester.js';
 *   const hist = await market.getHistoricalDataYahoo('RELIANCE', 'NSE', 365, '1d');
 *   const result = backtestStrategy(hist.candles, { minScore: 6, capital: 100000 });
 *   console.log(result.stats);
 */

import { rsi, sma, macd, bollingerBands, atr, vwap, stochastic, superTrend, supportResistance } from './analytics.js';
import { scanPatterns } from './patterns.js';

function score(candles) {
  if (candles.length < 50) return null;

  const closes = candles.map(c => parseFloat(c.close));
  const highs  = candles.map(c => parseFloat(c.high));
  const lows   = candles.map(c => parseFloat(c.low));
  const vols   = candles.map(c => c.volume || 0);
  const price  = closes[closes.length - 1];

  const rsiVal  = rsi(closes);
  const bb      = bollingerBands(closes);
  const atrVal  = atr(candles, 14);
  const sr      = supportResistance(highs, lows);
  const st      = superTrend(candles);
  const stoch   = stochastic(closes, highs, lows);
  const vwapVal = vwap(candles.slice(-20));
  const patts   = scanPatterns(candles);

  // Signal — simplified inline (avoids re-importing generateSignal circular)
  let sigBuy = false;
  try {
    const m   = macd(closes);
    const s20 = sma(closes, 20);
    sigBuy = rsiVal < 45 && m?.histogram > 0 && price > s20;
  } catch {}

  let s = 0;
  if (sigBuy)                                                       s += 2;
  if (rsiVal < 35)                                                  s += 2;
  else if (rsiVal < 45)                                             s += 1;
  if (stoch?.oversold)                                              s += 1;
  if (st?.trend === 'BULLISH')                                      s += 1;
  if (price > vwapVal)                                              s += 1;
  if (bb && price < bb.lower)                                       s += 1;
  if (sr && Math.abs(price - sr.support) / sr.support < 0.015)     s += 1;
  if (patts.some(p => p.sentiment === 'BULLISH' && p.strength === 'STRONG')) s += 1;

  return { s, price, atrVal, rsiVal };
}

export function backtestStrategy(candles, options = {}) {
  const {
    minScore  = 6,
    capital   = 100000,
    riskPct   = 1,
    slMult    = 2,     // ATR multiplier for stop loss
    t1Mult    = 1.5,   // ATR multiplier for target
    maxHold   = 20,    // max candles to hold if neither SL nor T1 hit
  } = options;

  const trades = [];
  let openTrade = null;
  let cash = capital;
  let peak = capital;
  let maxDD = 0;

  for (let i = 50; i < candles.length; i++) {
    const slice  = candles.slice(0, i + 1);
    const result = score(slice);
    if (!result) continue;

    const { s, price, atrVal, rsiVal } = result;

    // Manage open trade
    if (openTrade) {
      const held = i - openTrade.bar;
      let exit = null, reason = '';

      if (price <= openTrade.sl)      { exit = openTrade.sl;  reason = 'SL'; }
      else if (price >= openTrade.t1) { exit = openTrade.t1;  reason = 'T1'; }
      else if (held >= maxHold)       { exit = price;          reason = 'TIMEOUT'; }

      if (exit !== null) {
        const pnl = (exit - openTrade.entry) * openTrade.qty;
        cash += openTrade.cost + pnl;
        if (cash > peak) peak = cash;
        const dd = (peak - cash) / peak * 100;
        if (dd > maxDD) maxDD = dd;

        trades.push({
          entryDate: candles[openTrade.bar]?.date?.slice(0, 10) || `bar${openTrade.bar}`,
          exitDate:  candles[i]?.date?.slice(0, 10)             || `bar${i}`,
          entry:     openTrade.entry,
          exit:      parseFloat(exit.toFixed(2)),
          sl:        parseFloat(openTrade.sl.toFixed(2)),
          t1:        parseFloat(openTrade.t1.toFixed(2)),
          qty:       openTrade.qty,
          pnl:       parseFloat(pnl.toFixed(2)),
          pnlPct:    ((exit - openTrade.entry) / openTrade.entry * 100).toFixed(2),
          reason,
          win:       pnl > 0,
          score:     openTrade.score,
          rsi:       openTrade.rsi?.toFixed(1),
        });
        openTrade = null;
      }
    }

    // Enter new trade
    if (!openTrade && s >= minScore && atrVal) {
      const sl    = price - slMult * atrVal;
      const t1    = price + t1Mult * atrVal;
      const risk  = cash * riskPct / 100;
      const qty   = Math.floor(risk / (price - sl));
      const cost  = qty * price;

      if (qty >= 1 && cost <= cash) {
        cash -= cost;
        openTrade = { entry: price, sl, t1, qty, cost, bar: i, score: s, rsi: rsiVal };
      }
    }
  }

  // Force-close any open trade at last price
  if (openTrade) {
    const price = parseFloat(candles[candles.length - 1].close);
    const pnl   = (price - openTrade.entry) * openTrade.qty;
    cash += openTrade.cost + pnl;
    trades.push({
      entryDate: candles[openTrade.bar]?.date?.slice(0, 10) || '—',
      exitDate:  'OPEN',
      entry:     openTrade.entry,
      exit:      price,
      sl:        parseFloat(openTrade.sl.toFixed(2)),
      t1:        parseFloat(openTrade.t1.toFixed(2)),
      qty:       openTrade.qty,
      pnl:       parseFloat(pnl.toFixed(2)),
      pnlPct:    ((price - openTrade.entry) / openTrade.entry * 100).toFixed(2),
      reason:    'OPEN',
      win:       pnl > 0,
      score:     openTrade.score,
      rsi:       openTrade.rsi?.toFixed(1),
    });
  }

  const wins   = trades.filter(t => t.win);
  const losses = trades.filter(t => !t.win);
  const totalPnl   = trades.reduce((s, t) => s + t.pnl, 0);
  const grossWin   = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss  = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const avgWin     = wins.length   ? grossWin   / wins.length   : 0;
  const avgLoss    = losses.length ? grossLoss  / losses.length : 0;
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : wins.length ? '∞' : '0';
  const expectancy   = trades.length ? totalPnl / trades.length : 0;
  const finalValue   = capital + totalPnl;

  return {
    trades,
    stats: {
      totalTrades:   trades.length,
      wins:          wins.length,
      losses:        losses.length,
      winRate:       trades.length ? (wins.length / trades.length * 100).toFixed(1) + '%' : '0%',
      totalPnl:      totalPnl.toFixed(0),
      finalValue:    finalValue.toFixed(0),
      returns:       ((finalValue - capital) / capital * 100).toFixed(1) + '%',
      profitFactor,
      expectancy:    '₹' + expectancy.toFixed(0),
      maxDrawdown:   maxDD.toFixed(1) + '%',
      avgWin:        '₹' + avgWin.toFixed(0),
      avgLoss:       '₹' + avgLoss.toFixed(0),
    },
    config: { minScore, capital, riskPct, slMult, t1Mult, maxHold },
  };
}
