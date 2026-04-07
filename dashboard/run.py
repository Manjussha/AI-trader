"""
Entry point — starts the Node bridge (if not running) and the dashboard.
Usage: python dashboard/run.py
"""
import os
import sys
import subprocess
import signal
import socket

BRIDGE_PORT = 3001
DASHBOARD_PORT = 8000
bridge_proc = None


def start_bridge():
    """Start the Node.js bridge as a subprocess."""
    global bridge_proc
    project_dir = os.path.join(os.path.dirname(__file__), '..')
    bridge_path = os.path.join(project_dir, 'node-bridge.mjs')

    if not os.path.exists(bridge_path):
        print(f"ERROR: {bridge_path} not found")
        sys.exit(1)

    print(f"Starting Node bridge on port {BRIDGE_PORT}...")
    bridge_proc = subprocess.Popen(
        ['node', bridge_path],
        cwd=project_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    # Read bridge output in background
    import threading
    def read_output():
        for line in bridge_proc.stdout:
            print(f"[bridge] {line.decode().rstrip()}")
    threading.Thread(target=read_output, daemon=True).start()


def cleanup(signum=None, frame=None):
    global bridge_proc
    if bridge_proc:
        print("\nStopping Node bridge...")
        bridge_proc.terminate()
        bridge_proc = None
    sys.exit(0)


signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)


def main():
    # Check if bridge is already running
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    bridge_running = sock.connect_ex(('localhost', BRIDGE_PORT)) == 0
    sock.close()

    if not bridge_running:
        start_bridge()
    else:
        print(f"Node bridge already running on port {BRIDGE_PORT}")

    # Check Claude Code CLI
    claude_cmd = 'claude.cmd' if sys.platform == 'win32' else 'claude'
    try:
        result = subprocess.run([claude_cmd, '--version'], capture_output=True, text=True, timeout=5, shell=True)
        if result.returncode == 0:
            print(f"Claude Code CLI: {result.stdout.strip()}")
        else:
            print("WARNING: 'claude' CLI not working properly")
    except FileNotFoundError:
        print("ERROR: 'claude' CLI not found. Install Claude Code first.")
        sys.exit(1)

    # Ensure we're in the project root so 'dashboard' is importable
    project_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    os.chdir(project_dir)
    if project_dir not in sys.path:
        sys.path.insert(0, project_dir)

    print(f"\nDashboard: http://localhost:{DASHBOARD_PORT}")
    print("Press Ctrl+C to stop\n")

    import uvicorn
    uvicorn.run(
        "dashboard.app:app",
        host="0.0.0.0",
        port=DASHBOARD_PORT,
        log_level="info",
    )


if __name__ == "__main__":
    main()
