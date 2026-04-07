"""
Background agent system — persistent asyncio tasks for trade monitoring.
Agents run until SL/target hit or manually stopped.
"""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from dashboard import bridge

IST = timezone(timedelta(hours=5, minutes=30))

# Global registry
agents: dict[str, dict] = {}
_broadcast_fn = None


def set_broadcast(fn):
    global _broadcast_fn
    _broadcast_fn = fn


async def broadcast(msg: dict):
    if _broadcast_fn:
        await _broadcast_fn(msg)


def list_agents() -> list[dict]:
    return [
        {
            "id": a["id"],
            "name": a["name"],
            "status": a["status"],
            "created_at": a["created_at"],
            "config": a["config"],
            "last_update": a.get("last_update"),
        }
        for a in agents.values()
    ]


async def stop_agent(agent_id: str) -> dict:
    agent = agents.get(agent_id)
    if not agent:
        return {"success": False, "error": f"Agent {agent_id} not found"}
    if agent["status"] != "RUNNING":
        return {"success": False, "error": f"Agent is {agent['status']}, not running"}

    agent["stop_requested"] = True
    # Wait briefly for graceful shutdown
    for _ in range(10):
        if agent["status"] != "RUNNING":
            break
        await asyncio.sleep(0.5)

    return {"success": True, "message": f"Agent {agent_id} stopped", "final_status": agent["status"]}


async def start_trade_monitor(config: dict) -> dict:
    """Spawn a background trade monitor agent."""
    agent_id = str(uuid.uuid4())[:8]
    symbol = config.get("symbol", "NIFTY")
    opt_type = config.get("type", "PE")
    strike = config.get("strike", 0)

    agent_info = {
        "id": agent_id,
        "name": f"Trade: {symbol} {strike}{opt_type}",
        "status": "RUNNING",
        "created_at": datetime.now(IST).isoformat(),
        "config": config,
        "stop_requested": False,
        "last_update": None,
        "pnl": 0,
        "exit_reason": None,
    }
    agents[agent_id] = agent_info

    task = asyncio.create_task(_trade_monitor_loop(agent_id))
    agent_info["task"] = task
    task.add_done_callback(lambda t: _on_agent_done(agent_id, t))

    return {"success": True, "agent_id": agent_id, "name": agent_info["name"]}


def _on_agent_done(agent_id: str, task: asyncio.Task):
    agent = agents.get(agent_id)
    if agent and agent["status"] == "RUNNING":
        if task.exception():
            agent["status"] = "ERROR"
            agent["exit_reason"] = str(task.exception())
        else:
            agent["status"] = "COMPLETED"


