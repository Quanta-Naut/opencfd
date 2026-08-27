import math
from typing import Dict, Any, List
import numpy as np

def generate_field_solution(
    mesh_data: Dict[str, Any],
    geometry_type: str,
    velocity: float = 20.0,
    regime: str = "turbulent"
) -> Dict[str, Any]:
    """
    Computes/extracts post-processing fields (U, p, k, omega, streamlines)
    mapped onto mesh nodes and elements for 3D/2D interactive visualization.
    """
    nodes = mesh_data.get("nodes", [])
    num_nodes = len(nodes)
    if num_nodes == 0:
        return {}

    # Extract coordinates
    coords = np.array(nodes)
    x = coords[:, 0]
    y = coords[:, 1]

    # Analytical potential + viscous boundary layer flow approximation for rapid rendering
    if geometry_type == "naca0012":
        # Airfoil flow: acceleration on suction side, stagnation at LE
        r_sq = x**2 + y**2 + 0.05
        u_base = velocity * (1.0 + 0.15 / r_sq)
        # Suction peak near upper surface
        u_peak = np.where((x > -0.2) & (x < 0.6) & (y > 0), 1.25 * velocity * np.exp(-10.0 * np.abs(y)), 0.0)
        u_wake = np.where((x > 0.6) & (np.abs(y) < 0.2), -0.3 * velocity * np.exp(-15.0 * y**2), 0.0)

        u_mag = np.clip(u_base + u_peak + u_wake, 0.0, velocity * 1.6)
        # Pressure: Bernoulli p = p_inf - 0.5 * rho * (U^2 - U_inf^2)
        rho = 1.225
        p = 0.5 * rho * (velocity**2 - u_mag**2)

    elif geometry_type == "cylinder":
        # Cylinder flow (doublet in uniform flow + Karman wake effect)
        R = 0.5
        r = np.maximum(np.hypot(x, y), R)
        theta = np.arctan2(y, x)
        # Potential flow: Ur = U*(1 - R^2/r^2)*cos(theta), Utheta = -U*(1 + R^2/r^2)*sin(theta)
        ur = velocity * (1.0 - (R**2) / (r**2)) * np.cos(theta)
        utheta = -velocity * (1.0 + (R**2) / (r**2)) * np.sin(theta)
        u_mag = np.hypot(ur, utheta)
        # Add wake reduction behind cylinder
        wake_mask = (x > 0.5) & (np.abs(y) < 0.6)
        u_mag[wake_mask] *= np.clip((x[wake_mask] - 0.5) / 3.0, 0.1, 1.0)
        p = 0.5 * 1.225 * (velocity**2 - u_mag**2)

    else:
        # Poiseuille / Channel flow
        h_max = np.max(y) if np.max(y) > 0 else 1.0
        u_mag = 1.5 * velocity * (1.0 - (2.0 * y / h_max - 1.0)**2)
        u_mag = np.clip(u_mag, 0.0, velocity * 1.5)
        p = -0.5 * x * 10.0

    # Turbulence fields
    if regime == "turbulent":
        k_field = 0.05 * (u_mag**2) * np.exp(-np.abs(y) * 2.0)
        omega_field = np.clip(np.sqrt(k_field) / (0.07 * 1.0 + 1e-4), 1.0, 500.0)
    else:
        k_field = np.zeros(num_nodes)
        omega_field = np.zeros(num_nodes)

    # Vorticity (approximated curl)
    vorticity = np.gradient(u_mag)[0] if num_nodes > 1 else np.zeros(num_nodes)

    # Generate streamline seed traces
    streamlines = []
    y_seeds = np.linspace(float(np.min(y)) * 0.8, float(np.max(y)) * 0.8, 14)
    x_start = float(np.min(x))
    x_end = float(np.max(x))

    for y0 in y_seeds:
        pts = []
        curr_x = x_start
        curr_y = y0
        step_sz = (x_end - x_start) / 40.0

        for _ in range(40):
            pts.append([round(float(curr_x), 4), round(float(curr_y), 4), 0.0])
            # Deflect streamlines around airfoil or cylinder
            if geometry_type == "cylinder" and math.hypot(curr_x, curr_y) < 0.6:
                curr_y += math.copysign(step_sz * 0.8, curr_y if curr_y != 0 else 0.01)
            elif geometry_type == "naca0012" and -0.25 < curr_x < 0.75 and abs(curr_y) < 0.2:
                curr_y += math.copysign(step_sz * 0.5, curr_y if curr_y != 0 else 0.01)
            curr_x += step_sz
            if curr_x > x_end:
                break
        streamlines.append(pts)

    return {
        "fields": {
            "U_mag": [round(float(v), 4) for v in u_mag],
            "p": [round(float(v), 2) for v in p],
            "k": [round(float(v), 5) for v in k_field],
            "omega": [round(float(v), 2) for v in omega_field],
            "vorticity": [round(float(v), 4) for v in vorticity]
        },
        "ranges": {
            "U_mag": [round(float(np.min(u_mag)), 2), round(float(np.max(u_mag)), 2)],
            "p": [round(float(np.min(p)), 1), round(float(np.max(p)), 1)],
            "k": [round(float(np.min(k_field)), 4), round(float(np.max(k_field)), 4)],
            "omega": [round(float(np.min(omega_field)), 1), round(float(np.max(omega_field)), 1)]
        },
        "streamlines": streamlines
    }
