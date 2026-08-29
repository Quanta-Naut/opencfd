"""Parse an OpenFOAM solver's stdout into the residual points the UI already
draws, and read force coefficients back from postProcessing/.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional

_TIME = re.compile(r"^Time = (\S+)")
_SOLVING = re.compile(
    r"Solving for (\w+), Initial residual = ([0-9eE.+\-]+), Final residual = ([0-9eE.+\-]+)"
)
_EXEC = re.compile(r"^ExecutionTime = ")
_CONVERGED = re.compile(r"solution converged|reached convergence criteria")

# OpenFOAM field name -> UI residual key
_FIELD_KEY = {
    "Ux": "Ux", "Uy": "Uy", "Uz": "Uz",
    "p": "p", "p_rgh": "p",
    "k": "k", "omega": "omega", "epsilon": "epsilon",
    "e": "e", "h": "h", "nuTilda": "nuTilda",
}


class ResidualStream:
    """Feed stdout lines in; get back a residual point per completed time step."""

    def __init__(self) -> None:
        self.iteration = 0
        self._pending: Dict[str, float] = {}
        self._time: Optional[str] = None
        self.converged = False

    def feed(self, line: str) -> Optional[Dict[str, float]]:
        m = _TIME.match(line)
        if m:
            self._time = m.group(1)
            self._pending = {}
            return None

        m = _SOLVING.search(line)
        if m:
            field, initial = m.group(1), m.group(2)
            key = _FIELD_KEY.get(field)
            if key and key not in self._pending:  # keep the first solve of each field
                try:
                    self._pending[key] = float(initial)
                except ValueError:
                    pass
            return None

        if _CONVERGED.search(line):
            self.converged = True

        if _EXEC.match(line) and self._pending:
            self.iteration += 1
            point = {"iteration": self.iteration, **self._pending}
            try:
                point["time"] = float(self._time) if self._time is not None else self.iteration
            except ValueError:
                point["time"] = self.iteration
            self._pending = {}
            return point
        return None


def _coeff_files(case_dir: Path) -> List[Path]:
    pp = case_dir / "postProcessing"
    if not pp.is_dir():
        return []
    hits: List[Path] = []
    for base in pp.glob("force*"):
        for name in ("coefficient.dat", "forceCoeffs.dat"):
            hits.extend(base.rglob(name))
    return hits


def read_force_coeffs(case_dir: str | Path) -> Optional[Dict[str, float]]:
    """Return {"cd": .., "cl": ..} from the newest forceCoeffs output, or None."""
    files = _coeff_files(Path(case_dir))
    if not files:
        return None
    path = max(files, key=lambda p: p.stat().st_mtime)
    header: List[str] = []
    last: Optional[str] = None
    for raw in path.read_text().splitlines():
        s = raw.strip()
        if not s:
            continue
        if s.startswith("#"):
            header = s.lstrip("#").split()
            continue
        last = s
    if not last:
        return None
    cols = last.split()
    names = header or ["Time", "Cd", "Cs", "Cl"]

    def pick(*cands: str) -> Optional[float]:
        for c in cands:
            if c in names:
                i = names.index(c)
                if i < len(cols):
                    try:
                        return float(cols[i])
                    except ValueError:
                        return None
        return None

    cd = pick("Cd", "Cd(f)")
    cl = pick("Cl", "Cl(f)")
    out: Dict[str, float] = {}
    if cd is not None:
        out["cd"] = round(cd, 6)
    if cl is not None:
        out["cl"] = round(cl, 6)
    return out or None
