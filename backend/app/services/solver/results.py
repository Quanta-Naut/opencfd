"""Read a finished OpenFOAM case back into the field shape the viewer expects.

simpleFoam writes cell-centred fields as ASCII lists under `<time>/`. We also ask
`postProcess -func writeCellCentres` for the cell centres (`Cx`, `Cy`), then map
each cell value onto the nearest 2D viewer node. Nearest-cell is good enough for
a plane visualisation at these resolutions.

Output matches services.postprocess_service.generate_field_solution:
    {"fields": {"U_mag": [...per node...], "p": [...], "k": [...],
                "omega": [...], "vorticity": [...]},
     "ranges": {...}, "streamlines": [...]}
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional

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
    text = path.read_text()

    m = _NONUNIFORM.search(text)
    if m:
        kind, n = m.group(1), int(m.group(2))
        open_idx = m.end() - 1  # the '(' captured at the end of the regex
        close = _matching_paren(text, open_idx)
        chunk = text[open_idx + 1:close]
        nums = np.fromstring(chunk.replace("(", " ").replace(")", " "), sep=" ")
        if kind == "vector":
            return nums.reshape(-1, 3)[:n]
        return nums[:n]

    u = _UNIFORM.search(text)
    if u:
        val = u.group(1).strip("() ").split()
        arr = np.array([float(v) for v in val], dtype=float)
        return arr if arr.size != 1 else np.full(1, arr[0])
    return None


def _latest_time_dir(case: Path) -> Optional[Path]:
    times = []
    for p in case.iterdir():
        if p.is_dir():
            try:
                times.append((float(p.name), p))
            except ValueError:
                pass
    if not times:
        return None
    times.sort(key=lambda t: t[0])
    # skip 0/ if there is a later result
    latest = times[-1]
    return latest[1] if latest[0] > 0 or len(times) == 1 else None


class ResultsUnavailable(Exception):
    pass


def _nearest(pts: np.ndarray, ref: np.ndarray, chunk: int = 4096) -> np.ndarray:
    """Index of the nearest row of `ref` for each row of `pts`."""
    out = np.empty(len(pts), dtype=int)
    for s in range(0, len(pts), chunk):
        block = pts[s:s + chunk]
        d = ((block[:, None, :] - ref[None, :, :]) ** 2).sum(axis=2)
        out[s:s + chunk] = d.argmin(axis=1)
    return out


def _cell_centres(tdir: Path, mesh: Dict, n_cells: int) -> np.ndarray:
    """Cell centres: from Cx/Cy (ESI) or Ccx/Ccy (Foundation) if postProcess ran,
    otherwise the mesh element centroids (cell order tracks the .msh element
    order through gmshToFoam)."""
    cx = _read_field(tdir / "Cx") if (tdir / "Cx").is_file() else _read_field(tdir / "Ccx")
    cy = _read_field(tdir / "Cy") if (tdir / "Cy").is_file() else _read_field(tdir / "Ccy")
    if cx is not None and cy is not None:
        return np.column_stack([np.asarray(cx).ravel(), np.asarray(cy).ravel()])

    nodes = np.asarray(mesh.get("nodes") or [], dtype=float)
    elements = mesh.get("elements") or []
    if len(elements) == n_cells and nodes.size:
        return np.array([nodes[[int(i) for i in el], :2].mean(axis=0) for el in elements])
    raise ResultsUnavailable(
        f"no cell-centre data (postProcess did not run) and the mesh "
        f"({len(elements)} cells) does not match the solution ({n_cells} cells)"
    )


def read_field_results(case_dir: str | Path, mesh: Dict) -> Optional[Dict]:
    case = Path(case_dir)
    tdir = _latest_time_dir(case)
    if tdir is None:
        raise ResultsUnavailable("no written time directory - has the solver run for this project?")

    U = _read_field(tdir / "U")
    p = _read_field(tdir / "p")
    if U is None or p is None:
        raise ResultsUnavailable(f"no U/p fields in {tdir.name}/ - solver may have diverged or not written output")

    n_cells = len(np.atleast_2d(U))
    centres = _cell_centres(tdir, mesh, n_cells)
    k = _read_field(tdir / "k")
    omega = _read_field(tdir / "omega")

    nodes = np.asarray(mesh.get("nodes") or [], dtype=float)
    if nodes.size == 0:
        raise ResultsUnavailable("no mesh nodes supplied")

    # nearest cell centre for each viewer node (numpy only, chunked so a large
    # mesh does not allocate an N*M distance matrix at once)
    nn = _nearest(nodes[:, :2], centres)

    umag_c = np.linalg.norm(np.atleast_2d(U)[:, :2], axis=1)
    umag = umag_c[nn]
    pn = np.asarray(p).ravel()[nn]
    kn = np.asarray(k).ravel()[nn] if k is not None else np.zeros(len(nodes))
    on = np.asarray(omega).ravel()[nn] if omega is not None else np.zeros(len(nodes))

    # crude vorticity: gradient of |U| along the node ordering
    vort = np.gradient(umag) if len(umag) > 1 else np.zeros_like(umag)

    def rng(a: np.ndarray) -> List[float]:
        return [round(float(np.min(a)), 4), round(float(np.max(a)), 4)]

    return {
        "time": tdir.name,
        "source": "openfoam",
        "fields": {
            "U_mag": [round(float(v), 4) for v in umag],
            "p": [round(float(v), 3) for v in pn],
            "k": [round(float(v), 5) for v in kn],
            "omega": [round(float(v), 3) for v in on],
            "vorticity": [round(float(v), 4) for v in vort],
        },
        "ranges": {"U_mag": rng(umag), "p": rng(pn), "k": rng(kn), "omega": rng(on)},
        "streamlines": [],
    }
