/** Min and max of a numeric array, or [0, 1] when empty. A loop, not
 *  Math.min(...arr): spreading a mesh-sized array overflows the call stack
 *  past ~120k values. */
export function arrayRange(vals: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}
