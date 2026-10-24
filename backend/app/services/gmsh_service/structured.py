import math
from typing import Any, Dict, List, Optional, Tuple

import gmsh
import numpy as np

from .session import _gmsh_session
from .quality import _mesh_quality
from .smoothing import _winslow_smooth
from .elliptic import reconstruct_block_grid, thomas_middlecoff_smooth

def _law_cell_sizes(n_cells: int, law: str, ratio: float) -> List[float]:
    """`n_cells` cell-size fractions (summing to 1) along a unit edge under the
    grading law. `ratio` = last cell / first cell for 'geometric'; for 'bump'
    < 1 clusters cells at BOTH ends, > 1 clusters them in the middle.

    Shared by the structured edge distributor - the single source of truth for
    what a law means, so a polyline (curved) edge grades exactly like a single
    straight one.
    """
    n = max(1, int(n_cells))
    if n == 1:
        return [1.0]
    if law == "geometric" and abs(ratio - 1.0) > 1e-6:
        q = max(ratio, 1e-6) ** (1.0 / (n - 1))
        w = [q ** k for k in range(n)]
    elif law == "bump":
        r = max(ratio, 0.02)
        w = []
        for k in range(n):
            u = (k + 0.5) / n
            w.append(r ** (1.0 - 2.0 * min(u, 1.0 - u)))
    else:
        w = [1.0] * n
    # Floor so an extreme ratio on a short edge can't produce a sub-micron cell
    # that collapses under the point-key rounding (1e-6).
    w = [max(x, 5e-4) for x in w]
    s = sum(w) or 1.0
    return [x / s for x in w]


def _station_fracs(stations: Optional[List[float]], n_cells: int) -> Optional[List[float]]:
    """Cell-size fractions from explicit node stations (cumulative arc-length
    fractions 0..1, one per node), or None if they don't fit `n_cells`. The
    client sends these for an edge whose nodes mirror the wall opposite it by
    projection along the wall normals, which no grading law can express."""
    if not stations or len(stations) != n_cells + 1:
        return None
    st = [float(x) for x in stations]
    if abs(st[0]) > 1e-6 or abs(st[-1] - 1.0) > 1e-6:
        return None
    fr = [st[k + 1] - st[k] for k in range(n_cells)]
    if any(f <= 0 for f in fr):
        return None
    return fr


def _distribute_nodes_on_polyline(
    pts: List[Tuple[float, float]],
    n_cells: int,
    law: str,
    ratio: float,
    stations: Optional[List[float]] = None,
) -> List[Tuple[float, float]]:
    """Place `n_cells + 1` points along the polyline `pts` by arc length, spaced
    per the grading law. A node is snapped exactly onto any sharp interior
    corner (turn > 35 deg) so a wedge / step floor keeps its crease.

    The polyline may be a densely sampled curve (a wall-hugging block edge) or a
    few straight segments (a wedge floor) - either way the result has exactly
    `n_cells` cells, so opposite block edges (equal `nodes`) always match for the
    transfinite mesher.
    """
    n_cells = max(1, int(n_cells))
    cum = [0.0]
    for i in range(len(pts) - 1):
        cum.append(cum[-1] + math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]))
    total_len = cum[-1]
    if total_len < 1e-12:
        return [pts[0], pts[-1]]

    fracs = _station_fracs(stations, n_cells) or _law_cell_sizes(n_cells, law, ratio)
    s = [0.0]
    for f in fracs:
        s.append(s[-1] + f * total_len)
    s[-1] = total_len

    # sharp interior corners -> arc-length positions a node must land on.
    # Threshold depends on whether `pts` looks like a hand-drawn/parametric
    # polyline (a handful of points, each one a deliberate vertex - e.g. a
    # nozzle wall's throat/exit-lip kink) or a densely resampled smooth curve
    # (an airfoil or circle outline, 64-220+ points, where most inter-segment
    # turns are just curve-sampling noise and must NOT be snapped onto, or a
    # sharp nose's own natural curvature gets treated as a false corner and
    # wrecks the grading there). A real polyline vertex is kept regardless of
    # how shallow its angle is - it's not a few degrees of sampling noise,
    # it's the only point describing that feature at all - while a resampled
    # curve keeps the original, conservative 35deg so true sampling noise
    # (a few degrees per segment, even sub-degree in a leading-edge region
    # dense enough to need it) stays ignored.
    corner_threshold = 2.0 if len(pts) <= 40 else 35.0
    corners: List[float] = []
    for i in range(1, len(pts) - 1):
        ax, ay = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
        bx, by = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
        na, nb = math.hypot(ax, ay), math.hypot(bx, by)
        if na < 1e-12 or nb < 1e-12:
            continue
        cos_t = max(-1.0, min(1.0, (ax * bx + ay * by) / (na * nb)))
        if math.degrees(math.acos(cos_t)) > corner_threshold:
            corners.append(cum[i])
    for sc in corners:
        best_j, best_d = None, 1e18
        for j in range(1, len(s) - 1):
            d = abs(s[j] - sc)
            if d < best_d:
                best_d, best_j = d, j
        if best_j is not None:
            s[best_j] = sc
    s.sort()
    for j in range(1, len(s)):
        if s[j] <= s[j - 1]:
            s[j] = min(total_len, s[j - 1] + total_len * 1e-6)

    out: List[Tuple[float, float]] = []
    seg = 0
    for sv in s:
        while seg < len(cum) - 2 and cum[seg + 1] < sv:
            seg += 1
        seg_len = cum[seg + 1] - cum[seg]
        f = 0.0 if seg_len < 1e-12 else max(0.0, min(1.0, (sv - cum[seg]) / seg_len))
        out.append((
            pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * f,
            pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * f,
        ))
    return out



