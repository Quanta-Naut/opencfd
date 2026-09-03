"""Read a finished OpenFOAM case back into the field shape the viewer expects.

simpleFoam / pimpleFoam write cell-centred fields as ASCII lists under `<time>/`.
We also ask `postProcess -func writeCellCentres` for the cell centres (`Cx`, `Cy`),
then interpolate each cell value onto the 2D viewer mesh.

It is pure NumPy (`_assemble_from_cells`): bind each viewer element to its
OpenFOAM cell, average onto nodes the way VTK's cellDataToPointData does, and
integrate streamlines on a rasterised velocity grid. No VTK/PyVista - the only
heavy dependency is numpy, so the packaged app and the dev build run the same
code and render identically.

Output matches services.postprocess_service.generate_field_solution:
    {"fields": {"U_mag": [...per node...], "p": [...], "k": [...],
                "omega": [...], "vorticity": [...]},
     "ranges": {...}, "streamlines": [...], "reader": "numpy"}
"""
from __future__ import annotations

import math
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


def _time_dirs(case: Path) -> List[tuple[float, Path]]:
    times = []
    for p in case.iterdir():
        if p.is_dir():
            try:
                times.append((float(p.name), p))
            except ValueError:
                pass
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


def _nearest(pts: np.ndarray, ref: np.ndarray, chunk: int = 4096) -> np.ndarray:
    """Index of the nearest row of `ref` for each row of `pts`."""
    out = np.empty(len(pts), dtype=int)
    for s in range(0, len(pts), chunk):
        block = pts[s:s + chunk]
        d = ((block[:, None, :] - ref[None, :, :]) ** 2).sum(axis=2)
        out[s:s + chunk] = d.argmin(axis=1)
    return out


_POLYMESH_CACHE: Dict[tuple, np.ndarray] = {}


def _cell_centres(tdir: Path, mesh: Dict, n_cells: int) -> np.ndarray:
    """Cell centres: from Cx/Cy (ESI) or Ccx/Ccy (Foundation) if postProcess ran,
    or reconstructed from constant/polyMesh geometry, otherwise the mesh element centroids."""
    cx = _read_field(tdir / "Cx") if (tdir / "Cx").is_file() else _read_field(tdir / "Ccx")
    cy = _read_field(tdir / "Cy") if (tdir / "Cy").is_file() else _read_field(tdir / "Ccy")
    if cx is not None and cy is not None:
        return np.column_stack([np.asarray(cx).ravel(), np.asarray(cy).ravel()])

    # Try polyMesh reconstruction from constant/polyMesh. The mesh is static over a
    # run, so cache the reconstruction - transient scrubbing hits this on every
    # non-latest frame otherwise.
    case_dir = tdir.parent
    poly_pts_f = case_dir / "constant" / "polyMesh" / "points"
    poly_faces_f = case_dir / "constant" / "polyMesh" / "faces"
    poly_owner_f = case_dir / "constant" / "polyMesh" / "owner"

    if poly_pts_f.is_file() and poly_faces_f.is_file() and poly_owner_f.is_file():
        ckey = (str(poly_owner_f), poly_owner_f.stat().st_mtime, n_cells)
        if ckey in _POLYMESH_CACHE:
            return _POLYMESH_CACHE[ckey]
        try:
            owner_text = poly_owner_f.read_text()
            m_owner = re.search(r'\n(\d+)\s*\n\(', owner_text)
            if m_owner:
                owner = np.fromstring(owner_text[m_owner.end():owner_text.rfind(')')], dtype=int, sep='\n')
                pts_text = poly_pts_f.read_text()
                m_pts = re.search(r'\n(\d+)\s*\n\(', pts_text)
                if m_pts:
                    pts = np.fromstring(pts_text[m_pts.end():pts_text.rfind(')')].replace('(', ' ').replace(')', ' '), sep=' ').reshape(-1, 3)
                    faces_text = poly_faces_f.read_text()
                    face_lines = re.findall(r'\((\d+(?:\s+\d+)+)\)', faces_text[faces_text.find('(')+1:faces_text.rfind(')')])
                    face_nodes = [[int(x) for x in l.split()] for l in face_lines]
                    face_centres = np.array([pts[fn].mean(axis=0) for fn in face_nodes])
                    num_c = int(owner.max()) + 1
                    cell_centres = np.zeros((num_c, 2))
                    cell_counts = np.zeros(num_c)
                    for f_idx, cell_idx in enumerate(owner):
                        cell_centres[cell_idx] += face_centres[f_idx][:2]
                        cell_counts[cell_idx] += 1
                    cell_centres /= np.maximum(cell_counts[:, None], 1)
                    if len(cell_centres) == n_cells:
                        _POLYMESH_CACHE[ckey] = cell_centres
                        return cell_centres
        except Exception:
            pass

    nodes = np.asarray(mesh.get("nodes") or [], dtype=float)
    elements = mesh.get("elements") or []
    if len(elements) == n_cells and nodes.size:
        return np.array([nodes[[int(i) for i in el], :2].mean(axis=0) for el in elements])

    # If elements count is half or double (extrusion) or approximate, compute average centroids
    if nodes.size:
        # Fallback to evenly sampled node positions
        idx = np.linspace(0, len(nodes) - 1, n_cells, dtype=int)
        return nodes[idx, :2]

    raise ResultsUnavailable(
        f"no cell-centre data available for {n_cells} cells"
    )


