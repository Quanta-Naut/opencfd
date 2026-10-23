"""Read a finished OpenFOAM case back into the field shape the viewer expects.

simpleFoam / pimpleFoam write cell-centred fields as ASCII lists under `<time>/`.
We also ask `postProcess -func writeCellCentres` for the cell centres (`Cx`, `Cy`),
then interpolate each cell value onto the 2D viewer mesh.

It is pure NumPy (`_assemble_from_cells`): bind each viewer element to its
OpenFOAM cell, average onto nodes the way VTK's cellDataToPointData does, and
integrate streamlines on a rasterised velocity grid. No VTK/PyVista - the only
heavy dependency is numpy, so the packaged app and the dev build run the same
code and render identically.

Output matches services.postprocess_service.generate_field_solution:
    {"fields": {"U_mag": [...per node...], "p": [...], "k": [...],
                "omega": [...], "vorticity": [...]},
     "ranges": {...}, "streamlines": [...], "reader": "numpy"}
"""

from .foamio import ResultsUnavailable
from .fields import read_field_preview, read_field_results
from .sampling import sample_field_along_line

__all__ = ['ResultsUnavailable', 'read_field_results', 'read_field_preview', 'sample_field_along_line']
