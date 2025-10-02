import asyncio
import io
import base64
import time
from contextlib import redirect_stdout, redirect_stderr
from typing import Dict, Any, Optional

from fastapi import WebSocket

from .utils.special_commands import AsyncSpecialCommandHandler


class NextCodeExecutor:
    """Handles code execution for the Next.js frontend with robust error handling."""

    def __init__(self, error_utils, notebook_path=None):
        self.globals = {"__name__": "__main__"}
        self.execution_count = 0
        self.notebook_path = notebook_path
        self.special_command_handler = AsyncSpecialCommandHandler(self.globals)
        self.error_utils = error_utils
        # Ensure matplotlib uses a non-interactive backend and does not open GUI windows
        try:
            import os as _os
            _os.environ.setdefault("MPLBACKEND", "Agg")
            import matplotlib
            matplotlib.use("Agg", force=True)
            try:
                import matplotlib.pyplot as _plt
                _plt.ioff()
            except Exception:
                pass
        except Exception:
            # Matplotlib not installed or failed to configure; ignore silently
            #look at this later 
            pass

    async def execute_cell(self, cell_index: int, source_code: str, websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        start_time = time.time()
        
        result = {
            "outputs": [],
            "error": None,
            "status": "ok",
            "execution_count": None,
            "execution_time": None
        }

        loop = asyncio.get_running_loop()

        try:
            # Normalize source code in case it's provided as a list of lines (nbformat/Colab)
            normalized_source = self._coerce_source_to_text(source_code)

            if self.special_command_handler.is_special_command(normalized_source):
                execution_count = self._get_next_execution_count()
                result["execution_count"] = execution_count
                result = await self.special_command_handler.execute_special_command(
                    normalized_source, result, start_time, execution_count, websocket, cell_index
                )
            else:
                execution_count = self._get_next_execution_count()
                result["execution_count"] = execution_count
                await self._execute_python_code(
                    normalized_source,
                    result,
                    cell_index,
                    loop,
                    websocket,
                    execution_count,
                )

        except Exception as e:
            formatted_error = self.error_utils.format_exception(e)
            result['status'] = 'error'
            result['error'] = formatted_error
            result['outputs'].append({'output_type': 'error', **formatted_error})
            if websocket:
                await websocket.send_json({
                    'type': 'execution_error',
                    'data': {
                        'cell_index': cell_index,
                        'error': formatted_error
                    }
                })

        result["execution_time"] = f"{(time.time() - start_time) * 1000:.1f}ms"
        return result

    def _get_next_execution_count(self) -> int:
        self.execution_count += 1
        return self.execution_count

    def _coerce_source_to_text(self, source_code: Any) -> str:
        """Convert incoming cell source to a text string.
        nbformat may deliver cell sources as list[str] (one per line).
        """
        try:
            # If already a string, return as-is
            if isinstance(source_code, str):
                return source_code
            # If it's a list/tuple of strings, join into a single string
            if isinstance(source_code, (list, tuple)):
                return "".join(source_code)
            # Fallback to string conversion
            return str(source_code)
        except Exception:
            return ""

    async def _execute_python_code(self, source_code: str, result: Dict[str, Any],
                                   cell_index: int, loop: asyncio.AbstractEventLoop,
                                   websocket: Optional[WebSocket], execution_count: int):
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()

        def run_code():
            try:
                with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                    compiled_code = compile(source_code, '<cell>', 'exec')
                    exec(compiled_code, self.globals)
                return None
            except Exception as exc:  # Return the exception for handling in async context
                return exc

        error = await loop.run_in_executor(None, run_code)

        if not error:
            await self._maybe_evaluate_last_expression(
                source_code,
                execution_count,
                stdout_capture,
                stderr_capture,
                result,
                websocket,
                cell_index,
            )

        # Capture any matplotlib figures produced during execution
        await self._capture_matplotlib_figures(result, websocket, cell_index)

        if error:
            formatted_error = self.error_utils.format_exception(error)
            result['status'] = 'error'
            result['error'] = formatted_error
            result['outputs'].append({'output_type': 'error', **formatted_error})
            if websocket:
                await websocket.send_json({
                    'type': 'execution_error',
                    'data': {
                        'cell_index': cell_index,
                        'error': formatted_error
                    }
                })

        stdout_val = stdout_capture.getvalue()
        if stdout_val:
            stream_output = {
                'output_type': 'stream',
                'name': 'stdout',
                'text': stdout_val
            }
            result['outputs'].append(stream_output)
            if websocket:
                await websocket.send_json({
                    'type': 'stream_output',
                    'data': {
                        'cell_index': cell_index,
                        'stream': 'stdout',
                        'text': stdout_val
                    }
                })

        stderr_val = stderr_capture.getvalue()
        if stderr_val:
            stream_output = {
                'output_type': 'stream',
                'name': 'stderr',
                'text': stderr_val
            }
            result['outputs'].append(stream_output)
            if websocket:
                await websocket.send_json({
                    'type': 'stream_output',
                    'data': {
                        'cell_index': cell_index,
                        'stream': 'stderr',
                        'text': stderr_val
                    }
                })

    async def interrupt_kernel(self, cell_index: Optional[int] = None):
        print("Kernel interrupt requested.")

    def reset_kernel(self):
        self.globals = {"__name__": "__main__"}
        self.execution_count = 0
        print("Kernel reset.")

    async def _maybe_evaluate_last_expression(
        self,
        source_code: str,
        execution_count: int,
        stdout_capture: io.StringIO,
        stderr_capture: io.StringIO,
        result: Dict[str, Any],
        websocket: Optional[WebSocket],
        cell_index: int,
    ) -> None:
        lines = source_code.strip().split('\n')
        if not lines:
            return

        last_line = lines[-1].strip()
        if not last_line or self._is_statement(last_line):
            return

        try:
            with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                expr_result = eval(last_line, self.globals)
        except Exception:
            # If expression evaluation fails we silently ignore, matching notebook behaviour
            return

        if expr_result is None:
            return

        execute_result = {
            'output_type': 'execute_result',
            'execution_count': execution_count,
            'data': {
                'text/plain': repr(expr_result)
            }
        }
        result['outputs'].append(execute_result)
        if websocket:
            await websocket.send_json({
                'type': 'execute_result',
                'data': {
                    'cell_index': cell_index,
                    'execution_count': execution_count,
                    'data': execute_result['data']
                }
            })

    def _is_statement(self, line: str) -> bool:
        statement_keywords = [
            'import', 'from', 'def', 'class', 'if', 'elif', 'else', 'for',
            'while', 'try', 'except', 'finally', 'with', 'assert', 'del',
            'global', 'nonlocal', 'pass', 'break', 'continue', 'return',
            'raise', 'yield'
        ]

        line = line.strip()
        if not line:
            return True

        if '=' in line and not any(op in line for op in ['==', '!=', '<=', '>=']):
            return True

        first_word = line.split()[0]
        return first_word in statement_keywords

    async def _capture_matplotlib_figures(
        self,
        result: Dict[str, Any],
        websocket: Optional[WebSocket],
        cell_index: int,
    ) -> None:
        """Detect open matplotlib figures and append them as display_data outputs.
        Uses Agg backend; encodes figures to PNG base64.
        """
        try:
            import matplotlib.pyplot as plt
        except Exception:
            return

        try:
            fig_nums = plt.get_fignums()
            if not fig_nums:
                return
            for num in fig_nums:
                try:
                    fig = plt.figure(num)
                    buf = io.BytesIO()
                    fig.savefig(buf, format='png', bbox_inches='tight')
                    buf.seek(0)
                    b64 = base64.b64encode(buf.read()).decode('ascii')
                    display = {
                        'output_type': 'display_data',
                        'data': {
                            'image/png': b64,
                            'text/plain': f'<Figure size {int(fig.get_figwidth()*fig.dpi)}x{int(fig.get_figheight()*fig.dpi)} with {len(fig.get_axes())} Axes>'
                        }
                    }
                    result['outputs'].append(display)
                    if websocket:
                        await websocket.send_json({
                            'type': 'execute_result',
                            'data': {
                                'cell_index': cell_index,
                                'execution_count': result.get('execution_count'),
                                'data': display['data']
                            }
                        })
                except Exception:
                    continue
            try:
                plt.close('all')
            except Exception:
                pass
        except Exception:
            return
