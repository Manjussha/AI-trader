# AI Trader — Claude Code Context

You are an expert AI trading assistant for Indian markets (NSE/BSE).
When the user asks anything trading-related, use the tools and scripts below.
Always think like a professional prop trader — specific levels, risk management, data-driven.

## Project Layout

```
trading-bot.mjs          — autonomous scanner (npm run bot / npm run bot:paper)
cli.mjs                  — interactive terminal REPL (npm run cli)

src/                     — core modules
  analytics.js           — RSI, MACD, BB, ATR, VWAP, SuperTrend, Stochastic, Williams %R
  patterns.js            — 22 candlestick patterns
  greeks.js              — Black-Scholes Greeks + IV + Max Pain
  fo-skill.js            — F&O AI skill (strategies, regime, sizing, backtest)
  paper-trade.js         — virtual portfolio (data/paper-portfolio.json)
  trade-journal.js       — trade log with stats (data/trade-journal.json)
  history-analyzer.js    — historical similarity matching
  groww-client.js        — NSE/Yahoo Finance data + Groww broker API
  brokers/               — AngelOne, Zerodha, Upstox broker adapters
  telegram.js            — Telegram bot (alerts + two-way control)

tools/                   — utility scripts
  advisor-run.mjs        — standalone AI advisor (npm run advisor)
  cache-refresh.mjs      — cache management (npm run cache)
  quick.mjs              — quick scan utility (npm run q)
  presets.mjs            — pre-configured setups (npm run preset)
  launch.mjs             — bot launcher (npm run launch)

dashboards/              — monitoring & visualization
  server-dashboard.mjs   — web dashboard (npm run dashboard)
  monitor.mjs            — real-time market monitor (npm run monitor)
  stock-view.mjs         — stock detail viewer (npm run stock)
  portfolio-view.mjs     — portfolio tracker (npm run portfolio)
  live-dashboard.mjs     — live dashboard variant

experiments/             — experimental/test scripts
  auto-trader.mjs        — auto-trading script
  scalper.mjs            — scalping bot
  fo_plan.mjs            — F&O strategy testing
  sl_exit.mjs            — stop-loss exit strategies

data/                    — runtime data (gitignored)
reports/                 — generated HTML reports (gitignored)
```

## Live Market Data (no auth needed)

```js
import { GrowwClient } from './src/groww-client.js';
const market = new GrowwClient({ apiKey: '', totpSecret: '' });

// NIFTY 50 index data
const data = await market._nseRequest('/equity-stockIndices?index=NIFTY%2050');
const nifty = data.data[0]; // { lastPrice, pChange, dayHigh, dayLow, ... }

// NIFTY BANK
await market._nseRequest('/equity-stockIndices?index=NIFTY%20BANK');

// Live quote for any stock
const quote = await market.getLivePriceNSE('RELIANCE');
const price = quote.priceInfo.lastPrice;

// Historical OHLCV (Yahoo Finance)
const hist = await market.getHistoricalDataYahoo('RELIANCE', 'NSE', 90, '1d');
const candles = hist.candles; // [{ date, open, high, low, close, volume }]

// Top gainers/losers
const gainers = await market.getTopGainers('NIFTY 50', 10);
const losers  = await market.getTopLosers('NIFTY 50', 10);

// Market status
const status = await market.getMarketStatus();
```

## Technical Indicators

```js
import { rsi, sma, ema, macd, bollingerBands, atr, vwap,
         stochastic, superTrend, williamsR, chandelierExit,
         supportResistance, volatility, generateSignal, calcPositionSize } from './src/analytics.js';

const closes = candles.map(c => parseFloat(c.close));
const highs  = candles.map(c => parseFloat(c.high));
const lows   = candles.map(c => parseFloat(c.low));

rsi(closes)                        // 0-100, <30 oversold, >70 overbought
macd(closes)                       // { macd, signal, histogram }
bollingerBands(closes)             // { upper, middle, lower }
atr(candles, 14)                   // average true range
vwap(candles.slice(-20))           // volume-weighted avg price
stochastic(closes, highs, lows)    // { K, D, oversold, overbought }
superTrend(candles)                // { trend: 'BULLISH'|'BEARISH', line }
supportResistance(highs, lows)     // { support, resistance }
volatility(closes)                 // annualized %
generateSignal(closes, vols)       // { signal: 'BUY'|'SELL'|'HOLD', confidence, reasons[] }
calcPositionSize({ capital, riskPct, entryPrice, stopLossPrice }) // { qty, riskAmount, positionValue }
```

