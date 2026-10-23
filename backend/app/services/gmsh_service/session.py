import threading
from contextlib import contextmanager

import gmsh

_gmsh_lock = threading.Lock()


@contextmanager
def _gmsh_session():
    """Serialize Gmsh's process-global C API state across backend requests.

    Meshing runs on a worker thread (so the server keeps answering while Gmsh
    works), and `interruptible=False` stops gmsh.initialize from installing a
    SIGINT handler, which Python only allows on the main thread.
    """
    with _gmsh_lock:
        gmsh.initialize(interruptible=False)
        try:
            yield
        finally:
            gmsh.finalize()

