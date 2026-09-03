"""OpenFOAM dictionary text helpers."""
from typing import Any, Dict


_BANNER = (
    "/*--------------------------------*- C++ -*----------------------------------*\\\n"
    "| OpenCFD  -  generated case file                                            |\n"
    "\\*---------------------------------------------------------------------------*/\n"
)


def foam_file(cls: str, obj: str, body: str, location: str | None = None) -> str:
    loc = f'    location    "{location}";\n' if location else ""
    return (
        f"{_BANNER}"
        "FoamFile\n{\n"
        "    version     2.0;\n"
        "    format      ascii;\n"
        f"    class       {cls};\n"
        f"{loc}"
        f"    object      {obj};\n"
        "}\n"
        "// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //\n\n"
        f"{body}\n"
    )


def to_block(d: Dict[str, Any], indent: int = 4) -> str:
    """Render a dict as an OpenFOAM sub-dictionary body (no braces)."""
    pad = " " * indent
    out = []
    for key, val in d.items():
        if isinstance(val, dict):
            out.append(f"{pad}{key}\n{pad}{{")
            out.append(to_block(val, indent + 4))
            out.append(f"{pad}}}")
        else:
            out.append(f"{pad}{key:<15} {val};")
    return "\n".join(out)


def boundary_field(patch_dicts: Dict[str, Dict[str, Any]], trailer: str = "") -> str:
    body = "\n\n".join(
        f"    {name}\n    {{\n{to_block(spec, 8)}\n    }}" for name, spec in patch_dicts.items()
    )
    # The trailer (#includeEtc setConstraintTypes) goes FIRST: it keys entries by
    # constraint-group name, and one of those keys can collide with a real patch
    # name (a patch literally called `symmetry` that we want as a non-reflecting
    # far-field). A later explicit entry for that patch name then wins.
    head = f"    {trailer}\n\n" if trailer else ""
    return "boundaryField\n{\n" + head + body + "\n}"
