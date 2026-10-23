"""Sampling result fields along a probe line (Plots)."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple
import numpy as np
from .geometry import _elem_centroids, _nearest


# ---------------------------------------------------------------------------
# Plot Over Line: sample flow field along an arbitrary 2D line segment
# ---------------------------------------------------------------------------

try:
    from scipy.spatial import cKDTree
    _HAS_CKDTREE = True
except ImportError:
    _HAS_CKDTREE = False


_LINE_SPATIAL_INDEX_CACHE: Dict[tuple, Any] = {}


_FIELD_DECIMALS: Dict[str, int] = {
    "U_mag": 4,
    "p": 3,
    "k": 5,
    "omega": 3,
    "vorticity": 4,
}


def _point_in_triangle_barycentric(
    px: float,
    py: float,
    xa: float,
    ya: float,
    xb: float,
    yb: float,
    xc: float,
    yc: float,
    eps: float = 1e-6,
) -> Tuple[bool, float, float, float]:
    """Calculate barycentric weights for point (px, py) in triangle abc.

    Returns (is_inside, lambda_a, lambda_b, lambda_c).
    Weights are non-negative and normalized to sum to 1.0 when inside.
    """
    det = (xa - xc) * (yb - yc) - (xb - xc) * (ya - yc)
    if abs(det) < 1e-15:
        return False, 0.0, 0.0, 0.0

    dx = px - xc
    dy = py - yc
    lA = (dx * (yb - yc) - (xb - xc) * dy) / det
    if lA < -eps:
        return False, 0.0, 0.0, 0.0

    lB = ((xa - xc) * dy - dx * (ya - yc)) / det
    if lB < -eps:
        return False, 0.0, 0.0, 0.0

    lC = 1.0 - lA - lB
    if lC < -eps:
        return False, 0.0, 0.0, 0.0

    wa = max(0.0, lA)
    wb = max(0.0, lB)
    wc = max(0.0, lC)
    s = wa + wb + wc
    if s < 1e-12:
        return False, 0.0, 0.0, 0.0
    return True, wa / s, wb / s, wc / s


class _UniformGridBucketIndex:
    """Fallback uniform-grid spatial bucket index when scipy is not available."""

    def __init__(self, centroids: np.ndarray):
        self.centroids = centroids
        xmin, ymin = centroids.min(axis=0)
        xmax, ymax = centroids.max(axis=0)
        w = max(float(xmax - xmin), 1e-6)
        h = max(float(ymax - ymin), 1e-6)
        nc = len(centroids)
        self.xmin = xmin
        self.ymin = ymin
        self.nx = int(np.clip(math.sqrt(nc * (w / h)), 8, 120))
        self.ny = int(np.clip(math.sqrt(nc * (h / w)), 8, 120))
        self.dx = w / self.nx
        self.dy = h / self.ny
        self.grid: Dict[Tuple[int, int], List[int]] = {}
        for i, c in enumerate(centroids):
            ix = int(np.clip((c[0] - self.xmin) / self.dx, 0, self.nx - 1))
            iy = int(np.clip((c[1] - self.ymin) / self.dy, 0, self.ny - 1))
            self.grid.setdefault((ix, iy), []).append(i)

    def query(self, pts: np.ndarray, k: int = 32) -> Tuple[np.ndarray, List[List[int]]]:
        """Query candidate element indices for each point in pts."""
        n_pts = len(pts)
        cands_out: List[List[int]] = []
        dists_out = np.zeros((n_pts, k), dtype=float)

        for i, pt in enumerate(pts):
            ix = int(np.clip((pt[0] - self.xmin) / self.dx, 0, self.nx - 1))
            iy = int(np.clip((pt[1] - self.ymin) / self.dy, 0, self.ny - 1))
            found: List[int] = []
            for radius in range(1, 4):
                for cx in range(max(0, ix - radius), min(self.nx, ix + radius + 1)):
                    for cy in range(max(0, iy - radius), min(self.ny, iy + radius + 1)):
                        for elem_idx in self.grid.get((cx, cy), []):
                            if elem_idx not in found:
                                found.append(elem_idx)
                if len(found) >= k:
                    break
            if not found:
                found = list(range(min(k, len(self.centroids))))
            if len(found) > 1:
                d2 = ((self.centroids[found] - pt) ** 2).sum(axis=1)
                order = np.argsort(d2)[:k]
                found = [found[o] for o in order]
                dists_out[i, :len(found)] = np.sqrt(d2[order])
            elif found:
                dists_out[i, 0] = float(np.linalg.norm(self.centroids[found[0]] - pt))
            cands_out.append(found)

        return dists_out, cands_out


class _MeshSpatialIndex:
    """Precomputed spatial acceleration structure for a mesh."""

    def __init__(self, nodes_xy: np.ndarray, elements: List):
        self.nodes_xy = nodes_xy
        self.elements = elements
        self.centroids = _elem_centroids(nodes_xy, elements)

        # Circumradius of each element from its centroid
        radii: List[float] = []
        for el, c in zip(elements, self.centroids):
            el_nodes = nodes_xy[[int(i) for i in el]]
            r = float(np.linalg.norm(el_nodes - c, axis=1).max())
            radii.append(r)
        self.elem_radii = np.array(radii, dtype=float)
        self.max_elem_radius = float(self.elem_radii.max()) if len(self.elem_radii) else 0.0

        # Sub-triangles for each element via fan-triangulation from vertex 0
        self.elem_tris: List[List[Tuple[int, int, int]]] = []
        for el in elements:
            idx = [int(i) for i in el]
            sub = []
            for t in range(1, len(idx) - 1):
                sub.append((idx[0], idx[t], idx[t + 1]))
            self.elem_tris.append(sub)

        # Incident elements for each node (for fast local search near closest node)
        node_elems: List[List[int]] = [[] for _ in range(len(nodes_xy))]
        for el_idx, el in enumerate(elements):
            for n in el:
                node_elems[int(n)].append(el_idx)
        self.node_elems = node_elems

        # Primary spatial index
        if _HAS_CKDTREE:
            self.tree = cKDTree(self.centroids)
            self.node_tree = cKDTree(nodes_xy)
        else:
            self.tree = _UniformGridBucketIndex(self.centroids)
            self.node_tree = None

    def query_candidates(self, pts: np.ndarray, k: int = 32):
        if _HAS_CKDTREE:
            k_clamped = min(k, len(self.centroids))
            dists, indices = self.tree.query(pts, k=k_clamped)
            if k_clamped == 1:
                dists = dists[:, None]
                indices = indices[:, None]
            return dists, indices
        else:
            return self.tree.query(pts, k=min(k, len(self.centroids)))

    def query_nearest_nodes(self, pts: np.ndarray) -> np.ndarray:
        if _HAS_CKDTREE and self.node_tree is not None:
            return self.node_tree.query(pts)[1]
        return _nearest(pts, self.nodes_xy)


def _get_mesh_spatial_index(mesh: Dict[str, Any]) -> _MeshSpatialIndex:
    nodes = mesh.get("nodes") or []
    elements = mesh.get("elements") or []
    if not nodes or not elements:
        raise ValueError("Field snapshot has no mesh nodes or elements")

    first_node = tuple(nodes[0][:2]) if len(nodes) > 0 else ()
    last_node = tuple(nodes[-1][:2]) if len(nodes) > 0 else ()
    first_elem = tuple(elements[0][:3]) if len(elements) > 0 else ()
    cache_key = (len(nodes), len(elements), first_node, last_node, first_elem)

    cached = _LINE_SPATIAL_INDEX_CACHE.get(cache_key)
    if cached is not None:
        return cached

    nodes_xy = np.asarray(nodes, dtype=float)[:, :2]
    index = _MeshSpatialIndex(nodes_xy, elements)

    if len(_LINE_SPATIAL_INDEX_CACHE) > 16:
        _LINE_SPATIAL_INDEX_CACHE.clear()
    _LINE_SPATIAL_INDEX_CACHE[cache_key] = index
    return index


def sample_field_along_line(
    field_snapshot: Dict[str, Any],
    p1: Tuple[float, float] | List[float],
    p2: Tuple[float, float] | List[float],
    samples: int = 100,
) -> Dict[str, Any]:
    """Sample the flow field along an arbitrary 2D line segment between p1 and p2.

    Uses barycentric interpolation on fan-triangulated mesh elements with
    spatial acceleration (KD-tree or uniform grid) and falls back to nearest
    mesh node values for points outside the domain.

    Returns:
        {
            "distance": [0.0, ...],
            "fields": {
                "U_mag": [...],
                "p": [...],
                "k": [...],
                "omega": [...],
                "vorticity": [...]
            }
        }
    """
    mesh = field_snapshot.get("mesh") or {}
    spatial_index = _get_mesh_spatial_index(mesh)
    nodes_xy = spatial_index.nodes_xy
    elem_tris = spatial_index.elem_tris
    elem_radii = spatial_index.elem_radii
    node_elems = spatial_index.node_elems
    max_radius = spatial_index.max_elem_radius * 1.05

    x1, y1 = float(p1[0]), float(p1[1])
    x2, y2 = float(p2[0]), float(p2[1])
    dx = x2 - x1
    dy = y2 - y1
    total_length = math.hypot(dx, dy)
    if total_length <= 1e-12:
        raise ValueError("Line start and end points must not be equal (zero-length line)")

    samples = max(2, min(int(samples), 2000))
    t = np.linspace(0.0, 1.0, samples)
    pts = np.column_stack([x1 + t * dx, y1 + t * dy])
    distances = t * total_length

    k_search = min(32, len(spatial_index.centroids))
    dists, candidates = spatial_index.query_candidates(pts, k=k_search)

    n_pts = len(pts)
    node_a = np.zeros(n_pts, dtype=int)
    node_b = np.zeros(n_pts, dtype=int)
    node_c = np.zeros(n_pts, dtype=int)
    weight_a = np.zeros(n_pts, dtype=float)
    weight_b = np.zeros(n_pts, dtype=float)
    weight_c = np.zeros(n_pts, dtype=float)

    unfound_indices: List[int] = []

    for i in range(n_pts):
        px, py = pts[i, 0], pts[i, 1]
        cands_i = candidates[i]
        dists_i = dists[i]
        found = False

        for j in range(len(cands_i)):
            el_idx = int(cands_i[j])
            if dists_i[j] > max(elem_radii[el_idx] * 1.05, 1e-6):
                if dists_i[j] > max_radius:
                    break
                continue

            for tri in elem_tris[el_idx]:
                ia, ib, ic = tri
                inside, wa, wb, wc = _point_in_triangle_barycentric(
                    px, py,
                    nodes_xy[ia, 0], nodes_xy[ia, 1],
                    nodes_xy[ib, 0], nodes_xy[ib, 1],
                    nodes_xy[ic, 0], nodes_xy[ic, 1],
                )
                if inside:
                    node_a[i] = ia
                    node_b[i] = ib
                    node_c[i] = ic
                    weight_a[i] = wa
                    weight_b[i] = wb
                    weight_c[i] = wc
                    found = True
                    break
            if found:
                break

        if not found:
            unfound_indices.append(i)

    # Local search via nearest node incident elements, or fallback to nearest node
    if unfound_indices:
        unfound_arr = np.array(unfound_indices, dtype=int)
        unfound_pts = pts[unfound_arr]
        nearest_nodes = spatial_index.query_nearest_nodes(unfound_pts)

        for idx_in_pts, near_node in zip(unfound_indices, nearest_nodes):
            px, py = pts[idx_in_pts, 0], pts[idx_in_pts, 1]
            found = False
            for el_idx in node_elems[near_node]:
                for tri in elem_tris[el_idx]:
                    ia, ib, ic = tri
                    inside, wa, wb, wc = _point_in_triangle_barycentric(
                        px, py,
                        nodes_xy[ia, 0], nodes_xy[ia, 1],
                        nodes_xy[ib, 0], nodes_xy[ib, 1],
                        nodes_xy[ic, 0], nodes_xy[ic, 1],
                    )
                    if inside:
                        node_a[idx_in_pts] = ia
                        node_b[idx_in_pts] = ib
                        node_c[idx_in_pts] = ic
                        weight_a[idx_in_pts] = wa
                        weight_b[idx_in_pts] = wb
                        weight_c[idx_in_pts] = wc
                        found = True
                        break
                if found:
                    break

            if not found:
                # Point is outside the meshed domain: fall back to single nearest node
                node_a[idx_in_pts] = near_node
                node_b[idx_in_pts] = near_node
                node_c[idx_in_pts] = near_node
                weight_a[idx_in_pts] = 1.0
                weight_b[idx_in_pts] = 0.0
                weight_c[idx_in_pts] = 0.0

    # Interpolate fields
    stored_fields = field_snapshot.get("fields") or {}
    standard_names = ["U_mag", "p", "k", "omega", "vorticity"]
    all_field_names: List[str] = list(standard_names)
    for name in stored_fields:
        if name not in all_field_names:
            all_field_names.append(name)

    nn = len(nodes_xy)
    interpolated_fields: Dict[str, List[float]] = {}
    for fname in all_field_names:
        raw_vals = stored_fields.get(fname)
        if raw_vals is None:
            f_arr = np.zeros(nn, dtype=float)
        else:
            f_arr = np.asarray(raw_vals, dtype=float).ravel()
            if len(f_arr) < nn:
                f_arr = np.pad(f_arr, (0, nn - len(f_arr)), mode="constant")
            elif len(f_arr) > nn:
                f_arr = f_arr[:nn]

        interp = weight_a * f_arr[node_a] + weight_b * f_arr[node_b] + weight_c * f_arr[node_c]
        interp = np.nan_to_num(interp, nan=0.0)

        dec = _FIELD_DECIMALS.get(fname, 5)
        interpolated_fields[fname] = [round(float(v), dec) for v in interp]

    return {
        "distance": [round(float(d), 6) for d in distances],
        "fields": interpolated_fields,
    }
