import math
from typing import Any, Dict, List, Tuple

import numpy as np

def _polygon_metrics(points: List[List[float]]) -> Tuple[float, float, float]:
    """Return (shape_quality 0..1, min_interior_angle_deg, skewness 0..1) for a
    triangle or quad given its ordered vertices."""
    count = len(points)
    ideal_angle = 60.0 if count == 3 else 90.0
    angles: List[float] = []
    edges: List[float] = []
    for i in range(count):
        edges.append(math.hypot(points[i][0] - points[(i + 1) % count][0],
                                points[i][1] - points[(i + 1) % count][1]))
    if min(edges) < 1e-13:
        return 0.0, 0.0, 1.0
    for i in range(count):
        prev_pt, apex, next_pt = points[(i - 1) % count], points[i], points[(i + 1) % count]
        v1 = (prev_pt[0] - apex[0], prev_pt[1] - apex[1])
        v2 = (next_pt[0] - apex[0], next_pt[1] - apex[1])
        cosine = (v1[0] * v2[0] + v1[1] * v2[1]) / (math.hypot(*v1) * math.hypot(*v2))
        angles.append(math.degrees(math.acos(max(-1.0, min(1.0, cosine)))))
    min_angle = min(angles)
    max_angle = max(angles)
    # Equiangle skewness: 0 for a perfect element, ->1 for a degenerate one.
    skewness = max(
        (max_angle - ideal_angle) / (180.0 - ideal_angle),
        (ideal_angle - min_angle) / ideal_angle,
    )
    skewness = max(0.0, min(1.0, skewness))
    return 1.0 - skewness, min_angle, skewness


def _shape_metrics(P: np.ndarray, cells: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Vectorised `_polygon_metrics` for cells that all have the same vertex
    count k: `cells` is (m, k) node indices into `P` (n, 2). Returns
    (min_angle_deg, skewness), with degenerate cells at (0, 1)."""
    k = cells.shape[1]
    ideal = 60.0 if k == 3 else 90.0
    pts = P[cells]                                   # (m, k, 2)
    nxt = np.roll(pts, -1, axis=1)
    prv = np.roll(pts, 1, axis=1)
    edge = np.hypot(*(pts - nxt).transpose(2, 0, 1))  # (m, k)
    v1 = prv - pts
    v2 = nxt - pts
    with np.errstate(divide="ignore", invalid="ignore"):
        cos = (v1[..., 0] * v2[..., 0] + v1[..., 1] * v2[..., 1]) / (
            np.hypot(v1[..., 0], v1[..., 1]) * np.hypot(v2[..., 0], v2[..., 1])
        )
    ang = np.degrees(np.arccos(np.clip(cos, -1.0, 1.0)))
    mn = ang.min(axis=1)
    mx = ang.max(axis=1)
    skew = np.clip(np.maximum((mx - ideal) / (180.0 - ideal), (ideal - mn) / ideal), 0.0, 1.0)
    bad = edge.min(axis=1) < 1e-13
    mn[bad] = 0.0
    skew[bad] = 1.0
    return mn, skew


def _mesh_quality(nodes: List[List[float]], elements: List[List[int]]) -> Dict[str, Any]:
    """Scale-independent 0..1 quality summary for a mixed triangle/quad mesh.

    Same metrics as `_polygon_metrics` per cell, computed with NumPy: the
    structured mesher calls this several times per mesh, and the per-cell
    Python loop took over a second each time on a 200k-cell grid."""
    tris = [e for e in elements if len(e) == 3]
    quads = [e for e in elements if len(e) == 4]
    triangles, nquads = len(tris), len(quads)
    total_elements = triangles + nquads
    quad_fraction = round(nquads / total_elements, 4) if total_elements > 0 else 0.0
    if total_elements == 0:
        return {"minimum": 0.0, "mean": 0.0, "p05": 0.0, "min_angle_degrees": 0.0,
                "max_skewness": 1.0, "triangles": triangles, "quads": nquads,
                "quad_fraction": quad_fraction}
    P = np.array([[nd[0], nd[1]] for nd in nodes], dtype=float)
    min_angles: List[np.ndarray] = []
    skews: List[np.ndarray] = []
    for group in (tris, quads):
        if group:
            mn, sk = _shape_metrics(P, np.array(group, dtype=np.int64))
            min_angles.append(mn)
            skews.append(sk)
    skew = np.concatenate(skews)
    ordered = np.sort(1.0 - skew)
    return {
        "minimum": round(float(ordered[0]), 4),
        "mean": round(float(ordered.sum() / len(ordered)), 4),
        "p05": round(float(ordered[max(0, int(0.05 * (len(ordered) - 1)))]), 4),
        "min_angle_degrees": round(float(np.concatenate(min_angles).min()), 3),
        "max_skewness": round(float(skew.max()), 4),
        "triangles": triangles,
        "quads": nquads,
        "quad_fraction": quad_fraction,
    }


# Backwards-compatible alias for any external caller.
_triangle_quality = _mesh_quality

