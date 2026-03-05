import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import { GrowwClient } from './groww-client.js';
import {
  generateSignal, portfolioAnalysis, bollingerBands,
  rsi, macd, sma, ema, volatility, supportResistance, formatINR,
  atr, vwap, stochastic, williamsR, chandelierExit, calcPositionSize, superTrend
} from './analytics.js';
import { scanPatterns, PATTERN_GUIDE } from './patterns.js';
import {
  paperBuy, paperSell, paperBuyOption, paperSellOption,
  getPortfolio, getOrders, resetPortfolio
} from './paper-trade.js';
import { blackScholes, impliedVolatility, buildChainGreeks, maxPain } from './greeks.js';
import {
  addTrade, closeTrade, getStats, getOpenTrades, getAllTrades
} from './trade-journal.js';
import {
  historicalSimilarity, patternOutcomes, supportTestHistory, priceZoneMap
} from './history-analyzer.js';

dotenv.config();

const client = new GrowwClient({ apiKey: process.env.GROWW_API_KEY, totpSecret: process.env.TOTP_SECRET });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const server = new McpServer({ name: 'groww-trading', version: '1.0.0' });

function text(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

async function safe(fn) {
  try { return await fn(); }
  catch (e) { return { error: e.message }; }
}

// ─── ACCOUNT TOOLS (Groww API) ─────────────────────────────────────────────

server.tool('get_profile',
  'Get your Groww account profile by authenticating and checking token',
  {},
  async () => text(await safe(async () => {
    const token = await client.authenticate();
    return { authenticated: true, tokenPreview: token.slice(0, 40) + '...' };
  }))
);

server.tool('get_holdings',
  'Get your current stock holdings from Groww',
  {},
  async () => text(await safe(() => client.getHoldings()))
);

server.tool('get_positions',
  'Get your intraday open positions from Groww',
  {},
  async () => text(await safe(() => client.getPositions()))
);

server.tool('get_margins',
  'Get available funds and margin details from Groww',
  {},
  async () => text(await safe(() => client.getFunds()))
);

server.tool('get_orders',
  'Get your order book from Groww',
  {},
  async () => text(await safe(() => client.getOrderList()))
);

server.tool('place_order',
  'Place a buy or sell order on Groww (NSE/BSE)',
  {
    symbol:          z.string().describe('Trading symbol e.g. RELIANCE'),
    exchange:        z.enum(['NSE', 'BSE']).default('NSE'),
    transactionType: z.enum(['BUY', 'SELL']),
    quantity:        z.number().int().positive(),
    orderType:       z.enum(['MARKET', 'LIMIT', 'SL', 'SL-M']).default('MARKET'),
    price:           z.number().optional().describe('Required for LIMIT orders'),
    productType:     z.enum(['CNC', 'INTRADAY', 'MARGIN']).default('CNC'),
    triggerPrice:    z.number().optional().describe('For SL orders'),
  },
  async ({ symbol, exchange, transactionType, quantity, orderType, price, productType, triggerPrice }) => {
    const data = await safe(() => client.placeOrder({
      trading_symbol: symbol.toUpperCase(),
      exchange,
      segment: 'CASH',
      transaction_type: transactionType,
      quantity,
      order_type: orderType,
      product: productType,
      price: price ?? 0,
      trigger_price: triggerPrice ?? 0,
      validity: 'DAY',
      order_reference_id: `MCP-${Date.now().toString().slice(-8)}`,
    }));
    return text(data);
  }
);

server.tool('cancel_order',
  'Cancel a pending order on Groww',
  { orderId: z.string().describe('Order ID to cancel') },
  async ({ orderId }) => text(await safe(() => client.cancelOrder(orderId, 'CASH')))
);

// ─── SEARCH ────────────────────────────────────────────────────────────────

server.tool('search_stocks',
  'Search for stocks, mutual funds, or ETFs by name or symbol on Groww',
  { query: z.string().describe('Search term e.g. "Reliance" or "TCS"') },
  async ({ query }) => text(await safe(() => client.searchStocks(query)))
);

// ─── MARKET DATA (NSE India) ───────────────────────────────────────────────

server.tool('get_market_status',
  'Get live NSE/BSE market status - open/closed, NIFTY level, trading date',
  {},
  async () => text(await safe(() => client.getMarketStatus()))
);

server.tool('get_live_price',
  'Get real-time live price quote for any NSE-listed stock',
  { symbol: z.string().describe('NSE trading symbol e.g. RELIANCE, TCS, INFY, HDFCBANK') },
  async ({ symbol }) => text(await safe(() => client.getLivePriceNSE(symbol)))
);

server.tool('get_nifty50',
  'Get all NIFTY 50 stocks with live prices, change %, and market cap',
  {},
  async () => text(await safe(() => client.getIndex('NIFTY 50')))
);

server.tool('get_index',
  'Get live data for any NSE index (NIFTY 50, NIFTY BANK, NIFTY IT, etc.)',
  { index: z.string().default('NIFTY 50').describe('Index name e.g. "NIFTY 50", "NIFTY BANK", "NIFTY IT"') },
  async ({ index }) => text(await safe(() => client.getIndex(index)))
);

server.tool('get_all_indices',
  'Get all NSE indices with their live values and change',
  {},
  async () => text(await safe(() => client.getSectorIndices()))
);

server.tool('get_top_gainers',
  'Get top gaining stocks today from a NIFTY index',
  {
    index: z.string().default('NIFTY 50').describe('Index name: "NIFTY 50", "NIFTY BANK", "NIFTY IT", "NIFTY MIDCAP 50"'),
    limit: z.number().int().min(1).max(50).default(10),
  },
  async ({ index, limit }) => text(await safe(() => client.getTopGainers(index, limit)))
);

server.tool('get_top_losers',
  'Get top losing stocks today from a NIFTY index',
  {
    index: z.string().default('NIFTY 50').describe('Index name: "NIFTY 50", "NIFTY BANK", "NIFTY IT", "NIFTY MIDCAP 50"'),
    limit: z.number().int().min(1).max(50).default(10),
  },
  async ({ index, limit }) => text(await safe(() => client.getTopLosers(index, limit)))
);

server.tool('get_most_active',
  'Get most actively traded stocks by volume today from a NIFTY index',
  {
    index: z.string().default('NIFTY 50').describe('Index name: "NIFTY 50", "NIFTY BANK", etc.'),
    limit: z.number().int().min(1).max(50).default(10),
  },
  async ({ index, limit }) => text(await safe(() => client.getMostActive(index, limit)))
);

server.tool('get_option_chain',
  'Get full option chain (calls & puts) for any NSE F&O stock',
  {
    symbol:      z.string().describe('F&O stock symbol e.g. RELIANCE, NIFTY, BANKNIFTY'),
    expiry_date: z.string().describe('Expiry date in YYYY-MM-DD format e.g. 2025-03-27'),
    exchange:    z.enum(['NSE', 'BSE']).default('NSE'),
  },
  async ({ symbol, expiry_date, exchange }) =>
    text(await safe(() => client.getOptionChain(symbol.toUpperCase(), expiry_date, exchange)))
);

server.tool('compare_stocks',
  'Compare multiple NSE stocks side by side with live prices',
  { symbols: z.array(z.string()).min(2).max(10).describe('Array of symbols e.g. ["RELIANCE","TCS","INFY"]') },
  async ({ symbols }) => {
    const results = await Promise.allSettled(symbols.map(s => client.getLivePrice(s)));
    const comparison = symbols.map((sym, i) => {
      if (results[i].status === 'rejected') return { symbol: sym, error: results[i].reason?.message };
      const d = results[i].value;
      const q = d?.priceInfo || d;
      return {
        symbol: sym.toUpperCase(),
        lastPrice: d?.priceInfo?.lastPrice ?? d?.lastPrice,
        change: d?.priceInfo?.change ?? d?.change,
        pChangePct: d?.priceInfo?.pChange ?? d?.pChange,
        high: d?.priceInfo?.intraDayHighLow?.max ?? d?.dayHigh,
        low: d?.priceInfo?.intraDayHighLow?.min ?? d?.dayLow,
        yearHigh: d?.priceInfo?.weekHighLow?.max,
        yearLow: d?.priceInfo?.weekHighLow?.min,
      };
    });
    return text({ comparison });
  }
);

// ─── HISTORICAL DATA (Yahoo Finance) ──────────────────────────────────────

server.tool('get_historical_data',
  'Get historical OHLC price data for any stock (powered by Yahoo Finance)',
  {
    symbol:   z.string().describe('NSE symbol e.g. RELIANCE, TCS'),
    exchange: z.enum(['NSE', 'BSE']).default('NSE'),
    days:     z.number().int().min(7).max(730).default(90).describe('Days of history: 7,30,90,180,365,730'),
    interval: z.enum(['1d', '1wk', '1mo']).default('1d').describe('Candle interval'),
  },
  async ({ symbol, exchange, days, interval }) =>
    text(await safe(() => client.getHistoricalDataYahoo(symbol, exchange, days, interval)))
);

// ─── AI ANALYTICS ─────────────────────────────────────────────────────────

server.tool('analyze_stock',
  'AI-powered technical analysis: RSI, MACD, Bollinger Bands, SMA, support/resistance, buy/sell signal',
  {
    symbol:   z.string().describe('NSE symbol e.g. RELIANCE, TCS, INFY'),
    exchange: z.enum(['NSE', 'BSE']).default('NSE'),
    days:     z.number().int().min(30).max(365).default(90).describe('Days of history to analyze'),
  },
  async ({ symbol, exchange, days }) => {
    try {
      const [hist, liveRes] = await Promise.allSettled([
        client.getHistoricalDataYahoo(symbol, exchange, days),
        client.getLivePriceNSE(symbol)
      ]);

      const histData = hist.status === 'fulfilled' ? hist.value : null;
      const liveData = liveRes.status === 'fulfilled' ? liveRes.value : null;

      let closes = [], highs = [], lows = [], volumes = [];
      if (histData?.candles?.length) {
        closes  = histData.candles.map(c => parseFloat(c.close)).filter(Boolean);
        highs   = histData.candles.map(c => parseFloat(c.high)).filter(Boolean);
        lows    = histData.candles.map(c => parseFloat(c.low)).filter(Boolean);
        volumes = histData.candles.map(c => c.volume || 0);
      }

      const currentPrice = liveData?.priceInfo?.lastPrice
        || liveData?.lastPrice
        || histData?.meta?.regularMarketPrice
        || closes[closes.length - 1] || 0;

      const signal    = closes.length >= 26 ? generateSignal(closes, volumes) : { signal: 'INSUFFICIENT_DATA', confidence: 0, reasons: [] };
      const bb        = closes.length >= 20 ? bollingerBands(closes) : null;
      const rsiVal    = closes.length >= 15 ? rsi(closes) : null;
      const macdData  = closes.length >= 26 ? macd(closes) : null;
      const sma20     = closes.length >= 20 ? sma(closes, 20) : null;
      const sma50     = closes.length >= 50 ? sma(closes, 50) : null;
      const ema9      = closes.length >= 9  ? ema(closes, 9)  : null;
      const volat     = closes.length >= 20 ? volatility(closes) : null;
      const sr        = highs.length  >= 20 ? supportResistance(highs, lows) : null;

      // Price vs key levels
      const priceVsSma20 = sma20 ? (currentPrice > sma20 ? 'ABOVE' : 'BELOW') : 'N/A';
      const priceVsSma50 = sma50 ? (currentPrice > sma50 ? 'ABOVE' : 'BELOW') : 'N/A';

      return text({
        symbol: symbol.toUpperCase(),
        exchange,
        currentPrice,
        analyzedCandles: closes.length,
        dataSource: 'Yahoo Finance + NSE India',

        signal: signal.signal,
        confidence: `${signal.confidence}%`,

        indicators: {
          RSI_14:            rsiVal?.toFixed(2) ?? 'N/A',
          MACD_line:         macdData?.macdLine?.toFixed(2) ?? 'N/A',
          SMA_20:            sma20?.toFixed(2) ?? 'N/A',
          SMA_50:            sma50?.toFixed(2) ?? 'N/A',
          EMA_9:             ema9?.toFixed(2) ?? 'N/A',
          Volatility_Annual: volat ? `${volat.toFixed(1)}%` : 'N/A',
          Bollinger_Upper:   bb?.upper?.toFixed(2) ?? 'N/A',
          Bollinger_Middle:  bb?.middle?.toFixed(2) ?? 'N/A',
          Bollinger_Lower:   bb?.lower?.toFixed(2) ?? 'N/A',
        },

        pricePosition: {
          vs_SMA20:    priceVsSma20,
          vs_SMA50:    priceVsSma50,
          pctBollinger: bb ? `${(((currentPrice - bb.lower) / (bb.upper - bb.lower)) * 100).toFixed(0)}%` : 'N/A',
        },

        keyLevels: sr ? {
          resistance: sr.resistance?.toFixed(2),
          support:    sr.support?.toFixed(2),
          midpoint:   sr.midpoint?.toFixed(2),
        } : 'N/A',

        yearRange: histData?.meta ? {
          high: histData.meta.fiftyTwoWeekHigh,
          low:  histData.meta.fiftyTwoWeekLow,
        } : 'N/A',

        analysis: signal.reasons || [],
        recommendation: buildRecommendation(signal, rsiVal, currentPrice, bb, sr),
        disclaimer: 'Educational only. Not financial advice.',
      });
    } catch (err) {
      return text({ error: err.message });
    }
  }
);

server.tool('analyze_portfolio',
  'AI portfolio analysis: total P&L, holdings breakdown, best/worst performers',
  {},
  async () => {
    const holdingsRes = await Promise.allSettled([client.getHoldings()]);

    if (holdingsRes[0].status === 'rejected') {
      return text({
        error: 'Cannot fetch holdings. Holdings API requires paid Groww subscription (₹499/month).',
        hint: 'Subscribe at groww.in/trade-api to unlock holdings, positions, and live market data.',
      });
    }

    const holdingsData = holdingsRes;

    const holdings = holdingsRes[0].value;
    const rawList = holdings?.holdings || holdings?.data || holdings?.userHolding || [];
    const list = rawList.map(h => ({
      tradingSymbol: h.tradingSymbol || h.symbol,
      quantity:      h.quantity || h.qty || 0,
      averagePrice:  h.averagePrice || h.avgPrice || h.buyAvgPrice || 0,
      ltp:           h.ltp || h.lastTradedPrice || h.currentPrice || 0,
    })).filter(h => h.quantity > 0);

    const metrics = list.length > 0 ? portfolioAnalysis(list) : null;
    const sorted  = [...list].sort((a, b) =>
      ((b.ltp - b.averagePrice) / b.averagePrice) - ((a.ltp - a.averagePrice) / a.averagePrice)
    );

    return text({
      metrics,
      holdings: list.map(h => ({
        symbol:       h.tradingSymbol,
        qty:          h.quantity,
        avgBuy:       formatINR(h.averagePrice),
        currentPrice: formatINR(h.ltp),
        value:        formatINR(h.ltp * h.quantity),
        pnl:          formatINR((h.ltp - h.averagePrice) * h.quantity),
        pnlPct:       (((h.ltp - h.averagePrice) / h.averagePrice) * 100).toFixed(2) + '%',
      })),
      topPerformer: sorted[0]?.tradingSymbol || 'N/A',
      worstPerformer: sorted[sorted.length - 1]?.tradingSymbol || 'N/A',
    });
  }
);

// ─── Recommendation builder ────────────────────────────────────────────────
function buildRecommendation(signal, rsiVal, price, bb, sr) {
  const lines = [];
  if (signal.signal === 'BUY') {
    lines.push(`CONSIDER BUYING - ${signal.confidence}% confidence.`);
    if (sr) lines.push(`Target: resistance at ${sr.resistance?.toFixed(2)}, stop loss near support ${sr.support?.toFixed(2)}`);
  } else if (signal.signal === 'SELL') {
    lines.push(`CONSIDER SELLING - ${signal.confidence}% confidence.`);
    if (sr) lines.push(`If support at ${sr.support?.toFixed(2)} breaks, further downside likely.`);
  } else {
    lines.push('HOLD / NEUTRAL - Mixed signals. Wait for clearer trend.');
  }
  if (rsiVal !== null) {
    if (rsiVal < 30) lines.push('RSI strongly oversold - potential bounce ahead.');
    else if (rsiVal > 70) lines.push('RSI overbought - consider booking profits.');
  }
  return lines;
}

// ─── CANDLESTICK PATTERN SCANNER ───────────────────────────────────────────

server.tool('scan_patterns',
  'Scan candlestick patterns on any stock: Hammer, Engulfing, Morning Star, Doji, Marubozu, and 20+ more with explanations',
  {
    symbol:   z.string().describe('NSE symbol e.g. RELIANCE, NIFTY50, BEL'),
    exchange: z.enum(['NSE', 'BSE']).default('NSE'),
    interval: z.enum(['1d', '1wk']).default('1d').describe('Candle interval: 1d=daily, 1wk=weekly'),
    days:     z.number().int().min(30).max(365).default(60),
  },
  async ({ symbol, exchange, interval, days }) => {
    try {
      const hist    = await client.getHistoricalDataYahoo(symbol, exchange, days, interval);
      const candles = hist.candles;
      const patterns = scanPatterns(candles);

      const lastCandle = candles[candles.length - 1];
      const prevCandle = candles[candles.length - 2];

      // Annotate with education
      const annotated = patterns.map(p => ({
        ...p,
        ...(PATTERN_GUIDE[p.pattern] || {}),
        barsAgo: p.barsAgo || 0,
      }));

      const bullish = annotated.filter(p => p.sentiment === 'BULLISH');
      const bearish = annotated.filter(p => p.sentiment === 'BEARISH');
      const neutral = annotated.filter(p => p.sentiment === 'NEUTRAL');

      const overallBias = bullish.length > bearish.length ? 'BULLISH'
        : bearish.length > bullish.length ? 'BEARISH' : 'NEUTRAL';

      return text({
        symbol: symbol.toUpperCase(),
        interval,
        currentPrice: lastCandle?.close,
        lastCandle: {
          date:  lastCandle?.date,
          open:  lastCandle?.open,
          high:  lastCandle?.high,
          low:   lastCandle?.low,
          close: lastCandle?.close,
          volume: lastCandle?.volume,
          type:  parseFloat(lastCandle?.close) > parseFloat(lastCandle?.open) ? 'BULLISH' : 'BEARISH',
          bodySize: Math.abs(parseFloat(lastCandle?.close) - parseFloat(lastCandle?.open)).toFixed(2),
          range: (parseFloat(lastCandle?.high) - parseFloat(lastCandle?.low)).toFixed(2),
        },
        overallBias,
        patternsFound: annotated.length,
        patterns: annotated,
        summary: {
          bullishSignals: bullish.map(p => p.pattern),
          bearishSignals: bearish.map(p => p.pattern),
          neutralSignals: neutral.map(p => p.pattern),
        },
        strongPatterns: annotated.filter(p => p.strength === 'STRONG'),
      });
    } catch (e) {
      return text({ error: e.message });
    }
  }
);

server.tool('learn_pattern',
  'Learn about any candlestick pattern: what it means, how to trade it, success rate',
  { pattern: z.string().describe('Pattern name e.g. "Hammer", "Morning Star", "Engulfing"') },
  async ({ pattern }) => {
    const key   = Object.keys(PATTERN_GUIDE).find(k => k.toLowerCase().includes(pattern.toLowerCase()));
    const guide = key ? PATTERN_GUIDE[key] : null;
    if (!guide) {
      return text({ error: `Pattern not found. Available: ${Object.keys(PATTERN_GUIDE).join(', ')}` });
    }
    return text({
      pattern: key,
      ...guide,
      tips: [
        'Always confirm pattern with volume — high volume = more reliable',
        'Use with RSI/MACD for confirmation',
        'Context matters: pattern at support/resistance is stronger',
        'Never trade single candle patterns without confirmation candle',
      ],
      allPatterns: Object.keys(PATTERN_GUIDE),
    });
  }
);

// ─── PAPER TRADING ENGINE ───────────────────────────────────────────────────

server.tool('paper_buy',
  'Paper trade: Buy stock at live market price (simulated, no real money)',
  {
    symbol:      z.string().describe('NSE symbol e.g. RELIANCE, TCS, BEL'),
    qty:         z.number().int().positive().describe('Number of shares'),
    productType: z.enum(['CNC', 'INTRADAY']).default('CNC'),
    note:        z.string().optional().describe('Why you are buying — for your journal'),
  },
  async ({ symbol, qty, productType, note }) => {
    try {
      const liveData = await client.getLivePriceNSE(symbol);
      const price    = liveData?.priceInfo?.lastPrice || liveData?.lastPrice;
      if (!price) return text({ error: 'Could not fetch live price' });
      const result = paperBuy({ symbol: symbol.toUpperCase(), qty, price, productType, note: note || '' });
      return text({ ...result, executedAt: price, symbol: symbol.toUpperCase(), qty });
    } catch (e) { return text({ error: e.message }); }
  }
);

server.tool('paper_sell',
  'Paper trade: Sell stock at live market price (simulated, no real money)',
  {
    symbol:      z.string().describe('NSE symbol to sell'),
    qty:         z.number().int().positive(),
    productType: z.enum(['CNC', 'INTRADAY']).default('CNC'),
    note:        z.string().optional(),
  },
  async ({ symbol, qty, productType, note }) => {
    try {
      const liveData = await client.getLivePriceNSE(symbol);
      const price    = liveData?.priceInfo?.lastPrice || liveData?.lastPrice;
      if (!price) return text({ error: 'Could not fetch live price' });
      const result = paperSell({ symbol: symbol.toUpperCase(), qty, price, productType, note: note || '' });
      return text({ ...result, executedAt: price });
    } catch (e) { return text({ error: e.message }); }
  }
);

server.tool('paper_buy_option',
  'Paper trade: Buy an option (CE or PE) at given premium',
  {
    symbol:  z.string().describe('Underlying e.g. NIFTY, BANKNIFTY, BEL'),
    strike:  z.number().describe('Strike price e.g. 24600'),
    type:    z.enum(['CE', 'PE']).describe('Call or Put'),
    expiry:  z.string().describe('Expiry date e.g. 2026-03-27'),
    lots:    z.number().int().positive().default(1),
    lotSize: z.number().int().positive().describe('Lot size e.g. 75 for NIFTY, 35 for BANKNIFTY, 4350 for BEL'),
    premium: z.number().positive().describe('Premium per share e.g. 120'),
    note:    z.string().optional(),
  },
  async ({ symbol, strike, type, expiry, lots, lotSize, premium, note }) => {
    const result = paperBuyOption({ symbol: symbol.toUpperCase(), strike, type, expiry, lots, lotSize, premium, note: note || '' });
    return text(result);
  }
);

server.tool('paper_sell_option',
  'Paper trade: Sell/exit an open option position',
  {
    symbol:         z.string(),
    strike:         z.number(),
    type:           z.enum(['CE', 'PE']),
    expiry:         z.string(),
    currentPremium: z.number().positive().describe('Current premium to exit at'),
    note:           z.string().optional(),
  },
  async ({ symbol, strike, type, expiry, currentPremium, note }) => {
    const result = paperSellOption({ symbol: symbol.toUpperCase(), strike, type, expiry, currentPremium, note: note || '' });
    return text(result);
  }
);

server.tool('paper_portfolio',
  'View your paper trading portfolio with live P&L for all holdings',
  {},
  async () => {
    try {
      const raw = getPortfolio();
      const symbols = raw.holdings
        .filter(h => h.type !== 'OPTION')
        .map(h => h.symbol);

      // Fetch live prices for all holdings
      const prices = {};
      await Promise.allSettled(symbols.map(async sym => {
        try {
          const d = await client.getLivePriceNSE(sym);
          prices[sym] = d?.priceInfo?.lastPrice || d?.lastPrice;
        } catch {}
      }));

      const portfolio = getPortfolio(prices);
      return text(portfolio);
    } catch (e) { return text({ error: e.message }); }
  }
);

server.tool('paper_orders',
  'View your paper trading order history',
  { limit: z.number().int().min(1).max(100).default(20) },
  async ({ limit }) => text({ orders: getOrders(limit), count: limit })
);

server.tool('paper_reset',
  'Reset paper trading portfolio with fresh virtual capital',
  { capital: z.number().int().min(10000).max(10000000).default(100000).describe('Starting virtual capital in INR') },
  async ({ capital }) => text(resetPortfolio(capital))
);

// ─── NEWS FETCHER ──────────────────────────────────────────────────────────
async function fetchMarketNews() {
  try {
    // Yahoo Finance RSS for Indian market
    const res = await fetch('https://finance.yahoo.com/rss/headline?s=%5ENSEI,%5EBSESN,RELIANCE.NS,TCS.NS', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    return items.slice(0, 12).map(m => {
      const raw = m[1];
      const title   = (raw.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)   || raw.match(/<title>(.*?)<\/title>/)   || [])[1] || '';
      const pubDate = (raw.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
      const link    = (raw.match(/<link>(.*?)<\/link>/)       || [])[1] || '';
      return { title: title.trim(), pubDate: pubDate.trim(), link: link.trim() };
    }).filter(n => n.title);
  } catch { return []; }
}

// ─── DEEP MARKET SNAPSHOT ──────────────────────────────────────────────────
async function gatherMarketSnapshot() {
  const [niftyRaw, bnRaw, status, gainers, losers, active, news] = await Promise.allSettled([
    client._nseRequest('/equity-stockIndices?index=NIFTY%2050'),
    client._nseRequest('/equity-stockIndices?index=NIFTY%20BANK'),
    client.getMarketStatus(),
    client.getTopGainers('NIFTY 50', 8),
    client.getTopLosers('NIFTY 50', 8),
    client.getMostActive('NIFTY 50', 5),
    fetchMarketNews(),
  ]);

  const nifty = niftyRaw.status === 'fulfilled' ? niftyRaw.value?.data?.[0] : null;
  const bn    = bnRaw.status   === 'fulfilled' ? bnRaw.value?.data?.[0]    : null;

  // Technical analysis on NIFTY via NIFTYBEES proxy
  let niftyTA = null;
  try {
    const hist = await client.getHistoricalDataYahoo('NIFTYBEES', 'NSE', 90, '1d');
    const closes = hist.candles.map(c => parseFloat(c.close)).filter(Boolean);
    const vols   = hist.candles.map(c => c.volume || 0);
    if (closes.length >= 26) {
      niftyTA = {
        rsi:    rsi(closes)?.toFixed(1),
        signal: generateSignal(closes, vols),
        sma20:  sma(closes, 20)?.toFixed(2),
        sma50:  closes.length >= 50 ? sma(closes, 50)?.toFixed(2) : null,
        bb:     bollingerBands(closes),
        vol:    volatility(closes)?.toFixed(1),
      };
    }
  } catch {}

  // Quick TA on top 3 movers
  const topMovers = gainers.status === 'fulfilled' ? gainers.value.slice(0, 3) : [];
  const moverTA = [];
  for (const s of topMovers) {
    try {
      const hist = await client.getHistoricalDataYahoo(s.symbol, 'NSE', 60, '1d');
      const closes = hist.candles.map(c => parseFloat(c.close)).filter(Boolean);
      const vols   = hist.candles.map(c => c.volume || 0);
      if (closes.length >= 15) {
        moverTA.push({
          symbol:     s.symbol,
          price:      s.lastPrice,
          pChange:    s.pChange,
          rsi:        rsi(closes)?.toFixed(1),
          signal:     closes.length >= 26 ? generateSignal(closes, vols) : null,
          support:    supportResistance(hist.candles.map(c=>parseFloat(c.high)), hist.candles.map(c=>parseFloat(c.low)))?.support?.toFixed(2),
          resistance: supportResistance(hist.candles.map(c=>parseFloat(c.high)), hist.candles.map(c=>parseFloat(c.low)))?.resistance?.toFixed(2),
          vol:        volatility(closes)?.toFixed(1),
        });
      }
    } catch {}
  }

  return {
    nifty:   nifty ? { level: nifty.lastPrice, change: nifty.change, pChange: nifty.pChange, high: nifty.dayHigh, low: nifty.dayLow } : null,
    bn:      bn    ? { level: bn.lastPrice,    change: bn.change,    pChange: bn.pChange,    high: bn.dayHigh,    low: bn.dayLow    } : null,
    status:  status.status   === 'fulfilled' ? status.value?.marketState?.[0]   : null,
    gainers: gainers.status  === 'fulfilled' ? gainers.value  : [],
    losers:  losers.status   === 'fulfilled' ? losers.value   : [],
    active:  active.status   === 'fulfilled' ? active.value   : [],
    news:    news.status     === 'fulfilled' ? news.value     : [],
    niftyTA,
    moverTA,
    timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
  };
}

// ─── TRADING ADVISOR (AI-powered) ─────────────────────────────────────────
server.tool('trading_advisor',
  'AI trading advisor — scans market, F&O, news, technicals and builds a personalized trading plan with smart questions',
  {
    capital:        z.number().optional().describe('Your available trading capital in INR (e.g. 5000, 25000, 100000)'),
    risk:           z.enum(['low', 'medium', 'high']).optional().describe('Risk appetite: low / medium / high'),
    segment:        z.enum(['stocks', 'fno', 'both']).optional().describe('Preferred segment: stocks / fno / both'),
    trading_style:  z.enum(['intraday', 'positional', 'both']).optional().describe('intraday (same day exit) / positional (multi-day) / both'),
    sectors:        z.string().optional().describe('Preferred sectors e.g. "IT, Banking, Metal, Energy"'),
    stop_loss_pct:  z.number().optional().describe('Max % loss per trade you can tolerate e.g. 2'),
    experience:     z.enum(['beginner', 'intermediate', 'advanced']).optional().describe('Your trading experience level'),
  },
  async (profile) => {
    // Collect market data
    const snap = await gatherMarketSnapshot();

    // F&O context
    const niftyLevel = snap.nifty?.level || 0;
    const bnLevel    = snap.bn?.level    || 0;
    const fnoContext = {
      nifty_futures_margin: `~₹${Math.round(niftyLevel * 75 * 0.12).toLocaleString('en-IN')}`,
      nifty_lot_size: 75,
      nifty_atm_option_approx: `~₹${Math.round(niftyLevel * 0.006 * 75).toLocaleString('en-IN')} per lot`,
      banknifty_futures_margin: `~₹${Math.round(bnLevel * 35 * 0.12).toLocaleString('en-IN')}`,
      banknifty_lot_size: 35,
      banknifty_atm_option_approx: `~₹${Math.round(bnLevel * 0.008 * 35).toLocaleString('en-IN')} per lot`,
      popular_fno_stocks: 'RELIANCE(250), TCS(175), HDFCBANK(550), INFY(400), BEL(4350), HINDALCO(700)',
      weekly_expiry: 'Thursday for NIFTY/BANKNIFTY',
      monthly_expiry: 'Last Thursday of month for stock F&O',
    };

    const systemPrompt = `You are an expert Indian stock market trading advisor with deep knowledge of:
- NSE/BSE equity markets, SEBI regulations
- F&O (Futures & Options): NIFTY, BANKNIFTY, stock options, Greeks (Delta, Theta, Vega)
- Technical analysis: RSI, MACD, Bollinger Bands, Support/Resistance, Price Action
- Fundamental analysis: PE ratio, earnings, sector trends
- Market microstructure: liquidity, bid-ask spread, circuit breakers
- Risk management: position sizing, stop loss, R:R ratios
- Tax implications: STCG 15%, LTCG 10%, F&O as business income

Today's date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
Market session: ${snap.status?.marketStatus || 'Unknown'}

You give specific, actionable, data-driven advice. You always consider risk first.
Format your response in clear sections with markdown.`;

    const userMessage = `
## TODAY'S LIVE MARKET DATA

### Indices
- NIFTY 50: ${snap.nifty?.level} | Change: ${snap.nifty?.pChange}% | H: ${snap.nifty?.high} L: ${snap.nifty?.low}
- BANKNIFTY: ${snap.bn?.level} | Change: ${snap.bn?.pChange}% | H: ${snap.bn?.high} L: ${snap.bn?.low}

### NIFTY Technical Analysis (via NIFTYBEES)
${snap.niftyTA ? `
- RSI(14): ${snap.niftyTA.rsi}
- Signal: ${snap.niftyTA.signal?.signal} (${snap.niftyTA.signal?.confidence}% confidence)
- SMA20: ${snap.niftyTA.sma20} | SMA50: ${snap.niftyTA.sma50 || 'N/A'}
- Bollinger: L=${snap.niftyTA.bb?.lower?.toFixed(1)} M=${snap.niftyTA.bb?.middle?.toFixed(1)} U=${snap.niftyTA.bb?.upper?.toFixed(1)}
- Annual Volatility: ${snap.niftyTA.vol}%` : 'Not available'}

### Top Gainers Today (NIFTY 50)
${snap.gainers.map(s => `- ${s.symbol}: ₹${s.lastPrice} (+${s.pChange}%)`).join('\n')}

### Top Losers Today (NIFTY 50)
${snap.losers.map(s => `- ${s.symbol}: ₹${s.lastPrice} (${s.pChange}%)`).join('\n')}

### Most Active by Volume
${snap.active.map(s => `- ${s.symbol}: ₹${s.lastPrice} | Vol: ${s.volume?.toLocaleString?.('en-IN')}`).join('\n')}

### Technical Analysis on Top Movers
${snap.moverTA.map(s => `
**${s.symbol}** ₹${s.price} (+${s.pChange}%)
- RSI: ${s.rsi} | Signal: ${s.signal?.signal} (${s.signal?.confidence}%) | Volatility: ${s.vol}%
- Support: ₹${s.support} | Resistance: ₹${s.resistance}`).join('\n')}

### F&O Context
- NIFTY Futures Margin: ${fnoContext.nifty_futures_margin} (lot: ${fnoContext.nifty_lot_size})
- NIFTY ATM Option (1 lot): ${fnoContext.nifty_atm_option_approx}
- BANKNIFTY Futures Margin: ${fnoContext.banknifty_futures_margin} (lot: ${fnoContext.banknifty_lot_size})
- BANKNIFTY ATM Option (1 lot): ${fnoContext.banknifty_atm_option_approx}
- Weekly Expiry: ${fnoContext.weekly_expiry}
- Popular F&O stocks & lot sizes: ${fnoContext.popular_fno_stocks}

### Today's Market News
${snap.news.slice(0, 8).map((n, i) => `${i+1}. ${n.title}`).join('\n')}

## USER TRADING PROFILE
${profile.capital     ? `- Capital: ₹${profile.capital.toLocaleString('en-IN')}` : '- Capital: NOT PROVIDED'}
${profile.risk        ? `- Risk appetite: ${profile.risk}` : '- Risk appetite: NOT PROVIDED'}
${profile.segment     ? `- Segment: ${profile.segment}` : '- Segment: NOT PROVIDED'}
${profile.trading_style ? `- Style: ${profile.trading_style}` : '- Style: NOT PROVIDED'}
${profile.sectors     ? `- Preferred sectors: ${profile.sectors}` : '- Sectors: NOT PROVIDED'}
${profile.stop_loss_pct ? `- Max stop loss: ${profile.stop_loss_pct}%` : '- Stop loss: NOT PROVIDED'}
${profile.experience  ? `- Experience: ${profile.experience}` : '- Experience: NOT PROVIDED'}

## YOUR TASK

Based on ALL the above data, provide:

1. **MARKET OVERVIEW** — Today's market mood, key levels, what the data tells us
2. **TRADING OPPORTUNITIES** — Specific stocks/options to trade today with entry, target, stop loss, and lot/qty
3. **F&O STRATEGY** — If applicable, specific option trades with strike, expiry, premium estimate, P&L
4. **RISK MANAGEMENT** — Position sizing based on their capital and risk level
5. **PERSONALIZED PLAN** — Step-by-step what to do today from 9:15 AM to 3:30 PM
6. **IMPORTANT QUESTIONS** — Ask 5-7 specific questions to better refine this plan. Number them clearly. Ask about: stop loss comfort, experience with F&O, sector knowledge, time available to monitor, past losses etc.

Be specific with numbers. Use today's live prices. If capital/profile is missing, make assumptions and state them clearly, then ask the questions.`;

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const plan = response.content[0]?.text || 'Unable to generate plan';
    return text({
      market_snapshot: {
        nifty:   snap.nifty,
        bn:      snap.bn,
        session: snap.status?.marketStatus,
        time:    snap.timestamp,
        nifty_signal: snap.niftyTA?.signal?.signal,
        nifty_rsi:    snap.niftyTA?.rsi,
      },
      top_news: snap.news.slice(0, 5).map(n => n.title),
      trading_plan: plan,
    });
  }
);

// ─── QUICK NEWS ────────────────────────────────────────────────────────────
server.tool('get_news',
  'Get latest Indian stock market news headlines',
  {},
  async () => {
    const news = await fetchMarketNews();
    return text({ count: news.length, headlines: news });
  }
);

// ─── OPTIONS GREEKS (Black-Scholes) ────────────────────────────────────────
server.tool('options_greeks',
  'Calculate Black-Scholes options Greeks: Delta, Gamma, Theta, Vega, Rho + implied volatility',
  {
    spot:          z.number().describe('Current spot price e.g. 24500'),
    strike:        z.number().describe('Strike price e.g. 24600'),
    daysToExpiry:  z.number().int().min(0).describe('Days to expiry e.g. 7'),
    type:          z.enum(['CE', 'PE']).describe('Call (CE) or Put (PE)'),
    iv:            z.number().optional().describe('Implied Volatility as decimal e.g. 0.15 for 15%. Default uses 15%'),
    marketPremium: z.number().optional().describe('If given, calculates Implied Volatility from market price'),
    riskFreeRate:  z.number().optional().describe('Risk-free rate decimal e.g. 0.065. Default 6.5%'),
  },
  async ({ spot, strike, daysToExpiry, type, iv, marketPremium, riskFreeRate }) => {
    try {
      const r = riskFreeRate ?? 0.065;
      const T = daysToExpiry / 365;
      let sigma = iv ?? 0.15;

      let calculatedIV = null;
      if (marketPremium) {
        calculatedIV = impliedVolatility(spot, strike, T, r, marketPremium, type);
        if (calculatedIV) sigma = calculatedIV;
      }

      const greeks = blackScholes(spot, strike, T, r, sigma, type);
      const intraDayDecay = (parseFloat(greeks.theta) * -1).toFixed(2);

      // Option chain for ±5 strikes
      const step    = Math.round(spot / 200) * 10 || 50;
      const strikes = Array.from({ length: 11 }, (_, i) => Math.round((strike - 5 * step + i * step) / step) * step);
      const chain   = buildChainGreeks(spot, strikes, daysToExpiry, sigma);

      return text({
        contract:     `${type} ${strike} (${daysToExpiry}d to expiry)`,
        spot,
        iv:           (sigma * 100).toFixed(1) + '%',
        impliedIV:    calculatedIV ? (calculatedIV * 100).toFixed(1) + '%' : null,
        greeks,
        interpretation: {
          delta:  `Price moves ₹${Math.abs(parseFloat(greeks.delta)).toFixed(2)} for every ₹1 move in ${type === 'CE' ? 'up' : 'down'}`,
          theta:  `Loses ₹${intraDayDecay}/share per day just sitting still (time decay)`,
          vega:   `Gains/loses ₹${Math.abs(parseFloat(greeks.vega)).toFixed(2)}/share for every 1% change in IV`,
          gamma:  `Delta changes by ${greeks.gamma} for every ₹1 move`,
        },
        nearbyChain: chain,
        tip: greeks.moneyness === 'ATM'
          ? 'ATM options have highest gamma and vega sensitivity'
          : greeks.moneyness === 'OTM'
          ? 'OTM options are high-risk/reward — theta destroys value fast'
          : 'ITM options behave more like the underlying stock',
      });
    } catch (e) { return text({ error: e.message }); }
  }
);

// ─── POSITION SIZER (Risk Management) ──────────────────────────────────────
server.tool('position_sizer',
  'Calculate exact position size based on your capital, risk %, entry price, and stop loss. Uses ATR-based dynamic stop if candles provided.',
  {
    capital:        z.number().describe('Total trading capital in INR e.g. 100000'),
    riskPct:        z.number().min(0.1).max(10).default(1).describe('Max % of capital to risk per trade e.g. 1 = 1%'),
    entryPrice:     z.number().describe('Planned entry price'),
    stopLossPrice:  z.number().optional().describe('Your stop loss price. If not given, ATR-based SL is calculated'),
    symbol:         z.string().optional().describe('NSE symbol to fetch ATR for auto stop loss'),
    atrMultiplier:  z.number().default(2).describe('ATR multiplier for stop loss e.g. 2 = 2×ATR below entry'),
  },
  async ({ capital, riskPct, entryPrice, stopLossPrice, symbol, atrMultiplier }) => {
    try {
      let sl = stopLossPrice;
      let atrValue = null, atrSL = null;

      if (!sl && symbol) {
        const hist = await client.getHistoricalDataYahoo(symbol, 'NSE', 30, '1d');
        atrValue = atr(hist.candles, 14);
        if (atrValue) {
          atrSL = entryPrice - atrMultiplier * atrValue;
          sl = atrSL;
        }
      }

      if (!sl) {
        return text({ error: 'Provide stopLossPrice or a symbol for ATR-based stop loss' });
      }

      const sizing = calcPositionSize({ capital, riskPct, entryPrice, stopLossPrice: sl });
      if (!sizing) return text({ error: 'Entry and stop loss cannot be the same price' });

      const target1 = entryPrice + Math.abs(entryPrice - sl) * 1.5;
      const target2 = entryPrice + Math.abs(entryPrice - sl) * 3;

      return text({
        symbol:         symbol?.toUpperCase() || 'CUSTOM',
        capital:        `₹${capital.toLocaleString('en-IN')}`,
        riskPerTrade:   `₹${(capital * riskPct / 100).toFixed(0)} (${riskPct}%)`,
        entry:          entryPrice,
        stopLoss:       sl.toFixed(2),
        slType:         atrSL ? `ATR-based (${atrMultiplier}×ATR = ${(atrMultiplier * atrValue).toFixed(2)})` : 'Manual',
        atr:            atrValue?.toFixed(2) || 'N/A',
        ...sizing,
        targets: {
          t1: target1.toFixed(2) + ` (1.5R — ₹${((target1 - entryPrice) * sizing.qty).toFixed(0)} profit)`,
          t2: target2.toFixed(2) + ` (3R — ₹${((target2 - entryPrice) * sizing.qty).toFixed(0)} profit)`,
        },
        rule: `Never risk more than ${riskPct}% per trade. This is the #1 survival rule.`,
      });
    } catch (e) { return text({ error: e.message }); }
  }
);

// ─── STOCK SCREENER ─────────────────────────────────────────────────────────
server.tool('stock_screener',
  'Institutional-grade stock screener: scan NIFTY 50/100 for RSI oversold/overbought, momentum setups, breakouts',
  {
    index:     z.string().default('NIFTY 50').describe('Index to scan: "NIFTY 50", "NIFTY BANK", "NIFTY IT"'),
    filter:    z.enum(['rsi_oversold', 'rsi_overbought', 'breakout', 'momentum_buy', 'near_support', 'all']).default('all'),
    rsi_low:   z.number().default(35).describe('RSI threshold for oversold'),
    rsi_high:  z.number().default(65).describe('RSI threshold for overbought'),
    limit:     z.number().int().min(5).max(25).default(10),
  },
  async ({ index, filter, rsi_low, rsi_high, limit }) => {
    try {
      const stocks = await client.getTopGainers(index, 30);
      const losers = await client.getTopLosers(index, 30);
      const all    = [...stocks, ...losers].slice(0, 30);
      const unique = [...new Map(all.map(s => [s.symbol, s])).values()].slice(0, 20);

      const results = [];
      for (const s of unique) {
        try {
          const hist   = await client.getHistoricalDataYahoo(s.symbol, 'NSE', 60, '1d');
          const candles = hist.candles;
          const closes  = candles.map(c => parseFloat(c.close)).filter(Boolean);
          const highs   = candles.map(c => parseFloat(c.high)).filter(Boolean);
          const lows    = candles.map(c => parseFloat(c.low)).filter(Boolean);
          const vols    = candles.map(c => c.volume || 0);

          if (closes.length < 20) continue;

          const rsiVal = rsi(closes);
          const bb     = bollingerBands(closes);
          const sma20v = sma(closes, 20);
          const atrVal = atr(candles, 14);
          const sr     = supportResistance(highs, lows);
          const price  = closes[closes.length - 1];
          const signal = closes.length >= 26 ? generateSignal(closes, vols) : null;
          const st     = superTrend(candles);
          const patts  = scanPatterns(candles);

          const entry = {
            symbol:     s.symbol,
            price:      price.toFixed(2),
            pChange:    s.pChange,
            rsi:        rsiVal?.toFixed(1),
            signal:     signal?.signal,
            confidence: signal?.confidence,
            sma20:      sma20v?.toFixed(2),
            atr:        atrVal?.toFixed(2),
            support:    sr?.support?.toFixed(2),
            resistance: sr?.resistance?.toFixed(2),
            bb_pos:     bb ? (price < bb.lower ? 'BELOW_BB' : price > bb.upper ? 'ABOVE_BB' : 'INSIDE_BB') : null,
            supertrend: st?.trend,
            patterns:   patts.filter(p => p.barsAgo === 0 || !p.barsAgo).map(p => p.pattern),
          };

          const matched = filter === 'all'
            || (filter === 'rsi_oversold'   && rsiVal < rsi_low)
            || (filter === 'rsi_overbought' && rsiVal > rsi_high)
            || (filter === 'breakout'       && price > sr?.resistance * 0.995)
            || (filter === 'momentum_buy'   && signal?.signal === 'BUY' && signal?.confidence >= 60)
            || (filter === 'near_support'   && sr && Math.abs(price - sr.support) / sr.support < 0.015);

          if (matched) results.push(entry);
        } catch {}
      }

      results.sort((a, b) => {
        if (filter === 'rsi_oversold')   return parseFloat(a.rsi) - parseFloat(b.rsi);
        if (filter === 'rsi_overbought') return parseFloat(b.rsi) - parseFloat(a.rsi);
        if (filter === 'momentum_buy')   return (b.confidence || 0) - (a.confidence || 0);
        return Math.abs(parseFloat(b.pChange)) - Math.abs(parseFloat(a.pChange));
      });

      return text({
        index, filter,
        scanned: unique.length,
        matched: results.length,
        results: results.slice(0, limit),
        tip: filter === 'rsi_oversold'
          ? 'RSI < 35 means stock is oversold — potential bounce. Confirm with support level and volume.'
          : filter === 'breakout'
          ? 'Price near resistance — breakout trade. Buy on close above resistance with volume surge.'
          : 'Cross-reference with candlestick patterns before entering any trade.',
      });
    } catch (e) { return text({ error: e.message }); }
  }
);

// ─── PRO MULTI-TIMEFRAME ANALYSIS ───────────────────────────────────────────
server.tool('pro_analysis',
  'Pro-grade deep analysis: ATR stops, VWAP, Stochastic, SuperTrend, Chandelier Exit, confluence score',
  {
    symbol:   z.string().describe('NSE symbol e.g. RELIANCE, TCS, NIFTY50'),
    exchange: z.enum(['NSE', 'BSE']).default('NSE'),
  },
  async ({ symbol, exchange }) => {
    try {
      const [histDay, histWeek, liveRes] = await Promise.allSettled([
        client.getHistoricalDataYahoo(symbol, exchange, 90,  '1d'),
        client.getHistoricalDataYahoo(symbol, exchange, 365, '1wk'),
        client.getLivePriceNSE(symbol),
      ]);

      const dCandles = histDay.status  === 'fulfilled' ? histDay.value.candles  : [];
      const wCandles = histWeek.status === 'fulfilled' ? histWeek.value.candles : [];
      const live     = liveRes.status  === 'fulfilled' ? liveRes.value : null;

      const dCloses  = dCandles.map(c => parseFloat(c.close)).filter(Boolean);
      const dHighs   = dCandles.map(c => parseFloat(c.high)).filter(Boolean);
      const dLows    = dCandles.map(c => parseFloat(c.low)).filter(Boolean);
      const dVols    = dCandles.map(c => c.volume || 0);

      const price = live?.priceInfo?.lastPrice || live?.lastPrice || dCloses[dCloses.length-1] || 0;

      const daily = {
        rsi:    dCloses.length >= 15 ? rsi(dCloses)?.toFixed(1) : null,
        signal: dCloses.length >= 26 ? generateSignal(dCloses, dVols) : null,
        sma20:  dCloses.length >= 20 ? sma(dCloses, 20)?.toFixed(2) : null,
        sma50:  dCloses.length >= 50 ? sma(dCloses, 50)?.toFixed(2) : null,
        atr14:  atr(dCandles, 14)?.toFixed(2),
        vwapVal: vwap(dCandles.slice(-20))?.toFixed(2),
        stoch:  dCloses.length >= 20 ? stochastic(dCloses, dHighs, dLows) : null,
        willR:  dCloses.length >= 14 ? williamsR(dCloses, dHighs, dLows)?.toFixed(1) : null,
        chandelier: chandelierExit(dCandles),
        supertrend: superTrend(dCandles),
        patterns: scanPatterns(dCandles).filter(p => !p.barsAgo).map(p => p.pattern),
        sr:     supportResistance(dHighs, dLows),
        bb:     bollingerBands(dCloses),
      };

      const wCloses = wCandles.map(c => parseFloat(c.close)).filter(Boolean);
      const wHighs  = wCandles.map(c => parseFloat(c.high)).filter(Boolean);
      const wLows   = wCandles.map(c => parseFloat(c.low)).filter(Boolean);
      const wVols   = wCandles.map(c => c.volume || 0);

      const weekly = wCloses.length >= 14 ? {
        rsi:    rsi(wCloses)?.toFixed(1),
        signal: wCloses.length >= 26 ? generateSignal(wCloses, wVols) : null,
        sma20:  wCloses.length >= 20 ? sma(wCloses, 20)?.toFixed(2) : null,
        sr:     supportResistance(wHighs, wLows),
        supertrend: superTrend(wCandles),
      } : null;

      // Confluence score (0–10)
      let score = 0, reasons = [];
      if (daily.signal?.signal === 'BUY')  { score += 2; reasons.push('Daily BUY signal'); }
      if (weekly?.signal?.signal === 'BUY') { score += 2; reasons.push('Weekly BUY signal — strong confluence'); }
      if (daily.rsi < 40)  { score += 1; reasons.push('Daily RSI oversold'); }
      if (daily.stoch?.oversold) { score += 1; reasons.push('Stochastic oversold'); }
      if (daily.supertrend?.trend === 'BULLISH') { score += 1; reasons.push('SuperTrend BULLISH'); }
      if (weekly?.supertrend?.trend === 'BULLISH') { score += 1; reasons.push('Weekly SuperTrend BULLISH'); }
      if (daily.patterns.length > 0) { score += 1; reasons.push(`Patterns: ${daily.patterns.join(', ')}`); }
      if (price > parseFloat(daily.vwapVal || 0)) { score += 1; reasons.push('Price above VWAP'); }

      const bias = score >= 6 ? 'STRONG BUY' : score >= 4 ? 'MILD BUY' : score <= 2 ? 'BEARISH' : 'NEUTRAL';

      // ATR-based trade plan
      const atrVal = parseFloat(daily.atr14 || 0);
      const tradePlan = atrVal > 0 ? {
        entry:   price.toFixed(2),
        sl_1atr: (price - atrVal).toFixed(2),
        sl_2atr: (price - 2 * atrVal).toFixed(2),
        t1_1r:   (price + atrVal).toFixed(2),
        t2_2r:   (price + 2 * atrVal).toFixed(2),
        t3_3r:   (price + 3 * atrVal).toFixed(2),
      } : null;

      return text({
        symbol: symbol.toUpperCase(),
        price,
        bias,
        confluenceScore: `${score}/10`,
        confluenceReasons: reasons,
        daily: {
          ...daily,
          sr: {
            support:    daily.sr?.support?.toFixed(2),
            resistance: daily.sr?.resistance?.toFixed(2),
          },
          bb: daily.bb ? {
            upper: daily.bb.upper?.toFixed(2),
            middle: daily.bb.middle?.toFixed(2),
            lower: daily.bb.lower?.toFixed(2),
          } : null,
        },
        weekly,
        atrTradePlan: tradePlan,
        chandelierStop: daily.chandelier,
      });
    } catch (e) { return text({ error: e.message }); }
  }
);

// ─── SECTOR ROTATION MONITOR ────────────────────────────────────────────────
server.tool('sector_rotation',
  'Track which sectors are hot/cold today. FIIs rotate between sectors — follow the money.',
  {},
  async () => {
    const sectors = [
      'NIFTY IT', 'NIFTY BANK', 'NIFTY PHARMA', 'NIFTY AUTO',
      'NIFTY METAL', 'NIFTY ENERGY', 'NIFTY FMCG', 'NIFTY REALTY',
      'NIFTY INFRA', 'NIFTY MEDIA', 'NIFTY MIDCAP 50', 'NIFTY SMALLCAP 50'
    ];

    const results = await Promise.allSettled(
      sectors.map(s => client._nseRequest(`/equity-stockIndices?index=${encodeURIComponent(s)}`))
    );

    const data = sectors.map((name, i) => {
      if (results[i].status !== 'fulfilled') return { sector: name, error: true };
      const d = results[i].value?.data?.[0];
      if (!d) return { sector: name, error: true };
      return {
        sector:  name,
        value:   d.lastPrice,
        change:  d.change?.toFixed(2),
        pChange: d.pChange?.toFixed(2),
        trend:   parseFloat(d.pChange) > 0 ? 'UP' : 'DOWN',
        volume:  d.totalTurnover?.toLocaleString?.('en-IN'),
      };
    }).filter(d => !d.error);

    const sorted  = [...data].sort((a, b) => parseFloat(b.pChange) - parseFloat(a.pChange));
    const hot     = sorted.slice(0, 3);
    const cold    = sorted.slice(-3).reverse();
    const advancing = data.filter(d => d.trend === 'UP').length;
    const declining = data.filter(d => d.trend === 'DOWN').length;

    return text({
      marketBreadth: `${advancing} sectors UP, ${declining} sectors DOWN`,
      sentiment: advancing > declining ? 'RISK-ON (Bullish broad market)' : 'RISK-OFF (Defensive rotation)',
      hotSectors:  hot.map(s => `${s.sector}: +${s.pChange}%`),
      coldSectors: cold.map(s => `${s.sector}: ${s.pChange}%`),
      allSectors:  sorted,
      insight: hot.length > 0 ? `MONEY FLOWING INTO: ${hot.map(s => s.sector).join(', ')}. Trade stocks in these sectors.` : '',
    });
  }
);

// ─── TRADE JOURNAL ───────────────────────────────────────────────────────────
server.tool('journal_add',
  'Add a planned or executed trade to your journal with rationale — track like a pro',
  {
    symbol:      z.string().describe('NSE symbol'),
    type:        z.enum(['BUY', 'SELL', 'CE', 'PE']),
    segment:     z.enum(['EQUITY', 'FUTURES', 'OPTIONS']).default('EQUITY'),
    entry:       z.number().describe('Entry price'),
    target:      z.number().optional().describe('Target price'),
    stopLoss:    z.number().optional().describe('Stop loss price'),
    qty:         z.number().int().positive().describe('Quantity / number of shares'),
    lotSize:     z.number().int().default(1).describe('Lot size (1 for equity, 75 for NIFTY etc.)'),
    entryReason: z.string().optional().describe('Why you are entering this trade'),
    setup:       z.string().optional().describe('Setup name e.g. "RSI Oversold + Hammer" or "Breakout"'),
    timeframe:   z.enum(['1m', '5m', '15m', '1h', '1d', '1wk']).default('1d'),
    tags:        z.array(z.string()).optional().describe('Tags e.g. ["momentum", "earnings"]'),
  },
  async (args) => text(addTrade(args))
);

server.tool('journal_close',
  'Close an open journal trade and record the exit price, P&L, and lesson learned',
  {
    tradeId:   z.string().describe('Trade ID from journal_add e.g. TJ-1234567890'),
    exitPrice: z.number().describe('Price at which you exited'),
    lesson:    z.string().optional().describe('What did you learn from this trade?'),
  },
  async ({ tradeId, exitPrice, lesson }) => text(closeTrade({ id: tradeId, exitPrice, lesson }))
);

server.tool('journal_stats',
  'Get your trading performance statistics: win rate, avg R:R, expectancy, profit factor, max drawdown',
  {
    symbol:  z.string().optional().describe('Filter by symbol'),
    segment: z.enum(['EQUITY', 'FUTURES', 'OPTIONS']).optional().describe('Filter by segment'),
    since:   z.string().optional().describe('Filter since date e.g. 2026-01-01'),
  },
  async (filter) => text(getStats(filter))
);

server.tool('journal_open',
  'View all currently open journal trades with unrealized status',
  {},
  async () => text({ openTrades: getOpenTrades() })
);

// ─── BACKTEST (Simple Strategy) ──────────────────────────────────────────────
server.tool('backtest',
  'Backtest simple strategies on historical data: RSI mean-reversion, SMA crossover, BB bounce',
  {
    symbol:   z.string().describe('NSE symbol e.g. RELIANCE, TCS'),
    strategy: z.enum(['rsi_reversion', 'sma_crossover', 'bb_bounce', 'macd_crossover']).describe(
      'rsi_reversion: buy <30 sell >70 | sma_crossover: 20/50 SMA cross | bb_bounce: buy at lower BB | macd_crossover: MACD signal line cross'
    ),
    days:     z.number().int().min(90).max(730).default(365).describe('Days of history to test'),
    capital:  z.number().default(100000).describe('Starting capital for simulation'),
  },
  async ({ symbol, strategy, days, capital }) => {
    try {
      const hist    = await client.getHistoricalDataYahoo(symbol, 'NSE', days, '1d');
      const candles = hist.candles;
      const closes  = candles.map(c => parseFloat(c.close)).filter(Boolean);
      const dates   = candles.map(c => c.date);

      if (closes.length < 50) return text({ error: 'Not enough data for backtesting' });

      const trades = [];
      let position = null, cash = capital, equity = capital;
      let wins = 0, losses = 0;

      for (let i = 50; i < closes.length; i++) {
        const slice  = closes.slice(0, i + 1);
        const price  = closes[i];
        const rsiVal = rsi(slice);
        const bb     = bollingerBands(slice);
        const sma20v = sma(slice, 20);
        const sma50v = sma(slice, 50);
        const macdD  = macd(slice);

        let signal = null;

        if (strategy === 'rsi_reversion') {
          if (!position && rsiVal < 30) signal = 'BUY';
          if (position  && rsiVal > 70) signal = 'SELL';
        } else if (strategy === 'sma_crossover') {
          const prev20 = sma(closes.slice(0, i), 20);
          const prev50 = sma(closes.slice(0, i), 50);
          if (!position && prev20 < prev50 && sma20v > sma50v) signal = 'BUY';
          if (position  && prev20 > prev50 && sma20v < sma50v) signal = 'SELL';
        } else if (strategy === 'bb_bounce') {
          if (!position && bb && price < bb.lower) signal = 'BUY';
          if (position  && bb && price > bb.middle) signal = 'SELL';
        } else if (strategy === 'macd_crossover') {
          const prevMacd = i > 0 ? macd(closes.slice(0, i)) : null;
          if (!position && prevMacd && prevMacd.macdLine < 0 && macdD?.macdLine > 0) signal = 'BUY';
          if (position  && prevMacd && prevMacd.macdLine > 0 && macdD?.macdLine < 0) signal = 'SELL';
        }

        if (signal === 'BUY' && !position) {
          const qty = Math.floor(cash / price);
          position = { qty, entryPrice: price, entryDate: dates[i] };
          cash -= qty * price;
        } else if (signal === 'SELL' && position) {
          const proceeds = position.qty * price;
          const pnl      = (price - position.entryPrice) * position.qty;
          cash += proceeds;
          if (pnl > 0) wins++; else losses++;
          trades.push({
            entry: position.entryPrice.toFixed(2), entryDate: position.entryDate,
            exit: price.toFixed(2), exitDate: dates[i],
            qty: position.qty, pnl: pnl.toFixed(2),
          });
          position = null;
        }
      }

      // Close open position at last price
      if (position) {
        const lastPrice = closes[closes.length - 1];
        cash += position.qty * lastPrice;
      }
      equity = cash;

      const totalPnl  = equity - capital;
      const winRate   = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : 0;
      const pnls      = trades.map(t => parseFloat(t.pnl));
      const avgWin    = pnls.filter(p => p > 0).length ? pnls.filter(p => p > 0).reduce((a, b) => a + b, 0) / wins : 0;
      const avgLoss   = pnls.filter(p => p < 0).length ? pnls.filter(p => p < 0).reduce((a, b) => a + b, 0) / losses : 0;

      return text({
        symbol: symbol.toUpperCase(),
        strategy,
        period: `${days} days`,
        capital: `₹${capital.toLocaleString('en-IN')}`,
        finalValue: `₹${equity.toFixed(0)}`,
        totalReturn: `${((totalPnl / capital) * 100).toFixed(2)}%`,
        totalPnl: totalPnl.toFixed(2),
        totalTrades: trades.length,
        wins, losses,
        winRate: winRate + '%',
        avgWin:  avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        profitFactor: avgLoss !== 0 ? Math.abs((avgWin * wins) / (avgLoss * losses)).toFixed(2) : '∞',
        recentTrades: trades.slice(-10),
        buyHoldReturn: closes.length > 0
          ? `${(((closes[closes.length-1] - closes[50]) / closes[50]) * 100).toFixed(2)}% (vs our strategy)`
          : 'N/A',
      });
    } catch (e) { return text({ error: e.message }); }
  }
);

// ─── INTRADAY VWAP ANALYSIS ──────────────────────────────────────────────────
server.tool('vwap_analysis',
  'VWAP (Volume Weighted Avg Price) — the most important intraday level. Price above VWAP = institutions buying.',
  {
    symbol:   z.string().describe('NSE symbol'),
    exchange: z.enum(['NSE', 'BSE']).default('NSE'),
  },
  async ({ symbol, exchange }) => {
    try {
      const hist    = await client.getHistoricalDataYahoo(symbol, exchange, 30, '1d');
      const candles = hist.candles;
      const live    = await client.getLivePriceNSE(symbol).catch(() => null);
      const price   = live?.priceInfo?.lastPrice || live?.lastPrice || parseFloat(candles[candles.length-1]?.close);

      // Daily VWAP (using last 20 sessions as proxy for rolling VWAP)
      const vwap20  = vwap(candles.slice(-20));
      const vwap5   = vwap(candles.slice(-5));
      const vwapAll = vwap(candles);

      const atrVal  = atr(candles, 14);
      const closes  = candles.map(c => parseFloat(c.close)).filter(Boolean);

      const bands = vwap20 && atrVal ? {
        upper2: (vwap20 + 2 * atrVal).toFixed(2),
        upper1: (vwap20 + atrVal).toFixed(2),
        vwap:   vwap20.toFixed(2),
        lower1: (vwap20 - atrVal).toFixed(2),
        lower2: (vwap20 - 2 * atrVal).toFixed(2),
      } : null;

      const aboveVWAP = vwap20 && price > vwap20;

      return text({
        symbol: symbol.toUpperCase(),
        price,
        vwap_20day:  vwap20?.toFixed(2),
        vwap_5day:   vwap5?.toFixed(2),
        vwap_all:    vwapAll?.toFixed(2),
        aboveVWAP,
        vwapBands:   bands,
        atr:         atrVal?.toFixed(2),
        bias:        aboveVWAP ? 'BULLISH — price above VWAP (institutions net buyers)' : 'BEARISH — price below VWAP (institutions net sellers)',
        trade: {
          long:  `Buy above VWAP (${vwap20?.toFixed(2)}). SL at VWAP-1ATR (${bands?.lower1}). Target VWAP+2ATR (${bands?.upper2})`,
          short: `Sell below VWAP (${vwap20?.toFixed(2)}). SL at VWAP+1ATR (${bands?.upper1}). Target VWAP-2ATR (${bands?.lower2})`,
        },
        tip: 'VWAP reversion is one of the most reliable intraday strategies. Price always gravitates to VWAP.',
      });
    } catch (e) { return text({ error: e.message }); }
  }
);

// ─── HISTORICAL ANALYSIS (Human behaviour repeats) ─────────────────────────

server.tool('historical_similarity',
  'Find past moments in history that look exactly like today\'s setup. Shows what happened next — 5, 10, 20 days forward. "History doesn\'t repeat but it rhymes."',
  {
    symbol:   z.string().describe('NSE symbol e.g. RELIANCE, TCS, HDFCBANK'),
    exchange: z.enum(['NSE', 'BSE']).default('NSE'),
    days:     z.number().int().min(180).max(730).default(365).describe('How much history to search through'),
    topN:     z.number().int().min(3).max(10).default(5).describe('Number of similar past setups to return'),
  },
  async ({ symbol, exchange, days, topN }) => {
    try {
      const hist    = await client.getHistoricalDataYahoo(symbol, exchange, days, '1d');
      const candles = hist.candles;
      if (!candles?.length) return text({ error: 'No historical data found' });

      const result = historicalSimilarity(candles, topN);

      return text({
        symbol: symbol.toUpperCase(),
        exchange,
        dataPoints: candles.length,
        ...result,
        howToRead: [
          'Each match = a past day when RSI, Bollinger position, price vs SMA was almost identical to today',
          '"after10d" = what price actually did 10 trading days after that similar moment',
          'If 4 out of 5 matches show +5% in 10 days → strong bullish precedent',
          'This is not a guarantee — it\'s a probability edge based on historical human behaviour',
        ],
      });
    } catch (e) { return text({ error: e.message }); }
  }
);

server.tool('pattern_outcomes',
  'See the full historical track record of any candlestick pattern on a stock — win rate, avg return, profit factor. Know if "Hammer on RELIANCE" actually works before you trade it.',
  {
    symbol:      z.string().describe('NSE symbol'),
    pattern:     z.string().describe('Pattern name e.g. "Hammer", "Bullish Engulfing", "Morning Star", "Doji"'),
    exchange:    z.enum(['NSE', 'BSE']).default('NSE'),
    days:        z.number().int().min(180).max(730).default(365).describe('History to scan'),
    forwardDays: z.number().int().min(3).max(30).default(10).describe('Days to measure outcome after pattern'),
  },
  async ({ symbol, pattern, exchange, days, forwardDays }) => {
    try {
      const hist    = await client.getHistoricalDataYahoo(symbol, exchange, days, '1d');
      const candles = hist.candles;
      if (!candles?.length) return text({ error: 'No historical data' });

      const result = patternOutcomes(candles, pattern, forwardDays);

      // Also add the pattern education guide
      const guide = PATTERN_GUIDE[Object.keys(PATTERN_GUIDE).find(k => k.toLowerCase().includes(pattern.toLowerCase()))] || null;

      return text({
        symbol: symbol.toUpperCase(),
        ...result,
        patternGuide: guide,
        interpretation: result.totalOccurrences > 0 ? [
          `Found ${result.totalOccurrences} historical occurrences of "${result.patternName}" on ${symbol}`,
          `Win rate: ${result.winRate} — ${parseFloat(result.winRate) >= 60 ? 'RELIABLE pattern on this stock' : parseFloat(result.winRate) >= 45 ? 'MODERATE reliability — use with confirmation' : 'LOW reliability on this stock — skip or use strict filters'}`,
          `Profit factor: ${result.profitFactor} — ${parseFloat(result.profitFactor) >= 2 ? 'Excellent R:R historically' : parseFloat(result.profitFactor) >= 1.5 ? 'Good R:R' : 'Poor R:R — wins are small, losses are big'}`,
          `Avg time to target: ${result.avgDaysToTarget}`,
        ] : [],
      });
    } catch (e) { return text({ error: e.message }); }
  }
);

server.tool('support_test_history',
  'See every time price visited a key level — did it bounce, break, or consolidate? Know how strong a support/resistance is before betting on it.',
  {
    symbol:       z.string().describe('NSE symbol'),
    level:        z.number().describe('The price level to analyse e.g. 2800 for RELIANCE at ₹2800'),
    exchange:     z.enum(['NSE', 'BSE']).default('NSE'),
    days:         z.number().int().min(90).max(730).default(365),
    tolerancePct: z.number().min(0.5).max(3).default(1.5).describe('How close counts as "visiting" the level (%)'),
  },
  async ({ symbol, level, exchange, days, tolerancePct }) => {
    try {
      const hist    = await client.getHistoricalDataYahoo(symbol, exchange, days, '1d');
      const candles = hist.candles;
      if (!candles?.length) return text({ error: 'No historical data' });

      const live  = await client.getLivePriceNSE(symbol).catch(() => null);
      const price = live?.priceInfo?.lastPrice || live?.lastPrice || parseFloat(candles[candles.length-1]?.close);

      const result = supportTestHistory(candles, level, tolerancePct);

      return text({
        symbol:       symbol.toUpperCase(),
        currentPrice: price,
        distFromLevel: `${(Math.abs(price - level) / level * 100).toFixed(1)}% away`,
        ...result,
        tradeImplication: result.bounceRate
          ? parseFloat(result.bounceRate) >= 70
            ? `HIGH CONVICTION: ${result.bounceRate} bounce rate. BUY near ₹${level} with tight SL. This is a proven level.`
            : parseFloat(result.bounceRate) >= 50
            ? `MODERATE: ${result.bounceRate} bounce rate. Enter only with additional confirmation (volume, candle pattern).`
            : `WEAK: Level broke through more than it bounced. Don't rely on it as support.`
          : null,
      });
    } catch (e) { return text({ error: e.message }); }
  }
);

server.tool('price_zones',
  'Map all significant price zones on a stock — levels that have been tested 3+ times are the most important. Shows nearest support and resistance.',
  {
    symbol:   z.string().describe('NSE symbol'),
    exchange: z.enum(['NSE', 'BSE']).default('NSE'),
    days:     z.number().int().min(60).max(365).default(120).describe('Lookback for zone detection'),
  },
  async ({ symbol, exchange, days }) => {
    try {
      const hist    = await client.getHistoricalDataYahoo(symbol, exchange, days, '1d');
      const candles = hist.candles;
      if (!candles?.length) return text({ error: 'No historical data' });

      const live  = await client.getLivePriceNSE(symbol).catch(() => null);
      const price = live?.priceInfo?.lastPrice || live?.lastPrice || parseFloat(candles[candles.length-1]?.close);

      const zones   = priceZoneMap(candles, Math.min(candles.length, days));
      const atrVal  = atr(candles, 14);

      // For top 3 zones, run full support test history
      const topZones = zones.significantLevels?.slice(0, 3) || [];
      const enriched = await Promise.all(topZones.map(async z => {
        const history = supportTestHistory(candles, z.level, 1.5);
        return { ...z, bounceRate: history.bounceRate, strength: history.levelStrength, totalTests: history.totalVisits };
      }));

      return text({
        symbol: symbol.toUpperCase(),
        currentPrice: price,
        atr: atrVal?.toFixed(2),
        ...zones,
        significantLevels: enriched.length > 0 ? enriched : zones.significantLevels,
        tradePlan: zones.nearestSupport && zones.nearestResistance ? {
          longSetup:  `Buy near ₹${zones.nearestSupport.level} support. Target ₹${zones.nearestResistance.level}. Reward: ${(((zones.nearestResistance.level - zones.nearestSupport.level) / zones.nearestSupport.level) * 100).toFixed(1)}%`,
          shortSetup: `Sell near ₹${zones.nearestResistance.level} resistance. Target ₹${zones.nearestSupport.level}.`,
        } : null,
        tip: 'The more times a level has been tested and held, the stronger it is. Institutions place orders at these zones.',
      });
    } catch (e) { return text({ error: e.message }); }
  }
);

// ─── Start server ──────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
