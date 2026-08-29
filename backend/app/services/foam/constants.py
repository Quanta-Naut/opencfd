"""constant/ dictionaries for OpenFOAM Foundation 13.

Incompressible: constant/physicalProperties (viscosityModel + nu) and
constant/momentumTransport (RAS { model ...; }).  Compressible: a thermo
dictionary in physicalProperties.
"""
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

    sim_type = "RAS" if turb_on else "laminar"
    turb_body = (
        f"simulationType  {sim_type};\n\n"
        + (f"RAS\n{{\n    model           {model};\n    turbulence      on;\n    printCoeffs     on;\n}}\n"
           if turb_on else "")
    )
    # Foundation uses `momentumTransport`; keep `turbulenceProperties` too so a
    # case also runs on the ESI fork.
    out["constant/momentumTransport"] = foam_file("dictionary", "momentumTransport", turb_body, "constant")
    out["constant/turbulenceProperties"] = out["constant/momentumTransport"].replace(
        "object      momentumTransport", "object      turbulenceProperties"
    ).replace("    model           ", "    RASModel        ")

    nu = phys.get("kinematicViscosity", 1.5e-5)
    if not compressible:
        out["constant/physicalProperties"] = foam_file(
            "dictionary", "physicalProperties", location="constant",
            body=f"viscosityModel  constant;\n\nnu              [0 2 -1 0 0 0 0] {nu};\n",
        )
        # ESI fallback
        out["constant/transportProperties"] = foam_file(
            "dictionary", "transportProperties", location="constant",
            body=f"transportModel  Newtonian;\nnu              [0 2 -1 0 0 0 0] {nu};\n",
        )
    else:
        gamma = phys.get("specificHeatRatio", 1.4)
        R = phys.get("gasConstant", 287.05)
        Cp = phys.get("specificHeat", gamma * R / (gamma - 1))
        mu = float(nu) * float(phys.get("density", 1.225))
        Pr = phys.get("prandtlNumber", 0.71)
        sutherland = phys.get("transportModel") == "sutherland"
        transport = (
            "        As              1.4792e-06;\n        Ts              116;\n"
            if sutherland else
            f"        mu              {mu};\n        Pr              {Pr};\n"
        )
        out["constant/physicalProperties"] = foam_file(
            "dictionary", "physicalProperties", location="constant",
            body=(
                "thermoType\n{\n"
                "    type            hePsiThermo;\n    mixture         pureMixture;\n"
                f"    transport       {'sutherland' if sutherland else 'const'};\n"
                "    thermo          hConst;\n    equationOfState perfectGas;\n"
                "    specie          specie;\n    energy          sensibleInternalEnergy;\n}\n\n"
                "mixture\n{\n"
                f"    specie\n    {{\n        molWeight       {8314.0 / R:.4f};\n    }}\n"
                f"    thermodynamics\n    {{\n        Cp              {Cp:.2f};\n        Hf              0;\n    }}\n"
                f"    transport\n    {{\n{transport}    }}\n}}\n"
            ),
        )
    return out
