"""Converter utilities for notebook formats."""

import json
import re
from pathlib import Path
from typing import List, Set, Dict
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


def detect_colab_format(content: str) -> bool:
    """
    Detect if a .py file is in Colab export format (docstrings as markdown).

    Args:
        content: Raw .py file content

    Returns:
        True if appears to be Colab format, False otherwise
    """
    # Check for actual cell markers (# %% at start of line)
    # Must be ONLY # %% optionally followed by [markdown] or whitespace
    # NOT # %%capture, # %%time, etc. (IPython magics)
    has_cell_markers = bool(re.search(r'^\s*# %%\s*(?:\[markdown\])?\s*$', content, re.MULTILINE))

    # If it has # %% markers, it's NOT Colab format (it's py:percent)
    # Even if it has a Colab header comment!
    if has_cell_markers:
        return False

    # Check for multi-line docstrings (Colab's markdown format)
    has_docstrings = '"""' in content

    # Colab format: has docstrings and no cell markers
    return has_docstrings


def parse_colab_py(content: str) -> List[Dict]:
    """
    Parse Colab-exported .py file into cell structure.

    Colab format uses:
    - Multi-line docstrings ('''..''' or \"\"\"...\"\"\") for markdown cells
    - Regular Python code for code cells

    Args:
        content: Raw .py file content from Colab export

    Returns:
        List of cell dicts with 'cell_type' and 'source'
    """
    cells = []

    # Split on docstring boundaries
    # Pattern matches both ''' and """ with optional content
    pattern = r'("""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\')'
    parts = re.split(pattern, content)

    for part in parts:
        part = part.strip()
        if not part:
            continue

        # Check if this is a docstring (markdown)
        if (part.startswith('"""') and part.endswith('"""')) or \
           (part.startswith("'''") and part.endswith("'''")):
            # It's a markdown cell
            # Remove the triple quotes
            markdown_content = part[3:-3].strip()

            # Skip empty markdown cells
            if markdown_content:
                cells.append({
                    'cell_type': 'markdown',
                    'source': markdown_content,
                    'metadata': {}
                })
        else:
            # It's a code cell
            # Skip commented out code and special markers
            if part and not part.startswith('# Commented out IPython magic'):
                cells.append({
                    'cell_type': 'code',
                    'source': part,
                    'metadata': {},
                    'execution_count': None,
                    'outputs': []
                })

    return cells


def convert_colab_py_to_py_percent(input_path: Path, output_path: Path, include_uv_deps: bool = True) -> None:
    """
    Convert Colab-exported .py file to py:percent format (# %% markers).

    Args:
        input_path: Path to Colab .py file
        output_path: Path to output .py file with # %% markers
        include_uv_deps: Whether to extract and add UV inline script dependencies
    """
    # Read Colab .py file
    with open(input_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Detect format
    if not detect_colab_format(content):
        print(f"Warning: {input_path.name} doesn't appear to be in Colab format")
        print(f"  (Already has # %% markers or missing docstrings)")
        return

    # Parse Colab format into cells
    cells = parse_colab_py(content)

    if not cells:
        print(f"Error: No cells found in {input_path.name}")
        return

    # Extract dependencies if requested
    header_lines = []
    if include_uv_deps:
        # Create a temporary notebook structure to extract dependencies
        temp_notebook = {'cells': cells}
        dependencies = extract_pip_dependencies(temp_notebook)

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

    print(f"✓ Converted Colab format {input_path.name} → {output_path.name}")
    print(f"  Format: Colab docstrings → py:percent (# %%) markers")

    if include_uv_deps and dependencies:
        print(f"  Found dependencies: {', '.join(sorted(dependencies))}")
        print(f"  Run with: more-compute {output_path.name}")


def convert_py_to_ipynb(py_path: Path, output_path: Path) -> None:
    """
    Convert .py notebook to .ipynb format.

    Automatically detects format (Colab, VSCode, JupyterLab).

    Args:
        py_path: Path to input .py file
        output_path: Path to output .ipynb file
    """
    # Read .py file
    with open(py_path, 'r', encoding='utf-8') as f:
        py_content = f.read()

    # Detect format and parse accordingly
    if detect_colab_format(py_content):
        # Parse Colab format (docstrings as markdown)
        cells = parse_colab_py(py_content)
        notebook_data = {
            'cells': cells,
            'metadata': {
                'kernelspec': {
                    'display_name': 'Python 3',
                    'language': 'python',
                    'name': 'python3'
                },
                'language_info': {
                    'name': 'python',
                    'version': '3.8.0'
                }
            },
            'nbformat': 4,
            'nbformat_minor': 4
        }
    else:
        # Parse py:percent format (# %% or # In[N]:)
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
