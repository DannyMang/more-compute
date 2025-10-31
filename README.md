# more-compute

[![PyPI version](https://badge.fury.io/py/more-compute.svg)](https://pypi.org/project/more-compute/)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An interactive notebook environment, similar to Marimo and Google Colab, that runs locally. It works with standard `.ipynb` files, similar to Jupyter Lab but more awesome.


https://github.com/user-attachments/assets/cc3de03c-bcd7-4e28-893c-d5488312c11c


## Installation

**Prerequisites:** [Node.js](https://nodejs.org/) >= 20.10.0 required for web interface

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
more-compute notebook.ipynb  # Open existing notebook
more-compute                 # Create and open new notebook
more-compute --debug         # Show logs
```

Opens automatically at http://localhost:8000

## Troubleshooting

**Command not found:**
```bash
uv tool update-shell  # Fixes PATH automatically
```

**Manual PATH fix (macOS/Linux):**
```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

**Manual PATH fix (Windows):**
```powershell
$pythonScripts = python -c "import site; print(site.USER_BASE)"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$userPath;$pythonScripts\Scripts", "User")
# Restart PowerShell
```

**Port in use:**
```bash
export MORECOMPUTE_PORT=8080  # macOS/Linux
$env:MORECOMPUTE_PORT = "8080"  # Windows
```

## Development

```bash
git clone https://github.com/DannyMang/MORECOMPUTE.git
cd MORECOMPUTE
uv venv && source .venv/bin/activate
uv pip install -e .
cd frontend && npm install && cd ..
python kernel_run.py notebook.ipynb
```

## License

MIT - see [LICENSE](LICENSE)
