# more-compute
An interactive notebook environment similar to Marimo and Google Colab that runs locally.

## Installation

### Recommended: Using uv
```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install more-compute
uv tool install more-compute
```

### Alternative: Using pip
```bash
pip install more-compute
# you have to add to path manually, I highly recommend using uv
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
