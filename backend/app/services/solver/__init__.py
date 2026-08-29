"""Solver backends for OpenCFD.

`detect_environment()` reports what is usable on this machine; `select_adapter()`
turns a requested mode into a concrete adapter.

Modes:
    "auto"  - real OpenFOAM if available (local, then WSL), else the mock
    "real"  - force a real adapter (errors surface if it is not usable)
    "mock"  - always the built-in mock
"""
from __future__ import annotations

import os
import platform
from typing import Any, Dict

from app.services.wsl import distro_alive, raw_list
from .base import SolverAdapter
from .mock import MockAdapter
from .openfoam import LocalOpenFoam, WslOpenFoam, wsl_distros, wsl_present
from .paths import resolve_case_dir

# The private distro the Windows installer provisions (see app.services.setup).
MANAGED_DISTRO = "OpenCFD-FOAM"

__all__ = [
    "SolverAdapter",
    "MockAdapter",
    "detect_environment",
    "select_adapter",
    "resolve_case_dir",
]


def _foam_bashrc() -> str | None:
    return os.environ.get("OPENCFD_FOAM_BASHRC") or None


_ON_WINDOWS = os.name == "nt"


def detect_environment() -> Dict[str, Any]:
    system = platform.system()
    env: Dict[str, Any] = {"platform": system, "adapters": {}}

    env["adapters"]["mock"] = {"ok": True, "detail": "Built-in mock solver."}

    # On Windows the only real path is WSL (LocalOpenFoam has no path translation).
    if not _ON_WINDOWS:
        local = LocalOpenFoam(foam_bashrc=_foam_bashrc())
        env["adapters"]["openfoam-local"] = local.available()

    if wsl_present():
        distros = wsl_distros()
        # Trust a direct probe of the managed distro over list parsing (wsl.exe
        # list output is fussy and localised).
        managed_alive = distro_alive(MANAGED_DISTRO)
        chosen = (
            MANAGED_DISTRO if (managed_alive or MANAGED_DISTRO in distros)
            else (distros[0] if distros else None)
        )
        wsl = WslOpenFoam(distro=chosen, foam_bashrc=_foam_bashrc())
        info = wsl.available() if chosen else {"ok": False, "detail": "no WSL distro found"}
        info["distros"] = distros
        info["distro"] = chosen
        info["managed"] = chosen == MANAGED_DISTRO
        info["managed_alive"] = managed_alive
        info["raw_list"] = raw_list()[-600:]
        env["adapters"]["openfoam-wsl"] = info
    elif system == "Windows":
        env["adapters"]["openfoam-wsl"] = {
            "ok": False,
            "detail": "WSL2 is not installed. Run `wsl --install`, reboot, then restart OpenCFD.",
            "distros": [],
        }

    if env["adapters"].get("openfoam-local", {}).get("ok"):
        env["active"] = "openfoam-local"
    elif env["adapters"].get("openfoam-wsl", {}).get("ok"):
        env["active"] = "openfoam-wsl"
    else:
        env["active"] = "mock"
    return env


def select_adapter(mode: str, config: Dict[str, Any] | None = None) -> SolverAdapter:
    config = config or {}
    mode = (mode or "auto").lower()
    if mode == "mock":
        return MockAdapter()

    bashrc = config.get("foamBashrc") or _foam_bashrc()

    if not _ON_WINDOWS:
        local = LocalOpenFoam(foam_bashrc=bashrc)
        if mode in ("auto", "real", "openfoam-local") and local.available().get("ok"):
            return local

    if wsl_present():
        distros = wsl_distros()
        distro = (
            config.get("wslDistro")
            or (MANAGED_DISTRO if (distro_alive(MANAGED_DISTRO) or MANAGED_DISTRO in distros) else None)
            or (distros[0] if distros else None)
        )
        if distro:
            wsl = WslOpenFoam(distro=distro, foam_bashrc=bashrc)
            if mode in ("auto", "real", "openfoam-wsl") and wsl.available().get("ok"):
                return wsl
            if mode in ("real", "openfoam-wsl"):
                return wsl  # let run() surface the real error

    if mode == "real" and not _ON_WINDOWS:
        return LocalOpenFoam(foam_bashrc=bashrc)  # surfaces "not found" via run()
    return MockAdapter()
