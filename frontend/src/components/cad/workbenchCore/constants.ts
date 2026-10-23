/** Cursor catch radius for a direct vertex snap, in screen pixels. */
export const SNAP_RADIUS_PX = 12;
/** Tolerance for axis-alignment guides and the relative H/V lock, in screen px. */
export const ALIGN_TOL_PX = 8;
/** How close (screen px) the cursor must be to a piece of geometry before that
 *  geometry may influence the snap (alignment / perpendicular / parallel). Keeps
 *  inferences local to what the user is actually hovering, instead of letting a
 *  vertex on the far side of the sketch grab the cursor. */
export const PROXIMITY_PX = 64;
/** How close (degrees) to a polar step before angle tracking engages. */
export const POLAR_TOL_DEG = 4;
export const INITIAL_ZOOM = 130;

/** Shared empty edge list, so "no mesh" keeps one stable identity. */
export const EMPTY_EDGES = new Uint32Array(0);

// Fill colors cycled by block index for the Mesh-view direction-coloring
// overlay (one color per block, so the block layout reads at a glance on the
// real generated mesh, not just the block diagram).
export const BLOCK_FILL_CYCLE = [
  '#2563EB',
  '#DC2626',
  '#059669',
  '#D97706',
  '#7C3AED',
  '#DB2777',
  '#0891B2',
  '#65A30D',
];
