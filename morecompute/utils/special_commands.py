import os
import io
import sys
import asyncio
import subprocess
import time
import shlex
import platform
from contextlib import redirect_stdout, redirect_stderr
from typing import Dict, Any, Optional, Tuple, Union
from fastapi import WebSocket

from .cell_magics import CellMagicHandlers
from .line_magics import LineMagicHandlers
from .shell_utils import prepare_shell_command, prepare_shell_environment


# this file is not tested that all functions work, need to write a test file / manually check
# to-do

class AsyncSpecialCommandHandler:
    """Handles all special commands asynchronously with streaming support: shell (!), line magics (%), and cell magics (%%)"""

    def __init__(self, globals_dict: dict):
        self.globals_dict = globals_dict
        self.captured_outputs = {}  # Store captured outputs from %%capture
        self.cell_magic_handlers = CellMagicHandlers(globals_dict, self)
        self.line_magic_handlers = LineMagicHandlers(globals_dict)

    def is_special_command(self, source_code: Union[str, list, tuple]) -> bool:
        """Check if the source code is a special command or contains shell commands"""
        text = self._coerce_source_to_text(source_code)
        stripped = text.strip()

        # Check if starts with magic or shell command
        if (stripped.startswith('!') or
            stripped.startswith('%%') or
            stripped.startswith('%')):
            return True

        # Check if ANY line contains a shell command (like Jupyter/Colab)
        # This allows mixing Python code with !commands
        lines = text.split('\n')
        for line in lines:
            if line.strip().startswith('!'):
                return True

        return False

    async def execute_special_command(self, source_code: Union[str, list, tuple], result: Dict[str, Any],
                                    start_time: float, execution_count: int,
                                    websocket: Optional[WebSocket] = None,
                                    cell_index: Optional[int] = None) -> Dict[str, Any]:
        """Execute a special command and return the result"""
        text = self._coerce_source_to_text(source_code)
        stripped = text.strip()

        if stripped.startswith('!'):
            return await self._execute_shell_command(stripped[1:], result, start_time, websocket, cell_index)
        elif stripped.startswith('%%'):
            return await self._execute_cell_magic(text, result, start_time, execution_count, websocket)
        elif stripped.startswith('%'):
            return await self._execute_line_magic(stripped[1:], result, start_time, websocket)

        # Cell contains shell commands mixed with Python code
        # Treat it like regular code execution but preprocess shell commands
        # This reuses the preprocessing logic from cell_magics.py
        try:
            stdout_text, stderr_text = await self.cell_magic_handlers.execute_cell_content(
                text, result, execution_count, websocket,
                capture_stdout=False, capture_stderr=False
            )
            result["status"] = "ok"
        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"Error executing cell: {str(e)}"]
            }

        # Calculate execution time
        result["execution_time"] = f"{(time.time() - start_time) * 1000:.1f}ms"
        return result

    def _coerce_source_to_text(self, source_code: Union[str, list, tuple]) -> str:
        """Normalize incoming source to a single text string"""
        try:
            if isinstance(source_code, str):
                return source_code
            if isinstance(source_code, (list, tuple)):
                return "".join(source_code)
            return str(source_code)
        except Exception:
            return ""

    async def _execute_shell_command(self, command: str, result: Dict[str, Any],
                                   start_time: float, websocket: Optional[WebSocket] = None,
                                   cell_index: Optional[int] = None) -> Dict[str, Any]:
        """Execute a shell command with real-time streaming output"""
        try:
            # Prepare environment and command for streaming (using shared utilities)
            env = prepare_shell_environment(command)
            cmd_parts = prepare_shell_command(command)

            # Send execution start notification
            if websocket:
                await websocket.send_json({
                    "type": "execution_start",
                    "data": {
                        "command": f"!{command}",
                        **({"cell_index": cell_index} if cell_index is not None else {})
                    }
                })

            # Create subprocess with streaming
            process = await asyncio.create_subprocess_exec(
                *cmd_parts,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                cwd=os.getcwd()
            )

            # Stream output concurrently
            stdout_task = asyncio.create_task(
                self._stream_output(process.stdout, "stdout", result, websocket, cell_index)
            )
            stderr_task = asyncio.create_task(
                self._stream_output(process.stderr, "stderr", result, websocket, cell_index)
            )

            # Wait for both streams to complete
            await asyncio.gather(stdout_task, stderr_task)

            # Wait for process completion
            return_code = await process.wait()

            # Send completion notification
            if websocket:
                await websocket.send_json({
                    "type": "execution_complete",
                    "data": {
                        "return_code": return_code,
                        "status": "error" if return_code != 0 else "ok",
                        **({"cell_index": cell_index} if cell_index is not None else {})
                    }
                })

            # If pip install/uninstall occurred, notify clients to refresh packages
            try:
                if websocket and (command.startswith('pip install') or command.startswith('pip uninstall') or 'pip install' in command or 'pip uninstall' in command):
                    # Small delay to ensure pip finishes writing metadata to disk
                    await asyncio.sleep(0.5)
                    await websocket.send_json({
                        "type": "packages_updated",
                        "data": {"action": "pip"}
                    })
            except Exception:
                pass

            # Check if command failed
            if return_code != 0:
                result["status"] = "error"
                # Only add generic error if we don't already have detailed stderr output
                # The detailed stderr is already in result["outputs"] from streaming
                has_stderr = any(o.get("name") == "stderr" and o.get("text", "").strip()
                               for o in result.get("outputs", []))
                if not has_stderr:
                    # No detailed error output, add generic error
                    result["error"] = {
                        "ename": "ShellCommandError",
                        "evalue": f"Command failed with return code {return_code}",
                        "traceback": [f"Shell command failed: {command}"]
                    }

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"Shell command error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {
                        "error": result["error"]
                    }
                })

        # Calculate execution time
        result["execution_time"] = f"{(time.time() - start_time) * 1000:.1f}ms"
        return result

    async def interrupt(self):
        # Placeholder for future process-based interruption logic
        return

    async def _stream_output(self, stream, stream_type: str, result: Dict[str, Any],
                           websocket: Optional[WebSocket] = None,
                           cell_index: Optional[int] = None):
        """Read from a stream and send to websocket, while capturing the output."""

        output_text = ""
        while True:
            try:
                line = await stream.readline()
                if not line:
                    break

                decoded_line = line.decode('utf-8')
                output_text += decoded_line

                if websocket:
                    await websocket.send_json({
                        "type": "stream_output",
                        "data": {
                            "stream": stream_type,
                            "text": decoded_line,
                            **({"cell_index": cell_index} if cell_index is not None else {})
                        }
                    })
            except asyncio.CancelledError:
                break
            except Exception as e:
                # Handle potential errors during streaming
                error_message = f"Error reading stream: {e}\n"
                output_text += error_message
                if websocket:
                    await websocket.send_json({
                        "type": "stream_output",
                        "data": {
                            "stream": "stderr",
                            "text": error_message,
                            **({"cell_index": cell_index} if cell_index is not None else {})
                        }
                    })
                break

        # Add the captured text to the final result object
        if output_text:
            # Look for an existing stream output of the same type to append to
            existing_output = next((o for o in result["outputs"] if o.get("name") == stream_type), None)
            if existing_output:
                existing_output["text"] += output_text
            else:
                result["outputs"].append({
                    "output_type": "stream",
                    "name": stream_type,
                    "text": output_text
                })

    async def _execute_cell_magic(self, source_code: str, result: Dict[str, Any],
                                 start_time: float, execution_count: int,
                                 websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """Execute a cell magic command"""
        lines = source_code.strip().split('\n')
        magic_line = lines[0]  # e.g., "%%capture", "%%time"
        cell_content = '\n'.join(lines[1:]) if len(lines) > 1 else ""

        # Parse magic command and arguments
        magic_parts = shlex.split(magic_line)
        magic_name = magic_parts[0][2:]  # Remove %%
        magic_args = magic_parts[1:] if len(magic_parts) > 1 else []

        # Map magic names to handler methods
        magic_handlers = {
            "capture": lambda: self.cell_magic_handlers.handle_capture(
                magic_args, cell_content, result, start_time, execution_count, websocket
            ),
            "time": lambda: self.cell_magic_handlers.handle_time(
                cell_content, result, start_time, execution_count, websocket
            ),
            "timeit": lambda: self.cell_magic_handlers.handle_timeit(
                magic_args, cell_content, result, start_time, execution_count, websocket
            ),
            "writefile": lambda: self.cell_magic_handlers.handle_writefile(
                magic_args, cell_content, result, start_time, websocket
            ),
            "bash": lambda: self.cell_magic_handlers.handle_bash(
                cell_content, result, start_time, websocket
            ),
            "sh": lambda: self.cell_magic_handlers.handle_bash(
                cell_content, result, start_time, websocket
            ),
            "html": lambda: self.cell_magic_handlers.handle_html(
                cell_content, result, start_time, websocket
            ),
            "markdown": lambda: self.cell_magic_handlers.handle_markdown(
                cell_content, result, start_time, websocket
            ),
        }

        try:
            if magic_name in magic_handlers:
                return await magic_handlers[magic_name]()
            else:
                result["status"] = "error"
                result["error"] = {
                    "ename": "UnknownMagicError",
                    "evalue": f"Unknown cell magic: %%{magic_name}",
                    "traceback": [f"Cell magic %%{magic_name} is not implemented"]
                }

                if websocket:
                    await websocket.send_json({
                        "type": "execution_error",
                        "data": {
                            "error": result["error"]
                        }
                    })
        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"Cell magic error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {
                        "error": result["error"]
                    }
                })

        result["execution_time"] = f"{(time.time() - start_time) * 1000:.1f}ms"
        return result

    async def _execute_line_magic(self, magic_line: str, result: Dict[str, Any],
                                start_time: float, websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """Execute a line magic command"""
        # Parse magic command and arguments
        parts = shlex.split(magic_line)
        magic_name = parts[0]
        magic_args = parts[1:] if len(parts) > 1 else []

        # Map magic names to handler methods
        magic_handlers = {
            "pwd": lambda: self.line_magic_handlers.handle_pwd(magic_args, result, websocket),
            "cd": lambda: self.line_magic_handlers.handle_cd(magic_args, result, websocket),
            "ls": lambda: self.line_magic_handlers.handle_ls(magic_args, result, websocket),
            "env": lambda: self.line_magic_handlers.handle_env(magic_args, result, websocket),
            "who": lambda: self.line_magic_handlers.handle_who(magic_args, result, websocket),
            "whos": lambda: self.line_magic_handlers.handle_whos(magic_args, result, websocket),
            "time": lambda: self.line_magic_handlers.handle_time(magic_args, result, websocket),
            "timeit": lambda: self.line_magic_handlers.handle_timeit(magic_args, result, websocket),
            "pip": lambda: self.line_magic_handlers.handle_pip(magic_args, result, self, websocket),
            "load": lambda: self.line_magic_handlers.handle_load(magic_args, result, websocket),
            "reset": lambda: self.line_magic_handlers.handle_reset(magic_args, result, websocket),
            "lsmagic": lambda: self.line_magic_handlers.handle_lsmagic(magic_args, result, websocket),
            "matplotlib": lambda: self.line_magic_handlers.handle_matplotlib(magic_args, result, websocket),
            "load_ext": lambda: self.line_magic_handlers.handle_load_ext(magic_args, result, websocket),
            "reload_ext": lambda: self.line_magic_handlers.handle_reload_ext(magic_args, result, websocket),
            "unload_ext": lambda: self.line_magic_handlers.handle_unload_ext(magic_args, result, websocket),
            "run": lambda: self.line_magic_handlers.handle_run(magic_args, result, websocket),
        }

        try:
            if magic_name in magic_handlers:
                return await magic_handlers[magic_name]()
            else:
                result["status"] = "error"
                result["error"] = {
                    "ename": "UnknownMagicError",
                    "evalue": f"Unknown line magic: %{magic_name}",
                    "traceback": [f"Line magic %{magic_name} is not implemented"]
                }

                if websocket:
                    await websocket.send_json({
                        "type": "execution_error",
                        "data": {
                            "error": result["error"]
                        }
                    })
        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"Line magic error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {
                        "error": result["error"]
                    }
                })

        result["execution_time"] = f"{(time.time() - start_time) * 1000:.1f}ms"
        return result
