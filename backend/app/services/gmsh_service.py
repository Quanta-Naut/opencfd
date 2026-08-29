import copy
import math
import threading
from contextlib import contextmanager
from typing import Dict, Any, List, Tuple
import numpy as np
import gmsh


_gmsh_lock = threading.Lock()


@contextmanager
def _gmsh_session():
    """Serialize Gmsh's process-global C API state across backend requests."""
    with _gmsh_lock:
        gmsh.initialize()
        try:
            yield
        finally:
            gmsh.finalize()


def _signed_area(points: List[Tuple[float, float]]) -> float:
    return 0.5 * sum(
        points[i][0] * points[(i + 1) % len(points)][1]
        - points[(i + 1) % len(points)][0] * points[i][1]
        for i in range(len(points))
    )


def _clean_loop(points: List[Any]) -> List[Tuple[float, float]]:
    cleaned: List[Tuple[float, float]] = []
    for point in points:
        if isinstance(point, dict):
            current = (float(point["x"]), float(point["y"]))
        else:
            current = (float(point[0]), float(point[1]))
        if not cleaned or math.hypot(current[0] - cleaned[-1][0], current[1] - cleaned[-1][1]) > 1e-9:
            cleaned.append(current)
    # Selig DAT files commonly repeat the trailing-edge point. Treat a
    # near-duplicate as the closure of the loop, not as a tiny extra edge.
    if len(cleaned) > 1 and math.hypot(cleaned[0][0] - cleaned[-1][0], cleaned[0][1] - cleaned[-1][1]) < 1e-5:
        cleaned.pop()
    return cleaned if len(cleaned) >= 3 else []


def _entity_points(entity: Dict[str, Any]) -> List[Tuple[float, float]]:
    """Return a closed polygon representation for a supported 2D CAD entity."""
    if entity.get("type") == "circle" and entity.get("radius") is not None:
        center = entity.get("pts", [])[0]
        center_x = float(center["x"] if isinstance(center, dict) else center[0])
        center_y = float(center["y"] if isinstance(center, dict) else center[1])
        radius = abs(float(entity["radius"]))
        return [
            (center_x + radius * math.cos(2 * math.pi * index / 64),
             center_y + radius * math.sin(2 * math.pi * index / 64))
            for index in range(64)
        ]

    # Open linework is not a valid 2D surface boundary. Domain rectangles,
    # imported closed polylines and sketches marked isClosed are valid loops.
    if not entity.get("isClosed") and entity.get("type") not in {"rectangle"} and entity.get("role") != "domain_boundary":
        return []
    return _clean_loop(entity.get("pts", []))


