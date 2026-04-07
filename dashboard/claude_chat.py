"""
Claude chat engine — uses Claude Code CLI (not API) as the backend.
Spawns `claude -p` subprocess with stream-json output for real-time streaming.
Supports cancellation via kill_event.
"""
import asyncio
import json
import uuid
import os
import sys

PROJECT_DIR = os.path.join(os.path.dirname(__file__), '..')
SKILLS_FILE = os.path.join(PROJECT_DIR, 'data', 'skills.json')

# On Windows, 'claude' is a .cmd file — need shell=True or full path
CLAUDE_CMD = 'claude.cmd' if sys.platform == 'win32' else 'claude'


ACCOUNTS_FILE = os.path.join(PROJECT_DIR, 'data', 'accounts.json')


def load_active_account() -> str:
    """Load active account info for system prompt."""
    try:
        with open(ACCOUNTS_FILE, 'r') as f:
            data = json.load(f)
        active_id = data.get('active', 'paper')
        acct = data.get('accounts', {}).get(active_id, {})
        name = acct.get('name', 'Paper Trading')
        broker = acct.get('broker', 'paper')
        status = acct.get('status', 'unknown')
        if broker == 'paper':
            return f"\n## ACTIVE ACCOUNT: {name} (PAPER MODE)\nAll trades go to paper portfolio. No real money at risk.\n"
        else:
            return f"\n## ACTIVE ACCOUNT: {name} ({broker.upper()}) — Status: {status}\nTrades will execute on REAL broker. Double-confirm with user before placing ANY order.\n"
    except Exception:
        return "\n## ACTIVE ACCOUNT: Paper Trading (PAPER MODE)\n"


def load_skills_index() -> str:
    """Load skills.json and format as a quick-reference block for the system prompt."""
    try:
        with open(SKILLS_FILE, 'r') as f:
            data = json.load(f)
        skills = data.get('skills', {})
        if not skills:
            return ""
        lines = ["\n## CACHED SKILLS (execute directly — DO NOT regenerate)"]
        for sid, s in skills.items():
            patterns = ', '.join(s.get('patterns', [])[:3])
            cmd = s.get('command', '')
            lines.append(f"  [{sid}] triggers: {patterns}")
            lines.append(f"    → {cmd}")
        lines.append("")
        return '\n'.join(lines)
    except Exception:
        return ""


def subprocess_cmd_string(cmd: list[str]) -> str:
    """Build a shell command string, quoting args that contain spaces."""
    parts = []
    for c in cmd:
        if ' ' in c or '"' in c or "'" in c or '\n' in c:
            escaped = c.replace('"', '\\"')
            parts.append(f'"{escaped}"')
        else:
            parts.append(c)
    return ' '.join(parts)


