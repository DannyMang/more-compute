#!/bin/bash
# Auto-deploy script for PyPI

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting PyPI deployment..."

# Build the frontend first
echo "Building frontend..."
bash scripts/build_frontend.sh

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf build/ dist/ *.egg-info/

# Build distribution packages
echo "Building distribution packages..."
python -m build

# Check the build
echo "Validating packages..."
twine check dist/*

# Upload to PyPI
echo "Uploading to PyPI..."
twine upload dist/*

echo "Deployment complete!"
echo "View at: https://pypi.org/project/more-compute/"
