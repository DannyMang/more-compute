import json
from pathlib import Path
from typing import List, Dict, Any
from uuid import uuid4
from .utils.py_percent_parser import parse_py_percent, generate_py_percent
from .utils.notebook_converter import detect_colab_format, parse_colab_py

class Notebook:
    """Manages the state of a notebook's cells."""

    def __init__(self, file_path: str = None):
        self.cells: List[Dict[str, Any]] = []
        self.metadata: Dict[str, Any] = {}
        self.file_path = file_path
        if file_path:
            self.load_from_file(file_path)
        else:
            # Default empty notebook structure
            self.cells.append({
                'id': self._generate_cell_id(),
                'cell_type': 'code',
                'source': '',
                'metadata': {},
                'outputs': [],
                'execution_count': None
            })

    def get_notebook_data(self) -> Dict[str, Any]:
        return {"cells": self.cells, "metadata": self.metadata, "file_path": self.file_path}

    def add_cell(self, index: int, cell_type: str = 'code', source: str = '', full_cell: dict = None):
        if full_cell:
            actual_cell_type = full_cell.get('cell_type', cell_type)
            new_cell = {
                'id': full_cell.get('id', self._generate_cell_id()),
                'cell_type': actual_cell_type,
                'source': full_cell.get('source', source),
                'metadata': full_cell.get('metadata', {}),
            }
            # Only add outputs and execution_count for code cells
            if actual_cell_type == 'code':
                new_cell['outputs'] = full_cell.get('outputs', [])
                new_cell['execution_count'] = full_cell.get('execution_count')
        else:
            # Normal new cell creation
            new_cell = {
                'id': self._generate_cell_id(),
                'cell_type': cell_type,
                'source': source,
                'metadata': {}
            }
            # Only add outputs for code cells
            if cell_type == 'code':
                new_cell['outputs'] = []
                new_cell['execution_count'] = None
        self.cells.insert(index, new_cell)

    def delete_cell(self, index: int):
        if 0 <= index < len(self.cells):
            self.cells.pop(index)

    def update_cell(self, index: int, source: str):
        if 0 <= index < len(self.cells):
            self.cells[index]['source'] = source

    def move_cell(self, from_index: int, to_index: int):
        if 0 <= from_index < len(self.cells) and 0 <= to_index < len(self.cells):
            cell = self.cells.pop(from_index)
            self.cells.insert(to_index, cell)

    def clear_all_outputs(self):
        for cell in self.cells:
            # Only clear outputs for code cells
            if cell.get('cell_type') == 'code':
                cell['outputs'] = []
                cell['execution_count'] = None
                cell['execution_time'] = None
                cell['error'] = None

    def to_json(self) -> str:
        # Basic notebook format
        notebook_json = {
            "cells": self.cells,
            "metadata": self.metadata,
            "nbformat": 4,
            "nbformat_minor": 5
        }
        return json.dumps(notebook_json, indent=2)

    def load_from_file(self, file_path: str):
        try:
            path = Path(file_path)

            # Check file extension
            if path.suffix == '.py':
                # Load .py file - auto-detect format
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                # Detect if it's Colab format (docstrings) or py:percent format (# %%)
                if detect_colab_format(content):
                    print(f" Detected Colab format - auto-converting to py:percent")
                    # Parse Colab format (docstrings as markdown)
                    loaded_cells = parse_colab_py(content)
                    data = {
                        'cells': loaded_cells,
                        'metadata': {
                            'kernelspec': {
                                'display_name': 'Python 3',
                                'language': 'python',
                                'name': 'python3'
                            }
                        }
                    }
                else:
                    # Parse py:percent format (# %% markers)
                    data = parse_py_percent(content)

                loaded_cells = data.get('cells', [])

                # Ensure stable IDs for all cells
                self.cells = []
                for cell in loaded_cells:
                    if not isinstance(cell, dict):
                        continue
                    if 'id' not in cell or not cell['id']:
                        cell['id'] = self._generate_cell_id()
                    self.cells.append(cell)

                self.metadata = data.get('metadata', {})
                self.file_path = file_path

            elif path.suffix == '.ipynb':
                # Block .ipynb files with helpful error
                raise ValueError(
                    f"MoreCompute only supports .py notebooks.\n\n"
                    f"Convert your notebook with:\n"
                    f"  more-compute convert {path.name} -o {path.stem}.py\n\n"
                    f"Then open with:\n"
                    f"  more-compute {path.stem}.py"
                )

            else:
                raise ValueError(f"Unsupported file format: {path.suffix}. Use .py files.")

        except FileNotFoundError as e:
            print(f"Error: File not found: {e}")
            # Initialize with a default cell if loading fails
            self.cells = [{
                'id': self._generate_cell_id(),
                'cell_type': 'code',
                'source': '',
                'metadata': {},
                'outputs': [],
                'execution_count': None
            }]
            self.metadata = {}
            self.file_path = file_path
        except ValueError as e:
            # Re-raise validation errors (like .ipynb block)
            raise
        except Exception as e:
            print(f"Error loading notebook: {e}")
            # Initialize with a default cell if loading fails
            self.cells = [{
                'id': self._generate_cell_id(),
                'cell_type': 'code',
                'source': '',
                'metadata': {},
                'outputs': [],
                'execution_count': None
            }]
            self.metadata = {}
            self.file_path = file_path

    def save_to_file(self, file_path: str = None):
        path_to_save = file_path or self.file_path
        if not path_to_save:
            raise ValueError("No file path specified for saving.")

        path = Path(path_to_save)

        # Save in appropriate format based on extension
        if path.suffix == '.py':
            # Save as py:percent format
            content = generate_py_percent(self.cells)
            with open(path_to_save, 'w', encoding='utf-8') as f:
                f.write(content)
        elif path.suffix == '.ipynb':
            # Block saving as .ipynb
            raise ValueError("MoreCompute only supports .py notebooks. Use .py extension.")
        else:
            # Default to .py if no extension
            path_to_save = str(path.with_suffix('.py'))
            content = generate_py_percent(self.cells)
            with open(path_to_save, 'w', encoding='utf-8') as f:
                f.write(content)

        self.file_path = path_to_save

    def _generate_cell_id(self) -> str:
        return f"cell-{uuid4()}"
