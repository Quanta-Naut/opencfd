# OpenCFD packaging and solver distribution

How OpenCFD ships to end users and how the OpenFOAM solver reaches each platform.
Decision recorded 2026-08-29.

## App identity

- Product name: **OpenCFD** (same name everywhere: window title, installers, app data dir).
- One Tauri codebase, three platform installers built from it:
  - Linux: `.AppImage` + `.deb`
  - macOS: `.dmg` (universal or per-arch)
  - Windows: `.msi` (or NSIS `.exe`)
- Tauri bundles the frontend and launches the FastAPI backend as a sidecar on `127.0.0.1:8000`.

## Windows: the target experience

The user's contract: **enable WSL2, run the OpenCFD installer as administrator,
done.** No manual OpenFOAM install, no shell, no configuration.

To deliver that:

1. **Installer** (Tauri NSIS, run elevated) lays down the app and the bundled
   Python backend sidecar (frozen with PyInstaller so no Python install is
   needed), and runs the admin-only WSL bits: `wsl --update`,
   `wsl --set-default-version 2`.
2. **First launch** hits `SetupGate`. If the managed distro is missing it streams
   `provision()` behind a progress screen: download the solver pack ->
   `wsl --import OpenCFD-FOAM %LOCALAPPDATA%\OpenCFD\wsl <pack>.tar --version 2`
   -> verify `simpleFoam` -> write the setup marker.
3. Every launch after that: the backend's WSL adapter targets `OpenCFD-FOAM`
   automatically and the app opens straight to the home screen.
4. **Uninstall** runs `wsl --unregister OpenCFD-FOAM` and clears `%LOCALAPPDATA%\OpenCFD`.

The solver pack is either bundled in the installer (bigger download once, fully
offline) or fetched on first run (small installer). Bundling favours the
"one double-click" goal; revisit if size hurts.

If WSL2 is genuinely absent, `SetupGate` shows the `wsl --install` instruction
and a recheck button rather than letting the app run broken.

## Solver delivery per platform

The solver is OpenFOAM. We compile it ourselves in CI so we control the version and can
track new releases (Foundation "OpenFOAM 13" and later, or an ESI `vXXXX` line, pinned per
release). Each new upstream release triggers a rebuild of the packs below.

### Linux and macOS: bundled native build

- CI builds a trimmed OpenFOAM from source:
  - Linux: inside an old-glibc container (for example Ubuntu 20.04) so the binaries run on
    current distros.
  - macOS: on the macOS runners, one build per arch (Intel, Apple Silicon).
- Trim to the executables OpenCFD actually invokes (roughly 15):
  `blockMesh`, `gmshToFoam`, `checkMesh`, `decomposePar`, `reconstructPar`,
  `potentialFoam`, `simpleFoam`, `pimpleFoam`, `rhoSimpleFoam`, `rhoPimpleFoam`,
  `rhoCentralFoam`, `postProcess`, `foamToVTK`, plus the RAS turbulence libraries and
  their runtime `etc/` config. Strip debug symbols, drop tutorials and docs.
- Result is a tarball, roughly 300 to 500 MB, either bundled in the installer or
  downloaded on first run with a progress bar and a SHA256 check into the app data dir.
- The backend runs these binaries directly as subprocesses.

### Windows: precompiled binaries in the installer, imported into WSL2

1. The Windows installer **carries the precompiled Linux OpenFOAM pack** (the same CI
   artifact used for the Linux build, or a dedicated WSL rootfs tarball built from it).
2. At install time (or first launch), OpenCFD checks for WSL2.
   - **WSL2 present:** import our pack into a private distro, for example
     `wsl --import opencfd-foam <appdata>\wsl <pack>.tar`. The backend then runs solver
     commands via `wsl -d opencfd-foam -- <cmd>`, with case files under the app data dir
     and path translation between Windows and `/mnt/...` handled in the solver adapter.
   - **WSL2 absent:** OpenCFD does not run. Show a blocking screen:
     "OpenCFD needs WSL2 to run the solver. Please enable it (`wsl --install`, then
     reboot) and restart OpenCFD. Native Windows solver support is planned."
     Link to Microsoft's WSL install docs. Re-check on next launch.
