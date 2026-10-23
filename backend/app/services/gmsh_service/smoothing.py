import math
from typing import Any, Dict, List, Tuple

import numpy as np

def _one_ring8(node: int, quad_ids: List[int], quads: List[List[int]]):
    """Order the 8 nodes around an interior quad-mesh node as
    (n, s, e, w, ne, nw, sw, se). Returns None if the node is not cleanly
    surrounded by four quads."""
    if len(quad_ids) != 4:
        return None
    info = []
    for qi in quad_ids:
        q = quads[qi]
        try:
            p = q.index(node)
        except ValueError:
            return None
        info.append([q[(p - 1) % 4], q[(p + 1) % 4], q[(p + 2) % 4]])  # left, right, diag
    ordered = [info[0]]
    remaining = info[1:]
    for _ in range(3):
        right = ordered[-1][1]
        nxt = None
        for k, it in enumerate(remaining):
            if it[0] == right:
                nxt = remaining.pop(k)
                break
            if it[1] == right:
                it = [it[1], it[0], it[2]]
                remaining.pop(k)
                nxt = it
                break
        if nxt is None:
            return None
        ordered.append(nxt)
    if ordered[-1][1] != ordered[0][0]:
        return None
    r = [o[1] for o in ordered]   # edge neighbours, cyclic: r0..r3
    d = [o[2] for o in ordered]   # diagonal of quad k sits between r[k] and r[k-1]
    # r0=e, r1=n, r2=w, r3=s ; d1=ne, d2=nw, d3=sw, d0=se
    return (r[1], r[3], r[0], r[2], d[1], d[2], d[3], d[0])


def _winslow_smooth(nodes: List[List[float]], elements: List[List[int]],
                    fixed_idx: set, iterations: int = 0, omega: float = 0.65,
                    taper: int = 6, w_max: float = 0.85) -> Dict[str, Any]:
    """Elliptic (Winslow) smoothing of the free interior nodes, in place.

    Solves alpha*x_xx - 2*beta*x_xy + gamma*x_yy = 0 by damped-Jacobi relaxation
    on the 8-node stencil so grid lines flow across block seams instead of
    kinking. True geometry-boundary nodes and block corners (`fixed_idx`) never
    move. The correction is tapered back toward the transfinite position near
    fixed nodes so topological corners keep their clean quality.

    `iterations` == 0 picks a count from the mesh size (Jacobi needs ~O(grid
    width) sweeps to carry information across a block); it also stops early once
    the sweep displacement is negligible. Returns a status dict."""
    if not elements:
        return {"moved": 0, "sweeps": 0, "converged": False, "free": 0}
    quads = [e for e in elements if len(e) == 4]
    if not quads:
        return {"moved": 0, "sweeps": 0, "converged": False, "free": 0}
    n = len(nodes)
    node_quads: List[List[int]] = [[] for _ in range(n)]
    adj: List[set] = [set() for _ in range(n)]
    for q in quads:
        for a in range(4):
            adj[q[a]].add(q[(a + 1) % 4])
            adj[q[a]].add(q[(a + 3) % 4])
    for qi, q in enumerate(quads):
        for v in q:
            if 0 <= v < n:
                node_quads[v].append(qi)

    free: List[int] = []
    sten: List[Tuple[int, ...]] = []
    for i in range(n):
        if i in fixed_idx or len(node_quads[i]) != 4:
            continue
        s = _one_ring8(i, node_quads[i], quads)
        if s is not None:
            free.append(i)
            sten.append(s)
    if not free:
        return {"moved": 0, "sweeps": 0, "converged": False, "free": 0}

    # BFS layer distance of every free node from the nearest fixed node
    from collections import deque
    layer = [0] * n
    dq = deque()
    seen = set()
    for f in fixed_idx:
        if 0 <= f < n:
            dq.append(f)
            seen.add(f)
    while dq:
        u = dq.popleft()
        for v in adj[u]:
            if v not in seen:
                seen.add(v)
                layer[v] = layer[u] + 1
                dq.append(v)

    P = np.array([[nd[0], nd[1]] for nd in nodes], dtype=float)
    P0 = P.copy()
    fi = np.array(free, dtype=np.int64)
    st = np.array(sten, dtype=np.int64)  # columns: n s e w ne nw sw se
    N, S, E, W, NE, NW, SW, SE = (st[:, k] for k in range(8))

    # characteristic cell length, for the early-stop tolerance
    seg = np.linalg.norm(P[E] - P0[fi], axis=1)
    char = float(np.median(seg[seg > 0])) if np.any(seg > 0) else 1.0
    tol = 1e-3 * char

    if iterations <= 0:
        # Jacobi carries info ~one cell per sweep; a block ~sqrt(free) cells wide
        iterations = int(min(4000, max(250, 3.0 * math.sqrt(len(free)))))

    # Positions are packed as complex numbers z = x + iy, so each stencil
    # neighbour is one gather (into a reused buffer) instead of a row gather
    # of the (n, 2) array. The gathers dominate a sweep, and a sweep runs up
    # to thousands of times. The arithmetic is the same as the 2-D form:
    # |z|^2 = x^2 + y^2 and Re(a * conj(b)) = ax*bx + ay*by.
    z = P[:, 0] + 1j * P[:, 1]
    m = len(free)
    zn, zs, ze, zw, d = (np.empty(m, dtype=complex) for _ in range(5))

    sweeps = 0
    converged = False
    for it in range(iterations):
        np.take(z, N, out=zn)
        np.take(z, S, out=zs)
        np.take(z, E, out=ze)
        np.take(z, W, out=zw)
        z_xi = 0.5 * (ze - zw)
        z_et = 0.5 * (zn - zs)
        alpha = z_et.real * z_et.real + z_et.imag * z_et.imag
        beta = z_xi.real * z_et.real + z_xi.imag * z_et.imag
        gamma = z_xi.real * z_xi.real + z_xi.imag * z_xi.imag
        denom = 2.0 * (alpha + gamma)
        good = denom > 1e-18
        all_good = bool(good.all())
        safe = denom if all_good else np.where(good, denom, 1.0)
        np.take(z, NE, out=d)
        d -= z[NW]
        d -= z[SE]
        d += z[SW]
        new_z = (alpha * (ze + zw) + gamma * (zn + zs) - (0.5 * beta) * d) / safe
        if all_good:
            delta = omega * (new_z - z[fi])
            z[fi] += delta
        else:
            upd = fi[good]
            delta = omega * (new_z[good] - z[upd])
            z[upd] += delta
        sweeps = it + 1
        if it % 25 == 24:
            if delta.size and max(float(np.abs(delta.real).max()), float(np.abs(delta.imag).max())) < tol:
                converged = True
                break
    P[:, 0] = z.real
    P[:, 1] = z.imag

    # taper the correction back toward transfinite near fixed nodes
    w = np.array([min(w_max, max(0.0, (layer[i] - 1) / float(taper))) for i in free])
    P[fi] = P0[fi] + w[:, None] * (P[fi] - P0[fi])

    moved = 0
    for i in free:
        if abs(P[i][0] - nodes[i][0]) > 1e-7 or abs(P[i][1] - nodes[i][1]) > 1e-7:
            moved += 1
        nodes[i][0] = float(P[i][0])
        nodes[i][1] = float(P[i][1])
    return {"moved": moved, "sweeps": sweeps, "converged": converged, "free": len(free)}


