import os
import time
from typing import Optional, Dict, Any
import subprocess
import sys
import asyncio
from fastapi import WebSocket
import zmq

from .utils.special_commands import AsyncSpecialCommandHandler

class NextZmqExecutor:
    def __init__(self, error_utils, cmd_addr: Optional[str] = None, pub_addr: Optional[str] = None):
        self.error_utils = error_utils
        self.cmd_addr = cmd_addr or os.getenv('MC_ZMQ_CMD_ADDR', 'tcp://127.0.0.1:5555')
        self.pub_addr = pub_addr or os.getenv('MC_ZMQ_PUB_ADDR', 'tcp://127.0.0.1:5556')
        self.execution_count = 0
        self.special_handler: Optional[AsyncSpecialCommandHandler] = None
        self._ensure_special_handler()
        self.ctx = zmq.Context.instance()
        self.req = self.ctx.socket(zmq.REQ)
        self.req.connect(self.cmd_addr)
        self.sub = self.ctx.socket(zmq.SUB)
        self.sub.connect(self.pub_addr)
        self.sub.setsockopt_string(zmq.SUBSCRIBE, '')
        self._ensure_worker()

    def _ensure_special_handler(self):
        if self.special_handler is None:
            self.special_handler = AsyncSpecialCommandHandler({"__name__": "__main__"})

    def _ensure_worker(self):
        # Use a temporary REQ socket for probing to avoid locking self.req's state
        tmp = self.ctx.socket(zmq.REQ)
        tmp.setsockopt(zmq.LINGER, 0)
        tmp.setsockopt(zmq.RCVTIMEO, 500)
        tmp.setsockopt(zmq.SNDTIMEO, 500)
        try:
            tmp.connect(self.cmd_addr)
            tmp.send_json({'type': 'ping'})
            _ = tmp.recv_json()
        except Exception:
            pass
        else:
            return
        finally:
            try:
                tmp.close(0)
            except Exception:
                pass
        # Spawn a worker detached if not reachable
        env = os.environ.copy()
        env.setdefault('MC_ZMQ_CMD_ADDR', self.cmd_addr)
        env.setdefault('MC_ZMQ_PUB_ADDR', self.pub_addr)
        try:
            subprocess.Popen([sys.executable, '-m', 'morecompute.zmq_worker'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(50):
                try:
                    tmp2 = self.ctx.socket(zmq.REQ)
                    tmp2.setsockopt(zmq.LINGER, 0)
                    tmp2.setsockopt(zmq.RCVTIMEO, 500)
                    tmp2.setsockopt(zmq.SNDTIMEO, 500)
                    tmp2.connect(self.cmd_addr)
                    tmp2.send_json({'type': 'ping'})
                    _ = tmp2.recv_json()
                except Exception:
                    time.sleep(0.1)
                except Exception:
                    pass
                else:
                    return
                finally:
                    try:
                        tmp2.close(0)
                    except Exception:
                        pass
        except Exception:
            pass
        raise RuntimeError('Failed to start/connect ZMQ worker')

    async def execute_cell(self, cell_index: int, source_code: str, websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        self._ensure_special_handler()
        handler = self.special_handler
        normalized_source = source_code
        if handler is not None:
            normalized_source = handler._coerce_source_to_text(source_code)  # type: ignore[attr-defined]
            if handler.is_special_command(normalized_source):
                execution_count = getattr(self, 'execution_count', 0) + 1
                self.execution_count = execution_count
                start_time = time.time()
                result: Dict[str, Any] = {
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
        result: Dict[str, Any] = {'outputs': [], 'error': None, 'status': 'ok', 'execution_count': execution_count, 'execution_time': None}
        if websocket:
            await websocket.send_json({'type': 'execution_start', 'data': {'cell_index': cell_index, 'execution_count': execution_count}})

        self.req.send_json({'type': 'execute_cell', 'code': source_code, 'cell_index': cell_index, 'execution_count': execution_count})
        # Consume pub until we see complete for this cell
        start_time = time.time()
        while True:
            try:
                msg = self.sub.recv_json(flags=zmq.NOBLOCK)
            except zmq.Again:
                await asyncio.sleep(0.01)
                continue
            t = msg.get('type')
            if t == 'stream' and websocket:
                await websocket.send_json({'type': 'stream_output', 'data': msg})
            elif t == 'stream_update' and websocket:
                await websocket.send_json({'type': 'stream_output', 'data': msg})
            elif t == 'execute_result' and websocket:
                await websocket.send_json({'type': 'execute_result', 'data': msg})
            elif t == 'display_data' and websocket:
                await websocket.send_json({'type': 'execute_result', 'data': {'cell_index': msg.get('cell_index'), 'execution_count': None, 'data': msg.get('data')}})
            elif t == 'execution_error' and websocket:
                await websocket.send_json({'type': 'execution_error', 'data': msg})
            elif t == 'execution_error':
                if msg.get('cell_index') == cell_index:
                    result.update({'status': 'error', 'error': msg.get('error')})
            elif t == 'execution_complete' and msg.get('cell_index') == cell_index:
                result.update(msg.get('result') or {})
                result.setdefault('execution_count', execution_count)
                break
        try:
            _ = self.req.recv_json(flags=0)
        except Exception:
            pass
        result['execution_time'] = f"{(time.time()-start_time)*1000:.1f}ms"
        if websocket:
            await websocket.send_json({'type': 'execution_complete', 'data': {'cell_index': cell_index, 'result': result}})
        return result

    async def interrupt_kernel(self, cell_index: Optional[int] = None):
        payload: Dict[str, Any] = {'type': 'interrupt'}
        if isinstance(cell_index, int):
            payload['cell_index'] = cell_index
        try:
            self.req.send_json(payload)
            _ = self.req.recv_json()
        except Exception:
            pass
        if self.special_handler:
            try:
                await self.special_handler.interrupt()
            except Exception:
                pass

    def reset_kernel(self):
        try:
            self.req.send_json({'type': 'shutdown'})
            _ = self.req.recv_json()
        except Exception:
            pass
        self.execution_count = 0
        if self.special_handler is not None:
            self.special_handler = AsyncSpecialCommandHandler({"__name__": "__main__"})


