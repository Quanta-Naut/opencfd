"""Wall quantities for the Results tab: y+ and wall shear stress on the wall
nodes, and the drag / lift split into pressure and viscous parts.

y+ and wallShearStress are written by function objects as fields whose wall
patch values sit in boundaryField, one per wall face. Those face values are
mapped onto the 2D mesh's wall nodes through the face centres."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

_FACE_CACHE: Dict[tuple, Dict[str, Tuple[np.ndarray, str]]] = {}


def _patch_faces(case: Path) -> Dict[str, Tuple[np.ndarray, str]]:
    """{patch: (face centres (n, 2), patch type)} from constant/polyMesh."""
    poly = case / "constant" / "polyMesh"
    files = [poly / n for n in ("boundary", "faces", "points")]
    if not all(f.is_file() for f in files):
        return {}
    key = (str(poly), *(f.stat().st_mtime for f in files))
    if key in _FACE_CACHE:
        return _FACE_CACHE[key]

    btext = (poly / "boundary").read_text(encoding="utf-8", errors="ignore")
    patches: List[Tuple[str, str, int, int]] = []
    for m in re.finditer(r"(\w+)\s*\{([^{}]*)\}", btext):
        body = m.group(2)
        t = re.search(r"\btype\s+(\w+);", body)
        n = re.search(r"\bnFaces\s+(\d+);", body)
        s = re.search(r"\bstartFace\s+(\d+);", body)
        if t and n and s:
            patches.append((m.group(1), t.group(1), int(s.group(1)), int(n.group(1))))
    if not patches:
        return {}

    ptext = (poly / "points").read_text(encoding="utf-8", errors="ignore")
    mp = re.search(r"\n(\d+)\s*\n\(", ptext)
    if not mp:
        return {}
    pts = np.fromstring(
        ptext[mp.end():ptext.rfind(")")].replace("(", " ").replace(")", " "), sep=" "
    ).reshape(-1, 3)

    ftext = (poly / "faces").read_text(encoding="utf-8", errors="ignore")
    body = ftext[ftext.find("(") + 1:ftext.rfind(")")]
    faces = re.findall(r"\d+\((\d+(?:\s+\d+)+)\)", body)
    out: Dict[str, Tuple[np.ndarray, str]] = {}
    for name, ptype, start, n in patches:
        if ptype in ("empty", "wedge") or n == 0 or start + n > len(faces):
            continue
        centres = np.array(
            [pts[[int(v) for v in faces[i].split()]][:, :2].mean(axis=0) for i in range(start, start + n)]
        )
        out[name] = (centres, ptype)
    _FACE_CACHE.clear()
    _FACE_CACHE[key] = out
    return out


def _patch_values(path: Path, patch: str, n: int) -> Optional[np.ndarray]:
    """One patch's face values from a field file: (n,) or (n, 3)."""
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8", errors="ignore")
    bf = text.find("boundaryField")
    m = re.search(rf"\n\s*{re.escape(patch)}\s*\{{", text[bf:]) if bf >= 0 else None
    if not m:
        return None
    # The patch's block: value lists hold no braces, so it ends at the first.
    seg = text[bf + m.end():]
    seg = seg[:seg.find("}")] if "}" in seg else seg
    nu = re.search(r"value\s+nonuniform\s+List<(scalar|vector)>\s*(\d+)\s*\(", seg)
    if nu:
        close = seg.rfind(")")
        nums = np.fromstring(seg[nu.end():close].replace("(", " ").replace(")", " "), sep=" ")
        vals = nums.reshape(-1, 3) if nu.group(1) == "vector" else nums
        return vals[:n] if len(vals) >= n else None
    un = re.search(r"value\s+uniform\s+([^;]+);", seg)
    if un:
        v = np.array([float(x) for x in un.group(1).strip("() ").split()], dtype=float)
        return np.tile(v, (n, 1)) if v.size == 3 else np.full(n, float(v[0]))
    return None


