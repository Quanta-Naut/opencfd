"""Where OpenCFD writes OpenFOAM run directories.

One case directory per project under ~/.OpenCFD/cases/<project>. Kept separate
from the project store (~/.OpenCFD/projects) so a case can be wiped and rebuilt
without touching saved project state.
"""
from __future__ import annotations

import re
from pathlib import Path

CASES_ROOT = Path.home() / ".OpenCFD" / "cases"


def _safe(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", (name or "").strip()).strip("-").lower()
    return slug or "scratch"


def resolve_case_dir(project_id: str | None, *, create: bool = True) -> Path:
    path = CASES_ROOT / _safe(project_id or "scratch")
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path
