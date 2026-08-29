"""Run a real OpenFOAM solve, either on this machine (Linux/macOS) or inside a
WSL2 distro (Windows).

The two only differ in how a command is launched and how a path is spelled, so
`LocalOpenFoam` and `WslOpenFoam` share everything through `OpenFoamAdapter`.
"""
from __future__ import annotations

import asyncio
import os
import re
import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

from app.services.foam.system import pick_solver
from .base import SolverAdapter
from .logparse import ResidualStream, read_force_coeffs
from .mesh_bridge import write_foam_msh

# Sourced before every command so `simpleFoam` etc. are on PATH. Covers the ESI
# .deb layout, the Foundation /opt layout (also the Windows WSL pack), and a
# user build under ~/OpenFOAM.
_FOAM_ENV = (
    'for _f in "$OPENCFD_FOAM_BASHRC" '
    '/opt/openfoam*/etc/bashrc /usr/lib/openfoam/openfoam*/etc/bashrc '
    '/usr/share/openfoam*/etc/bashrc "$HOME"/OpenFOAM/*/etc/bashrc; do '
    '[ -n "$_f" ] && [ -r "$_f" ] && . "$_f" && break; done'
)

_STEP_TIMEOUT = 900  # seconds for a preparation step (gmshToFoam, checkMesh, ...)

_CONDA_ROOTS = ("MAMBA_ROOT_PREFIX", "CONDA_PREFIX", "CONDA_ROOT")


def _conda_env_with_foam() -> Optional[Path]:
    """Find a conda/mamba env that has simpleFoam (openfoam from conda-forge)."""
    seen: set = set()
    roots = [os.environ.get(k) for k in _CONDA_ROOTS] + [
        str(Path.home() / d) for d in ("micromamba", "mambaforge", "miniforge3", "miniconda3", "anaconda3")
    ]
    for root in roots:
        if not root or root in seen:
            continue
        seen.add(root)
        rp = Path(root)
        # `root` may itself be an env (CONDA_PREFIX) or a base with envs/
        candidates = [rp, *sorted(rp.glob("envs/*"))]
        for env in candidates:
            if (env / "bin" / "simpleFoam").is_file():
                return env
    return None


def discover_foam_env_command() -> str:
    """Shell snippet that puts OpenFOAM on PATH, for `bash -lc`.

    Priority: explicit OPENCFD_FOAM_BASHRC, then already-on-PATH (backend launched
    inside an activated env), then a conda-forge openfoam env, then the standard
    system / WSL-pack locations.
    """
    explicit = os.environ.get("OPENCFD_FOAM_BASHRC")
    if explicit and Path(explicit).is_file():
        return f". {shlex.quote(explicit)}"
    if shutil.which("simpleFoam"):
        return ":"  # inherited PATH already has it
    env = _conda_env_with_foam()
    if env:
        act = env / "etc" / "conda" / "activate.d"
        return (
            f'export CONDA_PREFIX={shlex.quote(str(env))} ; '
            f'export PATH={shlex.quote(str(env / "bin"))}:$PATH ; '
            f'export LD_LIBRARY_PATH={shlex.quote(str(env / "lib"))}:${{LD_LIBRARY_PATH:-}} ; '
            f'for _f in {shlex.quote(str(act))}/*.sh; do [ -r "$_f" ] && . "$_f"; done'
        )
    return _FOAM_ENV