SYSTEM_PROMPT = """You are an elite Indian market prop trader AI assistant running inside a trading dashboard.
You have access to a Node.js bridge at http://localhost:3001.

## SKILLS INDEX (execute INSTANTLY — no thinking needed)
Before doing ANYTHING, check if a pre-built skill matches the user's request.
Load skills: curl -s http://localhost:3001/api/skills
If a skill matches → execute its "command" directly. Do NOT regenerate the command.
If the user's query has a {symbol} placeholder, substitute it (e.g. {symbol} → RELIANCE).

## BRIDGE ENDPOINTS (for when no skill matches)
MARKET DATA:
  curl -s http://localhost:3001/api/nifty          → NIFTY 50 live data
  curl -s http://localhost:3001/api/banknifty       → BANK NIFTY live data
  curl -s http://localhost:3001/api/quote/SYMBOL    → live quote for any stock
  curl -s http://localhost:3001/api/analytics/SYMBOL → full technical analysis
  curl -s http://localhost:3001/api/patterns/SYMBOL  → candlestick patterns
  curl -s http://localhost:3001/api/historical/SYMBOL?days=90 → OHLCV candles
  curl -s http://localhost:3001/api/gainers         → top NIFTY 50 gainers
  curl -s http://localhost:3001/api/losers          → top NIFTY 50 losers

F&O:
  curl -s -X POST http://localhost:3001/api/greeks -H 'Content-Type: application/json' -d '{"spot":S,"strike":K,"T":0.02,"iv":0.18,"type":"PE"}'
  curl -s -X POST http://localhost:3001/api/fo/analyze -H 'Content-Type: application/json' -d '{"symbol":"NIFTY","spot":S,...}'

PAPER TRADING:
  curl -s http://localhost:3001/api/paper/portfolio
  curl -s http://localhost:3001/api/paper/orders
  curl -s -X POST http://localhost:3001/api/paper/buy-option -H 'Content-Type: application/json' -d '{"symbol":"NIFTY","strike":23900,"type":"PE","expiry":"10-Apr-2025","lots":1,"lotSize":75,"premium":80}'
  curl -s -X POST http://localhost:3001/api/paper/sell-option -H 'Content-Type: application/json' -d '{"symbol":"NIFTY","strike":23900,"type":"PE","expiry":"10-Apr-2025","currentPremium":90}'

JOURNAL:
  curl -s http://localhost:3001/api/journal/stats

## SAVING NEW SKILLS
When you figure out a NEW useful command sequence that isn't in the skills index, SAVE it:
curl -s -X POST http://localhost:3001/api/skills -H 'Content-Type: application/json' -d '{"id":"skill_name","skill":{"patterns":["trigger phrase 1","trigger phrase 2"],"command":"the curl command","parse":"json","description":"what it does"}}'

## TRADING MEMORY
You have a persistent memory system. Use it to remember patterns, rules, lessons, and trades.

Read memory: curl -s http://localhost:3001/api/memory
Save memory: curl -s -X POST http://localhost:3001/api/memory -H 'Content-Type: application/json' -d '{"category":"CATEGORY","entry":{"title":"...","content":"...","tags":["..."]}}'

Categories:
  patterns  — chart patterns, setups that worked/failed, candlestick combos
  rules     — trading rules (e.g. "never short before 10:30 AM", "RSI<30 + hammer = high probability")
  lessons   — lessons from trades (e.g. "exited too early on RELIANCE, should have trailed SL")
  trades    — key trades worth remembering (entries, exits, what worked)
  notes     — general market observations, sector rotations, correlations

WHEN TO SAVE:
- After a successful trade analysis → save the pattern/setup to "patterns"
- After a trade exits → save the outcome and lesson to "lessons" and "trades"
- When user shares a trading rule → save to "rules"
- When user makes a market observation → save to "notes"

WHEN TO READ:
- Before analyzing a stock → check if we have past patterns/notes for it
- Before recommending a trade → check rules and lessons
- When user asks "what did we learn" or "what patterns work" → read memory

## DASHBOARD MODIFICATION
You can modify the dashboard app itself. The user may ask you to change the UI, add panels, fix bugs, etc.

Key files:
  dashboard/static/index.html  — Frontend UI (HTML + CSS + JS, single file)
  dashboard/app.py             — Starlette WebSocket server
  dashboard/claude_chat.py     — This chat engine (system prompt, CLI args)
  dashboard/agents.py          — Background agent system
  dashboard/bridge.py          — HTTP client to Node bridge
  dashboard/validators.py      — Trade validation rules
  node-bridge.mjs              — Node.js REST API (port 3001)
  src/paper-trade.js           — Paper trading engine
  src/analytics.js             — Technical indicators
  src/patterns.js              — Candlestick patterns

When modifying dashboard files:
1. Use Read to check current code first
2. Use Edit for targeted changes (preferred) or Write for new files
3. After editing, tell the user to refresh the browser (for frontend changes)
4. For backend changes (app.py, bridge), tell user to restart the server
5. Be careful with index.html — it's a single large file, make surgical edits
6. Test your changes by curling endpoints or reading the file back

## RULES
1. ALWAYS check skills index FIRST. If match → execute command directly. Speed is everything.
2. Use curl with -s flag always for API calls. Parse JSON and present clearly.
3. For trades: check live price → validate → execute. Zero errors.
4. NIFTY lot=75, strikes in 50s. BANKNIFTY lot=30, strikes in 100s.
5. Risk per trade < 2% of portfolio.
6. Be specific with numbers — no vague suggestions.
7. Keep responses concise — this is a trading terminal, not an essay.
8. After executing a new/novel command successfully, save it as a skill for next time.
9. After any significant trade/analysis, save relevant info to trading memory.
"""


