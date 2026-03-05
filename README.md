# AI Trader — Autonomous NSE/BSE Trading System

> **AI-powered trading toolkit for Indian stock markets.** Autonomous scanner, paper trading engine, options Greeks, candlestick patterns, historical similarity matching, Telegram alerts, and an interactive terminal you can talk to. Works with Groww, AngelOne, Zerodha, or Upstox.

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![Brokers](https://img.shields.io/badge/Brokers-Groww%20%7C%20AngelOne%20%7C%20Zerodha%20%7C%20Upstox-orange)](#supported-brokers)
[![Market](https://img.shields.io/badge/Market-NSE%20%7C%20BSE-red)](https://www.nseindia.com)
[![Claude](https://img.shields.io/badge/AI-Claude%20Code-purple)](https://claude.ai/claude-code)

---

> **DISCLAIMER — READ BEFORE USE**
>
> This software is provided for **educational and research purposes only**. It is not financial advice, investment advice, or a recommendation to buy or sell any security.
>
> - Trading in equities, derivatives (F&O), and other financial instruments involves **substantial risk of loss**. You can lose more than your invested capital.
> - Past performance of any strategy or backtest result shown by this tool does **not guarantee future results**.
> - The authors and contributors of this project **accept no liability** for any financial losses incurred from use of this software.
> - Paper trading results are simulated and **do not reflect real market execution**, slippage, or brokerage costs accurately.
> - Always consult a **SEBI-registered investment advisor** before making real trading decisions.
> - Use of broker APIs is subject to each broker's terms of service. Ensure you have the right permissions before placing automated orders.
> - **Live trading mode** (`--mode live`) places real orders with real money. Use it only if you fully understand the risks.

---

## What This Does

```
You run one command → Bot scans every 5 min → Scores stocks 0-10 → Alerts you → Paper trades automatically
                                                                  ↓
                                                     Telegram alert on your phone
```

| Feature | Description |
|---------|-------------|
| **Autonomous Bot** | Runs 24/7, activates during market hours (9:15–3:30 IST), scans your watchlist on a timer |
| **Confluence Scoring** | Scores each stock 0–10 across RSI, MACD, VWAP, SuperTrend, Stochastic, BB, Support, Patterns |
| **Paper Trading** | Auto-executes virtual trades with ATR-based position sizing on score ≥ 7 |
| **Interactive CLI** | Terminal REPL — scan, analyze, buy, sell, portfolio, history in one place |
| **Claude Code AI** | Open `claude` in the project folder — it knows all tools, indicators, and your style |
| **Telegram Control** | Alerts on phone, `/analyze`, `/scan`, `/buy`, `/pause`, `/resume` from Telegram |
| **Historical Matching** | Finds past moments with same RSI/BB/SMA setup and shows 5d/10d/20d forward returns |
| **Options Greeks** | Black-Scholes Delta, Gamma, Theta, Vega, Rho + Implied Volatility + Max Pain |
| **Trade Journal** | Log trades, track win rate, profit factor, expectancy, max drawdown |
| **Multi-broker** | One config line switches between Groww, AngelOne, Zerodha, Upstox |

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/Manjussha/AI-trader.git
cd AI-trader

# 2. Install dependencies
npm install

# 3. Configure
cp .env.example .env
# Edit .env — set BROKER= and fill in your broker's API credentials

# 4. Run
npm run bot            # autonomous scanner + dashboard
npm run bot:paper      # scanner + auto paper trade on strong signals
npm run cli            # interactive terminal REPL
```

No API key needed for market data — NSE India public API is used for all price/index data.

---

## Live Terminal Dashboard

```
════════════════════════════════════════════════════════════════════════
  AUTONOMOUS TRADING BOT   mode: PAPER | interval: 5m | 10:32:44 IST
════════════════════════════════════════════════════════════════════════
  NIFTY  24,715  +0.96%   H:24,780 L:24,610     BANKNIFTY  52,140  +0.62%
  Market:  MARKET OPEN    scan #7 | alerts: 2
────────────────────────────────────────────────────────────────────────

  WATCHLIST SCAN  (sorted by confluence score)
────────────────────────────────────────────────────────────────────────
  HDFCBANK       ₹  1,712   RSI: 31.4   STRONG_BUY   [██████████]  8/10  ▲VWAP ST↑  Hammer
    SL:₹1,689 | T1:₹1,740 | T2:₹1,779 | ATR:11.8 | Sup:₹1,695 | Res:₹1,745
  RELIANCE       ₹  2,891   RSI: 44.2   BUY          [███████░░░]  6/10  ▲VWAP ST↑
  TCS            ₹  3,540   RSI: 58.1   NEUTRAL      [████░░░░░░]  4/10  ▼VWAP ST↑
  INFY           ₹  1,480   RSI: 71.3   SELL         [██░░░░░░░░]  2/10  ▼VWAP ST↓

  ALERTS (score >= 6)
────────────────────────────────────────────────────────────────────────
  ★ HDFCBANK  Score:8/10  ₹1,712  RSI:31.4  Hammer
    Entry:₹1,712 | SL:₹1,689 | T1:₹1,740 | T2:₹1,779

  PAPER PORTFOLIO  Cash:₹94,288  Value:₹1,01,420  P&L:+₹1,420  WinRate:66%  Trades:9
    HDFCBANK     qty:4   avg:₹1,712  ltp:₹1,718   P&L:+₹24  (+0.35%)
```

---

## Interactive Terminal (CLI)

```bash
npm run cli
```

```
  ╔══════════════════════════════════════════════════════╗
  ║        AI TRADER — Interactive Terminal               ║
  ╚══════════════════════════════════════════════════════╝

trader> status                    # NIFTY + BANKNIFTY live
trader> scan                      # scan default watchlist
trader> scan RELIANCE,HDFCBANK,TCS
trader> analyze RELIANCE          # full technical analysis
trader> history HDFCBANK          # find similar past setups
trader> gainers                   # top gainers today
trader> losers                    # top losers today
trader> buy HDFCBANK 5            # paper buy 5 shares
trader> sell HDFCBANK 5           # paper sell
trader> portfolio                 # paper P&L
trader> stats                     # win rate, drawdown, expectancy
trader> reset 50000               # reset paper portfolio to ₹50,000
trader> quit
```

**One-shot mode** — run a single command and exit:
```bash
node cli.mjs scan
node cli.mjs analyze RELIANCE
node cli.mjs gainers
```

---

## AI via Claude Code

Open Claude Code in the project folder and ask anything directly:

```bash
cd AI-trader
claude
```

Claude automatically reads `CLAUDE.md` and knows:
- All market data APIs (NSE India, Yahoo Finance)
- Every indicator: RSI, MACD, BB, ATR, VWAP, SuperTrend, Stochastic
- All 22 candlestick patterns
- Options Greeks (Black-Scholes)
- Paper trading functions
- Historical similarity engine
- Your trading profile (style, risk, goals)

**Example conversations:**
```
> analyze RELIANCE and give me entry, SL, and two targets
> scan NIFTY 50 for RSI oversold stocks with bullish patterns
> what is the max pain for NIFTY this week?
> calculate position size — ₹50,000 capital, 1% risk, entry ₹1800, SL ₹1750
> find past setups similar to HDFCBANK today and show forward returns
> explain morning star pattern and when to trade it
> what F&O strategy suits a mildly bullish view on BANKNIFTY?
```

---

## Telegram Alerts + Control

Set up once, get alerts on your phone and control the bot remotely.

**Setup:**
1. Message `@BotFather` on Telegram → `/newbot` → copy token
2. Add to `.env`:
   ```
   TELEGRAM_BOT_TOKEN=your_token_here
   TELEGRAM_CHAT_ID=your_chat_id_here
   ```
3. Run `npm run bot` — you'll get a startup notification

**Commands from Telegram:**

| Command | What it does |
|---------|-------------|
| `/status` | Market open/closed, scan count, NIFTY level |
| `/scan` | Scan watchlist right now |
| `/scan RELIANCE,TCS` | Scan specific symbols |
| `/analyze SYMBOL` | Full analysis with entry/SL/targets |
| `/portfolio` | Paper portfolio P&L |
| `/buy SYMBOL QTY` | Paper buy from phone |
| `/gainers` | Top 5 gainers (NIFTY 50) |
| `/losers` | Top 5 losers (NIFTY 50) |
| `/market` | NIFTY + BANKNIFTY snapshot |
| `/pause` | Pause scanning |
| `/resume` | Resume scanning |
| `/help` | All commands |

Every alert with score ≥ minScore is automatically sent to your Telegram with entry, SL, and targets.

---

## Bot Options

```bash
node trading-bot.mjs [options]

  --mode        watch | paper | live    Default: watch
  --watchlist   RELIANCE,TCS,INFY       Comma-separated NSE symbols
  --interval    5                       Minutes between scans
  --capital     100000                  Paper trading capital (INR)
  --risk        1                       % of capital to risk per trade
  --min-score   6                       Alert threshold (0–10)
  --index       "NIFTY 50"             Index to screen
```

**Examples:**
```bash
# Banking stocks every 3 min
node trading-bot.mjs --watchlist HDFCBANK,ICICIBANK,SBIN,AXISBANK --interval 3

# Paper trade with ₹50,000, 1.5% risk, alert on score ≥ 7
node trading-bot.mjs --mode paper --capital 50000 --risk 1.5 --min-score 7

# Full NIFTY BANK watchlist
node trading-bot.mjs --index "NIFTY BANK" --interval 5
```

---

## How Signals Work

### Confluence Scoring (0–10)

Every stock gets scored across 10 independent factors. Higher score = more conditions aligned.

| Factor | Points | What it means |
|--------|--------|---------------|
| Daily BUY signal (RSI + MACD + SMA) | +2 | Multiple indicators all agree |
| RSI < 35 | +2 | Strongly oversold — mean reversion likely |
| RSI 35–45 | +1 | Mildly oversold |
| Stochastic oversold | +1 | Momentum hitting bottom |
| SuperTrend BULLISH | +1 | Trend direction is up |
| Price above VWAP | +1 | Institutions net buyers today |
| Price at/below Bollinger lower band | +1 | Statistical price extreme |
| Price within 1.5% of support | +1 | Key level holding |
| Strong bullish candlestick pattern | +1 | Hammer, Engulfing, Morning Star, etc. |

- **Score ≥ 6** → Alert fired (terminal + Telegram)
- **Score ≥ 7** → Auto paper trade (in `--mode paper`)

### Trade Plan (ATR-based)

```
Entry:  current price
SL:     price − 2 × ATR(14)        ← 2 ATR below entry
T1:     price + 1.5 × ATR          ← 1:1.5 risk/reward
T2:     price + 3 × ATR            ← 1:3 risk/reward
Qty:    (capital × riskPct) ÷ (entry − SL)
```

---

## Technical Indicators

| Category | Indicators |
|----------|-----------|
| Momentum | RSI(14), Stochastic %K/%D, Williams %R |
| Trend | SMA 20/50, EMA 9, MACD(12,26,9), SuperTrend, Chandelier Exit |
| Volatility | Bollinger Bands(20,2), ATR(14), Annual Volatility |
| Volume | VWAP (20-day rolling) |
| Levels | Support & Resistance (swing high/low detection) |

---

## Candlestick Patterns (22)

**Single candle:** Doji, Hammer, Inverted Hammer, Shooting Star, Hanging Man, Bullish/Bearish Marubozu, Spinning Top

**Two candle:** Bullish Engulfing, Bearish Engulfing, Bullish Harami, Bearish Harami, Piercing Line, Dark Cloud Cover, Tweezer Top, Tweezer Bottom

**Three candle:** Morning Star, Evening Star, Morning Doji Star, Evening Doji Star, Three White Soldiers, Three Black Crows

Each pattern returns: name, sentiment (BULLISH/BEARISH/NEUTRAL), strength (STRONG/MODERATE), and how many bars ago.

---

## Historical Similarity

Finds the top-N past moments where RSI, Bollinger position, and SMA relationship matched today's setup — then shows forward returns.

```
Today's Setup: Price ₹1,405  RSI: 38.3  BB: near lower band

5 Most Similar Past Moments:
  2024-06-12  ₹1,340  RSI:37.1  Similarity:0.94
    5d: +2.1%  10d: +4.8%  20d: +6.2%  → BULLISH

  2024-03-28  ₹1,290  RSI:39.4  Similarity:0.91
    5d: -1.2%  10d: +3.1%  20d: +5.8%  → BULLISH

Historical Edge: Win Rate 80%  |  Avg 10d Return: +3.9%
```

---

## Options Greeks

Black-Scholes engine with:
- **Delta** — price sensitivity to underlying move
- **Gamma** — rate of delta change
- **Theta** — daily time decay (in ₹)
- **Vega** — sensitivity to IV change
- **Rho** — sensitivity to interest rate
- **Implied Volatility** — back-calculated from market premium
- **Max Pain** — strike where option sellers lose least (OI-weighted)

---

## Supported Brokers

Change one line in `.env` to switch:

```env
BROKER=groww        # or angelone | zerodha | upstox
```

| Broker | API Cost | Auth Type | Docs |
|--------|----------|-----------|------|
| **Groww** | Free | JWT + TOTP | [developer.groww.in](https://developer.groww.in) |
| **AngelOne** | Free | TOTP | [smartapi.angelbroking.com](https://smartapi.angelbroking.com) |
| **Zerodha Kite** | ₹2,000/month | OAuth | [kite.trade/docs](https://kite.trade/docs/connect/v3) |
| **Upstox** | Free | OAuth2 | [developer.upstox.com](https://developer.upstox.com) |

> **Note:** Market data (prices, indices, historical OHLCV) uses the free NSE India public API and Yahoo Finance. Broker credentials are only needed for placing real orders, fetching holdings, and account funds.

<details>
<summary><b>Groww credentials</b></summary>

```env
BROKER=groww
GROWW_API_KEY=       # JWT token from Groww developer portal
GROWW_API_SECRET=
TOTP_SECRET=         # base32 TOTP secret
```
</details>

<details>
<summary><b>AngelOne credentials</b></summary>

```env
BROKER=angelone
ANGELONE_API_KEY=        # from smartapi.angelbroking.com
ANGELONE_CLIENT_ID=      # your login ID
ANGELONE_PASSWORD=       # trading password
ANGELONE_TOTP_SECRET=    # TOTP secret
```
</details>

<details>
<summary><b>Zerodha credentials</b></summary>

```env
BROKER=zerodha
ZERODHA_API_KEY=
ZERODHA_API_SECRET=
ZERODHA_REQUEST_TOKEN=   # from OAuth flow — refresh daily
```

Auth flow: Open `https://kite.trade/connect/login?api_key=YOUR_KEY&v=3` → login → copy `request_token` from redirect URL.
</details>

<details>
<summary><b>Upstox credentials</b></summary>

```env
BROKER=upstox
UPSTOX_API_KEY=
UPSTOX_API_SECRET=
UPSTOX_CODE=             # from OAuth flow — one-time use
UPSTOX_REDIRECT_URI=http://localhost:3000/callback
```

Auth flow: Open the authorization dialog → login → copy `code` from redirect URL.
</details>

---

## Add Your Own Broker

Extend `BaseBroker` in `src/brokers/base.js` — implement 8 methods:

```js
// src/brokers/my-broker.js
import { BaseBroker } from './base.js';

export class MyBroker extends BaseBroker {
  constructor(config) { super(config); this.name = 'MyBroker'; }

  async authenticate()         { /* return access token */ }
  async placeOrder(params)     { /* return { orderId, status } */ }
  async cancelOrder(id)        { /* return result */ }
  async getHoldings()          { /* return [{ symbol, qty, avgPrice, ltp }] */ }
  async getPositions()         { /* return positions array */ }
  async getFunds()             { /* return { available, used, total } */ }
  async getOrderList()         { /* return orders array */ }
  async getOrderDetail(id)     { /* return single order */ }
}
```

Register in `src/brokers/index.js` and set `BROKER=my-broker` in `.env`.

---

## MCP Server (Claude Desktop)

Use all tools with natural language inside Claude Desktop:

```json
{
  "mcpServers": {
    "ai-trader": {
      "command": "node",
      "args": ["C:/path/to/AI-trader/src/server.js"],
      "env": {
        "BROKER": "groww",
        "GROWW_API_KEY": "...",
        "TOTP_SECRET": "..."
      }
    }
  }
}
```

**Example prompts in Claude Desktop:**
> *"Scan NIFTY 50 for RSI oversold stocks"*
> *"Full analysis on RELIANCE with ATR stops and VWAP"*
> *"Options Greeks for NIFTY 24500 CE expiring Thursday"*
> *"Calculate position size — ₹50,000 capital, 1% risk, entry ₹1,800, SL ₹1,745"*

---

## Project Structure

```
AI-trader/
├── CLAUDE.md               ← Claude Code context (open 'claude' here for AI)
├── trading-bot.mjs         ← Autonomous bot with live dashboard
├── cli.mjs                 ← Interactive terminal REPL
├── advisor-run.mjs         ← Standalone AI advisor
├── .env.example            ← Config template (all 4 brokers)
├── src/
│   ├── server.js           ← MCP server (30+ tools)
│   ├── groww-client.js     ← NSE India + Yahoo Finance + Groww API
│   ├── analytics.js        ← RSI, MACD, BB, ATR, VWAP, SuperTrend, Stochastic...
│   ├── patterns.js         ← 22 candlestick pattern recognition
│   ├── greeks.js           ← Black-Scholes options calculator
│   ├── paper-trade.js      ← Virtual trading engine
│   ├── trade-journal.js    ← Performance tracker
│   ├── history-analyzer.js ← Historical similarity matching
│   ├── telegram.js         ← Telegram bot (alerts + two-way control)
│   └── brokers/
│       ├── base.js         ← Abstract broker interface
│       ├── groww.js        ← Groww
│       ├── angelone.js     ← AngelOne Smart API
│       ├── zerodha.js      ← Zerodha Kite Connect
│       ├── upstox.js       ← Upstox v2
│       └── index.js        ← Broker factory (reads BROKER= from .env)
```

---

## Security

- `.env` is in `.gitignore` — **API keys are never committed to git**
- All credentials stay local on your machine
- Paper trading is fully isolated — zero real money involved
- Live mode has a 5-second abort window on startup

---

## Requirements

- **Node.js 22+**
- A broker account (with API access enabled in broker settings)
- Internet connection
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`) — for AI features

---

## License

MIT — free to use, modify, and share. See [LICENSE](LICENSE).

---

## Disclaimer (Full)

This project is an **open-source educational tool**. By using this software, you agree to the following:

1. **Not financial advice.** Nothing in this codebase, its output, or its documentation constitutes financial, investment, or trading advice. All signals, scores, and trade plans are generated by algorithms and are for informational/educational purposes only.

2. **Risk of loss.** Trading equities, futures, and options (F&O) in Indian markets (NSE/BSE) carries substantial risk. You may lose your entire invested capital. F&O trading can result in losses exceeding your initial investment.

3. **No liability.** The authors, contributors, and maintainers of this project shall not be held liable for any direct, indirect, incidental, or consequential financial losses arising from use of this software, whether in paper trading or live trading mode.

4. **Backtests are not predictions.** Historical similarity results and backtests are based on past market data. Past performance does not predict future results. Markets can and do behave differently from historical patterns.

5. **Regulatory compliance.** Use of automated trading bots may be subject to regulations by SEBI (Securities and Exchange Board of India) and your broker's terms of service. It is your responsibility to ensure compliance.

6. **Live trading.** The `--mode live` flag places real orders with real money through your broker's API. Use this only if you fully understand the risks and have tested thoroughly in paper mode first.

7. **Data accuracy.** Market data is sourced from NSE India public API and Yahoo Finance. The authors make no guarantees about the accuracy, completeness, or timeliness of this data.

**Always consult a SEBI-registered investment advisor before making real trading decisions.**

---

*Built for Indian retail traders who want institutional-grade tools without institutional-grade cost.*
