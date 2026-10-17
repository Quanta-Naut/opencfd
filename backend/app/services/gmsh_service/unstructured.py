import math
from typing import Any, Dict, List, Tuple

import gmsh

from .session import _gmsh_session
from .geometry import (
    _clean_loop,
    _condition_wall_loop,
    _entity_points,
    _join_segmented_loops,
    _propagate_axis_to_collinear_edges,
    _signed_area,
)
from .quality import _mesh_quality
from .smoothing import _winslow_smooth

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

    # Propagate axis tags across collinear edges on all loops (covers both rebuilt and pre-closed polylines)
    for loop in loops:
        loop_entity_id = str(loop["entity"].get("id", "boundary"))
        _propagate_axis_to_collinear_edges(loop["points"], loop_entity_id, joined_edge_tags)

    axisymmetric = "axis" in {str(v).strip().lower() for v in joined_edge_tags.values()}

    def _loop_has_axis(loop_entry: Dict[str, Any]) -> bool:
        loop_id = str(loop_entry["entity"].get("id", "boundary"))
        for k, v in joined_edge_tags.items():
            if str(v).strip().lower() == "axis" and k.startswith(f"{loop_id}_"):
                return True
        return False

    domain_loops = [loop for loop in loops if loop["entity"].get("role") == "domain_boundary"]
    if axisymmetric:
        # In axisymmetric flow, the domain boundary is the profile containing the axis.
        axis_domain_loops = [loop for loop in domain_loops if _loop_has_axis(loop)]
        if axis_domain_loops:
            outer = max(axis_domain_loops, key=lambda loop: loop["area"])
        else:
            axis_loops = [loop for loop in loops if _loop_has_axis(loop)]
            if axis_loops:
                outer = max(axis_loops, key=lambda loop: loop["area"])
            else:
                outer = max(domain_loops or loops, key=lambda loop: loop["area"])
    else:
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
        if loop["entity"].get("type") in {"circle", "ellipse"}:
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

        aoa_rad = math.radians(float(params.get("angleOfAttackDeg", 0.0) or 0.0))
        flow_dir = (math.cos(aoa_rad), math.sin(aoa_rad))
        internal_flow = str(params.get("flowType", "external")).lower() == "internal"
        _supersonic = (
            str(params.get("compressibility", "")).lower() == "compressible"
            and str(params.get("speedRegime", "")).lower() in ("supersonic", "hypersonic")
        )

        def _auto_domain_patch(p0: Tuple[float, float], p1: Tuple[float, float]) -> str:
            """Classify an untagged outer-domain edge by its outward normal so the
            solver always gets a complete inlet/outlet/side patch set even when
            the user forgot to tag an edge. Mirrors the frontend auto-suggest.
            Never auto-classifies 'axis' - that tag is manual-only, since
            getting it wrong silently produces a planar (not axisymmetric)
            solution rather than an obvious error."""
            dx, dy = p1[0] - p0[0], p1[1] - p0[1]
            length = math.hypot(dx, dy) or 1e-9
            # outer loop is wound CCW here, so the outward normal is (dy, -dx).
            nx, ny = dy / length, -dx / length
            dot = nx * flow_dir[0] + ny * flow_dir[1]
            if dot < -0.35:
                return "inlet"
            if dot > 0.35:
                return "outlet"
            if internal_flow:
                return "wall"
            # A `symmetry` plane reflects a shock straight back into the domain.
            # For supersonic external flow the lateral boundary must be a
            # non-reflecting far-field instead.
            return "farfield" if _supersonic else "symmetry"

        def add_loop(loop: Dict[str, Any], point_size: float, reverse: bool = False,
                     outer_domain: bool = False
                     ) -> Tuple[int, List[int], List[int]]:
            entity_id = loop["entity"].get("id", "boundary")
            # A circle is one patch keyed at "<id>_0" (see the wall scan above).
            circle_tag = (
                edge_tags.get(f"{entity_id}_0")
                if loop["entity"].get("type") in {"circle", "ellipse"} else None
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
            n_pts = len(point_tags)
            for index, start in enumerate(point_tags):
                line = gmsh.model.geo.addLine(start, point_tags[(index + 1) % len(point_tags)])
                line_tags.append(line)
                all_lines.append(line)
                # `edge_tags` keys are "<entity>_<i>" for the ORIGINAL (pre-reverse)
                # edge i = original point i -> point (i+1). Reversing `pairs` above
                # to fix the loop's winding also reverses which original edge each
                # new position corresponds to - without this remap, an explicit
                # tag silently lands on the wrong edge whenever a hand-drawn loop
                # happens to wind clockwise (reverse=True).
                orig_index = (n_pts - 2 - index) % n_pts if reverse else index
                tag = circle_tag if circle_tag is not None else edge_tags.get(f"{entity_id}_{orig_index}")
                if tag:
                    t_str = str(tag).strip()
                    name = t_str.lower() if t_str.lower() in {"axis", "inlet", "outlet", "wall", "symmetry", "farfield"} else t_str
                elif outer_domain:
                    name = _auto_domain_patch(
                        points[index], points[(index + 1) % len(points)]
                    )
                else:
                    name = entity_id
                line_metadata.append((line, name))
            return gmsh.model.geo.addCurveLoop(line_tags), line_tags, point_tags

        # Plane surfaces require the outer loop to be CCW and holes to be CW.
        # Normalize both explicitly because imported CAD loops often share a
        # winding direction regardless of whether they are holes.
        outer_loop, _, _ = add_loop(
            outer, far_size,
            reverse=_signed_area(outer["points"]) < 0,
            outer_domain=bool(domain_loops),
        )
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
        # For a quad request the final rung must degrade to quad-dominant
        # recombination (recomb=1), never recomb=0.
        final_recomb = 1 if recombine else (0 if element_type != "hybrid" else -1)
        attempts.append({"algo": 1, "keep_bl": False, "recomb": final_recomb})
        if recombine:
            # Fall to pure triangles only if every recombined attempt raised an
            # exception or produced no elements.
            attempts.append({"algo": 1, "keep_bl": False, "recomb": 0, "emergency_tri": True})

        generated = False
        last_error: Any = None
        best_mesh: Any = None
        best_score = -1.0
        best_fallback_note = ""
        for attempt_index, cfg in enumerate(attempts):
            if cfg.get("emergency_tri") and best_mesh is not None:
                continue
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
                        try:
                            gmsh.model.mesh.setRecombine(2, surface)
                        except Exception:
                            pass
                    else:
                        try:
                            gmsh.model.mesh.removeConstraints([(2, surface)])
                        except Exception:
                            pass
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
                quad_frac = candidate_quality.get("quad_fraction", 0.0)

                # Element-type-aware scoring:
                # - When element_type is "quad" or "quad_dominant", strongly prefer
                #   meshes that are actually mostly quads. A recombined mesh that is
                #   >= ~70% quads with an acceptable min angle (>= 6 deg) must beat a
                #   pure-triangle candidate with a better angle (max triangle min angle
                #   is at most 60 deg). Raw min angle acts as the tie-breaker.
                # - For "hybrid", keep the existing prism bonus (+18.0) if prisms are
                #   present and min angle >= 6.0 deg.
                # - For "tri", raw min-angle is the sole criterion.
                if recombine:
                    quad_bonus = (100.0 * quad_frac) if candidate_angle >= 6.0 else 0.0
                    candidate_score = candidate_angle + quad_bonus
                elif element_type == "hybrid":
                    candidate_score = candidate_angle + (18.0 if has_prisms and candidate_angle >= 6.0 else 0.0)
                else:
                    candidate_score = candidate_angle

                if best_mesh is None or candidate_score > best_score:
                    best_score = candidate_score
                    best_mesh = (cfg["algo"], candidate_nodes, candidate_elements,
                                 candidate_quality, node_index, has_prisms)
                    if attempt_index > 0:
                        if cfg.get("emergency_tri"):
                            best_fallback_note = (
                                "Recombined quad meshing failed; used triangle fallback "
                                f"'{_algo_name(cfg['algo'])}'."
                            )
                        else:
                            best_fallback_note = (
                                f"Primary settings failed or gave slivers; used fallback "
                                f"'{_algo_name(cfg['algo'])}'."
                            )
                generated = True

                # A healthy mesh ends the ladder; a marginal one keeps trying in
                # case a later fallback is cleaner, but is still kept as backup.
                if recombine:
                    healthy_mesh = quad_frac >= 0.70 and candidate_angle >= 8.0
                elif has_prisms:
                    healthy_mesh = candidate_angle >= 8.0
                else:
                    healthy_mesh = candidate_angle >= 12.0

                if healthy_mesh:
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
                gmsh.option.setNumber("Mesh.RecombineAll", 1 if recombine else 0)
                if recombine:
                    gmsh.option.setNumber("Mesh.RecombinationAlgorithm", 3 if element_type == "quad" else 1)
                gmsh.option.setNumber("Mesh.Algorithm", 1)
                gmsh.model.mesh.generate(2)
                if recombine:
                    try:
                        gmsh.model.mesh.recombine()
                    except Exception:
                        pass
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
                if not u_elements and recombine:
                    # If recombined uniform meshing yielded no elements, retry as pure triangles
                    gmsh.model.mesh.clear()
                    gmsh.option.setNumber("Mesh.RecombineAll", 0)
                    try:
                        gmsh.model.mesh.removeConstraints([(2, surface)])
                    except Exception:
                        pass
                    gmsh.option.setNumber("Mesh.Algorithm", 1)
                    gmsh.model.mesh.generate(2)
                    u_tags, u_coords, _ = gmsh.model.mesh.getNodes()
                    u_index = {int(tag): idx for idx, tag in enumerate(u_tags)}
                    u_nodes = [
                        [float(u_coords[i]), float(u_coords[i + 1]), 0.0]
                        for i in range(0, len(u_coords), 3)
                    ]
                    u_elements = []
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
                if recombine:
                    try:
                        gmsh.model.mesh.clear()
                        gmsh.option.setNumber("Mesh.RecombineAll", 0)
                        try:
                            gmsh.model.mesh.removeConstraints([(2, surface)])
                        except Exception:
                            pass
                        gmsh.option.setNumber("Mesh.Algorithm", 1)
                        gmsh.model.mesh.generate(2)
                        u_tags, u_coords, _ = gmsh.model.mesh.getNodes()
                        u_index = {int(tag): idx for idx, tag in enumerate(u_tags)}
                        u_nodes = [
                            [float(u_coords[i]), float(u_coords[i + 1]), 0.0]
                            for i in range(0, len(u_coords), 3)
                        ]
                        u_elements = []
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
                    except Exception as inner_exc:
                        last_error = inner_exc
                else:
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

        if axisymmetric:
            axis_idx = boundaries.get("axis") or []
            if not axis_idx:
                raise ValueError(
                    "axisymmetric case has no 'axis' tagged edge - tag the "
                    "centerline edge of the domain as 'axis'"
                )
            axis_id_set = set(axis_idx)
            axis_ys = [nodes[i][1] for i in axis_idx]
            axis_y_mean = sum(axis_ys) / len(axis_ys)
            axis_y_spread = max(axis_ys) - min(axis_ys)
            # Compare the wobble to the geometry's own radius, not the
            # (possibly much longer) axial length - a hand-drawn centerline
            # can easily wobble a percent or two of the radius without
            # anything actually being wrong; every axis node is forced to
            # exactly y = 0 below regardless, which absorbs that fine. Only
            # reject a wobble big enough to mean the wrong edge got tagged.
            radial_scale = max(domain_height, 1e-6)
            if axis_y_spread > radial_scale * 0.25:
                raise ValueError(
                    "the 'axis' edge isn't straight enough to be a "
                    f"centerline (it varies by {axis_y_spread:.4g} m across "
                    "its length) - check that only the true centerline edge "
                    "is tagged 'axis'"
                )
            # The sketch canvas has no reason to be centered on the world
            # origin - normalise so the tagged axis actually sits at y = 0,
            # which the wedge revolve (mesh_bridge.py) assumes. Forcing the
            # user to draw at exactly y = 0 instead would just reintroduce
            # the kind of pixel-precision snapping annoyance already removed
            # from freehand drawing.
            if abs(axis_y_mean) > 1e-9:
                nodes = [[p[0], p[1] - axis_y_mean] for p in nodes]
                warnings.append(
                    f"Axisymmetric: the sketch was shifted {-axis_y_mean:.4g} m "
                    "so the tagged axis edge sits exactly on the centerline."
                )
            # Only non-axis points need to sit above the centerline - axis
            # nodes themselves get forced to exactly y = 0 in the revolve
            # (mesh_bridge.py) no matter how they wobbled around the mean.
            non_axis_ys = [p[1] for i, p in enumerate(nodes) if i not in axis_id_set]
            min_y_after = min(non_axis_ys) if non_axis_ys else 0.0
            if min_y_after < -radial_scale * 0.02:
                raise ValueError(
                    "axisymmetric geometry has points on both sides of the "
                    "tagged 'axis' edge - draw only the half cross-section "
                    "above the centerline"
                )

        if quality["min_angle_degrees"] and quality["min_angle_degrees"] < 8.0:
            warnings.append(
                f"Sliver elements present (min angle {quality['min_angle_degrees']}°); "
                "consider a finer preset or enabling optimisation."
            )

        has_quads = quality.get("quads", 0) > 0
        actually_recombined = bool(recombine and has_quads)
        if recombine and not has_quads:
            warnings.append(
                f"'{element_type}' mesh requested, but recombination produced no quad elements; "
                "a triangle mesh was generated as fallback."
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
                "recombined": actually_recombined,
                "quad_fraction": quality.get("quad_fraction", 0.0),
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


