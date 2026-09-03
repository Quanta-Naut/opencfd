"""Map a patch (role + kind + params) to the OpenFOAM boundary condition for
each solved field, for OpenFOAM Foundation 13.

Constraint patches (symmetry / empty / wedge) are NOT handled here - the field
files pull `#includeEtc "caseDicts/setConstraintTypes"` which sets them from the
polyMesh patch type.
"""
from typing import Any, Dict, List


def normalise_patches(patches: List[Dict[str, Any]] | None, ref_velocity: float) -> List[Dict[str, Any]]:
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


def _supersonic(phys: Dict[str, Any]) -> bool:
    return (
        phys.get("compressibility") == "compressible"
        and str(phys.get("speedRegime", "subsonic")) in ("supersonic", "hypersonic")
    )


def field_bc(field: str, patch: Dict[str, Any], phys: Dict[str, Any], turb: Dict[str, float]) -> Dict[str, Any]:
    role = patch["role"]
    bc = patch["bc"]
    kind = bc.get("kind")
    U = float(phys.get("inletVelocity", 20.0))
    compressible = phys.get("compressibility") == "compressible"
    supersonic = _supersonic(phys)

    # ---- momentum ---------------------------------------------------------
    if field == "U":
        if role in ("inlet", "farfield") and supersonic:
            # `freestreamVelocity` resolves the local inflow/outflow direction, so
            # it works on a curved C-grid inlet arc where a fixed (Uinf 0 0) would
            # be forced across a slanted face and kick off a spurious wave.
            return {"type": "freestreamVelocity", "freestreamValue": f"uniform {_vec(bc.get('velocity', U))}", "value": f"uniform {_vec(bc.get('velocity', U))}"}
        if role == "inlet":
            if kind == "massFlowInlet":
                return {"type": "flowRateInletVelocity",
                        "massFlowRate": bc.get("massFlowRate", 1.0), "value": f"uniform {_vec(U)}"}
            if kind == "totalPressureInlet":
                return {"type": "pressureInletVelocity", "value": f"uniform {_vec(0)}"}
            return {"type": "fixedValue", "value": f"uniform {_vec(bc.get('velocity', U))}"}
        if role == "outlet":
            # Supersonic outflow: everything is extrapolated (no upstream info).
            if supersonic:
                return {"type": "zeroGradient"}
            return {"type": "pressureInletOutletVelocity", "value": f"uniform {_vec(0)}"}
        if role == "farfield":
            return {"type": "freestreamVelocity", "freestreamValue": f"uniform {_vec(bc.get('velocity', U))}", "value": f"uniform {_vec(bc.get('velocity', U))}"}
        if kind == "slipWall":
            return {"type": "slip"}
        if kind == "movingWall":
            return {"type": "movingWallVelocity", "value": f"uniform {_vec(bc.get('velocity', 0))}"}
        if kind == "rotatingWall":
            rpm = bc.get("rpm", 0.0)
            return {"type": "rotatingWallVelocity",
                    "origin": "(0 0 0)", "axis": "(0 0 1)", "omega": rpm * 3.14159265 / 30.0}
        return {"type": "noSlip"}

    # ---- pressure (real p in Pa for compressible, kinematic p for incompr.) --
    if field == "p":
        # Compressible p is ABSOLUTE (Pa) - `rho = p/(R T)`, so p must never reach
        # 0 or rho collapses and the solver hits a divide-by-zero. The Case Setup
        # outlet pressure is a GAUGE value (0 by default); add the reference so
        # the outlet sits at ~1 atm, not vacuum. Incompressible p is kinematic
        # gauge with p_ref = 0, so nothing changes there.
        p_ref = float(phys.get("inletPressure", 101325)) if compressible else 0.0
        gauge = float(bc.get("staticPressure", 0) or 0)
        if supersonic:
            # Supersonic: the inlet uses the characteristic `freestreamPressure`
            # (works whether the inlet is a straight edge or a curved C-grid arc -
            # a plain fixedValue forces horizontal flow through a slanted arc face
            # and spawns a spurious oblique wave). Everything downstream is pure
            # extrapolation - a supersonic outflow carries no upstream information,
            # so nothing reflects.
            if role in ("inlet", "farfield"):
                return {"type": "freestreamPressure", "freestreamValue": f"uniform {p_ref + gauge}", "value": f"uniform {p_ref + gauge}"}
            return {"type": "zeroGradient"}
        if role == "outlet":
            return {"type": "fixedValue", "value": f"uniform {p_ref + gauge}"}
        if role == "inlet" and kind == "totalPressureInlet":
            p0_gauge = float(bc.get("totalPressure", 0) or 0)
            return {"type": "totalPressure", "p0": f"uniform {p_ref + p0_gauge}"}
        if role == "farfield":
            return {"type": "freestreamPressure", "freestreamValue": f"uniform {p_ref}", "value": f"uniform {p_ref}"}
        return {"type": "zeroGradient"}

    # ---- turbulent thermal diffusivity (compressible wall functions) --------
    if field == "alphat":
        if role in ("inlet", "outlet", "farfield"):
            return {"type": "calculated", "value": "uniform 0"}
        return {"type": "compressible::alphatWallFunction", "value": "uniform 0"}

    # ---- temperature (compressible) ------------------------------------
    if field == "T":
        T_inf = float(phys.get("inletTemperature", 288.15))
        if supersonic:
            if role in ("inlet", "farfield"):
                return {"type": "freestream", "freestreamValue": f"uniform {T_inf}", "value": f"uniform {T_inf}"}
            return {"type": "zeroGradient"}
        if role == "inlet":
            return {"type": "fixedValue", "value": f"uniform {T_inf}"}
        if role == "outlet":
            return {"type": "inletOutlet", "inletValue": f"uniform {T_inf}", "value": f"uniform {T_inf}"}
        if role == "farfield":
            return {"type": "freestream", "freestreamValue": f"uniform {T_inf}", "value": f"uniform {T_inf}"}
        thermal = bc.get("thermal", "adiabatic")
        if thermal == "fixedTemperature":
            return {"type": "fixedValue", "value": f"uniform {bc.get('wallTemperature', T_inf)}"}
        if thermal == "fixedHeatFlux":
            return {"type": "externalWallHeatFluxTemperature", "mode": "flux",
                    "q": f"uniform {bc.get('wallHeatFlux', 0)}", "kappaMethod": "fluidThermo",
                    "value": f"uniform {T_inf}"}
        return {"type": "zeroGradient"}

    # ---- turbulence: k, epsilon, omega, nut, nuTilda -----------------
    inlet_val = {
        "k": turb["k"], "epsilon": turb["epsilon"], "omega": turb["omega"], "nut": turb["nut"],
        "nuTilda": 4.0 * float(phys.get("kinematicViscosity", 1.5e-5)),
    }[field]

    if supersonic and role in ("inlet", "farfield"):
        if field == "nut":
            return {"type": "calculated", "value": f"uniform {inlet_val}"}
        return {"type": "freestream", "freestreamValue": f"uniform {inlet_val}", "value": f"uniform {inlet_val}"}
    if supersonic and role == "outlet":
        if field == "nut":
            return {"type": "calculated", "value": f"uniform {inlet_val}"}
        return {"type": "zeroGradient"}
    if role == "inlet":
        if field == "nut":
            return {"type": "calculated", "value": f"uniform {inlet_val}"}
        return {"type": "fixedValue", "value": f"uniform {inlet_val}"}
    if role == "outlet":
        if field == "nut":
            return {"type": "calculated", "value": f"uniform {inlet_val}"}
        return {"type": "inletOutlet", "inletValue": f"uniform {inlet_val}", "value": f"uniform {inlet_val}"}
    if role == "farfield":
        if field == "nut":
            return {"type": "calculated", "value": f"uniform {inlet_val}"}
        return {"type": "freestream", "freestreamValue": f"uniform {inlet_val}", "value": f"uniform {inlet_val}"}

    # wall
    ks = bc.get("roughnessHeight", 0.0) or 0.0
    if field == "nut":
        if ks > 0:
            return {"type": "nutURoughWallFunction", "roughnessHeight": f"uniform {ks}",
                    "roughnessConstant": f"uniform {bc.get('roughnessConstant', 0.5)}",
                    "roughnessFactor": "uniform 1", "value": "uniform 0"}
        return {"type": "nutkWallFunction", "value": "uniform 0"}
    if field == "k":
        return {"type": "kqRWallFunction", "value": f"uniform {inlet_val}"}
    if field == "epsilon":
        return {"type": "epsilonWallFunction", "value": f"uniform {inlet_val}"}
    if field == "omega":
        return {"type": "omegaWallFunction", "value": f"uniform {inlet_val}"}
    if field == "nuTilda":
        return {"type": "fixedValue", "value": "uniform 0"}
    return {"type": "zeroGradient"}
