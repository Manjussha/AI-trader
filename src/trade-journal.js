/**
 * Trade Journal — Professional trading log
 * Records every trade with rationale, outcome, lessons learned
 * Tracks win rate, avg R:R, streaks, worst drawdown
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB    = join(__dir, '..', 'trade-journal.json');

function load() {
  if (!existsSync(DB)) { const d = empty(); save(d); return d; }
  try { return JSON.parse(readFileSync(DB, 'utf8')); }
  catch { return empty(); }
}

function empty() {
  return { trades: [], createdAt: new Date().toISOString() };
}

function save(data) {
  writeFileSync(DB, JSON.stringify(data, null, 2));
}

// ── Add a trade entry ──────────────────────────────────────────────────────
export function addTrade({
  symbol, type, segment = 'EQUITY',
  entry, target, stopLoss, qty, lotSize = 1,
  entryReason, setup, timeframe = '1d',
  tags = [],
}) {
  const db = load();
  const trade = {
    id:          `TJ-${Date.now()}`,
    symbol:      symbol.toUpperCase(),
    type,          // BUY/SELL/CE/PE
    segment,       // EQUITY/FUTURES/OPTIONS
    entry,
    target,
    stopLoss,
    qty,
    lotSize,
    rr:          target && stopLoss ? Math.abs((target - entry) / (entry - stopLoss)).toFixed(2) : null,
    entryReason: entryReason || '',
    setup:       setup || '',
    timeframe,
    tags,
    status:      'OPEN',
    openedAt:    new Date().toISOString(),
    exitPrice:   null,
    pnl:         null,
    outcome:     null,
    lesson:      null,
    closedAt:    null,
  };
  db.trades.push(trade);
  save(db);
  return { success: true, trade };
}

// ── Close/update a trade ───────────────────────────────────────────────────
export function closeTrade({ id, exitPrice, lesson = '' }) {
  const db = load();
  const t  = db.trades.find(x => x.id === id);
  if (!t) return { success: false, error: `Trade ${id} not found` };

  t.exitPrice = exitPrice;
  t.closedAt  = new Date().toISOString();
  t.status    = 'CLOSED';
  t.lesson    = lesson;

  const direction = t.type === 'BUY' || t.type === 'CE' ? 1 : -1;
  const gross = (exitPrice - t.entry) * direction * t.qty * t.lotSize;
  // Simplified brokerage
  const charges = Math.min(Math.max(gross * 0.0003, 20), 200) + 18;
  t.pnl     = (gross - charges).toFixed(2);
  t.outcome = parseFloat(t.pnl) > 0 ? 'WIN' : parseFloat(t.pnl) < 0 ? 'LOSS' : 'BREAKEVEN';

  save(db);
  return { success: true, trade: t };
}

// ── Performance statistics ────────────────────────────────────────────────
export function getStats(filter = {}) {
  const db = load();
  let trades = db.trades.filter(t => t.status === 'CLOSED');

  if (filter.symbol)  trades = trades.filter(t => t.symbol === filter.symbol.toUpperCase());
  if (filter.segment) trades = trades.filter(t => t.segment === filter.segment);
  if (filter.since)   trades = trades.filter(t => t.closedAt >= filter.since);

  if (trades.length === 0) return { message: 'No closed trades found', trades: [] };

  const pnls    = trades.map(t => parseFloat(t.pnl || 0));
  const wins    = trades.filter(t => t.outcome === 'WIN');
  const losses  = trades.filter(t => t.outcome === 'LOSS');
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const avgWin  = wins.length ? wins.reduce((a, t) => a + parseFloat(t.pnl), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, t) => a + parseFloat(t.pnl), 0) / losses.length : 0;

  // Max drawdown
  let peak = 0, maxDD = 0, runningPnl = 0;
  for (const p of pnls) {
    runningPnl += p;
    if (runningPnl > peak) peak = runningPnl;
    const dd = peak - runningPnl;
    if (dd > maxDD) maxDD = dd;
  }

  // Win streak
  let maxStreak = 0, curStreak = 0;
  for (const t of trades) {
    if (t.outcome === 'WIN') { curStreak++; maxStreak = Math.max(maxStreak, curStreak); }
    else curStreak = 0;
  }

  // Expectancy = (Win% × AvgWin) - (Loss% × |AvgLoss|)
  const winRate   = trades.length > 0 ? (wins.length / trades.length) : 0;
  const expectancy = (winRate * avgWin) + ((1 - winRate) * avgLoss);

  return {
    totalTrades:  trades.length,
    wins:         wins.length,
    losses:       losses.length,
    winRate:      (winRate * 100).toFixed(1) + '%',
    totalPnl:     totalPnl.toFixed(2),
    avgWin:       avgWin.toFixed(2),
    avgLoss:      avgLoss.toFixed(2),
    bestTrade:    Math.max(...pnls).toFixed(2),
    worstTrade:   Math.min(...pnls).toFixed(2),
    maxDrawdown:  maxDD.toFixed(2),
    maxWinStreak: maxStreak,
    expectancy:   expectancy.toFixed(2),
    profitFactor: avgLoss !== 0 ? Math.abs((avgWin * wins.length) / (avgLoss * losses.length)).toFixed(2) : '∞',
    recentTrades: trades.slice(-10).reverse().map(t => ({
      id: t.id, symbol: t.symbol, type: t.type,
      entry: t.entry, exit: t.exitPrice, pnl: t.pnl,
      outcome: t.outcome, setup: t.setup, closedAt: t.closedAt,
    })),
  };
}

export function getOpenTrades() {
  const db = load();
  return db.trades.filter(t => t.status === 'OPEN');
}

export function getAllTrades(limit = 50) {
  const db = load();
  return db.trades.slice(-limit).reverse();
}
