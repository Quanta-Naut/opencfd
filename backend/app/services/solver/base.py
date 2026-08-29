"""SolverAdapter: the seam between OpenCFD and whatever actually runs the solve.

Every adapter yields the same event dicts the /ws/solver stream already sends:
    {"type": "log",      "line": str}
    {"type": "residual", "data": {"iteration": int, "p": float, "Ux": float, ...}}
    {"type": "status",   "status": "completed", "iterations": int}
    {"type": "error",    "message": str}
"""
from __future__ import annotations

import abc
from typing import Any, AsyncGenerator, Dict


class SolverAdapter(abc.ABC):
    name: str = "base"

    @abc.abstractmethod
    def available(self) -> Dict[str, Any]:
        """{"ok": bool, "detail": str, ...diagnostics}. Cheap, safe to call often."""

    @abc.abstractmethod
    def run(
        self, case_dir: str, config: Dict[str, Any]
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Async generator of event dicts (see module docstring)."""
        raise NotImplementedError
