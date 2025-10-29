# more-compute

An interactive notebook environment similar to Marimo and Google Colab that runs locally.

## Installation

### Windows

#### Prerequisites
**Node.js Required**: Download and install from https://nodejs.org/ (required for the web interface)

#### Quick Install
```powershell
# 1. Install uv (one-time setup)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# 2. Close and reopen PowerShell, then install more-compute
uv tool install more-compute

# 3. Add to PATH permanently (run once)
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable(
    "Path",
    "$userPath;$env:USERPROFILE\.local\bin",
    "User"
)

# 4. Restart PowerShell

# 5. Verify installation
more-compute --version
```

#### Troubleshooting Windows

**"more-compute is not recognized"**
1. Check if installed: `Test-Path $env:USERPROFILE\.local\bin\more-compute.exe`
2. Check PATH: `$env:Path -split ';' | Select-String ".local"`
3. **Must restart terminal** after PATH changes!

**"npm not found" or "Failed to start frontend"**
- Install Node.js from https://nodejs.org/
- Restart terminal after installation
- Verify: `npm --version`

**Port 8000 already in use**
```powershell
$env:MORECOMPUTE_PORT = "8080"
more-compute notebook.ipynb
```

### macOS/Linux

#### Recommended: Using uv
```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install more-compute
uv tool install more-compute

# Verify
more-compute --version
```

#### Alternative: Using pip
```bash
pip install more-compute
# Note: You may need to add to PATH manually. We recommend using uv.
```

## Usage

### Create a new notebook
```bash
more-compute new
```
This creates a timestamped notebook like `notebook_20241007_153302.ipynb`


### Open an existing notebook
```bash
# Open a specific notebook
more-compute your_notebook.ipynb

# Or run directly
python3 kernel_run.py your_notebook.ipynb

# If no path provided, opens default notebook
more-compute
```

## Development

To install in development mode:
```bash
pip install -e .
```
