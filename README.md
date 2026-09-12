# OpenCFD

An open source, GUI-first Computational Fluid Dynamics application, built on
top of [OpenFOAM](https://www.openfoam.com/) and [Gmsh](https://gmsh.info/).
OpenCFD is 2D only today - geometry, meshing, physics setup, solving, and
post-processing all currently work in two dimensions.

## Why this project exists

Open source software has produced genuinely great tools in other technical
domains. Blender is a full 3D content creation suite - modeling, animation,
rendering, entire films made on it - and it's free. FreeCAD gives anyone a
real parametric CAD tool. Both are maintained by large communities and are
good enough to be a first choice, not just a free fallback.

CFD doesn't have that yet. OpenFOAM is a serious, capable, free solver used
in real industry and research - but it's a command-line tool with a steep
setup curve and no built-in way to build geometry, mesh it, or look at
results. Commercial tools like ANSYS Fluent solved the usability problem
decades ago, but they're commercial: expensive, licensed, closed. There is
no open source equivalent that pairs a real solver with a GUI someone can
actually sit down and use.

OpenCFD is an attempt to start closing that gap - a GUI built around
OpenFOAM that takes you from drawing geometry to a converged, visualized
result, without needing to already know OpenFOAM's file format and
directory structure to get there. It's an early-stage initiative, not a
finished product, and 2D is the starting point, not the ceiling.

## What you can do with it today

- **Sketch geometry** directly in the app - a 2D CAD tool with snapping,
  live dimensions, fillets, offsets, and an ellipse/circle/airfoil toolset,
  or import an airfoil `.dat`/CSV or a DXF file.
- **Mesh it** two ways: fast unstructured meshing via Gmsh, or an
  ICEM-style interactive structured (block) mesher with draggable block
  topology, O-grids around bodies, and grading control.
- **Size the boundary layer properly** with a built-in y+ calculator that
  computes first-cell height from your flow conditions and can apply it
  directly to wall-normal mesh clustering.
- **Set up the physics** - laminar or turbulent (k-omega SST, k-epsilon and
  its variants, Spalart-Allmaras), internal or external flow, boundary
  conditions with auto-derived turbulence quantities.
- **Run the real OpenFOAM solver** - not a mock or a simplified
  approximation - with live residual and force-coefficient monitoring
  while it runs.
- **Post-process results** on a GPU-accelerated field viewer (velocity,
  pressure, turbulence quantities, vorticity), with streamlines, mesh
  quality inspection, and a line-probe plotting tool for custom XY plots
  along any path through the geometry - or hand off to ParaView for full
  3D-capable post-processing.
- **Keep your work** - every solver run and every plot you create is
  saved to disk and is still there the next time you open the project.
- **Run it as a real desktop app** on Linux, macOS, or Windows (via a
  managed WSL2 OpenFOAM environment), packaged with Tauri.

## Documentation

- [Developing OpenCFD](./docs/DEVELOPING.md) - running it locally, cutting
  a release, and how the OpenFOAM integration works.
- [Packaging](./docs/PACKAGING.md) - how OpenCFD ships as a desktop
  installer on each platform.
- [Design guidelines](./docs/DESIGN.md) - the visual direction for the UI.
- [Contributing](./docs/CONTRIBUTING.md) - how to contribute, and what's
  most useful to work on right now.
