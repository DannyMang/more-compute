#!/usr/bin/env python3

import argparse
import subprocess
import sys
import os
import time
import signal
import threading
import webbrowser
from pathlib import Path

from morecompute.notebook import Notebook
from morecompute.__version__ import __version__

DEFAULT_NOTEBOOK_NAME = "notebook.ipynb"

class NotebookLauncher:
    def __init__(self, notebook_path: Path, debug=False):
        self.backend_process = None
        self.frontend_process = None
        self.root_dir = Path(__file__).parent
        self.debug = debug
        self.notebook_path = notebook_path
        root_dir = notebook_path.parent if notebook_path.parent != Path('') else Path.cwd()
        os.environ["MORECOMPUTE_ROOT"] = str(root_dir.resolve())
        os.environ["MORECOMPUTE_NOTEBOOK_PATH"] = str(self.notebook_path)

    def start_backend(self):
        """Start the FastAPI backend server"""
        try:
            # Force a stable port (default 8000); if busy, ask to free it
            chosen_port = int(os.getenv("MORECOMPUTE_PORT", "8000"))
            self._ensure_port_available(chosen_port)
            cmd = [
                sys.executable,
                "-m",
                "uvicorn",
                "morecompute.server:app",
                "--host",
                "localhost",
                "--port",
                str(chosen_port),
            ]

            # Enable autoreload only when debugging or explicitly requested
            enable_reload = (
                self.debug
                or os.getenv("MORECOMPUTE_RELOAD", "0") == "1"
            )
            if enable_reload:
                # Limit reload scope to backend code and exclude large/changing artifacts
                cmd.extend([
                    "--reload",
                    "--reload-dir", "morecompute",
                    "--reload-exclude", "*.ipynb",
                    "--reload-exclude", "frontend",
                    "--reload-exclude", "assets",
                ])

            if not self.debug:
                cmd.extend(["--log-level", "error", "--no-access-log"])

            stdout_dest = None if self.debug else subprocess.DEVNULL
            stderr_dest = None if self.debug else subprocess.DEVNULL

            # Start the FastAPI server using uvicorn
            self.backend_process = subprocess.Popen(
                cmd,
                cwd=self.root_dir,
                stdout=stdout_dest,
                stderr=stderr_dest,
            )
            # Save for later printing/opening
            self.backend_port = chosen_port
        except Exception as e:
            print(f"Failed to start backend: {e}")
            sys.exit(1)

    def _ensure_port_available(self, port: int) -> None:
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return  # free
            except OSError:
                pass  # in use
        # Port is in use - show processes and ask to kill
        print(f"\nPort {port} appears to be in use.")
        pids = []
        try:
            out = subprocess.check_output(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"]).decode("utf-8", errors="ignore")
            print(out)
            for line in out.splitlines()[1:]:
                parts = line.split()
                if len(parts) > 1 and parts[1].isdigit():
                    pids.append(int(parts[1]))
        except Exception:
            print("Could not list processes with lsof. You may need to free the port manually.")
        resp = input(f"Kill processes on port {port} and continue? [y/N]: ").strip().lower()
        if resp != "y":
            print("Aborting. Set MORECOMPUTE_PORT to a different port to override.")
            sys.exit(1)
        # Attempt to kill
        for pid in pids:
            try:
                os.kill(pid, 9)
            except Exception:
                pass
        # Fallback: kill known patterns
        try:
            subprocess.run(["pkill", "-f", "uvicorn .*morecompute.server:app"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
        try:
            subprocess.run(["pkill", "-f", "morecompute.execution.worker"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
        # Brief pause to let the OS release the port
        time.sleep(0.5)
        # Poll until it binds
        start = time.time()
        while time.time() - start < 5.0:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s2:
                s2.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:
                    s2.bind(("127.0.0.1", port))
                    return
                except OSError:
                    time.sleep(0.25)
        print(f"Port {port} still busy. Please free it or set MORECOMPUTE_PORT to another port.")
        sys.exit(1)

    def start_frontend(self):
        """Start the Next.js frontend server"""
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

            fe_stdout = None if self.debug else subprocess.DEVNULL
            fe_stderr = None if self.debug else subprocess.DEVNULL

            self.frontend_process = subprocess.Popen(
                ["npm", "run", "dev"],
                cwd=frontend_dir,
                stdout=fe_stdout,
                stderr=fe_stderr
            )

            # Wait a bit then open browser
            time.sleep(3)
            webbrowser.open("http://localhost:3000")

        except Exception as e:
            print(f"Failed to start frontend: {e}")
            self.cleanup()
            sys.exit(1)

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
        print("\n        Edit notebook in your browser!\n")
        print("        ➜  URL: http://localhost:3000\n")

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

                if self.frontend_process and self.frontend_process.poll() is not None:
                    self.cleanup()
                    sys.exit(1)

                time.sleep(1)

        except KeyboardInterrupt:
            print("\n\n        Thanks for using MoreCompute!\n")
            self.cleanup()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Launch the MoreCompute notebook")
    parser.add_argument(
        "--version",
        "-v",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    parser.add_argument(
        "notebook_path",
        nargs="?",
        default=None,
        help="Path to the .ipynb notebook file",
    )
    parser.add_argument(
        "-debug",
        "--debug",
        action="store_true",
        help="Show backend/frontend logs (hidden by default)",
    )
    return parser


def ensure_notebook_exists(notebook_path: Path):
    if notebook_path.exists():
        if notebook_path.suffix != '.ipynb':
            raise ValueError("Notebook path must be a .ipynb file")
        return

    if notebook_path.suffix != '.ipynb':
        raise ValueError("Notebook path must end with .ipynb")

    notebook_path.parent.mkdir(parents=True, exist_ok=True)
    notebook = Notebook()
    notebook.save_to_file(str(notebook_path))


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    raw_notebook_path = args.notebook_path

    if raw_notebook_path == "new":
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        raw_notebook_path = f"notebook_{timestamp}.ipynb"
        print(f"Creating new notebook: {raw_notebook_path}")

    notebook_path_env = os.getenv("MORECOMPUTE_NOTEBOOK_PATH")
    if raw_notebook_path is None:
        raw_notebook_path = notebook_path_env

    if raw_notebook_path is None:
        raw_notebook_path = DEFAULT_NOTEBOOK_NAME

    notebook_path = Path(raw_notebook_path).expanduser().resolve()
    ensure_notebook_exists(notebook_path)

    launcher = NotebookLauncher(
        notebook_path=notebook_path,
        debug=args.debug
    )
    launcher.run()


if __name__ == "__main__":
    main()
