"""
On-disk project store for OpenCFD Studio.

Every project is a folder under ~/.OpenCFD/projects/<slug>/ containing:
  project.json   metadata + a small summary used by the home screen
  session.json   the full StudioSession blob sent by the frontend
  (mesh/ and case/ subdirs are reserved for future Gmsh / OpenFOAM output)

The folder name is the project id and never changes; renaming only edits the
display name inside project.json.
"""

import json
import re
import shutil
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

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


def _build_summary(session: Dict[str, Any]) -> Dict[str, Any]:
    entities = session.get("cadEntities") or []
    geometry_entities = [
        e for e in entities
        if e.get("layer") != "construction" and e.get("role") != "domain_boundary"
    ]
    geometry = (session.get("state") or {}).get("geometry") or {}

    preview: Optional[Dict[str, Any]] = None
    if geometry_entities:
        pts = geometry_entities[0].get("pts") or []
        coords = [[p.get("x", 0.0), p.get("y", 0.0)] for p in pts if isinstance(p, dict)]
        if len(coords) > 64:
            step = len(coords) / 64.0
            coords = [coords[int(i * step)] for i in range(64)]
        if coords:
            xs = [c[0] for c in coords]
            ys = [c[1] for c in coords]
            preview = {"points": coords, "bbox": [min(xs), min(ys), max(xs), max(ys)]}

    return {
        "geometryName": geometry.get("name") or "",
        "entityCount": len(geometry_entities),
        "hasMesh": bool(session.get("hasMesh")),
        "resolution": geometry.get("meshResolution") or "",
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
    return {"meta": meta, "session": session}


def save_session(pid: str, session: Dict[str, Any]) -> Dict[str, Any]:
    pdir = _project_dir(pid)
    if not pdir.is_dir():
        raise FileNotFoundError(f"Project '{pid}' not found")
    session = session or {}
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