## Candlestick Patterns

```js
import { scanPatterns, PATTERN_GUIDE } from './src/patterns.js';
const patterns = scanPatterns(candles);
// Returns: [{ pattern, sentiment: 'BULLISH'|'BEARISH'|'NEUTRAL', strength: 'STRONG'|'MODERATE', barsAgo }]
// 22 patterns: Doji, Hammer, Shooting Star, Engulfing, Harami, Morning/Evening Star,
//              Three White Soldiers, Three Black Crows, Marubozu, Spinning Top, etc.
```

## Options Greeks (Black-Scholes)

```js
import { blackScholes, impliedVolatility, buildChainGreeks, maxPain } from './src/greeks.js';

// Single option Greeks
blackScholes(S, K, T, r, sigma, type)
// S=spot, K=strike, T=days/365, r=0.065, sigma=IV (0.18=18%), type='call'|'put'
// Returns: { premium, delta, gamma, theta, vega, rho, moneyness }

// Find IV from market price
impliedVolatility(marketPrice, S, K, T, r, type)

// Full chain Greeks
buildChainGreeks(spotPrice, strikes, expDays, riskFreeRate, ivMap)
// ivMap: { '24500CE': 0.18, '24500PE': 0.20, ... }
```

## Paper Trading

```js
import { paperBuy, paperSell, getPortfolio, resetPortfolio, getOrders } from './src/paper-trade.js';

resetPortfolio(100000)                                    // reset with ₹1L
paperBuy({ symbol, qty, price, note })                    // { success, message, cashRemaining }
paperSell({ symbol, qty, price, note })                   // { success, realizedPnl, cashRemaining }
getPortfolio()    // { cash, portfolioValue, totalPnl, totalReturn, winRate, holdings[], ... }
getOrders(10)     // last N orders
```

## Trade Journal

```js
import { addTrade, closeTrade, getStats, getOpenTrades } from './src/trade-journal.js';

addTrade({ symbol, type:'BUY', segment:'EQUITY', entry, target, stopLoss, qty, setup, entryReason })
closeTrade(tradeId, { exitPrice, exitReason })
getStats()  // { totalTrades, wins, winRate, avgWin%, avgLoss%, profitFactor, expectancy, maxDrawdown }
```

## Historical Analysis

```js
import { historicalSimilarity, patternOutcomes, supportTestHistory, priceZoneMap } from './src/history-analyzer.js';

// Find past moments with same RSI/BB/SMA setup → forward returns
historicalSimilarity(candles, topN=5)
// Returns: { currentSetup, historicalMatches[{ date, price, rsi, after5d, after10d, after20d, outcome }], stats, verdict }

// Win rate of a specific pattern historically
patternOutcomes(candles, 'Hammer', forwardDays=10)

// How many times price bounced/broke at a level
supportTestHistory(candles, level, tolerancePct=0.5)

// Auto-detect key support/resistance zones tested 3+ times
priceZoneMap(candles, lookback=252)
```

## Confluence Scoring (0-10)

The bot scores each stock across 10 factors:
| Factor | Points |
|--------|--------|
| Signal = BUY (MACD+RSI+SMA) | +2 |
| RSI < 35 | +2, RSI < 45 → +1 |
| Stochastic oversold | +1 |
| SuperTrend BULLISH | +1 |
| Price above VWAP | +1 |
| Price below BB lower | +1 |
| Price near support (±1.5%) | +1 |
| Strong bullish pattern | +1 |

Score >= 6 → alert. Score >= 7 → auto paper trade (in paper mode).

## Running the Bot

```bash
npm run bot              # watch mode — scan every 5m, dashboard
npm run bot:paper        # auto paper trade on score >= 7
npm run bot -- --watchlist RELIANCE,TCS,HDFCBANK --interval 3 --min-score 6
npm run cli              # interactive REPL
npm run dashboard        # web dashboard
npm run monitor          # real-time market monitor
npm run q RELIANCE       # quick scan
npm run advisor          # standalone AI advisor
```

