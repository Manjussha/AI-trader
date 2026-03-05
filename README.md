# AI Trader — Autonomous NSE/BSE Trading Bot

> **AI-powered trading bot for Indian stock markets.** Connects to Groww, AngelOne, Zerodha, or Upstox. Runs autonomously in the terminal — scans NIFTY stocks, detects setups, paper trades, and alerts you on high-confidence signals. No human needed.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![Broker](https://img.shields.io/badge/Brokers-Groww%20%7C%20AngelOne%20%7C%20Zerodha%20%7C%20Upstox-orange)](#supported-brokers)
[![Market](https://img.shields.io/badge/Market-NSE%20%7C%20BSE-red)](https://www.nseindia.com)

---

## What This Does

```
You run one command → Bot scans market every 5 min → Finds setups → Alerts you → Paper trades automatically
```

- Monitors your watchlist 24/7, activates during market hours (9:15 AM – 3:30 PM IST)
- Scores every stock 0–10 using 10 confluence factors (RSI + patterns + VWAP + SuperTrend + more)
- Fires alerts when score ≥ 6 with exact Entry, Stop Loss, Target 1, Target 2
- In paper mode: auto-executes virtual trades with ATR-based position sizing
- Works with **any Indian broker** — swap in 1 line of config

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/Manjussha/AI-trader.git
cd AI-trader

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# → Edit .env: set BROKER= and fill in your API credentials

# 4. Run
npm run bot            # watch mode — alerts only
npm run bot:paper      # paper trading — auto executes trades
npm run advisor        # one-time AI market analysis (needs ANTHROPIC_API_KEY)
```

---

## Terminal Dashboard

```
════════════════════════════════════════════════════════════════════════
  AUTONOMOUS TRADING BOT   mode: PAPER | interval: 5m | 10:32:44 IST
════════════════════════════════════════════════════════════════════════
  NIFTY  24,312  +0.42%   H:24,380 L:24,190     BANKNIFTY  51,820  +0.18%
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

  PAPER PORTFOLIO  Cash:₹94,288  Value:₹1,01,420  P&L:+₹1,420  WinRate:66%
    HDFCBANK     qty:4   avg:₹1,712  ltp:₹1,718  P&L:+₹24 (+0.35%)
```

---

## CLI Options

```bash
node trading-bot.mjs [options]

  --mode       watch | paper | live    Default: watch
  --watchlist  RELIANCE,TCS,INFY       Comma-separated NSE symbols
  --interval   5                       Minutes between scans
  --capital    100000                  Paper trading capital (INR)
  --risk       1                       % of capital to risk per trade
  --min-score  6                       Alert threshold (0–10)
  --index      "NIFTY 50"              Index to screen
```

**Examples:**
```bash
# Monitor banking stocks every 3 minutes
node trading-bot.mjs --watchlist HDFCBANK,ICICIBANK,SBIN,AXISBANK --interval 3

# Paper trade with ₹50,000 capital, 1.5% risk per trade, alert on score ≥ 7
node trading-bot.mjs --mode paper --capital 50000 --risk 1.5 --min-score 7

# Screen entire NIFTY BANK index
node trading-bot.mjs --index "NIFTY BANK" --interval 5
```

---

## Supported Brokers

Switch brokers by changing one line in `.env`:

```env
BROKER=groww        # or angelone, zerodha, upstox
```

| Broker | API Cost | Docs |
|--------|----------|------|
| **Groww** | Free | [developer.groww.in](https://developer.groww.in) |
| **AngelOne** | Free | [smartapi.angelbroking.com](https://smartapi.angelbroking.com) |
| **Zerodha Kite** | ₹2,000/month | [kite.trade/docs](https://kite.trade/docs/connect/v3) |
| **Upstox** | Free | [developer.upstox.com](https://developer.upstox.com) |

### Credentials per broker

<details>
<summary><b>Groww</b></summary>

```env
BROKER=groww
GROWW_API_KEY=      # JWT from developer.groww.in
GROWW_API_SECRET=
TOTP_SECRET=        # base32 TOTP secret from your authenticator app
```
</details>

<details>
<summary><b>AngelOne</b></summary>

```env
BROKER=angelone
ANGELONE_API_KEY=       # from smartapi.angelbroking.com
ANGELONE_CLIENT_ID=     # your login ID
ANGELONE_PASSWORD=      # trading password
ANGELONE_TOTP_SECRET=   # TOTP secret
```
</details>

<details>
<summary><b>Zerodha</b></summary>

```env
BROKER=zerodha
ZERODHA_API_KEY=
ZERODHA_API_SECRET=
ZERODHA_REQUEST_TOKEN=  # from OAuth login — refresh daily
```

Auth: Open `https://kite.trade/connect/login?api_key=YOUR_KEY&v=3` → login → copy `request_token` from the redirect URL.
</details>

<details>
<summary><b>Upstox</b></summary>

```env
BROKER=upstox
UPSTOX_API_KEY=
UPSTOX_API_SECRET=
UPSTOX_CODE=           # from OAuth login — used once
UPSTOX_REDIRECT_URI=http://localhost:3000/callback
```

Auth: Open `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=YOUR_KEY&redirect_uri=YOUR_URI` → login → copy `code`.
</details>

---

## Add Your Own Broker

Extend `BaseBroker` in `src/brokers/base.js` and implement 7 methods:

```js
// src/brokers/my-broker.js
import { BaseBroker } from './base.js';

export class MyBroker extends BaseBroker {
  constructor(config) { super(config); this.name = 'MyBroker'; }

  async authenticate()    { /* return access token */ }
  async placeOrder(p)     { /* return { orderId, status } */ }
  async cancelOrder(id)   { /* return result */ }
  async getHoldings()     { /* return [{ tradingSymbol, quantity, averagePrice, ltp }] */ }
  async getPositions()    { /* return positions array */ }
  async getFunds()        { /* return { available, used, total } */ }
  async getOrderList()    { /* return orders array */ }
}
```

Then register it in `src/brokers/index.js` and set `BROKER=my-broker` in `.env`.

---

## Claude Desktop Integration (MCP)

Use all 30+ tools with natural language in Claude Desktop:

```json
{
  "mcpServers": {
    "ai-trader": {
      "command": "node",
      "args": ["C:/path/to/AI-trader/src/server.js"],
      "env": {
        "BROKER": "groww",
        "GROWW_API_KEY": "...",
        "TOTP_SECRET": "...",
        "ANTHROPIC_API_KEY": "..."
      }
    }
  }
}
```

**Talk to it in Claude:**
> *"Scan NIFTY 50 for RSI oversold stocks"*
> *"Deep analysis on RELIANCE with ATR stops and VWAP"*
> *"What are the options Greeks for NIFTY 24500 CE expiring Thursday?"*
> *"Calculate position size — I have ₹50,000 capital, 1% risk, entry at ₹1,800"*
> *"Run a full trading plan for today with live market data"*

---

## What's Under the Hood

### Confluence Scoring (0–10)

Each stock is scored across 10 factors. Trade only when score ≥ 6.

| Factor | Points | Meaning |
|--------|--------|---------|
| Daily BUY signal (RSI+MACD+SMA) | 2 | Multiple indicators aligned |
| RSI < 35 oversold | 2 | Strong mean-reversion setup |
| RSI < 45 mildly oversold | 1 | Potential support |
| Stochastic oversold | 1 | Momentum bottoming |
| SuperTrend BULLISH | 1 | Trend direction confirmed |
| Price above VWAP | 1 | Institutions net buyers |
| Price at Bollinger lower band | 1 | Statistical extreme |
| Price within 1.5% of support | 1 | Key price level holding |
| Strong bullish candle pattern | 1 | Hammer, Engulfing, Morning Star, etc. |

### Technical Indicators

| Category | Indicators |
|----------|-----------|
| Momentum | RSI(14), Stochastic %K/%D, Williams %R |
| Trend | SMA 20/50, EMA 9, MACD, SuperTrend, Chandelier Exit |
| Volatility | Bollinger Bands, ATR(14), Annual Volatility |
| Volume | VWAP, Volume profile |
| Levels | Support/Resistance, 52-week high/low |

### Candlestick Patterns (22)

**Single:** Doji, Hammer, Inverted Hammer, Shooting Star, Hanging Man, Marubozu, Spinning Top

**Two-candle:** Bullish/Bearish Engulfing, Harami, Piercing Line, Dark Cloud Cover, Tweezer Top/Bottom

**Three-candle:** Morning Star, Evening Star, Three White Soldiers, Three Black Crows, Morning/Evening Doji Star, Three Inside Up/Down

### Options Tools

- **Greeks:** Delta, Gamma, Theta, Vega, Rho via Black-Scholes
- **Implied Volatility:** Back-calculate IV from market premium
- **Option Chain:** Full Greeks table for ±5 strikes
- **Max Pain:** Strike where option sellers lose least

---

## MCP Tools Reference

<details>
<summary><b>Market Data (free, no auth needed)</b></summary>

| Tool | What it does |
|------|-------------|
| `get_live_price` | Real-time NSE quote |
| `get_nifty50` | All NIFTY 50 stocks with live prices |
| `get_top_gainers` | Top gainers by index |
| `get_top_losers` | Top losers by index |
| `get_most_active` | Most traded by volume |
| `get_all_indices` | All 20+ NSE sector indices |
| `get_option_chain` | Full F&O option chain |
| `get_historical_data` | OHLCV daily/weekly/monthly |
| `get_news` | Live market headlines |
| `get_market_status` | Open/closed + NIFTY level |
</details>

<details>
<summary><b>Analysis</b></summary>

| Tool | What it does |
|------|-------------|
| `analyze_stock` | RSI, MACD, BB, SMA, buy/sell signal |
| `pro_analysis` | ATR, VWAP, Stochastic, SuperTrend, confluence score/10 |
| `scan_patterns` | Scan 22 candlestick patterns with explanations |
| `learn_pattern` | Teach any pattern — what it means + how to trade it |
| `options_greeks` | Black-Scholes Greeks + IV + nearby option chain |
| `vwap_analysis` | VWAP bands, intraday trade plan, institutional bias |
| `stock_screener` | Screen NIFTY 50/100 by RSI, breakout, momentum |
| `sector_rotation` | 12 sectors ranked — follow FII money |
| `backtest` | Test 4 strategies on up to 2 years of history |
| `position_sizer` | ATR-based qty, max loss, 1.5R and 3R targets |
</details>

<details>
<summary><b>Paper Trading</b></summary>

| Tool | What it does |
|------|-------------|
| `paper_buy` | Buy at live NSE price (virtual) |
| `paper_sell` | Sell at live price, realize P&L (virtual) |
| `paper_buy_option` | Buy CE/PE option (virtual) |
| `paper_sell_option` | Exit option position (virtual) |
| `paper_portfolio` | Full portfolio with live unrealized P&L |
| `paper_orders` | Full order history |
| `paper_reset` | Fresh start with custom capital |
</details>

<details>
<summary><b>Trade Journal</b></summary>

| Tool | What it does |
|------|-------------|
| `journal_add` | Log trade — setup, entry reason, timeframe, tags |
| `journal_close` | Record exit + lesson learned |
| `journal_stats` | Win rate, profit factor, expectancy, max drawdown |
| `journal_open` | See all open positions |
</details>

<details>
<summary><b>AI Advisor</b></summary>

| Tool | What it does |
|------|-------------|
| `trading_advisor` | Full AI trading plan using live data + your profile |
</details>

<details>
<summary><b>Real Orders (requires broker subscription)</b></summary>

| Tool | What it does |
|------|-------------|
| `place_order` | Place BUY/SELL on NSE/BSE |
| `cancel_order` | Cancel pending order |
| `get_holdings` | Your real stock holdings |
| `get_positions` | Open intraday positions |
| `get_margins` | Available funds + margin |
| `get_orders` | Today's order book |
</details>

---

## Project Structure

```
AI-trader/
├── src/
│   ├── server.js           # MCP server — all 30+ tools
│   ├── groww-client.js     # Market data client (NSE India + Yahoo Finance)
│   ├── analytics.js        # RSI, MACD, ATR, VWAP, SuperTrend, Stochastic...
│   ├── patterns.js         # 22 candlestick pattern recognition
│   ├── paper-trade.js      # Virtual trading engine with brokerage simulation
│   ├── trade-journal.js    # Performance tracking — win rate, drawdown, expectancy
│   ├── greeks.js           # Black-Scholes options calculator
│   ├── totp.js             # TOTP authenticator (no dependency)
│   └── brokers/
│       ├── base.js         # Abstract broker interface
│       ├── groww.js        # Groww implementation
│       ├── angelone.js     # AngelOne Smart API
│       ├── zerodha.js      # Zerodha Kite Connect
│       ├── upstox.js       # Upstox v2 API
│       └── index.js        # Broker factory (reads BROKER= from .env)
├── trading-bot.mjs         # Autonomous terminal bot with live dashboard
├── advisor-run.mjs         # Standalone AI advisor script
├── .env.example            # Config template — all 4 brokers documented
├── package.json
└── README.md
```

---

## Backtesting Results Format

```
RELIANCE — RSI Reversion Strategy — 365 days
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Starting capital : ₹1,00,000
Final value      : ₹1,18,400    (+18.4%)
Total trades     : 12
Win rate         : 66.7%
Avg win          : ₹3,200
Avg loss         : ₹1,100
Profit factor    : 2.9x
Buy & hold       : +12.1%  (our strategy beat it)
```

---

## Security

- `.env` is gitignored — your API keys are **never committed**
- All auth tokens stay local on your machine
- Bot only reads market data and places orders under your explicit control
- Paper trading mode is fully isolated — zero real money risk

---

## Requirements

- Node.js 18+
- A broker account with API access enabled
- Internet connection (uses free NSE India + Yahoo Finance APIs for market data)
- Anthropic API key (optional — only needed for AI advisor)

---

## License

MIT — free to use, modify, and share.

---

*Built for Indian retail traders who want institutional-grade tools without institutional-grade cost.*
