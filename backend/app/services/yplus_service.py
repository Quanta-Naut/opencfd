import math
from typing import Dict, Any, Optional

def calculate_yplus(
    velocity: float,
    length: float,
    density: float = 1.225,
    viscosity: float = 1.789e-5,
    kinematic_viscosity: Optional[float] = None,
    target_yplus: float = 1.0,
    expansion_ratio: float = 1.2,
    flow_regime: str = "turbulent"
) -> Dict[str, Any]:
    """
    Calculate boundary layer parameters and first cell height based on target y+.
    """
    if velocity <= 0 or length <= 0:
        raise ValueError("Velocity and characteristic length must be positive.")
    
    if kinematic_viscosity is not None and kinematic_viscosity > 0:
        nu = kinematic_viscosity
        mu = nu * density
    else:
        mu = viscosity
        nu = mu / density

    # Reynolds number
    reynolds = (density * velocity * length) / mu

    if flow_regime == "laminar" or reynolds < 5e5:
        # Laminar flat plate
        cf = 1.328 / math.sqrt(max(reynolds, 1.0))
        delta = 5.0 * length / math.sqrt(max(reynolds, 1.0))
    else:
        # Turbulent flat plate (Schlichting formula)
        log_re = math.log10(max(reynolds, 100.0))
        cf = math.pow(2.0 * log_re - 0.65, -2.3)
        delta = 0.37 * length / math.pow(reynolds, 0.2)

    # Wall shear stress tau_w
    tau_w = 0.5 * cf * density * (velocity ** 2)

    # Friction velocity u_tau
    u_tau = math.sqrt(tau_w / density)

    # First layer height (delta_y)
    first_layer_height = (target_yplus * nu) / u_tau

    # Number of prism layers needed to reach boundary layer thickness
    r = max(expansion_ratio, 1.01)
    if first_layer_height < delta:
        try:
            num_layers = math.ceil(math.log(1.0 + (delta * (r - 1.0) / first_layer_height)) / math.log(r))
            num_layers = max(1, min(num_layers, 100))
        except (ValueError, ZeroDivisionError):
            num_layers = 15
    else:
        num_layers = 5

    total_layer_thickness = first_layer_height * (math.pow(r, num_layers) - 1.0) / (r - 1.0)

    return {
        "reynolds_number": round(reynolds, 2),
        "skin_friction_coefficient": round(cf, 8),
        "wall_shear_stress": round(tau_w, 6),
        "friction_velocity": round(u_tau, 6),
        "target_yplus": target_yplus,
        "first_layer_height_m": round(first_layer_height, 8),
        "first_layer_height_mm": round(first_layer_height * 1000.0, 5),
        "boundary_layer_thickness_m": round(delta, 6),
        "boundary_layer_thickness_mm": round(delta * 1000.0, 3),
        "recommended_layers": num_layers,
        "expansion_ratio": r,
        "total_layer_thickness_mm": round(total_layer_thickness * 1000.0, 3)
    }

def calculate_inflow_turbulence(
    velocity: float,
    length_scale: float,
    intensity_percent: float = 5.0,
    c_mu: float = 0.09
) -> Dict[str, Any]:
    """
    Calculate turbulent kinetic energy (k), dissipation rate (epsilon),
    and specific dissipation rate (omega) for inflow boundary conditions.
    """
    intensity = intensity_percent / 100.0
    l_t = 0.07 * length_scale

    # k = 3/2 * (U * I)^2
    k = 1.5 * ((velocity * intensity) ** 2)

    # omega = k^0.5 / (C_mu^0.25 * l_t)
    omega = (k ** 0.5) / ((c_mu ** 0.25) * l_t) if l_t > 0 else 1.0

    # epsilon = C_mu^0.75 * k^1.5 / l_t
    epsilon = (c_mu ** 0.75) * (k ** 1.5) / l_t if l_t > 0 else 1.0

    # eddy viscosity nu_t
    nut = (k / omega) if omega > 0 else 0.0

    return {
        "turbulence_intensity_percent": intensity_percent,
        "turbulent_length_scale_m": round(l_t, 6),
        "k": round(k, 6),
        "omega": round(omega, 4),
        "epsilon": round(epsilon, 6),
        "nut": round(nut, 8)
    }
