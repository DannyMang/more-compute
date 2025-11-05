import os
import io
import sys
import time
import asyncio
import shlex
import subprocess
import platform
from contextlib import redirect_stdout, redirect_stderr
from typing import Dict, Any, Optional
from fastapi import WebSocket

from .shell_utils import prepare_shell_command, prepare_shell_environment


class CellMagicHandlers:
    """Handlers for IPython cell magic commands (%%magic)"""

    def __init__(self, globals_dict: dict, special_handler):
        self.globals_dict = globals_dict
        self.special_handler = special_handler  # Reference to parent AsyncSpecialCommandHandler
        self.captured_outputs = {}

    async def execute_cell_content(self, cell_content: str, result: Dict[str, Any],
                                   execution_count: int, websocket: Optional[WebSocket] = None,
                                   capture_stdout: bool = False, capture_stderr: bool = False) -> tuple:
        """
        Execute cell content that may contain shell commands (!cmd) mixed with Python code.

        Uses preprocessing to transform shell commands into Python function calls.
        This approach properly handles shell commands inside control structures.

        Supported:
        - Shell commands on their own lines (can be indented): `!pip install pandas`
        - Shell commands in if/else blocks: `if x:\n    !ls`
        - Mixed Python and shell code in same cell
        - Async execution (non-blocking)
        - Cross-platform (Windows/macOS/Linux)

        Returns:
            (stdout_output, stderr_output) if capturing, otherwise (None, None)
        """
        stdout_capture = io.StringIO() if capture_stdout else None
        stderr_capture = io.StringIO() if capture_stderr else None

        # Store websocket reference for shell command execution
        self._current_websocket = websocket
        self._capture_mode = (capture_stdout or capture_stderr)

        # Use preprocessing approach for all cases
        # This transforms !cmd into function calls, preserving Python syntax
        transformed_code = await self._preprocess_cell_content(cell_content, capture_mode=(capture_stdout or capture_stderr))

        try:
            # Compile the code
            compiled_code = compile(transformed_code, '<cell>', 'exec')

            if capture_stdout or capture_stderr:
                # Execute with output capture in a thread pool to avoid blocking
                # This allows us to send heartbeats while long-running commands execute
                loop = asyncio.get_event_loop()

                def _exec_with_capture():
                    with redirect_stdout(stdout_capture or sys.stdout), \
                         redirect_stderr(stderr_capture or sys.stderr):
                        exec(compiled_code, self.globals_dict)

                # Run in thread pool
                exec_future = loop.run_in_executor(None, _exec_with_capture)

                # Send heartbeats while waiting
                heartbeat_count = 0
                while not exec_future.done():
                    heartbeat_count += 1
                    if websocket and heartbeat_count % 2 == 0:  # Every 2 seconds
                        try:
                            await websocket.send_json({
                                "type": "heartbeat",
                                "data": {"status": "executing", "message": "Executing cell..."}
                            })
                        except:
                            pass  # WebSocket might be closed
                    await asyncio.sleep(1)

                # Wait for completion
                await exec_future
            else:
                # Execute normally
                exec(compiled_code, self.globals_dict)
        except Exception as e:
            raise e
        finally:
            # Clean up websocket reference
            self._current_websocket = None
            self._capture_mode = False

        # Return captured outputs
        return (
            stdout_capture.getvalue() if stdout_capture else None,
            stderr_capture.getvalue() if stderr_capture else None
        )

    async def _execute_cell_with_async_shell(self, cell_content: str,
                                             stdout_capture: Optional[io.StringIO],
                                             stderr_capture: Optional[io.StringIO],
                                             websocket: Optional[WebSocket]) -> None:
        """
        Execute cell content line-by-line with async shell command execution.
        Used for %%capture mode to avoid blocking on long pip installs.
        """
        import re

        lines = cell_content.split('\n')
        python_lines = []

        for line in lines:
            # Check if this line is a shell command
            shell_match = re.match(r'^(\s*)!(.+)$', line)

            if shell_match:
                # Execute accumulated Python code first
                if python_lines:
                    python_code = '\n'.join(python_lines)
                    if stdout_capture or stderr_capture:
                        with redirect_stdout(stdout_capture or sys.stdout), \
                             redirect_stderr(stderr_capture or sys.stderr):
                            exec(compile(python_code, '<cell>', 'exec'), self.globals_dict)
                    else:
                        exec(compile(python_code, '<cell>', 'exec'), self.globals_dict)
                    python_lines = []

                # Execute shell command asynchronously
                shell_cmd = shell_match.group(2).strip()
                await self._run_shell_non_blocking(
                    shell_cmd, stdout_capture, stderr_capture, websocket
                )
            else:
                # Accumulate Python line
                python_lines.append(line)

        # Execute remaining Python code
        if python_lines:
            python_code = '\n'.join(python_lines)
            if stdout_capture or stderr_capture:
                with redirect_stdout(stdout_capture or sys.stdout), \
                     redirect_stderr(stderr_capture or sys.stderr):
                    exec(compile(python_code, '<cell>', 'exec'), self.globals_dict)
            else:
                exec(compile(python_code, '<cell>', 'exec'), self.globals_dict)

    async def _run_shell_non_blocking(self, cmd: str,
                                      stdout_capture: Optional[io.StringIO],
                                      stderr_capture: Optional[io.StringIO],
                                      websocket: Optional[WebSocket]) -> int:
        """
        Run shell command in thread pool executor (non-blocking).
        Sends periodic heartbeats to keep frontend alive during long operations.

        Returns:
            Return code from subprocess
        """
        loop = asyncio.get_event_loop()

        # Prepare platform-specific shell command
        system = platform.system()
        if system == 'Windows':
            shell_cmd = ['cmd', '/c', cmd]
        else:
            shell_cmd = ['/bin/bash', '-c', cmd]

        # Run blocking subprocess in thread pool
        shell_future = loop.run_in_executor(
            None,  # Uses default ThreadPoolExecutor
            lambda: subprocess.run(
                shell_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=os.environ.copy(),
                timeout=1800  # 30 minute timeout
            )
        )

        # Send heartbeats while waiting
        heartbeat_count = 0
        while not shell_future.done():
            heartbeat_count += 1
            if websocket and heartbeat_count % 2 == 0:  # Every 2 seconds
                try:
                    await websocket.send_json({
                        "type": "heartbeat",
                        "data": {"status": "executing", "message": "Running shell command..."}
                    })
                except:
                    pass  # WebSocket might be closed, continue anyway
            await asyncio.sleep(1)

        # Get result
        proc = await shell_future

        # Write captured output
        if stdout_capture and proc.stdout:
            stdout_capture.write(proc.stdout)
        if stderr_capture and proc.stderr:
            stderr_capture.write(proc.stderr)

        return proc.returncode

    async def _preprocess_cell_content(self, cell_content: str, capture_mode: bool = False) -> str:
        """
        Preprocess cell content to transform shell commands into Python code.
        This is how IPython handles !commands - it transforms them before execution.

        Args:
            cell_content: The cell content to preprocess
            capture_mode: Whether this is being called from %%capture (unused for now, but available for future use)

        Example:
            !pip install pandas  ->  _run_shell_command('pip install pandas')
        """
        import re

        lines = cell_content.split('\n')
        transformed_lines = []

        # Create a shell command executor function in globals if not exists
        # Use a closure to capture self reference for capture mode detection
        cell_magic_handler = self  # Capture self in closure

        if '_run_shell_command' not in self.globals_dict:
            def _run_shell_command(cmd: str):
                """Execute a shell command synchronously with streaming output (injected by cell magic handler)"""
                import subprocess
                import threading

                # Prepare command and environment (using shared utilities)
                shell_cmd = prepare_shell_command(cmd)
                env = prepare_shell_environment(cmd)

                # Stream output in real-time (like regular !commands)
                # Use Popen instead of run to get real-time output
                process = subprocess.Popen(
                    shell_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,  # Line buffered
                    env=env
                )

                # Track process for interrupt handling
                if hasattr(cell_magic_handler, 'special_handler'):
                    cell_magic_handler.special_handler.current_process_sync = process
                    print(f"[CELL_MAGIC] Tracking sync subprocess PID={process.pid}", file=sys.stderr, flush=True)

                # Read and print output line by line (real-time streaming)
                def read_stream(stream, output_type):
                    """Read stream line by line and print immediately"""
                    try:
                        for line in iter(stream.readline, ''):
                            if not line:
                                break
                            # Print immediately (unless in capture mode)
                            if not getattr(cell_magic_handler, '_capture_mode', False):
                                if output_type == 'stdout':
                                    print(line, end='')
                                    sys.stdout.flush()  # Force immediate flush for streaming
                                else:
                                    print(line, end='', file=sys.stderr)
                                    sys.stderr.flush()  # Force immediate flush for streaming
                    except Exception:
                        pass
                    finally:
                        stream.close()

                # Start threads to read stdout and stderr concurrently
                stdout_thread = threading.Thread(target=read_stream, args=(process.stdout, 'stdout'))
                stderr_thread = threading.Thread(target=read_stream, args=(process.stderr, 'stderr'))
                stdout_thread.daemon = True
                stderr_thread.daemon = True
                stdout_thread.start()
                stderr_thread.start()

                # Wait for process to complete, checking if it was killed
                try:
                    # Poll with timeout to detect if process was killed externally
                    while process.poll() is None:
                        try:
                            process.wait(timeout=0.1)
                        except subprocess.TimeoutExpired:
                            # Check if interrupted
                            if hasattr(cell_magic_handler, 'special_handler'):
                                if cell_magic_handler.special_handler.sync_interrupted:
                                    # Process was killed by interrupt handler
                                    print(f"[CELL_MAGIC] Process was interrupted, raising KeyboardInterrupt", file=sys.stderr, flush=True)
                                    raise KeyboardInterrupt("Execution interrupted by user")

                    return_code = process.returncode
                except KeyboardInterrupt:
                    # Kill process if KeyboardInterrupt
                    try:
                        process.kill()
                        process.wait()
                    except Exception:
                        pass
                    raise

                # Wait for output threads to finish
                stdout_thread.join(timeout=1)
                stderr_thread.join(timeout=1)

                # Clear process reference
                if hasattr(cell_magic_handler, 'special_handler'):
                    cell_magic_handler.special_handler.current_process_sync = None
                    print(f"[CELL_MAGIC] Cleared sync subprocess reference", file=sys.stderr, flush=True)

                return return_code

            self.globals_dict['_run_shell_command'] = _run_shell_command

        # Transform each line
        for line in lines:
            # Match shell commands: "    !pip install pandas"
            shell_match = re.match(r'^(\s*)!(.+)$', line)

            if shell_match:
                indent = shell_match.group(1)
                shell_cmd = shell_match.group(2).strip()

                # Use repr() for proper escaping of quotes and backslashes
                # This handles all edge cases correctly
                shell_cmd_repr = repr(shell_cmd)

                # Transform to synchronous function call
                # This preserves Python syntax (shell command becomes valid Python)
                transformed = f"{indent}_run_shell_command({shell_cmd_repr})"
                transformed_lines.append(transformed)
            else:
                # Regular Python line
                transformed_lines.append(line)

        return '\n'.join(transformed_lines)

    async def handle_capture(self, args: list, cell_content: str, result: Dict[str, Any],
                            start_time: float, execution_count: int,
                            websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %%capture magic - capture stdout/stderr without displaying.
        Usage: %%capture [output_var] [--no-stdout] [--no-stderr] [--no-display]
        """
        output_var = None
        no_stdout = "--no-stdout" in args
        no_stderr = "--no-stderr" in args

        # First non-flag argument is the output variable name
        for arg in args:
            if not arg.startswith('--'):
                output_var = arg
                break

        capture_stdout = not no_stdout
        capture_stderr = not no_stderr

        try:
            stdout_text, stderr_text = await self.execute_cell_content(
                cell_content, result, execution_count, websocket,
                capture_stdout, capture_stderr
            )

            # Store captured output in a variable if specified
            if output_var:
                captured_data = {
                    'stdout': stdout_text or '',
                    'stderr': stderr_text or ''
                }
                self.globals_dict[output_var] = captured_data
                self.captured_outputs[output_var] = captured_data

            # Check if there were any errors in stderr (pip failures, etc.)
            if stderr_text and stderr_text.strip():
                # Check for common error indicators
                stderr_lower = stderr_text.lower()
                if any(err in stderr_lower for err in ['error:', 'failed', 'could not', 'unable to']):
                    # Add a warning output (not a full error, just FYI)
                    result["outputs"].append({
                        "output_type": "stream",
                        "name": "stderr",
                        "text": f" Captured stderr (may contain errors):\n{stderr_text[:500]}{'...' if len(stderr_text) > 500 else ''}\n"
                    })

            # Don't add outputs to result (they're captured, not displayed)
            result["status"] = "ok"

            # Check if pip install/uninstall occurred and notify
            if websocket and ('pip install' in cell_content or 'pip uninstall' in cell_content):
                try:
                    await websocket.send_json({
                        "type": "packages_updated",
                        "data": {"action": "pip"}
                    })
                except Exception:
                    pass  # Ignore websocket errors

            if websocket:
                await websocket.send_json({
                    "type": "execution_complete",
                    "data": {
                        "status": "ok",
                        "message": "Output captured" + (f" in variable '{output_var}'" if output_var else "")
                    }
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"Capture magic error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {"error": result["error"]}
                })

        return result

    async def handle_time(self, cell_content: str, result: Dict[str, Any],
                         start_time: float, execution_count: int,
                         websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %%time magic - time cell execution and display results.
        """
        try:
            # Record start time
            cell_start = time.time()
            cpu_start = time.process_time()

            # Execute cell content
            await self.execute_cell_content(
                cell_content, result, execution_count, websocket
            )

            # Calculate timing
            wall_time = time.time() - cell_start
            cpu_time = time.process_time() - cpu_start

            # Format timing output
            timing_output = f"CPU times: user {cpu_time:.2f} s, sys: 0 s, total: {cpu_time:.2f} s\n"
            timing_output += f"Wall time: {wall_time:.2f} s"

            # Add timing as stream output
            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": timing_output + "\n"
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {
                        "stream": "stdout",
                        "text": timing_output + "\n"
                    }
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"Time magic error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {"error": result["error"]}
                })

        return result

    async def handle_timeit(self, args: list, cell_content: str, result: Dict[str, Any],
                           start_time: float, execution_count: int,
                           websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %%timeit magic - time cell execution using timeit module.
        Options: -n<N> (iterations), -r<R> (repeats), -q (quiet)
        """
        import timeit

        # Parse arguments
        number = None
        repeat = 7
        quiet = '-q' in args

        for arg in args:
            if arg.startswith('-n'):
                number = int(arg[2:])
            elif arg.startswith('-r'):
                repeat = int(arg[2:])

        try:
            # Create a timer
            timer = timeit.Timer(
                stmt=cell_content,
                globals=self.globals_dict
            )

            # Auto-determine number of iterations if not specified
            if number is None:
                # Determine number of loops automatically
                for i in range(1, 10):
                    n = 10 ** i
                    try:
                        t = timer.timeit(n)
                        if t >= 0.2:
                            number = n
                            break
                    except:
                        number = 1
                        break
                if number is None:
                    number = 10 ** 7

            # Run the timing
            all_runs = timer.repeat(repeat=repeat, number=number)
            best = min(all_runs) / number

            # Format output
            if best < 1e-6:
                timing_str = f"{best * 1e9:.0f} ns"
            elif best < 1e-3:
                timing_str = f"{best * 1e6:.0f} µs"
            elif best < 1:
                timing_str = f"{best * 1e3:.0f} ms"
            else:
                timing_str = f"{best:.2f} s"

            output_text = f"{timing_str} ± {(max(all_runs) - min(all_runs)) / number * 1e6:.0f} µs per loop (mean ± std. dev. of {repeat} runs, {number} loops each)\n"

            if not quiet:
                result["outputs"].append({
                    "output_type": "stream",
                    "name": "stdout",
                    "text": output_text
                })

                if websocket:
                    await websocket.send_json({
                        "type": "stream_output",
                        "data": {"stream": "stdout", "text": output_text}
                    })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"Timeit magic error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {"error": result["error"]}
                })

        return result

    async def handle_writefile(self, args: list, cell_content: str, result: Dict[str, Any],
                              start_time: float, websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %%writefile magic - write cell contents to file.
        Usage: %%writefile [-a/--append] filename
        """
        if not args:
            result["status"] = "error"
            result["error"] = {
                "ename": "UsageError",
                "evalue": "%%writefile requires a filename",
                "traceback": ["Usage: %%writefile [-a/--append] filename"]
            }
            return result

        append_mode = '-a' in args or '--append' in args
        filename = args[-1]  # Last argument is the filename

        try:
            mode = 'a' if append_mode else 'w'
            with open(filename, mode) as f:
                f.write(cell_content)
                if not cell_content.endswith('\n'):
                    f.write('\n')

            action = "Appending to" if append_mode else "Writing"
            output_text = f"{action} {filename}\n"

            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"Writefile magic error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {"error": result["error"]}
                })

        return result

    async def handle_bash(self, cell_content: str, result: Dict[str, Any],
                         start_time: float, websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %%bash / %%sh magic - run cell as bash script.
        """
        try:
            # Execute as shell script
            shell_result = {
                "outputs": [],
                "status": "ok"
            }

            # Write cell content to temporary script and execute
            import tempfile
            with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as f:
                f.write(cell_content)
                script_path = f.name

            try:
                await self.special_handler._execute_shell_command(
                    f"bash {script_path}", shell_result, start_time, websocket
                )

                # Merge results
                result["outputs"].extend(shell_result.get("outputs", []))
                if shell_result.get("status") == "error":
                    result["status"] = "error"
                    if "error" in shell_result:
                        result["error"] = shell_result["error"]
            finally:
                # Clean up temp file
                os.unlink(script_path)

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"Bash magic error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {"error": result["error"]}
                })

        return result

    async def handle_html(self, cell_content: str, result: Dict[str, Any],
                         start_time: float, websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %%html magic - render cell as HTML.
        """
        try:
            result["outputs"].append({
                "output_type": "display_data",
                "data": {
                    "text/html": cell_content,
                    "text/plain": f"<IPython.core.display.HTML object>"
                }
            })

            if websocket:
                await websocket.send_json({
                    "type": "display_data",
                    "data": {
                        "data": {
                            "text/html": cell_content
                        }
                    }
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"HTML magic error: {str(e)}"]
            }

        return result

    async def handle_markdown(self, cell_content: str, result: Dict[str, Any],
                             start_time: float, websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %%markdown magic - render cell as Markdown.
        """
        try:
            result["outputs"].append({
                "output_type": "display_data",
                "data": {
                    "text/markdown": cell_content,
                    "text/plain": f"<IPython.core.display.Markdown object>"
                }
            })

            if websocket:
                await websocket.send_json({
                    "type": "display_data",
                    "data": {
                        "data": {
                            "text/markdown": cell_content
                        }
                    }
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"Markdown magic error: {str(e)}"]
            }

        return result
