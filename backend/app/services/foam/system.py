"""system/ dictionaries: controlDict, fvSchemes, fvSolution - built from the
Solution-tab config (methods, controls, run)."""
from typing import Any, Dict

from .writer import foam_file

_SOLVER_FOR = {
    ("incompressible", "steady"): "simpleFoam",
    ("incompressible", "transient"): "pimpleFoam",
    ("compressible", "steady"): "rhoSimpleFoam",
    ("compressible", "transient"): "rhoPimpleFoam",
}

_DIV = {
    "firstOrder": "Gauss upwind",
    "secondOrder": "Gauss linearUpwind grad({f})",
    "central": "Gauss linear",
    "blended": "Gauss linearUpwindV 0.75",
}
_TIME = {
    "steadyState": "steadyState",
    "Euler": "Euler",
    "backward": "backward",
    "CrankNicolson": "CrankNicolson 0.9",
}


def pick_solver(phys: Dict[str, Any]) -> str:
    comp = phys.get("compressibility", "incompressible")
    time = phys.get("timeFormulation", "steady")
    regime = phys.get("speedRegime", "subsonic")
    if comp == "compressible" and regime in ("transonic", "supersonic", "hypersonic"):
        return "rhoCentralFoam"
    return _SOLVER_FOR.get((comp, time), "simpleFoam")


def _div_scheme(order: str, field: str, steady: bool) -> str:
    s = _DIV.get(order, _DIV["secondOrder"]).format(f=field)
    return f"bounded {s}" if steady else s


def write_system(phys: Dict[str, Any], solver_controls: Dict[str, Any],
                 solution: Dict[str, Any] | None = None,
                 functions_block: str = "") -> Dict[str, str]:
    sol = solution or {}
    methods = sol.get("methods", {})
    controls = sol.get("controls", {})
    run = sol.get("run", {})

    solver = pick_solver(phys)
    time_scheme = methods.get("time", "steadyState" if phys.get("timeFormulation", "steady") == "steady" else "Euler")
    steady = time_scheme == "steadyState"
    coupling = methods.get("coupling", "SIMPLEC" if steady else "PIMPLE")

    iters = int(run.get("iterations") or solver_controls.get("iterations", 1000))
    dt = float(run.get("deltaT") or solver_controls.get("timeStep", 1e-4))
    end = iters if steady else float(run.get("endTime", 1.0))
    write_iv = int(run.get("writeInterval") or max(1, iters // 5))
    nno = int(methods.get("nNonOrthogonalCorrectors", 1))
    mom_pred = "yes" if methods.get("momentumPredictor", True) else "no"

    control = (
        f"application     {solver};\n"
        "startFrom       " + ("startTime" if run.get("init") != "continue" else "latestTime") + ";\n"
        "startTime       0;\nstopAt          endTime;\n"
        f"endTime         {end};\ndeltaT          {1 if steady else dt};\n"
        f"writeControl    timeStep;\nwriteInterval   {write_iv};\n"
        "purgeWrite      2;\nwriteFormat     ascii;\nwritePrecision  8;\n"
        "writeCompression off;\ntimeFormat      general;\nrunTimeModifiable true;\n"
        + ("" if steady else f"adjustTimeStep  {'yes' if controls.get('adjustableTimeStep', True) else 'no'};\n"
                             f"maxCo           {controls.get('maxCo', 5)};\n")
        + ("\n" + functions_block if functions_block else "")
    )

    mom = methods.get("momentum", "secondOrder")
    turb = methods.get("turbulence", "firstOrder")
    ener = methods.get("energy", "secondOrder")
    grad = {"gauss": "Gauss linear", "leastSquares": "leastSquares",
            "cellLimited": "cellLimited Gauss linear 1"}.get(methods.get("gradient", "gauss"), "Gauss linear")
    schemes = (
        f"ddtSchemes\n{{\n    default         {_TIME.get(time_scheme, 'steadyState')};\n}}\n\n"
        f"gradSchemes\n{{\n    default         {grad};\n}}\n\n"
        "divSchemes\n{\n    default         none;\n"
        f"    div(phi,U)      {_div_scheme(mom, 'U', steady)};\n"
        f"    div(phi,k)      {_div_scheme(turb, 'k', steady)};\n"
        f"    div(phi,omega)  {_div_scheme(turb, 'omega', steady)};\n"
        f"    div(phi,epsilon) {_div_scheme(turb, 'epsilon', steady)};\n"
        f"    div(phi,nuTilda) {_div_scheme(turb, 'nuTilda', steady)};\n"
        + (f"    div(phi,e)      {_div_scheme(ener, 'e', steady)};\n"
           f"    div(phi,K)      {_div_scheme(ener, 'K', steady)};\n"
           if phys.get("compressibility") == "compressible" else "")
        + "    div((nuEff*dev2(T(grad(U))))) Gauss linear;\n}\n\n"
        "laplacianSchemes\n{\n    default         Gauss linear corrected;\n}\n\n"
        "interpolationSchemes\n{\n    default         linear;\n}\n\n"
        "snGradSchemes\n{\n    default         corrected;\n}\n\n"
        # kOmegaSST and other models need a near-wall distance method
        "wallDist\n{\n    method          meshWave;\n}\n"
    )

    relax = controls.get("relax", {"p": 0.5, "U": 0.7, "k": 0.7, "omega": 0.7, "e": 0.7})
    res = controls.get("residualTargets", {"p": 1e-4, "U": 1e-4, "turbulence": 1e-4})
    outer = int(methods.get("nOuterCorrectors", 1))
    inner = int(methods.get("nCorrectors", 2))

    coupling_block = (
        f"{coupling}\n{{\n"
        f"    nNonOrthogonalCorrectors {nno};\n"
        + (f"    consistent      {'yes' if coupling == 'SIMPLEC' else 'no'};\n"
           f"    residualControl\n    {{\n        p               {res['p']};\n        U               {res['U']};\n"
           f"        \"(k|omega|epsilon|nuTilda)\" {res['turbulence']};\n    }}\n"
           if steady else
           f"    nOuterCorrectors {outer};\n    nCorrectors     {inner};\n    momentumPredictor {mom_pred};\n")
        + "}\n"
    )

    solution_txt = (
        "solvers\n{\n"
        '    "(p|p_rgh|Phi)"\n    {\n        solver          GAMG;\n        smoother        GaussSeidel;\n'
        '        tolerance       1e-7;\n        relTol          ' + ("0.05" if steady else "0.01") + ";\n    }\n"
        '    "(U|k|omega|epsilon|nuTilda|e|h)"\n    {\n        solver          smoothSolver;\n'
        '        smoother        symGaussSeidel;\n        tolerance       1e-8;\n        relTol          '
        + ("0.1" if steady else "0.01") + ";\n    }\n}\n\n"
        + coupling_block + "\n"
        "relaxationFactors\n{\n"
        f"    fields\n    {{\n        p               {relax.get('p', 0.5)};\n    }}\n"
        f"    equations\n    {{\n        U               {relax.get('U', 0.7)};\n"
        f"        \"(k|omega|epsilon|nuTilda)\" {relax.get('k', 0.7)};\n"
        f"        e               {relax.get('e', 0.7)};\n    }}\n}}\n"
    )

    return {
        "system/controlDict": foam_file("dictionary", "controlDict", control, "system"),
        "system/fvSchemes": foam_file("dictionary", "fvSchemes", schemes, "system"),
        "system/fvSolution": foam_file("dictionary", "fvSolution", solution_txt, "system"),
    }
