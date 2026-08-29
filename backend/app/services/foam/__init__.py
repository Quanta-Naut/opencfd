"""OpenFOAM case-file generation, driven by the Case Setup boundary spec."""
import math
import os
from typing import Any, Dict, List

from .boundary import normalise_patches
from .fields import write_fields
from .constants import write_constants
from .system import write_system, pick_solver
from .functions import build_functions

_TURB_FIELDS = {
    "kOmegaSST": ["k", "omega", "nut"], "kOmega": ["k", "omega", "nut"],
    "kOmegaSSTLM": ["k", "omega", "nut"], "kOmegaSSTComp": ["k", "omega", "nut"],
    "kEpsilon": ["k", "epsilon", "nut"], "realizableKE": ["k", "epsilon", "nut"],
    "RNGkEpsilon": ["k", "epsilon", "nut"],
    "SpalartAllmaras": ["nuTilda", "nut"], "SpalartAllmarasComp": ["nuTilda", "nut"],
}


def _inlet_turbulence(phys: Dict[str, Any], bnd: Dict[str, Any], ref_len: float) -> Dict[str, float]:
    U = float(phys.get("inletVelocity", 20.0))
    I = float(bnd.get("turbulenceIntensityPercent", 5.0)) / 100.0
    L = float(bnd.get("turbulentLengthScaleM") or 0.07 * ref_len) or 1e-3
    Cmu = 0.09
    k = max(1.5 * (U * I) ** 2, 1e-8)
    epsilon = (Cmu ** 0.75) * (k ** 1.5) / L
    omega = (k ** 0.5) / ((Cmu ** 0.25) * L)
    nut = k / max(omega, 1e-9)
    return {"k": k, "epsilon": epsilon, "omega": omega, "nut": nut}


def generate_openfoam_case_files(
    case_dir: str,
    physics: Dict[str, Any],
    boundaries: Dict[str, Any],
    solver_controls: Dict[str, Any],
    patches: List[Dict[str, Any]] | None = None,
    ref_length: float = 1.0,
    solution: Dict[str, Any] | None = None,
) -> Dict[str, str]:
    for sub in ("0", "constant", "system"):
        os.makedirs(os.path.join(case_dir, sub), exist_ok=True)

    regime = physics.get("regime", "turbulent")
    compressible = physics.get("compressibility") == "compressible"
    model_id = str(physics.get("turbulenceModelId", "kOmegaSST"))
    turb_fields = _TURB_FIELDS.get(model_id, ["k", "omega", "nut"]) if regime == "turbulent" else []

    ref_len = ref_length if ref_length and ref_length > 0 else 1.0
    turb = _inlet_turbulence(physics, boundaries, ref_len)

    patch_specs = normalise_patches(patches, float(physics.get("inletVelocity", 20.0)))
    if not patch_specs:
        # legacy fallback: a generic external-flow set
        U = float(physics.get("inletVelocity", 20.0))
        patch_specs = normalise_patches([
            {"name": "inlet", "role": "inlet", "bc": {"kind": "velocityInlet", "velocity": U}},
            {"name": "outlet", "role": "outlet", "bc": {"kind": "pressureOutlet", "staticPressure": 0}},
            {"name": "wall", "role": "wall", "bc": {"kind": "noSlipWall"}},
        ], U)

    wall_patches = [p["name"] for p in patch_specs if p["role"] == "wall"]
    functions_block = build_functions(solution or {}, physics, wall_patches, ref_len)

    files: Dict[str, str] = {}
    files.update(write_fields(patch_specs, physics, turb,
                             [f for f in turb_fields] if regime == "turbulent" else [],
                             compressible))
    files.update(write_constants(physics, regime))
    files.update(write_system(physics, solver_controls, solution or {}, functions_block))

    for rel, content in files.items():
        path = os.path.join(case_dir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write(content)
    return files


__all__ = ["generate_openfoam_case_files", "pick_solver"]