3. No dependency on Docker Desktop, blueCFD-Core, or a user-side OpenFOAM install.

blueCFD-Core (native MinGW port) stays noted as a possible future fallback for users who
cannot enable WSL2, accepting its version lag. Not in scope now.

## CI pipeline (per OpenFOAM release)

- Matrix: `linux-x64` (old-glibc container), `macos-x64`, `macos-arm64`.
- Steps: fetch pinned OpenFOAM source, build with `wmake`, trim, strip, tar, checksum,
  publish to GitHub Releases (or an object store) as `openfoam-<version>-<platform>.tar.zst`.
- The Windows installer pulls the `linux-x64` artifact (or a rootfs derived from it).
- Tauri build jobs reference the pinned pack version.

## Licensing

- OpenFOAM is GPL (v3 for ESI, v2+ for Foundation). We ship the solver **binaries** and
  call them **only as separate subprocesses**, never linked into our process, so OpenCFD's
  own license is unaffected (aggregate distribution).
- Obligations: ship the corresponding OpenFOAM source (or a written offer plus a link to
  our pinned source tree) and keep upstream copyright and license notices in the pack.

## Backend abstraction (implemented)

`backend/app/services/solver/` holds the seam between OpenCFD and whatever runs the
solve. Every adapter yields the same event dicts `/ws/solver` already streams
(`log` / `residual` / `status` / `error`).

- `base.py` - `SolverAdapter` ABC (`available()`, `run(case_dir, config)`).
- `mock.py` - `MockAdapter`, wraps the existing `simulate_cfd_run`. Offline default.
- `openfoam.py` - `OpenFoamAdapter` with `LocalOpenFoam` (Linux/macOS) and
  `WslOpenFoam` (Windows, wraps every command in `wsl.exe -d <distro> -- bash -lc`
  and translates the case path with `wslpath`). The run pipeline is:
  extrude mesh to MSH 2.2 -> `gmshToFoam` -> set boundary patch types
  (`frontAndBack` -> empty, wall patches -> wall) -> `checkMesh` ->
  optional `potentialFoam` -> the solver from `pick_solver()`, streamed, with
  residuals parsed from stdout and Cd/Cl read from `postProcessing/`.
- `mesh_bridge.py` - `write_foam_msh()` extrudes the 2D canvas mesh one cell thick
  in z so OpenFOAM (3D only) can run it as a plane case.
- `logparse.py` - `ResidualStream` (stdout -> residual points), `read_force_coeffs`.
- `paths.py` - `resolve_case_dir(project_id)` -> `~/.OpenCFD/cases/<project>`.
- `__init__.py` - `detect_environment()` (reported at `GET /api/solver/environment`
  and shown in the Solver panel) and `select_adapter(mode, config)`.

`/ws/solver` reads `mode` (`auto` | `real` | `mock`), `project_id`, `physics`,
`mesh`, and `wallPatches` from the run payload, picks an adapter, and streams it.
`auto` uses real OpenFOAM when available (local first, then WSL), else the mock.

Sourcing OpenFOAM: every command runs under `bash -lc` after sourcing the first
readable `etc/bashrc` it finds (`/opt/openfoam*`, `/usr/lib/openfoam/openfoam*`,
`~/OpenFOAM/*`). Override with the `OPENCFD_FOAM_BASHRC` env var or a `foamBashrc`
field in the run config.

## First-run provisioning (implemented, app side)

`backend/app/services/setup/` - `setup_status()`, `provision()` (async generator
of progress events), `teardown()`. Manages one private distro `OpenCFD-FOAM`
imported from a rootfs tarball; marker at `~/.OpenCFD/solver-setup.json`. On
Linux/macOS `needs_provision` is always False.

Endpoints: `GET /api/setup/status`, `POST /api/setup/teardown`, `WS /ws/setup`
(send any message to start; receive `progress` / `done` / `error` events).

