"""Response helpers shared by the route modules: binary mesh and packed JSON negotiation."""

import json
import asyncio
from typing import Dict, Any
from fastapi import Request
from fastapi.responses import Response
from app.services import mesh_codec, packed_json

def _json_default(o: Any) -> Any:
    # NumPy scalars / arrays that slip into a mesh payload.
    if hasattr(o, "tolist"):
        return o.tolist()
    raise TypeError(f"{type(o).__name__} is not JSON serialisable")


def _wants_binary_mesh(request: Request) -> bool:
    return mesh_codec.MEDIA_TYPE in request.headers.get("accept", "")


def _envelope_response(request: Request, envelope: Dict[str, Any], status_code: int = 200) -> Response:
    """A `{success, data|detail}` reply, packed (services/packed_json.py) when
    the client accepts it. Field payloads are mostly big float arrays."""
    if packed_json.MEDIA_TYPE in request.headers.get("accept", ""):
        return Response(content=packed_json.pack(envelope), media_type=packed_json.MEDIA_TYPE,
                        status_code=status_code)
    body = json.dumps(envelope, separators=(",", ":"), default=_json_default)
    return Response(content=body, media_type="application/json", status_code=status_code)


def _mesh_response(mesh: Any, binary: bool = False) -> Response:
    """Serialise a mesh payload: the binary container when the client asks
    for it (Accept: application/x-opencfd-mesh), otherwise JSON written
    directly with json.dumps. FastAPI's default path walks every node and
    element through jsonable_encoder first, which takes seconds on a
    few-hundred-thousand-cell mesh."""
    if binary:
        return Response(content=mesh_codec.encode_mesh(mesh), media_type=mesh_codec.MEDIA_TYPE)
    body = json.dumps({"success": True, "data": mesh}, separators=(",", ":"), default=_json_default)
    return Response(content=body, media_type="application/json")


async def _run_mesher(request: Request, fn, *args, **kwargs) -> Response:
    # Off the event loop, so autosave, progress and the solver socket keep
    # working while Gmsh runs (it used to freeze the whole backend).
    binary = _wants_binary_mesh(request)
    return await asyncio.to_thread(lambda: _mesh_response(fn(*args, **kwargs), binary))
