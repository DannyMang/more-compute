#!/usr/bin/env python3
"""Fix notebook structure to be compatible with Google Colab."""
import json
import sys

def fix_notebook(file_path: str):
    """Fix notebook cell structure for Colab compatibility."""
    with open(file_path, 'r') as f:
        notebook = json.load(f)

    # Fix each cell
    for cell in notebook['cells']:
        # Ensure metadata exists
        if 'metadata' not in cell:
            cell['metadata'] = {}

        # Remove outputs and execution_count from markdown cells
        if cell['cell_type'] == 'markdown':
            cell.pop('outputs', None)
            cell.pop('execution_count', None)

        # Ensure code cells have required fields
        elif cell['cell_type'] == 'code':
            if 'outputs' not in cell:
                cell['outputs'] = []
            if 'execution_count' not in cell:
                cell['execution_count'] = None
            if 'metadata' not in cell:
                cell['metadata'] = {}

    # Write the fixed notebook
    with open(file_path, 'w') as f:
        json.dump(notebook, f, indent=2)

    print(f"✅ Fixed notebook: {file_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python fix_notebook.py <notebook_path>")
        sys.exit(1)

    fix_notebook(sys.argv[1])
