# Structured meshing - design and TODO

Goal: an ICEM CFD (Hexa) style interactive block-topology editor, on top of Gmsh
transfinite meshing. Pure structured multiblock quad meshes only. No hexcore, no
snappyHexMesh, no hybrid.

---

## Will there be a manual canvas editor?

Yes - but it starts from an auto-generated blocking, not a blank canvas.

Spectrum:
- Fully manual (raw ICEM): place every block vertex, every split, every
  association by hand. Powerful, tedious, steep.
- Semi-automatic (what we build): the app auto-generates a starting blocking
  from the geometry + patch tags (domain bbox -> 1 block; wedge notch ->
  auto-split into 3-4 blocks; body loop -> auto O-grid). You then refine on the
  canvas: drag block vertices, add extra splits for local density, fix
  associations. You edit, you do not build from scratch.
- Fully automatic (no editor): preset picks the topology, you only touch
  numbers. Least flexible.

Phase 1 (box / channel / wedge tunnel / step): auto-generation gets ~90% there.
Manual canvas editing exists for the cases auto gets wrong.
Airfoil C-grid: more manual work is unavoidable (wake cut, outer boundary), but
still auto-proposed then nudged.

---

## Concepts

Structured = logical (i,j) indexing, every interior node has 4 neighbours, cells
are quads. Multiblock = domain cut into a few 4-sided blocks, each internally
structured, stitched at shared faces.

Three canonical topologies:
- H-grid: Cartesian-like blocks. Channels, boxes, steps, wedge tunnels. Grid
  lines do NOT follow curved walls.
- O-grid: rings wrapping a body. Body surface is the inner boundary. Great
  near-wall orthogonality. Cylinders, blunt closed bodies.
- C-grid: an O-grid opened along the wake with a branch cut (two coincident
  block faces, solver treats as interior). Standard for airfoils.

Grading per edge: drive from first-cell height + growth ratio, not raw ratio.
Laws: uniform, geometric, bump (dense both ends), tanh (matches target first
cell at each end).

---

## How the references do it

### Ansys
- Fluent's own mesher does NOT do true structured.
- ICEM CFD Hexa: interactive block editor. Import points/curves/surfaces ->
  build blocking (split, O-grid, delete, merge vertices) -> associate block
  edges/vertices/faces to geometry -> per-edge params (Nodes, Spacing1/2,
  Ratio1/2, MaxSpace, Law: BiGeometric/Geometric/Hyperbolic/Poisson/...) ->
  edge count propagation across the block graph -> pre-mesh -> quality
  (determinant 2x2x2, min angle, aspect ratio, skew, warpage) -> smoothing ->
  export.
- Fluent Meshing Poly-Hexcore: automated, NOT structured (hex core + poly
  transition + prisms). We are not doing this.
- GAMBIT (legacy): Map/Submap meshing on 4-sided faces = transfinite with a GUI.

### OpenFOAM
- blockMesh: native multiblock structured mesher. `system/blockMeshDict`:
  vertices (block corners), blocks (`hex (8 ids) (nx ny nz) simpleGrading
  (gx gy gz)` or multiGrading), edges (`arc`/`spline`/`polyLine` to curve a
  block edge), boundary (named patches from block faces), mergePatchPairs.
  2D = 1 cell in z, front/back `empty`. No GUI - you generate the dict.
- snappyHexMesh: castellate + snap + layers. NOT structured. Not doing this.
- cfMesh: automated Cartesian/poly. Not doing this.
- Import path: gmshToFoam / ideasUnvToFoam / fluentMeshToFoam. So a Gmsh or
  ICEM structured mesh -> OpenFOAM is one command.

---

## Our approach: Gmsh transfinite

Per fluid block:
```
addPoint x4 (reuse shared points)
addLine  x4 (straight, or sample the associated CAD curve as a spline)
addCurveLoop -> addPlaneSurface
Transfinite Curve {each line} = nodes Using Progression r   # r from firstCell + ratio
Transfinite Surface {surface} = {4 corners}
Recombine Surface {surface}                                  # -> quads
```
Shared points across blocks -> conformal multiblock. Boundary block-edges keep
the inherited patch tag -> inlet / outlet / wall physical groups.
Constraint: opposite edges of a block must have equal node counts.

Alternative considered: emit blockMeshDict directly (OpenFOAM native, no
conversion). Same hard core (topology generation). Keep as a possible export
target later; primary path is Gmsh transfinite because we already call Gmsh.

---

## Data model

```ts
BlockVertex { id: string; pt: Point2D; assocPointId?: string }
BlockEdge   { id: string; v0: string; v1: string;
              assocCurveId?: string;
              nodes: number;
              law: 'uniform' | 'geometric' | 'bump' | 'tanh';
              firstCell?: number; ratio?: number }
Block       { id: string; edges: [string,string,string,string]; isFluid: boolean }
Blocking    { vertices: BlockVertex[]; edges: BlockEdge[]; blocks: Block[] }
```
Stored in the session alongside `cadEntities`. This is the structured
counterpart to the unstructured path.

---

## Edge-count propagation (the feature that makes it usable)

Opposite edges of a block must have equal node counts. Build a union-find over
"must match" edges (opposite pairs within each block, transitively across shared
edges). Setting one edge's count updates the whole chain. This is ICEM's edge
propagation.

---

## Canvas operations (2D)

Start: one block = the domain bounding box.

- Split: draw a cut line across a block -> two blocks; propagates through
  aligned blocks. Snaps to geometry points and tag boundaries.
- O-grid: select a block + an inner loop (the body) -> auto-build the ring
  (4 corner blocks + inward-offset edges). Param: offset distance.
