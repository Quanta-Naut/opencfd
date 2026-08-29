"""system/ dictionaries for OpenFOAM Foundation 13 (openfoam.org).

Foundation 13 runs everything through `foamRun -solver <module>`; the case
carries `solver` in controlDict. Steady vs transient is decided by
`ddtSchemes/default` (steadyState or Euler/backward), and fvSolution branches on
it with `#ifeq`. There is one `PIMPLE` block for both.
"""
from typing import Any, Dict

from .writer import foam_file

# incompressible / compressible -> foamRun solver module
_MODULE = {
    "incompressible": "incompressibleFluid",
    "compressible": "fluid",
}

_DIV = {
    "firstOrder": "Gauss upwind",
    "secondOrder": "Gauss linearUpwind limited",
    "central": "Gauss linear",
    "blended": "Gauss linearUpwindV limited",
}
_TIME = {
    "steadyState": "steadyState",
    "Euler": "Euler",
    "backward": "backward",
    "CrankNicolson": "CrankNicolson 0.9",
}


def pick_solver(phys: Dict[str, Any]) -> str:
    """The foamRun solver module for this case (Foundation 13)."""
    comp = phys.get("compressibility", "incompressible")
    return _MODULE.get(comp, "incompressibleFluid")


def classic_application(phys: Dict[str, Any]) -> str:
    """Classic ESI-fork solver binary - written as `application` in controlDict
    so a case also runs on the ESI fork."""
    comp = phys.get("compressibility", "incompressible")
    steady = phys.get("timeFormulation", "steady") == "steady"
    regime = phys.get("speedRegime", "subsonic")
    if comp == "compressible" and regime in ("transonic", "supersonic", "hypersonic"):
        return "rhoCentralFoam"
    return {
        ("incompressible", True): "simpleFoam", ("incompressible", False): "pimpleFoam",
        ("compressible", True): "rhoSimpleFoam", ("compressible", False): "rhoPimpleFoam",
    }[(comp, steady)]


def _div_scheme(order: str, steady: bool) -> str:
    s = _DIV.get(order, _DIV["secondOrder"])
    return f"bounded {s}" if steady and s.startswith("Gauss") else s