async def _trade_monitor_loop(agent_id: str):
    """Core trade monitor — runs every 1 second until exit condition or stop."""
    agent = agents[agent_id]
    config = agent["config"]

    symbol = config["symbol"]
    opt_type = config["type"]
    strike = config["strike"]
    expiry = config["expiry"]
    entry_nifty = config["entry_nifty"]
    entry_premium = config["entry_premium"]
    sl_points = config["sl_points"]
    tgt_points = config["tgt_points"]
    lots = config.get("lots", 1)
    lot_size = config["lotSize"]
    delta = config.get("delta", 0.40)

    # Calculate SL/target levels
    if opt_type == "PE":
        sl_nifty = entry_nifty + sl_points
        tgt_nifty = entry_nifty - tgt_points
    else:
        sl_nifty = entry_nifty - sl_points
        tgt_nifty = entry_nifty + tgt_points

    sl_premium = max(5, entry_premium - sl_points * delta)
    tgt_premium = entry_premium + tgt_points * delta

    tick = 0
    while not agent["stop_requested"]:
        try:
            # Fetch live NIFTY
            resp = await bridge.get_nifty()
            nifty_data = resp.get("data", {})
            nifty = nifty_data.get("lastPrice", entry_nifty)
            p_change = nifty_data.get("pChange", 0)

            # Calculate current P&L
            if opt_type == "PE":
                move = entry_nifty - nifty
            else:
                move = nifty - entry_nifty
            cur_premium = max(5, entry_premium + move * delta)
            pnl = (cur_premium - entry_premium) * lot_size * lots

            # Check exit conditions
            exit_reason = None
            if opt_type == "PE":
                if nifty >= sl_nifty:
                    exit_reason = "STOP_LOSS"
                elif nifty <= tgt_nifty:
                    exit_reason = "TARGET_HIT"
            else:
                if nifty <= sl_nifty:
                    exit_reason = "STOP_LOSS"
                elif nifty >= tgt_nifty:
                    exit_reason = "TARGET_HIT"

            # Auto square-off at 3:20 PM IST
            now = datetime.now(IST)
            if now.hour == 15 and now.minute >= 20:
                exit_reason = "TIME_EXIT"

            # Update agent state
            update = {
                "agent_id": agent_id,
                "nifty": nifty,
                "p_change": p_change,
                "entry_nifty": entry_nifty,
                "cur_premium": round(cur_premium, 1),
                "pnl": round(pnl, 0),
                "sl_nifty": sl_nifty,
                "tgt_nifty": tgt_nifty,
                "tick": tick,
                "status": "RUNNING",
                "exit_reason": None,
            }
            agent["last_update"] = update
            agent["pnl"] = round(pnl, 0)

            if exit_reason:
                # Execute exit
                exit_prem = sl_premium if exit_reason == "STOP_LOSS" else (tgt_premium if exit_reason == "TARGET_HIT" else cur_premium)
                sell_result = await bridge.paper_sell_option({
                    "symbol": symbol,
                    "strike": strike,
                    "type": opt_type,
                    "expiry": expiry,
                    "currentPremium": exit_prem,
                    "note": f"Auto-{exit_reason} by agent {agent_id}",
                })

                final_pnl = (exit_prem - entry_premium) * lot_size * lots
                agent["status"] = "COMPLETED"
                agent["exit_reason"] = exit_reason
                agent["pnl"] = round(final_pnl, 0)

                update["status"] = "COMPLETED"
                update["exit_reason"] = exit_reason
                update["pnl"] = round(final_pnl, 0)
                update["sell_result"] = sell_result

                await broadcast({"type": "agent_update", **update})
                await broadcast({
                    "type": "agent_exit",
                    "agent_id": agent_id,
                    "exit_reason": exit_reason,
                    "pnl": round(final_pnl, 0),
                    "message": f"{'TARGET HIT' if exit_reason == 'TARGET_HIT' else 'STOP LOSS' if exit_reason == 'STOP_LOSS' else 'TIME EXIT'} | P&L: {final_pnl:+.0f}",
                })
                return

            # Broadcast periodic update
            if tick % 2 == 0:  # every 2 seconds to avoid flooding
                await broadcast({"type": "agent_update", **update})

            tick += 1
            await asyncio.sleep(1)

        except Exception as e:
            # Don't crash on transient errors — log and continue
            await broadcast({
                "type": "agent_error",
                "agent_id": agent_id,
                "error": str(e),
            })
            await asyncio.sleep(2)

    # Manual stop — sell at market
    try:
        resp = await bridge.get_nifty()
        nifty = resp.get("data", {}).get("lastPrice", entry_nifty)
        if opt_type == "PE":
            move = entry_nifty - nifty
        else:
            move = nifty - entry_nifty
        exit_prem = max(5, entry_premium + move * delta)

        sell_result = await bridge.paper_sell_option({
            "symbol": symbol,
            "strike": strike,
            "type": opt_type,
            "expiry": expiry,
            "currentPremium": exit_prem,
            "note": f"Manual stop by user — agent {agent_id}",
        })
        final_pnl = (exit_prem - entry_premium) * lot_size * lots
        agent["status"] = "STOPPED"
        agent["exit_reason"] = "MANUAL_STOP"
        agent["pnl"] = round(final_pnl, 0)

        await broadcast({
            "type": "agent_exit",
            "agent_id": agent_id,
            "exit_reason": "MANUAL_STOP",
            "pnl": round(final_pnl, 0),
            "message": f"Manually stopped | P&L: {final_pnl:+.0f}",
        })
    except Exception as e:
        agent["status"] = "ERROR"
        agent["exit_reason"] = f"Stop error: {e}"
