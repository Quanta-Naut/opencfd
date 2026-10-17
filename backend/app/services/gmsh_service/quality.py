import math
from typing import Any, Dict, List, Tuple

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


def _mesh_quality(nodes: List[List[float]], elements: List[List[int]]) -> Dict[str, Any]:
    """Scale-independent 0..1 quality summary for a mixed triangle/quad mesh."""
    qualities: List[float] = []
    minimum_angles: List[float] = []
    skewnesses: List[float] = []
    triangles = quads = 0
    for element in elements:
        if len(element) == 3:
            triangles += 1
        elif len(element) == 4:
            quads += 1
        else:
            continue
        quality, angle, skewness = _polygon_metrics([nodes[i] for i in element])
        qualities.append(quality)
        minimum_angles.append(angle)
        skewnesses.append(skewness)
    total_elements = triangles + quads
    quad_fraction = round(quads / total_elements, 4) if total_elements > 0 else 0.0
    if not qualities:
        return {"minimum": 0.0, "mean": 0.0, "p05": 0.0, "min_angle_degrees": 0.0,
                "max_skewness": 1.0, "triangles": triangles, "quads": quads,
                "quad_fraction": quad_fraction}
    ordered = sorted(qualities)
    return {
        "minimum": round(ordered[0], 4),
        "mean": round(sum(ordered) / len(ordered), 4),
        "p05": round(ordered[max(0, int(0.05 * (len(ordered) - 1)))], 4),
        "min_angle_degrees": round(min(minimum_angles), 3),
        "max_skewness": round(max(skewnesses), 4),
        "triangles": triangles,
        "quads": quads,
        "quad_fraction": quad_fraction,
    }


# Backwards-compatible alias for any external caller.
_triangle_quality = _mesh_quality

