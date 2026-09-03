# 🌊 OpenCFD Studio

A high-performance, minimalist CFD (Computational Fluid Dynamics) workbench combining **OpenFOAM** and **Gmsh** with a clean, modern **VS Code-style** desktop UI. Post-processing (smooth fields, streamlines, vorticity) runs on **NumPy** alone - no VTK/PyVista - so the packaged app stays lean.

---

## 🏛️ Architecture & Layout

* **Full-Height Sidebar (Left)**: Complete step-by-step CFD pipeline:
  1. **Geometry & Gmsh Mesher**: Parametric Airfoil (NACA 0012), Cylinder in Crossflow, Backward-Facing Step, Cavity, Channel flow.
  2. **Flow & Turbulence Engine**: Switch between **Laminar** and **Turbulent** ($k-\omega$ SST, $k-\epsilon$, Realizable $k-\epsilon$, RNG $k-\epsilon$, Spalart-Allmaras) with dynamic branching parameters and closure constants.
  3. **$y^+$ Calculator & Sizing Tool**: Computes Reynolds number ($Re$), boundary layer thickness ($\delta$), friction velocity ($u_\tau$), wall shear stress ($\tau_w$), and first cell height ($\Delta y$) with a 1-click **"Apply Sizing to Gmsh Mesh"** button.
  4. **Boundary Conditions**: Inlet velocity, turbulence intensity ($I$), length scale ($L_t$), auto-derived $k, \omega, \epsilon, \nu_t$, outlet pressure, and wall types.
  5. **OpenFOAM Solver Controls**: Timestep, write intervals, under-relaxation factors, tolerances, and the **"▶ Run OpenFOAM Solver"** trigger.
  6. **Post-Processing Studio**: Dynamic colormaps (Coolwarm, Turbo, Viridis, Rainbow), scalar field selector ($|U|, p, k, \omega, \nabla \times U$), streamlines, and wireframes.

* **Right Top Viewport**:
  * Interactive 2D/3D WebGL/Canvas viewport with Orbit/Pan/Zoom controls, mesh wireframe overlays, scalar colormaps, and streamlines.
  * **OpenFOAM Case Dicts Inspector**: View and copy generated dictionary files (`0/U`, `0/p`, `0/k`, `0/omega`, `constant/momentumTransport`, `system/controlDict`, `system/fvSchemes`, `system/fvSolution`).

* **Right Bottom Console**:
  * **Live Terminal Output**: Real-time monospace log streaming with OpenFOAM standard output.
  * **Residuals Convergence Monitor**: Live logarithmic line charts for $p, U_x, U_y, k, \omega$ updating per iteration.

---

## 🚀 Quick Start (1 Command)

To start both the Python backend and the frontend:

```bash
cd /home/quanta-naut/tut/OpenCFD
python3 run.py
```

Then open your browser at **`http://localhost:5173`** (or let Tauri launch the desktop window).

---

## 📦 Building Standalone Desktop Installers (Tauri)

To package as an installable desktop application (`.deb`, `.AppImage`, `.msi`, `.dmg`):

```bash
cd /home/quanta-naut/tut/OpenCFD
cargo tauri build
```
