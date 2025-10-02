import os
import io
import sys
import asyncio
import subprocess
import time
import shlex
from contextlib import redirect_stdout, redirect_stderr
from typing import Dict, Any, Optional, Tuple, Union
from fastapi import WebSocket


# this file is not tested that all functions work, need to write a test file / manually check
# to-do

class AsyncSpecialCommandHandler:
    """Handles all special commands asynchronously with streaming support: shell (!), line magics (%), and cell magics (%%)"""

    def __init__(self, globals_dict: dict):
        self.globals_dict = globals_dict
        self.captured_outputs = {}  # Store captured outputs from %%capture

    def is_special_command(self, source_code: Union[str, list, tuple]) -> bool:
        """Check if the source code is a special command"""
        text = self._coerce_source_to_text(source_code)
        stripped = text.strip()
        return (stripped.startswith('!') or
                stripped.startswith('%%') or
                stripped.startswith('%'))

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
        else:
            raise ValueError("Not a special command")

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
            # Prepare environment and command for streaming
            env = self._prepare_streaming_environment(command)
            cmd_parts = self._prepare_command_parts(command)

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
                    await websocket.send_json({
                        "type": "packages_updated",
                        "data": {"action": "pip"}
                    })
            except Exception:
                pass

            # Check if command failed
            if return_code != 0:
                result["status"] = "error"
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

    def _prepare_streaming_environment(self, shell_cmd: str) -> dict:
        """Prepare environment variables for unbuffered output"""
        env = os.environ.copy()

        # Always set unbuffered Python
        env['PYTHONUNBUFFERED'] = '1'
        env['PYTHONDONTWRITEBYTECODE'] = '1'

        # Additional settings for specific commands
        if 'pip install' in shell_cmd:
            env['PIP_DISABLE_PIP_VERSION_CHECK'] = '1'
            env['PIP_NO_CACHE_DIR'] = '1'

        return env

    def _prepare_command_parts(self, shell_cmd: str) -> list:
        """Convert shell command to subprocess-compatible format"""

        if shell_cmd.startswith('pip '):
            # Route pip through Python module for better control
            parts = ['python', '-m'] + shlex.split(shell_cmd)
            # Add progress bar control for pip
            if 'install' in shell_cmd and '--progress-bar' not in shell_cmd:
                parts.extend(['--progress-bar', 'off'])
            return parts

        elif shell_cmd.startswith('python '):
            # Add unbuffered flag to python commands
            parts = shlex.split(shell_cmd)
            parts.insert(1, '-u')  # Add -u after 'python'
            return parts

        else:
            # For other shell commands, use shell execution
            return ['/bin/zsh', '-c', shell_cmd]  # macOS with zsh

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

        try:
            if magic_name == "capture":
                return await self._handle_capture_magic(magic_args, cell_content, result, start_time, execution_count, websocket)
            elif magic_name == "time":
                return await self._handle_time_magic(cell_content, result, start_time, execution_count, websocket)
            elif magic_name == "writefile":
                return await self._handle_writefile_magic(magic_args, cell_content, result, start_time, websocket)
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

        try:
            if magic_name == "pwd":
                return await self._handle_pwd_magic(result, start_time, websocket)
            elif magic_name == "cd":
                return await self._handle_cd_magic(magic_args, result, start_time, websocket)
            elif magic_name == "ls":
                return await self._handle_ls_magic(magic_args, result, start_time, websocket)
            elif magic_name == "env":
                return await self._handle_env_magic(magic_args, result, start_time, websocket)
            elif magic_name == "who":
                return await self._handle_who_magic(result, start_time, websocket)
            elif magic_name == "whos":
                return await self._handle_whos_magic(result, start_time, websocket)
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

    # Cell Magic Implementations

    async def _handle_capture_magic(self, args: list, cell_content: str, result: Dict[str, Any],
                                  start_time: float, execution_count: int,
                                  websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """Handle %%capture magic - capture stdout/stderr without displaying"""
        output_var = args[0] if args else None
        no_stdout = "--no-stdout" in args
        no_stderr = "--no-stderr" in args

        # Capture outputs
        stdout_capture = None if no_stdout else io.StringIO()
        stderr_capture = None if no_stderr else io.StringIO()

        try:
            # Execute the cell content with output capture
            if stdout_capture or stderr_capture:
                with redirect_stdout(stdout_capture or sys.stdout), \
                     redirect_stderr(stderr_capture or sys.stderr):
                    compiled_code = compile(cell_content, '<cell>', 'exec')
                    exec(compiled_code, self.globals_dict)
            else:
                compiled_code = compile(cell_content, '<cell>', 'exec')
                exec(compiled_code, self.globals_dict)

            # Store captured output in a variable if specified
            if output_var:
                captured_data = {
                    'stdout': stdout_capture.getvalue() if stdout_capture else '',
                    'stderr': stderr_capture.getvalue() if stderr_capture else ''
                }
                self.globals_dict[output_var] = captured_data
                self.captured_outputs[output_var] = captured_data

            # Don't add outputs to result (they're captured, not displayed)
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
                    "data": {
                        "error": result["error"]
                    }
                })

        return result

    # Add other magic method implementations here...
    # (Time magic, writefile magic, line magics like pwd, cd, ls, etc.)
    # I'll implement a few key ones to keep this focused:

    async def _handle_pwd_magic(self, result: Dict[str, Any], start_time: float,
                              websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """Handle %pwd magic - print working directory"""
        try:
            pwd = os.getcwd()
            output_data = {
                "output_type": "execute_result",
                "execution_count": None,
                "data": {
                    "text/plain": f"'{pwd}'"
                }
            }
            result["outputs"].append(output_data)

            if websocket:
                await websocket.send_json({
                    "type": "execute_result",
                    "data": {
                        "data": output_data["data"]
                    }
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"PWD magic error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {
                        "error": result["error"]
                    }
                })

        return result
