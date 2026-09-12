# Developing OpenCFD

How to run it locally, cut a release, and where the OpenFOAM pieces live.

---

## 1. Run it locally (dev)

Two processes: the FastAPI backend (`:8000`) and the Vite frontend (`:5173`).

```bash
# one-time
cd backend && python -m venv venv && venv/bin/pip install -r requirements.txt && cd ..
cd frontend && npm install && cd ..

# every time - two terminals from the repo root
cd backend && PYTHONPATH=. ./venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
cd frontend && npm run dev -- --port 5173 --host
```

Open `http://localhost:5173` (or `http://<this-machine-ip>:5173` from another box on the LAN).

`python run.py` starts both, but it watches the whole tree for reload (pins a CPU
core); the two-terminal form with `--reload-dir app` is lighter.

### Real solver in dev

The backend auto-detects OpenFOAM. Order (`solver/openfoam.py` `discover_foam_env_command`):

1. `OPENCFD_FOAM_BASHRC` env var - path to a script that puts `simpleFoam`/`foamRun` on PATH
2. `simpleFoam` already on PATH (backend launched inside an activated env)
3. a system install: `/opt/openfoam*/etc/bashrc`, `/usr/lib/openfoam/openfoam*/etc/bashrc`, `~/OpenFOAM/*/etc/bashrc`
4. a conda / micromamba env that has `openfoam` (conda-forge ships the **ESI** fork)

Install **Foundation OpenFOAM 13** (matches the Windows pack) from openfoam.org:

```bash
sudo sh -c "wget -O - https://dl.openfoam.org/gpg.key | gpg --dearmor > /etc/apt/trusted.gpg.d/openfoam.gpg"
sudo add-apt-repository http://dl.openfoam.org/ubuntu
sudo apt-get update && sudo apt-get -y install openfoam13
```

It lands in `/opt/openfoam13` and is picked up automatically. Check with
`GET http://localhost:8000/api/solver/environment` - `active` should be
`openfoam-local` and the detail `OpenFOAM 13 ready`. The Solver tab shows the
same, with a "Why is this the mock?" expander when it can't find it.

---

## 2. Cut a release (installers + draft release)

Installers are built by GitHub Actions, not locally (cross-compiling Tauri for
Windows/macOS from Linux is not practical).

```bash
# bump the version in all three
#   package.json  ,  src-tauri/tauri.conf.json  ,  src-tauri/Cargo.toml
npm install --package-lock-only --ignore-scripts   # sync the root lockfile version

git add -A && git commit -m "Version 0.1.4"
git tag -a v0.1.4 -m "OpenCFD v0.1.4"
git push origin main
git push origin v0.1.4                              # <-- the tag push triggers the build
```

`.github/workflows/release.yml` then, for **Windows / Linux / macOS (Apple
Silicon)**:

1. builds the frontend
2. freezes the FastAPI backend with PyInstaller (`backend/opencfd-backend.spec`)
   into a single `opencfd-backend[.exe]`
3. stages it as a Tauri sidecar (`src-tauri/binaries/opencfd-backend-<triple>`)
4. bakes the OpenFOAM pack coordinates into `backend/app/services/setup/pack.json`
   from the repo Actions **variables** (section 3)
5. `tauri build` -> `.msi` / `.exe` (NSIS, per-user), `.dmg`, `.deb` / `.AppImage`
6. attaches them to a **draft GitHub Release** for the tag

A `workflow_dispatch` run (Actions tab -> "Release installers" -> Run workflow)
builds the same installers but uploads them as run artifacts instead of making a
release - use it to test a build without tagging.

Watch it: `gh run watch $(gh run list --workflow release.yml -L1 --json databaseId -q '.[0].databaseId') --repo Quanta-Naut/opencfd`

When it finishes: Releases page -> open the draft -> review -> **Publish release**.

### CI on every push

`.github/workflows/ci.yml` - frontend build + lint, backend import + a
solver/setup/mesh smoke test. Keep it green.

---

## 3. The OpenFOAM WSL pack (`opencfd-foam-13.tar.gz`)

