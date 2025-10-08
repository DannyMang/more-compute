#!/bin/bash
# Auto-deploy script for PyPI

set -e  # Exit on error

echo "🚀 Starting PyPI deployment..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf build/ dist/ *.egg-info/

# Build distribution packages
echo "📦 Building distribution packages..."
python -m build

# Check the build
echo "✅ Validating packages..."
twine check dist/*

# Upload to PyPI
echo "📤 Uploading to PyPI..."
twine upload dist/*

echo "✨ Deployment complete!"
echo "View at: https://pypi.org/project/more-compute/"
