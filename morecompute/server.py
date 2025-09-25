from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import json
import os
import asyncio
from datetime import datetime, timezone
from typing import Optional, List, Dict
from pathlib import Path

from .notebook import Notebook
from .next_executor import NextCodeExecutor
from .utils.pyEnv import PythonEnvironmentDetector
from .utils.systemEnv import DeviceMetrics
from .utils.error_utils import ErrorUtils


app = FastAPI()
app.mount("/static", StaticFiles(directory="morecompute/static"), name="static")
app.mount("/assets", StaticFiles(directory="assets"), name="assets")

# Global instances for the application state
notebook = Notebook()
error_utils = ErrorUtils()
executor = NextCodeExecutor(error_utils=error_utils)

templates = Jinja2Templates(directory="morecompute/templates")

@app.get("/")
async def read_root(request: Request):
    return templates.TemplateResponse("notebook.html", {"request": request})

class WebSocketManager:
    """Manages WebSocket connections and message handling."""
    def __init__(self):
        self.clients: Dict[WebSocket, None] = {}
        self.executor = executor
        self.notebook = notebook

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.clients[websocket] = None
        # Send the initial notebook state to the new client
        await websocket.send_json({
            "type": "notebook_data",
            "data": self.notebook.get_notebook_data()
        })

    def disconnect(self, websocket: WebSocket):
        del self.clients[websocket]

    async def broadcast_notebook_update(self):
        """Send the entire notebook state to all connected clients."""
        updated_data = self.notebook.get_notebook_data()
        for client in self.clients:
            await client.send_json({
                "type": "notebook_updated",
                "data": updated_data
            })

    async def handle_message_loop(self, websocket: WebSocket):
        """Main loop to handle incoming WebSocket messages."""
        while True:
            try:
                message = await websocket.receive_json()
                await self._handle_message(websocket, message)
            except WebSocketDisconnect:
                self.disconnect(websocket)
                break
            except Exception as e:
                await self._send_error(websocket, f"Unhandled error: {e}")

    async def _handle_message(self, websocket: WebSocket, message: dict):
        message_type = message.get("type")
        data = message.get("data", {})
        
        handlers = {
            "execute_cell": self._handle_execute_cell,
            "add_cell": self._handle_add_cell,
            "delete_cell": self._handle_delete_cell,
            "update_cell": self._handle_update_cell,
            "interrupt_kernel": self._handle_interrupt_kernel,
            "reset_kernel": self._handle_reset_kernel,
            "load_notebook": self._handle_load_notebook
        }

        handler = handlers.get(message_type)
        if handler:
            await handler(websocket, data)
        else:
            await self._send_error(websocket, f"Unknown message type: {message_type}")

    async def _handle_execute_cell(self, websocket: WebSocket, data: dict):
        cell_index = data.get("cell_index")
        
        if cell_index is None or not (0 <= cell_index < len(self.notebook.cells)):
            await self._send_error(websocket, "Invalid cell index.")
            return

        source = self.notebook.cells[cell_index].get('source', '')
        
        await websocket.send_json({
            "type": "execution_start",
            "data": {"cell_index": cell_index, "execution_count": self.executor.execution_count + 1}
        })
        
        result = await self.executor.execute_cell(cell_index, source, websocket)
        
        self.notebook.cells[cell_index]['outputs'] = result.get('outputs', [])
        self.notebook.cells[cell_index]['execution_count'] = result.get('execution_count')
        
        await websocket.send_json({
            "type": "execution_complete",
            "data": { "cell_index": cell_index, "result": result }
        })

    async def _handle_add_cell(self, websocket: WebSocket, data: dict):
        index = data.get('index', len(self.notebook.cells))
        cell_type = data.get('cell_type', 'code')
        self.notebook.add_cell(index=index, cell_type=cell_type)
        await self.broadcast_notebook_update()

    async def _handle_delete_cell(self, websocket: WebSocket, data: dict):
        index = data.get('cell_index')
        if index is not None:
            self.notebook.delete_cell(index)
            await self.broadcast_notebook_update()

    async def _handle_update_cell(self, websocket: WebSocket, data: dict):
        index = data.get('cell_index')
        source = data.get('source')
        if index is not None and source is not None:
            self.notebook.update_cell(index, source)
            # No broadcast needed for simple source updates, handled client-side
    
    async def _handle_load_notebook(self, websocket: WebSocket, data: dict):
        # In a real app, this would load from a file path in `data`
        # For now, it just sends the current state back to the requester
        await websocket.send_json({
            "type": "notebook_data",
            "data": self.notebook.get_notebook_data()
        })

    async def _handle_interrupt_kernel(self, websocket: WebSocket, data: dict):
        await self.executor.interrupt_kernel()
        await websocket.send_json({"type": "kernel_interrupted", "data": {}})
    
    async def _handle_reset_kernel(self, websocket: WebSocket, data: dict):
        self.executor.reset_kernel()
        self.notebook.clear_all_outputs()
        await self.broadcast_notebook_update()

    async def _send_error(self, websocket: WebSocket, error_message: str):
        await websocket.send_json({"type": "error", "data": {"error": error_message}})

manager = WebSocketManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    await manager.handle_message_loop(websocket)