# ---------------------------------------------------------------------------
# Pure-NumPy cell -> node interpolation, streamlines and vorticity - the whole
# post-processing pipeline, matching a VTK probe's smooth output without VTK.
# ---------------------------------------------------------------------------

def _tri_index(elements: List) -> np.ndarray:
    """Fan-triangulate mixed tri/quad viewer elements -> (Ntri, 3) node indices."""
    tris: List = []
    for el in elements:
        idx = [int(i) for i in el]
        for k in range(1, len(idx) - 1):
            tris.append((idx[0], idx[k], idx[k + 1]))
    return np.asarray(tris, dtype=int) if tris else np.zeros((0, 3), dtype=int)


def _elem_centroids(nodes_xy: np.ndarray, elements: List) -> np.ndarray:
    return np.array([nodes_xy[[int(i) for i in el]].mean(axis=0) for el in elements])


_AVERAGER_CACHE: Dict[tuple, object] = {}


def _node_averager(nodes_xy: np.ndarray, elements: List, centres: np.ndarray,
                   cache_key: Optional[tuple] = None):
    """Precompute the cell -> node binding once, return `to_nodes(cell_vals)`.

    Matches VTK's cellDataToPointData: bind each viewer element to its OpenFOAM
    cell, then average the bound element values over the elements incident to
    each node. `gmshToFoam` often keeps element order, so try the identity map
    before paying for a nearest-neighbour search.

    The binding is purely geometric and the mesh is static over a run, so it is
    cached per case - transient scrubbing would otherwise redo the O(cells^2)
    nearest-neighbour match on every frame.
    """
    if cache_key is not None and cache_key in _AVERAGER_CACHE:
        return _AVERAGER_CACHE[cache_key]

    nodes_xy = np.asarray(nodes_xy, dtype=float)
    centres = np.asarray(centres, dtype=float)
    nn = len(nodes_xy)
    nc = len(centres)

    ec = _elem_centroids(nodes_xy, elements)
    cell_sz = math.sqrt(max(np.ptp(nodes_xy[:, 0]) * np.ptp(nodes_xy[:, 1]), 1e-9) / max(nc, 1))
    if len(ec) == nc and np.linalg.norm(ec - centres, axis=1).max() < 0.05 * cell_sz:
        cell_of_elem = np.arange(nc)
    else:
        cell_of_elem = np.clip(_nearest(ec, centres), 0, nc - 1)

    flat_nodes = np.concatenate([np.asarray(el, dtype=int) for el in elements])
    per_elem = np.array([len(el) for el in elements], dtype=int)
    cnt = np.zeros(nn)
    np.add.at(cnt, flat_nodes, 1.0)
    inv_cnt = np.divide(1.0, cnt, out=np.zeros(nn), where=cnt > 0)
    missing = cnt == 0
    miss_cell = (np.clip(_nearest(nodes_xy[missing], centres), 0, nc - 1)
                 if missing.any() else None)

    def to_nodes(cell_vals: np.ndarray) -> np.ndarray:
        cell_vals = np.asarray(cell_vals, dtype=float).ravel()
        acc = np.zeros(nn)
        np.add.at(acc, flat_nodes, np.repeat(cell_vals[cell_of_elem], per_elem))
        out = acc * inv_cnt
        if miss_cell is not None:
            out[missing] = cell_vals[miss_cell]
        return out

    if cache_key is not None:
        if len(_AVERAGER_CACHE) > 8:
            _AVERAGER_CACHE.clear()
        _AVERAGER_CACHE[cache_key] = to_nodes
    return to_nodes


