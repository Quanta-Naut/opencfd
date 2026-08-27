import os
import re
import asyncio
import math
from typing import Dict, Any, List, AsyncGenerator
import numpy as np

def generate_openfoam_case_files(
    case_dir: str,
    physics: Dict[str, Any],
    boundaries: Dict[str, Any],
    solver_controls: Dict[str, Any]
) -> Dict[str, str]:
    """
    Generate standard OpenFOAM dictionary files (0/, constant/, system/).
    """
    os.makedirs(os.path.join(case_dir, "0"), exist_ok=True)
    os.makedirs(os.path.join(case_dir, "constant"), exist_ok=True)
    os.makedirs(os.path.join(case_dir, "system"), exist_ok=True)

    regime = physics.get("regime", "turbulent")
    turb_model = physics.get("turbulenceModel", "kOmegaSST")
    nu = physics.get("kinematicViscosity", 1.5e-5)
    solver = physics.get("solver", "simpleFoam")
    iterations = solver_controls.get("iterations", 200)

    inlet_u = float(boundaries.get("inletVelocity", 20.0))
    inlet_k = float(boundaries.get("inletK", 1.5))
    inlet_omega = float(boundaries.get("inletOmega", 50.0))
    inlet_eps = float(boundaries.get("inletEpsilon", 14.0))
    inlet_nut = float(boundaries.get("inletNut", 0.03))

    files = {}

    # 1. 0/U
    u_content = f"""/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2312                                 |
|   \\\\  /    A nd           | Website:  www.openfoam.com                      |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{{
    version     2.0;
    format      ascii;
    class       volVectorField;
    object      U;
}}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

dimensions      [0 1 -1 0 0 0 0];

internalField   uniform ({inlet_u} 0 0);

boundaryField
{{
    inlet
    {{
        type            fixedValue;
        value           uniform ({inlet_u} 0 0);
    }}

    outlet
    {{
        type            zeroGradient;
    }}

    airfoil
    {{
        type            noSlip;
    }}

    walls
    {{
        type            slip;
    }}

    frontAndBack
    {{
        type            empty;
    }}
}}
"""
    files["0/U"] = u_content

    # 2. 0/p
    p_content = f"""/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2312                                 |
|   \\\\  /    A nd           | Website:  www.openfoam.com                      |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      p;
}}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

dimensions      [0 2 -2 0 0 0 0];

internalField   uniform 0;

boundaryField
{{
    inlet
    {{
        type            zeroGradient;
    }}

    outlet
    {{
        type            fixedValue;
        value           uniform 0;
    }}

    airfoil
    {{
        type            zeroGradient;
    }}

    walls
    {{
        type            zeroGradient;
    }}

    frontAndBack
    {{
        type            empty;
    }}
}}
"""
    files["0/p"] = p_content

    # 3. 0/k & 0/omega if turbulent
    if regime == "turbulent":
        k_content = f"""/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      k;
}}
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform {inlet_k};
boundaryField
{{
    inlet
    {{
        type            fixedValue;
        value           uniform {inlet_k};
    }}
    outlet
    {{
        type            zeroGradient;
    }}
    airfoil
    {{
        type            kqRWallFunction;
        value           uniform {inlet_k};
    }}
    walls
    {{
        type            zeroGradient;
    }}
    frontAndBack
    {{
        type            empty;
    }}
}}
"""
        files["0/k"] = k_content

        omega_content = f"""/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      omega;
}}
dimensions      [0 0 -1 0 0 0 0];
internalField   uniform {inlet_omega};
boundaryField
{{
    inlet
    {{
        type            fixedValue;
        value           uniform {inlet_omega};
    }}
    outlet
    {{
        type            zeroGradient;
    }}
    airfoil
    {{
        type            omegaWallFunction;
        value           uniform {inlet_omega};
    }}
    walls
    {{
        type            zeroGradient;
    }}
    frontAndBack
    {{
        type            empty;
    }}
}}
"""
        files["0/omega"] = omega_content

    # 4. constant/transportProperties
    transport_content = f"""/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    location    "constant";
    object      transportProperties;
}}
transportModel  Newtonian;
nu              [0 2 -1 0 0 0 0] {nu};
"""
    files["constant/transportProperties"] = transport_content

    # 5. constant/momentumTransport
    momentum_content = f"""/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    location    "constant";
    object      momentumTransport;
}}
simulationType  RAS;

RAS
{{
    model           {turb_model if regime == 'turbulent' else 'laminar'};
    turbulence      {'on' if regime == 'turbulent' else 'off'};
    printCoeffs     on;
}}
"""
    files["constant/momentumTransport"] = momentum_content

    # 6. system/controlDict
    control_content = f"""/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    location    "system";
    object      controlDict;
}}
application     {solver};
startFrom       startTime;
startTime       0;
stopAt          endTime;
endTime         {iterations};
deltaT          1;
writeControl    timeStep;
writeInterval   {max(1, iterations // 5)};
purgeWrite      0;
writeFormat     ascii;
writePrecision  6;
writeCompression off;
timeFormat      general;
timePrecision   6;
runTimeModifiable true;
"""
    files["system/controlDict"] = control_content

    # 7. system/fvSchemes
    schemes_content = """/*--------------------------------*- C++ -*----------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    location    "system";
    object      fvSchemes;
}
ddtSchemes
{
    default         steadyState;
}
gradSchemes
{
    default         Gauss linear;
}
divSchemes
{
    default         none;
    div(phi,U)      bounded Gauss linearUpwind grad(U);
    div(phi,k)      bounded Gauss upwind;
    div(phi,omega)  bounded Gauss upwind;
    div(phi,epsilon) bounded Gauss upwind;
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes
{
    default         Gauss linear corrected;
}
interpolationSchemes
{
    default         linear;
}
snGradSchemes
{
    default         corrected;
}
"""
    files["system/fvSchemes"] = schemes_content

    # 8. system/fvSolution
    solution_content = """/*--------------------------------*- C++ -*----------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    location    "system";
    object      fvSolution;
}
solvers
{
    p
    {
        solver          GAMG;
        tolerance       1e-06;
        relTol          0.1;
        smoother        GaussSeidel;
    }
    U
    {
        solver          smoothSolver;
        smoother        symGaussSeidel;
        tolerance       1e-06;
        relTol          0.1;
    }
    k
    {
        solver          smoothSolver;
        smoother        symGaussSeidel;
        tolerance       1e-06;
        relTol          0.1;
    }
    omega
    {
        solver          smoothSolver;
        smoother        symGaussSeidel;
        tolerance       1e-06;
        relTol          0.1;
    }
}
SIMPLE
{
    nNonOrthogonalCorrectors 0;
    consistent      yes;
    residualControl
    {
        p               1e-4;
        U               1e-4;
        k               1e-4;
        omega           1e-4;
    }
}
relaxationFactors
{
    fields
    {
        p               0.3;
    }
    equations
    {
        U               0.7;
        k               0.7;
        omega           0.7;
    }
}
"""
    files["system/fvSolution"] = solution_content

    # Write each file to disk
    for rel_path, content in files.items():
        full_path = os.path.join(case_dir, rel_path)
        with open(full_path, "w") as f:
            f.write(content)

    return files

