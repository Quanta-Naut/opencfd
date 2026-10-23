"""Project store: list, create, open, save, rename, duplicate, delete, blobs."""

import asyncio
from typing import Dict, Any
from fastapi import HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from app.services import project_service
from fastapi import APIRouter

router = APIRouter()


class ProjectCreate(BaseModel):
    name: str = "Untitled project"


class ProjectRename(BaseModel):
    name: str


class SessionSave(BaseModel):
    session: Dict[str, Any] = {}


# ── Project store (~/.OpenCFD/projects) ───────────────────────────────────────
@router.get("/api/projects")
async def list_projects_endpoint():
    try:
        return {"success": True, "data": project_service.list_projects()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/projects")
async def create_project_endpoint(req: ProjectCreate):
    try:
        return {"success": True, "data": project_service.create_project(req.name)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/projects/{pid}")
async def get_project_endpoint(pid: str):
    try:
        return {"success": True, "data": project_service.get_project(pid)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/api/projects/{pid}/blobs/{key}")
async def save_project_blob_endpoint(pid: str, key: str, request: Request):
    # Raw body, not a pydantic model: the mesh can be tens of MB and is stored
    # verbatim, so parsing it would only cost time.
    raw = await request.body()
    try:
        await asyncio.to_thread(project_service.save_blob, pid, key, raw)
        return {"success": True}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/projects/{pid}/blobs/{key}")
async def get_project_blob_endpoint(pid: str, key: str):
    try:
        raw = await asyncio.to_thread(project_service.get_blob_bytes, pid, key)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if raw is None:
        raise HTTPException(status_code=404, detail=f"Project '{pid}' has no {key}")
    media = project_service.BLOB_MEDIA_TYPES.get(key, "application/json")
    return Response(content=raw, media_type=media)


@router.put("/api/projects/{pid}/session")
async def save_project_session_endpoint(pid: str, req: SessionSave):
    try:
        return {"success": True, "data": project_service.save_session(pid, req.session)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/api/projects/{pid}")
async def rename_project_endpoint(pid: str, req: ProjectRename):
    try:
        return {"success": True, "data": project_service.rename_project(pid, req.name)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/api/projects/{pid}")
async def delete_project_endpoint(pid: str):
    try:
        project_service.delete_project(pid)
        return {"success": True}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/projects/{pid}/duplicate")
async def duplicate_project_endpoint(pid: str):
    try:
        return {"success": True, "data": project_service.duplicate_project(pid)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
