# Trading Bot — AI-Powered NSE Terminal

Autonomous trading bot with AI analytics for NSE/BSE markets. Plug in your broker (Groww, AngelOne, Zerodha, or Upstox) and start trading with AI signals, candlestick patterns, and institutional-grade risk management.

## Features

- **Live market monitoring** — NIFTY, BANKNIFTY, sector indices, top gainers/losers
- **Technical analysis** — RSI, MACD, Bollinger Bands, SMA/EMA, ATR, VWAP, Stochastic, SuperTrend, Williams %R
- **22 candlestick patterns** — Hammer, Engulfing, Morning Star, Three White Soldiers, and more
- **Options Greeks** — Black-Scholes: Delta, Gamma, Theta, Vega, Rho + Implied Volatility
- **Position sizing** — ATR-based stop loss, exact qty calculation, R:R targets
- **Paper trading** — Practice with ₹1 lakh virtual capital, live P&L tracking
- **Trade journal** — Record every trade, win rate, expectancy, profit factor, max drawdown
- **Backtester** — Test 4 strategies: RSI reversion, SMA crossover, BB bounce, MACD crossover
- **Sector rotation** — Track 12 sectors, find where FII money is flowing
- **Stock screener** — Scan NIFTY 50/100 for breakouts, RSI oversold, momentum setups
- **AI trading advisor** — Claude AI-powered daily trade plan (requires Anthropic API key)
- **Autonomous bot** — Runs 24/7, auto-scans, alerts on high-confluence setups, auto paper trades
- **MCP integration** — Use all tools directly in Claude Desktop

## Quick Start

```bash
# 1. Clone and install
git clone <this-repo>
cd trading-bot
npm install

# 2. Configure
cp .env.example .env
# Edit .env — set BROKER= and fill in your credentials

# 3. Run the bot (terminal dashboard)
node trading-bot.mjs

# 4. Options
node trading-bot.mjs --mode paper          # auto paper trade
node trading-bot.mjs --mode live           # real orders (careful!)
node trading-bot.mjs --interval 3          # scan every 3 minutes
node trading-bot.mjs --watchlist RELIANCE,TCS,INFY,HDFCBANK,NIFTY50
node trading-bot.mjs --capital 50000       # paper capital
node trading-bot.mjs --risk 1.5            # 1.5% risk per trade
node trading-bot.mjs --min-score 7         # only alert score >= 7/10

# npm shortcuts
npm run bot              # watch mode
npm run bot:paper        # paper trading mode
npm run advisor          # one-time AI market analysis
```

## Supported Brokers

