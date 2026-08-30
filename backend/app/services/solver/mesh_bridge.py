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

from pathlib import Path
from typing import Dict, List, Sequence, Tuple

# MSH element type ids
_TRI, _QUAD, _HEX, _PRISM = 2, 3, 5, 6
_FRONT_BACK = "frontAndBack"
_VOLUME = "internal"
# Nominal span for OpenFOAM reduced-2D cases. The mesh still has exactly one
# cell in this direction; this value also defines the unit used by force reports.
OPENFOAM_2D_SPAN = 0.1


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


def write_foam_msh(mesh: Dict, path: str | Path, span: float = OPENFOAM_2D_SPAN) -> Dict:
    """Extrude `mesh` by `span` in z and write an MSH 2.2 file at `path`.

    Returns a small summary {cells, patches, path}.
    """
    nodes: List[Sequence[float]] = mesh["nodes"]
    elements: List[Sequence[int]] = mesh["elements"]
    boundaries: Dict[str, Sequence[int]] = mesh.get("boundaries") or {}
    if not nodes or not elements:
        raise ValueError("mesh has no nodes/elements to extrude")

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
