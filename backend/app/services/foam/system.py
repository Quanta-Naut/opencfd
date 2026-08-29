"""system/ dictionaries: controlDict, fvSchemes, fvSolution."""
from typing import Any, Dict

from .writer import foam_file

_SOLVER_FOR = {
    ("incompressible", "steady"): "simpleFoam",
    ("incompressible", "transient"): "pimpleFoam",
    ("compressible", "steady"): "rhoSimpleFoam",
    ("compressible", "transient"): "rhoPimpleFoam",
}


def pick_solver(phys: Dict[str, Any]) -> str:
    comp = phys.get("compressibility", "incompressible")
    time = phys.get("timeFormulation", "steady")
    regime = phys.get("speedRegime", "subsonic")
    if comp == "compressible" and regime in ("transonic", "supersonic", "hypersonic"):
        return "rhoCentralFoam"
    return _SOLVER_FOR.get((comp, time), "simpleFoam")


def write_system(phys: Dict[str, Any], solver_controls: Dict[str, Any]) -> Dict[str, str]:
    solver = pick_solver(phys)
    steady = phys.get("timeFormulation", "steady") == "steady"
    iters = int(solver_controls.get("iterations", 500))
    dt = float(solver_controls.get("timeStep", 1.0))
    end = iters if steady else iters * dt
    write_iv = max(1, iters // 5)

    control = (
        f"application     {solver};\n"
        "startFrom       startTime;\nstartTime       0;\nstopAt          endTime;\n"
        f"endTime         {end};\ndeltaT          {1 if steady else dt};\n"
        f"writeControl    timeStep;\nwriteInterval   {write_iv};\n"
        "purgeWrite      0;\nwriteFormat     ascii;\nwritePrecision  8;\n"
        "writeCompression off;\ntimeFormat      general;\nrunTimeModifiable true;\n"
    )

    div = "bounded Gauss linearUpwind grad(U)" if steady else "Gauss linearUpwind grad(U)"
    schemes = (
        "ddtSchemes\n{\n    default         " + ("steadyState" if steady else "Euler") + ";\n}\n\n"
        "gradSchemes\n{\n    default         Gauss linear;\n}\n\n"
        "divSchemes\n{\n    default         none;\n"
        f"    div(phi,U)      {div};\n"
        "    div(phi,k)      bounded Gauss upwind;\n"
        "    div(phi,omega)  bounded Gauss upwind;\n"
        "    div(phi,epsilon) bounded Gauss upwind;\n"
        "    div((nuEff*dev2(T(grad(U))))) Gauss linear;\n}\n\n"
        "laplacianSchemes\n{\n    default         Gauss linear corrected;\n}\n\n"
        "interpolationSchemes\n{\n    default         linear;\n}\n\n"
        "snGradSchemes\n{\n    default         corrected;\n}\n"
    )

    rf = solver_controls.get("relaxationFactors", {})
    solution = (
        "solvers\n{\n"
        '    p\n    {\n        solver          GAMG;\n        tolerance       1e-7;\n        relTol          0.05;\n        smoother        GaussSeidel;\n    }\n'
        '    "(U|k|omega|epsilon|nuTilda|e|h)"\n    {\n        solver          smoothSolver;\n        smoother        symGaussSeidel;\n        tolerance       1e-8;\n        relTol          0.1;\n    }\n'
        "}\n\n"
        f"SIMPLE\n{{\n    nNonOrthogonalCorrectors 1;\n    consistent      yes;\n    residualControl\n    {{\n        p               1e-4;\n        U               1e-4;\n        \"(k|omega|epsilon)\" 1e-4;\n    }}\n}}\n\n"
        "relaxationFactors\n{\n"
        f"    fields\n    {{\n        p               {rf.get('p', 0.7)};\n    }}\n"
        f"    equations\n    {{\n        U               {rf.get('U', 0.7)};\n        \"(k|omega|epsilon)\" {rf.get('k', 0.7)};\n    }}\n}}\n"
    )

    return {
        "system/controlDict": foam_file("dictionary", "controlDict", control, "system"),
        "system/fvSchemes": foam_file("dictionary", "fvSchemes", schemes, "system"),
        "system/fvSolution": foam_file("dictionary", "fvSolution", solution, "system"),
    }
