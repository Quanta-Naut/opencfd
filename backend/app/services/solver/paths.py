"""Where OpenCFD writes OpenFOAM run directories.

One case directory per project. Kept separate from the project store
(~/.OpenCFD/projects) so a case can be wiped and rebuilt without touching
saved project state.

On Windows the solver runs inside a managed WSL2 distro (see
app.services.setup), and every read/write the solver does against a
Windows-native path crosses the WSL/Windows filesystem bridge - measurably
slower than either side reading its own native disk, especially for the
many small files an OpenFOAM case writes per timestep. The "case_storage"
setting (app.services.settings_service) lets the case live inside that
distro's own filesystem instead, addressed from this native Windows process
via its \\\\wsl.localhost UNC path - fast for the solver, at the cost of not
being directly browsable from Windows Explorer. Defaults to that fast path;
a user who wants to poke at case files with native Windows tools can opt
back into the Windows-native location in Preferences.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

CASES_ROOT = Path.home() / ".OpenCFD" / "cases"


def _safe(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", (name or "").strip()).strip("-").lower()
    return slug or "scratch"


def _wsl_case_root() -> Path | None:
    """The managed WSL distro's own filesystem, addressed from Windows.

    The distro is imported via `wsl --import` with no user configured (see
    app.services.setup.provision), so root is its default and only user.
    """
    from app.services.setup import DISTRO_NAME

    return Path(f"\\\\wsl.localhost\\{DISTRO_NAME}\\root\\.opencfd\\cases")


def resolve_case_dir(project_id: str | None, *, create: bool = True) -> Path:
    safe_id = _safe(project_id or "scratch")
    path = CASES_ROOT / safe_id

    if os.name == "nt":
        from app.services.settings_service import get_settings

        if get_settings().get("case_storage") == "wsl":
            wsl_root = _wsl_case_root()
            if wsl_root is not None:
                path = wsl_root / safe_id

    if create:
        try:
            path.mkdir(parents=True, exist_ok=True)
        except OSError:
            # The managed distro is not up yet, or the UNC path is not
            # reachable for some other reason - fall back to the
            # Windows-native path rather than crash; slower, but usable.
            path = CASES_ROOT / safe_id
            path.mkdir(parents=True, exist_ok=True)
    return path
