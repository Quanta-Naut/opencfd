# Contributing to OpenCFD

OpenCFD is an early-stage, open source attempt at a real CFD GUI - there
is a lot to build and a lot of room to help. Contributions of any size
are welcome: a bug report, a small fix, a new meshing capability, or
feedback on the direction.

## Before you start

- Read [DEVELOPING.md](./DEVELOPING.md) to get the app running locally
  (backend, frontend, and how the OpenFOAM solver is discovered).
- For anything touching the structured (block) mesher specifically, read
  [STRUCTURED_MESH_TODO.md](./STRUCTURED_MESH_TODO.md) first - it records
  the intended design and known open problems, so you don't duplicate
  work or fight the existing architecture.
- For UI work, read [DESIGN.md](./DESIGN.md) - OpenCFD aims to read as
  engineering software, not a consumer app, and that document lays out
  the concrete rules (no shadows, borders only, one restrained accent
  color, tight corner radius).

## Reporting bugs

Open a GitHub issue with:
- What you did, what you expected, what happened instead.
- Your OS (this matters a lot here - the solver path differs between
  Linux/macOS and Windows via WSL2).
- Console/terminal output if the failure is silent in the UI.

## Making changes

1. Fork the repo and branch off `main`.
2. Keep changes focused - a PR that fixes one thing is much easier to
   review and merge than one that fixes three unrelated things.
3. Match the existing code style in the file you're touching. No new
   dependencies without a good reason.
4. Before opening a PR:
   - Frontend: `npm run build` and `npx tsc --noEmit` from `frontend/`
     should both be clean.
   - Backend: the module you touched should still import cleanly
     (`PYTHONPATH=backend backend/venv/bin/python -c "import app.main"`).
   - If you touched solver/meshing logic, test it against a real case,
     not just that it doesn't crash - a mesh that generates without
     errors but produces garbage cells is not a passing test.
5. Describe what you changed and why in the PR description - screenshots
   or a short clip are very helpful for anything visual.

## What's most useful right now

OpenCFD is 2D-only today. The areas most in need of help:
- Structured (block) meshing - see the open problems in
  [STRUCTURED_MESH_TODO.md](./STRUCTURED_MESH_TODO.md).
- Broader turbulence model and boundary condition coverage.
- Windows/WSL2 solver packaging robustness.
- Eventually, a path toward 3D - not started, and a serious undertaking
  if you want to pick that up.

## Questions

If something is unclear or you want to check an approach before
investing time in it, open an issue to discuss it first - especially for
anything larger than a small fix.
