import os
import re
import asyncio
import math
from typing import Dict, Any, List, AsyncGenerator
import numpy as np


# case-file generation moved to app.services.foam

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
