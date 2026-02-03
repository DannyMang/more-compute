# MoreCompute Development Container
# Provides reproducible environment for Mac, Windows, and Linux

FROM mcr.microsoft.com/devcontainers/python:1-3.12-bullseye

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /workspaces/MORECOMPUTE

# Copy dependency files first (for better caching)
COPY requirements.txt pyproject.toml setup.py ./
COPY morecompute/__version__.py ./morecompute/

# Install Python dependencies
RUN pip install --upgrade pip && \
    pip install -e . || pip install -r requirements.txt

# Node.js is installed via devcontainer features
# Frontend dependencies installed via postCreateCommand
