#!/bin/bash
# Build the frontend and copy to morecompute/_static/

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$PROJECT_DIR/frontend"
STATIC_DIR="$PROJECT_DIR/morecompute/_static"

echo "Building frontend for production..."

# Navigate to frontend directory
cd "$FRONTEND_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install --no-audit --no-fund
fi

# Build the frontend (static export)
echo "Running Next.js build..."
npm run build

# Clean old static files
echo "Cleaning old static files..."
rm -rf "$STATIC_DIR"
mkdir -p "$STATIC_DIR"

# Copy built files to _static directory
echo "Copying built files to morecompute/_static/..."
cp -r "$FRONTEND_DIR/out/"* "$STATIC_DIR/"

echo "Frontend build complete!"
echo "Static files are in: $STATIC_DIR"
