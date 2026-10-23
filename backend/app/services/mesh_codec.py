"""Binary mesh container, shared by the HTTP API, the project store and the solver.

A 200k-cell mesh is ~17 MB of JSON (nested [x, y, z] / [a, b, c, d] lists)
that both ends spend hundreds of milliseconds producing and parsing. This
format carries the same mesh in ~7 MB with no per-number parsing: the
frontend views the arrays in place (see frontend/src/utils/meshCodec.ts,
which must stay in sync with this file).

Layout (all little-endian):

    0      8   magic  b"OCFDMSH1"
    8      4   uint32 header length H
    12     H   header: UTF-8 JSON with every mesh key except nodes/elements,
               plus "_bin": {"n": nodes, "dim": stored coords per node,
               "zdim": coords per node in the original (2 or 3),
               "m": elements, "conn": connectivity length}
    ...        zero padding to a multiple of 8
    float64    n * dim node coordinates (exact, so the solver sees the same mesh)
    uint32     m + 1 element offsets into the connectivity
    uint32     conn element node ids

Nodes whose z is 0 everywhere (every 2D mesh) are stored as x, y only and
come back as [x, y, 0.0], so a round trip is exact.
"""

import json
import struct
from typing import Any, Dict

import numpy as np

MAGIC = b"OCFDMSH1"
MEDIA_TYPE = "application/x-opencfd-mesh"


def _pad8(n: int) -> int:
    return (8 - n % 8) % 8


def encode_mesh(mesh: Dict[str, Any]) -> bytes:
    nodes = mesh.get("nodes") or []
    elements = mesh.get("elements") or []

    zdim = len(nodes[0]) if nodes else 2
    if any(len(nd) != zdim for nd in nodes) or zdim not in (2, 3):
        raise ValueError("mesh nodes must all have 2 or all have 3 coordinates")
    coords = np.asarray(nodes, dtype=np.float64).reshape(-1, zdim)
    if zdim == 3 and not np.any(coords[:, 2]):
        coords = coords[:, :2]
    coords = np.ascontiguousarray(coords)

    sizes = np.fromiter((len(e) for e in elements), dtype=np.int64, count=len(elements))
    offsets = np.zeros(len(elements) + 1, dtype=np.int64)
    np.cumsum(sizes, out=offsets[1:])
    conn = np.fromiter(
        (v for e in elements for v in e), dtype=np.int64, count=int(offsets[-1]),
    )
    if conn.size and (conn.min() < 0 or conn.max() >= len(nodes)):
        raise ValueError("element references a node that does not exist")
    conn = conn.astype(np.uint32)

    header = {k: v for k, v in mesh.items() if k not in ("nodes", "elements")}
    header["_bin"] = {
        "n": len(nodes), "dim": int(coords.shape[1]), "zdim": zdim,
        "m": len(elements), "conn": int(conn.size),
    }
    hbytes = json.dumps(header, separators=(",", ":"), default=_json_default).encode()
    head = MAGIC + struct.pack("<I", len(hbytes)) + hbytes
    head += b"\0" * _pad8(len(head))
    return b"".join([head, coords.astype("<f8").tobytes(), offsets.astype("<u4").tobytes(),
                     conn.astype("<u4").tobytes()])


def decode_header(raw: bytes):
    """Parse and validate the header. Returns (header, info, array offset);
    raises ValueError on a corrupt or truncated body."""
    if len(raw) < 12 or raw[:8] != MAGIC:
        raise ValueError("not an OpenCFD binary mesh")
    (hlen,) = struct.unpack_from("<I", raw, 8)
    try:
        header = json.loads(raw[12:12 + hlen].decode())
        info = header.pop("_bin")
        n, dim, m, nconn = int(info["n"]), int(info["dim"]), int(info["m"]), int(info["conn"])
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError(f"corrupt binary mesh header: {exc}") from exc
    pos = 12 + hlen
    pos += _pad8(pos)
    if len(raw) != pos + n * dim * 8 + (m + 1) * 4 + nconn * 4:
        raise ValueError("binary mesh is truncated or has trailing data")
    return header, info, pos


def decode_mesh(raw: bytes) -> Dict[str, Any]:
    header, info, pos = decode_header(raw)
    n, dim, zdim, m, nconn = info["n"], info["dim"], info["zdim"], info["m"], info["conn"]

    coords = np.frombuffer(raw, dtype="<f8", count=n * dim, offset=pos).reshape(n, dim)
    pos += n * dim * 8
    offsets = np.frombuffer(raw, dtype="<u4", count=m + 1, offset=pos)
    pos += (m + 1) * 4
    conn = np.frombuffer(raw, dtype="<u4", count=nconn, offset=pos)

    if zdim == 3 and dim == 2:
        coords = np.column_stack([coords, np.zeros(n)])
    nodes = coords.tolist()
    sizes = np.diff(offsets)
    if m and np.all(sizes == sizes[0]):  # all quads or all triangles: one reshape
        elements = conn.reshape(m, int(sizes[0])).tolist()
    else:
        flat = conn.tolist()
        bounds = offsets.tolist()
        elements = [flat[bounds[i]:bounds[i + 1]] for i in range(m)]
    header["nodes"] = nodes
    header["elements"] = elements
    return header


def is_binary_mesh(raw: bytes) -> bool:
    return raw[:8] == MAGIC


def _json_default(o: Any) -> Any:
    if hasattr(o, "tolist"):
        return o.tolist()
    raise TypeError(f"{type(o).__name__} is not JSON serialisable")