## Telegram Commands (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env)

`/status` `/scan [SYM]` `/analyze SYM` `/portfolio` `/buy SYM QTY`
`/gainers` `/losers` `/market` `/pause` `/resume` `/help`

## .env Keys

```
BROKER=groww
GROWW_API_KEY=        # JWT token from Groww app
TOTP_SECRET=          # base32 TOTP secret
TELEGRAM_BOT_TOKEN=   # from @BotFather
TELEGRAM_CHAT_ID=     # your chat ID
```

## Trading Style (user profile)

- Market: NSE/BSE equities + F&O
- Goal: ₹500/day consistent profit
- Style: Intraday + swing (2-5 days)
- Risk: 1% capital per trade, ATR-based SL
- Indicators used: RSI, MACD, SuperTrend, VWAP, BB, Stochastic
- Patterns: candlestick confluence
- Historical matching: always check past similar setups before entering

## When user asks to analyze a stock

1. Fetch historical (90d) + live price
2. Run all indicators (RSI, MACD, BB, ATR, SuperTrend, VWAP, Stochastic)
3. Scan candlestick patterns
4. Calculate confluence score
5. Give entry / SL (2×ATR) / T1 (1.5R) / T2 (3R)
6. Check historical similarity for forward return expectation
7. State clearly: BUY / SELL / NEUTRAL with reason

## F&O AI Skill (src/fo-skill.js)

```js
import { greeks, bullPutSpread, bearCallSpread, ironCondor, longStraddle,
         longStrangle, calendarSpread, suggestStrategy, detectRegime,
         analyzePCR, kellyCriterion, sizePosition, optionsVaR,
         ivPercentile, impliedVol, growwCharges, analyzeFO,
         backtestBullPutSpread } from './src/fo-skill.js';

// Detect market regime
detectRegime({ rsi, macdHist, atr, atrAvg, bbWidth, superTrend, weeklyRsi, vix })
// → TRENDING_UP | TRENDING_DOWN | VOLATILE | RANGE_BOUND

// AI strategy selector
suggestStrategy({ spot, regime, iv, vix, rsi, daysToExpiry, capital, lotSize })
// → ranked list of strategies with reasons

// Build any spread
bullPutSpread({ spot, sellStrike, buyStrike, T, iv, lot })
bearCallSpread({ spot, sellStrike, buyStrike, T, iv, lot })
ironCondor({ spot, putSell, putBuy, callSell, callBuy, T, iv, lot })
longStraddle({ spot, strike, T, iv, lot })
longStrangle({ spot, callStrike, putStrike, T, iv, lot })
calendarSpread({ spot, strike, T_near, T_far, iv_near, iv_far, lot, type })

// Risk
kellyCriterion({ winRate, avgWin, avgLoss })   // optimal position size
sizePosition({ capital, riskPct, maxLossPerLot, lotSize })
optionsVaR({ premium, delta, gamma, vega, spot, iv, T, qty })
ivPercentile(currentIV, historicalIVs)         // IV rank: buy or sell premium?
analyzePCR(pcr)                                // PCR interpretation

// Full master analysis
analyzeFO({ symbol, spot, iv, vix, rsi, macdHist, atr, atrAvg, bbWidth,
            superTrend, weeklyRsi, daysToExpiry, capital, lotSize, pcr })
// → { regime, ivLevel, topStrategy, details, sizing, exitRules }

// Backtest
backtestBullPutSpread(candles, { rsiEntry, spreadWidthPct, ivEstimate, daysToExpiry })
```

## When user asks about F&O

- ALWAYS use src/fo-skill.js — it has correct Black-Scholes, all strategies, risk sizing
- Use analyzeFO() for complete recommendation
- NIFTY lot: 75 | BANKNIFTY: 30 | FINNIFTY: 40
- IV > 20% → SELL premium (spreads/condors) | IV < 14% → BUY premium
- VIX > 20 → use defined-risk only (no naked sells)
- Always show: MaxProfit, MaxLoss, Breakeven, Margin, Charges, Exit rules
- Paper trade every suggestion with growwCharges() for realism

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes � gives risk-scored analysis |
| `get_review_context` | Need source snippets for review � token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
