"""Turn the 2D Gmsh mesh OpenCFD generates into a one-cell-thick 3D mesh that
`gmshToFoam` can read.

OpenFOAM has no 2D solver: a plane case is run as a 3D mesh one cell thick in z
with `empty` patches on the two z faces. We extrude the plane mesh here rather
than re-meshing, so the solver mesh is exactly what the user sees on the canvas.

Input is the dict returned by the gmsh services:
    nodes:      [[x, y], ...]                     (0-indexed)
    elements:   [[i, j, k(, l)], ...]             triangles or quads, node indices
    boundaries: {"inlet": [node indices], ...}    tagged boundary node sets

Output is an ASCII MSH 2.2 file (the format `gmshToFoam` expects).
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

# MSH element type ids
_TRI, _QUAD, _TET, _HEX, _PRISM, _PYRAMID = 2, 3, 4, 5, 6, 7
_FRONT_BACK = "frontAndBack"
_WEDGE_FRONT = "wedge_front"
_WEDGE_BACK = "wedge_back"
_VOLUME = "internal"
# Nominal span for OpenFOAM reduced-2D cases. The mesh still has exactly one
# cell in this direction; this value also defines the unit used by force reports.
OPENFOAM_2D_SPAN = 0.1
# Standard OpenFOAM wedge half-angle: a full 5 degree wedge, +-2.5 degrees off
# the x-y sketch plane (x = axial, y = radius). Not user-configurable - this
# is a meshing implementation detail, not a physical parameter.
AXISYM_WEDGE_ANGLE_DEG = 5.0


def _edge_key(a: int, b: int) -> Tuple[int, int]:
    return (a, b) if a < b else (b, a)


def _boundary_edges(elements: Sequence[Sequence[int]]) -> List[Tuple[int, int]]:
    """Edges used by exactly one 2D element are the mesh boundary."""
    seen: Dict[Tuple[int, int], int] = {}
    order: Dict[Tuple[int, int], Tuple[int, int]] = {}
    for el in elements:
        n = len(el)
        for i in range(n):
            a, b = int(el[i]), int(el[(i + 1) % n])
            k = _edge_key(a, b)
            seen[k] = seen.get(k, 0) + 1
            order.setdefault(k, (a, b))
    return [order[k] for k, c in seen.items() if c == 1]


def _name_edges(
    edges: List[Tuple[int, int]], boundaries: Dict[str, Sequence[int]]
) -> Dict[str, List[Tuple[int, int]]]:
    """Assign each boundary edge to the first tagged set that owns both endpoints."""
    node_sets = {name: set(int(i) for i in idx) for name, idx in (boundaries or {}).items()}
    out: Dict[str, List[Tuple[int, int]]] = {}
    for a, b in edges:
        for name, s in node_sets.items():
            if a in s and b in s:
                out.setdefault(name, []).append((a, b))
                break
    return out


def write_foam_msh(
    mesh: Dict,
    path: str | Path,
    span: float = OPENFOAM_2D_SPAN,
    axisymmetric: bool = False,
    wedge_angle_deg: float = AXISYM_WEDGE_ANGLE_DEG,
) -> Dict:
    """Extrude `mesh` into a 3D MSH 2.2 file at `path` that `gmshToFoam` can read.

    Planar (default): translate by `span` in z, `frontAndBack` empty patches.
    Axisymmetric: revolve by `wedge_angle_deg` about the x-axis into a 1-cell
    wedge, `wedge_front`/`wedge_back` patches. See `_write_wedge_msh`.

    Returns a small summary {cells, patches, path}.
    """
    nodes: List[Sequence[float]] = mesh["nodes"]
    elements: List[Sequence[int]] = mesh["elements"]
    boundaries: Dict[str, Sequence[int]] = mesh.get("boundaries") or {}
    if not nodes or not elements:
        raise ValueError("mesh has no nodes/elements to extrude")

    if axisymmetric:
        return _write_wedge_msh(nodes, elements, boundaries, path, wedge_angle_deg)

    n = len(nodes)
    edges = _boundary_edges(elements)
    named = _name_edges(edges, boundaries)

    # physical groups: one per named side patch, one for the z faces, one volume
    side_names = list(named.keys())
    phys_ids: Dict[str, int] = {name: i + 1 for i, name in enumerate(side_names)}
    phys_ids[_FRONT_BACK] = len(side_names) + 1
    vol_id = len(side_names) + 2

    lines: List[str] = ["$MeshFormat", "2.2 0 8", "$EndMeshFormat"]

    lines.append("$PhysicalNames")
    lines.append(str(len(side_names) + 2))
    for name in side_names:
        lines.append(f'2 {phys_ids[name]} "{name}"')
    lines.append(f'2 {phys_ids[_FRONT_BACK]} "{_FRONT_BACK}"')
    lines.append(f'3 {vol_id} "{_VOLUME}"')
    lines.append("$EndPhysicalNames")

    # nodes: front layer z=0 -> ids 1..n, back layer z=span -> ids n+1..2n
    lines.append("$Nodes")
    lines.append(str(2 * n))
    for i, p in enumerate(nodes):
        lines.append(f"{i + 1} {float(p[0]):.10g} {float(p[1]):.10g} 0")
    for i, p in enumerate(nodes):
        lines.append(f"{n + i + 1} {float(p[0]):.10g} {float(p[1]):.10g} {span:.10g}")
    lines.append("$EndNodes")

    body: List[str] = []
    eid = 0

    def front(i: int) -> int:
        return i + 1

    def back(i: int) -> int:
        return n + i + 1

    # volume cells: prism for triangles, hex for quads (bottom layer then top layer)
    for el in elements:
        eid += 1
        ids = [int(x) for x in el]
        if len(ids) == 3:
            conn = [front(ids[0]), front(ids[1]), front(ids[2]),
                    back(ids[0]), back(ids[1]), back(ids[2])]
            body.append(f"{eid} {_PRISM} 2 {vol_id} {vol_id} " + " ".join(map(str, conn)))
        else:
            conn = [front(ids[0]), front(ids[1]), front(ids[2]), front(ids[3]),
                    back(ids[0]), back(ids[1]), back(ids[2]), back(ids[3])]
            body.append(f"{eid} {_HEX} 2 {vol_id} {vol_id} " + " ".join(map(str, conn)))

    # side patches: each boundary edge -> one quad face [a_f, b_f, b_b, a_b]
    for name, elist in named.items():
        pid = phys_ids[name]
        for a, b in elist:
            eid += 1
            conn = [front(a), front(b), back(b), back(a)]
            body.append(f"{eid} {_QUAD} 2 {pid} {pid} " + " ".join(map(str, conn)))

    # z faces: every 2D element becomes a face on z=0 (reversed -> outward -z) and z=span
    fb = phys_ids[_FRONT_BACK]
    for el in elements:
        ids = [int(x) for x in el]
        t = _TRI if len(ids) == 3 else _QUAD
        eid += 1
        rev = list(reversed([front(i) for i in ids]))
        body.append(f"{eid} {t} 2 {fb} {fb} " + " ".join(map(str, rev)))
        eid += 1
        fwd = [back(i) for i in ids]
        body.append(f"{eid} {t} 2 {fb} {fb} " + " ".join(map(str, fwd)))

    lines.append("$Elements")
    lines.append(str(eid))
    lines.extend(body)
    lines.append("$EndElements")

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")
    return {
        "path": str(path),
        "cells": len(elements),
        "patches": side_names + [_FRONT_BACK],
    }


def _write_wedge_msh(
    nodes: List[Sequence[float]],
    elements: List[Sequence[int]],
    boundaries: Dict[str, Sequence[int]],
    path: str | Path,
    wedge_angle_deg: float,
) -> Dict:
    """Revolve a 2D mesh (x = axial, y = radius >= 0) by `wedge_angle_deg`
    about the x-axis into a 1-cell-thick OpenFOAM wedge.

    Nodes tagged `axis` sit on the rotation axis (y = 0): their front and back
    copies land on the exact same point.
    Triangles:
      - 0 axis vertices -> 6-node prism (_PRISM)
      - 1 axis vertex   -> 5-node pyramid (_PYRAMID)
      - 2 axis vertices -> 4-node tetrahedron (_TET)
    Quads:
      - 0 axis vertices -> 8-node hexahedron (_HEX)
      - 2 adjacent axis vertices -> 6-node prism (_PRISM)
      - other configurations -> split into two triangles and revolved
    """
    if any(len(el) not in (3, 4) for el in elements):
        raise ValueError(
            "axisymmetric meshing requires triangle or quad elements - "
            "regenerate the mesh with element type set to Triangles, Quads, or Quad-dominant"
        )
    axis_ids = set(int(i) for i in (boundaries or {}).get("axis", []))
    if not axis_ids:
        raise ValueError(
            "axisymmetric case has no 'axis' tagged edge - tag the centerline "
            "(y = 0) edge of the domain as 'axis'"
        )

    n = len(nodes)
    half = math.radians(wedge_angle_deg) / 2.0
    cos_h, sin_h = math.cos(half), math.sin(half)

    # "front" is placed at the LOWER z (-half angle) and "back" at the HIGHER
    # z (+half angle): a cell's node list must list its lower-z copy first to
    # get a positive (correctly oriented) volume, given the source triangles
    # are wound CCW in the x-y sketch plane - matching the existing translate
    # extruder, where z=0 ("front") is listed before z=span ("back").
    def front_xyz(i: int) -> Tuple[float, float, float]:
        x, y = float(nodes[i][0]), float(nodes[i][1])
        if i in axis_ids:
            y = 0.0
        return (x, y * cos_h, -y * sin_h)

    def back_xyz(i: int) -> Tuple[float, float, float]:
        x, y = float(nodes[i][0]), float(nodes[i][1])
        if i in axis_ids:
            y = 0.0
        return (x, y * cos_h, y * sin_h)

    def front(i: int) -> int:
        return i + 1

    def back(i: int) -> int:
        # An axis node's back copy is geometrically identical to its front
        # copy, so element/face connectivity always resolves it to the front
        # id. The `n + i + 1` slot for an axis node is still written to $Nodes
        # below (kept contiguous, just unreferenced) - a gap in the id range
        # confuses gmshToFoam's face matching.
        return i + 1 if i in axis_ids else n + i + 1

    def _revolve_tri(tri: Sequence[int]) -> Tuple[int, List[int]]:
        ids = [int(x) for x in tri]
        ax = [v in axis_ids for v in ids]
        cnt = sum(ax)
        if cnt == 0:
            a, b, c = ids
            conn = [front(a), front(b), front(c), back(a), back(b), back(c)]
            return _PRISM, conn
        elif cnt == 1:
            idx = ax.index(True)
            p, q, r = ids[idx], ids[(idx + 1) % 3], ids[(idx + 2) % 3]
            conn = [back(q), back(r), front(r), front(q), front(p)]
            return _PYRAMID, conn
        elif cnt == 2:
            idx = ax.index(False)
            p, q, r = ids[idx], ids[(idx + 1) % 3], ids[(idx + 2) % 3]
            # q, r are on the axis; front(q) == back(q) etc.
            conn = [front(p), back(p), front(q), front(r)]
            return _TET, conn
        else:
            raise ValueError("a mesh triangle has all 3 vertices on the axis")

    edges = _boundary_edges(elements)
    named = _name_edges(edges, boundaries)

    side_names = [name for name in named if name != "axis"]
    phys_ids: Dict[str, int] = {name: i + 1 for i, name in enumerate(side_names)}
    phys_ids[_WEDGE_FRONT] = len(side_names) + 1
    phys_ids[_WEDGE_BACK] = len(side_names) + 2
    vol_id = len(side_names) + 3

    lines: List[str] = ["$MeshFormat", "2.2 0 8", "$EndMeshFormat"]

    lines.append("$PhysicalNames")
    lines.append(str(len(side_names) + 3))
    for name in side_names:
        lines.append(f'2 {phys_ids[name]} "{name}"')
    lines.append(f'2 {phys_ids[_WEDGE_FRONT]} "{_WEDGE_FRONT}"')
    lines.append(f'2 {phys_ids[_WEDGE_BACK]} "{_WEDGE_BACK}"')
    lines.append(f'3 {vol_id} "{_VOLUME}"')
    lines.append("$EndPhysicalNames")

    # nodes: front layer (+half angle) -> ids 1..n, back layer (-half angle)
    # -> ids n+1..2n. Both layers are always written (contiguous ids matter to
    # gmshToFoam's face matching) even though an axis node's back slot ends up
    # unreferenced - `back()` above resolves axis connectivity to the front id.
    lines.append("$Nodes")
    lines.append(str(2 * n))
    for i in range(n):
        x, y, z = front_xyz(i)
        lines.append(f"{front(i)} {x:.10g} {y:.10g} {z:.10g}")
    for i in range(n):
        x, y, z = back_xyz(i)
        lines.append(f"{n + i + 1} {x:.10g} {y:.10g} {z:.10g}")
    lines.append("$EndNodes")

    body: List[str] = []
    eid = 0
    num_cells = 0

    # volume cells:
    # - a triangle with 0/1/2 vertices on the axis revolves into a prism / pyramid / tet
    # - a quad with 0 vertices on the axis revolves into a hexahedron
    # - a quad with 2 adjacent vertices on the axis revolves into a prism
    # - other quads (1 on axis, 2 opposite, 3, 4) split into two triangles [a,b,c] and [a,c,d]
    for el in elements:
        ids = [int(x) for x in el]
        if len(ids) == 3:
            num_cells += 1
            eid += 1
            cell_type, conn = _revolve_tri(ids)
            body.append(f"{eid} {cell_type} 2 {vol_id} {vol_id} " + " ".join(map(str, conn)))
        elif len(ids) == 4:
            ax = [v in axis_ids for v in ids]
            cnt = sum(ax)
            axis_edge_idx = None
            if cnt == 2:
                for k in range(4):
                    if ax[k] and ax[(k + 1) % 4]:
                        axis_edge_idx = k
                        break
            if cnt == 0:
                num_cells += 1
                eid += 1
                a, b, c, d = ids
                conn = [
                    front(a), front(b), front(c), front(d),
                    back(a), back(b), back(c), back(d),
                ]
                body.append(f"{eid} {_HEX} 2 {vol_id} {vol_id} " + " ".join(map(str, conn)))
            elif axis_edge_idx is not None:
                k = axis_edge_idx
                a = ids[k]
                b = ids[(k + 1) % 4]
                c = ids[(k + 2) % 4]
                d = ids[(k + 3) % 4]
                num_cells += 1
                eid += 1
                conn = [front(a), front(d), back(d), front(b), front(c), back(c)]
                body.append(f"{eid} {_PRISM} 2 {vol_id} {vol_id} " + " ".join(map(str, conn)))
            else:
                for tri in ([ids[0], ids[1], ids[2]], [ids[0], ids[2], ids[3]]):
                    num_cells += 1
                    eid += 1
                    cell_type, conn = _revolve_tri(tri)
                    body.append(f"{eid} {cell_type} 2 {vol_id} {vol_id} " + " ".join(map(str, conn)))
        else:
            raise ValueError(f"unsupported element with {len(ids)} nodes")

    # side patches: an edge with 0/1/2 axis endpoints -> quad / triangle / no
    # face at all (both endpoints collapsed -> zero area, e.g. the axis edge).
    for name, elist in named.items():
        if name == "axis":
            continue
        pid = phys_ids[name]
        for a, b in elist:
            a_ax, b_ax = a in axis_ids, b in axis_ids
            if a_ax and b_ax:
                continue
            eid += 1
            if a_ax:
                conn = [front(a), front(b), back(b)]
                body.append(f"{eid} {_TRI} 2 {pid} {pid} " + " ".join(map(str, conn)))
            elif b_ax:
                conn = [front(a), front(b), back(a)]
                body.append(f"{eid} {_TRI} 2 {pid} {pid} " + " ".join(map(str, conn)))
            else:
                conn = [front(a), front(b), back(b), back(a)]
                body.append(f"{eid} {_QUAD} 2 {pid} {pid} " + " ".join(map(str, conn)))

    # wedge caps: every element contributes its own footprint to both the
    # -half-angle (front, lower z for y > 0) and +half-angle (back, higher z)
    # patch. Front needs the reversed winding for an outward (-z-ish) normal,
    # like the z=0 cap in the planar extruder; back keeps the natural winding.
    wf, wb = phys_ids[_WEDGE_FRONT], phys_ids[_WEDGE_BACK]
    for el in elements:
        ids = [int(x) for x in el]
        if len(ids) == 3:
            eid += 1
            rev = list(reversed([front(i) for i in ids]))
            body.append(f"{eid} {_TRI} 2 {wf} {wf} " + " ".join(map(str, rev)))
            eid += 1
            fwd = [back(i) for i in ids]
            body.append(f"{eid} {_TRI} 2 {wb} {wb} " + " ".join(map(str, fwd)))
        elif len(ids) == 4:
            ax = [v in axis_ids for v in ids]
            cnt = sum(ax)
            is_adjacent_2 = (cnt == 2 and any(ax[k] and ax[(k + 1) % 4] for k in range(4)))
            if cnt == 0 or is_adjacent_2:
                eid += 1
                rev = list(reversed([front(i) for i in ids]))
                body.append(f"{eid} {_QUAD} 2 {wf} {wf} " + " ".join(map(str, rev)))
                eid += 1
                fwd = [back(i) for i in ids]
                body.append(f"{eid} {_QUAD} 2 {wb} {wb} " + " ".join(map(str, fwd)))
            else:
                for tri in ([ids[0], ids[1], ids[2]], [ids[0], ids[2], ids[3]]):
                    eid += 1
                    rev = list(reversed([front(i) for i in tri]))
                    body.append(f"{eid} {_TRI} 2 {wf} {wf} " + " ".join(map(str, rev)))
                    eid += 1
                    fwd = [back(i) for i in tri]
                    body.append(f"{eid} {_TRI} 2 {wb} {wb} " + " ".join(map(str, fwd)))
        else:
            raise ValueError(f"unsupported element with {len(ids)} nodes")

    lines.append("$Elements")
    lines.append(str(eid))
    lines.extend(body)
    lines.append("$EndElements")

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")
    return {
        "path": str(path),
        "cells": num_cells,
        "patches": side_names + [_WEDGE_FRONT, _WEDGE_BACK],
    }
