# OpenCFD

An open source, GUI-first CFD application. Draw or import a 2D geometry,
mesh it, set up the physics, run a real [OpenFOAM](https://www.openfoam.com/)
solve and look at the results, all in one desktop app.

OpenCFD is 2D today. Geometry, meshing, setup, solving and post-processing
all work in two dimensions, and 2D is the starting point, not the ceiling.

## Why this project exists

Blender and FreeCAD show that open source can be a first choice, not just a
free fallback. CFD does not have that yet. OpenFOAM is a serious solver, but
it is a command-line tool with no built-in way to build geometry, mesh it or
look at results. Commercial tools solved usability long ago, but they are
expensive and closed. OpenCFD is an attempt to close that gap with a GUI
that takes you from a sketch to a converged, visualized result without
having to learn OpenFOAM's file layout first.

## What it does

**Geometry.** A 2D sketcher with snapping, live dimensions, fillets,
offsets, splines, ellipses, trim and transforms. You can also import an
airfoil `.dat` or CSV file, or a DXF drawing.

**Meshing.** Two routes, both on top of [Gmsh](https://gmsh.info/):
- Unstructured meshing for quick results.
- An ICEM-style structured mesher where you build the block topology
  yourself, associate blocks to geometry, set spacing and grading, and
  smooth the result. It works for any shape, not just airfoils.

Mesh quality is shown on the mesh itself so problems are easy to spot.

**Setup and solving.** Choose laminar or turbulent flow (k-omega SST,
k-epsilon variants, Spalart-Allmaras), incompressible or compressible,
internal, external or axisymmetric. Boundary conditions and turbulence
quantities are derived for you. The case is written for the real OpenFOAM
solver and run with live residuals and force coefficients.

**Results.** A fast field viewer for velocity, pressure, turbulence and
vorticity, with streamlines, probes, reports, integrals and line plots.
Every run is saved with its project.

## Built with

- [OpenFOAM](https://www.openfoam.com/) for solving
- [Gmsh](https://gmsh.info/) for meshing
- [Tauri](https://tauri.app/) for the desktop shell
- React, TypeScript and Vite for the interface
- Python and FastAPI for the backend
- Rust for the performance-critical mesh and field kernels

## Platforms

- **Windows:** OpenFOAM runs in a managed WSL2 environment that the app sets
  up for you on first launch.
- **Linux:** the app runs natively. On x86_64 Ubuntu and its derivatives it
  offers to install OpenFOAM 13 for you from the official repository (you
  approve it with your administrator password). On other distributions
  it uses an OpenFOAM installation already on your machine.
- **macOS (Apple Silicon):** the app runs natively and uses an OpenFOAM
  build you have installed yourself. Without one you can still sketch and
  mesh, but solving needs OpenFOAM. macOS is untested so far.

## Documentation

- [Developing OpenCFD](./docs/DEVELOPING.md): running it locally and how the
  OpenFOAM integration works.
- [Packaging](./docs/PACKAGING.md): how OpenCFD ships on each platform.
- [Design guidelines](./docs/DESIGN.md): the visual direction for the UI.
- [Contributing](./docs/CONTRIBUTING.md): how to help.

## License

MIT
