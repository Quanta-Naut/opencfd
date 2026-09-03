"""Write the 0/ field files from the patch spec + physics."""
from typing import Any, Dict, List

from .writer import foam_file, boundary_field
from .boundary import field_bc

_DIMS = {
    "U": "[0 1 -1 0 0 0 0]",
    "p": "[0 2 -2 0 0 0 0]",          # incompressible (kinematic pressure)
    "T": "[0 0 0 1 0 0 0]",
    "k": "[0 2 -2 0 0 0 0]",
    "epsilon": "[0 2 -3 0 0 0 0]",
    "omega": "[0 0 -1 0 0 0 0]",
    "nut": "[0 2 -1 0 0 0 0]",
    "nuTilda": "[0 2 -1 0 0 0 0]",
    "alphat": "[1 -1 -1 0 0 0 0]",
}
# The Foundation-13 `fluid` (compressible) module solves for the real pressure
# `p` in Pa - not the kinematic `p` or the buoyant `p_rgh`.
_P_DIM_COMPRESSIBLE = "[1 -1 -2 0 0 0 0]"


def _catch_all(field: str, compressible: bool) -> Dict[str, str]:
    """Fallback BC for any mesh patch the Case Setup spec did not name.

    gmshToFoam can emit an extra patch for a boundary edge the user never
    tagged (`domain_3`, ...). Without an entry the solver dies with
    `Cannot find patchField entry for <patch>`. A trailing `".*"` regex is
    beaten by every explicit patch name and by the constraint-type groups in
    the `#includeEtc` trailer, so it only ever catches a genuine stray patch.
    `slip` / `zeroGradient` keep such a patch inert rather than crashing.
    """
    if field == "U":
        return {"type": "slip"}
    if field in ("nut", "alphat"):
        return {"type": "calculated", "value": "uniform 0"}
    return {"type": "zeroGradient"}


def _is_supersonic(phys: Dict[str, Any]) -> bool:
    return (
        phys.get("compressibility") == "compressible"
        and str(phys.get("speedRegime", "subsonic")) in ("supersonic", "hypersonic")
    )


def _internal(field: str, phys: Dict[str, Any], turb: Dict[str, float], compressible: bool) -> str:
    if field == "U":
        # shockFluid (density-based) must start AT freestream or the start-up
        # wave diverges it. The pressure-based `fluid` module and incompressible
        # are gentler from rest on a coarse mesh.
        if _is_supersonic(phys):
            return f"uniform ({float(phys.get('inletVelocity', 20.0))} 0 0)"
        return "uniform (0 0 0)"
    if field == "p":
        return f"uniform {phys.get('inletPressure', 101325)}" if compressible else "uniform 0"
    if field == "T":
        return f"uniform {phys.get('inletTemperature', 288.15)}"
    if field == "alphat":
        return "uniform 0"
    if field == "nuTilda":
        return f"uniform {4.0 * phys.get('kinematicViscosity', 1.5e-5)}"
    return f"uniform {turb.get(field, 0)}"


def write_fields(
    patches: List[Dict[str, Any]],
    phys: Dict[str, Any],
    turb: Dict[str, float],
    turb_fields: List[str],
    compressible: bool,
    empty_patch: str = "frontAndBack",
) -> Dict[str, str]:
    fields = ["U", "p", *turb_fields]
    if compressible:
        fields.append("T")  # closes the energy equation
        if turb_fields:
            # turbulent thermal diffusivity - only meaningful with a RAS model,
            # and its wall function needs one, so skip it for laminar.
            fields.append("alphat")

    # `setConstraintTypes` sets empty/symmetry/wedge BCs from the polyMesh patch
    # types, so we do not write frontAndBack (or any constraint patch) by hand.
    trailer = '#includeEtc "caseDicts/setConstraintTypes"'

    out: Dict[str, str] = {}
    for f in fields:
        cls = "volVectorField" if f == "U" else "volScalarField"
        dims = _P_DIM_COMPRESSIBLE if (f == "p" and compressible) else _DIMS.get(f, "[0 0 0 0 0 0 0]")
        # `.*` first so an explicit patch name (exact match) always wins over it.
        pf: Dict[str, Dict[str, Any]] = {'".*"': _catch_all(f, compressible)}
        for p in patches:
            if p["role"] in ("symmetry", "periodic"):
                continue  # handled by setConstraintTypes
            pf[p["name"]] = field_bc(f, p, phys, turb)
        body = (
            f"dimensions      {dims};\n\n"
            f"internalField   {_internal(f, phys, turb, compressible)};\n\n"
            f"{boundary_field(pf, trailer)}"
        )
        out[f"0/{f}"] = foam_file(cls, f, body)
    return out
