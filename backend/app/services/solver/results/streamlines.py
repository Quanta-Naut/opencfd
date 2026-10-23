"""Streamline tracing over the node velocity field (NumPy)."""

from __future__ import annotations

import math
from typing import List
import numpy as np


def _streamlines_numpy(centres: np.ndarray, cell_u: np.ndarray,
                       nodes_xy: np.ndarray, n_seeds: int = 24) -> List[List[List[float]]]:
    """RK4 streamlines on a rasterised velocity grid, seeded down the inlet.
    Cells more than a few cell-widths from any data point are treated as solid
    (the body / outside the domain) so lines stop at walls."""
    centres = np.asarray(centres, dtype=float)[:, :2]
    cell_u = np.asarray(cell_u, dtype=float)[:, :2]
    nodes_xy = np.asarray(nodes_xy, dtype=float)
    if len(centres) < 3 or len(nodes_xy) < 3:
        return []
    xmin, ymin = nodes_xy.min(axis=0)
    xmax, ymax = nodes_xy.max(axis=0)
    w, h = float(xmax - xmin), float(ymax - ymin)
    if w <= 0 or h <= 0:
        return []

    # Rasterise the cell velocities onto a uniform grid (O(cells), no NN search),
    # then dilate a few passes to bridge coarse far-field gaps. Whatever is still
    # empty is the body or outside the domain -> solid wall (zero velocity).
    cell_sz = math.sqrt(w * h / len(centres))
    nx = int(np.clip(w / (1.3 * cell_sz), 60, 260))
    ny = int(np.clip(h / (1.3 * cell_sz), 30, 200))
    ix = np.clip(((centres[:, 0] - xmin) / w * (nx - 1)).astype(int), 0, nx - 1)
    iy = np.clip(((centres[:, 1] - ymin) / h * (ny - 1)).astype(int), 0, ny - 1)
    acc = np.zeros((nx, ny, 2))
    cnt = np.zeros((nx, ny))
    np.add.at(acc, (ix, iy), cell_u)
    np.add.at(cnt, (ix, iy), 1.0)
    u_grid = np.divide(acc, cnt[..., None], out=np.zeros_like(acc), where=cnt[..., None] > 0)
    filled = cnt > 0
    for _ in range(2):
        if filled.all():
            break
        nb = np.zeros_like(acc)
        nbc = np.zeros_like(cnt)
        for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            g2 = np.roll(np.roll(u_grid, sx, 0), sy, 1)
            f2 = np.roll(np.roll(filled, sx, 0), sy, 1).astype(float)
            nb += g2 * f2[..., None]
            nbc += f2
        newly = (~filled) & (nbc > 0)
        u_grid[newly] = nb[newly] / nbc[newly][..., None]
        filled |= newly
    u_grid[~filled] = 0.0

    def vel(P: np.ndarray) -> np.ndarray:
        fx = np.clip((P[:, 0] - xmin) / w * (nx - 1), 0, nx - 1)
        fy = np.clip((P[:, 1] - ymin) / h * (ny - 1), 0, ny - 1)
        ix = np.floor(fx).astype(int)
        iy = np.floor(fy).astype(int)
        ix1 = np.minimum(ix + 1, nx - 1)
        iy1 = np.minimum(iy + 1, ny - 1)
        tx = (fx - ix)[:, None]
        ty = (fy - iy)[:, None]
        return (u_grid[ix, iy] * (1 - tx) * (1 - ty) + u_grid[ix1, iy] * tx * (1 - ty)
                + u_grid[ix, iy1] * (1 - tx) * ty + u_grid[ix1, iy1] * tx * ty)

    def unit(P: np.ndarray):
        v = vel(P)
        s = np.linalg.norm(v, axis=1, keepdims=True)
        return np.where(s > 1e-12, v / np.maximum(s, 1e-12), 0.0), s[:, 0]

    speed_ref = max(float(np.percentile(np.linalg.norm(cell_u, axis=1), 90)), 1e-6)
    step = 0.5 * min(w / nx, h / ny)
    nsteps = int(3.5 * w / step)
    seeds_y = np.linspace(ymin + 0.03 * h, ymax - 0.03 * h, n_seeds)
    P = np.column_stack([np.full(n_seeds, xmin + 0.01 * w), seeds_y])
    paths = [[[round(float(P[i, 0]), 4), round(float(P[i, 1]), 4)]] for i in range(n_seeds)]
    alive = np.ones(n_seeds, dtype=bool)

    for _ in range(nsteps):
        if not alive.any():
            break
        d1, s1 = unit(P)
        d2, _ = unit(P + 0.5 * step * d1)
        d3, _ = unit(P + 0.5 * step * d2)
        d4, _ = unit(P + step * d3)
        P = P + step / 6.0 * (d1 + 2 * d2 + 2 * d3 + d4)
        stalled = s1 < 1e-3 * speed_ref
        out = ((P[:, 0] < xmin) | (P[:, 0] > xmax)
               | (P[:, 1] < ymin) | (P[:, 1] > ymax))
        for i in np.where(alive)[0]:
            if stalled[i] or out[i]:
                alive[i] = False
                continue
            paths[i].append([round(float(P[i, 0]), 4), round(float(P[i, 1]), 4)])

    return [pl for pl in paths if len(pl) > 4]
