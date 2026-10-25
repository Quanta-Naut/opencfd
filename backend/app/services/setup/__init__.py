"""One-time solver provisioning for Windows.

Goal: the user enables WSL2, runs the OpenCFD installer as administrator, and
never touches a shell. On first launch the app checks `setup_status()`; if the
solver distro is missing it streams `provision()` behind a progress screen.

`provision()` imports a private WSL2 distro named `OpenCFD-FOAM` from a rootfs
tarball (minimal Ubuntu + a prebuilt trimmed OpenFOAM, produced in CI). Nothing
here touches the user's own distros, and `teardown()` removes it cleanly.

On Linux/macOS OpenFOAM runs natively. If none is found, `setup_status()` says so
and, on x86_64 Ubuntu-family systems, `provision()` installs the OpenFOAM
Foundation's official apt package behind the system's administrator prompt
(pkexec). Anywhere else the app shows how to install it by hand.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import platform
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List

from app.services.wsl import list_distros as wsl_list_distros
from app.services.wsl import wsl_exe, wsl_present

DISTRO_NAME = "OpenCFD-FOAM"
STATE_DIR = Path.home() / ".OpenCFD"
WSL_DIR = STATE_DIR / "wsl"
MARKER = STATE_DIR / "solver-setup.json"

# Pack coordinates. The env vars win (handy for local testing); otherwise a
# `pack.json` written next to this module at build time (see release.yml). Until
# CI publishes a pack all three stay empty and provisioning reports
# "pack not configured" instead of failing mid-download.
def _pack_config() -> Dict[str, str]:
    cfg = {
        "url": os.environ.get("OPENCFD_FOAM_PACK_URL", ""),
        "sha256": os.environ.get("OPENCFD_FOAM_PACK_SHA256", ""),
        "version": os.environ.get("OPENCFD_FOAM_PACK_VERSION", ""),
    }
    if not cfg["url"]:
        try:
            data = json.loads((Path(__file__).with_name("pack.json")).read_text())
            cfg = {
                "url": data.get("url", ""),
                "sha256": data.get("sha256", ""),
                "version": str(data.get("version", "")),
            }
        except Exception:  # noqa: BLE001
            pass
    return cfg


_PACK = _pack_config()
PACK_URL = _PACK["url"]
PACK_SHA256 = _PACK["sha256"]
PACK_VERSION = _PACK["version"] or "dev"

_IS_WINDOWS = os.name == "nt"


def _wsl(*args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    # wsl.exe's own messages are UTF-16LE, while output from inside the distro is
    # UTF-8. Decode by hand so neither can raise on a stray byte.
    p = subprocess.run([wsl_exe() or "wsl.exe", *args], capture_output=True, timeout=timeout)
    p.stdout = _decode_out(p.stdout)
    p.stderr = _decode_out(p.stderr)
    return p


def _decode_out(raw: bytes | None) -> str:
    if not raw:
        return ""
    if len(raw) >= 2 and raw[1:2] == b"\x00":  # UTF-16LE: ASCII text has NUL high bytes
        return raw.decode("utf-16-le", errors="ignore")
    return raw.decode("utf-8", errors="ignore")


def _clean(text: str) -> str:
    return text.replace("\x00", "")


def wsl_status() -> Dict[str, Any]:
    if not _IS_WINDOWS:
        return {"installed": False, "version2": False, "distros": [], "detail": "not Windows"}
    if not wsl_present():
        return {
            "installed": False,
            "version2": False,
            "distros": [],
            "detail": "WSL is not installed. Run `wsl --install`, reboot, then reopen OpenCFD.",
        }
    distros, any_v2 = wsl_list_distros()
    # An empty list is normal - the app imports its own distro. WSL2 infra being
    # present is what matters here.
    return {
        "installed": True,
        "version2": any_v2 or True,
        "distros": distros,
        "detail": "WSL2 ready",
    }


def _distro_has_openfoam() -> bool:
    if not _IS_WINDOWS:
        return False
    try:
        probe = _wsl(
            "-d", DISTRO_NAME, "--",
            "bash", "-lc",
            'for _f in /opt/openfoam*/etc/bashrc /usr/lib/openfoam/openfoam*/etc/bashrc; do '
            '[ -r "$_f" ] && . "$_f" && break; done; command -v simpleFoam >/dev/null && echo ok',
            timeout=45,
        )
        return "ok" in (probe.stdout or "")
    except Exception:  # noqa: BLE001
        return False


def _read_marker() -> Dict[str, Any]:
    try:
        return json.loads(MARKER.read_text())
    except Exception:  # noqa: BLE001
        return {}


# --- Linux / macOS: native OpenFOAM --------------------------------------------

# Run as root through pkexec, as one argument (no file on disk a user process
# could swap). Mirrors https://openfoam.org/download/13-ubuntu/.
_APT_SCRIPT = r"""
set -e
export DEBIAN_FRONTEND=noninteractive
echo "STEP prepare"
command -v wget >/dev/null 2>&1 || apt-get install -y wget
command -v add-apt-repository >/dev/null 2>&1 || apt-get install -y software-properties-common
echo "STEP key"
wget -qO /etc/apt/trusted.gpg.d/openfoam.asc https://dl.openfoam.org/gpg.key
rm -f /etc/apt/sources.list.d/*dl_openfoam_org*list
add-apt-repository -y "http://dl.openfoam.org/ubuntu main dev"
if grep -q '^VERSION_ID="26' /etc/os-release; then
  sed -i "s/^\(deb\).*\(http\)/\1 [arch=amd64] \2/" /etc/apt/sources.list.d/*dl_openfoam_org*list
fi
echo "STEP update"
apt-get update
echo "STEP install"
apt-get -y install openfoam13
echo "STEP done"
"""

APT_COMMANDS = [
    'sudo sh -c "wget -O - https://dl.openfoam.org/gpg.key > /etc/apt/trusted.gpg.d/openfoam.asc"',
    'sudo add-apt-repository "http://dl.openfoam.org/ubuntu main dev"',
    "sudo apt update",
    "sudo apt -y install openfoam13",
]

_STEPS = {  # marker -> (progress, message)
    "prepare": (0.05, "Preparing"),
    "key": (0.12, "Adding the OpenFOAM repository"),
    "update": (0.2, "Refreshing the package list"),
    "install": (0.3, "Downloading and installing OpenFOAM (this is the long step)"),
    "done": (0.95, "Verifying the solver"),
}


def _os_release() -> Dict[str, str]:
    out: Dict[str, str] = {}
    try:
        for line in Path("/etc/os-release").read_text().splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                out[k] = v.strip().strip('"')
    except OSError:
        pass
    return out


def native_install_kind() -> str:
    """'apt' when we can install OpenFOAM ourselves, else 'manual'."""
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "AMD64"):
        return "manual"
    rel = _os_release()
    family = f"{rel.get('ID', '')} {rel.get('ID_LIKE', '')}".split()
    if "ubuntu" not in family:
        return "manual"
    if not (shutil.which("pkexec") and shutil.which("apt-get")):
        return "manual"
    return "apt"


def _native_openfoam_ok() -> bool:
    from app.services.solver import detect_environment

    return bool(detect_environment().get("adapters", {}).get("openfoam-local", {}).get("ok"))


def setup_status() -> Dict[str, Any]:
    system = platform.system()
    if not _IS_WINDOWS:
        if _native_openfoam_ok():
            return {
                "os": system,
                "needs_provision": False,
                "distro_ready": False,
                "pack_configured": bool(PACK_URL),
                "detail": "OpenFOAM found.",
            }
        kind = native_install_kind()
        return {
            "os": system,
            "native": True,
            "needs_provision": True,
            "install_kind": kind,
            "commands": APT_COMMANDS if kind == "apt" or system == "Linux" else [],
            "distro_ready": False,
            "pack_configured": True,
            "detail": "OpenFOAM was not found on this computer.",
        }

    wsl = wsl_status()
    marker = _read_marker()
    distro_present = DISTRO_NAME in wsl.get("distros", [])
    ready = distro_present and _distro_has_openfoam()
    out_of_date = bool(marker) and marker.get("pack_version") != PACK_VERSION

    return {
        "os": system,
        "wsl": wsl,
        "distro": DISTRO_NAME,
        "distro_ready": ready,
        "pack_configured": bool(PACK_URL),
        "pack_version": PACK_VERSION,
        "installed_version": marker.get("pack_version"),
        "out_of_date": out_of_date,
        "needs_provision": (not ready or out_of_date),
        "detail": (
            "Solver ready." if ready and not out_of_date
            else "A newer solver pack is available." if out_of_date
            else wsl.get("detail", "") if not wsl.get("installed")
            else "The OpenFOAM solver environment needs to be set up (one time)."
        ),
    }


def _ev(step: str, message: str, progress: float | None = None, **extra: Any) -> Dict[str, Any]:
    e = {"type": "progress", "step": step, "message": message}
    if progress is not None:
        e["progress"] = round(progress, 3)
    e.update(extra)
    return e


async def _download(url: str, dest: Path) -> AsyncGenerator[Dict[str, Any], None]:
    import urllib.request

    dest.parent.mkdir(parents=True, exist_ok=True)
    loop = asyncio.get_event_loop()

    def _open():
        return urllib.request.urlopen(url, timeout=60)  # noqa: S310

    resp = await loop.run_in_executor(None, _open)
    total = int(resp.headers.get("Content-Length", 0))
    got = 0
    sha = hashlib.sha256()
    with open(dest, "wb") as fh:
        while True:
            chunk = await loop.run_in_executor(None, resp.read, 1 << 20)
            if not chunk:
                break
            fh.write(chunk)
            sha.update(chunk)
            got += len(chunk)
            frac = got / total if total else 0.0
            yield _ev("download", f"Downloading solver pack ({got // (1 << 20)} MB)", 0.1 + 0.5 * frac)
    yield _ev("download", "Download complete", 0.6, sha256=sha.hexdigest())


async def _provision_apt() -> AsyncGenerator[Dict[str, Any], None]:
    if native_install_kind() != "apt":
        yield {"type": "error", "message": "Automatic install is not available on this system."}
        return
    yield _ev("prepare", "Waiting for your administrator password", 0.02)
    proc = await asyncio.create_subprocess_exec(
        "pkexec", "sh", "-c", _APT_SCRIPT,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    assert proc.stdout is not None
    tail: List[str] = []
    async for raw in proc.stdout:
        line = raw.decode(errors="replace").rstrip()
        if not line:
            continue
        if line.startswith("STEP "):
            frac, msg = _STEPS.get(line[5:].strip(), (None, line))
            yield _ev(line[5:].strip(), msg, frac)
            continue
        tail.append(line)
        del tail[:-12]
        if "Get:" in line or "Unpacking" in line or "Setting up" in line:
            yield _ev("install", line[:90], None)
    rc = await proc.wait()
    if rc in (126, 127):
        yield {"type": "error", "message": "The administrator prompt was cancelled or is not available."}
        return
    if rc != 0:
        yield {"type": "error", "message": "The install failed: " + " | ".join(tail[-4:])}
        return
    if not await asyncio.get_event_loop().run_in_executor(None, _native_openfoam_ok):
        yield {"type": "error", "message": "OpenFOAM installed but OpenCFD could not run it."}
        return
    yield _ev("done", "OpenFOAM is ready", 1.0)
    yield {"type": "done", "message": "OpenFOAM is ready."}


async def provision() -> AsyncGenerator[Dict[str, Any], None]:
    if not _IS_WINDOWS:
        async for e in _provision_apt():
            yield e
        return
    if not PACK_URL:
        yield {"type": "error", "message": "No solver pack is configured for this build yet."}
        return

    wsl = wsl_status()
    if not wsl["installed"]:
        yield {"type": "error", "message": wsl["detail"]}
        return

    # Best-effort: `wsl --update` needs admin and is only needed if the WSL2
    # kernel is stale. If WSL2 already works this is a no-op; skip it silently.
    yield _ev("wsl", "Checking WSL", 0.03)
    try:
        await asyncio.get_event_loop().run_in_executor(None, lambda: _wsl("--update", timeout=180))
        await asyncio.get_event_loop().run_in_executor(None, lambda: _wsl("--set-default-version", "2", timeout=30))
    except Exception:  # noqa: BLE001
        pass

    pack = WSL_DIR / "pack.tar.gz"  # gzip; `wsl --import` reads it directly
    sha_seen = ""
    try:
        async for e in _download(PACK_URL, pack):
            if e.get("sha256"):
                sha_seen = e["sha256"]
            yield e
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "message": f"Download failed: {e}"}
        return

    if PACK_SHA256 and sha_seen and sha_seen.lower() != PACK_SHA256.lower():
        yield {"type": "error", "message": "Solver pack checksum mismatch - aborting."}
        return

    if DISTRO_NAME in wsl_status().get("distros", []):
        yield _ev("import", "Removing the previous solver distro", 0.62)
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: _wsl("--unregister", DISTRO_NAME, timeout=120)
        )

    target = WSL_DIR / "rootfs"
    target.mkdir(parents=True, exist_ok=True)
    yield _ev("import", "Importing the OpenFOAM distro into WSL", 0.7)
    imp = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: _wsl("--import", DISTRO_NAME, str(target), str(pack), "--version", "2", timeout=600),
    )
    if imp.returncode != 0:
        err = _clean(imp.stderr).strip() or _clean(imp.stdout).strip()
        if "kernel" in err.lower() or "wsl 2 requires" in err.lower():
            err = ("The WSL2 kernel needs updating. Open an administrator PowerShell, "
                   "run `wsl --update`, then click Try again.")
        yield {"type": "error", "message": f"Could not import the solver distro: {err}"}
        return

    yield _ev("verify", "Verifying the solver", 0.92)
    if not _distro_has_openfoam():
        yield {"type": "error", "message": "Imported the distro but simpleFoam did not run."}
        return

    try:
        pack.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass

    MARKER.parent.mkdir(parents=True, exist_ok=True)
    MARKER.write_text(json.dumps({
        "distro": DISTRO_NAME,
        "pack_version": PACK_VERSION,
        "installed_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }, indent=2))
    yield _ev("done", "Solver environment ready", 1.0)
    yield {"type": "done", "message": "Solver environment ready."}


def teardown() -> Dict[str, Any]:
    if _IS_WINDOWS and DISTRO_NAME in wsl_status().get("distros", []):
        _wsl("--unregister", DISTRO_NAME, timeout=120)
    MARKER.unlink(missing_ok=True)
    shutil.rmtree(WSL_DIR, ignore_errors=True)
    return {"ok": True}


__all__ = ["setup_status", "provision", "teardown", "wsl_status", "DISTRO_NAME"]
