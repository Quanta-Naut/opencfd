"""functionObjects: force coefficients, surface reports, point probes.
Returned as a ``functions { ... }`` block appended to controlDict."""
from typing import Any, Dict, List


def _vec(v) -> str:
    v = list(v or [0, 0, 0])
    while len(v) < 3:
        v.append(0)
    return f"({v[0]} {v[1]} {v[2]})"


def build_functions(
    solution: Dict[str, Any],
    phys: Dict[str, Any],
    wall_patches: List[str],
    ref_length: float,
) -> str:
    mon = (solution or {}).get("monitors", {})
    blocks: List[str] = []

    forces = mon.get("forces", {})
    if forces.get("enabled") and wall_patches:
        patch = forces.get("bodyPatch") or wall_patches[0]
        U = float(phys.get("inletVelocity", 20.0))
        rho = float(phys.get("density", 1.225))
        L = forces.get("refLength") or ref_length or 1.0
        A = forces.get("refArea") or (L * 0.1)  # 2D: nominal span = 0.1 m
        compressible = phys.get("compressibility") == "compressible"
        # Incompressible: pressure is kinematic, so `rho rhoInf` tells libforces to
        # multiply by rhoInf. Compressible: pressure is in Pa and libforces reads
        # the `rho` field itself - no `rho` keyword - but `rhoInf` is still needed
        # as the far-field density in the Cd/Cl denominator (0.5 rhoInf U^2 Aref).
        blocks.append(
            "    forceCoeffs\n    {\n"
            "        type            forceCoeffs;\n"
            "        libs            (\"libforces.so\");\n"
            "        writeControl    timeStep;\n        writeInterval   1;\n"
            f"        patches         ({patch});\n"
            + ("" if compressible else "        rho             rhoInf;\n")
            + f"        rhoInf          {rho};\n"
            + f"        liftDir         {_vec(forces.get('liftDir', [0, 1, 0]))};\n"
            f"        dragDir         {_vec(forces.get('dragDir', [1, 0, 0]))};\n"
            f"        CofR            {_vec(forces.get('centreOfRotation', [0.25, 0, 0]))};\n"
            "        pitchAxis       (0 0 1);\n"
            f"        magUInf         {U};\n"
            f"        lRef            {L};\n        Aref            {A};\n"
            "    }"
        )

    for i, s in enumerate(mon.get("surfaces", []) or []):
        op = {"massFlow": "sumDirection", "areaAverage": "weightedAreaAverage",
              "areaIntegral": "areaIntegrate"}.get(s.get("quantity", "areaAverage"), "weightedAreaAverage")
        fld = s.get("field", "p")
        blocks.append(
            f"    surface{i}\n    {{\n"
            "        type            surfaceFieldValue;\n        libs            (\"libfieldFunctionObjects.so\");\n"
            "        writeControl    timeStep;\n        writeInterval   1;\n"
            "        regionType      patch;\n"
            f"        name            {s.get('patch', 'outlet')};\n"
            f"        operation       {op};\n"
            f"        fields          ({'phi' if s.get('quantity') == 'massFlow' else fld});\n"
            "    }"
        )

    probes = mon.get("probes", []) or []
    if probes:
        pts = " ".join(f"({p.get('x', 0)} {p.get('y', 0)} 0)" for p in probes)
        blocks.append(
            "    probes\n    {\n"
            "        type            probes;\n        libs            (\"libsampling.so\");\n"
            "        writeControl    timeStep;\n        writeInterval   1;\n"
            f"        probeLocations  ( {pts} );\n"
            "        fields          (p U);\n"
            "    }"
        )

    # No solverInfo functionObject: it is ESI-only (Foundation 13 rejects it),
    # and residuals are parsed straight from the solver's stdout anyway.

    if not blocks:
        return ""
    return "functions\n{\n" + "\n\n".join(blocks) + "\n}\n"
