"""Gmsh-backed mesh generation, split by category:

  session.py      - serializes Gmsh's process-global C API state
  geometry.py      - CAD-loop cleanup, joining, curvature-adaptive resampling
  quality.py       - per-element and whole-mesh quality metrics
  smoothing.py     - Winslow mesh smoothing
  unstructured.py  - unstructured (triangle/quad) mesh generation from CAD entities
  structured.py    - structured (block) mesh generation
  simple.py        - built-in demo geometries (NACA0012/cylinder/channel) and
                     the generate_mesh_data() dispatcher

This barrel keeps the public import surface (`from app.services.gmsh_service
import ...`) unchanged.
"""
from .simple import generate_mesh_data, generate_naca0012_points
from .structured import generate_structured_mesh
from .unstructured import generate_mesh_from_cad_entities

__all__ = [
    "generate_mesh_data",
    "generate_naca0012_points",
    "generate_structured_mesh",
    "generate_mesh_from_cad_entities",
]
