import os
import time
import signal
from typing import TYPE_CHECKING, cast
import subprocess
import sys
import asyncio
from fastapi import WebSocket
import zmq

from ..utils.special_commands import AsyncSpecialCommandHandler

if TYPE_CHECKING:
    from ..utils.error_utils import ErrorUtils

class NextZmqExecutor:
    error_utils: "ErrorUtils"
    cmd_addr: str
    pub_addr: str
    execution_count: int
    interrupt_timeout: float
    worker_pid: int | None
    worker_proc: subprocess.Popen[bytes] | None
    interrupted_cell: int | None
    special_handler: AsyncSpecialCommandHandler | None
    ctx: object  # zmq.Context - untyped due to zmq type limitations
    req: object  # zmq.Socket - untyped due to zmq type limitations
    sub: object  # zmq.Socket - untyped due to zmq type limitations

    def __init__(self, error_utils: "ErrorUtils", cmd_addr: str | None = None, pub_addr: str | None = None, interrupt_timeout: float = 0.5) -> None:
        self.error_utils = error_utils
        self.cmd_addr = cmd_addr or os.getenv('MC_ZMQ_CMD_ADDR', 'tcp://127.0.0.1:5555')
        self.pub_addr = pub_addr or os.getenv('MC_ZMQ_PUB_ADDR', 'tcp://127.0.0.1:5556')
        self.execution_count = 0
        self.interrupt_timeout = interrupt_timeout
        self.worker_pid = None
        self.worker_proc = None
        self.interrupted_cell = None
        self.special_handler = None
        self._ensure_special_handler()
        self.ctx = zmq.Context.instance()  # type: ignore[reportUnknownMemberType]
        self.req = self.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
        self.req.connect(self.cmd_addr)  # type: ignore[reportAttributeAccessIssue]
        self.sub = self.ctx.socket(zmq.SUB)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
        self.sub.connect(self.pub_addr)  # type: ignore[reportAttributeAccessIssue]
        self.sub.setsockopt_string(zmq.SUBSCRIBE, '')  # type: ignore[reportAttributeAccessIssue]
        self._ensure_worker()

    def _ensure_special_handler(self) -> None:
        if self.special_handler is None:
            self.special_handler = AsyncSpecialCommandHandler({"__name__": "__main__"})

    def _ensure_worker(self) -> None:
        # Use a temporary REQ socket for probing to avoid locking self.req's state
        tmp = self.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
        tmp.setsockopt(zmq.LINGER, 0)  # type: ignore[reportAttributeAccessIssue]
        tmp.setsockopt(zmq.RCVTIMEO, 500)  # type: ignore[reportAttributeAccessIssue]
        tmp.setsockopt(zmq.SNDTIMEO, 500)  # type: ignore[reportAttributeAccessIssue]
        try:
            tmp.connect(self.cmd_addr)  # type: ignore[reportAttributeAccessIssue]
            tmp.send_json({'type': 'ping'})  # type: ignore[reportAttributeAccessIssue]
            _ = cast(dict[str, object], tmp.recv_json())  # type: ignore[reportAttributeAccessIssue]
        except Exception:
            #worker not responding, need to start it
            pass
        else:
             #worker alive
            return
        finally:
            tmp.close(0)  # type: ignore[reportAttributeAccessIssue]

        # Spawn a worker detached if not reachable
        env = os.environ.copy()
        env.setdefault('MC_ZMQ_CMD_ADDR', self.cmd_addr)
        env.setdefault('MC_ZMQ_PUB_ADDR', self.pub_addr)
        try:
            # Keep track of the worker process
            # Redirect stderr to see errors during development
            self.worker_proc = subprocess.Popen(
                [sys.executable, '-m', 'morecompute.execution.worker'],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=None  # Show errors in terminal
            )
            for _ in range(50):
                try:
                    tmp2 = self.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
                    tmp2.setsockopt(zmq.LINGER, 0)  # type: ignore[reportAttributeAccessIssue]
                    tmp2.setsockopt(zmq.RCVTIMEO, 500)  # type: ignore[reportAttributeAccessIssue]
                    tmp2.setsockopt(zmq.SNDTIMEO, 500)  # type: ignore[reportAttributeAccessIssue]
                    tmp2.connect(self.cmd_addr)  # type: ignore[reportAttributeAccessIssue]
                    tmp2.send_json({'type': 'ping'})  # type: ignore[reportAttributeAccessIssue]
                    resp = cast(dict[str, object], tmp2.recv_json())  # type: ignore[reportAttributeAccessIssue]
                    # Store the worker PID for force-kill if needed
                    self.worker_pid = resp.get('pid')  # type: ignore[assignment]
                except Exception:
                    time.sleep(0.1)
                else:
                    return
                finally:
                    try:
                        tmp2.close(0)  # type: ignore[reportAttributeAccessIssue]
                    except Exception:
                        pass
        except Exception:
            pass
        raise RuntimeError('Failed to start/connect ZMQ worker')

    async def execute_cell(self, cell_index: int, source_code: str, websocket: WebSocket | None = None) -> dict[str, object]:
        import sys
        self._ensure_special_handler()
        handler = self.special_handler
        normalized_source = source_code
        if handler is not None:
            normalized_source = handler._coerce_source_to_text(source_code)  # type: ignore[reportPrivateUsage]
            if handler.is_special_command(normalized_source):
                execution_count = getattr(self, 'execution_count', 0) + 1
                self.execution_count = execution_count
                start_time = time.time()
                result: dict[str, object] = {
                    'outputs': [],
                    'error': None,
                    'status': 'ok',
                    'execution_count': execution_count,
                    'execution_time': None,
                }
                if websocket:
                    await websocket.send_json({'type': 'execution_start', 'data': {'cell_index': cell_index, 'execution_count': execution_count}})
                result = await handler.execute_special_command(
                    normalized_source, result, start_time, execution_count, websocket, cell_index
                )
                result['execution_time'] = f"{(time.time()-start_time)*1000:.1f}ms"
                if websocket:
                    await websocket.send_json({'type': 'execution_complete', 'data': {'cell_index': cell_index, 'result': result}})
                return result

        execution_count = getattr(self, 'execution_count', 0) + 1
        self.execution_count = execution_count
        result: dict[str, object] = {'outputs': [], 'error': None, 'status': 'ok', 'execution_count': execution_count, 'execution_time': None}
        if websocket:
            await websocket.send_json({'type': 'execution_start', 'data': {'cell_index': cell_index, 'execution_count': execution_count}})

        self.req.send_json({'type': 'execute_cell', 'code': source_code, 'cell_index': cell_index, 'execution_count': execution_count})  # type: ignore[reportAttributeAccessIssue]
        # Consume pub until we see complete for this cell
        start_time = time.time()
        max_wait = 300.0  # 5 minute timeout for really long operations
        while True:
            # Check if this cell was interrupted
            if self.interrupted_cell == cell_index:
                print(f"[EXECUTE] Cell {cell_index} was interrupted, breaking out of execution loop", file=sys.stderr, flush=True)
                self.interrupted_cell = None  # Clear the flag
                result.update({
                    'status': 'error',
                    'error': {
                        'output_type': 'error',
                        'ename': 'KeyboardInterrupt',
                        'evalue': 'Execution interrupted by user',
                        'traceback': ['KeyboardInterrupt: Execution was stopped by user']
                    }
                })
                break

            # Timeout check for stuck operations
            if time.time() - start_time > max_wait:
                print(f"[EXECUTE] Cell {cell_index} exceeded max wait time, timing out", file=sys.stderr, flush=True)
                result.update({
                    'status': 'error',
                    'error': {
                        'output_type': 'error',
                        'ename': 'TimeoutError',
                        'evalue': 'Execution exceeded maximum time limit',
                        'traceback': ['TimeoutError: Operation took too long']
                    }
                })
                break

            try:
                msg = cast(dict[str, object], self.sub.recv_json(flags=zmq.NOBLOCK))  # type: ignore[reportAttributeAccessIssue]
            except zmq.Again:
                await asyncio.sleep(0.01)
                continue
            t = msg.get('type')
            if t == 'stream' and websocket:
                await websocket.send_json({'type': 'stream_output', 'data': msg})
            elif t == 'stream_update' and websocket:
                await websocket.send_json({'type': 'stream_output', 'data': msg})
            elif t == 'execute_result' and websocket:
                await websocket.send_json({'type': 'execution_result', 'data': msg})
            elif t == 'display_data' and websocket:
                await websocket.send_json({'type': 'execution_result', 'data': {'cell_index': msg.get('cell_index'), 'execution_count': None, 'data': msg.get('data')}})
            elif t == 'execution_error' and websocket:
                await websocket.send_json({'type': 'execution_error', 'data': msg})
            elif t == 'execution_error':
                if msg.get('cell_index') == cell_index:
                    result.update({'status': 'error', 'error': msg.get('error')})
            elif t == 'execution_complete' and msg.get('cell_index') == cell_index:
                result.update(msg.get('result') or {})
                result.setdefault('execution_count', execution_count)
                break

        # Try to receive the reply from REQ socket (if worker is still alive)
        # If we interrupted/killed the worker, this will fail and we need to reset the socket
        try:
            self.req.setsockopt(zmq.RCVTIMEO, 100)  # type: ignore[reportAttributeAccessIssue]
            _ = cast(dict[str, object], self.req.recv_json())  # type: ignore[reportAttributeAccessIssue]
            self.req.setsockopt(zmq.RCVTIMEO, -1)  # type: ignore[reportAttributeAccessIssue]
        except zmq.Again:
            # Timeout - worker didn't reply (probably killed), need to reset socket
            print(f"[EXECUTE] Worker didn't reply, resetting REQ socket", file=sys.stderr, flush=True)
            try:
                self.req.close(0)  # type: ignore[reportAttributeAccessIssue]
                self.req = self.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
                self.req.connect(self.cmd_addr)  # type: ignore[reportAttributeAccessIssue]
            except Exception as e:
                print(f"[EXECUTE] Error resetting socket: {e}", file=sys.stderr, flush=True)
        except Exception as e:
            # Some other error, also reset socket to be safe
            print(f"[EXECUTE] Error receiving reply: {e}, resetting socket", file=sys.stderr, flush=True)
            try:
                self.req.setsockopt(zmq.RCVTIMEO, -1)  # type: ignore[reportAttributeAccessIssue]
                self.req.close(0)  # type: ignore[reportAttributeAccessIssue]
                self.req = self.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
                self.req.connect(self.cmd_addr)  # type: ignore[reportAttributeAccessIssue]
            except Exception:
                pass
        result['execution_time'] = f"{(time.time()-start_time)*1000:.1f}ms"
        if websocket:
            await websocket.send_json({'type': 'execution_complete', 'data': {'cell_index': cell_index, 'result': result}})
        return result

    async def interrupt_kernel(self, cell_index: int | None = None) -> None:
        """Interrupt the kernel with escalation to force-kill if needed"""
        import sys
        print(f"[INTERRUPT] Starting interrupt for cell {cell_index}", file=sys.stderr, flush=True)

        # Mark this cell as interrupted so execute_cell can break out
        if isinstance(cell_index, int):
            self.interrupted_cell = cell_index
            print(f"[INTERRUPT] Marked cell {cell_index} as interrupted", file=sys.stderr, flush=True)

        payload: dict[str, object] = {'type': 'interrupt'}
        if isinstance(cell_index, int):
            payload['cell_index'] = cell_index

        # Try graceful interrupt, but don't trust it for blocking I/O
        try:
            # Very short timeout since we'll force-kill anyway
            self.req.setsockopt(zmq.SNDTIMEO, 100)  # type: ignore[reportAttributeAccessIssue]
            self.req.setsockopt(zmq.RCVTIMEO, 100)  # type: ignore[reportAttributeAccessIssue]
            self.req.send_json(payload)  # type: ignore[reportAttributeAccessIssue]
            _ = cast(dict[str, object], self.req.recv_json())  # type: ignore[reportAttributeAccessIssue]
            print(f"[INTERRUPT] Sent interrupt signal to worker", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[INTERRUPT] Could not send interrupt signal: {e}", file=sys.stderr, flush=True)
        finally:
            # Reset timeouts
            self.req.setsockopt(zmq.SNDTIMEO, -1)  # type: ignore[reportAttributeAccessIssue]
            self.req.setsockopt(zmq.RCVTIMEO, -1)  # type: ignore[reportAttributeAccessIssue]

        # Wait briefly to see if worker responds, but DON'T read from pub socket
        # (execute_cell is already reading from it - we'd steal messages!)
        # Instead, just wait a moment and force-kill if needed
        print(f"[INTERRUPT] Waiting {self.interrupt_timeout}s before force-kill...", file=sys.stderr, flush=True)
        await asyncio.sleep(self.interrupt_timeout)

        # For blocking I/O operations, interrupt rarely works - just force-kill
        # The interrupted_cell flag will let execute_cell break out gracefully
        print(f"[INTERRUPT] Force killing worker to ensure stop...", file=sys.stderr, flush=True)
        await self._force_kill_worker()
        print(f"[INTERRUPT] Force kill completed", file=sys.stderr, flush=True)

        # Interrupt special handler
        if self.special_handler:
            try:
                await self.special_handler.interrupt()
            except Exception:
                pass

        print(f"[INTERRUPT] Interrupt complete", file=sys.stderr, flush=True)

    async def _force_kill_worker(self) -> None:
        """Force kill the worker process and respawn"""
        import sys
        print(f"[FORCE_KILL] Killing worker PID={self.worker_pid}", file=sys.stderr, flush=True)

        if self.worker_pid:
            try:
                # For blocking I/O, SIGKILL immediately - no mercy
                print(f"[FORCE_KILL] Sending SIGKILL to {self.worker_pid}", file=sys.stderr, flush=True)
                os.kill(self.worker_pid, signal.SIGKILL)
                await asyncio.sleep(0.1)  # Brief wait for process to die
            except ProcessLookupError:
                print(f"[FORCE_KILL] Process {self.worker_pid} already dead", file=sys.stderr, flush=True)
            except Exception as e:
                print(f"[FORCE_KILL] Error killing PID {self.worker_pid}: {e}", file=sys.stderr, flush=True)

        # Also try via Popen object if available
        if self.worker_proc:
            try:
                print(f"[FORCE_KILL] Killing via Popen object", file=sys.stderr, flush=True)
                self.worker_proc.kill()  # SIGKILL directly
                await asyncio.sleep(0.1)
            except Exception as e:
                print(f"[FORCE_KILL] Error killing via Popen: {e}", file=sys.stderr, flush=True)

        # CRITICAL: Reset socket state - close and recreate
        # The REQ socket may be waiting for a reply from the dead worker
        try:
            print(f"[FORCE_KILL] Resetting REQ socket", file=sys.stderr, flush=True)
            self.req.close(0)  # type: ignore[reportAttributeAccessIssue]
            self.req = self.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
            self.req.connect(self.cmd_addr)  # type: ignore[reportAttributeAccessIssue]
            print(f"[FORCE_KILL] REQ socket reset complete", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[FORCE_KILL] Error resetting socket: {e}", file=sys.stderr, flush=True)

        # Respawn worker
        try:
            self._ensure_worker()
        except Exception:
            pass

    def reset_kernel(self) -> None:
        """Reset the kernel by shutting down worker and restarting"""
        # Try graceful shutdown first
        try:
            self.req.setsockopt(zmq.SNDTIMEO, 500)  # type: ignore[reportAttributeAccessIssue]
            self.req.setsockopt(zmq.RCVTIMEO, 500)  # type: ignore[reportAttributeAccessIssue]
            self.req.send_json({'type': 'shutdown'})  # type: ignore[reportAttributeAccessIssue]
            _ = cast(dict[str, object], self.req.recv_json())  # type: ignore[reportAttributeAccessIssue]
        except Exception:
            pass
        finally:
            self.req.setsockopt(zmq.SNDTIMEO, -1)  # type: ignore[reportAttributeAccessIssue]
            self.req.setsockopt(zmq.RCVTIMEO, -1)  # type: ignore[reportAttributeAccessIssue]

        # Force kill if needed
        if self.worker_pid:
            try:
                os.kill(self.worker_pid, signal.SIGTERM)
                time.sleep(0.2)
                try:
                    os.kill(self.worker_pid, 0)
                    os.kill(self.worker_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            except Exception:
                pass

        if self.worker_proc:
            try:
                self.worker_proc.terminate()
                self.worker_proc.wait(timeout=1)
            except Exception:
                try:
                    self.worker_proc.kill()
                except Exception:
                    pass

        # Reset state
        self.execution_count = 0
        self.worker_pid = None
        self.worker_proc = None

        # Recreate sockets
        try:
            self.req.close(0)  # type: ignore[reportAttributeAccessIssue]
            self.req = self.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
            self.req.connect(self.cmd_addr)  # type: ignore[reportAttributeAccessIssue]
        except Exception:
            pass

        # Reset special handler
        if self.special_handler is not None:
            self.special_handler = AsyncSpecialCommandHandler({"__name__": "__main__"})

        # Respawn worker
        try:
            self._ensure_worker()
        except Exception:
            pass
