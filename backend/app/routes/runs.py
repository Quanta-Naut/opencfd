"""Stored solver runs (field, line samples, stream, delete) and the live solver WebSocket."""

import math
import json
import asyncio
from typing import Any, Optional
from fastapi import WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from app.services.solver import select_adapter, resolve_case_dir
from app.services.solver.results import sample_field_along_line
from app.services import project_service, run_service, packed_json
from fastapi import APIRouter

router = APIRouter()


# -- Run persistence (~/.OpenCFD/projects/<pid>/runs/<rid>) --------------------
@router.get("/api/solver/runs/{project_id}/{run_id}/field")
async def get_solver_run_field_endpoint(project_id: str, run_id: str, request: Request):
    if packed_json.MEDIA_TYPE in request.headers.get("accept", ""):
        raw = await asyncio.to_thread(run_service.get_run_field_bytes, project_id, run_id)
        if raw is not None:
            # The stored snapshot is already packed; send its bytes as-is.
            return Response(content=raw, media_type=packed_json.MEDIA_TYPE)
    data = await asyncio.to_thread(run_service.get_run_field, project_id, run_id)
    if data is None:
        reason = run_service.get_run_field_error(project_id, run_id)
        detail = (
            f"No usable result was saved for this run: {reason}"
            if reason
            else f"Field data not found for run '{run_id}'"
        )
        return JSONResponse(
            status_code=404,
            content={"success": False, "detail": detail},
        )
    return {"success": True, "data": data}


class SampleLineRequest(BaseModel):
    p1: Optional[Any] = None
    p2: Optional[Any] = None
    samples: Optional[Any] = 100


@router.post("/api/solver/runs/{project_id}/{run_id}/sample-line")
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


@router.get("/api/solver/runs/{project_id}/{run_id}/stream")
async def get_solver_run_stream_endpoint(project_id: str, run_id: str):
    data = run_service.get_run_stream(project_id, run_id)
    if data is None:
        return JSONResponse(
            status_code=404,
            content={"success": False, "detail": f"Stream data not found for run '{run_id}'"},
        )
    return {"success": True, "data": data}


@router.delete("/api/solver/runs/{project_id}/{run_id}")
async def delete_solver_run_endpoint(project_id: str, run_id: str):
    run_service.delete_run(project_id, run_id)
    return {"success": True}


@router.websocket("/ws/solver")
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
        # The client normally sends no mesh: the run uses the project's saved
        # mesh, so a 200k-cell grid is not serialised into the socket message
        # (that froze the UI on Run). An inline mesh is still accepted.
        if not config.get("mesh") and config.get("mesh_source") == "project":
            config["mesh"] = await asyncio.to_thread(project_service.load_mesh, project_id)

        mode = config.get("mode", "auto")
        adapter = select_adapter(mode, config)
        case_dir = str(resolve_case_dir(project_id))

        recorder = run_service.RunRecorder(project_id, run_id, config)
        recorder.open()
        gen = None
        try:
            init_log = {"type": "log", "line": f"[OpenCFD] solver backend: {adapter.name}"}
            await recorder.record_event(init_log)
            await websocket.send_json(init_log)

            gen = adapter.run(case_dir, config)
            async for item in gen:
                await recorder.record_event(item)
                if item.get("type") == "field":
                    # A live preview is several MB of floats on a big mesh:
                    # send it as one packed binary frame, packed off the loop.
                    frame = await asyncio.to_thread(packed_json.pack, item)
                    await websocket.send_bytes(frame)
                else:
                    await websocket.send_json(item)

            await recorder.finish(case_dir)
        except WebSocketDisconnect:
            # Stop: end the solver first, then save what it had written.
            if gen is not None:
                await gen.aclose()
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
