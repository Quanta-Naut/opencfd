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

# OpenFOAM prints its own errors as a "--> FOAM FATAL ERROR:" banner followed
# by a free-text message, then a blank line and (usually) "From function ...".
# A hard crash instead (SIGFPE from an unbounded field, SIGSEGV) never prints
# that banner - only the OS/shell's own one-line signal message survives.
_FATAL_HEADER = re.compile(r"-->\s*FOAM FATAL(?: IO)? ERROR", re.IGNORECASE)
_FATAL_END = re.compile(r"^\s*From\s+function|^\s*$")
_CRASH_SIGNAL = re.compile(
    r"floating point exception|segmentation fault|bus error", re.IGNORECASE
)

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
        self.fatal_error: Optional[str] = None
        self._capturing_fatal = False
        self._fatal_lines: List[str] = []

    def feed(self, line: str) -> Optional[Dict[str, float]]:
        if self.fatal_error is None:
            if self._capturing_fatal:
                if _FATAL_END.match(line):
                    self.fatal_error = " ".join(self._fatal_lines) or "FOAM FATAL ERROR"
                    self._capturing_fatal = False
                    return None
                # Under `mpirun -np N`, another rank's own output can interleave
                # mid-capture (no terminator ever arrives from THIS rank's own
                # banner before a "Time = ..." / residual line from a different
                # rank shows up on the same stdout pipe). Treat either as the
                # end of the fatal block instead of swallowing it into the
                # message, and let it fall through to the normal parsing below.
                if _TIME.match(line) or _SOLVING.search(line):
                    self.fatal_error = " ".join(self._fatal_lines) or "FOAM FATAL ERROR"
                    self._capturing_fatal = False
                else:
                    self._fatal_lines.append(line.strip())
                    return None
            if _FATAL_HEADER.search(line):
                self._capturing_fatal = True
                self._fatal_lines = []
                return None
            if _CRASH_SIGNAL.search(line):
                self.fatal_error = line.strip()

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
    for raw in path.read_text(encoding='utf-8', errors='ignore').splitlines():
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
