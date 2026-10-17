// ── Scientific colormaps (control-point ramps, linearly interpolated) ────────
const _RAMPS: Record<string, [number, number, number][]> = {
  coolwarm: [[59, 76, 192], [144, 178, 254], [220, 220, 220], [245, 156, 125], [180, 4, 38]],
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  turbo: [[48, 18, 59], [58, 138, 253], [27, 229, 138], [223, 224, 40], [122, 4, 3]],
  jet: [[0, 0, 131], [0, 128, 255], [122, 255, 128], [255, 191, 0], [128, 0, 0]],
  rainbow: [[110, 64, 170], [76, 176, 202], [126, 219, 92], [251, 179, 61], [235, 74, 74]],
  // Mesh-quality ramp: good cells green, borderline amber, bad cells red.
  quality: [[22, 163, 74], [132, 204, 22], [250, 204, 21], [249, 115, 22], [220, 38, 38]],
};

/** Equiangle skewness (0 = ideal, 1 = degenerate) for a triangle or quad given
 *  its ordered vertices - the same measure the Gmsh backend reports. */
export function cellSkewness(pts: [number, number][]): number {
  const n = pts.length;
  if (n < 3) return 1;
  const ideal = n === 3 ? 60 : 90;
  let mn = 180;
  let mx = 0;
  for (let i = 0; i < n; i += 1) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const v1x = p0[0] - p1[0];
    const v1y = p0[1] - p1[1];
    const v2x = p2[0] - p1[0];
    const v2y = p2[1] - p1[1];
    const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    if (d < 1e-15) return 1;
    const ang = (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180) / Math.PI;
    if (ang < mn) mn = ang;
    if (ang > mx) mx = ang;
  }
  return Math.max(0, Math.min(1, Math.max((mx - ideal) / (180 - ideal), (ideal - mn) / ideal)));
}

export function colormapRGB(t: number, name: string): string {
  const ramp = _RAMPS[name] || _RAMPS.coolwarm;
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const f = x - i;
  const a = ramp[i];
  const b = ramp[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)}, ${Math.round(a[1] + (b[1] - a[1]) * f)}, ${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}
