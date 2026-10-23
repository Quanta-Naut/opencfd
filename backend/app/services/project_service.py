"""
On-disk project store for OpenCFD Studio.

Every project is a folder under ~/.OpenCFD/projects/<slug>/ containing:
  project.json   metadata + a small summary used by the home screen
  session.json   the StudioSession sent by the frontend, minus the heavy blobs
  mesh.bin       the generated mesh (session key `meshData`), in the binary
                 format of services/mesh_codec.py
  field.pak      the loaded result field (session key `fieldData`), in the
                 packed format of services/packed_json.py
  (mesh/ and case/ subdirs are reserved for future Gmsh / OpenFOAM output)

The folder name is the project id and never changes; renaming only edits the
display name inside project.json.

The mesh and field are kept out of session.json because they can be tens of
megabytes: the session is autosaved after nearly every edit, and re-sending
and re-writing the mesh each time froze the UI. The frontend writes them
through `save_blob` only when they change, both in binary formats.
`get_project` lists them in `binaryBlobs` and the client fetches each with
`get_blob_bytes`, which skips tens of MB of JSON on every project open. Older
projects (inline blobs, or mesh.json / field.json) are migrated on first open.
"""

import json
import re
import shutil
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import mesh_codec, packed_json

SCHEMA_VERSION = 1
PROJECTS_ROOT = Path.home() / ".OpenCFD" / "projects"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_root() -> None:
    PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)


def _slugify(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text or "project"


def _unique_slug(name: str) -> str:
    base = _slugify(name)
    candidate = base
    i = 2
    while (PROJECTS_ROOT / candidate).exists():
        candidate = f"{base}-{i}"
        i += 1
    return candidate


def _project_dir(pid: str) -> Path:
    # Resolve and confine to PROJECTS_ROOT to block path traversal.
    root = PROJECTS_ROOT.resolve()
    path = (PROJECTS_ROOT / pid).resolve()
    if path.parent != root:
        raise ValueError("Invalid project id")
    return path


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2))


# Session keys stored in their own file, written only when they change.
BLOB_FILES = {"meshData": "mesh.bin", "fieldData": "field.pak"}
# Every blob is binary now; the set stays so a future JSON blob is easy to add.
BINARY_BLOBS = {"meshData", "fieldData"}
LEGACY_JSON_FILES = {"meshData": "mesh.json", "fieldData": "field.json"}
BLOB_MEDIA_TYPES = {"meshData": mesh_codec.MEDIA_TYPE, "fieldData": packed_json.MEDIA_TYPE}


def _is_binary_blob(key: str, raw: bytes) -> bool:
    return mesh_codec.is_binary_mesh(raw) if key == "meshData" else packed_json.is_packed(raw)


def _encode_blob(key: str, value: Any) -> bytes:
    return mesh_codec.encode_mesh(value) if key == "meshData" else packed_json.pack(value)


def _write_blob_bytes(pdir: Path, key: str, raw: bytes) -> None:
    """Write a blob atomically (temp file + rename) so a crash mid-write never
    leaves a truncated file behind. `null` removes it. A JSON body (older
    client, or an inline session blob) is converted to the binary format."""
    path = pdir / BLOB_FILES[key]
    (pdir / LEGACY_JSON_FILES[key]).unlink(missing_ok=True)
    if raw.strip() in (b"", b"null"):
        path.unlink(missing_ok=True)
        return
    if not _is_binary_blob(key, raw):
        raw = _encode_blob(key, json.loads(raw))
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(raw)
    tmp.replace(path)


def _migrate_legacy_blob(pdir: Path, key: str) -> None:
    legacy = pdir / LEGACY_JSON_FILES[key]
    if legacy.is_file() and not (pdir / BLOB_FILES[key]).is_file():
        _write_blob_bytes(pdir, key, legacy.read_bytes())


def _split_blobs(pdir: Path, session: Dict[str, Any]) -> bool:
    """Move any inline blobs out of `session` into their files. True if any
    were present (an older client, a duplicate, or a pre-split project)."""
    found = False
    for key in BLOB_FILES:
        if key in session:
            found = True
            value = session.pop(key)
            raw = b"null" if value is None else json.dumps(value, separators=(",", ":")).encode()
            _write_blob_bytes(pdir, key, raw)
    return found


def _entity_points(entity: Dict[str, Any]) -> List[List[float]]:
    return [
        [float(p.get("x", 0.0)), float(p.get("y", 0.0))]
        for p in (entity.get("pts") or [])
        if isinstance(p, dict)
    ]


