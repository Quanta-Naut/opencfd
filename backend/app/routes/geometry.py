"""Geometry import, CAD operations and mesh generation."""

from typing import Dict, Any, List
from fastapi import HTTPException, UploadFile, File, Request
from pydantic import BaseModel
from app.services.gmsh_service import generate_mesh_data, generate_structured_mesh
from app.services.cad2d_service import (
    parse_dat_or_csv_airfoil,
    parse_dxf_entities,
    compute_2d_offset,
    compute_2d_fillet,
    generate_mesh_from_cad_loop,
)
from fastapi import APIRouter
from app.routes.common import _run_mesher

router = APIRouter()


class MeshRequest(BaseModel):
    geometry_type: str = "naca0012"
    params: Dict[str, Any] = {}


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


@router.post("/api/geometry/mesh")
async def mesh_endpoint(req: MeshRequest, request: Request):
    try:
        return await _run_mesher(request, generate_mesh_data, req.geometry_type, req.params)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/geometry/mesh-structured")
async def structured_mesh_endpoint(req: MeshRequest, request: Request):
    try:
        return await _run_mesher(request, generate_structured_mesh, req.params)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# 2D CAD Endpoints
@router.post("/api/cad/parse-airfoil")
async def parse_airfoil_endpoint(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        text = contents.decode('utf-8', errors='ignore')
        result = parse_dat_or_csv_airfoil(text)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/cad/parse-airfoil-url")
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


@router.post("/api/cad/parse-dxf")
async def parse_dxf_endpoint(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        result = parse_dxf_entities(contents)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/cad/offset")
async def offset_endpoint(req: OffsetRequest):
    try:
        pts = [(p[0], p[1]) for p in req.points]
        offset_pts = compute_2d_offset(pts, req.distance)
        return {"success": True, "points": [[float(p[0]), float(p[1])] for p in offset_pts]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/cad/fillet")
async def fillet_endpoint(req: FilletRequest):
    try:
        pts = [(p[0], p[1]) for p in req.points]
        filleted_pts = compute_2d_fillet(pts, req.radius)
        return {"success": True, "points": [[float(p[0]), float(p[1])] for p in filleted_pts]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/cad/mesh-from-sketch")
async def mesh_from_sketch_endpoint(req: MeshFromSketchRequest, request: Request):
    try:
        pts = [(p[0], p[1]) for p in req.sketch_points]
        return await _run_mesher(
            request,
            generate_mesh_from_cad_loop,
            cad_loop=pts,
            domain_length=req.domain_length,
            domain_height=req.domain_height,
            resolution=req.resolution,
            first_layer_mm=req.first_layer_mm,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
