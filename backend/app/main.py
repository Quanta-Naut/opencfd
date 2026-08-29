import os
import json
import asyncio
from typing import Dict, Any, List, Tuple
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.services.yplus_service import calculate_yplus, calculate_inflow_turbulence
from app.services.gmsh_service import generate_mesh_data, generate_structured_mesh
from app.services.foam import generate_openfoam_case_files
from app.services.foam_service import simulate_cfd_run
from app.services.postprocess_service import generate_field_solution
from app.services.cad2d_service import (
    parse_dat_or_csv_airfoil,
    parse_dxf_entities,
    compute_2d_offset,
    compute_2d_fillet,
    generate_mesh_from_cad_loop
)
from app.services import project_service

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
    physics: Dict[str, Any] = {}
    boundaries: Dict[str, Any] = {}
    solver_controls: Dict[str, Any] = {}
    patches: List[Dict[str, Any]] = []
    ref_length: float = 1.0

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

@app.post("/api/solver/case-files")
async def case_files_endpoint(req: CaseFilesRequest):
    try:
        files = generate_openfoam_case_files(
            case_dir=req.case_dir,
            physics=req.physics,
            boundaries=req.boundaries,
            solver_controls=req.solver_controls,
            patches=req.patches,
            ref_length=req.ref_length,
        )
        return {"success": True, "files": files}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

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

@app.websocket("/ws/solver")
async def websocket_solver_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        msg = await websocket.receive_text()
        config = json.loads(msg)
        iterations = int(config.get("iterations", 100))
        regime = config.get("regime", "turbulent")
        velocity = float(config.get("velocity", 20.0))

        async for item in simulate_cfd_run(iterations=iterations, regime=regime, velocity=velocity):
            await websocket.send_json(item)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})
