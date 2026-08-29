"""constant/ dictionaries: transport / thermophysical + turbulence model."""
from typing import Any, Dict

from .writer import foam_file

_MODEL_FOAM = {
    "kOmegaSST": "kOmegaSST", "kOmega": "kOmega", "kEpsilon": "kEpsilon",
    "realizableKE": "realizableKE", "RNGkEpsilon": "RNGkEpsilon",
    "SpalartAllmaras": "SpalartAllmaras", "kOmegaSSTLM": "kOmegaSSTLM",
    "kOmegaSSTComp": "kOmegaSST", "SpalartAllmarasComp": "SpalartAllmaras",
}


def write_constants(phys: Dict[str, Any], regime: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    compressible = phys.get("compressibility") == "compressible"
    model = _MODEL_FOAM.get(str(phys.get("turbulenceModelId", "kOmegaSST")), "kOmegaSST")
    turb_on = regime == "turbulent"

    # The turbulence dict is named `turbulenceProperties` on the ESI fork and
    # `momentumTransport` on the Foundation fork. Write both with identical
    # content so the case runs on either - OpenFOAM reads only the one it wants.
    turb_body = foam_file(
        "dictionary", "turbulenceProperties", location="constant",
        body=(
            "simulationType  RAS;\n\n"
            "RAS\n{\n"
            f"    RASModel        {model if turb_on else 'laminar'};\n"
            f"    turbulence      {'on' if turb_on else 'off'};\n"
            "    printCoeffs     on;\n"
            "}\n"
        ),
    )
    out["constant/turbulenceProperties"] = turb_body
    out["constant/momentumTransport"] = turb_body

    if not compressible:
        out["constant/transportProperties"] = foam_file(
            "dictionary", "transportProperties", location="constant",
            body=f"transportModel  Newtonian;\nnu              [0 2 -1 0 0 0 0] {phys.get('kinematicViscosity', 1.5e-5)};\n",
        )
    else:
        gamma = phys.get("specificHeatRatio", 1.4)
        R = phys.get("gasConstant", 287.05)
        Cp = phys.get("specificHeat", gamma * R / (gamma - 1))
        mu = phys.get("kinematicViscosity", 1.5e-5) * phys.get("density", 1.225)
        transport = "sutherland" if phys.get("transportModel") == "sutherland" else "const"
        trans_body = (
            "transport\n    {\n"
            + (f"        As              1.4792e-06;\n        Ts              116;\n"
               if transport == "sutherland"
               else f"        mu              {mu};\n        Pr              {phys.get('prandtlNumber', 0.71)};\n")
            + "    }"
        )
        out["constant/thermophysicalProperties"] = foam_file(
            "dictionary", "thermophysicalProperties", location="constant",
            body=(
                "thermoType\n{\n"
                "    type            hePsiThermo;\n    mixture         pureMixture;\n"
                f"    transport       {transport};\n    thermo          hConst;\n"
                "    equationOfState perfectGas;\n    specie          specie;\n    energy          sensibleInternalEnergy;\n}\n\n"
                "mixture\n{\n"
                f"    specie\n    {{\n        molWeight       {8314.0 / R:.4f};\n    }}\n"
                f"    thermodynamics\n    {{\n        Cp              {Cp:.2f};\n        Hf              0;\n    }}\n"
                f"    {trans_body}\n}}\n"
            ),
        )
    return out
