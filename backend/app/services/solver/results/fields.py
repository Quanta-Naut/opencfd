"""Per-node result fields for the Results tab, and the cheap per-cell live preview."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional
import numpy as np
from .foamio import ResultsUnavailable, _read_field, _resolve_time_dir, _time_dirs
from .geometry import _cell_centres, _elem_centroids, _nearest, _node_averager, _node_vorticity, _smooth_nodes, _tri_index
from .streamlines import _streamlines_numpy


def _assemble_from_cells(nodes, elements: List, centres: np.ndarray,
                         U: np.ndarray, p: np.ndarray,
                         k: Optional[np.ndarray], omega: Optional[np.ndarray],
                         time_name: str, times: List[str],
                         geom_key: Optional[tuple] = None) -> Dict:
    """Turn raw per-cell OpenFOAM fields into the smooth per-node viewer payload."""
    nodes_xy = np.asarray(nodes, dtype=float)[:, :2]
    nn = len(nodes_xy)
    U = np.atleast_2d(np.asarray(U, dtype=float))
    if U.shape[1] < 2:
        U = np.column_stack([U.ravel(), np.zeros(len(U))])
    tris = _tri_index(elements)
    centres = np.asarray(centres, dtype=float)
    bind = _node_averager(nodes_xy, elements, centres, geom_key) if elements else None

    def field(cv: np.ndarray, smooth: int = 1) -> np.ndarray:
        cv = np.asarray(cv, dtype=float).ravel()
        if bind is None:
            v = cv[np.clip(_nearest(nodes_xy, centres), 0, len(cv) - 1)]
        else:
            v = bind(cv)
        return _smooth_nodes(nodes_xy, tris, v, iters=smooth)

    umag = field(np.linalg.norm(U[:, :2], axis=1))
    pn = field(np.asarray(p, dtype=float).ravel())
    kn = field(np.asarray(k, dtype=float).ravel()) if k is not None else np.zeros(nn)
    on = field(np.asarray(omega, dtype=float).ravel()) if omega is not None else np.zeros(nn)

    node_u = np.column_stack([field(U[:, 0]), field(U[:, 1])])
    # vorticity is noisy on a coarse/marginal mesh - smooth it a touch harder
    vort = _smooth_nodes(nodes_xy, tris, _node_vorticity(nodes_xy, tris, node_u), iters=2)
    streamlines = _streamlines_numpy(np.asarray(centres, dtype=float), U[:, :2], nodes_xy)

    def rng(a: np.ndarray, symmetric: bool = False) -> List[float]:
        """Robust display range: clip the percentile tails so one near-wall
        spike or an early-timestep transient blip doesn't wash the whole colour
        map to a single shade. Signed fields (vorticity) get a symmetric range
        about zero, the way ParaView presents curl - and a tighter clip, since
        curl is very heavy-tailed near walls."""
        a = np.asarray(a, dtype=float)
        a = a[np.isfinite(a)]
        if a.size == 0:
            return [0.0, 1.0]
        if symmetric:
            mag = np.abs(a)
            # clip to whichever is smaller: the 80th pct, or 6x the median -
            # keeps the shear layers saturated instead of a single flat tone.
            q = float(min(np.percentile(mag, 80.0), 6.0 * (np.median(mag) or np.percentile(mag, 80.0))))
            if q < 1e-9:
                q = float(np.max(mag)) or 1.0
            return [round(-q, 4), round(q, 4)]
        lo, hi = np.percentile(a, [1.0, 99.0])
        if hi - lo < 1e-9:
            lo, hi = float(np.min(a)), float(np.max(a))
        if hi - lo < 1e-9:
            hi = lo + 1.0
        return [round(float(lo), 4), round(float(hi), 4)]

    return {
        "time": time_name,
        "availableTimes": times,
        "source": "openfoam",
        "reader": "numpy",
        "fields": {
            "U_mag": [round(float(v), 4) for v in umag],
            "p": [round(float(v), 3) for v in pn],
            "k": [round(float(v), 5) for v in kn],
            "omega": [round(float(v), 3) for v in on],
            "vorticity": [round(float(v), 4) for v in vort],
        },
        "ranges": {
            "U_mag": rng(umag), "p": rng(pn), "k": rng(kn),
            "omega": rng(on), "vorticity": rng(vort, symmetric=True),
        },
        "streamlines": streamlines,
    }


def read_field_results(case_dir: str | Path, mesh: Dict, time_value: Optional[str] = None) -> Optional[Dict]:
    case = Path(case_dir)
    if not case.is_dir():
        raise ResultsUnavailable("no case directory - the solver has not run for this project")
    times = _time_dirs(case)
    tdir = _resolve_time_dir(times, time_value, case)
    if tdir is None:
        raise ResultsUnavailable(
            "no written time directory - has the solver run for this project?"
        )

    U = _read_field(tdir / "U")
    p = _read_field(tdir / "p")
    if U is None or p is None:
        raise ResultsUnavailable(
            f"no U/p fields in {tdir.name}/ - solver may have diverged or not written output"
        )

    nodes = np.asarray(mesh.get("nodes") or [], dtype=float)
    if nodes.size == 0:
        raise ResultsUnavailable("no mesh nodes supplied")

    n_cells = len(np.atleast_2d(U))
    centres = _cell_centres(tdir, mesh, n_cells)
    elements = mesh.get("elements") or []
    owner = tdir.parent / "constant" / "polyMesh" / "owner"
    geom_key = (
        (str(case), n_cells, len(nodes), len(elements), owner.stat().st_mtime)
        if owner.is_file() else None
    )
    return _assemble_from_cells(
        nodes, elements, centres, U, p,
        _read_field(tdir / "k"), _read_field(tdir / "omega"),
        tdir.name, [path.name for _, path in times], geom_key,
    )


_PREVIEW_BIND_CACHE: Dict[tuple, np.ndarray] = {}


def read_field_preview(case_dir: str | Path, mesh: Dict,
                       time_value: Optional[str] = None) -> Optional[Dict]:
    """Fast **cell-based** field for the live solver preview: one value per viewer
    element (its nearest OpenFOAM cell), raw - no interpolation, no smoothing,
    no streamlines. Returns None (never raises) when there is nothing to show."""
    try:
        case = Path(case_dir)
        if not case.is_dir():
            return None
        times = _time_dirs(case)
        tdir = _resolve_time_dir(times, time_value, case)
        if tdir is None:
            return None
        U = _read_field(tdir / "U")
        p = _read_field(tdir / "p")
        if U is None or p is None:
            return None
        nodes = np.asarray(mesh.get("nodes") or [], dtype=float)
        elements = mesh.get("elements") or []
        if nodes.size == 0 or not elements:
            return None

        U = np.atleast_2d(np.asarray(U, dtype=float))
        n_cells = len(U)
        centres = np.asarray(_cell_centres(tdir, mesh, n_cells), dtype=float)

        owner = tdir.parent / "constant" / "polyMesh" / "owner"
        key = (str(case), n_cells, len(nodes), len(elements),
               owner.stat().st_mtime if owner.is_file() else 0)
        cell_of_elem = _PREVIEW_BIND_CACHE.get(key)
        if cell_of_elem is None:
            ec = _elem_centroids(nodes[:, :2], elements)
            cell_of_elem = np.clip(_nearest(ec, centres), 0, n_cells - 1)
            if len(_PREVIEW_BIND_CACHE) > 6:
                _PREVIEW_BIND_CACHE.clear()
            _PREVIEW_BIND_CACHE[key] = cell_of_elem

        def rng(a: np.ndarray) -> List[float]:
            a = a[np.isfinite(a)]
            if a.size == 0:
                return [0.0, 1.0]
            lo, hi = np.percentile(a, [2.0, 98.0])
            if hi - lo < 1e-9:
                lo, hi = float(np.min(a)), float(np.max(a))
            if hi - lo < 1e-9:
                hi = lo + 1.0
            return [round(float(lo), 4), round(float(hi), 4)]

        umag = np.linalg.norm(U[:, :2], axis=1)[cell_of_elem]
        pv = np.asarray(p, dtype=float).ravel()[cell_of_elem]
        fields = {"U_mag": [round(float(v), 3) for v in umag],
                  "p": [round(float(v), 2) for v in pv]}
        ranges = {"U_mag": rng(umag), "p": rng(pv)}
        for name, dec in (("k", 4), ("omega", 1)):
            f = _read_field(tdir / name)
            if f is not None:
                vals = np.asarray(f, dtype=float).ravel()[cell_of_elem]
                fields[name] = [round(float(v), dec) for v in vals]
                ranges[name] = rng(vals)

        return {"time": tdir.name, "fields": fields, "ranges": ranges}
    except Exception:  # noqa: BLE001 - a preview never breaks the solve stream
        return None
