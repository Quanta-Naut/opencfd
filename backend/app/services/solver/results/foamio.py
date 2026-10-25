"""Reading OpenFOAM case output: field files and time directories."""

from __future__ import annotations

import re
from pathlib import Path
from typing import List, Optional
import numpy as np


_NONUNIFORM = re.compile(r"internalField\s+nonuniform\s+List<(scalar|vector)>\s*\n?\s*(\d+)\s*\(", re.S)


_UNIFORM = re.compile(r"internalField\s+uniform\s+(\([^)]*\)|\S+)\s*;", re.S)


def _matching_paren(text: str, open_idx: int) -> int:
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i
    return len(text)


def _read_field(path: Path) -> Optional[np.ndarray]:
    """Return an (N,) scalar or (N,3) vector array from an OpenFOAM field file."""
    if not path.is_file():
        return None
    text = path.read_text(encoding='utf-8', errors='ignore')

    m = _NONUNIFORM.search(text)
    if m:
        kind, n = m.group(1), int(m.group(2))
        open_idx = m.end() - 1  # the '(' captured at the end of the regex
        close = _matching_paren(text, open_idx)
        chunk = text[open_idx + 1:close]
        nums = np.fromstring(chunk.replace("(", " ").replace(")", " "), sep=" ")
        # A file cut short (run stopped mid-write) must not pass for a result.
        if nums.size < n * (3 if kind == "vector" else 1):
            return None
        if kind == "vector":
            return nums.reshape(-1, 3)[:n]
        return nums[:n]

    u = _UNIFORM.search(text)
    if u:
        val = u.group(1).strip("() ").split()
        arr = np.array([float(v) for v in val], dtype=float)
        return arr if arr.size != 1 else np.full(1, arr[0])
    return None


_NCELLS = re.compile(r"nCells:\s*(\d+)")
_DECLARED = re.compile(r"internalField\s+nonuniform\s+List<\w+>\s*(\d+)")


def _mesh_cells(case: Path) -> Optional[int]:
    """Cell count of constant/polyMesh, from the header note of its owner file."""
    try:
        with open(case / "constant" / "polyMesh" / "owner", "rb") as fh:
            m = _NCELLS.search(fh.read(2048).decode("ascii", "ignore"))
        return int(m.group(1)) if m else None
    except OSError:
        return None


def _matches_mesh(tdir: Path, n_cells: Optional[int]) -> bool:
    """False for a time folder whose fields were written for a different mesh
    (left over from an older run), so it never gets read as this run's result."""
    if not n_cells:
        return True
    try:
        with open(tdir / "U", "rb") as fh:
            m = _DECLARED.search(fh.read(8192).decode("ascii", "ignore"))
    except OSError:
        return True
    return m is None or int(m.group(1)) == n_cells


def _time_dirs(case: Path) -> List[tuple[float, Path]]:
    times = []
    n_cells = _mesh_cells(case)
    for p in case.iterdir():
        if p.is_dir():
            try:
                t = float(p.name)
            except ValueError:
                continue
            if _matches_mesh(p, n_cells):
                times.append((t, p))
    times.sort(key=lambda t: t[0])
    return times


def _latest_time_dir(case: Path) -> Optional[Path]:
    times = _time_dirs(case)
    if not times:
        return None
    # skip 0/ if there is a later result
    latest = times[-1]
    return latest[1] if latest[0] > 0 or len(times) == 1 else None


class ResultsUnavailable(Exception):
    pass


def _resolve_time_dir(times: List, time_value: Optional[str], case: Path) -> Optional[Path]:
    if time_value is None:
        return _latest_time_dir(case)
    # exact directory-name match first (handles odd float formatting)
    exact = next((path for _, path in times if path.name == str(time_value)), None)
    if exact is not None:
        return exact
    try:
        req_t = float(time_value)
    except (TypeError, ValueError):
        return None
    # otherwise snap to the nearest written time - the viewer's slider values
    # are re-derived numbers and won't always land on the dir name to 1e-4.
    candidates = [t for t in times if t[1].name != "0"] or list(times)
    if not candidates:
        return None
    return min(candidates, key=lambda t: abs(t[0] - req_t))[1]
