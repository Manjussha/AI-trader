"""
Starlette ASGI app — serves dashboard UI and handles WebSocket chat.
Uses Claude Code CLI (not API) as the AI backend.
"""
import json
import asyncio
from pathlib import Path
from starlette.applications import Starlette
from starlette.routing import Route, WebSocketRoute
from starlette.responses import HTMLResponse, JSONResponse
from starlette.websockets import WebSocket, WebSocketDisconnect
from dashboard import bridge
from dashboard import agents as agent_mgr
from dashboard.claude_chat import ChatSession

STATIC_DIR = Path(__file__).parent / "static"

# Connected WebSocket clients
clients: set[WebSocket] = set()


async def broadcast_to_all(msg: dict):
    """Send a message to all connected WebSocket clients."""
    dead = set()
    for ws in clients:
        try:
            await ws.send_json(msg)
        except Exception:
            dead.add(ws)
    clients -= dead


# Register broadcast function with agent system
agent_mgr.set_broadcast(broadcast_to_all)


# ── HTTP Routes ───────────────────────────────────────────────────────────────
async def homepage(request):
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


async def api_agents(request):
    return JSONResponse({"agents": agent_mgr.list_agents()})


async def api_stop_agent(request):
    agent_id = request.path_params["agent_id"]
    result = await agent_mgr.stop_agent(agent_id)
    return JSONResponse(result)


# ── WebSocket Handler ─────────────────────────────────────────────────────────
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)

    # Per-connection chat session (maintains Claude subprocess)
    chat_session = ChatSession()
    chat_task: asyncio.Task | None = None

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type", "chat")

            if msg_type == "stop_chat":
                # Kill running Claude process immediately
                if chat_task and not chat_task.done():
                    await chat_session.cancel_all()
                    chat_task.cancel()
                    try:
                        await chat_task
                    except (asyncio.CancelledError, Exception):
                        pass
                    chat_task = None
                await ws.send_json({"type": "chat_stopped"})
                await ws.send_json({"type": "chat_done"})
                continue

            if msg_type == "chat":
                user_msg = data.get("message", "").strip()
                if not user_msg:
                    continue

                # If a previous chat is still running, kill it first
                if chat_task and not chat_task.done():
                    await chat_session.cancel_latest()
                    chat_task.cancel()
                    try:
                        await chat_task
                    except (asyncio.CancelledError, Exception):
                        pass

                # Callbacks for streaming to WebSocket
                async def on_text(text):
                    await ws.send_json({"type": "chat_stream", "delta": text})

                async def on_tool_start(tool_name, tool_input):
                    await ws.send_json({
                        "type": "tool_start",
                        "tool": tool_name,
                        "input": tool_input,
                    })

                async def on_tool_result(tool_name, result_str):
                    try:
                        parsed = json.loads(result_str) if isinstance(result_str, str) else result_str
                    except Exception:
                        parsed = result_str
                    await ws.send_json({
                        "type": "tool_result",
                        "tool": tool_name,
                        "result": parsed,
                    })

                async def run_chat():
                    try:
                        await ws.send_json({"type": "thinking", "status": True})
                        await chat_session.chat(
                            user_msg,
                            on_text=on_text,
                            on_tool_start=on_tool_start,
                            on_tool_result=on_tool_result,
                        )
                        await ws.send_json({"type": "chat_done"})
                    except asyncio.CancelledError:
                        pass
                    except Exception as e:
                        await ws.send_json({"type": "error", "message": str(e)})
                        await ws.send_json({"type": "chat_done"})

                chat_task = asyncio.create_task(run_chat())

            elif msg_type == "stop_agent":
                agent_id = data.get("agent_id", "")
                result = await agent_mgr.stop_agent(agent_id)
                await ws.send_json({"type": "agent_stopped", **result})

            elif msg_type == "get_portfolio":
                result = await bridge.get_portfolio()
                await ws.send_json({"type": "portfolio", "data": result.get("data", {})})

            elif msg_type == "get_agents":
                await ws.send_json({"type": "agent_list", "agents": agent_mgr.list_agents()})

    except WebSocketDisconnect:
        # Kill any running chat on disconnect
        if chat_task and not chat_task.done():
            await chat_session.cancel_all()
            chat_task.cancel()
    finally:
        clients.discard(ws)


# ── Lifespan ─────────────────────────────────────────────────────────────────
async def lifespan(app):
    # Check bridge health on startup
    for i in range(10):
        try:
            h = await bridge.health()
            if h.get("ok"):
                print("Node bridge connected.")
                break
        except Exception:
            pass
        if i < 9:
            print(f"Waiting for Node bridge (attempt {i + 1}/10)...")
            await asyncio.sleep(2)
    else:
        print("WARNING: Node bridge not reachable at localhost:3001")
        print("Start it with: node node-bridge.mjs")

    # Verify Claude Code CLI is available
    import sys
    claude_cmd = 'claude.cmd --version' if sys.platform == 'win32' else 'claude --version'
    proc = await asyncio.create_subprocess_shell(
        claude_cmd,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, _ = await proc.communicate()
    if proc.returncode == 0:
        print(f"Claude Code CLI: {stdout.decode().strip()}")
    else:
        print("WARNING: 'claude' CLI not found. Chat will not work.")

    yield

    # Cleanup
    await bridge.close()


# ── App ──────────────────────────────────────────────────────────────────────
app = Starlette(
    debug=True,
    lifespan=lifespan,
    routes=[
        Route("/", homepage),
        Route("/api/agents", api_agents),
        Route("/api/agents/{agent_id}/stop", api_stop_agent, methods=["POST"]),
        WebSocketRoute("/ws", ws_endpoint),
    ],
)
