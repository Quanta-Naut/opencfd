"""Packed JSON: a JSON document whose large numeric arrays travel as typed-array
blocks instead of text. Used for field data (live previews, results, run
snapshots, the autosaved `fieldData`): a 200k-cell result is ~15-25 MB of
JSON and a few MB packed, and neither end has to format or parse numbers.

Must stay in sync with frontend/src/utils/packedJson.ts.

Layout (little-endian):

    0      8   magic  b"OCFDPAK1"
    8      4   uint32 header length H
    12     H   header: UTF-8 JSON {"doc": ..., "arrays": [...]}
    ...        zero padding to a multiple of 8
    ...        array blocks, each starting on a multiple of 8

`doc` is the original document with every packed array replaced by
{"$pk": i}; `arrays[i]` is {"dtype": "f4"|"f8"|"i4", "shape": [n] or [n, k],
"offset": byte offset from the start of the block area}.

What gets packed: a list of >= MIN_LEN numbers, or a list of >= MIN_LEN
equal-length lists of numbers (e.g. mesh nodes). All-integer data is int32,
other numbers float32 unless the caller asks for float64. Booleans and
everything shorter stay ordinary JSON.
"""

import json
import struct
from numbers import Real
from typing import Any, Dict, List, Tuple

import numpy as np

MAGIC = b"OCFDPAK1"
MEDIA_TYPE = "application/x-opencfd-packed"
MIN_LEN = 256
_INT32 = (-(2 ** 31), 2 ** 31 - 1)


def _pad8(n: int) -> int:
    return (8 - n % 8) % 8


def _is_num(v: Any) -> bool:
    return isinstance(v, Real) and not isinstance(v, bool)


def _as_array(value: Any, float64: bool):
    """A numpy array for a packable list, or None."""
    if isinstance(value, np.ndarray):
        arr = value
    elif isinstance(value, list) and len(value) >= MIN_LEN:
        first = value[0]
        if _is_num(first):
            if not all(_is_num(v) for v in value):
                return None
        elif isinstance(first, list) and first and all(_is_num(v) for v in first):
            k = len(first)
            if not all(isinstance(r, list) and len(r) == k and all(_is_num(v) for v in r)
                       for r in value):
                return None
        else:
            return None
        arr = np.asarray(value)
    else:
        return None
    if arr.ndim not in (1, 2) or arr.dtype.kind not in "iuf" or arr.size == 0:
        return None
    if arr.dtype.kind in "iu" and arr.size and _INT32[0] <= arr.min() and arr.max() <= _INT32[1]:
        return arr.astype("<i4")
    return arr.astype("<f8" if float64 else "<f4")


def pack(doc: Any, float64: bool = False) -> bytes:
    blocks: List[bytes] = []
    specs: List[Dict[str, Any]] = []
    offset = 0

    def walk(v: Any) -> Any:
        nonlocal offset
        arr = _as_array(v, float64)
        if arr is not None:
            raw = np.ascontiguousarray(arr).tobytes()
            specs.append({"dtype": arr.dtype.str[1:], "shape": list(arr.shape), "offset": offset})
            blocks.append(raw + b"\0" * _pad8(len(raw)))
            offset += len(raw) + _pad8(len(raw))
            return {"$pk": len(specs) - 1}
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        if isinstance(v, (list, tuple)):
            return [walk(x) for x in v]
        if isinstance(v, np.generic):
            return v.item()
        return v

    packed_doc = walk(doc)
    hbytes = json.dumps({"doc": packed_doc, "arrays": specs}, separators=(",", ":")).encode()
    head = MAGIC + struct.pack("<I", len(hbytes)) + hbytes
    head += b"\0" * _pad8(len(head))
    return head + b"".join(blocks)


def _header(raw: bytes) -> Tuple[Dict[str, Any], int]:
    if len(raw) < 12 or raw[:8] != MAGIC:
        raise ValueError("not an OpenCFD packed document")
    (hlen,) = struct.unpack_from("<I", raw, 8)
    try:
        header = json.loads(raw[12:12 + hlen].decode())
    except ValueError as exc:
        raise ValueError(f"corrupt packed header: {exc}") from exc
    base = 12 + hlen
    base += _pad8(base)
    for spec in header["arrays"]:
        n = int(np.prod(spec["shape"])) * np.dtype("<" + spec["dtype"]).itemsize
        if base + spec["offset"] + n > len(raw):
            raise ValueError("packed document is truncated")
    return header, base


def validate(raw: bytes) -> None:
    _header(raw)


def unpack(raw: bytes) -> Any:
    header, base = _header(raw)
    arrays = []
    for spec in header["arrays"]:
        dt = np.dtype("<" + spec["dtype"])
        count = int(np.prod(spec["shape"]))
        a = np.frombuffer(raw, dtype=dt, count=count, offset=base + spec["offset"])
        arrays.append(a.reshape(spec["shape"]).tolist())

    def walk(v: Any) -> Any:
        if isinstance(v, dict):
            if len(v) == 1 and "$pk" in v:
                return arrays[v["$pk"]]
            return {k: walk(x) for k, x in v.items()}
        if isinstance(v, list):
            return [walk(x) for x in v]
        return v

    return walk(header["doc"])


def is_packed(raw: bytes) -> bool:
    return raw[:8] == MAGIC