def wall_node_fields(case: Path, tdir: Path, nodes_xy: np.ndarray,
                     boundaries: Dict[str, List[int]]) -> Dict[str, np.ndarray]:
    """yPlus, wallShear (|tau|) and wallShearX per mesh node, 0 off the walls.
    Shear is as OpenFOAM writes it: kinematic (m2/s2) for an incompressible
    run, Pa for a compressible one. Empty when the run wrote neither."""
    if not (tdir / "yPlus").is_file() and not (tdir / "wallShearStress").is_file():
        return {}
    faces = _patch_faces(case)
    nn = len(nodes_xy)
    out = {k: np.zeros(nn) for k in ("yPlus", "wallShear", "wallShearX")}
    found = False
    for patch, (centres, ptype) in faces.items():
        if ptype != "wall":
            continue
        ids = np.asarray(boundaries.get(patch) or [], dtype=int)
        ids = ids[(ids >= 0) & (ids < nn)]
        if not ids.size:
            continue
        n = len(centres)
        yp = _patch_values(tdir / "yPlus", patch, n)
        ws = _patch_values(tdir / "wallShearStress", patch, n)
        if yp is None and ws is None:
            continue
        found = True
        # Each wall node sits between two wall faces: average the nearest
        # two, weighted by inverse distance.
        d = np.linalg.norm(nodes_xy[ids][:, None, :] - centres[None, :, :], axis=2)
        k = min(2, n)
        near = np.argsort(d, axis=1)[:, :k]
        w = 1.0 / np.maximum(np.take_along_axis(d, near, axis=1), 1e-12)
        w /= w.sum(axis=1, keepdims=True)

        def at_nodes(face_vals: np.ndarray) -> np.ndarray:
            return (face_vals[near] * w).sum(axis=1)

        if yp is not None and yp.ndim == 1:
            out["yPlus"][ids] = at_nodes(yp)
        if ws is not None and ws.ndim == 2:
            out["wallShear"][ids] = at_nodes(np.linalg.norm(ws[:, :2], axis=1))
            out["wallShearX"][ids] = at_nodes(ws[:, 0])
    return out if found else {}


def _last_row(path: Path, time_name: Optional[str]) -> Optional[str]:
    """The row for `time_name` (else the last row) of a postProcessing file."""
    rows = [r for r in path.read_text(encoding="utf-8", errors="ignore").splitlines()
            if r.strip() and not r.lstrip().startswith("#")]
    if not rows:
        return None
    if time_name is not None:
        for r in reversed(rows):
            if r.split(None, 1)[0] == time_name:
                return r
    return rows[-1]


def _newest(case: Path, name: str, file: str) -> Optional[Path]:
    files = list((case / "postProcessing" / name).glob(f"*/{file}"))
    return max(files, key=lambda p: p.stat().st_mtime) if files else None


def force_breakdown(case: Path, time_name: Optional[str]) -> Optional[Dict[str, float]]:
    """Cd, Cl, Cm and the pressure / viscous parts of Cd and Cl."""
    coeffs = _newest(case, "forceCoeffs", "forceCoeffs.dat")
    if coeffs is None:
        return None
    text = coeffs.read_text(encoding="utf-8", errors="ignore")
    hdr: Dict[str, str] = {}
    for m in re.finditer(r"^#\s*(\w+)\s*:\s*(.+)$", text, re.M):
        hdr[m.group(1)] = m.group(2).strip()
    cols = re.search(r"^#\s*Time\s+(.+)$", text, re.M)
    row = _last_row(coeffs, time_name)
    if not cols or not row:
        return None
    names = cols.group(1).split()
    vals = row.split()[1:]
    got = {n: float(v) for n, v in zip(names, vals)}
    out = {k.lower(): round(got[k], 6) for k in ("Cd", "Cl", "Cm") if k in got}

    split = _newest(case, "forcesSplit", "forces.dat")
    srow = _last_row(split, time_name) if split else None
    vec = lambda s: np.array([float(x) for x in s.strip("() ").split()])
    try:
        drag, lift = vec(hdr["dragDir"]), vec(hdr["liftDir"])
        U, A = float(hdr["magUInf"]), float(hdr["Aref"])
        cd_text = (case / "system" / "controlDict").read_text(encoding="utf-8", errors="ignore")
        rho = float(re.search(r"\brhoInf\s+([\d.eE+-]+);", cd_text).group(1))
    except (KeyError, ValueError, AttributeError, OSError):
        return out or None
    if srow:
        v = re.findall(r"\(([^()]+)\)", srow)
        if len(v) >= 2:
            qa = 0.5 * rho * U * U * A
            fp, fv = vec(v[0]), vec(v[1])
            if qa > 0:
                out.update({
                    "cd_pressure": round(float(fp @ drag) / qa, 6),
                    "cd_viscous": round(float(fv @ drag) / qa, 6),
                    "cl_pressure": round(float(fp @ lift) / qa, 6),
                    "cl_viscous": round(float(fv @ lift) / qa, 6),
                })
    return out or None
