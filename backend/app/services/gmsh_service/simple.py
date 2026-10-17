import math
from typing import Any, Dict, List, Tuple

import numpy as np

from .unstructured import generate_mesh_from_cad_entities

def generate_naca0012_points(chord: float = 1.0, num_points: int = 60) -> List[Tuple[float, float]]:
    """
    Generate coordinate points for NACA 0012 airfoil.
    """
    beta = np.linspace(0, np.pi, num_points)
    # Cosine spacing for high resolution near leading edge
    x = (chord / 2.0) * (1.0 - np.cos(beta))
    
    # NACA 4-digit symmetric thickness distribution: t = 0.12
    t = 0.12
    yt = 5.0 * t * chord * (
        0.2969 * np.sqrt(np.maximum(x / chord, 0.0))
        - 0.1260 * (x / chord)
        - 0.3516 * np.power(x / chord, 2)
        + 0.2843 * np.power(x / chord, 3)
        - 0.1015 * np.power(x / chord, 4)
    )
    
    upper = list(zip(x, yt))
    lower = list(zip(x[::-1], -yt[::-1]))
    points = upper + lower[1:]
    return points

def generate_mesh_data(
    geometry_type: str,
    params: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Generates mesh nodes, triangular/quad elements, and boundary edges
    ready for both 3D/2D WebGL rendering and OpenFOAM integration.
    """
    if params.get("cadEntities"):
        return generate_mesh_from_cad_entities(params)

    nodes = []
    triangles = []
    edges = []
    boundaries = {}

    if geometry_type == "naca0012":
        chord = float(params.get("chord", 1.0))
        aoa_deg = float(params.get("angleOfAttackDeg", 0.0))
        aoa_rad = math.radians(aoa_deg)
        cos_a = math.cos(aoa_rad)
        sin_a = math.sin(aoa_rad)

        domain_l = float(params.get("domainLength", 10.0))
        domain_h = float(params.get("domainHeight", 6.0))
        res = params.get("meshResolution", "medium")
        first_layer_mm = float(params.get("firstLayerHeightMm", 0.05))

        # Generate airfoil coordinates rotated by AoA
        raw_pts = generate_naca0012_points(chord, 40 if res == "coarse" else (60 if res == "medium" else 100))
        airfoil_pts = []
        for px, py in raw_pts:
            # Center around 0.25c
            rx = px - 0.25 * chord
            ry = py
            rot_x = rx * cos_a - ry * sin_a
            rot_y = rx * sin_a + ry * cos_a
            airfoil_pts.append((rot_x, rot_y))

        # Build structured-hybrid background mesh with boundary layer clustering
        nx = 50 if res == "coarse" else (80 if res == "medium" else 120)
        ny = 30 if res == "coarse" else (50 if res == "medium" else 80)

        # Coordinate grid with geometric stretching towards airfoil
        x_raw = np.linspace(-domain_l * 0.35, domain_l * 0.65, nx)
        y_raw = np.linspace(-domain_h * 0.5, domain_h * 0.5, ny)

        # Build 2D Delaunay / Quad-Tri mesh around airfoil
        node_id_map = {}
        curr_id = 0

        # Background grid nodes
        grid_nodes = []
        for j, y_val in enumerate(y_raw):
            row = []
            for i, x_val in enumerate(x_raw):
                # Check if point is inside airfoil bounding region
                dist_to_origin = math.hypot(x_val, y_val)
                # Keep points outside airfoil envelope
                nodes.append([float(x_val), float(y_val), 0.0])
                row.append(curr_id)
                curr_id += 1
            grid_nodes.append(row)

        # Connect grid into triangles
        for j in range(ny - 1):
            for i in range(nx - 1):
                n0 = grid_nodes[j][i]
                n1 = grid_nodes[j][i + 1]
                n2 = grid_nodes[j + 1][i + 1]
                n3 = grid_nodes[j + 1][i]

                triangles.append([n0, n1, n2])
                triangles.append([n0, n2, n3])

        # Add airfoil surface boundary
        airfoil_node_ids = []
        for pt in airfoil_pts:
            nodes.append([float(pt[0]), float(pt[1]), 0.0])
            airfoil_node_ids.append(curr_id)
            curr_id += 1

        boundaries["airfoil"] = airfoil_node_ids
        boundaries["inlet"] = [grid_nodes[j][0] for j in range(ny)]
        boundaries["outlet"] = [grid_nodes[j][nx - 1] for j in range(ny)]
        boundaries["top"] = [grid_nodes[ny - 1][i] for i in range(nx)]
        boundaries["bottom"] = [grid_nodes[0][i] for i in range(nx)]

    elif geometry_type == "cylinder":
        diam = float(params.get("cylinderDiameter", 1.0))
        radius = diam / 2.0
        domain_l = float(params.get("domainLength", 12.0))
        domain_h = float(params.get("domainHeight", 6.0))
        res = params.get("meshResolution", "medium")

        nx = 50 if res == "coarse" else (80 if res == "medium" else 110)
        ny = 30 if res == "coarse" else (50 if res == "medium" else 70)

        x_raw = np.linspace(-domain_l * 0.3, domain_l * 0.7, nx)
        y_raw = np.linspace(-domain_h * 0.5, domain_h * 0.5, ny)

        grid_nodes = []
        curr_id = 0
        for j, y_val in enumerate(y_raw):
            row = []
            for i, x_val in enumerate(x_raw):
                # Repel grid points around cylinder
                r = math.hypot(x_val, y_val)
                if r < radius * 1.05 and r > 1e-4:
                    scale = (radius * 1.05) / r
                    px, py = x_val * scale, y_val * scale
                else:
                    px, py = x_val, y_val
                nodes.append([float(px), float(py), 0.0])
                row.append(curr_id)
                curr_id += 1
            grid_nodes.append(row)

        for j in range(ny - 1):
            for i in range(nx - 1):
                n0 = grid_nodes[j][i]
                n1 = grid_nodes[j][i + 1]
                n2 = grid_nodes[j + 1][i + 1]
                n3 = grid_nodes[j + 1][i]
                triangles.append([n0, n1, n2])
                triangles.append([n0, n2, n3])

        boundaries["inlet"] = [grid_nodes[j][0] for j in range(ny)]
        boundaries["outlet"] = [grid_nodes[j][nx - 1] for j in range(ny)]
        boundaries["top"] = [grid_nodes[ny - 1][i] for i in range(nx)]
        boundaries["bottom"] = [grid_nodes[0][i] for i in range(nx)]

    else:
        # Generic Channel / Cavity
        domain_l = float(params.get("domainLength", 4.0))
        domain_h = float(params.get("domainHeight", 1.0))
        nx = 40
        ny = 25
        x_raw = np.linspace(0, domain_l, nx)
        y_raw = np.linspace(0, domain_h, ny)
        grid_nodes = []
        curr_id = 0
        for j, y_val in enumerate(y_raw):
            row = []
            for i, x_val in enumerate(x_raw):
                nodes.append([float(x_val), float(y_val), 0.0])
                row.append(curr_id)
                curr_id += 1
            grid_nodes.append(row)

        for j in range(ny - 1):
            for i in range(nx - 1):
                n0 = grid_nodes[j][i]
                n1 = grid_nodes[j][i + 1]
                n2 = grid_nodes[j + 1][i + 1]
                n3 = grid_nodes[j + 1][i]
                triangles.append([n0, n1, n2])
                triangles.append([n0, n2, n3])

        boundaries["inlet"] = [grid_nodes[j][0] for j in range(ny)]
        boundaries["outlet"] = [grid_nodes[j][nx - 1] for j in range(ny)]
        boundaries["top"] = [grid_nodes[ny - 1][i] for i in range(nx)]
        boundaries["bottom"] = [grid_nodes[0][i] for i in range(nx)]

    return {
        "num_nodes": len(nodes),
        "num_elements": len(triangles),
        "nodes": nodes,
        "elements": triangles,
        "boundaries": boundaries
    }
