"""
Trade plan validation — zero-error layer.
Every trade plan must pass ALL checks before execution.
"""
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))

LOT_SIZES = {"NIFTY": 75, "BANKNIFTY": 30, "FINNIFTY": 40}
STRIKE_STEPS = {"NIFTY": 50, "BANKNIFTY": 100, "FINNIFTY": 50}


def validate_trade_plan(plan: dict, portfolio: dict) -> tuple[bool, list[str]]:
    """Validate a trade plan. Returns (is_valid, list_of_errors)."""
    errors = []

    # Required fields
    required = ["symbol", "strike", "type", "expiry", "lots", "lotSize", "premium", "sl_points", "tgt_points"]
    for field in required:
        if field not in plan:
            errors.append(f"Missing required field: {field}")
    if errors:
        return False, errors

    symbol = plan["symbol"].upper()
    strike = plan["strike"]
    opt_type = plan["type"].upper()
    lots = plan["lots"]
    lot_size = plan["lotSize"]
    premium = plan["premium"]
    sl_pts = plan["sl_points"]
    tgt_pts = plan["tgt_points"]

    # Symbol validity
    if symbol not in LOT_SIZES:
        errors.append(f"Invalid symbol '{symbol}'. Must be one of: {list(LOT_SIZES.keys())}")

    # Option type
    if opt_type not in ("CE", "PE"):
        errors.append(f"Invalid type '{opt_type}'. Must be CE or PE")

    # Strike price — must be divisible by step
    if symbol in STRIKE_STEPS:
        step = STRIKE_STEPS[symbol]
        if strike % step != 0:
            errors.append(f"Strike {strike} not divisible by {step} for {symbol}")

    # Lot size correctness
    if symbol in LOT_SIZES and lot_size != LOT_SIZES[symbol]:
        errors.append(f"Lot size for {symbol} must be {LOT_SIZES[symbol]}, got {lot_size}")

    # Lots sanity
    if lots < 1 or lots > 50:
        errors.append(f"Lots must be 1-50, got {lots}")

    # Premium sanity
    if premium <= 0:
        errors.append(f"Premium must be positive, got {premium}")
    if premium > 5000:
        errors.append(f"Premium {premium} seems too high — verify")

    # SL/Target sanity
    if sl_pts <= 0:
        errors.append(f"Stop loss points must be positive, got {sl_pts}")
    if tgt_pts <= 0:
        errors.append(f"Target points must be positive, got {tgt_pts}")
    if sl_pts > 100:
        errors.append(f"SL {sl_pts} points seems too wide — max 100")

    # Risk:Reward should be at least 1:1
    if tgt_pts > 0 and sl_pts > 0 and tgt_pts < sl_pts:
        errors.append(f"Risk:Reward {sl_pts}:{tgt_pts} is below 1:1 — reconsider")

    # Capital check
    if portfolio:
        cash = float(portfolio.get("cash", 0))
        total_cost = premium * lots * lot_size
        charges = max(total_cost * 0.0003, 20) + 20
        if cash < total_cost + charges:
            errors.append(f"Insufficient funds: need {total_cost + charges:.0f}, have {cash:.0f}")

        # Risk per trade < 2% of portfolio
        max_loss = sl_pts * 0.40 * lots * lot_size  # approx delta=0.40
        portfolio_value = float(portfolio.get("portfolioValue", cash))
        if portfolio_value > 0 and max_loss > portfolio_value * 0.02:
            errors.append(f"Max loss {max_loss:.0f} exceeds 2% of portfolio ({portfolio_value * 0.02:.0f})")

    # Market hours check (IST)
    now = datetime.now(IST)
    h, m = now.hour, now.minute
    is_market_hours = (h == 9 and m >= 15) or (10 <= h <= 14) or (h == 15 and m <= 30)
    if not is_market_hours:
        errors.append(f"Market closed (current IST: {now.strftime('%H:%M')}). Trading hours: 9:15-15:30")

    # Expiry validation
    if "expiry" in plan:
        try:
            exp = plan["expiry"]
            # Try common formats
            for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y"):
                try:
                    exp_date = datetime.strptime(exp, fmt)
                    if exp_date.date() < now.date():
                        errors.append(f"Expiry {exp} is in the past")
                    break
                except ValueError:
                    continue
        except Exception:
            pass  # Don't block on expiry parse — soft check

    return len(errors) == 0, errors


def validate_exit(position: dict) -> tuple[bool, list[str]]:
    """Validate an exit order."""
    errors = []
    if not position:
        errors.append("No position found to exit")
    return len(errors) == 0, errors
