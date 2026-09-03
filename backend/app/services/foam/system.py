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

# Regimes that need the density-based shock-capturing module instead of the
# pressure-based `fluid` module.
_SHOCK_REGIMES = {"supersonic", "hypersonic"}


def is_shock_case(phys: Dict[str, Any]) -> bool:
    return (
        phys.get("compressibility") == "compressible"
        and str(phys.get("speedRegime", "subsonic")) in _SHOCK_REGIMES
    )

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
    if is_shock_case(phys):
        return "shockFluid"  # density-based, Kurganov flux, shock capturing
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
                 functions_block: str = "", ref_length: float = 1.0) -> Dict[str, str]:
    sol = solution or {}
    methods = sol.get("methods", {})
    controls = sol.get("controls", {})
    run = sol.get("run", {})

    if is_shock_case(phys):
        return _write_shock_system(phys, run, functions_block, ref_length)

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
    if run.get("writeInterval"):
        write_iv = int(run.get("writeInterval"))
    elif steady:
        # ~40 writes over the run so the live solver preview updates smoothly;
        # purgeWrite (below) keeps the on-disk footprint bounded.
        write_iv = max(5, iters // 40)
    else:
        # For transient: default to ~20 to 50 write frames (or every 0.02 - 0.05s)
        target_frame_dt = max(dt, min(0.05, end / 25.0))
        write_iv = max(1, int(round(target_frame_dt / dt)))
    nno = int(methods.get("nNonOrthogonalCorrectors", 1))
    nouter = int(methods.get("nOuterCorrectors", 1))
    ncorr = int(methods.get("nCorrectors", 2))

    # For transient with adjustTimeStep, use runTime writeControl (seconds) so frame count
    # is deterministic regardless of dt adaptation. writeInterval then means seconds per frame.
    if not steady and controls.get('adjustableTimeStep', False):
        write_control = 'runTime'
        # write_iv is in steps, convert to seconds for runTime control
        write_iv_time = round(write_iv * dt, 8)
    else:
        write_control = 'timeStep'
        write_iv_time = None

    control = (
        f"solver          {module};\n"                      # Foundation 13
        f"application     {classic_application(phys)};\n"    # ESI fork
        "startFrom       " + ("latestTime" if run.get("init") == "continue" else "startTime") + ";\n"
        "startTime       0;\nstopAt          endTime;\n"
        f"endTime         {end};\ndeltaT          {1 if steady else dt};\n"
        f"writeControl    {write_control};\nwriteInterval   {write_iv_time if write_iv_time is not None else write_iv};\n"
        f"purgeWrite      {0 if not steady else 6};\nwriteFormat     ascii;\nwritePrecision  8;\n"
        "writeCompression off;\ntimeFormat      general;\ntimePrecision   6;\nrunTimeModifiable true;\n"
        + ("" if steady else
           f"adjustTimeStep  {'yes' if controls.get('adjustableTimeStep', False) else 'no'};\n"
           f"maxCo           {controls.get('maxCo', 5)};\n")
        + ("\n" + functions_block if functions_block else "")
    )

    # Compressible cold-starts (esp. transonic) are far more stable on first-order
    # momentum; the user can still force secondOrder explicitly.
    mom = methods.get("momentum") or ("firstOrder" if compressible else "secondOrder")
    turb = methods.get("turbulence", "firstOrder")
    grad = {"gauss": "Gauss linear", "leastSquares": "leastSquares",
            "cellLimited": "cellLimited Gauss linear 1"}.get(methods.get("gradient", "cellLimited"),
                                                             "cellLimited Gauss linear 1")
    energy_div = ""
    if compressible:
        ener = methods.get("energy", "secondOrder")
        energy_div = (
            f"    div(phi,h)      {_div_scheme(ener, steady)};\n"
            f"    div(phi,K)      {_div_scheme(ener, steady)};\n"
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

    p_name = "p"  # `fluid` (compressible) solves the real p, no p_rgh
    res = controls.get("residualTargets", {"p": 1e-4, "U": 1e-4, "turbulence": 1e-4})
    p_rt = "0.05" if steady else "0.01"
    u_rt = "0.1" if steady else "0.01"

    solution_txt = (
        "solvers\n{\n"
        # Transient compressible `fluid` solves the density field explicitly.
        + ('    "rho.*"\n    {\n        solver          diagonal;\n    }\n'
           if compressible and not steady else "")
        + f"    {p_name}\n    {{\n"
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
        # Foundation `foamRun` reads PIMPLE for every mode; in steady mode it runs
        # SIMPLE, and `consistent yes` there is SIMPLEC. Only for incompressible -
        # compressible steady relies on heavy p/rho under-relaxation instead.
        + (f"    nNonOrthogonalCorrectors {nno};\n"
           "    pRefCell        0;\n    pRefValue       0;\n"
           + ("    consistent      yes;\n" if not compressible else "")
           + f'    residualControl\n    {{\n        p               {res["p"]};\n'
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


def _write_shock_system(phys: Dict[str, Any], run: Dict[str, Any], functions_block: str,
                        ref_length: float = 1.0) -> Dict[str, str]:
    """system/ for the density-based `shockFluid` module (supersonic / hypersonic).

    Runs in **local-time-stepping** mode (`ddtSchemes localEuler`): each cell
    marches at its own max-stable step, so a steady shock system converges in a
    few thousand pseudo-iterations instead of the millions of global Courant
    steps a fine boundary-layer mesh would otherwise force. Matches
    tutorials/shockFluid/biconic25-55Run35.
    """
    V = max(float(phys.get("inletVelocity", 340.0)), 1.0)
    L = ref_length if ref_length and ref_length > 0 else 1.0
    # LTS: endTime / deltaT is a pseudo-iteration budget, not a physical time.
    dt = 1e-4
    iters = int(run.get("iterations") or 6000)
    end = round(iters * dt, 6)
    frame_dt = max(dt, round(end / 40.0, 6))
    # Near Mach 1 the acoustic and convective speeds are close and the explicit
    # density solve is stiff - a low Courant limit keeps a shock from over/under-
    # shooting T into negative territory (-> sqrt FPE in fluxPredictor).
    max_co = float(run.get("maxCo") or 0.25)

    control = (
        "solver          shockFluid;\n"
        "application     rhoCentralFoam;\n"
        "startFrom       startTime;\nstartTime       0;\nstopAt          endTime;\n"
        f"endTime         {end};\ndeltaT          {dt};\n"
        f"writeControl    runTime;\nwriteInterval   {frame_dt};\n"
        "purgeWrite      0;\nwriteFormat     ascii;\nwritePrecision  8;\n"
        "writeCompression off;\ntimeFormat      general;\ntimePrecision   6;\nrunTimeModifiable true;\n"
        "adjustTimeStep  no;\n"
        + ("\n" + functions_block if functions_block else "")
    )
    schemes = (
        "fluxScheme      Kurganov;\n\n"
        "ddtSchemes\n{\n    default         localEuler;\n}\n\n"
        "gradSchemes\n{\n    default         Gauss linear;\n}\n\n"
        "divSchemes\n{\n    default         none;\n"
        "    div(tauMC)      Gauss linear;\n"
        "    div(phi,k)      Gauss upwind;\n"
        "    div(phi,omega)  Gauss upwind;\n}\n\n"
        "laplacianSchemes\n{\n    default         Gauss linear corrected;\n}\n\n"
        "interpolationSchemes\n{\n    default         linear;\n"
        # Minmod is the most dissipative TVD limiter - the robust choice for a
        # coarse mesh that cannot resolve the shock; vanLeer overshoots.
        "    reconstruct(rho) Minmod;\n    reconstruct(U)  MinmodV;\n"
        "    reconstruct(T)  Minmod;\n}\n\n"
        "snGradSchemes\n{\n    default         corrected;\n}\n\n"
        "wallDist\n{\n    method          meshWave;\n}\n"
    )
    solution_txt = (
        "solvers\n{\n"
        '    "rho.*"\n    {\n        solver          diagonal;\n    }\n'
        '    "U.*"\n    {\n        solver          smoothSolver;\n        smoother        GaussSeidel;\n'
        "        tolerance       1e-9;\n        relTol          0;\n    }\n"
        '    "(e|h).*"\n    {\n        $U;\n        tolerance       1e-10;\n    }\n'
        '    "(k|omega).*"\n    {\n        solver          smoothSolver;\n        smoother        symGaussSeidel;\n'
        "        tolerance       1e-9;\n        relTol          0;\n    }\n"
        "}\n\n"
        # LTS reads maxCo / maxDeltaT / rDeltaTSmoothingCoeff from here.
        "PIMPLE\n{\n"
        f"    maxCo           {max_co};\n"
        f"    maxDeltaT       {round(1.0 * L / V, 8)};\n"
        "    rDeltaTSmoothingCoeff 0.5;\n"
        "}\n"
    )
    return {
        "system/controlDict": foam_file("dictionary", "controlDict", control, "system"),
        "system/fvSchemes": foam_file("dictionary", "fvSchemes", schemes, "system"),
        "system/fvSolution": foam_file("dictionary", "fvSolution", solution_txt, "system"),
    }


def _relaxation(controls: Dict[str, Any], steady: bool, compressible: bool) -> str:
    r = controls.get("relax", {})
    if steady and compressible:
        # Density-coupled: pressure and rho need heavy under-relaxation, the
        # transported quantities can take more (matches the Foundation aerofoil
        # tutorial). Using the incompressible 0.7/0.3 split here diverges.
        p = r.get("p", 0.3)
        u = r.get("U", 0.7)
        t = r.get("k", 0.7)
    elif steady:
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
        f"        p               {p};",
    ]
    if compressible:
        lines.append(f"        rho             {r.get('rho', 0.01)};")
    lines += [
        "    }",
        "    equations\n    {",
        f"        U               {u};",
        f'        "(k|omega|epsilon|nuTilda)" {t};',
    ]
    if compressible:
        lines.append(f"        h               {r.get('h', r.get('e', 0.7))};")
    lines += ["    }", "}\n"]
    return "\n".join(lines)
