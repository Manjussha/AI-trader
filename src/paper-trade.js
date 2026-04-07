/**
 * Paper Trading Engine
 * Uses live NSE prices, stores portfolio in JSON file
 * Supports stocks (intraday + delivery) and options simulation
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dir, '..', 'data', 'paper-portfolio.json');

const DEFAULT_PORTFOLIO = {
  cash:          100000,   // default ₹1,00,000 virtual capital
  initialCapital: 100000,
  holdings:      {},       // { SYMBOL: { qty, avgPrice, totalCost, boughtAt } }
  orders:        [],       // full order history
  dayPnl:        0,
  createdAt:     new Date().toISOString(),
  lastUpdated:   new Date().toISOString(),
  stats: {
    totalTrades: 0, wins: 0, losses: 0,
    biggestWin: 0, biggestLoss: 0, totalRealizedPnl: 0,
  },
};

// ── In-memory cache + async persist (0ms trades instead of 20-120ms) ─────────
let _cache = null;
let _persistTimer = null;
const PERSIST_DEBOUNCE = 2000; // flush to disk every 2s max

function load() {
  if (_cache) return _cache;
  // Cold start: one-time sync read
  if (!existsSync(DB_PATH)) {
    _cache = { ...DEFAULT_PORTFOLIO };
    _flushSync();
    return _cache;
  }
  try { _cache = JSON.parse(readFileSync(DB_PATH, 'utf8')); }
  catch { _cache = { ...DEFAULT_PORTFOLIO }; }
  return _cache;
}

function save(portfolio) {
  portfolio.lastUpdated = new Date().toISOString();
  _cache = portfolio;
  _schedulePersist();
}

function _schedulePersist() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFile(DB_PATH, JSON.stringify(_cache, null, 2)).catch(err => {
      console.error('Paper trade persist failed:', err.message);
    });
  }, PERSIST_DEBOUNCE);
}

function _flushSync() {
  if (_cache) {
    try {
      const dir = dirname(DB_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(DB_PATH, JSON.stringify(_cache, null, 2));
    } catch {}
  }
}

// Flush on exit so no data is lost
process.on('exit', _flushSync);
process.on('SIGINT', () => { _flushSync(); process.exit(0); });
process.on('SIGTERM', () => { _flushSync(); process.exit(0); });

// ── Orders ────────────────────────────────────────────────────────────────────
export function paperBuy({ symbol, qty, price, orderType = 'MARKET', productType = 'CNC', note = '' }) {
  const portfolio = load();
  const execPrice = price;
  const totalCost = execPrice * qty;
  const brokerage = Math.min(Math.max(totalCost * 0.0003, 20), 200); // 0.03% min ₹20 max ₹200
  const stt       = totalCost * 0.001;  // 0.1% STT on buy (delivery)
  const charges   = brokerage + stt + 18; // GST on brokerage ~₹18

  if (portfolio.cash < totalCost + charges) {
    return { success: false, error: `Insufficient funds. Need ₹${(totalCost + charges).toFixed(2)}, have ₹${portfolio.cash.toFixed(2)}` };
  }

  portfolio.cash -= (totalCost + charges);

  if (!portfolio.holdings[symbol]) {
    portfolio.holdings[symbol] = { qty: 0, avgPrice: 0, totalCost: 0, boughtAt: new Date().toISOString() };
  }
  const h = portfolio.holdings[symbol];
  const newTotal = h.avgPrice * h.qty + totalCost;
  h.qty      += qty;
  h.avgPrice  = newTotal / h.qty;
  h.totalCost = h.avgPrice * h.qty;

  const order = {
    id: `PT-${Date.now()}`, type: 'BUY', symbol, qty, execPrice,
    totalCost, brokerage: charges.toFixed(2), productType, orderType,
    timestamp: new Date().toISOString(), note,
    cashAfter: portfolio.cash.toFixed(2),
  };
  portfolio.orders.push(order);
  portfolio.stats.totalTrades++;
  save(portfolio);
  return { success: true, order, cashRemaining: portfolio.cash.toFixed(2), holding: h };
}

export function paperSell({ symbol, qty, price, productType = 'CNC', note = '' }) {
  const portfolio = load();
  const h = portfolio.holdings[symbol];

  if (!h || h.qty < qty) {
    return { success: false, error: `Cannot sell ${qty} of ${symbol}. Holding: ${h?.qty || 0}` };
  }

  const execPrice = price;
  const saleValue = execPrice * qty;
  const brokerage = Math.min(Math.max(saleValue * 0.0003, 20), 200);
  const stt       = saleValue * 0.001;
  const charges   = brokerage + stt + 18;
  const netReceived = saleValue - charges;

  const costBasis = h.avgPrice * qty;
  const realizedPnl = netReceived - costBasis;

  portfolio.cash += netReceived;
  h.qty          -= qty;
  if (h.qty === 0) delete portfolio.holdings[symbol];
  else h.totalCost = h.avgPrice * h.qty;

  // Update stats
  portfolio.stats.totalRealizedPnl += realizedPnl;
  portfolio.stats.wins   += realizedPnl > 0 ? 1 : 0;
  portfolio.stats.losses += realizedPnl < 0 ? 1 : 0;
  if (realizedPnl > portfolio.stats.biggestWin)  portfolio.stats.biggestWin  = realizedPnl;
  if (realizedPnl < portfolio.stats.biggestLoss) portfolio.stats.biggestLoss = realizedPnl;

  const order = {
    id: `PT-${Date.now()}`, type: 'SELL', symbol, qty, execPrice,
    saleValue, brokerage: charges.toFixed(2), realizedPnl: realizedPnl.toFixed(2),
    productType, timestamp: new Date().toISOString(), note,
    cashAfter: portfolio.cash.toFixed(2),
  };
  portfolio.orders.push(order);
  portfolio.stats.totalTrades++;
  save(portfolio);
  return { success: true, order, realizedPnl: realizedPnl.toFixed(2), cashRemaining: portfolio.cash.toFixed(2) };
}

// ── Option simulation ─────────────────────────────────────────────────────────
export function paperBuyOption({ symbol, strike, type, expiry, qty, premium, lots = 1, lotSize = 1, note = '' }) {
  const portfolio = load();
  const key       = `${symbol}_${strike}_${type}_${expiry}`;
  const totalCost = premium * lots * lotSize;
  const charges   = Math.max(totalCost * 0.0003, 20) + 20; // brokerage + clearing

  if (portfolio.cash < totalCost + charges) {
    return { success: false, error: `Need ₹${(totalCost+charges).toFixed(0)}, have ₹${portfolio.cash.toFixed(0)}` };
  }

  portfolio.cash -= (totalCost + charges);

  if (!portfolio.holdings[key]) {
    portfolio.holdings[key] = { type: 'OPTION', symbol, strike, optType: type, expiry, lots, lotSize, premium, totalCost, boughtAt: new Date().toISOString() };
  }

  const order = {
    id: `PT-${Date.now()}`, type: 'BUY_OPTION', key, symbol, strike, optType: type, expiry,
    lots, lotSize, premium, totalCost, charges: charges.toFixed(2),
    timestamp: new Date().toISOString(), note, cashAfter: portfolio.cash.toFixed(2),
  };
  portfolio.orders.push(order);
  portfolio.stats.totalTrades++;
  save(portfolio);
  return { success: true, order, cashRemaining: portfolio.cash.toFixed(2) };
}

export function paperSellOption({ symbol, strike, type, expiry, currentPremium, note = '' }) {
  const portfolio = load();
  const key       = `${symbol}_${strike}_${type}_${expiry}`;
  const h         = portfolio.holdings[key];

  if (!h) return { success: false, error: `No open position for ${key}` };

  const saleValue   = currentPremium * h.lots * h.lotSize;
  const charges     = Math.max(saleValue * 0.0003, 20) + 20;
  const realizedPnl = saleValue - charges - h.totalCost;

  portfolio.cash += saleValue - charges;
  delete portfolio.holdings[key];

  portfolio.stats.totalRealizedPnl += realizedPnl;
  portfolio.stats.wins   += realizedPnl > 0 ? 1 : 0;
  portfolio.stats.losses += realizedPnl < 0 ? 1 : 0;
  if (realizedPnl > portfolio.stats.biggestWin)  portfolio.stats.biggestWin  = realizedPnl;
  if (realizedPnl < portfolio.stats.biggestLoss) portfolio.stats.biggestLoss = realizedPnl;

  const order = {
    id: `PT-${Date.now()}`, type: 'SELL_OPTION', key,
    buyPremium: h.premium, sellPremium: currentPremium,
    pnl: realizedPnl.toFixed(2), timestamp: new Date().toISOString(), note,
  };
  portfolio.orders.push(order);
  portfolio.stats.totalTrades++;
  save(portfolio);
  return { success: true, order, realizedPnl: realizedPnl.toFixed(2), cashRemaining: portfolio.cash.toFixed(2) };
}

// ── Portfolio view ────────────────────────────────────────────────────────────
export function getPortfolio(livePrices = {}) {
  const p = load();
  let unrealizedPnl = 0;
  let portfolioValue = p.cash;

  const holdings = Object.entries(p.holdings).map(([sym, h]) => {
    if (h.type === 'OPTION') {
      const currentPremium = livePrices[sym] || h.premium;
      const currentValue   = currentPremium * h.lots * h.lotSize;
      const pnl            = currentValue - h.totalCost;
      unrealizedPnl       += pnl;
      portfolioValue      += currentValue;
      return { symbol: sym, type: 'OPTION', ...h, currentPremium, currentValue: currentValue.toFixed(2), unrealizedPnl: pnl.toFixed(2), pnlPct: ((pnl/h.totalCost)*100).toFixed(1)+'%' };
    }
    const ltp    = livePrices[h.symbol || sym] || h.avgPrice;
    const curVal = ltp * h.qty;
    const pnl    = curVal - h.totalCost;
    unrealizedPnl  += pnl;
    portfolioValue += curVal;
    return {
      symbol: h.symbol || sym, qty: h.qty, avgPrice: h.avgPrice.toFixed(2),
      ltp: ltp.toFixed(2), currentValue: curVal.toFixed(2),
      unrealizedPnl: pnl.toFixed(2), pnlPct: ((pnl/h.totalCost)*100).toFixed(1)+'%',
      invested: h.totalCost.toFixed(2),
    };
  });

  const totalPnl = p.stats.totalRealizedPnl + unrealizedPnl;
  const totalReturn = ((totalPnl / p.initialCapital) * 100).toFixed(2);
  const closedTrades = p.stats.wins + p.stats.losses;
  const winRate = closedTrades > 0
    ? ((p.stats.wins / closedTrades) * 100).toFixed(1)
    : 'N/A';

  return {
    cash:           p.cash.toFixed(2),
    portfolioValue: portfolioValue.toFixed(2),
    initialCapital: p.initialCapital.toFixed(2),
    unrealizedPnl:  unrealizedPnl.toFixed(2),
    realizedPnl:    p.stats.totalRealizedPnl.toFixed(2),
    totalPnl:       totalPnl.toFixed(2),
    totalReturn:    totalReturn + '%',
    winRate:        winRate + '%',
    totalTrades:    p.stats.totalTrades,
    wins:           p.stats.wins,
    losses:         p.stats.losses,
    biggestWin:     p.stats.biggestWin.toFixed(2),
    biggestLoss:    p.stats.biggestLoss.toFixed(2),
    holdings,
    lastUpdated:    p.lastUpdated,
  };
}

export function getOrders(limit = 20) {
  const p = load();
  return p.orders.slice(-limit).reverse();
}

export function resetPortfolio(capital = 100000) {
  const fresh = { ...DEFAULT_PORTFOLIO, cash: capital, initialCapital: capital, createdAt: new Date().toISOString() };
  save(fresh);
  return { reset: true, capital };
}

// Trailing Stop Loss — moves SL up as price rises (never moves it down)
export function trailStopLoss(symbol, currentPrice, atrValue, multiplier = 2) {
  const p       = load();
  const holding = p.holdings[symbol.toUpperCase()];
  if (!holding) return { success: false, error: `Not holding ${symbol}` };

  const newSL = parseFloat((currentPrice - multiplier * atrValue).toFixed(2));
  const oldSL = parseFloat((holding.trailSL || holding.avgPrice - multiplier * atrValue).toFixed(2));

  if (newSL <= oldSL) {
    return { success: false, message: `SL at ₹${oldSL} — price not high enough to trail yet` };
  }

  holding.trailSL = newSL;
  p.lastUpdated   = new Date().toISOString();
  save(p);

  return {
    success: true,
    symbol:  symbol.toUpperCase(),
    oldSL,
    newSL,
    moved:   (newSL - oldSL).toFixed(2),
    message: `Trailing SL moved up ₹${(newSL - oldSL).toFixed(2)} → ₹${newSL}`,
  };
}
