"""The offline default: wraps the physically-informed mock in foam_service."""
from __future__ import annotations

from typing import Any, AsyncGenerator, Dict

from app.services.foam_service import simulate_cfd_run
from .base import SolverAdapter


class MockAdapter(SolverAdapter):
    name = "mock"

    def available(self) -> Dict[str, Any]:
        return {"ok": True, "detail": "Built-in mock solver (no OpenFOAM required)."}

    async def run(
        self, case_dir: str, config: Dict[str, Any]
    ) -> AsyncGenerator[Dict[str, Any], None]:
        async for item in simulate_cfd_run(
            iterations=int(config.get("iterations", 1000)),
            regime=config.get("regime", "turbulent"),
            velocity=float(config.get("velocity", 20.0)),
            reynolds=float(config.get("reynolds", 1.0e6)),
            cells=int(config.get("cells", 20000)),
            relax=config.get("relax") or {},
            momentumOrder=config.get("momentumOrder", "secondOrder"),
            turbulenceModel=config.get("turbulenceModel", "kOmegaSST"),
            forces=bool(config.get("forces", True)),
            init=config.get("init", "uniform"),
        ):
            yield item
