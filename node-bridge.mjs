/**
 * Node.js REST Bridge — exposes all trading modules as HTTP endpoints
 * Run: node node-bridge.mjs
 * Port: 3001
 */
import http from 'http';
import fs from 'fs';
import { GrowwClient } from './src/groww-client.js';
import { rsi, sma, ema, macd, bollingerBands, atr, vwap, stochastic, superTrend,
         williamsR, supportResistance, volatility, generateSignal, calcPositionSize } from './src/analytics.js';
import { scanPatterns } from './src/patterns.js';
import { blackScholes, impliedVolatility, buildChainGreeks, maxPain } from './src/greeks.js';
import { analyzeFO, suggestStrategy, detectRegime, greeks as foGreeks,
         bullPutSpread, bearCallSpread, ironCondor, longStraddle, longStrangle,
         kellyCriterion, sizePosition, ivPercentile, analyzePCR } from './src/fo-skill.js';
import { paperBuy, paperSell, paperBuyOption, paperSellOption,
         getPortfolio, getOrders, resetPortfolio, trailStopLoss } from './src/paper-trade.js';
import { addTrade, closeTrade, getStats, getOpenTrades, getAllTrades } from './src/trade-journal.js';
import { historicalSimilarity, patternOutcomes, supportTestHistory, priceZoneMap } from './src/history-analyzer.js';

const PORT = 3001;
const market = new GrowwClient({ apiKey: '', totpSecret: '' });

// ── Helpers ──────────────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function err(res, msg, status = 500) {
  json(res, { success: false, error: msg }, status);
}

async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

function param(url, prefix) {
  return decodeURIComponent(url.slice(prefix.length).split('?')[0]);
}

function query(url) {
  const q = {};
  const idx = url.indexOf('?');
  if (idx < 0) return q;
  url.slice(idx + 1).split('&').forEach(p => {
    const [k, v] = p.split('=');
    q[k] = decodeURIComponent(v || '');
  });
  return q;
}

