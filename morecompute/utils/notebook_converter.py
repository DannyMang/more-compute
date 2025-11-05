"""Converter utilities for notebook formats."""

import json
import re
from pathlib import Path
from typing import List, Set
from .py_percent_parser import generate_py_percent, parse_py_percent


def extract_pip_dependencies(notebook_data: dict) -> Set[str]:
    """
    Extract package names from !pip install and %pip install commands.

    Args:
        notebook_data: Parsed notebook JSON

    Returns:
        Set of package names
    """
    packages = set()

    for cell in notebook_data.get('cells', []):
        if cell.get('cell_type') != 'code':
            continue

        source = cell.get('source', [])
        if isinstance(source, list):
            source = ''.join(source)

        # Match: !pip install package1 package2
        # Match: %pip install package1 package2
        pip_pattern = r'[!%]pip\s+install\s+([^\n]+)'
        matches = re.finditer(pip_pattern, source)

        for match in matches:
            install_line = match.group(1)
            # Remove common flags
            install_line = re.sub(r'--[^\s]+\s*', '', install_line)
            install_line = re.sub(r'-[qU]\s*', '', install_line)

            # Extract package names (handle package==version format)
            parts = install_line.split()
            for part in parts:
                part = part.strip()
                if part and not part.startswith('-'):
                    packages.add(part)

    return packages


def convert_ipynb_to_py(ipynb_path: Path, output_path: Path, include_uv_deps: bool = True) -> None:
    """
    Convert .ipynb notebook to .py format with py:percent cell markers.

    Args:
        ipynb_path: Path to input .ipynb file
        output_path: Path to output .py file
        include_uv_deps: Whether to add UV inline script dependencies
    """
    # Read notebook
    with open(ipynb_path, 'r', encoding='utf-8') as f:
        notebook_data = json.load(f)

    cells = notebook_data.get('cells', [])

    # Generate UV dependencies header if requested
    header_lines = []
    if include_uv_deps:
        dependencies = extract_pip_dependencies(notebook_data)
        if dependencies:
            header_lines.append('# /// script')
            header_lines.append('# dependencies = [')
            for dep in sorted(dependencies):
                header_lines.append(f'#   "{dep}",')
            header_lines.append('# ]')
            header_lines.append('# ///')
            header_lines.append('')

    # Generate py:percent format
    py_content = generate_py_percent(cells)

    # Combine header and content
    if header_lines:
        final_content = '\n'.join(header_lines) + '\n' + py_content
    else:
        final_content = py_content

    # Write output
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(final_content)

    print(f"✓ Converted {ipynb_path.name} → {output_path.name}")

    # Show dependencies if found
    if include_uv_deps and dependencies:
        print(f"  Found dependencies: {', '.join(sorted(dependencies))}")
        print(f"  Run with: more-compute {output_path.name}")


def convert_py_to_ipynb(py_path: Path, output_path: Path) -> None:
    """
    Convert .py notebook to .ipynb format.

    Args:
        py_path: Path to input .py file
        output_path: Path to output .ipynb file
    """
    # Read .py file
    with open(py_path, 'r', encoding='utf-8') as f:
        py_content = f.read()

    # Parse py:percent format to notebook structure
    notebook_data = parse_py_percent(py_content)

    # Ensure source is in list format (Jupyter notebook standard)
    for cell in notebook_data.get('cells', []):
        source = cell.get('source', '')
        if isinstance(source, str):
            # Split into lines and keep newlines (Jupyter format)
            lines = source.split('\n')
            # Add \n to each line except the last
            cell['source'] = [line + '\n' for line in lines[:-1]] + ([lines[-1]] if lines[-1] else [])

    # Write .ipynb file
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(notebook_data, f, indent=1, ensure_ascii=False)

    print(f"Converted {py_path.name} -> {output_path.name}")
    print(f"  Upload to Google Colab or open in Jupyter")
