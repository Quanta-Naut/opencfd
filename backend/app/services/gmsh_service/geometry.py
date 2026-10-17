import math
from typing import Any, Dict, List, Tuple

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

    if entity.get("type") == "ellipse" and entity.get("rx") is not None and entity.get("ry") is not None:
        center = entity.get("pts", [])[0]
        center_x = float(center["x"] if isinstance(center, dict) else center[0])
        center_y = float(center["y"] if isinstance(center, dict) else center[1])
        rx = abs(float(entity["rx"]))
        ry = abs(float(entity["ry"]))
        rotation = float(entity.get("rotation", 0) or 0)
        cos_rot = math.cos(rotation)
        sin_rot = math.sin(rotation)
        pts = []
        for index in range(64):
            ang = 2 * math.pi * index / 64
            lx = rx * math.cos(ang)
            ly = ry * math.sin(ang)
            pts.append((
                center_x + lx * cos_rot - ly * sin_rot,
                center_y + lx * sin_rot + ly * cos_rot,
            ))
        return pts

    # Open linework is not a valid 2D surface boundary. Domain rectangles,
    # imported closed polylines and sketches marked isClosed are valid loops.
    if not entity.get("isClosed") and entity.get("type") not in {"rectangle"} and entity.get("role") != "domain_boundary":
        return []
    return _clean_loop(entity.get("pts", []))


def _propagate_axis_to_collinear_edges(
    loop_pts: List[Tuple[float, float]],
    entity_id: str,
    edge_tags: Dict[str, Any],
) -> None:
    """Propagate the 'axis' boundary tag across contiguous collinear edges.

    Hand-drawn centerlines are frequently drawn as multiple separate segments
    (or a polyline with multiple collinear edges) where the user only tagged one
    segment as 'axis'. The true axisymmetric centerline spans all contiguous
    collinear segments along the same line; any untagged collinear neighbour is
    part of the same physical axis, not an auto-classified wall.
    """
    n_edges = len(loop_pts)
    if n_edges < 3:
        return
    axis_edges = [
        e_idx for e_idx in range(n_edges)
        if str(edge_tags.get(f"{entity_id}_{e_idx}", "")).strip().lower() == "axis"
    ]
    if not axis_edges:
        return

    def edge_vec(k: int) -> Tuple[float, float]:
        p_a = loop_pts[k]
        p_b = loop_pts[(k + 1) % n_edges]
        return (p_b[0] - p_a[0], p_b[1] - p_a[1])

    def is_collinear(v1: Tuple[float, float], v2: Tuple[float, float]) -> bool:
        len1 = math.hypot(*v1)
        len2 = math.hypot(*v2)
        if len1 < 1e-12 or len2 < 1e-12:
            return False
        cross = abs(v1[0] * v2[1] - v1[1] * v2[0]) / (len1 * len2)
        dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (len1 * len2)
        return cross < 0.05 and dot > 0.95

    for ax_k in list(axis_edges):
        # Forward propagation
        curr = ax_k
        while True:
            nxt = (curr + 1) % n_edges
            if f"{entity_id}_{nxt}" in edge_tags and str(edge_tags[f"{entity_id}_{nxt}"]).strip().lower() != "axis":
                break
            if is_collinear(edge_vec(curr), edge_vec(nxt)):
                edge_tags[f"{entity_id}_{nxt}"] = "axis"
                curr = nxt
            else:
                break
        # Backward propagation
        curr = ax_k
        while True:
            prv = (curr - 1) % n_edges
            if f"{entity_id}_{prv}" in edge_tags and str(edge_tags[f"{entity_id}_{prv}"]).strip().lower() != "axis":
                break
            if is_collinear(edge_vec(prv), edge_vec(curr)):
                edge_tags[f"{entity_id}_{prv}"] = "axis"
                curr = prv
            else:
                break


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
    candidates = [
        entity for entity in entities
        if entity.get("type") == "line" and entity.get("layer") != "construction" and len(entity.get("pts", [])) >= 2
    ]
    if not candidates:
        return entities, edge_tags

    def point(raw: Any) -> Tuple[float, float]:
        return (float(raw["x"]), float(raw["y"])) if isinstance(raw, dict) else (float(raw[0]), float(raw[1]))

    all_pts = [point(p) for ent in entities if ent.get("layer") != "construction" for p in ent.get("pts", [])]
    if all_pts:
        span_x = max(p[0] for p in all_pts) - min(p[0] for p in all_pts)
        span_y = max(p[1] for p in all_pts) - min(p[1] for p in all_pts)
        span = max(span_x, span_y, 0.1)
    else:
        span = 1.0

    span_tol = span * 1e-3
    tolerance = max(1e-6, min(5e-3, max(1e-3 if span >= 0.5 else 1e-4, span_tol)))

    consumed: set[int] = set()
    closed_segment_indices: set[int] = set()
    rebuilt: List[Dict[str, Any]] = []

    for seed_index, seed in enumerate(candidates):
        if seed_index in consumed:
            continue
        start = point(seed["pts"][0])
        chain = [start, point(seed["pts"][1])]
        consumed.add(seed_index)
        traversed = [seed_index]
        # edge_seg_ids[k] = source entity id that became edge k of the rebuilt loop
        edge_seg_ids: List[Any] = [seed.get("id")]
        while math.hypot(chain[-1][0] - chain[0][0], chain[-1][1] - chain[0][1]) > tolerance:
            best_dist = tolerance
            next_index = None
            next_point = None
            for index, candidate in enumerate(candidates):
                if index in consumed:
                    continue
                p0, p1 = point(candidate["pts"][0]), point(candidate["pts"][1])
                d0 = math.hypot(p0[0] - chain[-1][0], p0[1] - chain[-1][1])
                if d0 <= best_dist:
                    best_dist = d0
                    next_index, next_point = index, p1
                d1 = math.hypot(p1[0] - chain[-1][0], p1[1] - chain[-1][1])
                if d1 <= best_dist:
                    best_dist = d1
                    next_index, next_point = index, p0
            if next_index is None:
                break
            consumed.add(next_index)
            traversed.append(next_index)
            chain.append(next_point)
            edge_seg_ids.append(candidates[next_index].get("id"))

        if len(chain) >= 4 and math.hypot(chain[-1][0] - chain[0][0], chain[-1][1] - chain[0][1]) <= tolerance:
            closed_segment_indices.update(traversed)
            new_id = seed.get("id", "boundary")
            rebuilt_pts = [{"x": x, "y": y} for x, y in chain[:-1]]
            rebuilt.append({
                **seed,
                "type": "polyline",
                "isClosed": True,
                "pts": rebuilt_pts,
            })
            # Move each source segment's tag ("<segId>_0") onto "<newId>_<edgeIdx>".
            for edge_idx, seg_id in enumerate(edge_seg_ids):
                for key in (f"{seg_id}_0", f"{seg_id}_-1"):
                    if key in edge_tags:
                        edge_tags[f"{new_id}_{edge_idx}"] = edge_tags[key]
                        break
            _propagate_axis_to_collinear_edges(
                [(float(p["x"]), float(p["y"])) for p in rebuilt_pts],
                new_id,
                edge_tags,
            )
        else:
            consumed.difference_update(traversed)

    # A closed reconstruction replaces its source segments; leave unrelated
    # open CAD lines intact so they can still be diagnosed/ignored explicitly.
    remaining = [entity for entity in entities if entity not in candidates]
    remaining.extend(entity for index, entity in enumerate(candidates) if index not in closed_segment_indices)
    return remaining + rebuilt, edge_tags



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