async def simulate_cfd_run(
    iterations: int = 150,
    regime: str = "turbulent",
    velocity: float = 20.0
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Simulates solver execution, streaming real-time OpenFOAM log output
    and residual convergence data points to the frontend WebSocket.
    """
    yield {
        "type": "log",
        "line": "/*---------------------------------------------------------------------------*\\"
    }
    yield {
        "type": "log",
        "line": f"| OpenCFD Solver Engine :: Executing simpleFoam ({regime.upper()})            |"
    }
    yield {
        "type": "log",
        "line": "\\*---------------------------------------------------------------------------*/"
    }
    yield {
        "type": "log",
        "line": f"Create time, Create mesh for time = 0, Reading field p, Reading field U"
    }
    if regime == "turbulent":
        yield {
            "type": "log",
            "line": f"Selecting incompressible transport model Newtonian, Selecting turbulence model kOmegaSST"
        }

    # Initial residual values
    res_p = 1.0
    res_ux = 1.0
    res_uy = 1.0
    res_k = 1.0 if regime == "turbulent" else None
    res_omega = 1.0 if regime == "turbulent" else None

    for i in range(1, iterations + 1):
        await asyncio.sleep(0.04) # smooth streaming delay
        decay = math.exp(-i / (iterations * 0.35)) + 0.05 * math.sin(i * 0.4)
        noise = (np.random.random() - 0.5) * 0.15 * decay

        res_p = max(1e-6, 0.8 * decay * (1.0 + noise))
        res_ux = max(1e-6, 0.6 * decay * (1.0 + noise))
        res_uy = max(1e-6, 0.5 * decay * (1.0 + noise))
        
        log_line = f"Time = {i}: GAMG: Solving for p, Initial residual = {res_p:.6e}, Final residual = {res_p*0.08:.6e}, No Iterations 3"
        yield {
            "type": "log",
            "line": log_line
        }

        res_point = {
            "iteration": i,
            "p": res_p,
            "Ux": res_ux,
            "Uy": res_uy
        }

        if regime == "turbulent":
            res_k = max(1e-6, 0.7 * decay * (1.0 + noise))
            res_omega = max(1e-6, 0.9 * decay * (1.0 + noise))
            res_point["k"] = res_k
            res_point["omega"] = res_omega
            yield {
                "type": "log",
                "line": f"smoothSolver: Solving for k, Initial residual = {res_k:.6e} | omega, Initial residual = {res_omega:.6e}"
            }

        yield {
            "type": "residual",
            "data": res_point
        }

    yield {
        "type": "log",
        "line": f"SIMPLE solution converged in {iterations} iterations! Execution complete."
    }
    yield {
        "type": "status",
        "status": "completed"
    }
