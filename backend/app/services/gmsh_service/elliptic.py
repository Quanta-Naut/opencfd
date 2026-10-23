"""Per-block elliptic (Thomas-Middlecoff) grid generation.

`generate_structured_mesh` gets its initial interior node positions from
Gmsh's own transfinite (linear) interpolation between the four block-edge
curves. That interpolation has no idea the boundary curves carry curvature -
it just blends parametric position - so a block whose one side is sharply
curved (an airfoil surface near the leading edge) and whose opposite side is
gentle (a far-field arc) ends up with badly non-orthogonal cells near the
sharp side: confirmed on a real C-grid case, ~2.9deg minimum angle.

Thomas-Middlecoff control functions fix this by feeding each boundary's own
curvature into the interior solve, so grid lines leave a curved wall smoothly
instead of snapping straight to match the opposite curve. This module
reconstructs each block's own logical (i,j) node grid from the already-built
Gmsh mesh (needed to index the control-function field, which is only
meaningful as a function of ONE logical direction), builds a matching
plain-transfinite starting grid, and relaxes it with the controlled PDE.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np

from . import native


def reconstruct_block_grid(
    bottom_row: List[int], elements: List[List[int]], nj: int
) -> Optional[List[List[int]]]:
    """Recover the logical (i,j) grid of global node indices for one
    transfinite block, given its bottom row (i=0..ni-1, left-to-right, exact -
    these are known from how the boundary curves were built) and the block's
    own quad elements. Returns None if the block isn't a clean structured
    grid (shouldn't happen for a valid transfinite-recombined block, but a
    caller should fall back gracefully rather than trust a partial result).
    """
    ni = len(bottom_row)
    if ni < 2 or nj < 2:
        return None

    edge_to_quads: Dict[Tuple[int, int], List[int]] = {}
    for qi, q in enumerate(elements):
        if len(q) != 4:
            continue
        for k in range(4):
            a, b = q[k], q[(k + 1) % 4]
            key = (a, b) if a < b else (b, a)
            edge_to_quads.setdefault(key, []).append(qi)

    used = [False] * len(elements)
    grid: List[List[int]] = [list(bottom_row)]
    prev = bottom_row
    for _ in range(1, nj):
        new_row: List[Optional[int]] = [None] * ni
        for i in range(ni - 1):
            a, b = prev[i], prev[i + 1]
            key = (a, b) if a < b else (b, a)
            cand = [qi for qi in edge_to_quads.get(key, []) if not used[qi]]
            if not cand:
                return None
            qi = cand[0]
            used[qi] = True
            q = elements[qi]
            pa, pb = q.index(a), q.index(b)
            if pb == (pa + 1) % 4:
                far_a, far_b = q[(pa - 1) % 4], q[(pb + 1) % 4]
            elif pa == (pb + 1) % 4:
                far_a, far_b = q[(pa + 1) % 4], q[(pb - 1) % 4]
            else:
                return None  # a,b not actually adjacent in this quad - malformed
            if new_row[i] is not None and new_row[i] != far_a:
                return None
            if new_row[i + 1] is not None and new_row[i + 1] != far_b:
                return None
            new_row[i] = far_a
            new_row[i + 1] = far_b
        if any(v is None for v in new_row):
            return None
        grid.append(new_row)  # type: ignore[arg-type]
        prev = new_row  # type: ignore[assignment]
    return grid


def _tfi_grid(bottom: np.ndarray, top: np.ndarray, left: np.ndarray, right: np.ndarray) -> np.ndarray:
    """Standard bilinear transfinite interpolation (Coons patch) - the same
    blend Gmsh's own transfinite algorithm produces, recomputed here so the
    elliptic solve has a plain numpy array to work on. Shape (ni, nj, 2)."""
    ni, nj = len(bottom), len(left)
    u = np.linspace(0.0, 1.0, ni)[:, None]
    v = np.linspace(0.0, 1.0, nj)[None, :]
    grid = (
        (1 - v)[:, :, None] * bottom[:, None, :]
        + v[:, :, None] * top[:, None, :]
        + (1 - u)[:, :, None] * left[None, :, :]
        + u[:, :, None] * right[None, :, :]
        - ((1 - u)[:, :, None] * (1 - v)[:, :, None] * bottom[0]
           + u[:, :, None] * (1 - v)[:, :, None] * bottom[-1]
           + (1 - u)[:, :, None] * v[:, :, None] * top[0]
           + u[:, :, None] * v[:, :, None] * top[-1])
    )
    return grid


def _boundary_control(curve: np.ndarray) -> np.ndarray:
    """Thomas-Middlecoff control value along one boundary curve: how much the
    curve's own tangent is turning, normalised by its own speed. Propagated
    into the interior this tells the solver "the grid lines leaving here
    should keep curving the way the boundary itself curves" instead of
    ignoring the boundary's shape entirely (plain Winslow/Laplace)."""
    n = len(curve)
    d1 = np.zeros_like(curve)
    d2 = np.zeros_like(curve)
    d1[1:-1] = (curve[2:] - curve[:-2]) / 2.0
    d1[0] = curve[1] - curve[0]
    d1[-1] = curve[-1] - curve[-2]
    d2[1:-1] = curve[2:] - 2 * curve[1:-1] + curve[:-2]
    # one-sided second difference at the ends (mirrors the interior formula)
    if n > 2:
        d2[0] = curve[2] - 2 * curve[1] + curve[0]
        d2[-1] = curve[-1] - 2 * curve[-2] + curve[-3]
    speed2 = np.einsum("ij,ij->i", d1, d1)
    speed2 = np.where(speed2 > 1e-14, speed2, 1e-14)
    return -np.einsum("ij,ij->i", d2, d1) / speed2


