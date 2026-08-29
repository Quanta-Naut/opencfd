"""Write the 0/ field files from the patch spec + physics."""
from typing import Any, Dict, List

from .writer import foam_file, boundary_field
from .boundary import field_bc

_DIMS = {
    "U": "[0 1 -1 0 0 0 0]",
    "p": "[0 2 -2 0 0 0 0]",
    "p_rgh": "[1 -1 -2 0 0 0 0]",
    "T": "[0 0 0 1 0 0 0]",
    "k": "[0 2 -2 0 0 0 0]",
    "epsilon": "[0 2 -3 0 0 0 0]",
    "omega": "[0 0 -1 0 0 0 0]",
    "nut": "[0 2 -1 0 0 0 0]",
    "nuTilda": "[0 2 -1 0 0 0 0]",
}


def _internal(field: str, phys: Dict[str, Any], turb: Dict[str, float], compressible: bool) -> str:
    U = float(phys.get("inletVelocity", 20.0))
    if field == "U":
        return f"uniform ({U} 0 0)"
    if field == "p":
        return "uniform 0" if not compressible else f"uniform {phys.get('inletPressure', 101325)}"
    if field == "T":
        return f"uniform {phys.get('inletTemperature', 288.15)}"
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
        fields.append("T")

    out: Dict[str, str] = {}
    for f in fields:
        cls = "volVectorField" if f == "U" else "volScalarField"
        pf: Dict[str, Dict[str, Any]] = {}
        for p in patches:
            pf[p["name"]] = field_bc(f, p, phys, turb)
        pf[empty_patch] = {"type": "empty"}
        body = (
            f"dimensions      {_DIMS.get(f, '[0 0 0 0 0 0 0]')};\n\n"
            f"internalField   {_internal(f, phys, turb, compressible)};\n\n"
            f"{boundary_field(pf)}"
        )
        out[f"0/{f}"] = foam_file(cls, f, body)
    return out
