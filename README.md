# more-compute

[![PyPI Downloads](https://static.pepy.tech/personalized-badge/more-compute?period=total&units=INTERNATIONAL_SYSTEM&left_color=BLACK&right_color=GREEN&left_text=downloads)](https://pepy.tech/projects/more-compute)

[![PyPI version](https://badge.fury.io/py/more-compute.svg)](https://pypi.org/project/more-compute/)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An interactive Python notebook environment, similar to Marimo and Google Colab, that runs locally.


https://github.com/user-attachments/assets/8c7ec716-dade-4de2-ad37-71d328129c97


## Installation

**Prerequisites:**
- [Node.js](https://nodejs.org/) v20 (see `.nvmrc`)
- Python 3.12 (see `.python-version`)

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

Opens automatically at http://localhost:2718

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

### Option 1: Devcontainer 

Works on **Mac**, **Windows**, and **Linux** with identical environments.

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) and VS Code/Cursor with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).

1. Clone the repo and open in VS Code/Cursor
2. Press `Cmd/Ctrl + Shift + P` → "Dev Containers: Reopen in Container"
3. Wait for the container to build (first time takes a few minutes)
4. Run `more-compute new` in the terminal

### Option 2: Docker (No IDE Required)

```bash
# Build the image
docker build -t morecompute .

# Run with your notebooks mounted
docker run -p 3141:3141 -p 2718:2718 -v $(pwd):/notebooks morecompute
```

### Option 3: Native Setup

**Prerequisites:**
- Python 3.12 (install via [pyenv](https://github.com/pyenv/pyenv): `pyenv install 3.12`)
- Node.js 20 (install via [nvm](https://github.com/nvm-sh/nvm): `nvm install 20`)

```bash
# Clone and enter directory
git clone https://github.com/DannyMang/MORECOMPUTE.git
cd MORECOMPUTE

# Use pinned versions
pyenv local 3.12  # or: pyenv install 3.12 && pyenv local 3.12
nvm use           # reads .nvmrc automatically

# Create virtual environment and install
uv venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
uv pip install -e .

# Install frontend dependencies
cd frontend && npm ci && cd ..  # npm ci uses package-lock.json for exact versions

# Run
more-compute notebook.py
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MORECOMPUTE_PORT` | 3141 | Backend API port |
| `MORECOMPUTE_FRONTEND_PORT` | 2718 | Frontend UI port |

## License

MIT - see [LICENSE](LICENSE)
