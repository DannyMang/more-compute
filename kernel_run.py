#!/usr/bin/env python3

import sys
if sys.version_info < (3, 10):
    print(f"Error: more-compute requires Python 3.10 or higher.")
    print(f"You are using Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")
    print()
    print("To fix this:")
    print("  1. Uninstall: uv tool uninstall more-compute")
    print("  2. Reinstall with specific version: uv tool install more-compute==0.4.1")
    print("     (uv will automatically download Python 3.10+ for you)")
    print()
    print("Or upgrade your system Python: https://www.python.org/downloads/")
    sys.exit(1)

import argparse
import subprocess
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
        self.cleaning_up = False  # Flag to prevent multiple cleanup calls
        self.frontend_port = int(os.getenv("MORECOMPUTE_FRONTEND_PORT", "2718"))
        root_dir = notebook_path.parent if notebook_path.parent != Path('') else Path.cwd()
        os.environ["MORECOMPUTE_ROOT"] = str(root_dir.resolve())
        os.environ["MORECOMPUTE_NOTEBOOK_PATH"] = str(self.notebook_path)

    def start_backend(self):
        """Start the FastAPI backend server"""
        try:
            # Force a stable port (default 3141); if busy, ask to free it
            chosen_port = int(os.getenv("MORECOMPUTE_PORT", "3141"))
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

            # Set PORT environment variable for Next.js
            frontend_env = os.environ.copy()
            frontend_env["PORT"] = str(self.frontend_port)

            self.frontend_process = subprocess.Popen(
                [npm_cmd, "run", "dev"],
                cwd=frontend_dir,
                env=frontend_env,
                stdout=fe_stdout,
                stderr=fe_stderr,
                shell=self.is_windows,  # CRITICAL for Windows
                encoding='utf-8',
                errors='replace'
            )

            # Wait a bit then open browser
            time.sleep(3)
            webbrowser.open(f"http://localhost:{self.frontend_port}")

        except Exception as e:
            print(f"Failed to start frontend: {e}")
            self.cleanup()
            sys.exit(1)

    def cleanup(self, force=False):
        """Clean up processes on exit"""
        if self.cleaning_up:
            return  # Already cleaning up, don't run again
        self.cleaning_up = True

        timeout = 0.5 if force else 2  # Shorter timeout on force exit

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
                    if force:
                        self.frontend_process.kill()  # Force kill immediately
                    else:
                        self.frontend_process.terminate()
                        try:
                            self.frontend_process.wait(timeout=timeout)
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
                    if force:
                        self.backend_process.kill()  # Force kill immediately
                    else:
                        self.backend_process.terminate()
                        try:
                            self.backend_process.wait(timeout=timeout)
                        except subprocess.TimeoutExpired:
                            self.backend_process.kill()
            except Exception:
                pass

    def run(self):
        """Main run method"""
        print("\n        Edit notebook in your browser!\n")
        print(f"        ➜  URL: http://localhost:{self.frontend_port}\n")

        # Track Ctrl+C presses
        interrupt_count = [0]  # Use list to allow modification in nested function

        # Set up signal handlers
        def signal_handler(signum, frame):
            interrupt_count[0] += 1
            if interrupt_count[0] == 1:
                print("\n\nREMINDER: Any running GPU pods will continue to incur costs until you terminate them in the Compute popup.")
                print("[CTRL-C AGAIN TO EXIT]")
            else:
                print("\n        Thanks for using MoreCompute!\n")
                self.cleanup(force=True)  # Force immediate cleanup
                os._exit(0)  # Hard exit without raising SystemExit

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
            # This shouldn't be reached due to signal handler, but keep as fallback
            print("\n\n        Thanks for using MoreCompute!\n")
            self.cleanup()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="more-compute",
        description="MoreCompute - Jupyter notebooks with GPU compute",
        add_help=False,
    )
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
        help="Show backend/frontend logs",
    )
    parser.add_argument(
        "-h",
        "--help",
        action="store_true",
        help="Show this help message",
    )
    return parser


def ensure_notebook_exists(notebook_path: Path):
    if notebook_path.exists():
        # File exists, check extension
        if notebook_path.suffix == '.ipynb':
            raise ValueError(
                f"Error: MoreCompute only supports .py notebooks.\n\n"
                f"Convert your notebook with:\n"
                f"  more-compute convert {notebook_path.name} -o {notebook_path.stem}.py\n\n"
                f"Then open with:\n"
                f"  more-compute {notebook_path.stem}.py"
            )
        elif notebook_path.suffix != '.py':
            raise ValueError(
                f"Error: '{notebook_path}' is not a Python notebook file.\n"
                f"Notebook files must have a .py extension.\n"
                f"Example: more-compute {notebook_path.stem}.py"
            )
        return

    # File doesn't exist, create it
    if notebook_path.suffix == '.ipynb':
        raise ValueError(
            f"Error: MoreCompute only supports .py notebooks.\n\n"
            f"Convert your notebook with:\n"
            f"  more-compute convert {notebook_path.name} -o {notebook_path.stem}.py\n\n"
            f"Or create a new notebook:\n"
            f"  more-compute new"
        )

    if notebook_path.suffix != '.py':
        raise ValueError(
            f"Error: '{notebook_path}' does not have the .py extension.\n"
            f"Notebook files must end with .py\n\n"
            f"Did you mean?\n"
            f"  more-compute {notebook_path}.py\n\n"
            f"Or to create a new notebook:\n"
            f"  more-compute new"
        )

    notebook_path.parent.mkdir(parents=True, exist_ok=True)
    notebook = Notebook()
    notebook.save_to_file(str(notebook_path))