// ── Route handler ────────────────────────────────────────────────────────────
async function handleRequest(req, res) {
  const { url, method } = req;

  // CORS preflight
  if (method === 'OPTIONS') { json(res, {}); return; }

  try {
    // ── Health ──────────────────────────────────────────
    if (url === '/api/health') {
      return json(res, { ok: true, uptime: process.uptime() });
    }

    // ── Market Data ─────────────────────────────────────
    if (url === '/api/nifty') {
      const data = await market._nseRequest('/equity-stockIndices?index=NIFTY%2050');
      return json(res, { success: true, data: data.data?.[0] || data });
    }
    if (url === '/api/banknifty') {
      const data = await market._nseRequest('/equity-stockIndices?index=NIFTY%20BANK');
      return json(res, { success: true, data: data.data?.[0] || data });
    }
    if (url === '/api/market-status') {
      const data = await market._nseRequest('/marketStatus');
      return json(res, { success: true, data });
    }
    if (url.startsWith('/api/quote/')) {
      const symbol = param(url, '/api/quote/');
      const data = await market.getLivePriceNSE(symbol);
      return json(res, { success: true, data });
    }
    if (url.startsWith('/api/historical/')) {
      const symbol = param(url, '/api/historical/');
      const q = query(url);
      const days = parseInt(q.days) || 90;
      const interval = q.interval || '1d';
      const data = await market.getHistoricalDataYahoo(symbol, 'NSE', days, interval);
      return json(res, { success: true, candles: data.candles || [] });
    }
    if (url === '/api/gainers') {
      const data = await market.getTopGainers('NIFTY 50', 10);
      return json(res, { success: true, data });
    }
    if (url === '/api/losers') {
      const data = await market.getTopLosers('NIFTY 50', 10);
      return json(res, { success: true, data });
    }

    // ── Technical Analysis ──────────────────────────────
    if (url.startsWith('/api/analytics/')) {
      const symbol = param(url, '/api/analytics/');
      const q = query(url);
      const days = parseInt(q.days) || 90;
      const hist = await market.getHistoricalDataYahoo(symbol, 'NSE', days, '1d');
      const candles = hist.candles || [];
      if (candles.length < 20) return err(res, 'Not enough data', 400);

      const closes = candles.map(c => parseFloat(c.close));
      const highs = candles.map(c => parseFloat(c.high));
      const lows = candles.map(c => parseFloat(c.low));
      const vols = candles.map(c => parseFloat(c.volume));

      const result = {
        symbol,
        price: closes[closes.length - 1],
        candles: candles.length,
        rsi: rsi(closes),
        macd: macd(closes),
        bollingerBands: bollingerBands(closes),
        atr: atr(candles),
        vwap: vwap(candles.slice(-20)),
        stochastic: stochastic(closes, highs, lows),
        superTrend: superTrend(candles),
        williamsR: williamsR(closes, highs, lows),
        supportResistance: supportResistance(highs, lows),
        volatility: volatility(closes),
        signal: generateSignal(closes, vols),
      };
      return json(res, { success: true, data: result });
    }

    // ── Patterns ────────────────────────────────────────
    if (url.startsWith('/api/patterns/')) {
      const symbol = param(url, '/api/patterns/');
      const hist = await market.getHistoricalDataYahoo(symbol, 'NSE', 30, '1d');
      const patterns = scanPatterns(hist.candles || []);
      return json(res, { success: true, data: patterns });
    }

    // ── Historical Analysis ─────────────────────────────
    if (url.startsWith('/api/history/')) {
      const symbol = param(url, '/api/history/');
      const hist = await market.getHistoricalDataYahoo(symbol, 'NSE', 365, '1d');
      const candles = hist.candles || [];
      const similarity = historicalSimilarity(candles);
      const zones = priceZoneMap(candles);
      return json(res, { success: true, data: { similarity, zones } });
    }

    // ── Greeks & Options ────────────────────────────────
    if (url === '/api/greeks' && method === 'POST') {
      const b = await readBody(req);
      const result = blackScholes(b.spot, b.strike, b.T, b.r || 0.065, b.iv, b.type || 'CE');
      return json(res, { success: true, data: result });
    }

    // ── F&O Analysis ────────────────────────────────────
    if (url === '/api/fo/analyze' && method === 'POST') {
      const b = await readBody(req);
      const result = await analyzeFO(b);
      return json(res, { success: true, data: result });
    }
    if (url === '/api/fo/suggest' && method === 'POST') {
      const b = await readBody(req);
      const result = suggestStrategy(b);
      return json(res, { success: true, data: result });
    }
    if (url === '/api/fo/regime' && method === 'POST') {
      const b = await readBody(req);
      const result = detectRegime(b);
      return json(res, { success: true, data: result });
    }

    // ── Paper Trading ───────────────────────────────────
    if (url === '/api/paper/portfolio') {
      // Fetch live prices for all holdings so P&L is real
      const rawPortfolio = getPortfolio(); // get without live prices first to see holdings
      const livePrices = {};
      if (rawPortfolio.holdings && rawPortfolio.holdings.length > 0) {
        const pricePromises = rawPortfolio.holdings.map(async (h) => {
          try {
            // For options, skip live price fetch (no easy API)
            if (h.type === 'OPTION') return;
            const sym = (h.symbol || '').replace(/_.*$/, ''); // strip option suffixes
            if (!sym) return;
            const quote = await market.getLivePriceNSE(sym);
            if (quote && quote.priceInfo && quote.priceInfo.lastPrice) {
              livePrices[h.symbol] = quote.priceInfo.lastPrice;
            }
          } catch {}
        });
        await Promise.all(pricePromises);
      }
      return json(res, { success: true, data: getPortfolio(livePrices) });
    }
    if (url === '/api/paper/orders') {
      const q = query(url);
      return json(res, { success: true, data: getOrders(parseInt(q.limit) || 20) });
    }
    if (url === '/api/paper/buy' && method === 'POST') {
      const b = await readBody(req);
      return json(res, paperBuy(b));
    }
    if (url === '/api/paper/sell' && method === 'POST') {
      const b = await readBody(req);
      return json(res, paperSell(b));
    }
    if (url === '/api/paper/buy-option' && method === 'POST') {
      const b = await readBody(req);
      return json(res, paperBuyOption(b));
    }
    if (url === '/api/paper/sell-option' && method === 'POST') {
      const b = await readBody(req);
      return json(res, paperSellOption(b));
    }
    if (url === '/api/paper/reset' && method === 'POST') {
      const b = await readBody(req);
      return json(res, resetPortfolio(b.capital || 100000));
    }
    if (url === '/api/paper/trail-sl' && method === 'POST') {
      const b = await readBody(req);
      return json(res, trailStopLoss(b.symbol, b.currentPrice, b.atrValue, b.multiplier));
    }

    // ── Trade Journal ───────────────────────────────────
    if (url === '/api/journal/stats') {
      return json(res, { success: true, data: getStats() });
    }
    if (url === '/api/journal/open') {
      return json(res, { success: true, data: getOpenTrades() });
    }
    if (url === '/api/journal/all') {
      const q = query(url);
      return json(res, { success: true, data: getAllTrades(parseInt(q.limit) || 50) });
    }
    if (url === '/api/journal/add' && method === 'POST') {
      const b = await readBody(req);
      return json(res, { success: true, data: addTrade(b) });
    }
    if (url === '/api/journal/close' && method === 'POST') {
      const b = await readBody(req);
      return json(res, { success: true, data: closeTrade(b) });
    }

    // ── Position Sizing ─────────────────────────────────
    if (url === '/api/position-size' && method === 'POST') {
      const b = await readBody(req);
      return json(res, { success: true, data: calcPositionSize(b) });
    }

    // ── Skills Index ──────────────────────────────────────
    if (url === '/api/skills' && method === 'GET') {
      try {
        const data = JSON.parse(fs.readFileSync('./data/skills.json', 'utf8'));
        return json(res, { success: true, data: data.skills });
      } catch (e) {
        return json(res, { success: true, data: {} });
      }
    }
    if (url === '/api/skills' && method === 'POST') {
      const b = await readBody(req);
      if (!b.id || !b.skill) return err(res, 'Need id and skill object', 400);
      try {
        const filePath = './data/skills.json';
        let data = { version: 1, skills: {} };
        try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
        data.skills[b.id] = b.skill;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return json(res, { success: true, message: `Skill '${b.id}' saved` });
      } catch (e) {
        return err(res, e.message);
      }
    }
    if (url === '/api/skills/delete' && method === 'POST') {
      const b = await readBody(req);
      if (!b.id) return err(res, 'Need skill id', 400);
      try {
        const filePath = './data/skills.json';
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        delete data.skills[b.id];
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return json(res, { success: true, message: `Skill '${b.id}' deleted` });
      } catch (e) {
        return err(res, e.message);
      }
    }

    // ── Accounts Config ─────────────────────────────────────
    if (url === '/api/accounts' && method === 'GET') {
      try {
        const data = JSON.parse(fs.readFileSync('./data/accounts.json', 'utf8'));
        return json(res, { success: true, data });
      } catch {
        return json(res, { success: true, data: { active: 'paper', accounts: { paper: { name: 'Paper Trading', broker: 'paper', status: 'connected', capital: 100000, enabled: true } } } });
      }
    }
    if (url === '/api/accounts/active' && method === 'POST') {
      const b = await readBody(req);
      if (!b.id) return err(res, 'Need account id', 400);
      try {
        const filePath = './data/accounts.json';
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!data.accounts[b.id]) return err(res, `Account '${b.id}' not found`, 404);
        data.active = b.id;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return json(res, { success: true, active: b.id, message: `Switched to ${data.accounts[b.id].name}` });
      } catch (e) {
        return err(res, e.message);
      }
    }
    if (url === '/api/accounts/add' && method === 'POST') {
      const b = await readBody(req);
      if (!b.id || !b.account) return err(res, 'Need id and account object', 400);
      try {
        const filePath = './data/accounts.json';
        let data;
        try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { data = { active: 'paper', accounts: {} }; }
        data.accounts[b.id] = b.account;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return json(res, { success: true, message: `Account '${b.account.name}' added` });
      } catch (e) {
        return err(res, e.message);
      }
    }
    if (url === '/api/accounts/remove' && method === 'POST') {
      const b = await readBody(req);
      if (!b.id) return err(res, 'Need account id', 400);
      if (b.id === 'paper') return err(res, 'Cannot remove paper account', 400);
      try {
        const filePath = './data/accounts.json';
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        delete data.accounts[b.id];
        if (data.active === b.id) data.active = 'paper';
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return json(res, { success: true, message: 'Removed' });
      } catch (e) {
        return err(res, e.message);
      }
    }
    if (url === '/api/accounts/test' && method === 'POST') {
      const b = await readBody(req);
      if (!b.id) return err(res, 'Need account id', 400);
      try {
        const filePath = './data/accounts.json';
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const acct = data.accounts[b.id];
        if (!acct) return err(res, 'Account not found', 404);
        if (acct.broker === 'paper') {
          acct.status = 'connected';
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
          return json(res, { success: true, status: 'connected', message: 'Paper account always connected' });
        }
        // For real brokers — try to init and authenticate
        try {
          const { initBroker } = await import('./src/brokers/index.js');
          // Temporarily set env vars from account config
          const envMap = {
            groww: { BROKER: 'groww', GROWW_API_KEY: acct.apiKey, GROWW_API_SECRET: acct.apiSecret, TOTP_SECRET: acct.totpSecret },
            angelone: { BROKER: 'angelone', ANGELONE_API_KEY: acct.apiKey, ANGELONE_CLIENT_ID: acct.clientId, ANGELONE_PASSWORD: acct.password, ANGELONE_TOTP_SECRET: acct.totpSecret },
            zerodha: { BROKER: 'zerodha', ZERODHA_API_KEY: acct.apiKey, ZERODHA_API_SECRET: acct.apiSecret, ZERODHA_ACCESS_TOKEN: acct.accessToken },
            upstox: { BROKER: 'upstox', UPSTOX_API_KEY: acct.apiKey, UPSTOX_API_SECRET: acct.apiSecret, UPSTOX_ACCESS_TOKEN: acct.accessToken },
          };
          const envVars = envMap[acct.broker];
          if (envVars) {
            const origEnv = {};
            for (const [k, v] of Object.entries(envVars)) { origEnv[k] = process.env[k]; if (v) process.env[k] = v; }
            try {
              const broker = await initBroker();
              await broker.authenticate();
              acct.status = 'connected';
              fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
              return json(res, { success: true, status: 'connected', message: `${acct.name} authenticated` });
            } catch (authErr) {
              acct.status = 'error';
              acct.lastError = authErr.message;
              fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
              return json(res, { success: false, status: 'error', message: authErr.message });
            } finally {
              for (const [k, v] of Object.entries(origEnv)) { if (v !== undefined) process.env[k] = v; else delete process.env[k]; }
            }
          }
          acct.status = 'unknown';
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
          return json(res, { success: false, status: 'unknown', message: `Broker '${acct.broker}' not testable` });
        } catch (importErr) {
          return json(res, { success: false, status: 'error', message: importErr.message });
        }
      } catch (e) {
        return err(res, e.message);
      }
    }

    // ── Trading Memory ────────────────────────────────────
    if (url === '/api/memory' && method === 'GET') {
      try {
        const data = JSON.parse(fs.readFileSync('./data/trading-memory.json', 'utf8'));
        return json(res, { success: true, data });
      } catch {
        return json(res, { success: true, data: { patterns: [], rules: [], lessons: [], trades: [], notes: [] } });
      }
    }
    if (url === '/api/memory' && method === 'POST') {
      const b = await readBody(req);
      if (!b.category || !b.entry) return err(res, 'Need category and entry', 400);
      try {
        const filePath = './data/trading-memory.json';
        let data;
        try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { data = {}; }
        if (!data[b.category]) data[b.category] = [];
        b.entry.id = Date.now().toString(36);
        b.entry.timestamp = new Date().toISOString();
        data[b.category].push(b.entry);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return json(res, { success: true, message: `Memory saved to ${b.category}` });
      } catch (e) {
        return err(res, e.message);
      }
    }
    if (url === '/api/memory/delete' && method === 'POST') {
      const b = await readBody(req);
      if (!b.category || !b.id) return err(res, 'Need category and id', 400);
      try {
        const filePath = './data/trading-memory.json';
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data[b.category]) {
          data[b.category] = data[b.category].filter(e => e.id !== b.id);
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        }
        return json(res, { success: true, message: 'Deleted' });
      } catch (e) {
        return err(res, e.message);
      }
    }

    // ── 404 ─────────────────────────────────────────────
    err(res, `Not found: ${url}`, 404);

  } catch (e) {
    console.error(`[BRIDGE ERROR] ${url}:`, e.message);
    err(res, e.message);
  }
}

// ── Start ────────────────────────────────────────────────────────────────────
const server = http.createServer(handleRequest);

console.log('Warming up NSE connections...');
await market.warmUp();
console.log('NSE connections warm.');

server.listen(PORT, () => {
  console.log(`Node bridge running on http://localhost:${PORT}`);
  console.log('Endpoints: /api/health, /api/nifty, /api/quote/:sym, /api/analytics/:sym, /api/paper/*, ...');
});