def write_system(phys: Dict[str, Any], solver_controls: Dict[str, Any],
                 solution: Dict[str, Any] | None = None,
                 functions_block: str = "") -> Dict[str, str]:
    sol = solution or {}
    methods = sol.get("methods", {})
    controls = sol.get("controls", {})
    run = sol.get("run", {})

    module = pick_solver(phys)
    compressible = phys.get("compressibility") == "compressible"
    time_scheme = methods.get("time") or (
        "steadyState" if phys.get("timeFormulation", "steady") == "steady" else "Euler"
    )
    steady = time_scheme == "steadyState"
    ddt = _TIME.get(time_scheme, "steadyState")

    iters = int(run.get("iterations") or solver_controls.get("iterations", 1000))
    dt = float(run.get("deltaT") or solver_controls.get("timeStep", 1e-3))
    end = iters if steady else float(run.get("endTime", 1.0))
    write_iv = int(run.get("writeInterval") or max(1, (iters if steady else int(end / max(dt, 1e-9))) // 5))
    nno = int(methods.get("nNonOrthogonalCorrectors", 1))
    nouter = int(methods.get("nOuterCorrectors", 1))
    ncorr = int(methods.get("nCorrectors", 2))

    control = (
        f"solver          {module};\n"                      # Foundation 13
        f"application     {classic_application(phys)};\n"    # ESI fork
        "startFrom       " + ("latestTime" if run.get("init") == "continue" else "startTime") + ";\n"
        "startTime       0;\nstopAt          endTime;\n"
        f"endTime         {end};\ndeltaT          {1 if steady else dt};\n"
        f"writeControl    timeStep;\nwriteInterval   {write_iv};\n"
        "purgeWrite      2;\nwriteFormat     ascii;\nwritePrecision  8;\n"
        "writeCompression off;\ntimeFormat      general;\ntimePrecision   6;\nrunTimeModifiable true;\n"
        + ("" if steady else
           f"adjustTimeStep  {'yes' if controls.get('adjustableTimeStep', True) else 'no'};\n"
           f"maxCo           {controls.get('maxCo', 5)};\n")
        + ("\n" + functions_block if functions_block else "")
    )

    mom = methods.get("momentum", "secondOrder")
    turb = methods.get("turbulence", "firstOrder")
    grad = {"gauss": "Gauss linear", "leastSquares": "leastSquares",
            "cellLimited": "cellLimited Gauss linear 1"}.get(methods.get("gradient", "cellLimited"),
                                                             "cellLimited Gauss linear 1")
    energy_div = ""
    if compressible:
        ener = methods.get("energy", "secondOrder")
        energy_div = (
            f"    div(phi,e)      {_div_scheme(ener, steady)};\n"
            f"    div(phi,K)      {_div_scheme(ener, steady)};\n"
            f"    div(phi,(p|rho)) {_div_scheme(ener, steady)};\n"
        )

    mom_div = _div_scheme(mom, steady)
    turb_div = _div_scheme(turb, steady)
    schemes = (
        "ddtSchemes\n{\n"
        f"    default         {ddt};\n}}\n\n"
        "gradSchemes\n{\n"
        "    default         Gauss linear;\n"
        "    limited         cellLimited Gauss linear 1;\n"
        "    grad(U)         $limited;\n"
        "    grad(k)         $limited;\n"
        "    grad(omega)     $limited;\n"
        "    grad(epsilon)   $limited;\n}\n\n"
        "divSchemes\n{\n    default         none;\n"
        f"    div(phi,U)      {mom_div};\n"
        f"    turbulence      {turb_div};\n"
        "    div(phi,k)      $turbulence;\n"
        "    div(phi,omega)  $turbulence;\n"
        "    div(phi,epsilon) $turbulence;\n"
        "    div(phi,nuTilda) $turbulence;\n"
        + energy_div
        + "    div((nuEff*dev2(T(grad(U))))) Gauss linear;\n"
        + ("    div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear;\n" if compressible else "")
        + "}\n\n"
        "laplacianSchemes\n{\n    default         Gauss linear corrected;\n}\n\n"
        "interpolationSchemes\n{\n    default         linear;\n}\n\n"
        "snGradSchemes\n{\n    default         corrected;\n}\n\n"
        "wallDist\n{\n    method          meshWave;\n}\n"
    )

    p_name = "p_rgh" if compressible else "p"
    res = controls.get("residualTargets", {"p": 1e-4, "U": 1e-4, "turbulence": 1e-4})
    p_rt = "0.05" if steady else "0.01"
    u_rt = "0.1" if steady else "0.01"

    solution_txt = (
        "solvers\n{\n"
        f"    {p_name}\n    {{\n"
        "        solver          GAMG;\n        smoother        GaussSeidel;\n"
        f"        tolerance       1e-7;\n        relTol          {p_rt};\n    }}\n"
        f"    {p_name}Final\n    {{\n        ${p_name};\n        relTol          0;\n    }}\n"
        f"    Phi\n    {{\n        ${p_name};\n        relTol          0.01;\n    }}\n"
        '    "(U|k|omega|epsilon|nuTilda|e|h)"\n    {\n'
        "        solver          smoothSolver;\n        smoother        symGaussSeidel;\n"
        f"        tolerance       1e-8;\n        relTol          {u_rt};\n    }}\n"
        '    "(U|k|omega|epsilon|nuTilda|e|h)Final"\n    {\n        $U;\n        relTol          0;\n    }\n'
        "}\n\n"
        "PIMPLE\n{\n"
        + (f"    nNonOrthogonalCorrectors {nno};\n"
           "    pRefCell        0;\n    pRefValue       0;\n"
           f'    residualControl\n    {{\n        p               {res["p"]};\n'
           f'        U               {res["U"]};\n        "(k|omega|epsilon)" {res["turbulence"]};\n    }}\n'
           if steady else
           f"    nOuterCorrectors {nouter};\n    nCorrectors     {ncorr};\n"
           f"    nNonOrthogonalCorrectors {nno};\n"
           "    pRefCell        0;\n    pRefValue       0;\n"
           "    momentumPredictor " + ("yes" if methods.get("momentumPredictor", True) else "no") + ";\n")
        + "}\n\n"
        # ESI fork: simpleFoam reads SIMPLE, pimpleFoam reads PIMPLE. Foundation
        # foamRun reads PIMPLE only. Writing both keeps the case fork-portable.
        + ("SIMPLE\n{\n"
           f"    nNonOrthogonalCorrectors {nno};\n"
           "    consistent      yes;\n"
           f'    residualControl\n    {{\n        p               {res["p"]};\n'
           f'        U               {res["U"]};\n        "(k|omega|epsilon)" {res["turbulence"]};\n    }}\n'
           "}\n\n" if steady else "")
        + _relaxation(controls, steady, compressible)
    )

    out = {
        "system/controlDict": foam_file("dictionary", "controlDict", control, "system"),
        "system/fvSchemes": foam_file("dictionary", "fvSchemes", schemes, "system"),
        "system/fvSolution": foam_file("dictionary", "fvSolution", solution_txt, "system"),
    }
    return out


def _relaxation(controls: Dict[str, Any], steady: bool, compressible: bool) -> str:
    r = controls.get("relax", {})
    if steady:
        p = r.get("p", 0.7)
        u = r.get("U", 0.3)
        t = r.get("k", 0.3)
    else:
        p = r.get("p", 1.0)
        u = r.get("U", 1.0)
        t = r.get("k", 1.0)
    lines = [
        "relaxationFactors\n{",
        "    fields\n    {",
        f"        {'rho' if compressible else 'p'}             {p};" if not compressible else f"        p_rgh           {p};",
        "    }",
        "    equations\n    {",
        f"        U               {u};",
        f'        "(k|omega|epsilon|nuTilda)" {t};',
    ]
    if compressible:
        lines.append(f"        e               {r.get('e', 0.5)};")
    lines += ["    }", "}\n"]
    return "\n".join(lines)
