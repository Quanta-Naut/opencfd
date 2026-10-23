"""App settings and the OpenFOAM setup / teardown flow."""

from fastapi import WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel
from app.services import setup as solver_setup
from app.services import settings_service
from fastapi import APIRouter

router = APIRouter()


class SettingsUpdate(BaseModel):
    case_storage: str | None = None
    foam_bashrc: str | None = None


@router.get("/api/settings")
async def get_settings_endpoint():
    return {"success": True, "data": settings_service.get_settings()}


@router.put("/api/settings")
async def update_settings_endpoint(req: SettingsUpdate):
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    try:
        return {"success": True, "data": settings_service.update_settings(patch)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/setup/status")
async def setup_status_endpoint():
    try:
        return {"success": True, "data": solver_setup.setup_status()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/setup/teardown")
async def setup_teardown_endpoint():
    try:
        return {"success": True, "data": solver_setup.teardown()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.websocket("/ws/setup")
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