def generate_structured_mesh(params: Dict[str, Any]) -> Dict[str, Any]:
    """Transfinite multiblock quad mesh from a block topology.

    params["blocking"] = {
      "edges":  [ {p0:[x,y], p1:[x,y], path:[[x,y],...], nodes:int,
                   law:'uniform'|'geometric'|'bump', ratio:float, patch?:str,
                   stations?:[0..1 per node] (overrides the law)}, ... ],
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

        # Each block edge becomes exactly `nodes - 1` straight sub-curves, one
        # per cell. The node POSITIONS are pre-distributed along the edge's arc
        # length by the grading law (`_distribute_nodes_on_polyline`), so the
        # curve geometry (a densely sampled wall) is decoupled from the cell
        # count: opposite block edges carry equal `nodes` and therefore always
        # get matching discretisation for the transfinite surface, whatever the
        # path sampling. Each sub-curve is a plain 2-node transfinite segment -
        # no per-curve Progression, the spacing is already in the point layout.
        # A wedge / step floor keeps its crease because a node is snapped onto
        # every sharp interior corner.
        edge_curves: List[List[int]] = []          # ordered sub-curve tags per edge
        edge_end_nodes: List[Tuple[int, int]] = []  # (start point tag, end point tag) per edge
        edge_node_pts: List[List[Tuple[float, float]]] = []  # distributed points per edge (p0..p1)
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

            n_cells = max(1, nodes - 1)
            node_pts = _distribute_nodes_on_polyline(pts, n_cells, law, ratio, e.get("stations"))

            subs: List[int] = []
            prev_tag = add_point(*node_pts[0])
            for i in range(1, len(node_pts)):
                cur_tag = add_point(*node_pts[i])
                if cur_tag == prev_tag:
                    continue
                c = gmsh.model.geo.addLine(prev_tag, cur_tag)
                gmsh.model.geo.mesh.setTransfiniteCurve(c, 2)
                subs.append(c)
                curve_meta.append((c, patch))
                prev_tag = cur_tag

            if not subs:
                raise ValueError("A block edge produced no sub-curves.")

            edge_curves.append(subs)
            edge_end_nodes.append((add_point(*node_pts[0]), add_point(*node_pts[-1])))
            edge_node_pts.append(node_pts)

        surfaces: List[int] = []
        curve_use: Dict[int, int] = {}  # abs curve tag -> how many surfaces touch it
        block_corner_pts: set = set()   # gmsh point tags that are block corners
        # Per-surface boundary point sequences in a consistent (bottom, right,
        # top, left) convention - bottom[0]==left[0], bottom[-1]==right[0],
        # top[0]==left[-1], top[-1]==right[-1] - so each block's interior can
        # be regenerated later as a plain (ni,nj) logical grid for elliptic
        # smoothing, independent of Gmsh's own transfinite node placement.
        block_sides: Dict[int, Tuple[List[Tuple[float, float]], ...]] = {}
        for quad in block_defs:
            if len(quad) != 4:
                warnings.append("Skipped a block that did not have four edges.")
                continue

            # Walk the four edges head-to-tail, flipping any that run backwards,
            # and splice each edge's sub-curves (reversed + negated when flipped)
            # into one ordered loop. The four block corners are the join points.
            # The first edge may be stored either way round (a block drawn or
            # merged by hand reuses its neighbours' edges as they are), so try
            # starting the walk from each of its two ends.
            ep = [edge_end_nodes[i] for i in quad]
            ok = False
            for start in (ep[0][0], ep[0][1]):
                signed: List[int] = []
                corners: List[int] = []
                side_pts: List[List[Tuple[float, float]]] = []
                cur = start
                walked = True
                for k in range(4):
                    a, b = ep[k]
                    subs = edge_curves[quad[k]]
                    pts_k = edge_node_pts[quad[k]]
                    if a == cur:
                        corners.append(a)
                        signed.extend(subs)
                        side_pts.append(pts_k)
                        cur = b
                    elif b == cur:
                        corners.append(b)
                        signed.extend(-c for c in reversed(subs))
                        side_pts.append(list(reversed(pts_k)))
                        cur = a
                    else:
                        walked = False
                        break
                if walked and cur == start:
                    ok = True
                    break
            if not ok:
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
            block_sides[surf] = (
                side_pts[0], side_pts[1], list(reversed(side_pts[2])), list(reversed(side_pts[3])),
            )  # bottom, right, top, left

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
        surface_elements: Dict[int, List[List[int]]] = {}
        for surf in surfaces:
            etypes, _, enodes = gmsh.model.mesh.getElements(2, surf)
            this_surf: List[List[int]] = []
            for et, flat in zip(etypes, enodes):
                npe = {2: 3, 3: 4}.get(et)
                if not npe:
                    continue
                for i in range(0, len(flat), npe):
                    idx = [node_index.get(int(flat[i + o])) for o in range(npe)]
                    if all(v is not None for v in idx):
                        elements.append(idx)
                        this_surf.append(idx)
            surface_elements[surf] = this_surf
        if not elements:
            raise ValueError("Structured mesh produced no elements - check the block topology.")

        # Per-block elliptic (Thomas-Middlecoff) pass: fixes non-orthogonality
        # where one side of a block is much more curved than its opposite side
        # (e.g. an airfoil surface vs. a far-field arc) - plain transfinite
        # interpolation blends parametric position only, with no idea either
        # curve is curved, so cells near the sharp side come out badly skewed
        # (confirmed on a real C-grid: 2.9deg minimum angle). Runs per block,
        # all four of THAT block's own edges held fixed (including edges
        # shared with a neighbour), independent of the global Winslow pass
        # below (which instead smooths ACROSS shared edges once they're each
        # already well-shaped). Kept per block only if it doesn't make that
        # block's own worst cell worse.
        tm_notes: List[str] = []
        for surf, (bottom, right, top, left) in block_sides.items():
            surf_elems = surface_elements.get(surf) or []
            if len(surf_elems) < 4:
                continue
            bottom_row = [node_index[gmsh.model.mesh.getNodes(0, add_point(*p))[0][0]] for p in bottom]
            ni, nj = len(bottom), len(left)
            grid_idx = reconstruct_block_grid(bottom_row, surf_elems, nj)
            if grid_idx is None:
                continue
            # sanity-check the reconstruction against the independently-known
            # top/left/right rows before trusting it with any node positions
            recon_top = [grid_idx[nj - 1][i] for i in range(ni)]
            recon_left = [grid_idx[j][0] for j in range(nj)]
            recon_right = [grid_idx[j][ni - 1] for j in range(nj)]
            expect_top = [node_index[gmsh.model.mesh.getNodes(0, add_point(*p))[0][0]] for p in top]
            expect_left = [node_index[gmsh.model.mesh.getNodes(0, add_point(*p))[0][0]] for p in left]
            expect_right = [node_index[gmsh.model.mesh.getNodes(0, add_point(*p))[0][0]] for p in right]
            if recon_top != expect_top or recon_left != expect_left or recon_right != expect_right:
                continue
            q_before = _mesh_quality(nodes, surf_elems)
            smoothed = thomas_middlecoff_smooth(
                np.array(bottom), np.array(top), np.array(left), np.array(right),
            )
            # Only ever reassigns trial[idx] wholesale below (never mutates an
            # existing node's [x, y, z] list in place), so a shallow copy of the
            # outer list is enough - unlike the Winslow trial further down,
            # which relaxes node coordinates in place and needs its own node lists.
            trial = list(nodes)
            for j in range(1, nj - 1):
                for i in range(1, ni - 1):
                    idx = grid_idx[j][i]
                    trial[idx] = [float(smoothed[i, j, 0]), float(smoothed[i, j, 1]), 0.0]
            q_after = _mesh_quality(trial, surf_elems)
            a0 = q_before.get("min_angle_degrees", 0.0)
            a1 = q_after.get("min_angle_degrees", 0.0)
            if q_after.get("triangles", 0) == 0 and a1 > a0:
                nodes = trial
                tm_notes.append(f"block: min angle {a0:.1f} -> {a1:.1f}")
        quality = _mesh_quality(nodes, elements)

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
            trial = [list(nd) for nd in nodes]  # nodes are flat [x, y, z] lists
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
                         + (" + Thomas-Middlecoff" if tm_notes else "")
                         + (" + elliptic smoothing" if smoothed else ""),
            "algorithm": ("Transfinite"
                          + (" + Thomas-Middlecoff" if tm_notes else "")
                          + (" + Winslow" if smoothed else "")),
            "element_type": "quad",
            "structured": True,
            "warnings": warnings,
            "settings": {
                "blocks": len(surfaces),
                "edges": len(edge_defs),
                "smoothed_nodes": smoothed,
                "smoothing": smoothing_note,
                "thomas_middlecoff": "; ".join(tm_notes) if tm_notes else "not applied",
            },
            "num_nodes": len(nodes),
            "num_elements": len(elements),
            "nodes": nodes,
            "elements": elements,
            "boundaries": boundaries,
            "quality": quality,
        }