The Windows app has no bundled solver. On first launch `SetupGate` downloads a
pack and imports it as a private WSL2 distro `OpenCFD-FOAM`.

### What the pack is

Built by `.github/workflows/foam-pack.yml` from `docker/foam-pack/Dockerfile`:
Ubuntu 22.04 + `openfoam13` from the Foundation apt repo, `docker export`ed to a
root filesystem, gzipped. **No source compile** - the apt binaries are what
OpenFOAM.org publishes. ~380 MB.

### Where it is / how it is wired

| Piece | Location |
|---|---|
| Build workflow | `.github/workflows/foam-pack.yml` (manual trigger; inputs: openfoam_version, ubuntu_version, ubuntu_codename) |
| Dockerfile | `docker/foam-pack/Dockerfile` |
| Published artifact | GitHub Release `foam-pack-13` -> `opencfd-foam-13.tar.gz` + `.sha256` |
| Coordinates -> the app | repo **Actions variables** `OPENCFD_FOAM_PACK_URL`, `OPENCFD_FOAM_PACK_SHA256`, `OPENCFD_FOAM_PACK_VERSION` (Settings -> Secrets and variables -> Actions -> Variables) |
| Baked into the build | `release.yml` writes them to `backend/app/services/setup/pack.json` (gitignored) before the PyInstaller freeze; the spec bundles that file |
| Read at runtime | `backend/app/services/setup/__init__.py` `_pack_config()` - env vars first, then the bundled `pack.json` |
| Provisioning | `setup/__init__.py` `provision()` - download -> checksum -> `wsl --import OpenCFD-FOAM <appdata>\wsl <pack>.tar --version 2` -> verify `simpleFoam` -> marker at `~/.OpenCFD/solver-setup.json` |
| Uninstall | (planned) `wsl --unregister OpenCFD-FOAM` + clear `%LOCALAPPDATA%\OpenCFD` |

### Rebuilding the pack for a new OpenFOAM version

1. Actions -> "OpenFOAM WSL pack" -> Run workflow, set `openfoam_version` (e.g. `14`)
   and the matching `ubuntu_codename`.
2. It publishes `opencfd-foam-14.tar.gz` to the `foam-pack-14` release.
3. Update the three `OPENCFD_FOAM_PACK_*` Actions variables to the new asset URL,
   its SHA256, and version.
4. Cut an app release (section 2) - the new pack coordinates get baked in.

Existing installs re-provision automatically when `pack_version` changes
(`setup_status()` -> `out_of_date` -> `needs_provision`).

---

## 4. Where the solver logic lives

| Concern | Module |
|---|---|
| Mesh generation (Gmsh) | `backend/app/services/gmsh_service.py` |
| 2D mesh -> 3D MSH for OpenFOAM | `backend/app/services/solver/mesh_bridge.py` |
| Case files (`0/`, `constant/`, `system/`) | `backend/app/services/foam/` - dual-fork: Foundation 13 (`foamRun`) + ESI (`simpleFoam`) |
| Solver adapters | `backend/app/services/solver/` - `mock`, `openfoam-local` (Linux/mac), `openfoam-wsl` (Windows) |
| Run pipeline | `solver/openfoam.py` `OpenFoamAdapter.run()` - extrude -> `gmshToFoam` -> fix patch types -> `checkMesh` -> `foamRun`/`simpleFoam` -> `postProcess` |
| Log -> residuals | `solver/logparse.py` |
| Field results -> viewer | `solver/results.py` (`Cx/Cy` on ESI, `Ccx/Ccy` on Foundation) |
| First-run WSL provisioning | `backend/app/services/setup/` |
| Fork detection | `openfoam.py` `run()` checks `command -v foamRun` -> Foundation vs ESI |

Fork notes: Foundation 13 has no `simpleFoam` binary (it is a shim to
`foamRun -solver incompressibleFluid`), uses `momentumTransport` +
`physicalProperties` + a `PIMPLE` block for both steady and transient, and rejects
the `solverInfo` functionObject. The generated case carries both fork's file
names / blocks so it runs on either.
