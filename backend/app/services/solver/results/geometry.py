"""Mesh geometry for result mapping: cell centres, centroids, node averaging, vorticity."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Dict, List, Optional
import numpy as np
from .foamio import ResultsUnavailable, _read_field


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
            owner_text = poly_owner_f.read_text(encoding='utf-8', errors='ignore')
            m_owner = re.search(r'\n(\d+)\s*\n\(', owner_text)
            if m_owner:
                owner = np.fromstring(owner_text[m_owner.end():owner_text.rfind(')')], dtype=int, sep='\n')
                pts_text = poly_pts_f.read_text(encoding='utf-8', errors='ignore')
                m_pts = re.search(r'\n(\d+)\s*\n\(', pts_text)
                if m_pts:
                    pts = np.fromstring(pts_text[m_pts.end():pts_text.rfind(')')].replace('(', ' ').replace(')', ' '), sep=' ').reshape(-1, 3)
                    faces_text = poly_faces_f.read_text(encoding='utf-8', errors='ignore')
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
