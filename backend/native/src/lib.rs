//! Compiled mesh-smoothing kernels for the OpenCFD backend.
//!
//! The Python side (`app/services/gmsh_service/native.py`) loads this library
//! with ctypes and falls back to the NumPy implementations when it is missing,
//! so every function here must produce the same result as its NumPy twin:
//!
//! - `winslow_jacobi`  mirrors the sweep loop in `smoothing._winslow_smooth`
//! - `tm_sor`          mirrors the relaxation loop in `elliptic.thomas_middlecoff_smooth`
//!
//! All arrays are caller-owned, contiguous, and validated on the Python side.

use std::slice;
use std::thread;

/// Split `len` items into `parts` contiguous ranges.
fn chunks(len: usize, parts: usize) -> Vec<(usize, usize)> {
    let parts = parts.max(1).min(len.max(1));
    let step = (len + parts - 1) / parts;
    (0..parts)
        .map(|p| (p * step, ((p + 1) * step).min(len)))
        .filter(|(a, b)| a < b)
        .collect()
}

fn worker_count(work: usize) -> usize {
    // Threads only pay off once a sweep is big enough to amortise the spawn.
    if work < 20_000 {
        return 1;
    }
    thread::available_parallelism().map(|n| n.get()).unwrap_or(1).min(8)
}

/// Damped-Jacobi Winslow sweeps on the free nodes of a quad mesh, in place.
///
/// `x`, `y`: all node coordinates (len `n`). `free`: the `m` movable node ids.
/// `sten`: `m * 8` neighbour ids per free node, ordered n s e w ne nw sw se.
/// Every sweep computes all updates from the previous positions, then applies
/// them (true Jacobi), exactly like the NumPy version, so the result does not
/// depend on node order or thread count. Every 25 sweeps it stops if the
/// largest component of the last update is below `tol`.
///
/// Returns the number of sweeps run; `*converged` is set to 0 or 1.
///
/// # Safety
/// Pointers must be valid for the given lengths; ids must be `< n`.
#[no_mangle]
pub unsafe extern "C" fn winslow_jacobi(
    x: *mut f64,
    y: *mut f64,
    n: usize,
    free: *const i64,
    sten: *const i64,
    m: usize,
    iterations: usize,
    omega: f64,
    tol: f64,
    converged: *mut i32,
) -> usize {
    let x = slice::from_raw_parts_mut(x, n);
    let y = slice::from_raw_parts_mut(y, n);
    let free = slice::from_raw_parts(free, m);
    let sten = slice::from_raw_parts(sten, m * 8);
    *converged = 0;
    if m == 0 {
        return 0;
    }

    // dx/dy hold this sweep's update; NaN marks a skipped (degenerate) node.
    let mut dx = vec![0.0f64; m];
    let mut dy = vec![0.0f64; m];
    let ranges = chunks(m, worker_count(m));
    let mut sweeps = 0usize;

    for it in 0..iterations {
        {
            let (xs, ys): (&[f64], &[f64]) = (x, y);
            let compute = |lo: usize, dxo: &mut [f64], dyo: &mut [f64]| {
                for (k, (ox, oy)) in dxo.iter_mut().zip(dyo.iter_mut()).enumerate() {
                    let g = lo + k;
                    let s = &sten[g * 8..g * 8 + 8];
                    let (n_, s_, e_, w_) =
                        (s[0] as usize, s[1] as usize, s[2] as usize, s[3] as usize);
                    let (ne, nw, sw, se) =
                        (s[4] as usize, s[5] as usize, s[6] as usize, s[7] as usize);
                    let (xe, ye, xw, yw) = (xs[e_], ys[e_], xs[w_], ys[w_]);
                    let (xn, yn, xs_, ys_) = (xs[n_], ys[n_], xs[s_], ys[s_]);
                    let xxi = 0.5 * (xe - xw);
                    let yxi = 0.5 * (ye - yw);
                    let xet = 0.5 * (xn - xs_);
                    let yet = 0.5 * (yn - ys_);
                    let alpha = xet * xet + yet * yet;
                    let beta = xxi * xet + yxi * yet;
                    let gamma = xxi * xxi + yxi * yxi;
                    let denom = 2.0 * (alpha + gamma);
                    if !(denom > 1e-18) {
                        *ox = f64::NAN;
                        *oy = f64::NAN;
                        continue;
                    }
                    let ddx = xs[ne] - xs[nw] - xs[se] + xs[sw];
                    let ddy = ys[ne] - ys[nw] - ys[se] + ys[sw];
                    let nxv = (alpha * (xe + xw) + gamma * (xn + xs_) - (0.5 * beta) * ddx) / denom;
                    let nyv = (alpha * (ye + yw) + gamma * (yn + ys_) - (0.5 * beta) * ddy) / denom;
                    let f = free[g] as usize;
                    *ox = omega * (nxv - xs[f]);
                    *oy = omega * (nyv - ys[f]);
                }
            };
            if ranges.len() == 1 {
                compute(0, &mut dx, &mut dy);
            } else {
                thread::scope(|sc| {
                    let mut rest_x: &mut [f64] = &mut dx;
                    let mut rest_y: &mut [f64] = &mut dy;
                    let mut start = 0usize;
                    for &(lo, hi) in &ranges {
                        let (cx, tx) = rest_x.split_at_mut(hi - start);
                        let (cy, ty) = rest_y.split_at_mut(hi - start);
                        rest_x = tx;
                        rest_y = ty;
                        start = hi;
                        let compute = &compute;
                        sc.spawn(move || compute(lo, cx, cy));
                    }
                });
            }
        }

        let mut max_step = 0.0f64;
        for k in 0..m {
            let (ux, uy) = (dx[k], dy[k]);
            if ux.is_nan() && uy.is_nan() {
                continue;
            }
            let f = free[k] as usize;
            x[f] += ux;
            y[f] += uy;
            let a = ux.abs().max(uy.abs());
            if a > max_step || a.is_nan() {
                max_step = a;
            }
        }
        sweeps = it + 1;
        if it % 25 == 24 && max_step < tol {
            *converged = 1;
            break;
        }
    }
    sweeps
}

