"""
Claude tool definitions for the trading agent.
Each tool maps to a bridge endpoint.
"""

TOOLS = [
    {
        "name": "get_nifty_live",
        "description": "Get live NIFTY 50 index data: lastPrice, pChange, dayHigh, dayLow, open, previousClose",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_banknifty_live",
        "description": "Get live BANK NIFTY index data: lastPrice, pChange, dayHigh, dayLow",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_stock_quote",
        "description": "Get live NSE quote for any stock symbol (e.g., RELIANCE, TCS, HDFCBANK)",
        "input_schema": {
            "type": "object",
            "properties": {"symbol": {"type": "string", "description": "NSE stock symbol"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "get_historical_data",
        "description": "Get historical OHLCV candles for a symbol. Returns array of {date, open, high, low, close, volume}",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "days": {"type": "integer", "description": "Lookback days (default 90)"},
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "run_technical_analysis",
        "description": "Run full technical analysis on a symbol: RSI, MACD, Bollinger Bands, ATR, VWAP, Stochastic, SuperTrend, Williams %R, Support/Resistance, Volatility, and overall BUY/SELL/HOLD signal with confidence score",
        "input_schema": {
            "type": "object",
            "properties": {"symbol": {"type": "string"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "scan_candlestick_patterns",
        "description": "Scan for candlestick patterns (Doji, Hammer, Engulfing, Morning Star, etc.) on a symbol",
        "input_schema": {
            "type": "object",
            "properties": {"symbol": {"type": "string"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "get_historical_similarity",
        "description": "Find past moments with similar RSI/BB/SMA setup and their forward returns",
        "input_schema": {
            "type": "object",
            "properties": {"symbol": {"type": "string"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "calculate_greeks",
        "description": "Calculate Black-Scholes option Greeks (delta, gamma, theta, vega, premium)",
        "input_schema": {
            "type": "object",
            "properties": {
                "spot": {"type": "number", "description": "Current spot price"},
                "strike": {"type": "number", "description": "Strike price"},
                "T": {"type": "number", "description": "Days to expiry / 365"},
                "iv": {"type": "number", "description": "Implied volatility (e.g., 0.18 for 18%)"},
                "type": {"type": "string", "enum": ["CE", "PE"]},
            },
            "required": ["spot", "strike", "T", "iv", "type"],
        },
    },
    {
        "name": "analyze_fo",
        "description": "Full F&O master analysis: detects regime, suggests strategies with sizing, exit rules. Provide all available market data.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "spot": {"type": "number"},
                "iv": {"type": "number"},
                "vix": {"type": "number"},
                "rsi": {"type": "number"},
                "macdHist": {"type": "number"},
                "atr": {"type": "number"},
                "atrAvg": {"type": "number"},
                "bbWidth": {"type": "number"},
                "superTrend": {"type": "string"},
                "weeklyRsi": {"type": "number"},
                "daysToExpiry": {"type": "integer"},
                "capital": {"type": "number"},
                "lotSize": {"type": "integer"},
                "pcr": {"type": "number"},
            },
            "required": ["symbol", "spot", "daysToExpiry", "capital", "lotSize"],
        },
    },
    {
        "name": "get_portfolio",
        "description": "Get current paper trading portfolio: cash, holdings, P&L, win rate, total trades",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_trade_journal_stats",
        "description": "Get trade journal statistics: total trades, wins, losses, win rate, profit factor, max drawdown",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "paper_buy_option",
        "description": "Execute a paper (simulated) option buy order. Returns success/failure with order details.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "NIFTY, BANKNIFTY, or FINNIFTY"},
                "strike": {"type": "number", "description": "Strike price"},
                "type": {"type": "string", "enum": ["CE", "PE"]},
                "expiry": {"type": "string", "description": "Expiry date string"},
                "lots": {"type": "integer", "default": 1},
                "lotSize": {"type": "integer", "description": "75 for NIFTY, 30 for BANKNIFTY"},
                "premium": {"type": "number", "description": "Entry premium per unit"},
                "note": {"type": "string"},
            },
            "required": ["symbol", "strike", "type", "expiry", "premium", "lotSize"],
        },
    },
    {
        "name": "paper_sell_option",
        "description": "Exit a paper option position by selling at current premium.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "strike": {"type": "number"},
                "type": {"type": "string", "enum": ["CE", "PE"]},
                "expiry": {"type": "string"},
                "currentPremium": {"type": "number", "description": "Exit premium"},
                "note": {"type": "string"},
            },
            "required": ["symbol", "strike", "type", "expiry", "currentPremium"],
        },
    },
    {
        "name": "paper_buy_stock",
        "description": "Execute a paper equity buy order.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "qty": {"type": "integer"},
                "price": {"type": "number"},
                "note": {"type": "string"},
            },
            "required": ["symbol", "qty", "price"],
        },
    },
    {
        "name": "paper_sell_stock",
        "description": "Execute a paper equity sell order.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "qty": {"type": "integer"},
                "price": {"type": "number"},
                "note": {"type": "string"},
            },
            "required": ["symbol", "qty", "price"],
        },
    },
    {
        "name": "start_trade_monitor",
        "description": "Start a persistent background agent that monitors a trade position. It will check NIFTY every 1 second and auto-exit on SL or target hit. Use AFTER executing a paper_buy_option.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "NIFTY, BANKNIFTY"},
                "strike": {"type": "number"},
                "type": {"type": "string", "enum": ["CE", "PE"]},
                "expiry": {"type": "string"},
                "entry_nifty": {"type": "number", "description": "NIFTY price at entry"},
                "entry_premium": {"type": "number"},
                "sl_points": {"type": "number", "description": "Stop loss in NIFTY points"},
                "tgt_points": {"type": "number", "description": "Target in NIFTY points"},
                "lots": {"type": "integer", "default": 1},
                "lotSize": {"type": "integer"},
                "delta": {"type": "number", "default": 0.40},
            },
            "required": ["symbol", "strike", "type", "expiry", "entry_nifty", "entry_premium", "sl_points", "tgt_points", "lotSize"],
        },
    },
    {
        "name": "stop_agent",
        "description": "Stop a running background agent by its ID. The agent will gracefully exit and sell any open position.",
        "input_schema": {
            "type": "object",
            "properties": {"agent_id": {"type": "string"}},
            "required": ["agent_id"],
        },
    },
    {
        "name": "list_agents",
        "description": "List all running and recently completed background agents with their status and P&L.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_market_gainers_losers",
        "description": "Get top NIFTY 50 gainers and losers for today.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
]