| Broker | Status | API Access | Docs |
|--------|--------|-----------|------|
| **Groww** | Full support | Free | [developer.groww.in](https://developer.groww.in) |
| **AngelOne** | Full support | Free | [smartapi.angelbroking.com](https://smartapi.angelbroking.com) |
| **Zerodha** | Full support | ₹2000/month | [kite.trade/docs](https://kite.trade/docs/connect/v3) |
| **Upstox** | Full support | Free | [developer.upstox.com](https://developer.upstox.com) |

### Set your broker in `.env`

```env
BROKER=groww       # or angelone, zerodha, upstox
```

### Groww
```env
GROWW_API_KEY=<JWT from developer.groww.in>
GROWW_API_SECRET=<API secret>
TOTP_SECRET=<base32 TOTP secret>
```

### AngelOne
```env
ANGELONE_API_KEY=<from smartapi.angelbroking.com>
ANGELONE_CLIENT_ID=<your client ID>
ANGELONE_PASSWORD=<your trading password>
ANGELONE_TOTP_SECRET=<TOTP secret>
```

### Zerodha
```env
ZERODHA_API_KEY=<from kite.trade/app>
ZERODHA_API_SECRET=<API secret>
ZERODHA_REQUEST_TOKEN=<from OAuth login — refresh daily>
```
Auth: Open `https://kite.trade/connect/login?api_key=YOUR_KEY&v=3` → Login → copy `request_token` from redirect URL

### Upstox
```env
UPSTOX_API_KEY=<from developer.upstox.com>
UPSTOX_API_SECRET=<API secret>
UPSTOX_CODE=<from OAuth login — used once>
UPSTOX_REDIRECT_URI=http://localhost:3000/callback
```
Auth: Open `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=YOUR_KEY&redirect_uri=YOUR_URI` → copy `code` from redirect

## Add a New Broker

1. Create `src/brokers/your-broker.js`
2. Extend `BaseBroker` from `src/brokers/base.js`
3. Implement: `authenticate`, `placeOrder`, `cancelOrder`, `getHoldings`, `getPositions`, `getFunds`, `getOrderList`
4. Register in `src/brokers/index.js`
5. Set `BROKER=your-broker` in `.env`

```js
// src/brokers/your-broker.js
import { BaseBroker } from './base.js';

export class YourBroker extends BaseBroker {
  constructor(config) {
    super(config);
    this.name = 'YourBroker';
  }

  async authenticate()    { /* return access token */ }
  async placeOrder(p)     { /* return { orderId, status } */ }
  async cancelOrder(id)   { /* return result */ }
  async getHoldings()     { /* return [{ tradingSymbol, quantity, averagePrice, ltp }] */ }
  async getPositions()    { /* return positions array */ }
  async getFunds()        { /* return { available, used, total } */ }
  async getOrderList()    { /* return orders array */ }
}
```

## Claude Desktop Integration (MCP)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "trading-bot": {
      "command": "node",
      "args": ["C:/path/to/trading-bot/src/server.js"],
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

Then in Claude Desktop, use natural language:
- *"Scan NIFTY 50 for RSI oversold stocks"*
- *"Analyze RELIANCE with pro indicators"*
- *"Calculate position size for 1% risk on INFY at ₹1800 entry"*
- *"Show me options Greeks for NIFTY 24500 CE expiring in 7 days"*
- *"Run a trading advisor with ₹50,000 capital, medium risk"*

## MCP Tools Reference

### Market Data
| Tool | Description |
|------|-------------|
| `get_live_price` | Real-time NSE price |
| `get_nifty50` | All NIFTY 50 stocks |
| `get_top_gainers` | Top gainers by index |
| `get_top_losers` | Top losers by index |
| `get_most_active` | Most traded by volume |
| `get_all_indices` | All NSE sector indices |
| `get_option_chain` | Full option chain |
| `get_historical_data` | OHLCV candle data |
| `get_news` | Live market news |

### Analysis
| Tool | Description |
|------|-------------|
| `analyze_stock` | RSI, MACD, BB, SMA, signals |
| `pro_analysis` | ATR, VWAP, Stochastic, SuperTrend, confluence score |
| `scan_patterns` | 22 candlestick patterns |
| `learn_pattern` | Pattern education + trade instructions |
| `options_greeks` | Black-Scholes Greeks + IV |
| `vwap_analysis` | VWAP bands + intraday trade plan |
| `stock_screener` | Screen by RSI, breakout, momentum |
| `sector_rotation` | 12 sector performance + FII flow |
| `backtest` | Strategy backtesting on historical data |

### Risk & Sizing
| Tool | Description |
|------|-------------|
| `position_sizer` | ATR-based position size calculator |

### Paper Trading
| Tool | Description |
|------|-------------|
| `paper_buy` | Buy at live price (virtual) |
| `paper_sell` | Sell at live price (virtual) |
| `paper_buy_option` | Buy option (virtual) |
| `paper_sell_option` | Sell/exit option (virtual) |
| `paper_portfolio` | Portfolio with live P&L |
| `paper_orders` | Order history |
| `paper_reset` | Reset with new capital |

### Trade Journal
| Tool | Description |
|------|-------------|
| `journal_add` | Log trade with setup, entry reason, tags |
| `journal_close` | Close trade, record P&L + lesson |
| `journal_stats` | Win rate, expectancy, profit factor, drawdown |
| `journal_open` | View open trades |

### Real Orders (requires broker subscription)
| Tool | Description |
|------|-------------|
| `get_holdings` | Your actual stock holdings |
| `get_positions` | Open intraday positions |
| `get_margins` | Available funds |
| `get_orders` | Today's order book |
| `place_order` | Place BUY/SELL order |
| `cancel_order` | Cancel pending order |

### AI
| Tool | Description |
|------|-------------|
| `trading_advisor` | Full AI trading plan with live data |

## File Structure

```
trading-bot/
├── src/
│   ├── server.js          # MCP server (all 30+ tools)
│   ├── groww-client.js    # Market data + Groww API client
│   ├── analytics.js       # RSI, MACD, ATR, VWAP, SuperTrend, etc.
│   ├── patterns.js        # 22 candlestick patterns
│   ├── paper-trade.js     # Paper trading engine
│   ├── trade-journal.js   # Trade journal + performance stats
│   ├── greeks.js          # Black-Scholes options Greeks
│   ├── totp.js            # TOTP code generator
│   └── brokers/
│       ├── base.js        # Abstract broker interface
│       ├── groww.js       # Groww implementation
│       ├── angelone.js    # AngelOne implementation
│       ├── zerodha.js     # Zerodha Kite implementation
│       ├── upstox.js      # Upstox implementation
│       └── index.js       # Broker factory
├── trading-bot.mjs        # Autonomous terminal bot
├── advisor-run.mjs        # Standalone AI advisor
├── .env.example           # Config template
├── paper-portfolio.json   # Paper trading state (auto-created)
├── trade-journal.json     # Trade journal (auto-created)
└── bot.log                # Bot activity log (auto-created)
```

## Confluence Score (0–10)

The bot scores each stock on 10 factors. Higher = stronger setup.

| Score | Meaning | Action |
|-------|---------|--------|
| 8–10 | Very strong setup | High-conviction entry |
| 6–7 | Good setup | Enter with standard position |
| 4–5 | Weak/mixed | Wait for confirmation |
| 0–3 | Bearish / no setup | Avoid or short |

**Factors scored:**
- Daily BUY signal (RSI + MACD + SMA confluence) — 2 pts
- RSI oversold < 35 — 2 pts, or < 45 — 1 pt
- Stochastic oversold — 1 pt
- SuperTrend BULLISH — 1 pt
- Price above VWAP — 1 pt
- Price at Bollinger lower band — 1 pt
- Price within 1.5% of support — 1 pt
- Strong bullish candlestick pattern — 1 pt

## Disclaimer

This tool is for educational and paper trading purposes. Do not risk money you cannot afford to lose. Past backtesting results do not guarantee future performance. Always do your own research.
