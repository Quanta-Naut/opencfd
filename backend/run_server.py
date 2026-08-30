"""Production entrypoint for the bundled backend sidecar.

Runs uvicorn in-process (no CLI, no --reload) so PyInstaller has a single static
import graph. The Tauri shell spawns the frozen build of this file.

A watchdog exits the process if the parent (the Tauri app) goes away, so a
closed or crashed app never leaves opencfd-backend.exe running and blocking the
next install.
"""
from __future__ import annotations

import os
import threading
import time

import uvicorn

from app.main import app


def _parent_alive(ppid: int) -> bool:
    if os.name == "nt":
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        k32 = ctypes.windll.kernel32
        handle = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, ppid)
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            if not k32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return False
            return code.value == STILL_ACTIVE
        finally:
            k32.CloseHandle(handle)
    try:
        os.kill(ppid, 0)
        return True
    except OSError:
        return False


def _watch_parent(ppid: int) -> None:
    while True:
        time.sleep(2)
        if not _parent_alive(ppid):
            os._exit(0)


if __name__ == "__main__":
    ppid = os.getppid()
    if ppid > 1:
        threading.Thread(target=_watch_parent, args=(ppid,), daemon=True).start()

    port = int(os.environ.get("OPENCFD_BACKEND_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info", workers=1)
