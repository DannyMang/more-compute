from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import json
import os
import asyncio
from datetime import datetime, timezone
from typing import Optional, List, Dict
from pathlib import Path
import importlib.metadata as importlib_metadata

from .notebook import Notebook
import os as _os
mode = _os.getenv('MORECOMPUTE_EXECUTION_MODE', 'inprocess')
if mode == 'process':
    from .next_process_executor import NextProcessExecutor as _Executor
elif mode == 'zmq':
    from .next_zmq_executor import NextZmqExecutor as _Executor
else:
    from .next_executor import NextCodeExecutor as _Executor
from .utils.pyEnv import PythonEnvironmentDetector
from .utils.systemEnv import DeviceMetrics
from .utils.error_utils import ErrorUtils


BASE_DIR = Path(os.getenv("MORECOMPUTE_ROOT", Path.cwd())).resolve()
PACKAGE_DIR = Path(__file__).resolve().parent
STATIC_DIR = (PACKAGE_DIR / "static").resolve()
TEMPLATES_DIR = (PACKAGE_DIR / "templates").resolve()
ASSETS_DIR = Path(os.getenv("MORECOMPUTE_ASSETS_DIR", BASE_DIR / "assets")).resolve()


def resolve_path(requested_path: str) -> Path:
    relative = requested_path or "."
    target = (BASE_DIR / relative).resolve()
    try:
        target.relative_to(BASE_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="Path outside notebook root")
    return target


app = FastAPI()
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")

# Global instances for the application state
notebook_path_env = os.getenv("MORECOMPUTE_NOTEBOOK_PATH")
if notebook_path_env:
    notebook = Notebook(file_path=notebook_path_env)
else:
    notebook = Notebook()
error_utils = ErrorUtils()
executor = _Executor(error_utils=error_utils)
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
metrics = DeviceMetrics()


def _coerce_cell_source(value):
    if value is None:
        return ''
    if isinstance(value, str):
        return value
    if isinstance(value, (bytes, bytearray)):
        try:
            return value.decode('utf-8')  # type: ignore[arg-type]
        except Exception:
            return value.decode('utf-8', errors='ignore')  # type: ignore[arg-type]
    if isinstance(value, list):
        parts = []
        for item in value:
            if item is None:
                continue
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, (bytes, bytearray)):
                try:
                    parts.append(item.decode('utf-8'))  # type: ignore[arg-type]
                except Exception:
                    parts.append(item.decode('utf-8', errors='ignore'))  # type: ignore[arg-type]
            else:
                parts.append(str(item))
        return ''.join(parts)
    return str(value)

@app.get("/")
async def read_root(request: Request):
    return templates.TemplateResponse("notebook.html", {"request": request})

@app.get("/api/packages")
async def list_installed_packages():
    """Return installed packages for the current Python runtime."""
    try:
        packages = []
        for dist in importlib_metadata.distributions():
            name = dist.metadata.get("Name") or dist.metadata.get("Summary") or dist.metadata.get("name")
            version = dist.version
            if name and version:
                packages.append({"name": str(name), "version": str(version)})
        packages.sort(key=lambda p: p["name"].lower())
        return {"packages": packages}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list packages: {exc}")


@app.get("/api/metrics")
async def get_metrics():
    try:
        return metrics.get_all_devices()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to get metrics: {exc}")



@app.get("/api/files")
async def list_files(path: str = "."):
    directory = resolve_path(path)
    if not directory.exists() or not directory.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    items: List[Dict[str, Optional[str]]] = []
    try:
        for entry in sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            stat = entry.stat()
            item_path = entry.relative_to(BASE_DIR)
            items.append({
                "name": entry.name,
                "path": str(item_path).replace("\\", "/"),
                "type": "directory" if entry.is_dir() else "file",
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=f"Permission denied: {exc}")

    return {
        "root": str(BASE_DIR),
        "path": str(directory.relative_to(BASE_DIR)) if directory != BASE_DIR else ".",
        "items": items,
    }


@app.get("/api/file")
async def read_file(path: str, max_bytes: int = 256_000):
    file_path = resolve_path(path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        with file_path.open("rb") as f:
            content = f.read(max_bytes + 1)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=f"Permission denied: {exc}")

    truncated = len(content) > max_bytes
    if truncated:
        content = content[:max_bytes]

    text = content.decode("utf-8", errors="replace")
    if truncated:
        text += "\n\n… (truncated)"

    return PlainTextResponse(text)

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
            "load_notebook": self._handle_load_notebook,
            "save_notebook": self._handle_save_notebook,
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

        source = _coerce_cell_source(self.notebook.cells[cell_index].get('source', ''))
        
        await websocket.send_json({
            "type": "execution_start",
            "data": {"cell_index": cell_index, "execution_count": getattr(self.executor, 'execution_count', 0) + 1}
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
            #self.notebook.save_to_file()
            #to -do? 

    
    async def _handle_load_notebook(self, websocket: WebSocket, data: dict):
        # In a real app, this would load from a file path in `data`
        # For now, it just sends the current state back to the requester
        await websocket.send_json({
            "type": "notebook_data",
            "data": self.notebook.get_notebook_data()
        })

    async def _handle_save_notebook(self, websocket: WebSocket, data: dict):
        try:
            self.notebook.save_to_file()
            await websocket.send_json({"type": "notebook_saved", "data": {"file_path": self.notebook.file_path}})
        except Exception as exc:
            await self._send_error(websocket, f"Failed to save notebook: {exc}")

    async def _handle_interrupt_kernel(self, websocket: WebSocket, data: dict):
        try:
            cell_index = data.get('cell_index')
        except Exception:
            cell_index = None
        await self.executor.interrupt_kernel(cell_index=cell_index)
        # Inform all clients that the currently running cell (if any) is interrupted
        try:
            await websocket.send_json({
                "type": "execution_error",
                "data": {
                    "cell_index": data.get('cell_index'),
                    "error": {
                        "output_type": "error",
                        "ename": "KeyboardInterrupt",
                        "evalue": "Execution interrupted by user",
                        "traceback": []
                    }
                }
            })
        except Exception:
            pass
    
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