def thomas_middlecoff_smooth(
    bottom: np.ndarray, top: np.ndarray, left: np.ndarray, right: np.ndarray,
    iterations: int = 400, omega: float = 1.85,
) -> np.ndarray:
    """Relax a block's interior grid with Thomas-Middlecoff control functions.
    `bottom`/`top` are (ni,2) curves (j=0 and j=nj-1), `left`/`right` are
    (nj,2) curves (i=0 and i=ni-1); all four share their corner points.
    Returns the full (ni,nj,2) grid, boundary rows/columns unchanged.

    Red-black SOR, not plain Jacobi: on a stretched ~100x25 block, damped
    Jacobi (omega~0.6) needs 5000-10000 sweeps to reach the same converged
    state red-black SOR at omega=1.85 reaches in ~300 - verified empirically
    against a real airfoil C-grid block (both settle at the same ~22.4deg
    minimum angle; Jacobi at 600 sweeps was still mid-convergence at 8.4deg).
    """
    ni, nj = len(bottom), len(left)
    grid = _tfi_grid(bottom, top, left, right)
    if ni <= 2 or nj <= 2:
        return grid  # no interior to relax

    P_bottom = _boundary_control(bottom)
    P_top = _boundary_control(top)
    Q_left = _boundary_control(left)
    Q_right = _boundary_control(right)
    v = np.linspace(0.0, 1.0, nj)
    u = np.linspace(0.0, 1.0, ni)
    P = (1 - v)[None, :] * P_bottom[:, None] + v[None, :] * P_top[:, None]      # (ni, nj)
    Q = (1 - u)[:, None] * Q_left[None, :] + u[:, None] * Q_right[None, :]      # (ni, nj)

    X = grid[:, :, 0].copy()
    Y = grid[:, :, 1].copy()
    ii = slice(1, -1)
    ci, cj = np.meshgrid(np.arange(1, ni - 1), np.arange(1, nj - 1), indexing="ij")
    parity = (ci + cj) % 2
    # SOR at a fixed omega is only unconditionally stable up to some
    # geometry-dependent threshold - confirmed diverging (overflow -> NaN)
    # on a real block here: the same nose-block shape that converges cleanly
    # against a distant far-field boundary blew up once wrapped snugly around
    # a much smaller outer box (a far more extreme aspect ratio). Rather than
    # chase a per-geometry-safe omega, just detect divergence and back off to
    # the last finite iterate - always safe, and the caller's own quality
    # gate would have discarded a diverged result anyway, this just avoids
    # computing (and warning about) garbage in the meantime.
    if native.AVAILABLE:
        X, Y = native.tm_sor(X, Y, P, Q, iterations, omega)
        out = grid.copy()
        out[:, :, 0] = X
        out[:, :, 1] = Y
        return out

    lastX, lastY = X.copy(), Y.copy()
    with np.errstate(over="ignore", invalid="ignore"):
        for _ in range(iterations):
            for color in (0, 1):
                mask = parity == color
                x_xi = 0.5 * (X[2:, ii] - X[:-2, ii])
                y_xi = 0.5 * (Y[2:, ii] - Y[:-2, ii])
                x_et = 0.5 * (X[ii, 2:] - X[ii, :-2])
                y_et = 0.5 * (Y[ii, 2:] - Y[ii, :-2])
                alpha = x_et * x_et + y_et * y_et
                gamma = x_xi * x_xi + y_xi * y_xi
                beta = x_xi * x_et + y_xi * y_et
                J = x_xi * y_et - x_et * y_xi
                x_xy = 0.25 * (X[2:, 2:] - X[2:, :-2] - X[:-2, 2:] + X[:-2, :-2])
                y_xy = 0.25 * (Y[2:, 2:] - Y[2:, :-2] - Y[:-2, 2:] + Y[:-2, :-2])
                Pc, Qc = P[ii, ii], Q[ii, ii]
                rhs_x = (alpha * (X[2:, ii] + X[:-2, ii]) + gamma * (X[ii, 2:] + X[ii, :-2])
                         - 2 * beta * x_xy + (J * J) * (Pc * x_xi + Qc * x_et))
                rhs_y = (alpha * (Y[2:, ii] + Y[:-2, ii]) + gamma * (Y[ii, 2:] + Y[ii, :-2])
                         - 2 * beta * y_xy + (J * J) * (Pc * y_xi + Qc * y_et))
                denom = 2.0 * (alpha + gamma)
                denom = np.where(np.abs(denom) > 1e-12, denom, 1.0)
                newX = rhs_x / denom
                newY = rhs_y / denom
                X[ii, ii] = np.where(mask, X[ii, ii] + omega * (newX - X[ii, ii]), X[ii, ii])
                Y[ii, ii] = np.where(mask, Y[ii, ii] + omega * (newY - Y[ii, ii]), Y[ii, ii])
            if not (np.all(np.isfinite(X)) and np.all(np.isfinite(Y))):
                X, Y = lastX, lastY
                break
            lastX, lastY = X.copy(), Y.copy()

    out = grid.copy()
    out[:, :, 0] = X
    out[:, :, 1] = Y
    return out
