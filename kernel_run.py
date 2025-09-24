#!/usr/bin/env python3

import subprocess
import sys
import os
import time
import signal
import threading
import webbrowser
from pathlib import Path

class NotebookLauncher:
    def __init__(self, use_new_frontend=False, debug=False):
        self.backend_process = None
        self.frontend_process = None
        self.root_dir = Path(__file__).parent
        self.use_new_frontend = use_new_frontend
        self.debug = debug

    def start_backend(self):
        """Start the FastAPI backend server"""
        try:
            # Start the FastAPI server using uvicorn
            self.backend_process = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "morecompute.server:app", 
                 "--host", "localhost", "--port", "8000"],
                cwd=self.root_dir,
                stdout=subprocess.DEVNULL if not self.debug else None,
                stderr=subprocess.DEVNULL if not self.debug else None
            )
            
        except Exception as e:
            print(f"Failed to start backend: {e}")
            sys.exit(1)

    def start_frontend(self):
        """Start the frontend server (Next.js or legacy)"""
        if self.use_new_frontend:
            try:
                frontend_dir = self.root_dir / "frontend"
                
                # Check if node_modules exists
                if not (frontend_dir / "node_modules").exists():
                    print("Installing dependencies...")
                    subprocess.run(
                        ["npm", "install"],
                        cwd=frontend_dir,
                        check=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                
                self.frontend_process = subprocess.Popen(
                    ["npm", "run", "dev"],
                    cwd=frontend_dir,
                    stdout=subprocess.DEVNULL if not self.debug else None,
                    stderr=subprocess.DEVNULL if not self.debug else None
                )
                
                # Wait a bit then open browser
                time.sleep(3)
                webbrowser.open("http://localhost:3000")
                
            except Exception as e:
                print(f"Failed to start frontend: {e}")
                self.cleanup()
                sys.exit(1)
        else:
            # Legacy frontend is served by backend
            time.sleep(2)
            webbrowser.open("http://localhost:8000")

    def cleanup(self):
        """Clean up processes on exit"""
        if self.frontend_process:
            self.frontend_process.terminate()
            try:
                self.frontend_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.frontend_process.kill()
                
        if self.backend_process:
            self.backend_process.terminate()
            try:
                self.backend_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.backend_process.kill()

    def run(self):
        """Main run method"""
        if self.use_new_frontend:
            print("\n        Edit notebook in your browser!")
            print("\n        ➜  URL: http://localhost:3000\n")
        else:
            print("\n        Edit notebook in your browser!")
            print("\n        ➜  URL: http://localhost:8000\n")
        
        # Set up signal handlers
        def signal_handler(signum, frame):
            print("\n\n        Thanks for using MoreCompute!\n")
            self.cleanup()
            sys.exit(0)
            
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
        
        # Start services
        self.start_backend()
        time.sleep(1)
        self.start_frontend()
        
        # Wait for processes
        try:
            while True:
                # Check if processes are still running
                if self.backend_process and self.backend_process.poll() is not None:
                    self.cleanup()
                    sys.exit(1)
                    
                if self.use_new_frontend and self.frontend_process and self.frontend_process.poll() is not None:
                    self.cleanup()
                    sys.exit(1)
                    
                time.sleep(1)
                
        except KeyboardInterrupt:
            print("\n\n        Thanks for using MoreCompute!\n")
            self.cleanup()

if __name__ == "__main__":
    # Check command line arguments
    use_new = len(sys.argv) > 1 and sys.argv[1].lower() == 'new'

    if len(sys.argv) > 1 and sys.argv[1] not in ['new', 'legacy']:
        print("Usage:")
        print("  python kernel_run.py         # Use legacy frontend (default)")
        print("  python kernel_run.py new      # Use new Next.js frontend")
        print("  python kernel_run.py legacy   # Explicitly use legacy frontend")
        sys.exit(1)

    launcher = NotebookLauncher(use_new_frontend=use_new)
    launcher.run()
