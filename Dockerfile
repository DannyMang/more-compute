# MoreCompute Docker Image
# Build: docker build -t morecompute .
# Run:   docker run -p 3141:3141 -p 2718:2718 -v $(pwd):/notebooks morecompute

FROM python:3.12-slim-bullseye

# Install Node.js 20
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Verify versions
RUN python --version && node --version && npm --version

WORKDIR /app

# Copy dependency files first (for caching)
COPY requirements.txt pyproject.toml setup.py kernel_run.py README.md ./
COPY morecompute/ ./morecompute/

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .

# Copy and install frontend
COPY frontend/ ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund

# Create notebooks directory
RUN mkdir -p /notebooks

# Expose ports
EXPOSE 3141 2718

# Set environment variables
ENV MORECOMPUTE_PORT=3141
ENV MORECOMPUTE_FRONTEND_PORT=2718

# Default command
WORKDIR /notebooks
CMD ["more-compute", "notebook.py"]
