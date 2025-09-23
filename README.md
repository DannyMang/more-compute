# MoreCompute
An interactive notebook environment similar to Marimo and Google Colab that runs locally.

For references: 

https://marimo.io/
https://colab.google/


FOR LOCAL DEVELOPMENT:

```bash
pip install -e .
```

## Installation

```bash
(NOT IMPLEMENTED YET, TO-DO SET UP ON PyPi)
pip install morecompute
```

## Usage

### Create a new notebook
```bash
kernal_run new
```

### Open an existing notebook
```bash
kernal_run your_notebook.py
# or
kernal_run your_notebook.ipynb
```

## Features

- **Interactive notebook interface** similar to Google Colab
- **Support for both `.py` and `.ipynb` files**
- **Real-time cell execution** with execution timing
- **Magic commands** support:
  - `!pip install package_name` - Install Python packages
  - `!ls` - List directory contents
  - `!pwd` - Print working directory
  - `!any_shell_command` - Run any shell command
- **Visual execution feedback**:
  - ✅ Green check icon for successful execution
  - ❌ Red X icon for failed execution
  - Execution timing displayed for each cell
- **Local development environment** - runs on your machine
- **Web-based interface** accessible via localhost
- **Cell management**:
  - Add/delete cells
  - Drag and drop to reorder
  - Code and Markdown cell types

## Usage Examples

### Installing and Using Libraries
```python
# Install packages using magic commands (like Colab)
!pip install pandas numpy matplotlib

# Import and use them
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# Create some data
df = pd.DataFrame({
    'x': np.range(10),
    'y': np.random.randn(10)
})

print(df.head())
```

### Shell Commands
```bash
# List files
!ls -la

# Check current directory
!pwd

# Run any shell command
!echo "Hello from the shell!"
```

### Data Analysis Example
```python
# Load data
data = pd.read_csv('your_data.csv')

# Analyze
data.describe()

# Plot
plt.figure(figsize=(10, 6))
plt.plot(data['x'], data['y'])
plt.title('My Analysis')
plt.show()
```

## Development

To install in development mode:
```bash
pip install -e .
```
