"""Map a patch (role + kind + params) to the OpenFOAM boundary condition for
each solved field. One place so the ``0/`` files stay consistent."""
from typing import Any, Dict, List


def normalise_patches(patches: List[Dict[str, Any]] | None, ref_velocity: float) -> List[Dict[str, Any]]:
    """Fill defaults / add the implicit empty patch for 2D."""
    out: List[Dict[str, Any]] = []
    for p in patches or []:
        role = str(p.get("role", "wall"))
        bc = dict(p.get("bc") or {})
        bc.setdefault("kind", {
            "inlet": "velocityInlet", "outlet": "pressureOutlet", "wall": "noSlipWall",
            "farfield": "farfield", "symmetry": "symmetry", "periodic": "periodic",
        }.get(role, "noSlipWall"))
        out.append({"name": str(p.get("name", role)), "role": role, "bc": bc})
    return out


def _vec(mag: float) -> str:
    return f"({mag} 0 0)"


def field_bc(field: str, patch: Dict[str, Any], phys: Dict[str, Any], turb: Dict[str, float]) -> Dict[str, Any]:
    role = patch["role"]
    bc = patch["bc"]
    kind = bc.get("kind")
    U = float(phys.get("inletVelocity", 20.0))
    wall_functions = phys.get("wallModel") == "wall_functions" or phys.get("wallTreatment") == "wall_functions"

    # ---- momentum -------------------------------------------------------------
    if field == "U":
        if role == "inlet":
            if kind == "massFlowInlet":
                return {"type": "flowRateInletVelocity", "massFlowRate": bc.get("massFlowRate", 1.0),
                        "value": f"uniform {_vec(U)}"}
            if kind == "totalPressureInlet":
                return {"type": "pressureInletVelocity", "value": f"uniform {_vec(0)}"}
            return {"type": "fixedValue", "value": f"uniform {_vec(bc.get('velocity', U))}"}
        if role == "outlet":
            return {"type": "inletOutlet", "inletValue": f"uniform {_vec(0)}", "value": f"uniform {_vec(0)}"} \
                if kind != "outflow" else {"type": "zeroGradient"}
        if role == "farfield":
            return {"type": "freestreamVelocity", "freestreamValue": f"uniform {_vec(bc.get('velocity', U))}"}
        if role == "symmetry":
            return {"type": "symmetry"}
        if role == "periodic":
            return {"type": "cyclic"}
        # wall
        if kind == "slipWall":
            return {"type": "slip"}
        if kind == "movingWall":
            return {"type": "movingWallVelocity", "value": f"uniform {_vec(bc.get('velocity', 0))}"}
        if kind == "rotatingWall":
            rpm = bc.get("rpm", 0.0)
            return {"type": "rotatingWallVelocity",
                    "origin": "(0 0 0)", "axis": "(0 0 1)", "omega": rpm * 3.14159265 / 30.0}
        return {"type": "noSlip"}

    # ---- pressure -----------------------------------------------------------
    if field == "p":
        if role == "outlet" and kind == "pressureOutlet":
            return {"type": "fixedValue", "value": f"uniform {bc.get('staticPressure', 0)}"}
        if role == "inlet" and kind == "totalPressureInlet":
            return {"type": "totalPressure", "p0": f"uniform {bc.get('totalPressure', 0)}", "value": "uniform 0"}
        if role == "farfield":
            return {"type": "freestreamPressure", "freestreamValue": "uniform 0"}
        if role == "symmetry":
            return {"type": "symmetry"}
        if role == "periodic":
            return {"type": "cyclic"}
        return {"type": "zeroGradient"}

    # ---- temperature (compressible) ---------------------------------------
    if field == "T":
        T_inf = float(phys.get("inletTemperature", 288.15))
        if role in ("inlet",):
            return {"type": "fixedValue", "value": f"uniform {T_inf}"}
        if role == "outlet":
            return {"type": "inletOutlet", "inletValue": f"uniform {T_inf}", "value": f"uniform {T_inf}"}
        if role == "farfield":
            return {"type": "freestream", "freestreamValue": f"uniform {T_inf}"}
        if role in ("symmetry", "periodic"):
            return {"type": "symmetry" if role == "symmetry" else "cyclic"}
        thermal = bc.get("thermal", "adiabatic")
        if thermal == "fixedTemperature":
            return {"type": "fixedValue", "value": f"uniform {bc.get('wallTemperature', T_inf)}"}
        if thermal == "fixedHeatFlux":
            return {"type": "externalWallHeatFluxTemperature", "mode": "flux",
                    "q": f"uniform {bc.get('wallHeatFlux', 0)}", "value": f"uniform {T_inf}"}
        return {"type": "zeroGradient"}

    # ---- turbulence: k, epsilon, omega, nut, nuTilda ---------------------
    inlet_val = {"k": turb["k"], "epsilon": turb["epsilon"], "omega": turb["omega"],
                 "nut": turb["nut"], "nuTilda": 4.0 * phys.get("kinematicViscosity", 1.5e-5)}[field]

    if role == "inlet":
        return {"type": "fixedValue", "value": f"uniform {inlet_val}"}
    if role == "outlet":
        return {"type": "inletOutlet", "inletValue": f"uniform {inlet_val}", "value": f"uniform {inlet_val}"}
    if role == "farfield":
        return {"type": "freestream", "freestreamValue": f"uniform {inlet_val}"} if field != "nut" \
            else {"type": "calculated", "value": f"uniform {inlet_val}"}
    if role == "symmetry":
        return {"type": "symmetry"}
    if role == "periodic":
        return {"type": "cyclic"}

    # wall
    ks = bc.get("roughnessHeight", 0.0) or 0.0
    if field == "nut":
        if ks > 0 and wall_functions:
            return {"type": "nutkRoughWallFunction", "Ks": f"uniform {ks}",
                    "Cs": f"uniform {bc.get('roughnessConstant', 0.5)}", "value": "uniform 0"}
        return {"type": "nutkWallFunction" if wall_functions else "nutLowReWallFunction", "value": "uniform 0"}
    if field == "k":
        return {"type": "kqRWallFunction", "value": f"uniform {inlet_val}"} if wall_functions \
            else {"type": "kLowReWallFunction", "value": f"uniform {inlet_val}"}
    if field == "epsilon":
        return {"type": "epsilonWallFunction", "value": f"uniform {inlet_val}"}
    if field == "omega":
        return {"type": "omegaWallFunction", "value": f"uniform {inlet_val}"}
    if field == "nuTilda":
        return {"type": "fixedValue", "value": "uniform 0"}
    return {"type": "zeroGradient"}
