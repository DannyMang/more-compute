#!/usr/bin/env python3

import argparse
import subprocess
import sys
import os
import time
import signal
import threading
import webbrowser
import platform
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
        self.is_windows = platform.system() == "Windows"
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
        """Cross-platform port availability check and cleanup"""
        import socket

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return  # Port is free
            except OSError:
                pass  # Port is in use

        print(f"\nPort {port} is currently in use.")
        pids = []

        try:
            if self.is_windows:
                # Windows: Use netstat
                out = subprocess.check_output(
                    ["netstat", "-ano"],
                    text=True,
                    encoding='utf-8',
                    errors='replace'
                )
                for line in out.splitlines():
                    if f":{port}" in line and "LISTENING" in line:
                        parts = line.split()
                        if parts and parts[-1].isdigit():
                            pid = int(parts[-1])
                            if pid not in pids:
                                pids.append(pid)
                                # Get process name
                                try:
                                    proc_out = subprocess.check_output(
                                        ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                                        text=True,
                                        encoding='utf-8',
                                        errors='replace'
                                    )
                                    proc_name = proc_out.split(',')[0].strip('"')
                                    print(f"  PID {pid}: {proc_name}")
                                except Exception:
                                    print(f"  PID {pid}")
            else:
                # Unix: Use lsof
                out = subprocess.check_output(
                    ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"],
                    text=True,
                    encoding='utf-8',
                    errors='replace'
                )
                print(out)
                for line in out.splitlines()[1:]:
                    parts = line.split()
                    if len(parts) > 1 and parts[1].isdigit():
                        pids.append(int(parts[1]))
        except Exception as e:
            print(f"Could not list processes: {e}")

        if not pids:
            print(f"Could not find process using port {port}.")
            print("Please free the port manually or set MORECOMPUTE_PORT to a different port.")
            sys.exit(1)

        resp = input(f"Kill process(es) on port {port} and continue? [y/N]: ").strip().lower()
        if resp != "y":
            print("Aborting. Set MORECOMPUTE_PORT to a different port to override.")
            sys.exit(1)

        # Kill processes
        for pid in pids:
            try:
                if self.is_windows:
                    subprocess.run(
                        ["taskkill", "/F", "/PID", str(pid)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        encoding='utf-8',
                        errors='replace'
                    )
                else:
                    os.kill(pid, signal.SIGKILL)
            except Exception as e:
                print(f"Failed to kill PID {pid}: {e}")

        # Fallback: kill known patterns (Unix only)
        if not self.is_windows:
            try:
                subprocess.run(["pkill", "-f", "uvicorn .*morecompute.server:app"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception:
                pass
            try:
                subprocess.run(["pkill", "-f", "morecompute.execution.worker"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception:
                pass

        # Windows needs more time to release ports
        time.sleep(1.0 if self.is_windows else 0.5)

        # Poll until port is available
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

            # Use Windows-specific npm command
            npm_cmd = "npm.cmd" if self.is_windows else "npm"

            # Verify npm exists
            try:
                subprocess.run(
                    [npm_cmd, "--version"],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    shell=self.is_windows,
                    encoding='utf-8',
                    errors='replace'
                )
            except (subprocess.CalledProcessError, FileNotFoundError):
                print("\nError: npm not found. Please install Node.js from https://nodejs.org/")
                print("After installation, restart your terminal and try again.")
                self.cleanup()
                sys.exit(1)

            # Check if node_modules exists
            if not (frontend_dir / "node_modules").exists():
                print("Installing dependencies (this may take a minute)...")
                try:
                    subprocess.run(
                        [npm_cmd, "install", "--no-audit", "--no-fund"],
                        cwd=frontend_dir,
                        check=True,
                        shell=self.is_windows,
                        encoding='utf-8',
                        errors='replace'
                    )
                    print("Dependencies installed successfully!")
                except subprocess.CalledProcessError as e:
                    print(f"\nError installing dependencies: {e}")
                    print("Try running manually:")
                    print(f"  cd {frontend_dir}")
                    print("  npm install")
                    self.cleanup()
                    sys.exit(1)

            fe_stdout = None if self.debug else subprocess.DEVNULL
            fe_stderr = None if self.debug else subprocess.DEVNULL

            self.frontend_process = subprocess.Popen(
                [npm_cmd, "run", "dev"],
                cwd=frontend_dir,
                stdout=fe_stdout,
                stderr=fe_stderr,
                shell=self.is_windows,  # CRITICAL for Windows
                encoding='utf-8',
                errors='replace'
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
            try:
                if self.is_windows:
                    # Windows: Use taskkill for more reliable cleanup
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(self.frontend_process.pid)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                else:
                    self.frontend_process.terminate()
                    try:
                        self.frontend_process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self.frontend_process.kill()
            except Exception:
                pass

        if self.backend_process:
            try:
                if self.is_windows:
                    # Windows: Use taskkill for more reliable cleanup
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(self.backend_process.pid)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                else:
                    self.backend_process.terminate()
                    try:
                        self.backend_process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self.backend_process.kill()
            except Exception:
                pass

    def run(self):
        """Main run method"""
        print("\n        Edit notebook in your browser!\n")
        print("        ➜  URL: http://localhost:3000\n")

        # Set up signal handlers
        def signal_handler(signum, frame):
            # Shutdown immediately on Ctrl+C
            print("\nREMINDER: Any running GPU pods will continue to incur costs until you terminate them in the Compute popup.")
            print("\n        Thanks for using MoreCompute!\n")
            self.cleanup()
            sys.exit(0)

        # Windows signal handling is different
        if not self.is_windows:
            signal.signal(signal.SIGINT, signal_handler)
            signal.signal(signal.SIGTERM, signal_handler)
        else:
            # Windows only supports SIGINT and SIGBREAK
            signal.signal(signal.SIGINT, signal_handler)

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
