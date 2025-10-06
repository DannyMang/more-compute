"""Entry point for ZMQ worker process.

This allows running the worker via:
    python -m morecompute.execution.worker
"""

from .worker import worker_main

if __name__ == '__main__':
    worker_main()
