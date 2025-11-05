# more-compute

[![PyPI version](https://badge.fury.io/py/more-compute.svg)](https://pypi.org/project/more-compute/)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An interactive Python notebook environment, similar to Marimo and Google Colab, that runs locally.


https://github.com/user-attachments/assets/8c7ec716-dade-4de2-ad37-71d328129c97


## Installation

**Prerequisites:**
- [Node.js](https://nodejs.org/) >= 20.10.0 required for web interface
- Python >= 3.10 (uv installs this automatically, pip users need to install manually)

### Using uv (Recommended)

```bash
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install more-compute

# Windows
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
uv tool install more-compute
```

### Using pip

```bash
pip install more-compute

# Add to PATH if needed:
# macOS/Linux: echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
# Windows: See troubleshooting below
```

## Usage

```bash
more-compute notebook.py     # Open existing notebook
more-compute new             # Create new notebook
more-compute --debug         # Show logs
```

Opens automatically at http://localhost:3141

### Converting Between Formats

MoreCompute uses `.py` notebooks with `# %%` cell markers, but you can convert to/from `.ipynb`:

**From .ipynb to .py:**
```bash
# Auto-detect output name (notebook.ipynb -> notebook.py)
more-compute convert notebook.ipynb

# Or specify output
more-compute convert notebook.ipynb -o my_notebook.py

# Then open in MoreCompute
more-compute my_notebook.py
```

The converter automatically extracts dependencies from `!pip install` commands and adds UV inline script metadata.

**From .py to .ipynb:**
```bash
# Auto-detect output name (notebook.py -> notebook.ipynb)
more-compute convert notebook.py

# Or specify output
more-compute convert notebook.py -o colab_notebook.ipynb
```

This makes your notebooks compatible with Google Colab, Jupyter, and other tools that require `.ipynb` format.

## Troubleshooting

will add things here as things progress...

## Development

```bash
git clone https://github.com/DannyMang/MORECOMPUTE.git
cd MORECOMPUTE
uv venv && source .venv/bin/activate
uv pip install -e .
cd frontend && npm install && cd ..
more-compute notebook.py
```

## License

MIT - see [LICENSE](LICENSE)
