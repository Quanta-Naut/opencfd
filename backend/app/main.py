import io
import math
import os
import json
import asyncio
import platform
import zipfile
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from app.services.yplus_service import calculate_yplus, calculate_inflow_turbulence
from app.services.gmsh_service import generate_mesh_data, generate_structured_mesh
from app.services.foam import generate_openfoam_case_files
from app.services.solver import detect_environment, select_adapter, resolve_case_dir
from app.services.solver.results import read_field_results, sample_field_along_line
from app.services import setup as solver_setup
from app.services.postprocess_service import generate_field_solution
from app.services.cad2d_service import (
    parse_dat_or_csv_airfoil,
    parse_dxf_entities,
    compute_2d_offset,
    compute_2d_fillet,
    generate_mesh_from_cad_loop
)
from app.services import project_service, run_service, settings_service

app = FastAPI(title="OpenCFD Backend API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class YPlusRequest(BaseModel):
    velocity: float = 20.0
    length: float = 1.0
    density: float = 1.225
    viscosity: float = 1.789e-5
    target_yplus: float = 1.0
    expansion_ratio: float = 1.2
    flow_regime: str = "turbulent"

class InflowTurbulenceRequest(BaseModel):
    velocity: float = 20.0
    length_scale: float = 1.0
    intensity_percent: float = 5.0

class MeshRequest(BaseModel):
    geometry_type: str = "naca0012"
    params: Dict[str, Any] = {}

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

class ProjectCreate(BaseModel):
    name: str = "Untitled project"

class ProjectRename(BaseModel):
    name: str

class SessionSave(BaseModel):
    session: Dict[str, Any] = {}

class AirfoilUrlRequest(BaseModel):
    url: str

class OffsetRequest(BaseModel):
    points: List[List[float]]
    distance: float = 0.05

class FilletRequest(BaseModel):
    points: List[List[float]]
    radius: float = 0.02

class MeshFromSketchRequest(BaseModel):
    sketch_points: List[List[float]]
    domain_length: float = 10.0
    domain_height: float = 6.0
    resolution: str = "medium"
    first_layer_mm: float = 0.05

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "OpenCFD Backend"}