Frontend: `SetupGate` wraps the app in `Root.tsx`. States: checking, needs-wsl,
needs-pack (this dev build, no pack -> "continue with mock"), needs-provision,
provisioning (progress bar), error. A "skip / use mock" escape hatch is always
available so the app never hard-locks.

## CI workflows

`.github/workflows/`:

- **`foam-pack.yml`** (manual, once per pinned OpenFOAM release) - builds
  `docker/foam-pack/Dockerfile` (Ubuntu + OpenFOAM from the Foundation apt repo,
  no source compile), `docker export`s the container to a rootfs, gzips it,
  checksums it, and publishes `opencfd-foam-<ver>.tar.gz` (+ `.sha256`) to a
  GitHub Release tagged `foam-pack-<ver>`. This is the file the app downloads in
  `provision()`.
- **`ci.yml`** (push / PR) - frontend build + lint, backend import + a
  solver/setup/mesh-bridge smoke test.
- **`release.yml`** (push a `v*` tag) - matrix over Windows / macOS x64 / macOS
  ARM / Linux: build frontend, freeze the backend with
  `backend/opencfd-backend.spec` (PyInstaller), stage it as the Tauri sidecar
  (`src-tauri/binaries/opencfd-backend-<triple>`), and `tauri build` the
  installer. Windows carries `OPENCFD_FOAM_PACK_URL` / `_SHA256` / `_VERSION`
  from repo Actions **variables** (set these to point at the `foam-pack` release
  asset).

After the repo exists: run `foam-pack.yml` first, copy the release asset URL and
checksum into the three `OPENCFD_FOAM_PACK_*` Actions variables, then push a
`v*` tag to cut installers.

**Current pack** (built 2026-08-29, `jammy` + `openfoam13`, works first try):
- `https://github.com/Quanta-Naut/opencfd/releases/download/foam-pack-13/opencfd-foam-13.tar.gz`
- 382 MB gzipped, SHA256 `49114fcaf884c4207e7fc2de515075496473f158da366fffc8da1402d575d3b7`
- The three `OPENCFD_FOAM_PACK_*` repo Actions variables are set to this.

`release.yml` writes these into `backend/app/services/setup/pack.json` (gitignored)
before the PyInstaller freeze; the spec bundles that file; `setup` reads env vars
first, then the bundled `pack.json`. 382 MB is small enough to bundle in the
installer later if we want a fully offline first run.

Backend runtime deps are `backend/requirements.txt` (lean: no VTK/PyVista/SciPy -
`app/` only imports numpy/shapely/ezdxf/gmsh at runtime). `requirements-dev.txt`
keeps the analysis extras for local work.

Still to shake out on a real run: PyInstaller hidden imports for `gmsh`, the
Tauri sidecar spawn + capability config (`src-tauri/capabilities/default.json`,
`src-tauri/src/main.rs`), the NSIS elevated custom action for `wsl --update`,
and confirming the OpenFOAM apt repo codename in the Dockerfile.

## Trying it out now, before the pack exists (WSL)

1. In your WSL distro, install OpenFOAM (Foundation): follow openfoam.org's apt
   instructions, or `sudo apt install openfoam` if your distro packages it. Confirm
   `simpleFoam -help` works inside a fresh `bash -l`.
2. Run OpenCFD's backend as a native Windows process (`python run.py`), not inside
   WSL. `GET /api/solver/environment` should now report `openfoam-wsl` as `ok` with
   your distro name, and the Solver panel shows "OpenFOAM (WSL)".
3. Build geometry -> domain -> tag boundaries -> generate a mesh -> Case Setup ->
   Solver -> Run. The case is written to
   `C:\Users\<you>\.OpenCFD\cases\<project>\`, converted and solved inside WSL, and
   real residuals / Cd / Cl stream back to the panel.
4. If a step fails, the exact `gmshToFoam` / `checkMesh` / solver output is in the
   terminal drawer. The custom `wsl --import` pack, the CI cross-compile, and the
   "WSL missing" blocking screen come next.
