"""Start both loopback services and stop them together with Ctrl+C."""
import os
import argparse
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parent.parent
os.chdir(root)
parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=3002)
port = parser.parse_args().port
if not 1024 <= port <= 65535:
    sys.exit('Choose a port between 1024 and 65535.')
if not (root/'.local-models/flux2-klein-4b-4bit/.download-complete').exists():
    sys.exit('Run npm run local:setup to install the local model first.')
with socket.socket() as sock:
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try: sock.bind(('127.0.0.1', 8765))
    except OSError: sys.exit('Port 8765 is occupied. Stop the previous local editor before restarting.')
children = []
def stop(*_):
    for child in children:
        if child.poll() is None: os.killpg(child.pid, signal.SIGTERM)
    for child in children:
        try: child.wait(timeout=10)
        except subprocess.TimeoutExpired: os.killpg(child.pid, signal.SIGKILL)
    sys.exit(0)
signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
try:
    children.append(subprocess.Popen([sys.executable, '-m', 'uvicorn', 'server:app', '--app-dir', 'local-runtime', '--host', '127.0.0.1', '--port', '8765'], start_new_session=True))
    children.append(subprocess.Popen(['npm', 'run', 'dev', '--', '--hostname', '127.0.0.1', '--port', str(port)], start_new_session=True))
    print(f'\nLocal studio: http://127.0.0.1:{port} · Editor: http://127.0.0.1:8765\nPhotos and generated images are stored only in local-runtime/jobs. Ctrl+C stops both services.\n', flush=True)
    while all(child.poll() is None for child in children): time.sleep(.5)
finally: stop()
