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

### Phase 2 - O-grid   [DONE 2026-08-29]
- [x] O-grid tool: `wrapBodyOgrid(bk, bodyRing, patch)` in `blocking.ts`. Detects the block
      containing the body (`bodiesForOgrid`); if the block is much bigger than the body it first
      carves a snug box via `splitAllAt` at the padded body bbox, then replaces that block with a
      4-block ring. Body outline is resampled to 72 points (`resampleClosed`), 4 rays from the body
      centroid through the block corners set the ring split points, inner edges carry the body path
      + patch, radial edges default to geometric grading ratio 8 (clustered at the wall).
- [x] `Blocking.links` (edge-id groups) + `propagateNodeCounts` honours them: the 4 arcs are one
      link group, the 4 radials another, so the ring stays symmetric. `cleanBlocking` prunes stale
      link ids; `splitAllAt` carries links through.
- [x] UI: "O-grid" section in `StructuredMeshPanel` lists bodies with a "Wrap with O-grid" button
      (disabled when the body is not inside one block), shows "Wrapped" once done.
- [x] Canvas: node ticks now walk the edge path by arc length so curved arcs read correctly.
- Covers: cylinder / bluff-body in a channel or far-field. Tested: cylinder -> 20716 quads,
      0 tris, 45 deg min angle, 0.5 skew; rect body 43 deg; near-wall cylinder 37 deg.
- Not done: explicit ring-offset slider (auto from body size + available gap), merge-vertices,
      snapping ring splits to a polygon body's real corners (resample rounds them slightly).

### Phase 3 - C-grid + wake cut   [DONE 2026-08-29]
- [x] `cGridFromAirfoil(airfoilRing, domainRing, patch)` in `blocking.ts` - builds a fresh
      4-block topology (replaces any existing blocking):
      * offset curve from the airfoil surface (normal offset, radius R auto from chord +
        available room), meeting on one point straight ahead of the nose (`oLE`)
      * upper wrap block + lower wrap block, sharing the LE radial edge
      * upper + lower wake blocks, sharing the wake-cut edge -> conformal across the wake
      * wall-normal edges cluster at the wall (geometric ratio 3); streamwise wake edges
        cluster at the trailing edge
      * KEY: the trailing-edge radials use the *natural* offset endpoint, not TE.x - forcing
        them square kinks the grid and drops min angle to ~3 deg. Natural ends -> ~55 deg.
- [x] `airfoilsForCGrid(entities)` - closed non-domain bodies, returns width/height aspect.
      `structuredHint` in App recommends 'cgrid' when aspect >= 2.2, else 'ogrid'/'hgrid'.
- [x] Wired: topology selector in `StructuredMeshPanel` now has 3 options (H / O / C-grid);
      `handleBuildBlocks('cgrid')`. A C-gridded airfoil reads as `wrapped` so the O-grid list
      does not offer a redundant wrap.
- Tested: NACA-ish airfoil -> 6210 quads, 0 tris, ~55 deg min angle, 0.40 skew; thick section
      68 deg; 8 deg AoA 52 deg. All via the /api/geometry/mesh-structured endpoint.
- 2026-08-29 rework: `cGridFromAirfoil` now FILLS THE WHOLE DOMAIN (the old version only
      meshed a small offset patch and left the rest empty).
      * rectangular domain -> `cGridFromAirfoil` builds an 8-block C-H grid (2 wrap along the
        surfaces, 2 upstream of the LE, 2 wake). ~16 deg min angle at the nose.
      * C-shaped domain (semicircle + wake, area < 0.95 * bbox) -> `cGridWrap` builds a true
        4-block wrap C-grid: upper/lower wrap out to the semicircle meeting on a radial ahead
        of the nose, + 2 conformal wake blocks. Grid lines curve around the nose. ~20 deg min
        angle. This is the recommended airfoil path.
- KNOWN LIMIT: ~15-20 deg cells right at the rounded leading edge in both variants. Root
      cause: circumferential node clustering toward the LE/TE cannot be applied to a curved
      (polyline) block edge - the backend `_distribute_cells` only splits by arc length, not
      by a `bump`/`geometric` law. `afU`/`afL`/`ocU`/`ocL` carry `law:'bump'` params that are
      currently IGNORED for polyline edges. Fixing that (weight `_distribute_cells` by the
      transfinite law) is the next backend step and should clear the nose.
- Not done: outer curve split into inlet (front) / outlet (back); flow-aligned wake cut at
      AoA; blunt-TE base patch.

### Quality pass (started 2026-08-29)  -- see the "Structured Meshing Roadmap" artifact

- [x] Spacing-driven sizing: `applyTargetCellSize(bk, cellSize)` / `autoCellSize` /
      `currentCellSize` in `blocking.ts`. Node counts are derived per direction from the
      median block-edge length in that propagation group, so a narrow column of blocks gets
      few cells instead of a neighbour's large count forced onto it. Applied automatically on
      "Generate blocks"; "Target cell size" field + "Finer x2" in the Mesh sizing step.
      Fixes the dense band on the top/bottom that the O-grid caused.
- [~] Elliptic (Winslow) smoothing: `_winslow_smooth` in `gmsh_service.py` - Jacobi on the
      8-node stencil, block corners + geometry-boundary nodes pinned, correction tapered back
      to transfinite near fixed nodes. Gated: kept ONLY if it does not lower the worst-cell
      angle and improves mean + p05. Toggle in the UI (`structuredSmooth`, sends `smooth` in
      the request). CURRENT LIMITATION: pure Winslow without control functions rarely clears
      the gate - it harmonises the interior but hurts boundary-fitted O/C grids, and cannot
      help a pinned off-centre dragged vertex. The reliable version needs the per-block
      logical (i,j) grid + Thomas-Middlecoff / Sorenson control functions (the ~1 week
      roadmap item). Infrastructure is in place; that is the next step.
- [ ] Per-block logical grid extraction (reconstruct the i,j array from the quad soup per
      Gmsh surface) -> unlocks proper multiblock elliptic with control functions
- [ ] tanh / Vinokur spacing law; first-cell-height input
- [ ] Live quality panel (metrics + worst-cell highlight on the canvas)
- [ ] Native blockMeshDict export (OpenFOAM structured, no Gmsh)
- [ ] Wall-orthogonality control (Sorenson) once the logical grid exists
- [ ] Periodic / rotationally-periodic blocks
