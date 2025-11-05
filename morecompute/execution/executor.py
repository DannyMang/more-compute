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
    ctrl_addr: str
    execution_count: int
    interrupt_timeout: float
    worker_pid: int | None
    worker_proc: subprocess.Popen[bytes] | None
    interrupted_cell: int | None
    special_handler: AsyncSpecialCommandHandler | None
    ctx: object  # zmq.Context - untyped due to zmq type limitations
    req: object  # zmq.Socket - untyped due to zmq type limitations
    sub: object  # zmq.Socket - untyped due to zmq type limitations
    ctrl: object  # zmq.Socket - control socket for interrupts
    is_remote: bool  # Flag to track if connected to remote worker

    def __init__(self, error_utils: "ErrorUtils", cmd_addr: str | None = None, pub_addr: str | None = None, interrupt_timeout: float = 0.5) -> None:
        self.error_utils = error_utils
        self.cmd_addr = cmd_addr or os.getenv('MC_ZMQ_CMD_ADDR', 'tcp://127.0.0.1:5555')
        self.pub_addr = pub_addr or os.getenv('MC_ZMQ_PUB_ADDR', 'tcp://127.0.0.1:5556')
        self.ctrl_addr = os.getenv('MC_ZMQ_CTRL_ADDR', self.cmd_addr.replace('5555', '5557'))
        self.execution_count = 0
        self.interrupt_timeout = interrupt_timeout
        self.worker_pid = None
        self.worker_proc = None
        self.interrupted_cell = None
        self.special_handler = None
        self.is_remote = False  # Start with local worker
        self._ensure_special_handler()
        self.ctx = zmq.Context.instance()  # type: ignore[reportUnknownMemberType]
        self.req = self.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
        self.req.connect(self.cmd_addr)  # type: ignore[reportAttributeAccessIssue]
        self.sub = self.ctx.socket(zmq.SUB)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
        self.sub.connect(self.pub_addr)  # type: ignore[reportAttributeAccessIssue]
        self.sub.setsockopt_string(zmq.SUBSCRIBE, '')  # type: ignore[reportAttributeAccessIssue]
        # Control socket for interrupts (DEALER to connect to worker's ROUTER)
        self.ctrl = self.ctx.socket(zmq.DEALER)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
        self.ctrl.connect(self.ctrl_addr)  # type: ignore[reportAttributeAccessIssue]
        self._ensure_worker()

    def _ensure_special_handler(self) -> None:
        if self.special_handler is None:
            self.special_handler = AsyncSpecialCommandHandler({"__name__": "__main__"})

    def _ensure_worker(self) -> None:
        """Ensure a worker is available. If connected to remote pod, skip local worker spawn."""
        # If we're connected to a remote worker, don't try to spawn local worker
        if self.is_remote:
            return

        # Use a temporary REQ socket for probing to avoid locking self.req's state
        tmp = self.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
        tmp.setsockopt(zmq.LINGER, 0)  # type: ignore[reportAttributeAccessIssue]
        tmp.setsockopt(zmq.RCVTIMEO, 500)  # type: ignore[reportAttributeAccessIssue]
        tmp.setsockopt(zmq.SNDTIMEO, 500)  # type: ignore[reportAttributeAccessIssue]
        try:
            tmp.connect(self.cmd_addr)  # type: ignore[reportAttributeAccessIssue]
            tmp.send_json({'type': 'ping'})  # type: ignore[reportAttributeAccessIssue]
            resp = cast(dict[str, object], tmp.recv_json())  # type: ignore[reportAttributeAccessIssue]
            # Store worker PID even if already running (for force-kill)
            self.worker_pid = resp.get('pid')  # type: ignore[assignment]
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
        env.setdefault('MC_ZMQ_CTRL_ADDR', self.ctrl_addr)
        try:
            # Keep track of the worker process
            # Redirect stderr to see errors during development
            self.worker_proc = subprocess.Popen(
                [sys.executable, '-m', 'morecompute.execution.worker'],
                env=env,
                stdin=subprocess.DEVNULL,  # Explicitly close stdin to prevent fd issues
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
        self._ensure_special_handler()
        handler = self.special_handler
        normalized_source = source_code
        if handler is not None:
            normalized_source = handler._coerce_source_to_text(source_code)  # type: ignore[reportPrivateUsage]
            if handler.is_special_command(normalized_source):
                # Check if this is a PURE special command (starts with !, %%, or %)
                # vs a MIXED command (contains shell commands but also has Python code)
                stripped = normalized_source.strip()
                is_pure_special = (stripped.startswith('!') or
                                 stripped.startswith('%%') or
                                 stripped.startswith('%'))

                # Only execute PURE special commands locally
                # Mixed commands must go to worker for proper streaming
                if not self.is_remote and is_pure_special:
                    # Execute pure special command locally
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
                    print(f"[EXECUTOR] Sending execution_complete for cell {cell_index}, status={result.get('status')}, has_error={result.get('error') is not None}", file=sys.stderr, flush=True)
                    if websocket:
                        await websocket.send_json({'type': 'execution_complete', 'data': {'cell_index': cell_index, 'result': result}})
                        print(f"[EXECUTOR] Sent execution_complete successfully", file=sys.stderr, flush=True)
                    return result
                # For remote execution OR mixed commands, fall through to send via ZMQ

        execution_count = getattr(self, 'execution_count', 0) + 1
        self.execution_count = execution_count
        result: dict[str, object] = {'outputs': [], 'error': None, 'status': 'ok', 'execution_count': execution_count, 'execution_time': None}
        if websocket:
            await websocket.send_json({'type': 'execution_start', 'data': {'cell_index': cell_index, 'execution_count': execution_count}})

        self.req.send_json({'type': 'execute_cell', 'code': source_code, 'cell_index': cell_index, 'execution_count': execution_count})  # type: ignore[reportAttributeAccessIssue]
        # Consume pub until we see complete for this cell
        start_time = time.time()
        max_wait = 300.0  # 5 minute timeout for really long operations
        interrupted_time = None  # Track when interrupt was sent
        while True:
            # Check if this cell was interrupted
            if self.interrupted_cell == cell_index and interrupted_time is None:
                print(f"[EXECUTE] Cell {cell_index} was interrupted, waiting for subprocess to be killed...", file=sys.stderr, flush=True)
                interrupted_time = time.time()
                # Don't break immediately - wait for execution_complete from worker
                # Give worker 5 seconds to kill subprocess and send completion

            # If interrupted and waited long enough, force break
            if interrupted_time and (time.time() - interrupted_time > 5.0):
                print(f"[EXECUTE] Cell {cell_index} interrupt timeout, breaking out", file=sys.stderr, flush=True)
                self.interrupted_cell = None  # Clear the flag
                result.update({
                    'status': 'error',
                    'error': {
                        'output_type': 'error',
                        'ename': 'KeyboardInterrupt',
                        'evalue': 'Execution interrupted by user',
                        'traceback': []  # No traceback needed for user-initiated interrupt
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
                # Clear interrupted flag if this was interrupted
                if self.interrupted_cell == cell_index:
                    print(f"[EXECUTE] Cell {cell_index} completed after interrupt", file=sys.stderr, flush=True)
                    self.interrupted_cell = None
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
        """Interrupt the kernel using the control socket"""
        import sys
        print(f"[INTERRUPT] Starting interrupt for cell {cell_index}", file=sys.stderr, flush=True)

        # Mark this cell as interrupted so execute_cell can break out
        if isinstance(cell_index, int):
            self.interrupted_cell = cell_index
            print(f"[INTERRUPT] Marked cell {cell_index} as interrupted", file=sys.stderr, flush=True)

        payload: dict[str, object] = {'type': 'interrupt'}
        if isinstance(cell_index, int):
            payload['cell_index'] = cell_index

        # Send interrupt on control socket (non-blocking)
        try:
            self.ctrl.setsockopt(zmq.SNDTIMEO, 1000)  # type: ignore[reportAttributeAccessIssue]
            self.ctrl.setsockopt(zmq.RCVTIMEO, 1000)  # type: ignore[reportAttributeAccessIssue]
            self.ctrl.send_json(payload)  # type: ignore[reportAttributeAccessIssue]
            _ = cast(dict[str, object], self.ctrl.recv_json())  # type: ignore[reportAttributeAccessIssue]
            print(f"[INTERRUPT] Sent interrupt signal to worker via control socket", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[INTERRUPT] Could not send interrupt signal: {e}", file=sys.stderr, flush=True)
            # If control socket fails, try force-kill immediately
            print(f"[INTERRUPT] Force killing worker immediately...", file=sys.stderr, flush=True)
            await self._force_kill_worker()
        finally:
            # Reset timeouts
            self.ctrl.setsockopt(zmq.SNDTIMEO, -1)  # type: ignore[reportAttributeAccessIssue]
            self.ctrl.setsockopt(zmq.RCVTIMEO, -1)  # type: ignore[reportAttributeAccessIssue]

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
            print(f"[FORCE_KILL] Resetting REQ and CTRL sockets", file=sys.stderr, flush=True)
            self.req.close(0)  # type: ignore[reportAttributeAccessIssue]
            self.req = self.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
            self.req.connect(self.cmd_addr)  # type: ignore[reportAttributeAccessIssue]
            self.ctrl.close(0)  # type: ignore[reportAttributeAccessIssue]
            self.ctrl = self.ctx.socket(zmq.DEALER)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
            self.ctrl.connect(self.ctrl_addr)  # type: ignore[reportAttributeAccessIssue]
            print(f"[FORCE_KILL] Socket reset complete", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[FORCE_KILL] Error resetting sockets: {e}", file=sys.stderr, flush=True)

        # Respawn worker
        try:
            self._ensure_worker()
        except Exception:
            pass

    def reset_kernel(self) -> None:
        """Reset the kernel by shutting down worker and restarting"""
        import sys
        print(f"[RESET] Starting kernel reset, worker_pid={self.worker_pid}, is_remote={self.is_remote}", file=sys.stderr, flush=True)

        # If connected to remote GPU, DON'T kill the worker - just send shutdown message
        if self.is_remote:
            print(f"[RESET] Remote worker - sending shutdown message only", file=sys.stderr, flush=True)
            try:
                self.req.setsockopt(zmq.SNDTIMEO, 2000)  # type: ignore[reportAttributeAccessIssue]
                self.req.setsockopt(zmq.RCVTIMEO, 2000)  # type: ignore[reportAttributeAccessIssue]
                self.req.send_json({'type': 'shutdown'})  # type: ignore[reportAttributeAccessIssue]
                _ = cast(dict[str, object], self.req.recv_json())  # type: ignore[reportAttributeAccessIssue]
                print(f"[RESET] Remote worker acknowledged shutdown", file=sys.stderr, flush=True)
            except Exception as e:
                print(f"[RESET] Remote worker shutdown failed: {e}", file=sys.stderr, flush=True)
            finally:
                self.req.setsockopt(zmq.SNDTIMEO, -1)  # type: ignore[reportAttributeAccessIssue]
                self.req.setsockopt(zmq.RCVTIMEO, -1)  # type: ignore[reportAttributeAccessIssue]

            # Reset execution count but don't respawn worker
            self.execution_count = 0
            print(f"[RESET] Remote kernel reset complete", file=sys.stderr, flush=True)
            return

        # Local worker mode - try graceful shutdown first
        try:
            self.req.setsockopt(zmq.SNDTIMEO, 500)  # type: ignore[reportAttributeAccessIssue]
            self.req.setsockopt(zmq.RCVTIMEO, 500)  # type: ignore[reportAttributeAccessIssue]
            self.req.send_json({'type': 'shutdown'})  # type: ignore[reportAttributeAccessIssue]
            _ = cast(dict[str, object], self.req.recv_json())  # type: ignore[reportAttributeAccessIssue]
            print(f"[RESET] Sent graceful shutdown message", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[RESET] Graceful shutdown failed: {e}", file=sys.stderr, flush=True)
        finally:
            self.req.setsockopt(zmq.SNDTIMEO, -1)  # type: ignore[reportAttributeAccessIssue]
            self.req.setsockopt(zmq.RCVTIMEO, -1)  # type: ignore[reportAttributeAccessIssue]

        # Force kill local worker if needed
        if self.worker_pid:
            try:
                print(f"[RESET] Sending SIGTERM to worker PID {self.worker_pid}", file=sys.stderr, flush=True)
                os.kill(self.worker_pid, signal.SIGTERM)
                time.sleep(0.3)  # Give it time to shutdown gracefully
                try:
                    # Check if still alive
                    os.kill(self.worker_pid, 0)
                    # Still alive, force kill
                    print(f"[RESET] Worker still alive, sending SIGKILL", file=sys.stderr, flush=True)
                    os.kill(self.worker_pid, signal.SIGKILL)
                    time.sleep(0.2)  # Wait for SIGKILL to complete
                except ProcessLookupError:
                    print(f"[RESET] Worker process terminated", file=sys.stderr, flush=True)
            except Exception as e:
                print(f"[RESET] Error killing worker: {e}", file=sys.stderr, flush=True)

        if self.worker_proc:
            try:
                self.worker_proc.terminate()
                self.worker_proc.wait(timeout=1)
                print(f"[RESET] Worker process terminated via Popen", file=sys.stderr, flush=True)
            except Exception:
                try:
                    self.worker_proc.kill()
                    print(f"[RESET] Worker process killed via Popen", file=sys.stderr, flush=True)
                except Exception as e:
                    print(f"[RESET] Error killing via Popen: {e}", file=sys.stderr, flush=True)

        # Close sockets first, BEFORE recreating them
        print(f"[RESET] Closing old sockets", file=sys.stderr, flush=True)
        try:
            self.req.close(0)  # type: ignore[reportAttributeAccessIssue]
        except Exception:
            pass
        try:
            self.ctrl.close(0)  # type: ignore[reportAttributeAccessIssue]
        except Exception:
            pass

        # Wait for ZMQ to release the sockets (critical!)
        time.sleep(0.5)
        print(f"[RESET] Sockets closed, waited for cleanup", file=sys.stderr, flush=True)

        # Reset state
        self.execution_count = 0
        self.worker_pid = None
        self.worker_proc = None

        # Recreate sockets
        try:
            print(f"[RESET] Creating new sockets", file=sys.stderr, flush=True)
            self.req = self.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
            self.req.connect(self.cmd_addr)  # type: ignore[reportAttributeAccessIssue]
            self.ctrl = self.ctx.socket(zmq.DEALER)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
            self.ctrl.connect(self.ctrl_addr)  # type: ignore[reportAttributeAccessIssue]
            print(f"[RESET] New sockets created successfully", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[RESET] Error creating sockets: {e}", file=sys.stderr, flush=True)

        # Reset special handler
        if self.special_handler is not None:
            self.special_handler = AsyncSpecialCommandHandler({"__name__": "__main__"})

        # Respawn worker
        try:
            print(f"[RESET] Respawning new worker", file=sys.stderr, flush=True)
            self._ensure_worker()
            print(f"[RESET] Kernel reset complete, new worker_pid={self.worker_pid}", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[RESET] Error respawning worker: {e}", file=sys.stderr, flush=True)
            import traceback
            traceback.print_exc()