def _smooth_nodes(nodes_xy: np.ndarray, tris: np.ndarray, vals: np.ndarray,
                  iters: int = 1, alpha: float = 0.33) -> np.ndarray:
    """Light umbrella-operator pass over the node graph to erase the residual
    facets left by the nearest-cell binding. Kept gentle so the boundary layer
    and wake gradients survive."""
    if tris.shape[0] == 0 or iters <= 0:
        return vals
    nn = len(nodes_xy)
    edges = np.vstack([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    a = np.concatenate([edges[:, 0], edges[:, 1]])
    b = np.concatenate([edges[:, 1], edges[:, 0]])
    v = vals.astype(float).copy()
    for _ in range(iters):
        acc = np.zeros(nn)
        cnt = np.zeros(nn)
        np.add.at(acc, a, v[b])
        np.add.at(cnt, a, 1.0)
        nbr = np.divide(acc, cnt, out=v.copy(), where=cnt > 0)
        v = (1.0 - alpha) * v + alpha * nbr
    return v


def _node_vorticity(nodes_xy: np.ndarray, tris: np.ndarray,
                    node_u: np.ndarray) -> np.ndarray:
    """curl(U)_z per node, from constant-strain triangle gradients averaged
    back onto the nodes."""
    nn = len(nodes_xy)
    if tris.shape[0] == 0:
        return np.zeros(nn)
    p = nodes_xy[tris]
    x0, y0 = p[:, 0, 0], p[:, 0, 1]
    x1, y1 = p[:, 1, 0], p[:, 1, 1]
    x2, y2 = p[:, 2, 0], p[:, 2, 1]
    det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    det = np.where(np.abs(det) < 1e-16, 1e-16, det)
    ux = node_u[tris, 0]
    uy = node_u[tris, 1]
    dvy_dx = ((y1 - y2) * uy[:, 0] + (y2 - y0) * uy[:, 1] + (y0 - y1) * uy[:, 2]) / det
    dux_dy = ((x2 - x1) * ux[:, 0] + (x0 - x2) * ux[:, 1] + (x1 - x0) * ux[:, 2]) / det
    vort_tri = dvy_dx - dux_dy
    acc = np.zeros(nn)
    cnt = np.zeros(nn)
    np.add.at(acc, tris.ravel(), np.repeat(vort_tri, 3))
    np.add.at(cnt, tris.ravel(), 1.0)
    return np.divide(acc, cnt, out=np.zeros(nn), where=cnt > 0)


def _streamlines_numpy(centres: np.ndarray, cell_u: np.ndarray,
                       nodes_xy: np.ndarray, n_seeds: int = 24) -> List[List[List[float]]]:
    """RK4 streamlines on a rasterised velocity grid, seeded down the inlet.
    Cells more than a few cell-widths from any data point are treated as solid
    (the body / outside the domain) so lines stop at walls."""
    centres = np.asarray(centres, dtype=float)[:, :2]
    cell_u = np.asarray(cell_u, dtype=float)[:, :2]
    nodes_xy = np.asarray(nodes_xy, dtype=float)
    if len(centres) < 3 or len(nodes_xy) < 3:
        return []
    xmin, ymin = nodes_xy.min(axis=0)
    xmax, ymax = nodes_xy.max(axis=0)
    w, h = float(xmax - xmin), float(ymax - ymin)
    if w <= 0 or h <= 0:
        return []

    # Rasterise the cell velocities onto a uniform grid (O(cells), no NN search),
    # then dilate a few passes to bridge coarse far-field gaps. Whatever is still
    # empty is the body or outside the domain -> solid wall (zero velocity).
    cell_sz = math.sqrt(w * h / len(centres))
    nx = int(np.clip(w / (1.3 * cell_sz), 60, 260))
    ny = int(np.clip(h / (1.3 * cell_sz), 30, 200))
    ix = np.clip(((centres[:, 0] - xmin) / w * (nx - 1)).astype(int), 0, nx - 1)
    iy = np.clip(((centres[:, 1] - ymin) / h * (ny - 1)).astype(int), 0, ny - 1)
    acc = np.zeros((nx, ny, 2))
    cnt = np.zeros((nx, ny))
    np.add.at(acc, (ix, iy), cell_u)
    np.add.at(cnt, (ix, iy), 1.0)
    u_grid = np.divide(acc, cnt[..., None], out=np.zeros_like(acc), where=cnt[..., None] > 0)
    filled = cnt > 0
    for _ in range(2):
        if filled.all():
            break
        nb = np.zeros_like(acc)
        nbc = np.zeros_like(cnt)
        for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            g2 = np.roll(np.roll(u_grid, sx, 0), sy, 1)
            f2 = np.roll(np.roll(filled, sx, 0), sy, 1).astype(float)
            nb += g2 * f2[..., None]
            nbc += f2
        newly = (~filled) & (nbc > 0)
        u_grid[newly] = nb[newly] / nbc[newly][..., None]
        filled |= newly
    u_grid[~filled] = 0.0

    def vel(P: np.ndarray) -> np.ndarray:
        fx = np.clip((P[:, 0] - xmin) / w * (nx - 1), 0, nx - 1)
        fy = np.clip((P[:, 1] - ymin) / h * (ny - 1), 0, ny - 1)
        ix = np.floor(fx).astype(int)
        iy = np.floor(fy).astype(int)
        ix1 = np.minimum(ix + 1, nx - 1)
        iy1 = np.minimum(iy + 1, ny - 1)
        tx = (fx - ix)[:, None]
        ty = (fy - iy)[:, None]
        return (u_grid[ix, iy] * (1 - tx) * (1 - ty) + u_grid[ix1, iy] * tx * (1 - ty)
                + u_grid[ix, iy1] * (1 - tx) * ty + u_grid[ix1, iy1] * tx * ty)

    def unit(P: np.ndarray):
        v = vel(P)
        s = np.linalg.norm(v, axis=1, keepdims=True)
        return np.where(s > 1e-12, v / np.maximum(s, 1e-12), 0.0), s[:, 0]

    speed_ref = max(float(np.percentile(np.linalg.norm(cell_u, axis=1), 90)), 1e-6)
    step = 0.5 * min(w / nx, h / ny)
    nsteps = int(3.5 * w / step)
    seeds_y = np.linspace(ymin + 0.03 * h, ymax - 0.03 * h, n_seeds)
    P = np.column_stack([np.full(n_seeds, xmin + 0.01 * w), seeds_y])
    paths = [[[round(float(P[i, 0]), 4), round(float(P[i, 1]), 4)]] for i in range(n_seeds)]
    alive = np.ones(n_seeds, dtype=bool)

    for _ in range(nsteps):
        if not alive.any():
            break
        d1, s1 = unit(P)
        d2, _ = unit(P + 0.5 * step * d1)
        d3, _ = unit(P + 0.5 * step * d2)
        d4, _ = unit(P + step * d3)
        P = P + step / 6.0 * (d1 + 2 * d2 + 2 * d3 + d4)
        stalled = s1 < 1e-3 * speed_ref
        out = ((P[:, 0] < xmin) | (P[:, 0] > xmax)
               | (P[:, 1] < ymin) | (P[:, 1] > ymax))
        for i in np.where(alive)[0]:
            if stalled[i] or out[i]:
                alive[i] = False
                continue
            paths[i].append([round(float(P[i, 0]), 4), round(float(P[i, 1]), 4)])

    return [pl for pl in paths if len(pl) > 4]


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
