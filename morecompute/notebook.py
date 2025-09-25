import json
from typing import List, Dict, Any

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
            self.cells.append({'cell_type': 'code', 'source': '', 'outputs': []})

    def get_notebook_data(self) -> Dict[str, Any]:
        return {"cells": self.cells, "metadata": self.metadata, "file_path": self.file_path}

    def add_cell(self, index: int, cell_type: str = 'code', source: str = ''):
        new_cell = {'cell_type': cell_type, 'source': source, 'outputs': []}
        self.cells.insert(index, new_cell)

    def delete_cell(self, index: int):
        if 0 <= index < len(self.cells):
            self.cells.pop(index)

    def update_cell(self, index: int, source: str):
        if 0 <= index < len(self.cells):
            self.cells[index]['source'] = source

    def clear_all_outputs(self):
        for cell in self.cells:
            cell['outputs'] = []
            if 'execution_count' in cell:
                cell['execution_count'] = None

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
            with open(file_path, 'r') as f:
                data = json.load(f)
                self.cells = data.get('cells', [])
                self.metadata = data.get('metadata', {})
                self.file_path = file_path
        except (FileNotFoundError, json.JSONDecodeError) as e:
            print(f"Error loading notebook: {e}")
            # Initialize with a default cell if loading fails
            self.cells = [{'cell_type': 'code', 'source': '', 'outputs': []}]
            self.metadata = {}
            self.file_path = file_path

    def save_to_file(self, file_path: str = None):
        path_to_save = file_path or self.file_path
        if not path_to_save:
            raise ValueError("No file path specified for saving.")
        
        with open(path_to_save, 'w') as f:
            f.write(self.to_json())
        self.file_path = path_to_save