class OpenFoamAdapter(SolverAdapter):
    name = "openfoam"

    def __init__(self, foam_bashrc: str | None = None) -> None:
        self.foam_bashrc = foam_bashrc
        self._cwd: str = ""  # solver-visible case dir, set at the top of run()

    # ---- platform hooks -----------------------------------------------------
    def _prefix(self) -> List[str]:
        """argv placed before `bash` (WSL wrapper, or nothing)."""
        return []

    def _to_solver_path(self, host_path: str) -> str:
        """Spell a host path the way the solver's shell sees it."""
        return str(host_path)

    # ---- command helpers --------------------------------------------------
    def _env_snippet(self) -> str:
        if self.foam_bashrc:
            return f'. {shlex.quote(self.foam_bashrc)}'
        return _FOAM_ENV  # overridden by LocalOpenFoam for host-side discovery

    def _script(self, body: str, *, in_case: bool = True) -> List[str]:
        # env is sourced with `;` (a failed lookup must not short-circuit the run)
        chain = f'{self._env_snippet()} ; '
        if in_case and self._cwd:
            chain += f'cd {shlex.quote(self._cwd)} && '
        chain += body
        return [*self._prefix(), "bash", "-lc", chain]

    def _run_sync(self, body: str, *, in_case: bool = False, timeout: int = 20) -> subprocess.CompletedProcess:
        return subprocess.run(
            self._script(body, in_case=in_case),
            capture_output=True, text=True, timeout=timeout,
        )

    # ---- availability ---------------------------------------------------
    def available(self) -> Dict[str, Any]:
        try:
            probe = self._run_sync(
                'if command -v simpleFoam >/dev/null 2>&1; then '
                'echo "OPENFOAM_OK ${WM_PROJECT_VERSION:-${FOAM_API:-unknown}}"; '
                'else echo OPENFOAM_MISSING; fi',
                timeout=25,
            )
        except FileNotFoundError as e:
            return {"ok": False, "detail": f"shell not found: {e}"}
        except subprocess.TimeoutExpired:
            return {"ok": False, "detail": "OpenFOAM probe timed out"}
        out = (probe.stdout or "")
        if "OPENFOAM_OK" in out:
            ver = out.split("OPENFOAM_OK", 1)[1].strip().split() or ["unknown"]
            return {"ok": True, "detail": f"OpenFOAM {ver[0]} ready", "version": ver[0]}
        combined = (out + "\n" + (probe.stderr or "")).strip()
        return {
            "ok": False,
            "detail": "OpenFOAM did not respond in this environment - see diagnostics",
            "diagnostics": combined[-600:],
            "probe_rc": probe.returncode,
        }

    # ---- the run --------------------------------------------------------
    async def _stream(self, body: str, tag: str) -> AsyncGenerator[Dict[str, Any], None]:
        """Run a preparation step, forwarding its output as log lines. Raises on
        non-zero exit."""
        proc = await asyncio.create_subprocess_exec(
            *self._script(body),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        assert proc.stdout is not None
        try:
            async for raw in proc.stdout:
                line = raw.decode(errors="replace").rstrip()
                if line:
                    yield {"type": "log", "line": f"[{tag}] {line}"}
            rc = await asyncio.wait_for(proc.wait(), timeout=_STEP_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            raise RuntimeError(f"{tag} timed out")
        if rc != 0:
            raise RuntimeError(f"{tag} failed (exit {rc})")

    def _fix_boundary_types(self, case_dir: Path, wall_patches: List[str]) -> None:
        bnd = case_dir / "constant" / "polyMesh" / "boundary"
        if not bnd.is_file():
            return
        text = bnd.read_text()
        targets = {"frontAndBack": "empty"}
        for w in wall_patches:
            targets[w] = "wall"

        def patch_block(m: re.Match) -> str:
            name, inner = m.group(1), m.group(2)
            want = targets.get(name)
            if not want:
                return m.group(0)
            inner = re.sub(r"type\s+\w+;", f"type            {want};", inner, count=1)
            return f"{name}\n    {{{inner}}}"

        text = re.sub(r"(\w[\w-]*)\n\s*\{([^{}]*)\}", patch_block, text)
        bnd.write_text(text)

    async def run(
        self, case_dir: str, config: Dict[str, Any]
    ) -> AsyncGenerator[Dict[str, Any], None]:
        case = Path(case_dir)
        physics = config.get("physics") or {}
        wall_patches = config.get("wallPatches") or []
        solver_bin = pick_solver(physics)
        span = float(config.get("span", 1.0)) or 1.0

        yield {"type": "log", "line": f"[OpenCFD] Case: {case}"}
        yield {"type": "log", "line": f"[OpenCFD] Solver: {solver_bin}"}

        # 1. mesh -> MSH 2.2
        msh = case / "mesh.msh"
        mesh = config.get("mesh")
        if mesh and mesh.get("nodes"):
            try:
                summary = write_foam_msh(mesh, msh, span=span)
                yield {"type": "log",
                       "line": f"[mesh] extruded {summary['cells']} cells, patches: {', '.join(summary['patches'])}"}
            except Exception as e:  # noqa: BLE001
                yield {"type": "error", "message": f"mesh conversion failed: {e}"}
                return
        elif not msh.is_file():
            yield {"type": "error", "message": "no mesh available - generate a mesh first"}
            return

        if not (case / "system" / "controlDict").is_file():
            yield {"type": "error", "message": "case files missing - run Case Setup first"}
            return

        # solver-visible case dir (identity locally, wslpath under WSL)
        try:
            self._cwd = await asyncio.get_event_loop().run_in_executor(
                None, self._to_solver_path, str(case)
            )
        except Exception as e:  # noqa: BLE001
            yield {"type": "error", "message": f"path translation failed: {e}"}
            return

        # 2. clean any previous run so gmshToFoam / the solver start fresh
        try:
            async for ev in self._stream(
                "rm -rf constant/polyMesh processor* postProcessing "
                "$(foamListTimes -rm 2>/dev/null) 2>/dev/null; true",
                "clean",
            ):
                yield ev
        except RuntimeError:
            pass

        # 3. gmshToFoam
        try:
            async for ev in self._stream(f"gmshToFoam {shlex.quote('mesh.msh')}", "gmshToFoam"):
                yield ev
        except RuntimeError as e:
            yield {"type": "error", "message": str(e)}
            return

        # 4. patch boundary types, then checkMesh (warnings are non-fatal)
        self._fix_boundary_types(case, wall_patches)
        yield {"type": "log", "line": f"[mesh] boundary types set (empty: frontAndBack; wall: {', '.join(wall_patches) or 'none'})"}
        try:
            async for ev in self._stream("checkMesh -constant || true", "checkMesh"):
                yield ev
        except RuntimeError:
            pass

        # 5. optional potential-flow initialisation
        if config.get("init") == "potentialFlow":
            try:
                async for ev in self._stream("potentialFoam -initialiseUBCs -writep || true", "potentialFoam"):
                    yield ev
            except RuntimeError:
                pass

        # 6. the solve
        yield {"type": "log", "line": f"[{solver_bin}] starting"}
        proc = await asyncio.create_subprocess_exec(
            *self._script(solver_bin),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        assert proc.stdout is not None
        residuals = ResidualStream()
        forces = bool(config.get("forces", True))
        tail: List[str] = []
        try:
            async for raw in proc.stdout:
                line = raw.decode(errors="replace").rstrip()
                if not line:
                    continue
                tail.append(line)
                del tail[:-40]
                point = residuals.feed(line)
                if point is not None:
                    if forces:
                        fc = read_force_coeffs(case)
                        if fc:
                            point.update(fc)
                    yield {"type": "residual", "data": point}
                    if residuals.iteration % 20 == 0:
                        rp = point.get("p")
                        yield {"type": "log",
                               "line": f"[{solver_bin}] it {residuals.iteration}  p res "
                                       f"{rp:.3e}" if isinstance(rp, float) else line}
                elif line.startswith(("Time = ", "ExecutionTime", "SIMPLE", "PIMPLE", "Courant")):
                    yield {"type": "log", "line": f"[{solver_bin}] {line}"}
            rc = await proc.wait()
        except asyncio.CancelledError:
            proc.kill()
            raise

        if rc == 0 or residuals.converged:
            # cell-centre coords for mapping fields back to the viewer mesh
            try:
                async for _ in self._stream(
                    "postProcess -func writeCellCentres -latestTime", "postProcess"
                ):
                    pass
            except RuntimeError:
                pass
            yield {"type": "status", "status": "completed", "iterations": residuals.iteration}
        else:
            yield {"type": "log", "line": "\n".join(tail[-20:])}
            yield {"type": "error", "message": f"{solver_bin} exited with code {rc}"}


class LocalOpenFoam(OpenFoamAdapter):
    name = "openfoam-local"

    def _env_snippet(self) -> str:
        if self.foam_bashrc:
            return f'. {shlex.quote(self.foam_bashrc)}'
        return discover_foam_env_command()


class WslOpenFoam(OpenFoamAdapter):
    name = "openfoam-wsl"

    def __init__(self, distro: str | None = None, foam_bashrc: str | None = None) -> None:
        super().__init__(foam_bashrc=foam_bashrc)
        self.distro = distro

    def _prefix(self) -> List[str]:
        pre = [wsl_exe() or "wsl.exe"]
        if self.distro:
            pre += ["-d", self.distro]
        return pre + ["--"]

    def _to_solver_path(self, host_path: str) -> str:
        out = subprocess.run(
            self._prefix() + ["wslpath", "-a", str(host_path)],
            capture_output=True, text=True, timeout=20,
        )
        p = (out.stdout or "").strip()
        if out.returncode != 0 or not p:
            raise RuntimeError(f"wslpath failed: {(out.stderr or '').strip()}")
        return p


# ---- WSL discovery (Windows) ---------------------------------------------
from app.services.wsl import list_distros, wsl_exe, wsl_present  # noqa: E402


def wsl_distros() -> List[str]:
    return list_distros()[0]