def _join_segmented_loops(
    entities: List[Dict[str, Any]],
    edge_tags: Dict[str, Any] | None = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Stitch loose line segments into closed profiles.

    Users draw a boundary any way they like (Line tool, Rectangle + Trim, etc.),
    so the geometry often arrives as one entity per edge. We rebuild the closed
    loop AND carry each segment's boundary tag onto the corresponding edge of the
    rebuilt polyline, so tagging is not tied to how the outline was drawn.
    Returns (entities, edge_tags) - both possibly rewritten.
    """
    edge_tags = dict(edge_tags or {})
    tolerance = 1e-6
    candidates = [
        entity for entity in entities
        if entity.get("type") == "line" and entity.get("layer") != "construction" and len(entity.get("pts", [])) >= 2
    ]
    consumed: set[int] = set()
    closed_segment_indices: set[int] = set()
    rebuilt: List[Dict[str, Any]] = []

    def point(raw: Any) -> Tuple[float, float]:
        return (float(raw["x"]), float(raw["y"])) if isinstance(raw, dict) else (float(raw[0]), float(raw[1]))

    def same(a: Tuple[float, float], b: Tuple[float, float]) -> bool:
        return math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance

    for seed_index, seed in enumerate(candidates):
        if seed_index in consumed:
            continue
        start = point(seed["pts"][0])
        chain = [start, point(seed["pts"][1])]
        consumed.add(seed_index)
        traversed = {seed_index}
        # edge_seg_ids[k] = source entity id that became edge k of the rebuilt loop
        edge_seg_ids: List[Any] = [seed.get("id")]
        while not same(chain[-1], chain[0]):
            next_index = None
            next_point = None
            for index, candidate in enumerate(candidates):
                if index in consumed:
                    continue
                p0, p1 = point(candidate["pts"][0]), point(candidate["pts"][1])
                if same(p0, chain[-1]):
                    next_index, next_point = index, p1
                    break
                if same(p1, chain[-1]):
                    next_index, next_point = index, p0
                    break
            if next_index is None:
                break
            consumed.add(next_index)
            traversed.add(next_index)
            chain.append(next_point)
            edge_seg_ids.append(candidates[next_index].get("id"))

        if len(chain) >= 4 and same(chain[-1], chain[0]):
            closed_segment_indices.update(traversed)
            new_id = seed.get("id", "boundary")
            rebuilt.append({
                **seed,
                "type": "polyline",
                "isClosed": True,
                "pts": [{"x": x, "y": y} for x, y in chain[:-1]],
            })
            # Move each source segment's tag ("<segId>_0") onto "<newId>_<edgeIdx>".
            for edge_idx, seg_id in enumerate(edge_seg_ids):
                for key in (f"{seg_id}_0", f"{seg_id}_-1"):
                    if key in edge_tags:
                        edge_tags[f"{new_id}_{edge_idx}"] = edge_tags[key]
                        break

    # A closed reconstruction replaces its source segments; leave unrelated
    # open CAD lines intact so they can still be diagnosed/ignored explicitly.
    remaining = [entity for entity in entities if entity not in candidates]
    remaining.extend(entity for index, entity in enumerate(candidates) if index not in closed_segment_indices)
    return remaining + rebuilt, edge_tags


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


def _mesh_quality(nodes: List[List[float]], elements: List[List[int]]) -> Dict[str, float]:
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
    if not qualities:
        return {"minimum": 0.0, "mean": 0.0, "p05": 0.0, "min_angle_degrees": 0.0,
                "max_skewness": 1.0, "triangles": triangles, "quads": quads}
    ordered = sorted(qualities)
    return {
        "minimum": round(ordered[0], 4),
        "mean": round(sum(ordered) / len(ordered), 4),
        "p05": round(ordered[max(0, int(0.05 * (len(ordered) - 1)))], 4),
        "min_angle_degrees": round(min(minimum_angles), 3),
        "max_skewness": round(max(skewnesses), 4),
        "triangles": triangles,
        "quads": quads,
    }


# Backwards-compatible alias for any external caller.
_triangle_quality = _mesh_quality


# Preset -> global size multiplier. Every characteristic length in the mesher is
# scaled by this, so the three buttons produce visibly different meshes even when
# refinement fields and curvature sizing are active.
_RESOLUTION_SCALE = {"coarse": 2.4, "medium": 1.0, "fine": 0.45}

# 2D meshing algorithm ids in Gmsh.
_ALGORITHM_IDS = {
    "frontal_delaunay": 6,
    "delaunay": 5,
    "mesh_adapt": 1,
    "frontal_quad": 8,
    "packing": 9,
}


def _interior_angle(points: List[Tuple[float, float]], i: int) -> float:
    count = len(points)
    a, b, c = points[(i - 1) % count], points[i], points[(i + 1) % count]
    v1 = (a[0] - b[0], a[1] - b[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if n1 < 1e-12 or n2 < 1e-12:
        return 180.0
    return math.degrees(math.acos(max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))))


def _local_radius_of_curvature(a: Tuple[float, float], b: Tuple[float, float],
                               c: Tuple[float, float]) -> float:
    """Circumradius of the triangle a-b-c: the radius of the circle through the
    three consecutive outline points, i.e. the local radius of curvature at b."""
    ab = math.hypot(b[0] - a[0], b[1] - a[1])
    bc = math.hypot(c[0] - b[0], c[1] - b[1])
    ca = math.hypot(a[0] - c[0], a[1] - c[1])
    area = abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2.0
    if area < 1e-14:
        return float("inf")
    return (ab * bc * ca) / (4.0 * area)


def _curvature_adaptive_resample(points: List[Tuple[float, float]], max_spacing: float,
                                 min_spacing: float, deviation_tol: float
                                 ) -> Tuple[List[Tuple[float, float]], List[float]]:
    """Re-node a closed outline so the node spacing follows local curvature:
    dense where the outline is tightly curved (an airfoil leading edge), sparse
    where it is nearly straight. Sharp corners (interior angle < 60 deg, e.g. a
    trailing edge) are always kept. Every new segment's chord-height error stays
    under `deviation_tol`, so the *shape* is preserved at every preset - only the
    node count on the flat stretches changes.

    Returns (points, per_point_target_size); the size is the local spacing so the
    caller can give Gmsh a matching wall mesh size and keep the near-wall
    triangles from over-stretching across the dense leading edge."""
    count = len(points)
    if count < 5 or max_spacing <= 0:
        return points, [max_spacing] * len(points)
    max_spacing = max(max_spacing, min_spacing * 2.0)

    # Cumulative arc length of the original outline.
    seg_len = [
        math.hypot(points[i][0] - points[(i + 1) % count][0], points[i][1] - points[(i + 1) % count][1])
        for i in range(count)
    ]
    cum = [0.0]
    for L in seg_len:
        cum.append(cum[-1] + L)
    total = cum[-1]
    if total <= 0:
        return points, [max_spacing] * len(points)

    # Local target spacing at each original vertex from curvature: for a circular
    # arc of radius R the sagitta of chord s is ~ s^2 / (8R); bounding it by the
    # tolerance gives s <= sqrt(8 * R * tol).
    vert_size = []
    for i in range(count):
        radius = _local_radius_of_curvature(points[(i - 1) % count], points[i], points[(i + 1) % count])
        vert_size.append(max_spacing if math.isinf(radius)
                         else max(min_spacing, min(max_spacing, math.sqrt(8.0 * radius * deviation_tol))))
    vert_size = [
        (vert_size[(i - 1) % count] + 2.0 * vert_size[i] + vert_size[(i + 1) % count]) / 4.0
        for i in range(count)
    ]

    def sample(s: float) -> Tuple[Tuple[float, float], float]:
        s %= total
        # locate segment
        lo, hi = 0, count
        while lo + 1 < hi:
            mid = (lo + hi) // 2
            if cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        a, b = points[lo], points[(lo + 1) % count]
        frac = (s - cum[lo]) / seg_len[lo] if seg_len[lo] > 1e-13 else 0.0
        pt = (a[0] + frac * (b[0] - a[0]), a[1] + frac * (b[1] - a[1]))
        size = vert_size[lo] + frac * (vert_size[(lo + 1) % count] - vert_size[lo])
        return pt, size

    # Arc positions of real corners (a blunt airfoil trailing edge turns ~90 deg,
    # a smooth surface stays above ~160 deg) - always land a node exactly there.
    # Corners closer together than the node spacing (the two lips of a blunt
    # trailing edge on the coarse preset) collapse to their midpoint so we do
    # not force a short edge that would sliver.
    raw_corner_s = sorted(cum[i] for i in range(count) if _interior_angle(points, i) < 130.0)
    corner_s: List[float] = []
    for cs in raw_corner_s:
        if corner_s and cs - corner_s[-1] < min_spacing * 0.6:
            corner_s[-1] = 0.5 * (corner_s[-1] + cs)
        else:
            corner_s.append(cs)

    result: List[Tuple[float, float]] = []
    sizes: List[float] = []
    s = 0.0
    prev_step = min_spacing
    guard = 0
    limit = int(total / min_spacing) + count + 16
    # Cap how fast the node spacing may grow so Gmsh never sees a >~1.3x jump in
    # cell size between neighbours (that ratio is what makes the slivers).
    grow = 1.3
    def emit(pt: Tuple[float, float], size: float, is_corner: bool = False) -> None:
        if (not is_corner and result
                and math.hypot(result[-1][0] - pt[0], result[-1][1] - pt[1]) < min_spacing * 0.5):
            return
        # Even a corner is dropped if it would coincide with the previous node.
        if result and math.hypot(result[-1][0] - pt[0], result[-1][1] - pt[1]) < min_spacing * 0.02:
            return
        result.append(pt)
        sizes.append(size)

    while s < total - min_spacing * 0.5 and guard < limit:
        guard += 1
        pt, size = sample(s)
        step = max(min_spacing, min(size, max_spacing, prev_step * grow))
        nxt_corner = next((c for c in corner_s if c > s + 1e-9), None)
        if nxt_corner is not None and nxt_corner <= s + step:
            cpt, csize = sample(nxt_corner)
            emit(cpt, min(max(csize, min_spacing), prev_step * grow), is_corner=True)
            prev_step = min_spacing
            # Nudge only just past this corner so a second nearby corner (the far
            # side of a blunt trailing edge) is not jumped over.
            s = nxt_corner + min_spacing * 1e-3
            continue
        emit(pt, step)
        prev_step = step
        s += step

    if len(result) < 4:
        return points, [max_spacing] * len(points)

    # Gradient-limit the size field both ways round the loop so the cell size
    # never changes by more than `grow` between neighbouring wall nodes - the
    # approach to the leading edge grades down as gently as the departure grades
    # up. This only ever lowers a size, and only near a finer neighbour.
    n = len(sizes)
    seg = [math.hypot(result[i][0] - result[(i + 1) % n][0], result[i][1] - result[(i + 1) % n][1])
           for i in range(n)]
    for _ in range(4):
        for i in range(n):
            j = (i + 1) % n
            sizes[j] = min(sizes[j], sizes[i] * grow + (grow - 1.0) * seg[i])
        for i in range(n - 1, -1, -1):
            j = (i + 1) % n
            sizes[i] = min(sizes[i], sizes[j] * grow + (grow - 1.0) * seg[i])
    return result, sizes


def _condition_wall_loop(points: List[Tuple[float, float]], feature_size: float,
                         feature_span: float) -> Tuple[List[Tuple[float, float]], List[float]]:
    """Re-node an obstacle outline for meshing WITHOUT changing its shape.
    Straight stretches get few nodes (so the coarse preset is genuinely coarse
    and the boundary-layer extruder is not starved of room), while curved
    regions keep enough nodes that the chord error stays well under 0.1% of the
    body size - an airfoil leading edge never goes faceted. Returns the outline
    plus a per-node target mesh size."""
    count = len(points)
    if count < 5:
        return points, [feature_size] * len(points)
    perimeter = sum(
        math.hypot(points[j][0] - points[(j + 1) % count][0], points[j][1] - points[(j + 1) % count][1])
        for j in range(count)
    )
    if perimeter <= 0:
        return points, [feature_size] * len(points)
    # Wall node count barely affects solve cost (the 2D fill dominates), so we
    # err toward keeping the outline crisp: a tight chord-error tolerance and a
    # small floor let curved regions stay dense.
    max_spacing = min(max(feature_size, perimeter / 500.0), perimeter / 45.0)
    # The leading-edge node spacing scales with the preset (so the boundary
    # layer scales too) but stays fine enough that the nose never looks faceted.
    min_spacing = max(feature_size * 0.1, feature_span * 2e-4)
    deviation_tol = feature_span * 1.2e-4
    return _curvature_adaptive_resample(points, max_spacing, min_spacing, deviation_tol)


def generate_mesh_from_cad_entities(params: Dict[str, Any]) -> Dict[str, Any]:
    """Generate a real 2D triangular mesh from the CAD domain and closed loops."""
    entities, joined_edge_tags = _join_segmented_loops(
        params.get("cadEntities") or [], params.get("edgeTagMap") or {}
    )
    if not entities:
        raise ValueError("No CAD entities were supplied for meshing.")

    loops: List[Dict[str, Any]] = []
    for entity in entities:
        points = _entity_points(entity)
        if points:
            loops.append({"entity": entity, "points": points, "area": abs(_signed_area(points))})
    if not loops:
        raise ValueError("No closed 2D CAD loop was found.")

    domain_loops = [loop for loop in loops if loop["entity"].get("role") == "domain_boundary"]
    outer = max(domain_loops or loops, key=lambda loop: loop["area"])
    holes = [loop for loop in loops if loop is not outer and loop["area"] < outer["area"] * 0.98]
    if not holes and not domain_loops and len(loops) > 1:
        holes = [loop for loop in loops if loop is not outer]

    resolution = str(params.get("meshResolution", "medium")).lower()
    scale = _RESOLUTION_SCALE.get(resolution, 1.0)

    outer_points = outer["points"]
    domain_width = max(point[0] for point in outer_points) - min(point[0] for point in outer_points)
    domain_height = max(point[1] for point in outer_points) - min(point[1] for point in outer_points)
    span = max(domain_width, domain_height, 0.1)

    # Smallest obstacle bounding-box diagonal drives the near-body sizing so a
    # thin airfoil is resolved regardless of how large the flow domain is.
    feature_span = span
    for hole in holes:
        hole_points = hole["points"]
        hw = max(p[0] for p in hole_points) - min(p[0] for p in hole_points)
        hh = max(p[1] for p in hole_points) - min(p[1] for p in hole_points)
        feature_span = min(feature_span, max(math.hypot(hw, hh), span * 1e-3))

    # Edges the user tagged "wall" are treated as an obstacle for sizing even when
    # they belong to the outer boundary (a hand-drawn wind-tunnel wedge / step /
    # fairing). Their bounding box feeds the near-wall cell size, and later their
    # curves feed the Distance/Threshold + boundary-layer fields - so the mesh is
    # fine at the wedge and coarse out in the free stream, just like an airfoil.
    wall_seg_pts: List[Tuple[float, float]] = []
    for loop in loops:
        loop_id = loop["entity"].get("id", "boundary")
        lp = loop["points"]
        # A circle carries one entity-wide tag at "<id>_0" (its outline is
        # regenerated / resampled, so per-segment indices are not stable).
        circle_tag = None
        if loop["entity"].get("type") == "circle":
            circle_tag = str(joined_edge_tags.get(f"{loop_id}_0", "")).strip().lower()
        for i in range(len(lp)):
            seg_tag = circle_tag if circle_tag is not None else \
                str(joined_edge_tags.get(f"{loop_id}_{i}", "")).strip().lower()
            if seg_tag == "wall":
                wall_seg_pts.append(lp[i])
                wall_seg_pts.append(lp[(i + 1) % len(lp)])
    if len(wall_seg_pts) >= 2:
        ww = max(p[0] for p in wall_seg_pts) - min(p[0] for p in wall_seg_pts)
        wh = max(p[1] for p in wall_seg_pts) - min(p[1] for p in wall_seg_pts)
        feature_span = min(feature_span, max(math.hypot(ww, wh), span * 1e-3))

    # Base (medium) characteristic lengths, then scaled by the resolution preset.
    # The far field takes the full preset swing; the near-wall size only gets to
    # grow by up to 1.4x on the coarse preset, so the body outline stays smooth
    # (no low-poly airfoil) and the boundary-layer transition stays clean. The
    # visible coarsening happens out in the wake and free stream instead.
    near_scale = min(scale, 1.4)
    far_size = max(span * 0.06 * scale, 1e-4)
    feature_size = max(feature_span * 0.035 * near_scale, far_size * 0.03)
    feature_size = min(feature_size, far_size * 0.9)

    requested_min_size = float(params.get("minElementSize") or 0.0)
    requested_max_size = float(params.get("maxElementSize") or 0.0)
    local_refinement_size = float(params.get("localRefinementSize") or 0.0)
    if requested_max_size > 0:
        far_size = requested_max_size
    if local_refinement_size > 0:
        feature_size = min(local_refinement_size, far_size)
    min_size = requested_min_size if requested_min_size > 0 else max(feature_size * 0.12, far_size * 1e-4)
    max_size = max(far_size, min_size * 2.0)
    warnings: List[str] = []

    # Guard against cell sizes that would explode the element count. Without this
    # a tiny "Local wall size" on a large domain makes millions of cells and the
    # whole fallback ladder hangs for minutes. Estimate elements assuming ~30% of
    # the surface meshes near the walls at feature_size and the rest at far_size.
    outer_area = abs(_signed_area(outer["points"]))
    tri = 0.43  # area of a unit equilateral triangle
    est_elements = (
        0.30 * outer_area / max(feature_size * feature_size * tri, 1e-18)
        + 0.70 * outer_area / max(far_size * far_size * tri, 1e-18)
    )
    ELEMENT_CAP = 450_000.0
    if est_elements > ELEMENT_CAP:
        bump = math.sqrt(est_elements / ELEMENT_CAP)
        feature_size *= bump
        min_size *= bump
        max_size = max(max_size, min_size * 2.0)
        warnings.append(
            f"The chosen cell sizes would make roughly {int(est_elements / 1000)}k "
            f"elements - sizes were coarsened {bump:.1f}x to keep meshing responsive. "
            f"Raise Local wall size / Max size (or lower Growth rate) for a finer mesh."
        )

    # The obstacle outline keeps its full CAD fidelity - every imported point is
    # a mesh node, so the body never goes faceted at any preset. We only
    # RE-NODE a loop when its own points are much finer than the near-wall size
    # (which would starve the coarse preset and the boundary-layer extruder);
    # the re-node is curvature-adaptive so curved regions stay dense, and each
    # kept node carries its local target size.
    for hole in holes:
        pts = hole["points"]
        perim = sum(
            math.hypot(pts[j][0] - pts[(j + 1) % len(pts)][0], pts[j][1] - pts[(j + 1) % len(pts)][1])
            for j in range(len(pts))
        )
        median = perim / max(len(pts), 1)
        if len(pts) >= 40 and median < feature_size * 0.35:
            conditioned, conditioned_sizes = _condition_wall_loop(pts, feature_size, feature_span)
            if len(conditioned) >= 4:
                hole["points"] = conditioned
                hole["point_sizes"] = conditioned_sizes
                hole["area"] = abs(_signed_area(conditioned))
                if conditioned_sizes:
                    min_size = min(min_size, min(conditioned_sizes) * 0.9)

    growth_rate = min(max(float(params.get("growthRate", 1.2)), 1.01), 2.0)
    elements_per_curve = max(0, min(int(params.get("elementsPerCurve", 12)), 100))
    # Curvature sizing is "elements per 2*pi of arc"; keep it near the requested
    # value (a touch denser for the fine preset) so true arcs and splines stay
    # smooth without exploding the element count on the coarse preset.
    curvature_target = (elements_per_curve / min(scale, 1.3)) if elements_per_curve else 0.0
    optimize_mesh = bool(params.get("optimizeMesh", True))
    use_proximity = bool(params.get("useProximityRefinement", True))
    element_type = str(params.get("elementType", "tri")).lower()
    if element_type not in {"tri", "quad_dominant", "quad", "hybrid"}:
        element_type = "tri"
    recombine = element_type in {"quad", "quad_dominant"}

    requested_algorithm = str(params.get("meshAlgorithm", "frontal_delaunay")).lower()
    primary_algorithm = _ALGORITHM_IDS.get(requested_algorithm, 6)

    edge_tags = joined_edge_tags
    line_metadata: List[Tuple[int, str]] = []
    wall_lines: List[int] = []
    all_lines: List[int] = []

    with _gmsh_session():
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.model.add("opencfd_2d_case")

        def add_loop(loop: Dict[str, Any], point_size: float, reverse: bool = False
                     ) -> Tuple[int, List[int], List[int]]:
            entity_id = loop["entity"].get("id", "boundary")
            # A circle is one patch keyed at "<id>_0" (see the wall scan above).
            circle_tag = (
                edge_tags.get(f"{entity_id}_0")
                if loop["entity"].get("type") == "circle" else None
            )
            line_tags: List[int] = []
            raw_points = loop["points"]
            raw_sizes = loop.get("point_sizes")
            if raw_sizes and len(raw_sizes) == len(raw_points):
                pairs = list(zip(raw_points, raw_sizes))
            else:
                pairs = [(p, point_size) for p in raw_points]
            if reverse:
                pairs = list(reversed(pairs))
            points = [p for p, _ in pairs]
            point_tags = [gmsh.model.geo.addPoint(x, y, 0, size) for (x, y), size in pairs]
            for index, start in enumerate(point_tags):
                line = gmsh.model.geo.addLine(start, point_tags[(index + 1) % len(point_tags)])
                line_tags.append(line)
                all_lines.append(line)
                tag = circle_tag if circle_tag is not None else edge_tags.get(f"{entity_id}_{index}")
                line_metadata.append((line, str(tag) if tag else entity_id))
            return gmsh.model.geo.addCurveLoop(line_tags), line_tags, point_tags

        # Plane surfaces require the outer loop to be CCW and holes to be CW.
        # Normalize both explicitly because imported CAD loops often share a
        # winding direction regardless of whether they are holes.
        outer_loop, _, _ = add_loop(outer, far_size, reverse=_signed_area(outer["points"]) < 0)
        hole_data = [
            add_loop(loop, feature_size, reverse=_signed_area(loop["points"]) > 0)
            for loop in holes
        ]
        wall_lines = [line for _, lines, _ in hole_data for line in lines]
        hole_loops = [curve_loop for curve_loop, _, _ in hole_data]
        hole_point_tags = [point_tags for _, _, point_tags in hole_data]
        surface = gmsh.model.geo.addPlaneSurface([outer_loop, *hole_loops])
        gmsh.model.geo.synchronize()
        gmsh.model.addPhysicalGroup(2, [surface], name="fluid")
        # Keep the complete obstacle boundary available as a stable solver
        # patch even when CAD edge IDs are absent or change between imports.
        if wall_lines:
            gmsh.model.addPhysicalGroup(1, wall_lines, name="airfoil")
        boundary_groups: Dict[str, List[int]] = {}
        for line, name in line_metadata:
            boundary_groups.setdefault(name, []).append(line)
        for name, lines in boundary_groups.items():
            physical_tag = gmsh.model.addPhysicalGroup(1, lines)
            gmsh.model.setPhysicalName(1, physical_tag, name)

        # Treat every "wall"-tagged edge like an obstacle wall for meshing:
        # the Distance/Threshold refinement and the boundary-layer extruder below
        # both work off `wall_lines`, so this is what gives a hand-drawn wedge /
        # step a fine near-wall mesh even though it sits on the outer boundary.
        for line in boundary_groups.get("wall", []):
            if line not in wall_lines:
                wall_lines.append(line)

        gmsh.option.setNumber("Mesh.Optimize", 1 if optimize_mesh else 0)
        gmsh.option.setNumber("Mesh.OptimizeNetgen", 1 if optimize_mesh else 0)
        gmsh.option.setNumber("Mesh.Smoothing", 12 if optimize_mesh else 1)
        gmsh.option.setNumber("Mesh.SmoothRatio", 1.8)
        # Let the outer-boundary point size propagate inward so the far field
        # actually reaches `far_size`; refinement fields still win near the body.
        gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 1)
        gmsh.option.setNumber("Mesh.MeshSizeFromPoints", 1)
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", curvature_target)
        gmsh.option.setNumber("Mesh.CharacteristicLengthMin", min_size)
        gmsh.option.setNumber("Mesh.CharacteristicLengthMax", max_size)
        gmsh.option.setNumber("Mesh.MeshSizeMin", min_size)
        gmsh.option.setNumber("Mesh.MeshSizeMax", max_size)
        gmsh.option.setNumber("Mesh.MeshSizeFactor", 1.0)

        if recombine:
            gmsh.option.setNumber("Mesh.RecombineAll", 1)
            # 1 blossom (quad-dominant), 3 blossom full-quad.
            gmsh.option.setNumber("Mesh.RecombinationAlgorithm", 3 if element_type == "quad" else 1)
            gmsh.option.setNumber("Mesh.RecombineOptimizeTopology", 5)
            gmsh.option.setNumber("Mesh.RecombineMinimumQuality", 0.1)
            try:
                gmsh.model.mesh.setRecombine(2, surface)
            except Exception:
                pass

        # A genuine sharp trailing edge is a vertex whose interior angle is small
        # (well under a right angle). Testing "first point ~= last point" is not
        # enough: every polygonised closed curve has near-coincident end points,
        # and flagging those as sharp injects a fan singularity that produces
        # slivers on plain circles and blunt bodies.
        sharp_te_tags: List[int] = []
        for loop, point_tags in zip(holes, hole_point_tags):
            pts = loop["points"]
            if len(pts) < 4:
                continue
            apex, prev_pt, next_pt = pts[0], pts[-1], pts[1]
            v1 = (prev_pt[0] - apex[0], prev_pt[1] - apex[1])
            v2 = (next_pt[0] - apex[0], next_pt[1] - apex[1])
            n1, n2 = math.hypot(*v1), math.hypot(*v2)
            if n1 < 1e-12 or n2 < 1e-12:
                continue
            interior_angle = math.degrees(math.acos(
                max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
            ))
            if interior_angle < 40.0:
                sharp_te_tags.append(point_tags[0])
        if sharp_te_tags:
            te_size = max(min_size, feature_size * 0.35)
            for point_tag in sharp_te_tags:
                try:
                    gmsh.model.mesh.setSize([(0, point_tag)], te_size)
                except Exception:
                    pass

        # ---- Refinement fields -------------------------------------------------
        # A single bounded near-body Threshold: refine to `feature_size` at the
        # wall and relax back to `far_size` within a couple of body lengths, so
        # the free stream is genuinely coarse for the "coarse" preset.
        mesh_fields: List[int] = []
        background_fields: List[int] = []
        boundary_layer_field: List[int] = []
        first_layer = thickness = 0.0
        ratio = max(1.01, float(params.get("prismExpansionRatio", 1.2)))
        prisms_requested = bool(params.get("usePrismLayers", True)) and bool(wall_lines)
        # The anisotropic prism stack only belongs on the "hybrid" mesh. A
        # triangulated stack ("tri") slivers at the interface, and recombination
        # ("quad"/"quad_dominant") already produces near-structured wall quads,
        # so those types resolve the wall with a graded isotropic band instead.
        use_prism = prisms_requested and element_type == "hybrid"
        if prisms_requested and element_type != "hybrid":
            warnings.append(
                f"'{element_type}' element type: prism layers replaced by graded near-wall cells."
            )

        # Populated so the fallback ladder can re-tune the near-wall band if it
        # has to drop the prism stack.
        near_body = 0
        near_body_iso_size = feature_size

        if wall_lines:
            first_layer = max(float(params.get("firstLayerHeightMm", 0.05)) / 1000.0, feature_span * 1e-5)
            layers = max(1, min(int(params.get("numPrismLayers", 12)), 50))
            thickness = first_layer * ((ratio ** layers) - 1.0) / (ratio - 1.0)

            wall_distance = gmsh.model.mesh.field.add("Distance")
            mesh_fields.append(wall_distance)
            gmsh.model.mesh.field.setNumbers(wall_distance, "CurvesList", wall_lines)
            gmsh.model.mesh.field.setNumber(wall_distance, "Sampling", 300)

            # Near-wall isotropic cell size. WITH a prism stack the triangles on
            # top just match `feature_size` (a big jump there slivers). WITHOUT
            # one - pure tri/quad, or after the BL is dropped - keep the wall
            # band a little finer when a boundary layer was asked for, nudged by
            # the requested prism thickness so the layers/first-cell inputs still
            # touch the mesh. Kept within [0.7, 1.0] x feature_size so the
            # element count stays close to the plain result.
            near_body_iso_size = feature_size
            if prisms_requested:
                thickness_ratio = max(0.0, min(1.0, thickness / max(feature_size, 1e-9)))
                near_body_iso_size = max(min_size, feature_size * (1.0 - 0.3 * (1.0 - thickness_ratio)))
            near_wall_target = max(min_size, feature_size) if use_prism else near_body_iso_size

            near_body = gmsh.model.mesh.field.add("Threshold")
            mesh_fields.append(near_body)
            gmsh.model.mesh.field.setNumber(near_body, "InField", wall_distance)
            gmsh.model.mesh.field.setNumber(near_body, "SizeMin", near_wall_target)
            gmsh.model.mesh.field.setNumber(near_body, "SizeMax", max_size)
            gmsh.model.mesh.field.setNumber(near_body, "DistMin", max(thickness, feature_size * 1.5))
            # How far the fine near-wall band reaches before it has grown back to
            # the far-field size. Geometric growth from `near_wall_target` to
            # `far_size` at `growth_rate` covers a distance of roughly
            #   (far_size - near_wall_target) / (growth_rate - 1).
            # Low growth_rate (1.1) -> wide, gradual transition; high (1.5) ->
            # tight, abrupt transition. Proximity refinement widens it.
            growth_reach = (far_size - near_wall_target) / max(growth_rate - 1.0, 0.02)
            if use_proximity:
                growth_reach *= 1.6
            wake_reach = max(feature_size * 3.0, min(growth_reach, span * 2.0))
            gmsh.model.mesh.field.setNumber(near_body, "DistMax", wake_reach)
            gmsh.model.mesh.field.setNumber(near_body, "StopAtDistMax", 1)
            background_fields.append(near_body)

            if use_prism:
                boundary_layer = gmsh.model.mesh.field.add("BoundaryLayer")
                mesh_fields.append(boundary_layer)
                boundary_layer_field.append(boundary_layer)
                gmsh.model.mesh.field.setNumbers(boundary_layer, "CurvesList", wall_lines)
                gmsh.model.mesh.field.setNumber(boundary_layer, "Size", first_layer)
                gmsh.model.mesh.field.setNumber(boundary_layer, "Ratio", ratio)
                gmsh.model.mesh.field.setNumber(boundary_layer, "Thickness", thickness)
                gmsh.model.mesh.field.setNumber(boundary_layer, "Quads", 1)
                if sharp_te_tags:
                    gmsh.model.mesh.field.setNumbers(boundary_layer, "FanPointsList", sharp_te_tags)
                    gmsh.model.mesh.field.setNumbers(boundary_layer, "FanPointsSizesList", [5] * len(sharp_te_tags))
                gmsh.model.mesh.field.setAsBoundaryLayer(boundary_layer)

        def install_background() -> None:
            if len(background_fields) == 1:
                gmsh.model.mesh.field.setAsBackgroundMesh(background_fields[0])
            elif background_fields:
                minimum_field = gmsh.model.mesh.field.add("Min")
                mesh_fields.append(minimum_field)
                gmsh.model.mesh.field.setNumbers(minimum_field, "FieldsList", background_fields)
                gmsh.model.mesh.field.setAsBackgroundMesh(minimum_field)

        install_background()

        # ---- Generation with an escalating fallback ladder --------------------
        # Each attempt is a dict of knobs. Imported CAD with slivers, a stubborn
        # boundary layer or an impossible all-quad constraint still yields a
        # real mesh by relaxing one constraint at a time.
        #   recomb: -1 keep as configured, 0 disable, 1 quad-dominant blossom,
        #           3 blossom full-quad
        # Note: Mesh.Algorithm 8/9 (quad-oriented) can hard-crash Gmsh when a
        # BoundaryLayer field is present, so the ladder stays on the triangle
        # algorithms and reaches quads through recombination only.
        attempts: List[Dict[str, Any]] = [{"algo": primary_algorithm, "keep_bl": True, "recomb": -1}]
        if element_type == "quad":
            # Full-quad recombination can fail on odd edge parity; degrade to a
            # clean quad-dominant mesh rather than erroring.
            attempts.append({"algo": 6, "keep_bl": True, "recomb": 1})
        for algo in (6, 5, 1):
            if algo != primary_algorithm:
                attempts.append({"algo": algo, "keep_bl": True, "recomb": -1})
        attempts.append({"algo": 1, "keep_bl": False, "recomb": 0 if element_type != "hybrid" else -1})

        generated = False
        last_error: Any = None
        best_mesh: Any = None
        best_fallback_note = ""
        for attempt_index, cfg in enumerate(attempts):
            try:
                gmsh.model.mesh.clear()
                if not cfg["keep_bl"] and boundary_layer_field:
                    for field in boundary_layer_field:
                        try:
                            gmsh.model.mesh.field.remove(field)
                        except Exception:
                            pass
                    boundary_layer_field.clear()
                    try:
                        gmsh.model.mesh.field.setAsBoundaryLayer(0)
                    except Exception:
                        pass
                    # Without the prism stack, keep the near-wall band a little
                    # finer so the wall is still resolved and the layers/first
                    # cell inputs still touch the mesh.
                    if near_body:
                        try:
                            gmsh.model.mesh.field.setNumber(near_body, "SizeMin", near_body_iso_size)
                        except Exception:
                            pass
                    warnings.append("Boundary-layer field dropped to complete the mesh.")

                recomb_mode = cfg["recomb"]
                if recomb_mode != -1:
                    want_recomb = recomb_mode != 0
                    gmsh.option.setNumber("Mesh.RecombineAll", 1 if want_recomb else 0)
                    if want_recomb:
                        gmsh.option.setNumber("Mesh.RecombinationAlgorithm", max(1, recomb_mode))
                    do_recombine = want_recomb
                else:
                    do_recombine = recombine

                gmsh.option.setNumber("Mesh.Algorithm", cfg["algo"])
                gmsh.model.mesh.generate(2)
                if do_recombine:
                    try:
                        gmsh.model.mesh.recombine()
                    except Exception:
                        pass
                if optimize_mesh:
                    for method in ("", "Netgen"):
                        try:
                            gmsh.model.mesh.optimize(method)
                        except Exception:
                            pass

                node_tags, coordinates, _ = gmsh.model.mesh.getNodes()
                node_index = {int(tag): index for index, tag in enumerate(node_tags)}
                candidate_nodes = [
                    [float(coordinates[i]), float(coordinates[i + 1]), 0.0]
                    for i in range(0, len(coordinates), 3)
                ]
                candidate_elements: List[List[int]] = []
                element_types, _, element_nodes = gmsh.model.mesh.getElements(2, surface)
                for element_type_id, flat_nodes in zip(element_types, element_nodes):
                    nodes_per_element = {2: 3, 3: 4}.get(element_type_id)
                    if not nodes_per_element:
                        continue
                    candidate_elements.extend([
                        [node_index[int(flat_nodes[i + offset])] for offset in range(nodes_per_element)]
                        for i in range(0, len(flat_nodes), nodes_per_element)
                        if all(int(flat_nodes[i + offset]) in node_index for offset in range(nodes_per_element))
                    ])
                if not candidate_elements:
                    raise ValueError("no 2D elements")

                candidate_quality = _mesh_quality(candidate_nodes, candidate_elements)
                candidate_angle = candidate_quality["min_angle_degrees"]
                has_prisms = candidate_quality["quads"] > 0 and use_prism
                # Score: raw min angle, plus a bump for keeping the requested
                # prism layer as long as it is not badly degenerate. A prism mesh
                # at ~9deg (a couple of thin cells at a sharp trailing edge) is
                # more useful for CFD than a pristine triangle-only mesh.
                candidate_score = candidate_angle + (18.0 if has_prisms and candidate_angle >= 6.0 else 0.0)
                best_score = -1.0 if best_mesh is None else (
                    best_mesh[3]["min_angle_degrees"]
                    + (18.0 if best_mesh[5] and best_mesh[3]["min_angle_degrees"] >= 6.0 else 0.0)
                )
                if best_mesh is None or candidate_score > best_score:
                    best_mesh = (cfg["algo"], candidate_nodes, candidate_elements,
                                 candidate_quality, node_index, has_prisms)
                    if attempt_index > 0:
                        best_fallback_note = (
                            f"Primary settings failed or gave slivers; used fallback "
                            f"'{_algo_name(cfg['algo'])}'."
                        )
                generated = True
                # A healthy mesh ends the ladder; a marginal one keeps trying in
                # case a later fallback is cleaner, but is still kept as backup.
                if candidate_angle >= 12.0 or (has_prisms and candidate_angle >= 8.0):
                    break
            except Exception as exc:  # pragma: no cover - depends on CAD input
                last_error = exc
                continue

        # Last resort: strip every size field and mesh with a plain uniform size.
        # Guarantees *a* mesh even when aggressive refinement settings (steep
        # growth rate, tiny local size, huge max size) make the graded size field
        # impossible for Gmsh on this particular geometry.
        if not generated or best_mesh is None:
            try:
                gmsh.model.mesh.clear()
                for stale in list(mesh_fields):
                    try:
                        gmsh.model.mesh.field.remove(stale)
                    except Exception:
                        pass
                for reset in ("setAsBackgroundMesh", "setAsBoundaryLayer"):
                    try:
                        getattr(gmsh.model.mesh.field, reset)(0)
                    except Exception:
                        pass
                uniform = max(min_size * 4.0, min(feature_size * 4.0, far_size, span / 8.0))
                gmsh.option.setNumber("Mesh.MeshSizeMin", uniform * 0.25)
                gmsh.option.setNumber("Mesh.MeshSizeMax", max(uniform * 4.0, far_size))
                gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 1)
                gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 0)
                gmsh.option.setNumber("Mesh.RecombineAll", 0)
                gmsh.option.setNumber("Mesh.Algorithm", 1)
                gmsh.model.mesh.generate(2)
                u_tags, u_coords, _ = gmsh.model.mesh.getNodes()
                u_index = {int(tag): idx for idx, tag in enumerate(u_tags)}
                u_nodes = [
                    [float(u_coords[i]), float(u_coords[i + 1]), 0.0]
                    for i in range(0, len(u_coords), 3)
                ]
                u_elements: List[List[int]] = []
                u_types, _, u_enodes = gmsh.model.mesh.getElements(2, surface)
                for u_type, u_flat in zip(u_types, u_enodes):
                    npe = {2: 3, 3: 4}.get(u_type)
                    if not npe:
                        continue
                    u_elements.extend([
                        [u_index[int(u_flat[i + o])] for o in range(npe)]
                        for i in range(0, len(u_flat), npe)
                        if all(int(u_flat[i + o]) in u_index for o in range(npe))
                    ])
                if u_elements:
                    best_mesh = (1, u_nodes, u_elements,
                                 _mesh_quality(u_nodes, u_elements), u_index, False)
                    generated = True
                    warnings.append(
                        "Refinement settings were too aggressive for this geometry - "
                        "generated a uniform mesh. Try a larger Local wall size, a lower "
                        "Growth rate, or a smaller Max size."
                    )
            except Exception as exc:
                last_error = exc

        if not generated or best_mesh is None:
            raise ValueError(f"Gmsh could not mesh this geometry: {last_error}")

        actual_algorithm, nodes, elements, quality, node_index, _ = best_mesh
        if best_fallback_note:
            warnings.append(best_fallback_note)

        boundaries: Dict[str, List[int]] = {}
        for line, name in line_metadata:
            # includeBoundary=True so a curve whose length already equals the
            # mesh size (no interior node) still contributes its end points.
            try:
                line_nodes, _, _ = gmsh.model.mesh.getNodes(1, line, includeBoundary=True)
            except TypeError:
                line_nodes, _, _ = gmsh.model.mesh.getNodes(1, line, True)
            indices = [node_index[int(tag)] for tag in line_nodes if int(tag) in node_index]
            if indices:
                boundaries.setdefault(name, []).extend(indices)
        boundaries = {name: list(dict.fromkeys(indices)) for name, indices in boundaries.items()}
        if not elements:
            raise ValueError("Gmsh generated no 2D elements.")

        if quality["min_angle_degrees"] and quality["min_angle_degrees"] < 8.0:
            warnings.append(
                f"Sliver elements present (min angle {quality['min_angle_degrees']}°); "
                "consider a finer preset or enabling optimisation."
            )
        return {
            "generator": _algo_name(actual_algorithm),
            "algorithm": _algo_name(actual_algorithm),
            "element_type": element_type,
            "warnings": warnings,
            "settings": {
                "resolution": resolution,
                "resolution_scale": scale,
                "growth_rate": growth_rate,
                "elements_per_curve": elements_per_curve,
                "far_field_size": round(far_size, 6),
                "feature_size": round(feature_size, 6),
                "min_element_size": round(min_size, 6),
                "max_element_size": round(max_size, 6),
                "first_layer_height_m": round(first_layer, 8) if first_layer else 0.0,
                "boundary_layer_thickness_m": round(thickness, 6) if thickness else 0.0,
                "proximity_refinement": use_proximity,
                "prism_layers": use_prism,
                "recombined": recombine,
                "optimized": optimize_mesh,
            },
            "num_nodes": len(nodes),
            "num_elements": len(elements),
            "nodes": nodes,
            "elements": elements,
            "boundaries": boundaries,
            "quality": quality,
        }


def _algo_name(algorithm_id: int) -> str:
    return {
        6: "Gmsh Frontal-Delaunay",
        5: "Gmsh Delaunay",
        1: "Gmsh MeshAdapt",
        8: "Gmsh Frontal-Delaunay (Quads)",
        9: "Gmsh Packing of Parallelograms",
    }.get(algorithm_id, "Gmsh")


def _one_ring8(node: int, quad_ids: List[int], quads: List[List[int]]):
    """Order the 8 nodes around an interior quad-mesh node as
    (n, s, e, w, ne, nw, sw, se). Returns None if the node is not cleanly
    surrounded by four quads."""
    if len(quad_ids) != 4:
        return None
    info = []
    for qi in quad_ids:
        q = quads[qi]
        try:
            p = q.index(node)
        except ValueError:
            return None
        info.append([q[(p - 1) % 4], q[(p + 1) % 4], q[(p + 2) % 4]])  # left, right, diag
    ordered = [info[0]]
    remaining = info[1:]
    for _ in range(3):
        right = ordered[-1][1]
        nxt = None
        for k, it in enumerate(remaining):
            if it[0] == right:
                nxt = remaining.pop(k)
                break
            if it[1] == right:
                it = [it[1], it[0], it[2]]
                remaining.pop(k)
                nxt = it
                break
        if nxt is None:
            return None
        ordered.append(nxt)
    if ordered[-1][1] != ordered[0][0]:
        return None
    r = [o[1] for o in ordered]   # edge neighbours, cyclic: r0..r3
    d = [o[2] for o in ordered]   # diagonal of quad k sits between r[k] and r[k-1]
    # r0=e, r1=n, r2=w, r3=s ; d1=ne, d2=nw, d3=sw, d0=se
    return (r[1], r[3], r[0], r[2], d[1], d[2], d[3], d[0])


def _winslow_smooth(nodes: List[List[float]], elements: List[List[int]],
                    fixed_idx: set, iterations: int = 0, omega: float = 0.65,
                    taper: int = 6, w_max: float = 0.85) -> Dict[str, Any]:
    """Elliptic (Winslow) smoothing of the free interior nodes, in place.

    Solves alpha*x_xx - 2*beta*x_xy + gamma*x_yy = 0 by damped-Jacobi relaxation
    on the 8-node stencil so grid lines flow across block seams instead of
    kinking. True geometry-boundary nodes and block corners (`fixed_idx`) never
    move. The correction is tapered back toward the transfinite position near
    fixed nodes so topological corners keep their clean quality.

    `iterations` == 0 picks a count from the mesh size (Jacobi needs ~O(grid
    width) sweeps to carry information across a block); it also stops early once
    the sweep displacement is negligible. Returns a status dict."""
    if not elements:
        return {"moved": 0, "sweeps": 0, "converged": False, "free": 0}
    quads = [e for e in elements if len(e) == 4]
    if not quads:
        return {"moved": 0, "sweeps": 0, "converged": False, "free": 0}
    n = len(nodes)
    node_quads: List[List[int]] = [[] for _ in range(n)]
    adj: List[set] = [set() for _ in range(n)]
    for q in quads:
        for a in range(4):
            adj[q[a]].add(q[(a + 1) % 4])
            adj[q[a]].add(q[(a + 3) % 4])
    for qi, q in enumerate(quads):
        for v in q:
            if 0 <= v < n:
                node_quads[v].append(qi)

    free: List[int] = []
    sten: List[Tuple[int, ...]] = []
    for i in range(n):
        if i in fixed_idx or len(node_quads[i]) != 4:
            continue
        s = _one_ring8(i, node_quads[i], quads)
        if s is not None:
            free.append(i)
            sten.append(s)
    if not free:
        return {"moved": 0, "sweeps": 0, "converged": False, "free": 0}

    # BFS layer distance of every free node from the nearest fixed node
    from collections import deque
    layer = [0] * n
    dq = deque()
    seen = set()
    for f in fixed_idx:
        if 0 <= f < n:
            dq.append(f)
            seen.add(f)
    while dq:
        u = dq.popleft()
        for v in adj[u]:
            if v not in seen:
                seen.add(v)
                layer[v] = layer[u] + 1
                dq.append(v)

    P = np.array([[nd[0], nd[1]] for nd in nodes], dtype=float)
    P0 = P.copy()
    fi = np.array(free, dtype=np.int64)
    st = np.array(sten, dtype=np.int64)  # columns: n s e w ne nw sw se
    N, S, E, W, NE, NW, SW, SE = (st[:, k] for k in range(8))

    # characteristic cell length, for the early-stop tolerance
    seg = np.linalg.norm(P[E] - P0[fi], axis=1)
    char = float(np.median(seg[seg > 0])) if np.any(seg > 0) else 1.0
    tol = 1e-3 * char

    if iterations <= 0:
        # Jacobi carries info ~one cell per sweep; a block ~sqrt(free) cells wide
        iterations = int(min(4000, max(250, 3.0 * math.sqrt(len(free)))))

    sweeps = 0
    converged = False
    for it in range(iterations):
        xN, xS, xE, xW = P[N], P[S], P[E], P[W]
        x_xi = 0.5 * (xE - xW)
        x_et = 0.5 * (xN - xS)
        alpha = np.einsum("ij,ij->i", x_et, x_et)
        beta = np.einsum("ij,ij->i", x_xi, x_et)
        gamma = np.einsum("ij,ij->i", x_xi, x_xi)
        denom = 2.0 * (alpha + gamma)
        good = denom > 1e-18
        safe = np.where(good, denom, 1.0)
        rhs = (alpha[:, None] * (xE + xW)
               + gamma[:, None] * (xN + xS)
               - 0.5 * beta[:, None] * (P[NE] - P[NW] - P[SE] + P[SW]))
        newpos = rhs / safe[:, None]
        upd = fi[good]
        delta = omega * (newpos[good] - P[upd])
        P[upd] += delta
        sweeps = it + 1
        if it % 25 == 24:
            if float(np.abs(delta).max() if delta.size else 0.0) < tol:
                converged = True
                break

    # taper the correction back toward transfinite near fixed nodes
    w = np.array([min(w_max, max(0.0, (layer[i] - 1) / float(taper))) for i in free])
    P[fi] = P0[fi] + w[:, None] * (P[fi] - P0[fi])

    moved = 0
    for i in free:
        if abs(P[i][0] - nodes[i][0]) > 1e-7 or abs(P[i][1] - nodes[i][1]) > 1e-7:
            moved += 1
        nodes[i][0] = float(P[i][0])
        nodes[i][1] = float(P[i][1])
    return {"moved": moved, "sweeps": sweeps, "converged": converged, "free": len(free)}


def _distribute_cells(total: int, lengths: List[float]) -> List[int]:
    """Split `total` cells across segments proportional to length, min 1 each.

    Used when a block side is a polyline (e.g. a wedge floor: ramp + step + flat).
    The returned counts always sum to exactly `total` so opposite block sides stay
    matched for the transfinite mesher.
    """
    n = len(lengths)
    if n == 0:
        return []
    total = max(total, n)
    span = sum(lengths) or 1.0
    raw = [total * l / span for l in lengths]
    alloc = [max(1, int(math.floor(r))) for r in raw]
    diff = total - sum(alloc)
    # hand out / take back the remainder by fractional part
    frac_order = sorted(range(n), key=lambda i: raw[i] - alloc[i], reverse=True)
    k = 0
    guard = 0
    while diff > 0:
        alloc[frac_order[k % n]] += 1
        diff -= 1
        k += 1
    while diff < 0 and guard < 100000:
        i = frac_order[k % n]
        if alloc[i] > 1:
            alloc[i] -= 1
            diff += 1
        k += 1
        guard += 1
    return alloc


def generate_structured_mesh(params: Dict[str, Any]) -> Dict[str, Any]:
    """Transfinite multiblock quad mesh from a block topology.

    params["blocking"] = {
      "edges":  [ {p0:[x,y], p1:[x,y], path:[[x,y],...], nodes:int,
                   law:'uniform'|'geometric'|'bump', ratio:float, patch?:str}, ... ],
      "blocks": [ [e0,e1,e2,e3], ... ]   # indices into edges, ordered round the block
    }
    Opposite edges of a block (0&2, 1&3) must already carry equal node counts.
    """
    bk = params.get("blocking") or {}
    edge_defs: List[Dict[str, Any]] = bk.get("edges") or []
    block_defs: List[List[int]] = bk.get("blocks") or []
    if not edge_defs or not block_defs:
        raise ValueError("No block topology was supplied for structured meshing.")

    warnings: List[str] = []

    with _gmsh_session():
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.model.add("opencfd_structured")

        def pt_key(x: float, y: float) -> Tuple[int, int]:
            return (round(x * 1e6), round(y * 1e6))

        point_cache: Dict[Tuple[int, int], int] = {}

        def add_point(x: float, y: float) -> int:
            k = pt_key(x, y)
            if k not in point_cache:
                point_cache[k] = gmsh.model.geo.addPoint(float(x), float(y), 0.0)
            return point_cache[k]

        # Each block edge becomes one or more straight sub-curves. A wedge / step
        # floor is a polyline (ramp, riser, flat), NOT a spline - a spline would
        # round the sharp corners into an S bend. The sub-curves are stored in
        # p0 -> p1 order so the block loop can walk them forward or reversed.
        edge_curves: List[List[int]] = []          # ordered sub-curve tags per edge
        edge_end_nodes: List[Tuple[int, int]] = []  # (start point tag, end point tag) per edge
        curve_meta: List[Tuple[int, str]] = []      # (curve tag, patch name)
        for e in edge_defs:
            x0, y0 = e["p0"]
            x1, y1 = e["p1"]
            path = e.get("path") or []
            nodes = max(2, int(e.get("nodes", 20)))
            law = str(e.get("law", "uniform"))
            ratio = float(e.get("ratio", 1.0)) or 1.0
            patch = str(e.get("patch") or "wall")

            raw_pts = [(float(x0), float(y0))] + [(float(p[0]), float(p[1])) for p in path] + [(float(x1), float(y1))]
            pts: List[Tuple[float, float]] = [raw_pts[0]]
            for p in raw_pts[1:]:
                if abs(p[0] - pts[-1][0]) > 1e-9 or abs(p[1] - pts[-1][1]) > 1e-9:
                    pts.append(p)
            if len(pts) < 2:
                raise ValueError("A block edge collapsed to a single point.")

            seg_count = len(pts) - 1
            lengths = [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(seg_count)]
            total_cells = max(nodes - 1, seg_count)
            if seg_count == 1:
                cell_alloc = [total_cells]
            else:
                cell_alloc = _distribute_cells(total_cells, lengths)
                if law != "uniform":
                    warnings.append(
                        f"The '{patch}' side has corners, so its {law} grading was spread evenly along it."
                    )

            subs: List[int] = []
            for i in range(seg_count):
                pa = add_point(*pts[i])
                pb = add_point(*pts[i + 1])
                c = gmsh.model.geo.addLine(pa, pb)
                n_i = cell_alloc[i] + 1
                if seg_count == 1 and law == "bump":
                    gmsh.model.geo.mesh.setTransfiniteCurve(c, n_i, "Bump", max(ratio, 0.05))
                elif seg_count == 1 and law == "geometric" and abs(ratio - 1.0) > 1e-6:
                    per = ratio ** (1.0 / max(n_i - 1, 1))
                    gmsh.model.geo.mesh.setTransfiniteCurve(c, n_i, "Progression", per)
                else:
                    gmsh.model.geo.mesh.setTransfiniteCurve(c, n_i)
                subs.append(c)
                curve_meta.append((c, patch))

            edge_curves.append(subs)
            edge_end_nodes.append((add_point(*pts[0]), add_point(*pts[-1])))

        surfaces: List[int] = []
        curve_use: Dict[int, int] = {}  # abs curve tag -> how many surfaces touch it
        block_corner_pts: set = set()   # gmsh point tags that are block corners
        for quad in block_defs:
            if len(quad) != 4:
                warnings.append("Skipped a block that did not have four edges.")
                continue

            # Walk the four edges head-to-tail, flipping any that run backwards,
            # and splice each edge's sub-curves (reversed + negated when flipped)
            # into one ordered loop. The four block corners are the join points.
            ep = [edge_end_nodes[i] for i in quad]
            signed: List[int] = []
            corners: List[int] = []
            ok = True
            cur = ep[0][0]
            for k in range(4):
                a, b = ep[k]
                subs = edge_curves[quad[k]]
                if a == cur:
                    corners.append(a)
                    signed.extend(subs)
                    cur = b
                elif b == cur:
                    corners.append(b)
                    signed.extend(-c for c in reversed(subs))
                    cur = a
                else:
                    ok = False
                    break
            if not ok or cur != ep[0][0]:
                warnings.append("A block's four edges do not form a closed loop - skipped.")
                continue

            block_corner_pts.update(corners[:4])
            loop = gmsh.model.geo.addCurveLoop(signed)
            surf = gmsh.model.geo.addPlaneSurface([loop])
            gmsh.model.geo.mesh.setTransfiniteSurface(surf, "Left", corners[:4])
            gmsh.model.geo.mesh.setRecombine(2, surf)
            surfaces.append(surf)
            for c in signed:
                curve_use[abs(c)] = curve_use.get(abs(c), 0) + 1

        if not surfaces:
            raise ValueError("No valid blocks to mesh.")

        gmsh.model.geo.synchronize()
        gmsh.model.addPhysicalGroup(2, surfaces, name="fluid")

        # Group boundary curves by patch name. A curve touched by two surfaces is
        # an interior block interface - it gets no patch and no physical group.
        by_patch: Dict[str, List[int]] = {}
        for curve, patch in curve_meta:
            if curve_use.get(curve, 0) >= 2:
                continue
            by_patch.setdefault(patch or "wall", []).append(curve)
        for patch, curves in by_patch.items():
            tag = gmsh.model.addPhysicalGroup(1, curves)
            gmsh.model.setPhysicalName(1, tag, patch)

        gmsh.option.setNumber("Mesh.RecombineAll", 1)
        gmsh.option.setNumber("Mesh.RecombinationAlgorithm", 1)
        gmsh.option.setNumber("Mesh.Smoothing", 6)
        gmsh.model.mesh.generate(2)

        node_tags, coords, _ = gmsh.model.mesh.getNodes()
        node_index = {int(t): i for i, t in enumerate(node_tags)}
        nodes = [[float(coords[i]), float(coords[i + 1]), 0.0] for i in range(0, len(coords), 3)]

        elements: List[List[int]] = []
        for surf in surfaces:
            etypes, _, enodes = gmsh.model.mesh.getElements(2, surf)
            for et, flat in zip(etypes, enodes):
                npe = {2: 3, 3: 4}.get(et)
                if not npe:
                    continue
                for i in range(0, len(flat), npe):
                    idx = [node_index.get(int(flat[i + o])) for o in range(npe)]
                    if all(v is not None for v in idx):
                        elements.append(idx)
        if not elements:
            raise ValueError("Structured mesh produced no elements - check the block topology.")

        boundaries: Dict[str, List[int]] = {}
        for dim, ptag in gmsh.model.getPhysicalGroups(1):
            name = gmsh.model.getPhysicalName(1, ptag)
            seen: List[int] = []
            for ent in gmsh.model.getEntitiesForPhysicalGroup(1, ptag):
                try:
                    ntags, _, _ = gmsh.model.mesh.getNodes(1, ent, includeBoundary=True)
                except TypeError:
                    ntags, _, _ = gmsh.model.mesh.getNodes(1, ent, True)
                for t in ntags:
                    j = node_index.get(int(t))
                    if j is not None and j not in seen:
                        seen.append(j)
            if name:
                boundaries[name] = seen

        quality = _mesh_quality(nodes, elements)

        # Elliptic (Winslow) smoothing: relax the free interior nodes - including
        # nodes on interior block interfaces - so grid lines flow smoothly across
        # block seams. True geometry-boundary nodes stay pinned. Kept only if it
        # does not make the worst cell worse.
        want_smooth = params.get("smooth") is not False
        smooth_iters = int(params.get("smoothIterations", 0))  # 0 -> auto in the smoother
        smoothed = 0
        smoothing_note = "off" if not want_smooth else "not attempted"
        if want_smooth and elements:
            fixed_idx = set()
            for idxs in boundaries.values():
                fixed_idx.update(idxs)
            # Pin every block corner - those are real topological corners where a
            # slope discontinuity is legitimate and must not be smoothed away.
            for ptag in block_corner_pts:
                try:
                    ntags, _, _ = gmsh.model.mesh.getNodes(0, ptag)
                    for t in ntags:
                        j = node_index.get(int(t))
                        if j is not None:
                            fixed_idx.add(j)
                except Exception:
                    pass
            trial = copy.deepcopy(nodes)
            info = _winslow_smooth(trial, elements, fixed_idx, iterations=smooth_iters)
            if info["free"] == 0:
                smoothing_note = "skipped: every interior node borders a block junction"
            elif info["moved"] == 0:
                smoothing_note = "skipped: nothing to relax (grid already harmonic)"
            else:
                tq = _mesh_quality(trial, elements)
                a0, a1 = quality.get("min_angle_degrees", 0), tq.get("min_angle_degrees", 0)
                dmean = tq.get("mean", 0) - quality.get("mean", 0)
                dp05 = tq.get("p05", 0) - quality.get("p05", 0)
                # Keep the smoothed grid when it is clearly smoother overall
                # (5th-percentile or mean cell quality up meaningfully) and the
                # worst cell stays healthy - never introduce a sub-20-degree
                # cell, and don't let the worst angle collapse. Grids that are
                # already boundary-fitted with no interior gain (C-grid wrap)
                # keep their transfinite form.
                if (tq.get("triangles", 0) == 0
                        and a1 >= 20.0 and a1 >= a0 - 6.0
                        and (dp05 > 0.02 or dmean > 5e-3)):
                    nodes = trial
                    quality = tq
                    smoothed = info["moved"]
                    conv = "converged" if info["converged"] else f"{info['sweeps']} sweeps"
                    smoothing_note = (
                        f"applied to {smoothed} nodes ({conv}); "
                        f"p05 {quality.get('p05', 0):.3f}, min angle {a1:.1f}"
                    )
                else:
                    smoothing_note = (
                        f"discarded: min angle {a0:.1f} -> {a1:.1f}, "
                        f"mean {dmean:+.4f}, p05 {dp05:+.4f} - transfinite grid kept"
                    )

        return {
            "generator": "Gmsh transfinite (structured)"
                         + (" + elliptic smoothing" if smoothed else ""),
            "algorithm": "Transfinite" + (" + Winslow" if smoothed else ""),
            "element_type": "quad",
            "structured": True,
            "warnings": warnings,
            "settings": {
                "blocks": len(surfaces),
                "edges": len(edge_defs),
                "smoothed_nodes": smoothed,
                "smoothing": smoothing_note,
            },
            "num_nodes": len(nodes),
            "num_elements": len(elements),
            "nodes": nodes,
            "elements": elements,
            "boundaries": boundaries,
            "quality": quality,
        }
def generate_naca0012_points(chord: float = 1.0, num_points: int = 60) -> List[Tuple[float, float]]:
    """
    Generate coordinate points for NACA 0012 airfoil.
    """
    beta = np.linspace(0, np.pi, num_points)
    # Cosine spacing for high resolution near leading edge
    x = (chord / 2.0) * (1.0 - np.cos(beta))
    
    # NACA 4-digit symmetric thickness distribution: t = 0.12
    t = 0.12
    yt = 5.0 * t * chord * (
        0.2969 * np.sqrt(np.maximum(x / chord, 0.0))
        - 0.1260 * (x / chord)
        - 0.3516 * np.power(x / chord, 2)
        + 0.2843 * np.power(x / chord, 3)
        - 0.1015 * np.power(x / chord, 4)
    )
    
    upper = list(zip(x, yt))
    lower = list(zip(x[::-1], -yt[::-1]))
    points = upper + lower[1:]
    return points

def generate_mesh_data(
    geometry_type: str,
    params: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Generates mesh nodes, triangular/quad elements, and boundary edges
    ready for both 3D/2D WebGL rendering and OpenFOAM integration.
    """
    if params.get("cadEntities"):
        return generate_mesh_from_cad_entities(params)

    nodes = []
    triangles = []
    edges = []
    boundaries = {}

    if geometry_type == "naca0012":
        chord = float(params.get("chord", 1.0))
        aoa_deg = float(params.get("angleOfAttackDeg", 0.0))
        aoa_rad = math.radians(aoa_deg)
        cos_a = math.cos(aoa_rad)
        sin_a = math.sin(aoa_rad)

        domain_l = float(params.get("domainLength", 10.0))
        domain_h = float(params.get("domainHeight", 6.0))
        res = params.get("meshResolution", "medium")
        first_layer_mm = float(params.get("firstLayerHeightMm", 0.05))

        # Generate airfoil coordinates rotated by AoA
        raw_pts = generate_naca0012_points(chord, 40 if res == "coarse" else (60 if res == "medium" else 100))
        airfoil_pts = []
        for px, py in raw_pts:
            # Center around 0.25c
            rx = px - 0.25 * chord
            ry = py
            rot_x = rx * cos_a - ry * sin_a
            rot_y = rx * sin_a + ry * cos_a
            airfoil_pts.append((rot_x, rot_y))

        # Build structured-hybrid background mesh with boundary layer clustering
        nx = 50 if res == "coarse" else (80 if res == "medium" else 120)
        ny = 30 if res == "coarse" else (50 if res == "medium" else 80)

        # Coordinate grid with geometric stretching towards airfoil
        x_raw = np.linspace(-domain_l * 0.35, domain_l * 0.65, nx)
        y_raw = np.linspace(-domain_h * 0.5, domain_h * 0.5, ny)

        # Build 2D Delaunay / Quad-Tri mesh around airfoil
        node_id_map = {}
        curr_id = 0

        # Background grid nodes
        grid_nodes = []
        for j, y_val in enumerate(y_raw):
            row = []
            for i, x_val in enumerate(x_raw):
                # Check if point is inside airfoil bounding region
                dist_to_origin = math.hypot(x_val, y_val)
                # Keep points outside airfoil envelope
                nodes.append([float(x_val), float(y_val), 0.0])
                row.append(curr_id)
                curr_id += 1
            grid_nodes.append(row)

        # Connect grid into triangles
        for j in range(ny - 1):
            for i in range(nx - 1):
                n0 = grid_nodes[j][i]
                n1 = grid_nodes[j][i + 1]
                n2 = grid_nodes[j + 1][i + 1]
                n3 = grid_nodes[j + 1][i]

                triangles.append([n0, n1, n2])
                triangles.append([n0, n2, n3])

        # Add airfoil surface boundary
        airfoil_node_ids = []
        for pt in airfoil_pts:
            nodes.append([float(pt[0]), float(pt[1]), 0.0])
            airfoil_node_ids.append(curr_id)
            curr_id += 1

        boundaries["airfoil"] = airfoil_node_ids
        boundaries["inlet"] = [grid_nodes[j][0] for j in range(ny)]
        boundaries["outlet"] = [grid_nodes[j][nx - 1] for j in range(ny)]
        boundaries["top"] = [grid_nodes[ny - 1][i] for i in range(nx)]
        boundaries["bottom"] = [grid_nodes[0][i] for i in range(nx)]

    elif geometry_type == "cylinder":
        diam = float(params.get("cylinderDiameter", 1.0))
        radius = diam / 2.0
        domain_l = float(params.get("domainLength", 12.0))
        domain_h = float(params.get("domainHeight", 6.0))
        res = params.get("meshResolution", "medium")

        nx = 50 if res == "coarse" else (80 if res == "medium" else 110)
        ny = 30 if res == "coarse" else (50 if res == "medium" else 70)

        x_raw = np.linspace(-domain_l * 0.3, domain_l * 0.7, nx)
        y_raw = np.linspace(-domain_h * 0.5, domain_h * 0.5, ny)

        grid_nodes = []
        curr_id = 0
        for j, y_val in enumerate(y_raw):
            row = []
            for i, x_val in enumerate(x_raw):
                # Repel grid points around cylinder
                r = math.hypot(x_val, y_val)
                if r < radius * 1.05 and r > 1e-4:
                    scale = (radius * 1.05) / r
                    px, py = x_val * scale, y_val * scale
                else:
                    px, py = x_val, y_val
                nodes.append([float(px), float(py), 0.0])
                row.append(curr_id)
                curr_id += 1
            grid_nodes.append(row)

        for j in range(ny - 1):
            for i in range(nx - 1):
                n0 = grid_nodes[j][i]
                n1 = grid_nodes[j][i + 1]
                n2 = grid_nodes[j + 1][i + 1]
                n3 = grid_nodes[j + 1][i]
                triangles.append([n0, n1, n2])
                triangles.append([n0, n2, n3])

        boundaries["inlet"] = [grid_nodes[j][0] for j in range(ny)]
        boundaries["outlet"] = [grid_nodes[j][nx - 1] for j in range(ny)]
        boundaries["top"] = [grid_nodes[ny - 1][i] for i in range(nx)]
        boundaries["bottom"] = [grid_nodes[0][i] for i in range(nx)]

    else:
        # Generic Channel / Cavity
        domain_l = float(params.get("domainLength", 4.0))
        domain_h = float(params.get("domainHeight", 1.0))
        nx = 40
        ny = 25
        x_raw = np.linspace(0, domain_l, nx)
        y_raw = np.linspace(0, domain_h, ny)
        grid_nodes = []
        curr_id = 0
        for j, y_val in enumerate(y_raw):
            row = []
            for i, x_val in enumerate(x_raw):
                nodes.append([float(x_val), float(y_val), 0.0])
                row.append(curr_id)
                curr_id += 1
            grid_nodes.append(row)

        for j in range(ny - 1):
            for i in range(nx - 1):
                n0 = grid_nodes[j][i]
                n1 = grid_nodes[j][i + 1]
                n2 = grid_nodes[j + 1][i + 1]
                n3 = grid_nodes[j + 1][i]
                triangles.append([n0, n1, n2])
                triangles.append([n0, n2, n3])

        boundaries["inlet"] = [grid_nodes[j][0] for j in range(ny)]
        boundaries["outlet"] = [grid_nodes[j][nx - 1] for j in range(ny)]
        boundaries["top"] = [grid_nodes[ny - 1][i] for i in range(nx)]
        boundaries["bottom"] = [grid_nodes[0][i] for i in range(nx)]

    return {
        "num_nodes": len(nodes),
        "num_elements": len(triangles),
        "nodes": nodes,
        "elements": triangles,
        "boundaries": boundaries
    }
