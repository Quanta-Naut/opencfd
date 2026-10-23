"""Physics calculators: y+ / first-cell height and inflow turbulence."""

from fastapi import HTTPException
from pydantic import BaseModel
from app.services.yplus_service import calculate_yplus, calculate_inflow_turbulence
from fastapi import APIRouter

router = APIRouter()


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


@router.post("/api/physics/yplus")
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


@router.post("/api/physics/turbulence-inflow")
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
