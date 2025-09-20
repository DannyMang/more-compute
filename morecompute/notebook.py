import json
import re
import os
from typing import List, Dict, Any, Optional
import nbformat


class Cell:
    def __init__(self, cell_type: str = "code", source: str = "", metadata: Dict = None):
        self.cell_type = cell_type
        self.source = source
        self.metadata = metadata or {}
        self.outputs = []
        self.execution_count = None
    
    def to_dict(self):
        return {
            "cell_type": self.cell_type,
            "source": self.source,
            "metadata": self.metadata,
            "outputs": self.outputs,
            "execution_count": self.execution_count
        }
    
    @classmethod
    def from_dict(cls, data):
        cell = cls(
            cell_type=data.get("cell_type", "code"),
            source=data.get("source", ""),
            metadata=data.get("metadata", {})
        )
        cell.outputs = data.get("outputs", [])
        cell.execution_count = data.get("execution_count")
        return cell


class NotebookHandler:
    def __init__(self, file_path: Optional[str] = None):
        self.file_path = file_path
        self.cells: List[Cell] = []
        self.metadata = {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3"
            },
            "language_info": {
                "name": "python",
                "version": "3.8.0"
            }
        }
        
        if file_path and os.path.exists(file_path):
            self.load_file()
        elif not file_path:
            # Create a new notebook with one empty cell
            self.cells = [Cell()]
    
    def load_file(self):
        """Load notebook from either .py or .ipynb file"""
        if not os.path.exists(self.file_path):
            raise FileNotFoundError(f"File not found: {self.file_path}")
        
        if self.file_path.endswith('.ipynb'):
            self._load_ipynb()
        elif self.file_path.endswith('.py'):
            self._load_py()
        else:
            raise ValueError("File must be .py or .ipynb")
    
    def _load_ipynb(self):
        """Load from Jupyter notebook file"""
        with open(self.file_path, 'r', encoding='utf-8') as f:
            nb_data = json.load(f)
        
        self.metadata = nb_data.get('metadata', self.metadata)
        self.cells = []
        
        for cell_data in nb_data.get('cells', []):
            cell = Cell.from_dict(cell_data)
            # Handle source as list or string
            if isinstance(cell.source, list):
                cell.source = ''.join(cell.source)
            self.cells.append(cell)
    
    def _load_py(self):
        """Load from Python file, converting to cells"""
        with open(self.file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Split by cell markers (# %% or # <codecell>)
        cell_pattern = r'^# %%.*$|^# <codecell>.*$'
        parts = re.split(cell_pattern, content, flags=re.MULTILINE)
        
        self.cells = []
        for part in parts:
            part = part.strip()
            if part:
                # Determine cell type based on content
                if part.startswith('# markdown') or part.startswith('"""') and part.endswith('"""'):
                    cell_type = "markdown"
                    # Remove markdown markers
                    if part.startswith('"""') and part.endswith('"""'):
                        part = part[3:-3].strip()
                else:
                    cell_type = "code"
                
                self.cells.append(Cell(cell_type=cell_type, source=part))
        
        # If no cells found, create one with all content
        if not self.cells and content.strip():
            self.cells.append(Cell(source=content.strip()))
        elif not self.cells:
            # Empty file, create one empty cell
            self.cells.append(Cell())
    
    def save_file(self, file_path: Optional[str] = None):
        """Save notebook to file"""
        save_path = file_path or self.file_path
        if not save_path:
            raise ValueError("No file path specified")
        
        if save_path.endswith('.ipynb'):
            self._save_ipynb(save_path)
        elif save_path.endswith('.py'):
            self._save_py(save_path)
        else:
            raise ValueError("File must be .py or .ipynb")
    
    def _save_ipynb(self, file_path: str):
        """Save as Jupyter notebook"""
        nb_data = {
            "cells": [cell.to_dict() for cell in self.cells],
            "metadata": self.metadata,
            "nbformat": 4,
            "nbformat_minor": 4
        }
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(nb_data, f, indent=2, ensure_ascii=False)
    
    def _save_py(self, file_path: str):
        """Save as Python file with cell markers"""
        content_parts = []
        
        for i, cell in enumerate(self.cells):
            if i > 0:
                content_parts.append("\n# %%\n")
            
            if cell.cell_type == "markdown":
                content_parts.append(f'"""\n{cell.source}\n"""')
            else:
                content_parts.append(cell.source)
        
        content = '\n'.join(content_parts)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
    
    def add_cell(self, index: int = -1, cell_type: str = "code", source: str = ""):
        """Add a new cell at the specified index"""
        cell = Cell(cell_type=cell_type, source=source)
        if index == -1:
            self.cells.append(cell)
        else:
            self.cells.insert(index, cell)
        return len(self.cells) - 1 if index == -1 else index
    
    def delete_cell(self, index: int):
        """Delete cell at index"""
        if 0 <= index < len(self.cells):
            del self.cells[index]
            return True
        return False
    
    def update_cell(self, index: int, source: str):
        """Update cell source code"""
        if 0 <= index < len(self.cells):
            self.cells[index].source = source
            return True
        return False
    
    def get_cells_data(self):
        """Get all cells as serializable data"""
        return [cell.to_dict() for cell in self.cells]
    
    def to_dict(self):
        """Convert notebook to dictionary"""
        return {
            "cells": self.get_cells_data(),
            "metadata": self.metadata,
            "file_path": self.file_path
        }