def _preview_shape(entity: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One CAD entity -> a primitive the home-screen thumbnail can draw faithfully
    (a circle stays a circle, an airfoil keeps its curve) instead of a single
    polygon through every point of every entity."""
    kind = entity.get("type")
    pts = _entity_points(entity)
    radius = entity.get("radius")

    if kind == "circle" and radius and pts:
        return {"kind": "circle", "c": pts[0], "r": abs(float(radius))}
    if kind == "arc" and radius and pts:
        return {
            "kind": "arc", "c": pts[0], "r": abs(float(radius)),
            "a0": float(entity.get("startAngle") or 0.0),
            "a1": float(entity.get("endAngle") or 6.28318530718),
        }
    if len(pts) < 2:
        return None
    if len(pts) > 96:
        step = len(pts) / 96.0
        pts = [pts[int(i * step)] for i in range(96)]
    return {
        "kind": "path",
        "pts": pts,
        "closed": bool(entity.get("isClosed") or kind == "rectangle"),
    }


def _bbox_of(points: List[List[float]]) -> Optional[List[float]]:
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return [min(xs), min(ys), max(xs), max(ys)]


def _build_summary(session: Dict[str, Any]) -> Dict[str, Any]:
    entities = [e for e in (session.get("cadEntities") or []) if e.get("layer") != "construction"]
    geometry_entities = [e for e in entities if e.get("role") != "domain_boundary"]
    domain_entities = [
        e for e in entities
        if e.get("role") == "domain_boundary" or e.get("autoDomain")
    ]
    geometry = (session.get("state") or {}).get("geometry") or {}

    shapes = [s for s in (_preview_shape(e) for e in geometry_entities) if s]
    geom_pts: List[List[float]] = []
    for s in shapes:
        if s["kind"] == "path":
            geom_pts.extend(s["pts"])
        else:  # circle / arc - contribute the enclosing box
            cx, cy = s["c"]
            r = s["r"]
            geom_pts.extend([[cx - r, cy - r], [cx + r, cy + r]])

    domain_box = _bbox_of([p for e in domain_entities for p in _entity_points(e)])
    geom_box = _bbox_of(geom_pts)

    preview: Optional[Dict[str, Any]] = None
    if shapes or domain_box:
        preview = {
            "entities": shapes,
            "domain": domain_box,
            "domainShape": session.get("domainShape") or "rectangle",
            "bbox": geom_box or domain_box or [0.0, 0.0, 1.0, 1.0],
            "flow": session.get("flowType") or "external",
            "aoa": float(session.get("angleOfAttackDeg") or 0.0),
        }

    return {
        "geometryName": geometry.get("name") or "",
        "entityCount": len(geometry_entities),
        "hasMesh": bool(session.get("hasMesh")),
        "resolution": geometry.get("meshResolution") or "",
        "flow": session.get("flowType") or "external",
        "preview": preview,
    }


def _meta_path(pdir: Path) -> Path:
    return pdir / "project.json"


def _session_path(pdir: Path) -> Path:
    return pdir / "session.json"


def list_projects() -> List[Dict[str, Any]]:
    _ensure_root()
    projects: List[Dict[str, Any]] = []
    for pdir in PROJECTS_ROOT.iterdir():
        if not pdir.is_dir():
            continue
        meta = _read_json(_meta_path(pdir), None)
        if not meta:
            continue
        meta["id"] = pdir.name
        # Refresh derived card data from the session. Older projects may have
        # been saved before previews included all CAD entities, so relying only
        # on project.json leaves a blank/stale thumbnail on the Home screen.
        session = _read_json(_session_path(pdir), {})
        if isinstance(session, dict) and session:
            meta["summary"] = _build_summary(session)
        projects.append(meta)
    projects.sort(key=lambda m: m.get("modified", ""), reverse=True)
    return projects


def create_project(name: str) -> Dict[str, Any]:
    name = (name or "").strip() or "Untitled project"
    _ensure_root()
    pid = _unique_slug(name)
    pdir = _project_dir(pid)
    pdir.mkdir(parents=True)
    ts = _now()
    meta = {
        "id": pid,
        "name": name,
        "created": ts,
        "modified": ts,
        "schemaVersion": SCHEMA_VERSION,
        "summary": _build_summary({}),
    }
    _write_json(_meta_path(pdir), meta)
    _write_json(_session_path(pdir), {})
    return meta


def get_project(pid: str) -> Dict[str, Any]:
    pdir = _project_dir(pid)
    if not pdir.is_dir():
        raise FileNotFoundError(f"Project '{pid}' not found")
    meta = _read_json(_meta_path(pdir), None)
    if not meta:
        raise FileNotFoundError(f"Project '{pid}' is missing metadata")
    meta["id"] = pid
    session = _read_json(_session_path(pdir), {})
    if _split_blobs(pdir, session):
        _write_json(_session_path(pdir), session)  # one-time migration
    binary: List[str] = []
    for key, fname in BLOB_FILES.items():
        _migrate_legacy_blob(pdir, key)
        if (pdir / fname).is_file():
            binary.append(key)
    return {"meta": meta, "session": session, "binaryBlobs": binary}


def get_blob_bytes(pid: str, key: str) -> Optional[bytes]:
    """Raw bytes of one stored blob (binary for BINARY_BLOBS), or None."""
    if key not in BLOB_FILES:
        raise ValueError(f"Unknown blob '{key}'")
    pdir = _project_dir(pid)
    if not pdir.is_dir():
        raise FileNotFoundError(f"Project '{pid}' not found")
    _migrate_legacy_blob(pdir, key)
    path = pdir / BLOB_FILES[key]
    return path.read_bytes() if path.is_file() else None


def load_mesh(pid: str) -> Optional[Dict[str, Any]]:
    """The project's stored mesh as a plain dict, or None."""
    raw = get_blob_bytes(pid, "meshData")
    return mesh_codec.decode_mesh(raw) if raw else None


def save_session(pid: str, session: Dict[str, Any]) -> Dict[str, Any]:
    pdir = _project_dir(pid)
    if not pdir.is_dir():
        raise FileNotFoundError(f"Project '{pid}' not found")
    session = dict(session or {})
    _split_blobs(pdir, session)
    _write_json(_session_path(pdir), session)

    meta = _read_json(_meta_path(pdir), None) or {
        "id": pid,
        "name": pid,
        "created": _now(),
        "schemaVersion": SCHEMA_VERSION,
    }
    meta["id"] = pid
    meta["modified"] = _now()
    meta["summary"] = _build_summary(session)
    _write_json(_meta_path(pdir), meta)
    return meta


def save_blob(pid: str, key: str, raw: bytes) -> None:
    """Store one heavy session value (see BLOB_FILES) from its raw body: JSON,
    or for the mesh the binary format of mesh_codec. Binary and JSON field
    bodies are written as-is, not parsed and re-serialised."""
    if key not in BLOB_FILES:
        raise ValueError(f"Unknown blob '{key}'")
    pdir = _project_dir(pid)
    if not pdir.is_dir():
        raise FileNotFoundError(f"Project '{pid}' not found")
    if _is_binary_blob(key, raw):
        # reject a truncated or corrupt body
        if key == "meshData":
            mesh_codec.decode_header(raw)
        else:
            packed_json.validate(raw)
    else:
        head = raw.lstrip()[:1]
        if head not in (b"{", b"[", b"n", b""):
            raise ValueError("Blob body must be a JSON object, array or null")
    _write_blob_bytes(pdir, key, raw)


def rename_project(pid: str, name: str) -> Dict[str, Any]:
    name = (name or "").strip()
    if not name:
        raise ValueError("Project name cannot be empty")
    pdir = _project_dir(pid)
    if not pdir.is_dir():
        raise FileNotFoundError(f"Project '{pid}' not found")
    meta = _read_json(_meta_path(pdir), None)
    if not meta:
        raise FileNotFoundError(f"Project '{pid}' is missing metadata")
    meta["id"] = pid
    meta["name"] = name
    meta["modified"] = _now()
    _write_json(_meta_path(pdir), meta)
    return meta


def delete_project(pid: str) -> None:
    pdir = _project_dir(pid)
    if not pdir.is_dir():
        raise FileNotFoundError(f"Project '{pid}' not found")
    shutil.rmtree(pdir)


def duplicate_project(pid: str) -> Dict[str, Any]:
    """Copy a project's setup (geometry/mesh/case) into a new project.

    Deliberately does not copy `runs/` - a duplicate is for trying a variant
    of the setup, not for cloning old solver run history onto a project that
    never actually produced it.
    """
    pdir = _project_dir(pid)
    if not pdir.is_dir():
        raise FileNotFoundError(f"Project '{pid}' not found")
    meta = _read_json(_meta_path(pdir), None)
    if not meta:
        raise FileNotFoundError(f"Project '{pid}' is missing metadata")
    session = get_project(pid)["session"]
    new_meta = create_project(f"{meta.get('name', pid)} copy")
    saved = save_session(new_meta["id"], session)
    for key in BLOB_FILES:
        raw = get_blob_bytes(pid, key)
        if raw:
            _write_blob_bytes(_project_dir(new_meta["id"]), key, raw)
    return saved