def print_help():
    """Print concise help message"""
    print(f"""Usage: more-compute [OPTIONS] [COMMAND] [NOTEBOOK]

MoreCompute - Python notebooks with GPU compute

Getting started:

  * more-compute new              create a new notebook with timestamp
  * more-compute notebook.py      open or create notebook.py

Commands:
  convert NOTEBOOK -o OUTPUT      convert .ipynb to .py format
    Example: more-compute convert notebook.ipynb -o notebook.py

Options:
  --version, -v                   Show version and exit
  --debug                         Show backend/frontend logs
  --help, -h                      Show this message and exit

Environment variables:
  MORECOMPUTE_PORT                Backend port (default: 3141)
  MORECOMPUTE_FRONTEND_PORT       Frontend port (default: 2718)
  MORECOMPUTE_NOTEBOOK_PATH       Default notebook path

Note: MoreCompute uses .py notebooks (not .ipynb). Convert existing notebooks with:
  more-compute convert notebook.ipynb -o notebook.py
""")

def main(argv=None):
    # Handle convert command before argparse (to avoid parsing -o flag)
    argv_to_check = argv if argv is not None else sys.argv[1:]
    if len(argv_to_check) > 0 and argv_to_check[0] == "convert":
        # Parse convert arguments
        if len(sys.argv) < 3:
            print("Error: convert command requires input file")
            print("\nUsage:")
            print("  more-compute convert notebook.ipynb         # -> notebook.py")
            print("  more-compute convert notebook.py            # -> notebook.ipynb")
            print("  more-compute convert notebook.ipynb -o out.py")
            sys.exit(1)

        input_file = Path(sys.argv[2])
        output_file = None

        # Parse -o flag
        if len(sys.argv) >= 5 and sys.argv[3] == "-o":
            output_file = Path(sys.argv[4])
        else:
            # Auto-detect output extension based on input
            if input_file.suffix == '.ipynb':
                output_file = input_file.with_suffix('.py')
            elif input_file.suffix == '.py':
                output_file = input_file.with_suffix('.ipynb')
            else:
                print(f"Error: Unsupported file type: {input_file.suffix}")
                print("Supported: .ipynb, .py")
                sys.exit(1)

        if not input_file.exists():
            print(f"Error: File not found: {input_file}")
            sys.exit(1)

        # Perform conversion based on input type
        if input_file.suffix == '.ipynb':
            from morecompute.utils.notebook_converter import convert_ipynb_to_py
            try:
                convert_ipynb_to_py(input_file, output_file)
                sys.exit(0)
            except Exception as e:
                print(f"Error converting notebook: {e}")
                sys.exit(1)
        elif input_file.suffix == '.py':
            from morecompute.utils.notebook_converter import convert_py_to_ipynb
            try:
                convert_py_to_ipynb(input_file, output_file)
                sys.exit(0)
            except Exception as e:
                print(f"Error converting notebook: {e}")
                sys.exit(1)
        else:
            print(f"Error: Can only convert .ipynb or .py files")
            print(f"Got: {input_file.suffix}")
            sys.exit(1)


    # Parse arguments for non-convert commands
    parser = build_parser()
    args = parser.parse_args(argv)

    # Show help if requested or no arguments provided
    if args.help or (args.notebook_path is None and os.getenv("MORECOMPUTE_NOTEBOOK_PATH") is None):
        print_help()
        sys.exit(0)

    raw_notebook_path = args.notebook_path

    # Handle "new" command
    if raw_notebook_path == "new":
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        raw_notebook_path = f"notebook_{timestamp}.py"
        print(f"Creating new notebook: {raw_notebook_path}")

    notebook_path_env = os.getenv("MORECOMPUTE_NOTEBOOK_PATH")
    if raw_notebook_path is None:
        raw_notebook_path = notebook_path_env

    if raw_notebook_path is None:
        print_help()
        sys.exit(0)

    notebook_path = Path(raw_notebook_path).expanduser().resolve()

    try:
        ensure_notebook_exists(notebook_path)
    except ValueError as e:
        # Print clean error message without traceback
        print(str(e), file=sys.stderr)
        sys.exit(1)

    launcher = NotebookLauncher(
        notebook_path=notebook_path,
        debug=args.debug
    )
    launcher.run()


if __name__ == "__main__":
    main()
