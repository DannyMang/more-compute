"""
MoreCompute: An interactive, real-time Python notebook
"""

__version__ = "0.1.0"

# Expose key components for uvicorn and other integrations
from .server import app
