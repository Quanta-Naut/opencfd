import threading
from contextlib import contextmanager

import gmsh

_gmsh_lock = threading.Lock()


@contextmanager
def _gmsh_session():
    """Serialize Gmsh's process-global C API state across backend requests."""
    with _gmsh_lock:
        gmsh.initialize()
        try:
            yield
        finally:
            gmsh.finalize()