/// Thomas-Middlecoff red-black SOR on one structured block, in place.
///
/// `x`, `y`, `p`, `q`: row-major `(ni, nj)` arrays (index `i * nj + j`).
/// Boundary rows/columns never move. Each colour pass computes every update
/// of that colour from the current grid, then writes them, matching the
/// NumPy version (whose diagonal terms read same-colour neighbours from the
/// pre-pass state). If an iteration produces a non-finite value the grid is
/// restored to the last finite iterate and the loop stops.
///
/// Returns the number of iterations completed.
///
/// # Safety
/// Pointers must be valid for `ni * nj` elements.
#[no_mangle]
pub unsafe extern "C" fn tm_sor(
    x: *mut f64,
    y: *mut f64,
    p: *const f64,
    q: *const f64,
    ni: usize,
    nj: usize,
    iterations: usize,
    omega: f64,
) -> usize {
    if ni <= 2 || nj <= 2 {
        return 0;
    }
    let len = ni * nj;
    let x = slice::from_raw_parts_mut(x, len);
    let y = slice::from_raw_parts_mut(y, len);
    let p = slice::from_raw_parts(p, len);
    let q = slice::from_raw_parts(q, len);

    let mut last_x = x.to_vec();
    let mut last_y = y.to_vec();
    // Pending updates of the current colour: (flat index, new x, new y).
    let mut pending: Vec<(usize, f64, f64)> = Vec::with_capacity(len / 2 + 1);
    let mut done = 0usize;

    for _ in 0..iterations {
        for color in 0..2usize {
            pending.clear();
            for i in 1..ni - 1 {
                // (i + j) % 2 == color  ->  first interior j of this colour
                let j0 = if (i + 1) % 2 == color { 1 } else { 2 };
                let mut j = j0;
                while j < nj - 1 {
                    let c = i * nj + j;
                    let (ip, im, jp, jm) = (c + nj, c - nj, c + 1, c - 1);
                    let xxi = 0.5 * (x[ip] - x[im]);
                    let yxi = 0.5 * (y[ip] - y[im]);
                    let xet = 0.5 * (x[jp] - x[jm]);
                    let yet = 0.5 * (y[jp] - y[jm]);
                    let alpha = xet * xet + yet * yet;
                    let gamma = xxi * xxi + yxi * yxi;
                    let beta = xxi * xet + yxi * yet;
                    let jac = xxi * yet - xet * yxi;
                    let xxy = 0.25 * (x[ip + 1] - x[ip - 1] - x[im + 1] + x[im - 1]);
                    let yxy = 0.25 * (y[ip + 1] - y[ip - 1] - y[im + 1] + y[im - 1]);
                    let (pc, qc) = (p[c], q[c]);
                    let j2 = jac * jac;
                    let rhs_x = alpha * (x[ip] + x[im]) + gamma * (x[jp] + x[jm])
                        - 2.0 * beta * xxy
                        + j2 * (pc * xxi + qc * xet);
                    let rhs_y = alpha * (y[ip] + y[im]) + gamma * (y[jp] + y[jm])
                        - 2.0 * beta * yxy
                        + j2 * (pc * yxi + qc * yet);
                    let mut denom = 2.0 * (alpha + gamma);
                    if !(denom.abs() > 1e-12) {
                        denom = 1.0;
                    }
                    let nx = x[c] + omega * (rhs_x / denom - x[c]);
                    let ny = y[c] + omega * (rhs_y / denom - y[c]);
                    pending.push((c, nx, ny));
                    j += 2;
                }
            }
            for &(c, nx, ny) in &pending {
                x[c] = nx;
                y[c] = ny;
            }
        }
        if x.iter().chain(y.iter()).any(|v| !v.is_finite()) {
            x.copy_from_slice(&last_x);
            y.copy_from_slice(&last_y);
            break;
        }
        last_x.copy_from_slice(x);
        last_y.copy_from_slice(y);
        done += 1;
    }
    done
}