- Delete block: remove a block inside a solid body.
- Associate: block-edge -> CAD curve (curves + inherits patch tag);
  block-vertex -> CAD point (snap).
- Move vertex: drag a block-vertex (reuse existing vertex-drag infra).
- Merge vertices: collapse two (C-grid wake cut, cleanup).

Quality after pre-mesh: per-block min angle, aspect ratio, Jacobian
(ICEM "determinant"), as a green/amber/red overlay on the blocks. Optional
Laplacian smoothing on interior nodes.

---

## UI

Picking "Structured" in the Mesh tab (currently disabled) switches the canvas
into blocking mode:
- Toolbar: Split | O-grid | Delete | Associate
- Selected-edge panel: nodes, law, first cell, growth ratio (chain-apply auto)
- Quality readout + "Generate structured mesh"
- Canvas draws the block graph over the dimmed geometry: square block-vertices,
  thick coloured block-edges, faint block fills. Reuses pan/zoom/vertex-drag.

---

## Phased build

### Phase 1 - H-block editor (no O-grid)   [~1 week]
- [x] `Blocking` data model + session persistence (`frontend/src/types/blocking.ts`, `StudioSession.blocking`)
- [x] Auto-generate initial blocking: domain bbox = 1 block (`autoBlockingFromOutline`)
- [~] Auto-split at wedge/step corners and at tagged-patch boundaries (Phase 1: single block only; a block side that follows the outline is built as a polyline of straight segments - one per outline segment - so a wedge / step keeps sharp corners. Node count is split across the segments by length. A true multi-block split for the step comes in a later pass.)
- [x] Auto-associate block-edges lying on the domain outline; inherit patch tags (`tagAt` in `autoBlockingFromOutline`)
- [x] Canvas render of the block graph (vertices, edges, node ticks) over geometry (`CadWorkbench2D`, `showBlocking`)
- [ ] Split tool (draw cut line, propagate) -- deferred, needs multi-block
- [x] Move block-vertex (`blockDrag` in `CadWorkbench2D` mouse handlers)
- [~] Per-edge params: nodes, law, ratio (firstCell not yet -- ratio + law only, grouped by direction in `StructuredMeshPanel`)
- [x] Union-find edge-count propagation (`propagateNodeCounts`)
- [x] Backend: Gmsh transfinite from a Blocking -> multiblock quad mesh (`generate_structured_mesh` in `gmsh_service.py`, `/api/geometry/mesh-structured`)
- [x] Patch physical groups from inherited tags
- [x] Quality readout (returned in `mesh.quality`)
- [x] Wire "Structured" toggle in the Mesh tab to blocking mode (`LeftStagePanel`, `StructuredMeshPanel`)
- Covers: box, channel, wedge tunnel (single 4-sided domain, fully structured all-quad)
- Remaining for a complete Phase 1: multi-block split tool, per-edge first-cell height input, backward-facing step (needs 2+ blocks)

### Phase 1b - multi-block   [DONE 2026-08-29]
The backend mesher already looped over N blocks; this phase was almost entirely frontend.
- [x] Auto multi-block on build: vertical-strip decomposition (`stripDecomposition` in `blocking.ts`).
      One block per gap between outline x-coords. Ramp = strip with a slanted floor (still a quad).
      Flat strips that meet at a floor/ceiling step are split horizontally -> backward-facing step
      comes out as 3 near-rectangular blocks. Falls back to `singleBlockFromOutline` when the
      domain is not x-monotone.
- [x] Split tool: `splitBlock(bk, id, 'x'|'y')` halves a block; the cut runs the full width/height
      of whatever column/row it lands in (`splitAllAt`), splitting every block it crosses and
      de-duping the new shared edge. Buttons per block in `StructuredMeshPanel`.
- [x] Shared-edge node coupling across blocks - shared edges have one id, so the existing
      `propagateNodeCounts` union-find already spans blocks. Node floor raised to
      `path.length + 2` so polyline sides never under-resolve.
- [x] Delete block (`deleteBlock` + `cleanBlocking` drops orphan edges/vertices).
- [x] Canvas: faint per-block fill + block number, per-block hover highlight, draggable corners
      (shared corners move every block at once because they share a vertex id).
- [x] Backend: interior block interfaces (curve touched by 2 surfaces) get no patch / no physical
      group; `orderBlockEdges` / loop-walk keeps split blocks valid.
- Covers: backward-facing step, forward step, ramped tunnels, box refined into a block grid -
      all fully structured all-quad, tested (BFS -> 4563 quads / 0 tris / 90 deg min angle).

Not done (later): drawing an arbitrary cut line at a chosen position (only mid-block halving now -
  drag the handles after), merge-block, non-x-monotone auto-blocking (L-shapes need manual splits),
  per-edge first-cell height.

### Phase 2 - O-grid   [~1 week]
- [ ] O-grid tool: select body loop + block -> generate ring
- [ ] Offset parameter, auto-delete interior block
- [ ] Merge-vertices tool
- Covers: cylinder, bluff closed bodies

### Phase 3 - C-grid + wake cut   [~1-2 weeks]
- [ ] Auto-offset outer C boundary from the profile (reuse `requestOffset`)
- [ ] Wake-cut line definition
- [ ] Merge vertices at trailing edge; branch-cut handling in Gmsh export
- [ ] Blunt vs sharp TE handling
- Covers: airfoils

### Later
- [ ] blockMeshDict export target (OpenFOAM native)
- [ ] Elliptic smoothing
- [ ] Structured boundary-layer O-grid + unstructured fill (hybrid) - only if wanted
