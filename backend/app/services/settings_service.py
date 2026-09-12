"""Global app preferences - one small JSON file, not per-project state.

Currently holds a single Windows-only preference: whether an OpenFOAM case
lives on the Windows-native filesystem or inside the managed WSL2 distro's
own filesystem (see app.services.solver.paths.resolve_case_dir). Meaningless
on Linux/macOS, where the solver already runs natively against a native path.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

SETTINGS_FILE = Path.home() / ".OpenCFD" / "settings.json"

DEFAULT_SETTINGS: Dict[str, Any] = {
    # "wsl": case files live inside the managed WSL distro's own filesystem -
    #   fast for the solver, not directly browsable from Windows Explorer.
    # "windows": case files live under the Windows user profile - slower
    #   (every solver read/write crosses the WSL/Windows filesystem bridge),
    #   but visible and editable from Windows tools directly.
    "case_storage": "wsl",
}

_VALID_CASE_STORAGE = {"wsl", "windows"}


def get_settings() -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        data = {}
    merged = {**DEFAULT_SETTINGS, **(data if isinstance(data, dict) else {})}
    if merged.get("case_storage") not in _VALID_CASE_STORAGE:
        merged["case_storage"] = DEFAULT_SETTINGS["case_storage"]
    return merged


def update_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    current = get_settings()
    if "case_storage" in patch:
        value = patch["case_storage"]
        if value not in _VALID_CASE_STORAGE:
            raise ValueError(f"case_storage must be one of {sorted(_VALID_CASE_STORAGE)}, got {value!r}")
        current["case_storage"] = value
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(current, indent=2), encoding="utf-8")
    return current
