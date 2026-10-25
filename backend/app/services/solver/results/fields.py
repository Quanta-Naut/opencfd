"""Per-node result fields for the Results tab, and the cheap per-cell live preview."""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Dict, List, Optional
import numpy as np
from .foamio import ResultsUnavailable, _read_field, _resolve_time_dir, _time_dirs
from .geometry import _cell_centres, _elem_centroids, _nearest, _node_averager, _node_vorticity, _smooth_nodes, _tri_index
from .streamlines import _streamlines_numpy
from .walls import force_breakdown, wall_node_fields

_log = logging.getLogger(__name__)


def _assemble_from_cells(nodes, elements: List, centres: np.ndarray,
                         U: np.ndarray, p: np.ndarray,
                         k: Optional[np.ndarray], omega: Optional[np.ndarray],
                         time_name: str, times: List[str],
                         geom_key: Optional[tuple] = None,
                         extra: Optional[Dict[str, np.ndarray]] = None) -> Dict:
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

    out = {
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
            # components, for vectors, probes and the Ux / Uy contours
            "Ux": [round(float(v), 4) for v in node_u[:, 0]],
            "Uy": [round(float(v), 4) for v in node_u[:, 1]],
        },
        "ranges": {
            "U_mag": rng(umag), "p": rng(pn), "k": rng(kn),
            "omega": rng(on), "vorticity": rng(vort, symmetric=True),
            "Ux": rng(node_u[:, 0]), "Uy": rng(node_u[:, 1]),
        },
        "streamlines": streamlines,
    }
    # Fields only some runs write (T, nut, Mach): per cell, one per mesh cell.
    for name, cv in (extra or {}).items():
        cv = np.asarray(cv, dtype=float).ravel()
        if cv.size == 1:
            cv = np.full(len(centres), cv[0])
        if cv.size != len(centres):
            continue
        vals = field(cv)
        out["fields"][name] = [float(f"{v:.5g}") for v in vals]
        out["ranges"][name] = [float(f"{v:.5g}") for v in rng(vals)]
    return out


def _gas_constants(case: Path) -> Optional[tuple]:
    """(gamma, R) of a compressible run's perfect gas, from physicalProperties."""
    path = case / "constant" / "physicalProperties"
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8", errors="ignore")
    mw = re.search(r"\bmolWeight\s+([\d.eE+-]+);", text)
    cp = re.search(r"\bCp\s+([\d.eE+-]+);", text)
    if not mw or not cp:
        return None
    R = 8314.47 / float(mw.group(1))
    Cp = float(cp.group(1))
    return (Cp / (Cp - R), R) if Cp > R else None


def _extra_cell_fields(case: Path, tdir: Path, U: np.ndarray) -> Dict[str, np.ndarray]:
    """Temperature, turbulent viscosity and Mach number, when the run has them."""
    out: Dict[str, np.ndarray] = {}
    for name in ("T", "nut"):
        f = _read_field(tdir / name)
        if f is not None:
            out[name] = np.asarray(f, dtype=float).ravel()
    gas = _gas_constants(case) if "T" in out else None
    if gas is not None:
        gamma, R = gas
        U = np.atleast_2d(np.asarray(U, dtype=float))
        speed = np.linalg.norm(U[:, :2], axis=1)
        T = out["T"] if out["T"].size == len(speed) else np.full(len(speed), out["T"][0])
        out["Ma"] = speed / np.sqrt(gamma * R * np.maximum(T, 1e-6))
    return out


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
    if n_cells == 1 or np.size(p) == 1:
        raise ResultsUnavailable(
            f"{tdir.name}/ holds only the initial uniform fields; the solver stopped "
            "before writing a result, see the Console for why"
        )
    if np.size(p) != n_cells:
        raise ResultsUnavailable(
            f"U has {n_cells} cells but p has {np.size(p)} in {tdir.name}/; "
            "the case was written by a different mesh, run again"
        )
    centres = _cell_centres(tdir, mesh, n_cells)
    elements = mesh.get("elements") or []
    owner = tdir.parent / "constant" / "polyMesh" / "owner"
    geom_key = (
        (str(case), n_cells, len(nodes), len(elements), owner.stat().st_mtime)
        if owner.is_file() else None
    )
    payload = _assemble_from_cells(
        nodes, elements, centres, U, p,
        _read_field(tdir / "k"), _read_field(tdir / "omega"),
        tdir.name, [path.name for _, path in times], geom_key,
        _extra_cell_fields(case, tdir, U),
    )
    # Wall y+ and shear (on wall nodes, 0 elsewhere) and the force split,
    # when the run's function objects wrote them.
    try:
        walls = wall_node_fields(case, tdir, nodes[:, :2], mesh.get("boundaries") or {})
        for name, vals in walls.items():
            payload["fields"][name] = [round(float(v), 5) for v in vals]
            on = vals[vals != 0]
            payload["ranges"][name] = (
                [round(float(on.min()), 5), round(float(on.max()), 5)] if on.size else [0.0, 1.0]
            )
        forces = force_breakdown(case, tdir.name)
        if forces:
            payload["forces"] = forces
    except Exception:  # extras only: never lose the main result over them
        _log.warning("could not read wall quantities from %s", tdir, exc_info=True)
    return payload


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
