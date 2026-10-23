"""Solver environment, case files, results, ParaView and post-processing."""

import io
import os
import asyncio
import platform
import zipfile
from pathlib import Path
from typing import Dict, Any, List
from fastapi import HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from app.services.foam import generate_openfoam_case_files
from app.services.solver import detect_environment, resolve_case_dir
from app.services.solver.results import read_field_results
from app.services.postprocess_service import generate_field_solution
from app.services import project_service
from fastapi import APIRouter
from app.routes.common import _envelope_response

router = APIRouter()


class CaseFilesRequest(BaseModel):
    case_dir: str = "/tmp/openfoam_case"
    project_id: str | None = None
    physics: Dict[str, Any] = {}
    boundaries: Dict[str, Any] = {}
    solver_controls: Dict[str, Any] = {}
    patches: List[Dict[str, Any]] = []
    ref_length: float = 1.0
    solution: Dict[str, Any] = {}


class PostProcessRequest(BaseModel):
    mesh_data: Dict[str, Any] = {}
    geometry_type: str = "naca0012"
    velocity: float = 20.0
    regime: str = "turbulent"


@router.get("/api/solver/environment")
async def solver_environment_endpoint():
    try:
        return {"success": True, "data": detect_environment()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class SolverResultsRequest(BaseModel):
    project_id: str | None = None
    mesh: Dict[str, Any] = {}
    time: Any = None


@router.post("/api/solver/results")
async def solver_results_endpoint(req: SolverResultsRequest, request: Request):
    from app.services.solver.results import ResultsUnavailable

    def read() -> Dict[str, Any]:
        # The client normally omits the mesh and the project's saved copy is
        # used, instead of uploading the whole mesh as JSON on every load.
        mesh = req.mesh
        if not mesh.get("nodes") and req.project_id:
            mesh = project_service.load_mesh(req.project_id) or {}
        case_dir = str(resolve_case_dir(req.project_id))
        data = read_field_results(case_dir, mesh, req.time)
        if data is None:
            return {"success": False, "detail": "no solver output found for this project"}
        return {"success": True, "data": data}

    try:
        envelope = await asyncio.to_thread(read)
    except ResultsUnavailable as e:
        envelope = {"success": False, "detail": str(e)}
    except Exception as e:
        envelope = {"success": False, "detail": f"could not read results: {e}"}
    return _envelope_response(request, envelope)


class ParaviewLaunchRequest(BaseModel):
    project_id: str | None = None


def _find_paraview() -> str | None:
    """Locate the ParaView executable. shutil.which() alone only finds it if
    it is on PATH, which is the default on Linux (apt/snap put it there) but
    NOT on Windows or macOS - both installers drop it in an app-specific
    folder without touching PATH, so a real install still comes back empty
    there unless we also check the standard install locations."""
    import shutil
    pv = shutil.which("paraview") or shutil.which("paraFoam")
    if pv:
        return pv

    import glob

    if os.name == "nt":
        roots = [
            os.environ.get("ProgramFiles", r"C:\Program Files"),
            os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs"),
        ]
        candidates = []
        for root in roots:
            if root:
                candidates += glob.glob(os.path.join(root, "ParaView*", "bin", "paraview.exe"))
        candidates.sort(reverse=True)  # prefer the newest version if several are installed
        if candidates:
            return candidates[0]
    elif platform.system() == "Darwin":
        candidates = []
        for root in ("/Applications", os.path.expanduser("~/Applications")):
            candidates += glob.glob(os.path.join(root, "ParaView*.app", "Contents", "MacOS", "paraview"))
        candidates.sort(reverse=True)
        if candidates:
            return candidates[0]

    return None


@router.get("/api/solver/paraview/status")
async def paraview_status_endpoint():
    pv_path = _find_paraview()
    return {"success": True, "available": bool(pv_path), "path": pv_path}


@router.post("/api/solver/paraview/launch")
async def paraview_launch_endpoint(req: ParaviewLaunchRequest):
    import subprocess
    pv_path = _find_paraview()
    if not pv_path:
        return {"success": False, "detail": "ParaView is not installed or not in PATH"}
    try:
        case_dir = str(resolve_case_dir(req.project_id))
        foam_file = os.path.join(case_dir, "case.foam")
        if not os.path.exists(foam_file):
            with open(foam_file, "w") as f:
                f.write("")
        # start_new_session (setsid) is POSIX-only - passing it on Windows
        # raises ValueError before the process even launches, which is why
        # this failed unconditionally there regardless of the PATH lookup.
        if os.name == "nt":
            detach_kwargs = {"creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP}
        else:
            detach_kwargs = {"start_new_session": True}
        subprocess.Popen([pv_path, foam_file], **detach_kwargs)
        return {"success": True, "detail": f"Launched ParaView for {foam_file}"}
    except Exception as e:
        return {"success": False, "detail": str(e)}


@router.post("/api/solver/case-files")
async def case_files_endpoint(req: CaseFilesRequest):
    try:
        case_dir = str(resolve_case_dir(req.project_id)) if req.project_id else req.case_dir
        files = generate_openfoam_case_files(
            case_dir=case_dir,
            physics=req.physics,
            boundaries=req.boundaries,
            solver_controls=req.solver_controls,
            patches=req.patches,
            ref_length=req.ref_length,
            solution=req.solution,
        )
        return {"success": True, "files": files, "case_dir": case_dir}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class CaseExportRequest(BaseModel):
    project_id: str | None = None
    name: str | None = None
    # path -> contents, straight from the viewer (used when nothing is on disk yet)
    files: Dict[str, str] = {}


@router.post("/api/solver/case-files/export")
async def case_files_export_endpoint(req: CaseExportRequest):
    """Zip the OpenFOAM case for the user to take elsewhere. Prefers the real
    case on disk (a runnable 0/ + constant/ + system/ tree, minus the written
    result times); falls back to the dictionaries the viewer already holds."""
    buf = io.BytesIO()
    written = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        case_dir: Path | None = None
        if req.project_id:
            try:
                case_dir = Path(resolve_case_dir(req.project_id))
            except Exception:
                case_dir = None

        if case_dir and case_dir.is_dir():
            keep_top = {"0", "system", "constant"}
            for path in sorted(case_dir.rglob("*")):
                if not path.is_file():
                    continue
                rel = path.relative_to(case_dir)
                top = rel.parts[0]
                # keep the setup + mesh, drop result time dirs, logs and caches
                if top not in keep_top and not top.endswith(".foam"):
                    continue
                if "processor" in str(rel) or rel.suffix in (".log", ".pyc"):
                    continue
                try:
                    zf.write(path, rel.as_posix())
                    written += 1
                except OSError:
                    pass

        if written == 0:
            for rel_path, content in (req.files or {}).items():
                zf.writestr(rel_path.lstrip("/"), content or "")
                written += 1

    if written == 0:
        raise HTTPException(status_code=404, detail="nothing to export - generate the case first")

    safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in (req.name or "openfoam-case")).strip("-")
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe or "openfoam-case"}.zip"'},
    )


@router.post("/api/postprocess/fields")
async def postprocess_endpoint(req: PostProcessRequest):
    try:
        sol = generate_field_solution(
            mesh_data=req.mesh_data,
            geometry_type=req.geometry_type,
            velocity=req.velocity,
            regime=req.regime
        )
        return {"success": True, "data": sol}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
