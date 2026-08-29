"""Shared WSL detection helpers.

`wsl.exe` writes its list output as UTF-16LE and, when no distro is installed,
prints a multi-line help message to the same stream. Parse defensively: a real
row is `NAME  STATE  VERSION` with VERSION in {1, 2}.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from typing import List, Tuple

_STATES = {"Running", "Stopped", "Installing", "Uninstalling", "Converting"}


def wsl_present() -> bool:
    return os.name == "nt" and shutil.which("wsl.exe") is not None


def _decode(raw: bytes) -> str:
    for enc in ("utf-16-le", "utf-8", "mbcs"):
        try:
            text = raw.decode(enc, errors="ignore")
            if text.strip():
                return text
        except (LookupError, ValueError):
            continue
    return ""


def list_distros() -> Tuple[List[str], bool]:
    """(distro names, any distro on version 2). Empty list is normal - the app
    imports its own distro."""
    if not wsl_present():
        return [], False
    try:
        proc = subprocess.run(
            ["wsl.exe", "--list", "--verbose"], capture_output=True, timeout=20
        )
    except Exception:  # noqa: BLE001
        return [], False

    text = _decode(proc.stdout)
    if "no installed distributions" in text.lower():
        return [], False

    names: List[str] = []
    any_v2 = False
    for line in text.splitlines():
        row = line.strip().lstrip("*").strip()
        if not row:
            continue
        parts = row.split()
        if len(parts) >= 3 and parts[-1] in ("1", "2") and parts[-2] in _STATES:
            names.append(parts[0])
            if parts[-1] == "2":
                any_v2 = True
    return names, any_v2


def wsl_status_line() -> str:
    if not wsl_present():
        return ""
    try:
        proc = subprocess.run(["wsl.exe", "--status"], capture_output=True, timeout=20)
        return _decode(proc.stdout).strip()
    except Exception:  # noqa: BLE001
        return ""
