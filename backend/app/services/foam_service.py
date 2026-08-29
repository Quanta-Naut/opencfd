import asyncio
import math
from typing import Any, AsyncGenerator, Dict

import numpy as np

# Real case-file generation lives in app.services.foam. Until OpenFOAM is wired
# in, this streams a physically-informed mock: the residual decay rate follows
# the Reynolds number, relaxation and scheme order; the cost follows the cell
# count; force coefficients settle onto a plausible value.


def _decay_rate(reynolds: float, relax_u: float, momentum_order: str) -> float:
    """Iterations to drop one order of magnitude (loosely)."""
    base = 60.0 + 25.0 * math.log10(max(reynolds, 1e2) / 1e5 + 1.0)
    base *= 1.0 + (0.7 - min(relax_u, 0.95)) * 2.0        # low relaxation -> slower
    if momentum_order in ("secondOrder", "central"):
        base *= 1.35                                      # 2nd order converges slower
    return max(base, 20.0)


def _target_cd(reynolds: float, turbulent: bool) -> float:
    if not turbulent:
        return 1.2 + 8.0 / max(math.sqrt(reynolds), 1.0)  # Stokes-ish
    return 0.02 + 1.0 / max(math.log10(max(reynolds, 1e3)), 1.0)


async def simulate_cfd_run(
    iterations: int = 1000,
    regime: str = "turbulent",
    velocity: float = 20.0,
    reynolds: float = 1.0e6,
    cells: int = 20000,
    relax: Dict[str, float] | None = None,
    momentumOrder: str = "secondOrder",
    turbulenceModel: str = "kOmegaSST",
    forces: bool = True,
    init: str = "uniform",
) -> AsyncGenerator[Dict[str, Any], None]:
    relax = relax or {"U": 0.7, "p": 0.3}
    turbulent = regime == "turbulent"
    tau = _decay_rate(reynolds, relax.get("U", 0.7), momentumOrder)
    per_iter = min(0.05, max(0.004, cells / 4_000_000))   # streaming pace scales with cost

    yield {"type": "log", "line": "/*---------------------------------------------------------------------------*\\"}
    yield {"type": "log", "line": f"| OpenCFD solver (mock)  Re={reynolds:.2e}  cells={cells}  model={turbulenceModel} |"}
    yield {"type": "log", "line": "\\*---------------------------------------------------------------------------*/"}
    if init == "potentialFlow":
        yield {"type": "log", "line": "potentialFoam: initialised velocity from the potential-flow solution"}
    yield {"type": "log", "line": "Create mesh, Reading field p, Reading field U"}
    if turbulent:
        yield {"type": "log", "line": f"Selecting turbulence model {turbulenceModel}"}

    cd = _target_cd(reynolds, turbulent) * 3.0            # starts high, relaxes down
    cl = 0.0
    start_res = 0.4 if init == "potentialFlow" else 1.0

    for i in range(1, iterations + 1):
        await asyncio.sleep(per_iter)
        env = start_res * math.exp(-i / tau)
        wobble = 1.0 + 0.12 * env * math.sin(i * 0.35) + (np.random.random() - 0.5) * 0.06 * env
        res_p = max(1e-8, 0.8 * env * wobble)
        res_ux = max(1e-8, 0.55 * env * wobble)
        res_uy = max(1e-8, 0.45 * env * wobble)
        point: Dict[str, Any] = {"iteration": i, "p": res_p, "Ux": res_ux, "Uy": res_uy}

        if turbulent:
            point["k"] = max(1e-8, 0.6 * env * wobble)
            if "Epsilon" in turbulenceModel or "KE" in turbulenceModel or "kEpsilon" in turbulenceModel:
                point["epsilon"] = max(1e-8, 0.7 * env * wobble)
            else:
                point["omega"] = max(1e-8, 0.85 * env * wobble)

        if forces:
            target = _target_cd(reynolds, turbulent)
            cd += (target - cd) * (1.0 - math.exp(-1.0 / tau)) * 3.0
            cd += (np.random.random() - 0.5) * 0.02 * env
            cl += (0.0 - cl) * 0.02 + (np.random.random() - 0.5) * 0.01 * env
            point["cd"] = round(cd, 5)
            point["cl"] = round(cl, 5)

        if i % max(1, iterations // 40) == 0 or i < 5:
            yield {"type": "log",
                   "line": f"Time = {i}  p res {res_p:.3e}  U res {max(res_ux, res_uy):.3e}"
                           + (f"  Cd {cd:.4f}  Cl {cl:.4f}" if forces else "")}
        yield {"type": "residual", "data": point}

        if env < 2e-6 and i > 30:
            yield {"type": "log", "line": f"SIMPLE solution converged (tol reached) after {i} iterations"}
            yield {"type": "status", "status": "completed", "iterations": i}
            return

    yield {"type": "log", "line": f"Run finished at {iterations} iterations (residual {res_p:.2e})"}
    yield {"type": "status", "status": "completed", "iterations": iterations}