class ChatSession:
    """Manages Claude Code CLI subprocesses. Each message = fresh session ID."""

    def __init__(self):
        self.processes: dict[str, asyncio.subprocess.Process] = {}  # id -> process
        self._lock = asyncio.Lock()

    async def cancel_all(self):
        """Kill ALL running Claude processes immediately."""
        async with self._lock:
            for pid, proc in list(self.processes.items()):
                if proc.returncode is None:
                    try:
                        proc.kill()
                    except ProcessLookupError:
                        pass
            # Wait briefly for cleanup
            for pid, proc in list(self.processes.items()):
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2)
                except asyncio.TimeoutError:
                    pass
            self.processes.clear()

    async def cancel_latest(self):
        """Kill the most recently spawned Claude process."""
        async with self._lock:
            if not self.processes:
                return
            latest_id = list(self.processes.keys())[-1]
            proc = self.processes.pop(latest_id, None)
            if proc and proc.returncode is None:
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2)
                except asyncio.TimeoutError:
                    pass

    async def chat(self, user_message: str,
                   on_text=None, on_tool_start=None, on_tool_result=None):
        """
        Send a message to Claude Code CLI and stream the response.
        Each call gets a fresh session ID — no conflicts.
        """
        session_id = str(uuid.uuid4())
        cancelled = False

        # Inject live skills index + active account into system prompt
        skills_block = load_skills_index()
        account_block = load_active_account()
        full_system_prompt = SYSTEM_PROMPT + account_block + skills_block

        cmd = [
            CLAUDE_CMD,
            '-p', user_message,
            '--output-format', 'stream-json',
            '--verbose',
            '--session-id', session_id,
            '--system-prompt', full_system_prompt,
            '--allowedTools', 'Bash Edit Write Read Glob Grep',
            '--permission-mode', 'auto',
            '--no-session-persistence',
        ]

        if sys.platform == 'win32':
            process = await asyncio.create_subprocess_shell(
                subprocess_cmd_string(cmd),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=PROJECT_DIR,
            )
        else:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=PROJECT_DIR,
            )

        async with self._lock:
            self.processes[session_id] = process

        full_text = ""
        buffer = ""

        try:
            while True:
                # Check if process was killed externally (cancel)
                if process.returncode is not None:
                    cancelled = True
                    break

                try:
                    chunk = await asyncio.wait_for(process.stdout.read(4096), timeout=1.0)
                except asyncio.TimeoutError:
                    if process.returncode is not None:
                        cancelled = True
                        break
                    continue

                if not chunk:
                    break

                buffer += chunk.decode('utf-8', errors='replace')

                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    line = line.strip()
                    if not line:
                        continue

                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    evt_type = event.get('type', '')

                    if evt_type == 'assistant':
                        msg = event.get('message', {})
                        for block in msg.get('content', []):
                            if isinstance(block, dict):
                                if block.get('type') == 'text':
                                    text = block.get('text', '')
                                    if text:
                                        full_text += text
                                        if on_text:
                                            await on_text(text)
                                elif block.get('type') == 'tool_use':
                                    if on_tool_start:
                                        await on_tool_start(
                                            block.get('name', ''),
                                            block.get('input', {}),
                                        )

                    elif evt_type == 'tool_result':
                        content = event.get('content', '')
                        if on_tool_result and content:
                            await on_tool_result('tool', content)

                    elif evt_type == 'result':
                        result_text = event.get('result', '')
                        if result_text and not full_text:
                            full_text = result_text
                            if on_text:
                                await on_text(result_text)

        except asyncio.CancelledError:
            cancelled = True
            raise

        finally:
            # Cleanup
            async with self._lock:
                self.processes.pop(session_id, None)
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
                await process.wait()

        if cancelled and not full_text:
            full_text = "[Stopped]"

        # If nothing was streamed, check stderr
        if not full_text:
            stderr = await process.stderr.read()
            if stderr:
                err_text = stderr.decode('utf-8', errors='replace')
                if on_text:
                    await on_text(f"[CLI Error: {err_text[:500]}]")
                full_text = err_text

        return full_text
