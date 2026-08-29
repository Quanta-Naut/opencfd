"""Production entrypoint for the bundled backend sidecar.

Runs uvicorn in-process (no CLI, no --reload) so PyInstaller has a single static
import graph. The Tauri shell spawns the frozen build of this file.
"""
from __future__ import annotations

import os

import uvicorn

from app.main import app

if __name__ == "__main__":
    port = int(os.environ.get("OPENCFD_BACKEND_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info", workers=1)
