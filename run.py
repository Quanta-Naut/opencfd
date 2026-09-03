#!/usr/bin/env python3
"""
OpenCFD Studio Launcher
Starts both the FastAPI Python Scientific Backend and the Frontend / Tauri Desktop app.
"""

import os
import sys
import subprocess
import time
import signal
import argparse

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")

# venv python: Scripts\python.exe on Windows, bin/python3 elsewhere
_venv = os.path.join(BACKEND_DIR, "venv")
PYTHON_EXE = next(
    (p for p in (
        os.path.join(_venv, "Scripts", "python.exe"),
        os.path.join(_venv, "bin", "python3"),
        os.path.join(_venv, "bin", "python"),
    ) if os.path.exists(p)),
    sys.executable,
)

def main():
    parser = argparse.ArgumentParser(description="Launch OpenCFD Studio")
    parser.add_argument("--desktop", action="store_true", help="Launch native Tauri desktop window")
    args = parser.parse_args()

    print("==========================================================")
    print("  🚀 OpenCFD Studio (Tauri + OpenFOAM + Gmsh + NumPy)     ")
    print("==========================================================")

    env = os.environ.copy()
    env["PYTHONPATH"] = BACKEND_DIR
    cargo_bin = os.path.expanduser("~/.cargo/bin")
    if os.path.exists(cargo_bin) and cargo_bin not in env.get("PATH", ""):
        env["PATH"] = f"{cargo_bin}:{env.get('PATH', '')}"

    # 1. Start Python Scientific Backend (FastAPI on port 8000)
    print("[1/2] Starting Python Scientific Backend (Port 8000)...")
    backend_proc = subprocess.Popen(
        [
            PYTHON_EXE,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            "8000",
            "--reload",
        ],
        cwd=BACKEND_DIR,
        env=env,
    )

    # 2. Start Frontend or Tauri Desktop
    if args.desktop:
        print("[2/2] Launching Native Tauri Desktop Application Window...")
        frontend_proc = subprocess.Popen(
            ["npx", "tauri", "dev"],
            cwd=ROOT_DIR,
            env=env,
        )
    else:
        print("[2/2] Starting Vite Frontend UI (Port 5173)...")
        frontend_proc = subprocess.Popen(
            ["npm", "run", "dev", "--", "--port", "5173", "--host"],
            cwd=FRONTEND_DIR,
            env=env,
        )
        print("\n✨ Web Interface running at: http://localhost:5173")
        print("💡 Run with `python run.py --desktop` or `npm run tauri:dev` for the native Tauri window!\n")

    def handle_sigint(sig, frame):
        print("\nShutting down OpenCFD Studio...")
        backend_proc.terminate()
        frontend_proc.terminate()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_sigint)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        handle_sigint(None, None)

if __name__ == "__main__":
    main()
