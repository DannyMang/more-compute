"""Parser for py:percent format (.py files with # %% cell markers)."""

import re
from typing import List, Dict, Optional


def parse_py_percent(content: str) -> Dict:
    """
    Parse py:percent format Python file into notebook structure.

    Supports multiple formats:
        # %% - VSCode/PyCharm format
        # In[N]: - JupyterLab export format

    Format:
        # %%
        code cell content

        # %% [markdown]
        # markdown content

    Args:
        content: Raw .py file content

    Returns:
        Dict with 'cells' and 'metadata' (compatible with Notebook class)
    """
    cells = []

    # Check if using JupyterLab In[] format
    has_in_markers = bool(re.search(r'# In\[\d+\]:', content))

    if has_in_markers:
        # Parse JupyterLab # In[N]: format
        parts = re.split(r'(# In\[\d+\]:.*?\n)', content)
    else:
        # Parse VSCode # %% format
        parts = re.split(r'(# %%.*?\n)', content)

    # First part before any cell marker (usually imports/metadata)
    if parts[0].strip():
        # Check if it's UV inline script metadata
        first_part = parts[0].strip()
        if not first_part.startswith('# /// script'):
            # It's code, add as first cell
            cells.append({
                'cell_type': 'code',
                'source': parts[0],
                'metadata': {},
                'execution_count': None,
                'outputs': []
            })

    # Process remaining parts
    i = 1
    while i < len(parts):
        if i >= len(parts):
            break

        marker = parts[i] if i < len(parts) else ''
        cell_content = parts[i + 1] if i + 1 < len(parts) else ''

        # Determine cell type from marker
        if '[markdown]' in marker.lower():
            cell_type = 'markdown'
            # Remove leading # from markdown lines
            lines = cell_content.split('\n')
            cleaned_lines = []
            for line in lines:
                if line.strip().startswith('#'):
                    # Remove first # and any space after it
                    cleaned_lines.append(line.strip()[1:].lstrip())
                else:
                    cleaned_lines.append(line)
            cell_content = '\n'.join(cleaned_lines)
        else:
            cell_type = 'code'

        # Only add non-empty cells
        if cell_content.strip():
            cell = {
                'cell_type': cell_type,
                'source': cell_content.strip(),
                'metadata': {}
            }

            if cell_type == 'code':
                cell['execution_count'] = None
                cell['outputs'] = []

            cells.append(cell)

        i += 2

    return {
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


def extract_uv_dependencies(content: str) -> Optional[List[str]]:
    """
    Extract UV inline script dependencies from .py file.

    Format:
        # /// script
        # dependencies = [
        #   "package1",
        #   "package2>=1.0.0",
        # ]
        # ///

    Args:
        content: Raw .py file content

    Returns:
        List of dependency strings, or None if no dependencies found
    """
    # Match UV inline script metadata block
    pattern = r'# /// script\n(.*?)# ///\n'
    match = re.search(pattern, content, re.DOTALL)

    if not match:
        return None

    metadata_block = match.group(1)

    # Extract dependencies list
    deps_pattern = r'# dependencies = \[(.*?)\]'
    deps_match = re.search(deps_pattern, metadata_block, re.DOTALL)

    if not deps_match:
        return None

    deps_str = deps_match.group(1)

    # Parse individual dependencies
    dependencies = []
    for line in deps_str.split('\n'):
        line = line.strip()
        if line.startswith('#'):
            line = line[1:].strip()
        # Remove quotes and trailing comma
        line = line.strip('"\'').strip(',').strip()
        if line:
            dependencies.append(line)

    return dependencies if dependencies else None


def generate_py_percent(cells: List[Dict]) -> str:
    """
    Generate py:percent format from cell list.

    Args:
        cells: List of cell dicts with 'cell_type' and 'source'

    Returns:
        String in py:percent format
    """
    lines = []

    for i, cell in enumerate(cells):
        cell_type = cell.get('cell_type', 'code')
        source = cell.get('source', '')

        # Ensure source is string
        if isinstance(source, list):
            source = ''.join(source)

        # Add cell marker
        if cell_type == 'markdown':
            lines.append('# %% [markdown]')
            # Add # prefix to each line of markdown
            for line in source.split('\n'):
                if line.strip():
                    lines.append(f'# {line}')
                else:
                    lines.append('#')
        else:
            lines.append('# %%')
            lines.append(source)

        # Add blank line between cells
        if i < len(cells) - 1:
            lines.append('')

    return '\n'.join(lines)
