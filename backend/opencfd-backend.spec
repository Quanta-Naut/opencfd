# PyInstaller spec for the OpenCFD backend sidecar.
#   pyinstaller --noconfirm --clean backend/opencfd-backend.spec
# Produces dist/opencfd-backend[.exe] (onedir would be dist/opencfd-backend/).
#
# gmsh and shapely ship bundled native libraries; collect_all pulls the binaries
# and data files PyInstaller's static analysis misses. uvicorn resolves its loop
# and protocol backends by string at runtime, so those are listed by hand.

import os

from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []

# Pack coordinates baked by release.yml (optional for a local freeze).
_pack = os.path.join("app", "services", "setup", "pack.json")
if os.path.exists(_pack):
    datas.append((_pack, os.path.join("app", "services", "setup")))

for pkg in ("gmsh", "shapely", "ezdxf"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

hiddenimports += [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan.on",
    "websockets.legacy",
    "websockets.legacy.server",
    "anyio._backends._asyncio",
]

block_cipher = None

a = Analysis(
    ["run_server.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["vtk", "vtkmodules", "pyvista", "matplotlib", "scipy", "tkinter", "pytest"],
    cipher=block_cipher,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="opencfd-backend",
    console=True,
    disable_windowed_traceback=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    name="opencfd-backend",
)
