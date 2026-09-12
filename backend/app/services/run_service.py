"""Run persistence service for OpenCFD.

Persists solver run streams to disk incrementally in real time and maintains
the latest field snapshot per run.

Layout:
  ~/.OpenCFD/projects/<project_id>/runs/<run_id>/
    stream.jsonl   real-time append-only stream of solver events
    field.json     latest field snapshot with mesh topology
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.services.project_service import PROJECTS_ROOT


def _safe_id(val: str | None, default: str = "scratch") -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", (val or "").strip()).strip("-")
    return cleaned or default


def resolve_run_dir(
    project_id: str | None, run_id: str | None, *, create: bool = False
) -> Path:
    safe_pid = _safe_id(project_id, "scratch")
    safe_rid = _safe_id(run_id, "scratch")
    root = PROJECTS_ROOT.resolve()
    pdir = (PROJECTS_ROOT / safe_pid).resolve()
    if root not in pdir.parents and pdir != root:
        raise ValueError("Invalid project id")
    rdir = (pdir / "runs" / safe_rid).resolve()
    if pdir not in rdir.parents:
        raise ValueError("Invalid run id")
    if create:
        rdir.mkdir(parents=True, exist_ok=True)
    return rdir


def _json_default(obj: Any) -> Any:
    if hasattr(obj, "tolist"):
        return obj.tolist()
    if hasattr(obj, "item"):
        return obj.item()
    if isinstance(obj, (Path, Exception)):
        return str(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


class RunRecorder:
    """Tees a solver run's event stream to on-disk files in real time."""

    def __init__(
        self,
        project_id: str | None,
        run_id: str | None,
        config: Dict[str, Any] | None = None,
    ) -> None:
        self.project_id = _safe_id(project_id, "scratch")
        self.run_id = _safe_id(run_id, "scratch")
        self.config = config or {}
        self.run_dir = resolve_run_dir(self.project_id, self.run_id, create=True)
        self.stream_path = self.run_dir / "stream.jsonl"
        self.field_path = self.run_dir / "field.json"
        self._stream_file: Optional[Any] = None

        mesh = self.config.get("mesh") or {}
        self.mesh_snapshot: Dict[str, Any] = {
            "nodes": mesh.get("nodes") or [],
            "elements": mesh.get("elements") or [],
        }
        self.has_field = False

    def open(self) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self._stream_file = open(self.stream_path, "a", encoding="utf-8")

    def close(self) -> None:
        if self._stream_file:
            try:
                self._stream_file.flush()
                self._stream_file.close()
            except Exception:
                pass
            self._stream_file = None

    def _write_field_sync(self, payload: Dict[str, Any]) -> None:
        tmp_path = self.run_dir / f"field.json.tmp.{os.getpid()}"
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, default=_json_default)
            os.replace(tmp_path, self.field_path)
        except Exception:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

    async def _write_field_json(self, payload: Dict[str, Any]) -> None:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._write_field_sync, payload)

    async def record_event(self, item: Dict[str, Any]) -> None:
        """Append one event to stream.jsonl and update field.json if type is field."""
        try:
            if self._stream_file:
                line = json.dumps(item, default=_json_default) + "\n"
                self._stream_file.write(line)
                self._stream_file.flush()
        except Exception:
            pass

        if isinstance(item, dict) and item.get("type") == "field":
            data = item.get("data")
            if isinstance(data, dict):
                self.has_field = True
                payload = {
                    **data,
                    "mesh": self.mesh_snapshot,
                }
                await self._write_field_json(payload)

    async def finish(self, case_dir: str | None = None) -> None:
        """Finalize the run. Writes the final field snapshot if available.

        Uses read_field_results (the same per-node reader that backs the
        Results tab), not read_field_preview - the latter returns raw
        per-cell values for the cheap live ticker during a solve, whose
        array length is the element count, not the node count. Persisting
        that under the run-history contract (which promises per-node
        fields matching the stored mesh) would make every historical run
        fail the frontend's own node-count mismatch guard.
        """
        mesh = self.config.get("mesh")
        if case_dir and mesh and mesh.get("nodes"):
            try:
                from app.services.solver.results import read_field_results

                loop = asyncio.get_event_loop()
                fp = await loop.run_in_executor(
                    None, read_field_results, str(case_dir), mesh, None
                )
                if fp and isinstance(fp, dict) and fp.get("fields"):
                    payload = {
                        **fp,
                        "mesh": self.mesh_snapshot,
                    }
                    await self._write_field_json(payload)
                    self.has_field = True
            except Exception:
                pass
        self.close()


def get_run_field(project_id: str, run_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve the latest field snapshot for a run."""
    try:
        rdir = resolve_run_dir(project_id, run_id, create=False)
    except ValueError:
        return None
    field_file = rdir / "field.json"
    if not field_file.is_file():
        return None
    try:
        return json.loads(field_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def get_run_stream(project_id: str, run_id: str) -> Optional[List[Dict[str, Any]]]:
    """Retrieve the parsed event stream for a run."""
    try:
        rdir = resolve_run_dir(project_id, run_id, create=False)
    except ValueError:
        return None
    stream_file = rdir / "stream.jsonl"
    if not stream_file.is_file():
        return None
    events: List[Dict[str, Any]] = []
    try:
        with open(stream_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except (ValueError, TypeError):
                    continue
        return events
    except OSError:
        return None


def delete_run(project_id: str, run_id: str) -> bool:
    """Delete a run's on-disk directory. Safe no-op if absent."""
    try:
        rdir = resolve_run_dir(project_id, run_id, create=False)
    except ValueError:
        return True
    if rdir.is_dir():
        shutil.rmtree(rdir, ignore_errors=True)
    return True
