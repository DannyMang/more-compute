import multiprocessing as mp
import os
import sys
import time
import asyncio
import signal
from typing import Optional, Dict, Any

from fastapi import WebSocket

from .process_worker import worker_main


class NextProcessExecutor:
    def __init__(self, error_utils, interrupt_timeout: float = 5.0):
        self.error_utils = error_utils
        self.interrupt_timeout = interrupt_timeout
        self.command_queue: Optional[mp.Queue] = None
        self.output_queue: Optional[mp.Queue] = None
        self.shutdown_event: Optional[mp.Event] = None
        self.proc: Optional[mp.Process] = None
        self._spawn_worker()

    def _spawn_worker(self):
        mp_ctx = mp.get_context('spawn')
        self.command_queue = mp_ctx.Queue(maxsize=100)
        self.output_queue = mp_ctx.Queue(maxsize=500)
        self.shutdown_event = mp_ctx.Event()
        self.proc = mp_ctx.Process(target=worker_main, args=(self.command_queue, self.output_queue, self.shutdown_event), daemon=True)
        self.proc.start()

    def _forward_outputs(self, websocket: Optional[WebSocket]):
        # Drain outputs non-blocking, forward to websocket
        if not self.output_queue:
            return
        while True:
            try:
                msg = self.output_queue.get_nowait()
            except Exception:
                break
            if not websocket:
                continue
            try:
                websocket_msg = {'type': msg.get('type'), 'data': msg}
                # Flatten to match current frontend expectations where appropriate
                if msg['type'] in ('execution_start', 'execution_complete', 'execution_error', 'notebook_updated'):
                    websocket_msg = {'type': msg['type'], 'data': msg}
                elif msg['type'] in ('stream', 'execute_result', 'display_data'):
                    websocket_msg = {'type': msg['type' if msg['type'] != 'execute_result' else 'execute_result'].replace('_', ' '), 'data': msg}
                # Normalize names to existing ones
                if msg['type'] == 'stream':
                    websocket_msg = {'type': 'stream_output', 'data': msg}
                if msg['type'] == 'execute_result':
                    websocket_msg = {'type': 'execute_result', 'data': msg}
                if msg['type'] == 'display_data':
                    websocket_msg = {'type': 'execute_result', 'data': {'cell_index': msg.get('cell_index'), 'execution_count': None, 'data': msg.get('data')}}
                if msg['type'] == 'execution_start':
                    websocket_msg = {'type': 'execution_start', 'data': {'cell_index': msg.get('cell_index'), 'execution_count': msg.get('execution_count')}}
                if msg['type'] == 'execution_complete':
                    websocket_msg = {'type': 'execution_complete', 'data': msg}
                if msg['type'] == 'execution_error':
                    websocket_msg = {'type': 'execution_error', 'data': msg}
                # Send
                # FastAPI WebSocket requires await, but we pump from caller's async loop
            except Exception:
                continue

    async def execute_cell(self, cell_index: int, source_code: str, websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        if not self.proc or not self.proc.is_alive():
            self._spawn_worker()
        assert self.command_queue is not None
        assert self.output_queue is not None
        self.command_queue.put({'type': 'execute_cell', 'code': source_code, 'cell_index': cell_index})

        # Pump outputs until we see execution_complete for this cell
        result: Dict[str, Any] = {
            'outputs': [], 'error': None, 'status': 'ok', 'execution_count': None, 'execution_time': None
        }
        while True:
            try:
                msg = self.output_queue.get(timeout=0.05)
            except Exception:
                await self._send_pending(websocket)
                continue
            mtype = msg.get('type')
            if mtype == 'execution_complete' and msg.get('cell_index') == cell_index:
                result.update(msg.get('result') or {})
                await self._send_pending(websocket, final_msg={'type': 'execution_complete', 'data': msg})
                break
            else:
                await self._forward_one(msg, websocket)
            # Throttle to avoid flooding the UI
            await asyncio.sleep(0.005)
        return result

    async def _forward_one(self, msg: Dict[str, Any], websocket: Optional[WebSocket]):
        if not websocket:
            return
        try:
            t = msg.get('type')
            if t == 'stream':
                await websocket.send_json({'type': 'stream_output', 'data': msg})
            elif t == 'stream_update':
                await websocket.send_json({'type': 'stream_output', 'data': msg})
            elif t == 'execute_result':
                await websocket.send_json({'type': 'execute_result', 'data': msg})
            elif t == 'display_data':
                await websocket.send_json({'type': 'execute_result', 'data': {'cell_index': msg.get('cell_index'), 'execution_count': None, 'data': msg.get('data')}})
            elif t == 'execution_start':
                await websocket.send_json({'type': 'execution_start', 'data': {'cell_index': msg.get('cell_index'), 'execution_count': msg.get('execution_count')}})
            elif t == 'execution_error':
                await websocket.send_json({'type': 'execution_error', 'data': msg})
        except Exception:
            pass

    async def _send_pending(self, websocket: Optional[WebSocket], final_msg: Optional[Dict[str, Any]] = None):
        # Drain any queue items quickly
        if not websocket or not self.output_queue:
            return
        while True:
            try:
                msg = self.output_queue.get_nowait()
            except Exception:
                break
            await self._forward_one(msg, websocket)
        if final_msg:
            try:
                await websocket.send_json(final_msg)
            except Exception:
                pass

    async def interrupt_kernel(self, cell_index: Optional[int] = None):
        # Ignore cell_index for process executor but keep signature compatible
        # Escalation: request graceful, then terminate/kill and respawn
        if not self.proc or not self.proc.is_alive():
            return
        try:
            if os.name != 'nt':
                os.killpg(os.getpgid(self.proc.pid), signal.SIGINT)  # type: ignore[name-defined]
            else:
                os.kill(self.proc.pid, signal.CTRL_BREAK_EVENT)  # type: ignore[attr-defined]
        except Exception:
            pass
        start = time.time()
        while time.time() - start < self.interrupt_timeout:
            if not self.proc.is_alive():
                return
            await asyncio.sleep(0.05)  # type: ignore[name-defined]
        # Force terminate
        try:
            self.proc.terminate()
            self.proc.join(timeout=2)
            if self.proc.is_alive():
                self.proc.kill()
        except Exception:
            pass
        # Respawn
        self._spawn_worker()

    def reset_kernel(self):
        try:
            if self.proc and self.proc.is_alive():
                self.proc.terminate(); self.proc.join(timeout=2)
                if self.proc.is_alive():
                    self.proc.kill()
        except Exception:
            pass
        self._spawn_worker()


