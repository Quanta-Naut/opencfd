"""Read a finished OpenFOAM case back into the field shape the viewer expects.

simpleFoam writes cell-centred fields as ASCII lists under `<time>/`. We also ask
`postProcess -func writeCellCentres` for the cell centres (`Cx`, `Cy`), then map
each cell value onto the nearest 2D viewer node. Nearest-cell is good enough for
a plane visualisation at these resolutions.

Output matches services.postprocess_service.generate_field_solution:
    {"fields": {"U_mag": [...per node...], "p": [...], "k": [...],
                "omega": [...], "vorticity": [...]},
     "ranges": {...}, "streamlines": [...]}
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

_NONUNIFORM = re.compile(r"internalField\s+nonuniform\s+List<(scalar|vector)>\s*\n?\s*(\d+)\s*\(", re.S)
_UNIFORM = re.compile(r"internalField\s+uniform\s+(\([^)]*\)|\S+)\s*;", re.S)


def _matching_paren(text: str, open_idx: int) -> int:
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i
    return len(text)


def _read_field(path: Path) -> Optional[np.ndarray]:
    """Return an (N,) scalar or (N,3) vector array from an OpenFOAM field file."""
    if not path.is_file():
        return None
    text = path.read_text()

    m = _NONUNIFORM.search(text)
    if m:
        kind, n = m.group(1), int(m.group(2))
        open_idx = m.end() - 1  # the '(' captured at the end of the regex
        close = _matching_paren(text, open_idx)
        chunk = text[open_idx + 1:close]
        nums = np.fromstring(chunk.replace("(", " ").replace(")", " "), sep=" ")
        if kind == "vector":
            return nums.reshape(-1, 3)[:n]
        return nums[:n]

    u = _UNIFORM.search(text)
    if u:
        val = u.group(1).strip("() ").split()
        arr = np.array([float(v) for v in val], dtype=float)
        return arr if arr.size != 1 else np.full(1, arr[0])
    return None


def _time_dirs(case: Path) -> List[tuple[float, Path]]:
    times = []
    for p in case.iterdir():
        if p.is_dir():
            try:
                times.append((float(p.name), p))
            except ValueError:
                pass
    times.sort(key=lambda t: t[0])
    return times


def _latest_time_dir(case: Path) -> Optional[Path]:
    times = _time_dirs(case)
    if not times:
        return None
    # skip 0/ if there is a later result
    latest = times[-1]
    return latest[1] if latest[0] > 0 or len(times) == 1 else None


class ResultsUnavailable(Exception):
    pass


def _nearest(pts: np.ndarray, ref: np.ndarray, chunk: int = 4096) -> np.ndarray:
    """Index of the nearest row of `ref` for each row of `pts`."""
    out = np.empty(len(pts), dtype=int)
    for s in range(0, len(pts), chunk):
        block = pts[s:s + chunk]
        d = ((block[:, None, :] - ref[None, :, :]) ** 2).sum(axis=2)
        out[s:s + chunk] = d.argmin(axis=1)
    return out


def _cell_centres(tdir: Path, mesh: Dict, n_cells: int) -> np.ndarray:
    """Cell centres: from Cx/Cy (ESI) or Ccx/Ccy (Foundation) if postProcess ran,
    or reconstructed from constant/polyMesh geometry, otherwise the mesh element centroids."""
    cx = _read_field(tdir / "Cx") if (tdir / "Cx").is_file() else _read_field(tdir / "Ccx")
    cy = _read_field(tdir / "Cy") if (tdir / "Cy").is_file() else _read_field(tdir / "Ccy")
    if cx is not None and cy is not None:
        return np.column_stack([np.asarray(cx).ravel(), np.asarray(cy).ravel()])

    # Try polyMesh reconstruction from constant/polyMesh
    case_dir = tdir.parent
    poly_pts_f = case_dir / "constant" / "polyMesh" / "points"
    poly_faces_f = case_dir / "constant" / "polyMesh" / "faces"
    poly_owner_f = case_dir / "constant" / "polyMesh" / "owner"

    if poly_pts_f.is_file() and poly_faces_f.is_file() and poly_owner_f.is_file():
        try:
            owner_text = poly_owner_f.read_text()
            m_owner = re.search(r'\n(\d+)\s*\n\(', owner_text)
            if m_owner:
                owner = np.fromstring(owner_text[m_owner.end():owner_text.rfind(')')], dtype=int, sep='\n')
                pts_text = poly_pts_f.read_text()
                m_pts = re.search(r'\n(\d+)\s*\n\(', pts_text)
                if m_pts:
                    pts = np.fromstring(pts_text[m_pts.end():pts_text.rfind(')')].replace('(', ' ').replace(')', ' '), sep=' ').reshape(-1, 3)
                    faces_text = poly_faces_f.read_text()
                    face_lines = re.findall(r'\((\d+(?:\s+\d+)+)\)', faces_text[faces_text.find('(')+1:faces_text.rfind(')')])
                    face_nodes = [[int(x) for x in l.split()] for l in face_lines]
                    face_centres = np.array([pts[fn].mean(axis=0) for fn in face_nodes])
                    num_c = int(owner.max()) + 1
                    cell_centres = np.zeros((num_c, 2))
                    cell_counts = np.zeros(num_c)
                    for f_idx, cell_idx in enumerate(owner):
                        cell_centres[cell_idx] += face_centres[f_idx][:2]
                        cell_counts[cell_idx] += 1
                    cell_centres /= np.maximum(cell_counts[:, None], 1)
                    if len(cell_centres) == n_cells:
                        return cell_centres
        except Exception:
            pass

    nodes = np.asarray(mesh.get("nodes") or [], dtype=float)
    elements = mesh.get("elements") or []
    if len(elements) == n_cells and nodes.size:
        return np.array([nodes[[int(i) for i in el], :2].mean(axis=0) for el in elements])

    # If elements count is half or double (extrusion) or approximate, compute average centroids
    if nodes.size:
        # Fallback to evenly sampled node positions
        idx = np.linspace(0, len(nodes) - 1, n_cells, dtype=int)
        return nodes[idx, :2]

    raise ResultsUnavailable(
        f"no cell-centre data available for {n_cells} cells"
    )


def _extract_pyvista_results(case: Path, time_value: Optional[str], mesh: Dict) -> Optional[Dict]:
    """Read OpenFOAM case using PyVista POpenFOAMReader and compute streamlines."""
    try:
        import pyvista as pv
    except ImportError:
        return None

    foam_file = case / "case.foam"
    if not foam_file.exists():
        try:
            foam_file.touch()
        except Exception:
            pass

    if not foam_file.exists():
        return None

    try:
        reader = pv.POpenFOAMReader(str(foam_file))
        available_times = [float(t) for t in reader.time_values]
        if not available_times:
            return None

        # Pick matching time or latest
        if time_value is not None:
            try:
                target_t = float(time_value)
                best_t = min(available_times, key=lambda t: abs(t - target_t))
            except ValueError:
                best_t = available_times[-1]
        else:
            best_t = available_times[-1]

        reader.set_active_time_value(best_t)
        foam_data = reader.read()
        block_keys = list(foam_data.keys()) if hasattr(foam_data, "keys") else []
        if "internalMesh" not in block_keys and len(foam_data) > 0:
            internal = foam_data[0]
        elif "internalMesh" in block_keys:
            internal = foam_data["internalMesh"]
        else:
            return None
        nodes = np.asarray(mesh.get("nodes") or [], dtype=float)
        if nodes.size == 0:
            return None

        # Sample or probe data at 2D viewer node positions
        query_pts = np.zeros((len(nodes), 3), dtype=float)
        query_pts[:, :2] = nodes[:, :2]
        bounds = internal.bounds
        z_mid = (bounds[4] + bounds[5]) / 2.0 if len(bounds) >= 6 else 0.0
        query_pts[:, 2] = z_mid

        poly_query = pv.PolyData(query_pts)
        probed = poly_query.sample(internal)

        def get_field(name: str, default: float = 0.0) -> np.ndarray:
            if name in probed.point_data:
                arr = np.asarray(probed.point_data[name])
                if arr.ndim > 1:
                    return np.linalg.norm(arr[:, :2], axis=1)
                return arr.ravel()
            return np.full(len(nodes), default, dtype=float)

        umag = get_field("U", 0.0)
        p = get_field("p", 0.0)
        k = get_field("k", 0.0)
        omega = get_field("omega", 0.0)

        # True curl/vorticity from PyVista/VTK vector gradients if available
        if "U" in internal.point_data or "U" in internal.cell_data:
            try:
                with_vort = internal.compute_derivative(scalars="U", vorticity=True)
                probed_vort = poly_query.sample(with_vort)
                v_key = "vorticity" if "vorticity" in probed_vort.point_data else ("Vorticity" if "Vorticity" in probed_vort.point_data else None)
                if v_key:
                    vort_arr = np.asarray(probed_vort.point_data[v_key])
                    vort = vort_arr[:, 2] if vort_arr.ndim > 1 and vort_arr.shape[1] >= 3 else vort_arr.ravel()
                else:
                    vort = np.gradient(umag) if len(umag) > 1 else np.zeros_like(umag)
            except Exception:
                vort = np.gradient(umag) if len(umag) > 1 else np.zeros_like(umag)
        else:
            vort = np.gradient(umag) if len(umag) > 1 else np.zeros_like(umag)

        # Compute streamlines from inlet
        streamlines_list: List[List[List[float]]] = []
        try:
            x_min = float(bounds[0])
            x_max = float(bounds[1])
            y_min = float(bounds[2])
            y_max = float(bounds[3])
            x_seed = x_min + (x_max - x_min) * 0.02
            p_start = [x_seed, y_min + (y_max - y_min) * 0.05, z_mid]
            p_end = [x_seed, y_max - (y_max - y_min) * 0.05, z_mid]

            sl_poly = internal.streamlines(
                vectors="U",
                pointa=p_start,
                pointb=p_end,
                n_points=22,
                max_length=max(0.1, (x_max - x_min) * 1.5),
                integration_direction="forward",
            )
            for i in range(sl_poly.n_cells):
                cell = sl_poly.get_cell(i)
                pts = [[round(float(p[0]), 4), round(float(p[1]), 4)] for p in cell.points]
                if len(pts) > 1:
                    streamlines_list.append(pts)
        except Exception as sl_exc:
            print(f"[PyVistaReader] Streamline calc notice: {sl_exc}")

        def rng(a: np.ndarray) -> List[float]:
            return [round(float(np.min(a)), 4), round(float(np.max(a)), 4)]

        time_str = f"{best_t:.6g}"
        avail_str = [f"{t:.6g}" for t in available_times]

        return {
            "time": time_str,
            "availableTimes": avail_str,
            "source": "openfoam",
            "fields": {
                "U_mag": [round(float(v), 4) for v in umag],
                "p": [round(float(v), 3) for v in p],
                "k": [round(float(v), 5) for v in k],
                "omega": [round(float(v), 3) for v in omega],
                "vorticity": [round(float(v), 4) for v in vort],
            },
            "ranges": {"U_mag": rng(umag), "p": rng(p), "k": rng(k), "omega": rng(omega)},
            "streamlines": streamlines_list,
        }
    except Exception as exc:
        print(f"[PyVistaReader] Note: Falling back to legacy field reader: {exc}")
        return None


def read_field_results(case_dir: str | Path, mesh: Dict, time_value: Optional[str] = None) -> Optional[Dict]:
    case = Path(case_dir)

    # 1. Try PyVista high-fidelity reader first
    pv_res = _extract_pyvista_results(case, time_value, mesh)
    if pv_res is not None:
        return pv_res

    # 2. Fallback to legacy parser
    times = _time_dirs(case)
    if time_value is None:
        tdir = _latest_time_dir(case)
    else:
        try:
            req_t = float(time_value)
            tdir = next((path for value, path in times if path.name == str(time_value) or abs(value - req_t) < 1e-4), None)
        except ValueError:
            tdir = next((path for value, path in times if path.name == str(time_value)), None)
    if tdir is None:
        raise ResultsUnavailable("no written time directory - has the solver run for this project?")

    U = _read_field(tdir / "U")
    p = _read_field(tdir / "p")
    if U is None or p is None:
        raise ResultsUnavailable(f"no U/p fields in {tdir.name}/ - solver may have diverged or not written output")

    n_cells = len(np.atleast_2d(U))
    centres = _cell_centres(tdir, mesh, n_cells)
    k = _read_field(tdir / "k")
    omega = _read_field(tdir / "omega")

    nodes = np.asarray(mesh.get("nodes") or [], dtype=float)
    if nodes.size == 0:
        raise ResultsUnavailable("no mesh nodes supplied")

    nn = _nearest(nodes[:, :2], centres)

    umag_c = np.linalg.norm(np.atleast_2d(U)[:, :2], axis=1)
    umag = umag_c[nn]
    pn = np.asarray(p).ravel()[nn]
    kn = np.asarray(k).ravel()[nn] if k is not None else np.zeros(len(nodes))
    on = np.asarray(omega).ravel()[nn] if omega is not None else np.zeros(len(nodes))
    vort = np.gradient(umag) if len(umag) > 1 else np.zeros_like(umag)

    def rng(a: np.ndarray) -> List[float]:
        return [round(float(np.min(a)), 4), round(float(np.max(a)), 4)]

    return {
        "time": tdir.name,
        "availableTimes": [path.name for _, path in times],
        "source": "openfoam",
        "fields": {
            "U_mag": [round(float(v), 4) for v in umag],
            "p": [round(float(v), 3) for v in pn],
            "k": [round(float(v), 5) for v in kn],
            "omega": [round(float(v), 3) for v in on],
            "vorticity": [round(float(v), 4) for v in vort],
        },
        "ranges": {"U_mag": rng(umag), "p": rng(pn), "k": rng(kn), "omega": rng(on)},
        "streamlines": [],
    }
