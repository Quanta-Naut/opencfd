"""Optional compiled smoothing kernels (Rust, `backend/native`), loaded via ctypes.

The Winslow and Thomas-Middlecoff relaxations are tight stencil loops that
NumPy can only express as thousands of whole-array passes; the compiled
versions run the same arithmetic 15-40x faster. They are strictly optional:
when the library is missing (not built, or an unsupported platform) every
caller falls back to its NumPy implementation, which produces the same mesh.

Build it with `cargo build --release` in `backend/native`. Set
`OPENCFD_KERNELS` to a library path to override the search, or to `0` to
force the NumPy path.
"""

import ctypes
import os
import sys
from pathlib import Path
from typing import Optional

import numpy as np

_LIB_NAMES = {
    "win32": "opencfd_kernels.dll",
    "darwin": "libopencfd_kernels.dylib",
}
_LIB_NAME = _LIB_NAMES.get(sys.platform, "libopencfd_kernels.so")

_f64p = ctypes.POINTER(ctypes.c_double)
_i64p = ctypes.POINTER(ctypes.c_int64)


def _candidates():
    env = os.environ.get("OPENCFD_KERNELS")
    if env:
        yield Path(env)
        return
    frozen = getattr(sys, "_MEIPASS", None)  # PyInstaller sidecar
    if frozen:
        yield Path(frozen) / _LIB_NAME
    backend = Path(__file__).resolve().parents[3]
    yield backend / "native" / "target" / "release" / _LIB_NAME


def _load() -> Optional[ctypes.CDLL]:
    if os.environ.get("OPENCFD_KERNELS") == "0":
        return None
    for path in _candidates():
        if not path.is_file():
            continue
        try:
            lib = ctypes.CDLL(str(path))
        except OSError:
            continue
        lib.winslow_jacobi.restype = ctypes.c_size_t
        lib.winslow_jacobi.argtypes = [
            _f64p, _f64p, ctypes.c_size_t, _i64p, _i64p, ctypes.c_size_t,
            ctypes.c_size_t, ctypes.c_double, ctypes.c_double, ctypes.POINTER(ctypes.c_int32),
        ]
        lib.tm_sor.restype = ctypes.c_size_t
        lib.tm_sor.argtypes = [
            _f64p, _f64p, _f64p, _f64p, ctypes.c_size_t, ctypes.c_size_t,
            ctypes.c_size_t, ctypes.c_double,
        ]
        return lib
    return None


_lib = _load()
AVAILABLE = _lib is not None


def _f64(a: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(a, dtype=np.float64)


def winslow_jacobi(x: np.ndarray, y: np.ndarray, free: np.ndarray, sten: np.ndarray,
                   iterations: int, omega: float, tol: float):
    """Run the Winslow Jacobi sweeps on `x`/`y` in place (both must be
    contiguous float64). Returns (sweeps, converged)."""
    assert _lib is not None
    assert x.flags.c_contiguous and y.flags.c_contiguous and x.dtype == y.dtype == np.float64
    free = np.ascontiguousarray(free, dtype=np.int64)
    sten = np.ascontiguousarray(sten, dtype=np.int64)
    n = len(x)
    if len(free) and (free.max() >= n or sten.max() >= n or min(free.min(), sten.min()) < 0):
        raise ValueError("stencil index out of range")
    conv = ctypes.c_int32(0)
    sweeps = _lib.winslow_jacobi(
        x.ctypes.data_as(_f64p), y.ctypes.data_as(_f64p), n,
        free.ctypes.data_as(_i64p), sten.ctypes.data_as(_i64p), len(free),
        int(iterations), float(omega), float(tol), ctypes.byref(conv),
    )
    return int(sweeps), bool(conv.value)


def tm_sor(X: np.ndarray, Y: np.ndarray, P: np.ndarray, Q: np.ndarray,
           iterations: int, omega: float):
    """Thomas-Middlecoff red-black SOR on one block. Returns new (X, Y)."""
    assert _lib is not None
    X = np.array(X, dtype=np.float64, order="C")  # always a fresh copy
    Y = np.array(Y, dtype=np.float64, order="C")
    P, Q = _f64(P), _f64(Q)
    ni, nj = X.shape
    if Y.shape != X.shape or P.shape != X.shape or Q.shape != X.shape:
        raise ValueError("tm_sor arrays must share one (ni, nj) shape")
    _lib.tm_sor(
        X.ctypes.data_as(_f64p), Y.ctypes.data_as(_f64p),
        P.ctypes.data_as(_f64p), Q.ctypes.data_as(_f64p),
        ni, nj, int(iterations), float(omega),
    )
    return X, Y