@app.post("/api/physics/yplus")
async def yplus_endpoint(req: YPlusRequest):
    try:
        res = calculate_yplus(
            velocity=req.velocity,
            length=req.length,
            density=req.density,
            viscosity=req.viscosity,
            target_yplus=req.target_yplus,
            expansion_ratio=req.expansion_ratio,
            flow_regime=req.flow_regime
        )
        return {"success": True, "data": res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/physics/turbulence-inflow")
async def inflow_turbulence_endpoint(req: InflowTurbulenceRequest):
    try:
        res = calculate_inflow_turbulence(
            velocity=req.velocity,
            length_scale=req.length_scale,
            intensity_percent=req.intensity_percent
        )
        return {"success": True, "data": res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/geometry/mesh")
async def mesh_endpoint(req: MeshRequest):
    try:
        mesh = generate_mesh_data(req.geometry_type, req.params)
        return {"success": True, "data": mesh}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/geometry/mesh-structured")
async def structured_mesh_endpoint(req: MeshRequest):
    try:
        return {"success": True, "data": generate_structured_mesh(req.params)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# 2D CAD Endpoints
@app.post("/api/cad/parse-airfoil")
async def parse_airfoil_endpoint(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        text = contents.decode('utf-8', errors='ignore')
        result = parse_dat_or_csv_airfoil(text)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/cad/parse-airfoil-url")
async def parse_airfoil_url_endpoint(req: AirfoilUrlRequest):
    try:
        url = req.url.strip()
        if not (url.startswith("http://") or url.startswith("https://")):
            raise ValueError("URL must start with http:// or https://")
        
        import urllib.request
        import ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
        req_obj = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req_obj, context=ctx, timeout=12) as response:
            contents = response.read()
            text = contents.decode('utf-8', errors='ignore')
            
        result = parse_dat_or_csv_airfoil(text)
        
        # If airfoil name was not in the file header, extract from URL filename
        if not result.get("name") or result.get("name") == "Imported Airfoil":
            clean_name = url.rstrip('/').split('/')[-1].split('?')[0]
            clean_name = clean_name.replace('.dat', '').replace('.csv', '').replace('.txt', '')
            if clean_name:
                result["name"] = clean_name.upper()
                
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch or parse airfoil link: {str(e)}")

@app.post("/api/cad/parse-dxf")
async def parse_dxf_endpoint(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        result = parse_dxf_entities(contents)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/cad/offset")
async def offset_endpoint(req: OffsetRequest):
    try:
        pts = [(p[0], p[1]) for p in req.points]
        offset_pts = compute_2d_offset(pts, req.distance)
        return {"success": True, "points": [[float(p[0]), float(p[1])] for p in offset_pts]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/cad/fillet")
async def fillet_endpoint(req: FilletRequest):
    try:
        pts = [(p[0], p[1]) for p in req.points]
        filleted_pts = compute_2d_fillet(pts, req.radius)
        return {"success": True, "points": [[float(p[0]), float(p[1])] for p in filleted_pts]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/cad/mesh-from-sketch")
async def mesh_from_sketch_endpoint(req: MeshFromSketchRequest):
    try:
        pts = [(p[0], p[1]) for p in req.sketch_points]
        mesh = generate_mesh_from_cad_loop(
            cad_loop=pts,
            domain_length=req.domain_length,
            domain_height=req.domain_height,
            resolution=req.resolution,
            first_layer_mm=req.first_layer_mm
        )
        return {"success": True, "data": mesh}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/solver/environment")
async def solver_environment_endpoint():
    try:
        return {"success": True, "data": detect_environment()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class SolverResultsRequest(BaseModel):
    project_id: str | None = None
    mesh: Dict[str, Any] = {}
    time: Any = None


@app.post("/api/solver/results")
async def solver_results_endpoint(req: SolverResultsRequest):
    from app.services.solver.results import ResultsUnavailable
    try:
        case_dir = str(resolve_case_dir(req.project_id))
        data = read_field_results(case_dir, req.mesh, req.time)
        if data is None:
            return {"success": False, "detail": "no solver output found for this project"}
        return {"success": True, "data": data}
    except ResultsUnavailable as e:
        return {"success": False, "detail": str(e)}
    except Exception as e:
        return {"success": False, "detail": f"could not read results: {e}"}


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


@app.get("/api/solver/paraview/status")
async def paraview_status_endpoint():
    pv_path = _find_paraview()
    return {"success": True, "available": bool(pv_path), "path": pv_path}


@app.post("/api/solver/paraview/launch")
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


class SettingsUpdate(BaseModel):
    case_storage: str | None = None


@app.get("/api/settings")
async def get_settings_endpoint():
    return {"success": True, "data": settings_service.get_settings()}


@app.put("/api/settings")
async def update_settings_endpoint(req: SettingsUpdate):
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    try:
        return {"success": True, "data": settings_service.update_settings(patch)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/setup/status")
async def setup_status_endpoint():
    try:
        return {"success": True, "data": solver_setup.setup_status()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/setup/teardown")
async def setup_teardown_endpoint():
    try:
        return {"success": True, "data": solver_setup.teardown()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.websocket("/ws/setup")
async def websocket_setup_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        await websocket.receive_text()  # any message starts provisioning
        async for item in solver_setup.provision():
            await websocket.send_json(item)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})


@app.post("/api/solver/case-files")
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


@app.post("/api/solver/case-files/export")
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


@app.post("/api/postprocess/fields")
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

# ── Project store (~/.OpenCFD/projects) ───────────────────────────────────────
@app.get("/api/projects")
async def list_projects_endpoint():
    try:
        return {"success": True, "data": project_service.list_projects()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/projects")
async def create_project_endpoint(req: ProjectCreate):
    try:
        return {"success": True, "data": project_service.create_project(req.name)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/projects/{pid}")
async def get_project_endpoint(pid: str):
    try:
        return {"success": True, "data": project_service.get_project(pid)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/api/projects/{pid}/session")
async def save_project_session_endpoint(pid: str, req: SessionSave):
    try:
        return {"success": True, "data": project_service.save_session(pid, req.session)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.patch("/api/projects/{pid}")
async def rename_project_endpoint(pid: str, req: ProjectRename):
    try:
        return {"success": True, "data": project_service.rename_project(pid, req.name)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/projects/{pid}")
async def delete_project_endpoint(pid: str):
    try:
        project_service.delete_project(pid)
        return {"success": True}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# -- Run persistence (~/.OpenCFD/projects/<pid>/runs/<rid>) --------------------
@app.get("/api/solver/runs/{project_id}/{run_id}/field")
async def get_solver_run_field_endpoint(project_id: str, run_id: str):
    data = run_service.get_run_field(project_id, run_id)
    if data is None:
        return JSONResponse(
            status_code=404,
            content={"success": False, "detail": f"Field data not found for run '{run_id}'"},
        )
    return {"success": True, "data": data}


class SampleLineRequest(BaseModel):
    p1: Optional[Any] = None
    p2: Optional[Any] = None
    samples: Optional[Any] = 100


@app.post("/api/solver/runs/{project_id}/{run_id}/sample-line")
async def sample_solver_run_line_endpoint(
    project_id: str,
    run_id: str,
    req: SampleLineRequest,
):
    if req.p1 is None or req.p2 is None:
        return JSONResponse(
            status_code=400,
            content={"success": False, "detail": "Missing p1 or p2 coordinate"},
        )

    if (
        not isinstance(req.p1, (list, tuple))
        or len(req.p1) != 2
        or not isinstance(req.p2, (list, tuple))
        or len(req.p2) != 2
    ):
        return JSONResponse(
            status_code=400,
            content={"success": False, "detail": "p1 and p2 must each be 2-element coordinates [x, y]"},
        )

    try:
        x1, y1 = float(req.p1[0]), float(req.p1[1])
        x2, y2 = float(req.p2[0]), float(req.p2[1])
    except (ValueError, TypeError):
        return JSONResponse(
            status_code=400,
            content={"success": False, "detail": "p1 and p2 coordinates must be numeric"},
        )

    if math.hypot(x2 - x1, y2 - y1) <= 1e-12:
        return JSONResponse(
            status_code=400,
            content={"success": False, "detail": "p1 and p2 must not be equal (zero-length line)"},
        )

    if req.samples is None:
        samples = 100
    elif not isinstance(req.samples, int) or isinstance(req.samples, bool):
        return JSONResponse(
            status_code=400,
            content={"success": False, "detail": "samples must be an integer"},
        )
    else:
        samples = req.samples

    if samples < 2 or samples > 2000:
        return JSONResponse(
            status_code=400,
            content={"success": False, "detail": f"samples must be between 2 and 2000, got {samples}"},
        )

    field_snapshot = run_service.get_run_field(project_id, run_id)
    if field_snapshot is None:
        return JSONResponse(
            status_code=404,
            content={"success": False, "detail": f"Field data not found for run '{run_id}'"},
        )

    try:
        data = sample_field_along_line(field_snapshot, (x1, y1), (x2, y2), samples)
        return {"success": True, "data": data}
    except Exception as e:
        return JSONResponse(
            status_code=400,
            content={"success": False, "detail": str(e)},
        )


@app.get("/api/solver/runs/{project_id}/{run_id}/stream")
async def get_solver_run_stream_endpoint(project_id: str, run_id: str):
    data = run_service.get_run_stream(project_id, run_id)
    if data is None:
        return JSONResponse(
            status_code=404,
            content={"success": False, "detail": f"Stream data not found for run '{run_id}'"},
        )
    return {"success": True, "data": data}


@app.delete("/api/solver/runs/{project_id}/{run_id}")
async def delete_solver_run_endpoint(project_id: str, run_id: str):
    run_service.delete_run(project_id, run_id)
    return {"success": True}


@app.websocket("/ws/solver")
async def websocket_solver_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        msg = await websocket.receive_text()
        config = json.loads(msg)
        project_id = config.get("project_id") or "scratch"
        run_id = config.get("run_id")
        if not run_id:
            import uuid
            run_id = str(uuid.uuid4())
            config["run_id"] = run_id
        config["project_id"] = project_id

        mode = config.get("mode", "auto")
        adapter = select_adapter(mode, config)
        case_dir = str(resolve_case_dir(project_id))

        recorder = run_service.RunRecorder(project_id, run_id, config)
        recorder.open()
        try:
            init_log = {"type": "log", "line": f"[OpenCFD] solver backend: {adapter.name}"}
            await recorder.record_event(init_log)
            await websocket.send_json(init_log)

            async for item in adapter.run(case_dir, config):
                await recorder.record_event(item)
                await websocket.send_json(item)

            await recorder.finish(case_dir)
        except WebSocketDisconnect:
            await recorder.finish(case_dir)
            raise
        except Exception as e:
            err_event = {"type": "error", "message": str(e)}
            await recorder.record_event(err_event)
            await recorder.finish(case_dir)
            await websocket.send_json(err_event)
        finally:
            recorder.close()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
