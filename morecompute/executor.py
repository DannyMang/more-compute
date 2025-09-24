import sys
import io
import traceback
import asyncio
import time
import os
from contextlib import redirect_stdout, redirect_stderr
from typing import Dict, Any, Optional
from fastapi import WebSocket
from .utils.special_commands import AsyncSpecialCommandHandler
from .utils.error_utils import create_enhanced_error_info


class AsyncCellExecutor:
    """Handles async execution of notebook cells with streaming output support"""

    def __init__(self):
        self.globals_dict = {"__name__": "__main__"}
        self.execution_count = 0
        self._execution_lock = asyncio.Lock()
        self.special_handler = AsyncSpecialCommandHandler(self.globals_dict)
        self.current_process = None
        self.current_task = None

    async def execute_cell(self, source_code: str, websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Execute a cell asynchronously with streaming output support

        Args:
            source_code: Python code to execute (or shell command with !)
            websocket: Optional WebSocket for streaming output

        Returns:
            Dict containing execution result, outputs, error information, and timing
        """
        async with self._execution_lock:
            self.execution_count += 1
            start_time = time.time()
            # Store current task for interruption
            self.current_task = asyncio.current_task()

            result = {
                "execution_count": self.execution_count,
                "outputs": [],
                "error": None,
                "status": "ok",
                "execution_time": None
            }

            if not source_code.strip():
                result["execution_time"] = f"{(time.time() - start_time) * 1000:.1f}ms"
                return result

            # Check if this is a special command (shell, line magic, or cell magic)
            if self.special_handler.is_special_command(source_code):
                return await self.special_handler.execute_special_command(
                    source_code, result, start_time, self.execution_count, websocket
                )

            # Execute regular Python code
            return await self._execute_python_code(source_code, result, start_time, websocket)

    async def _execute_python_code(self, source_code: str, result: Dict[str, Any],
                                  start_time: float, websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """Execute Python code with optional streaming output"""
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()

        try:
            # Send execution start notification if websocket available
            if websocket:
                await websocket.send_json({
                    "type": "execution_start",
                    "data": {
                        "execution_count": self.execution_count
                    }
                })

            with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                # Compile and execute the code
                compiled_code = compile(source_code, '<cell>', 'exec')
                exec(compiled_code, self.globals_dict)

            # Capture stdout output
            stdout_content = stdout_capture.getvalue()
            if stdout_content:
                output_data = {
                    "output_type": "stream",
                    "name": "stdout",
                    "text": stdout_content
                }
                result["outputs"].append(output_data)

                # Stream output if websocket available
                if websocket:
                    await websocket.send_json({
                        "type": "stream_output",
                        "data": {
                            "stream": "stdout",
                            "text": stdout_content
                        }
                    })

            # Capture stderr output
            stderr_content = stderr_capture.getvalue()
            if stderr_content:
                output_data = {
                    "output_type": "stream",
                    "name": "stderr",
                    "text": stderr_content
                }
                result["outputs"].append(output_data)

                # Stream output if websocket available
                if websocket:
                    await websocket.send_json({
                        "type": "stream_output",
                        "data": {
                            "stream": "stderr",
                            "text": stderr_content
                        }
                    })

            # Try to capture the result of the last expression
            try:
                # Split code into lines and check if last line is an expression
                lines = source_code.strip().split('\n')
                if lines:
                    last_line = lines[-1].strip()
                    if last_line and not self._is_statement(last_line):
                        # Try to evaluate the last line as an expression
                        with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                            expr_result = eval(last_line, self.globals_dict)
                            if expr_result is not None:
                                output_data = {
                                    "output_type": "execute_result",
                                    "execution_count": self.execution_count,
                                    "data": {
                                        "text/plain": repr(expr_result)
                                    }
                                }
                                result["outputs"].append(output_data)
                                if websocket:
                                    await websocket.send_json({
                                        "type": "execute_result",
                                        "data": {
                                            "execution_count": self.execution_count,
                                            "data": output_data["data"]
                                        }
                                    })
            except:
                # If evaluation fails, ignore it
                pass

        except Exception as e:
            result["status"] = "error"
            
            # Get enhanced error information with suggestions
            traceback_lines = traceback.format_exc().split('\n')
            error_info = create_enhanced_error_info(e, traceback_lines)
            result["error"] = error_info

            # Also add error as output
            result["outputs"].append({
                "output_type": "error",
                **error_info
            })
            
            # Stream error if websocket available
            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {
                        "error": error_info
                    }
                })
        result["execution_time"] = f"{(time.time() - start_time) * 1000:.1f}ms"
        if websocket:
            await websocket.send_json({
                "type": "execution_complete",
                "data": {
                    "execution_count": self.execution_count,
                    "execution_time": result["execution_time"],
                    "status": result["status"]
                }
            })
        # Clear current task
        self.current_task = None
        return result

    def _is_statement(self, line: str) -> bool:
        """Check if a line is a statement (vs expression)"""
        statement_keywords = [
            'import', 'from', 'def', 'class', 'if', 'elif', 'else', 'for',
            'while', 'try', 'except', 'finally', 'with', 'assert', 'del',
            'global', 'nonlocal', 'pass', 'break', 'continue', 'return',
            'raise', 'yield'
        ]

        line = line.strip()
        if not line:
            return True

        # Check for assignment
        if '=' in line and not any(op in line for op in ['==', '!=', '<=', '>=']):
            return True

        # Check for statement keywords
        first_word = line.split()[0]
        return first_word in statement_keywords

    async def reset_kernel(self):
        """Reset the execution environment"""
        async with self._execution_lock:
            self.globals_dict = {"__name__": "__main__"}
            self.execution_count = 0
            self.special_handler = AsyncSpecialCommandHandler(self.globals_dict)

    def get_variables(self) -> Dict[str, str]:
        """Get current variables in the execution environment"""
        variables = {}
        for name, value in self.globals_dict.items():
            if not name.startswith('_') and not callable(value):
                try:
                    variables[name] = repr(value)
                except:
                    variables[name] = "<unprintable>"
        return variables

    async def interrupt_execution(self):
        """Interrupt current execution"""
        # Interrupt external processes
        if self.current_process and self.current_process.returncode is None:
            try:
                self.current_process.terminate()
                await asyncio.wait_for(self.current_process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self.current_process.kill()
            finally:
                self.current_process = None

        # Interrupt Python code execution by cancelling the current task
        if self.current_task and not self.current_task.done():
            try:
                self.current_task.cancel()
                # Give the task a moment to handle the cancellation
                await asyncio.sleep(0.1)
            except asyncio.CancelledError:
                pass
            finally:
                self.current_task = None
