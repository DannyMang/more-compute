from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import json
import os
import asyncio
from datetime import datetime, timezone
from typing import Optional, List
from pathlib import Path

from .notebook import NotebookHandler
from .executor import CellExecutor
from .utils.pyEnv import PythonEnvironmentDetector
from .utils.systemEnv import DeviceMetrics


class NotebookServer:
    """FastAPI server for the interactive notebook interface"""

    def __init__(self, host='localhost', port=8888, debug=False):
        self.host = host
        self.port = port
        self.debug = debug
        self.notebook_handler: Optional[NotebookHandler] = None
        self.executor = CellExecutor()
        self.active_connections: List[WebSocket] = []
        self.python_detector = PythonEnvironmentDetector()

        # Create FastAPI app
        self.app = FastAPI(title="MoreCompute", description="Interactive Notebook")

        # Setup static files and templates
        self._setup_static_files()
        self._setup_routes()
        self._setup_websocket()

    def _setup_static_files(self):
        """Setup static files and templates"""
        template_dir = os.path.join(os.path.dirname(__file__), 'templates')
        static_dir = os.path.join(os.path.dirname(__file__), 'static')
        assets_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'assets')

        self.templates = Jinja2Templates(directory=template_dir)

        # Mount static directories
        self.app.mount("/static", StaticFiles(directory=static_dir), name="static")
        self.app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    def _setup_routes(self):
        """Setup FastAPI routes"""

        @self.app.get("/", response_class=HTMLResponse)
        async def index(request: Request):
            return self.templates.TemplateResponse("notebook.html", {"request": request})

        @self.app.get("/api/notebook")
        async def get_notebook():
            """Get current notebook data"""
            if self.notebook_handler:
                return self.notebook_handler.to_dict()
            else:
                # Return empty notebook
                empty_notebook = NotebookHandler()
                return empty_notebook.to_dict()

        @self.app.post("/api/save")
        async def save_notebook(data: dict):
            """Save current notebook"""
            try:
                file_path = data.get('file_path')

                if not file_path:
                    # Generate a default filename
                    file_path = 'untitled.py'

                if self.notebook_handler:
                    self.notebook_handler.save_file(file_path)
                    return {'status': 'success', 'file_path': file_path}
                else:
                    return {'status': 'error', 'message': 'No notebook loaded'}

            except Exception as e:
                return {'status': 'error', 'message': str(e)}

        @self.app.get("/api/variables")
        async def get_variables():
            """Get current kernel variables"""
            return self.executor.get_variables()

        @self.app.get("/api/python-environments")
        async def get_python_environments():
            """Get detected Python environments (fast version)"""
            try:
                # Use fast detection to avoid hanging
                environments = self.python_detector.detect_fast_environments()
                #environments = self.python_detector.detect_all_environments()
                #fix later
                current_env = self.python_detector.get_current_environment()

                return {
                    'status': 'success',
                    'environments': environments,
                    'current': current_env
                }
            except Exception as e:
                return {
                    'status': 'error',
                    'message': str(e),
                    'environments': [],
                    'current': None
                }

        @self.app.get("/api/metrics")
        async def get_metrics():
            try:
                device_metrics = DeviceMetrics()
                all_devices = device_metrics.get_all_devices()

                return {
                    'status': 'success',
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                    'devices': all_devices
                }
            except Exception as e:
                return {
                    'status': 'error',
                    'message': str(e)
                }


    def _setup_websocket(self):
        """Setup WebSocket endpoint"""

        @self.app.websocket("/ws")
        async def websocket_endpoint(websocket: WebSocket):
            await websocket.accept()
            self.active_connections.append(websocket)

            if self.debug:
                print('Client connected via WebSocket')

            # Send initial notebook data
            try:
                if self.notebook_handler:
                    await websocket.send_json({
                        "type": "notebook_data",
                        "data": self.notebook_handler.to_dict()
                    })
                else:
                    # Send empty notebook data to initialize the frontend
                    empty_notebook = NotebookHandler()
                    await websocket.send_json({
                        "type": "notebook_data",
                        "data": empty_notebook.to_dict()
                    })
            except Exception as e:
                if self.debug:
                    print(f"Error sending initial data: {e}")

            try:
                while True:
                    # Receive message from client
                    message = await websocket.receive_json()
                    await self._handle_websocket_message(websocket, message)

            except WebSocketDisconnect:
                if self.debug:
                    print('Client disconnected')
                self.active_connections.remove(websocket)
            except Exception as e:
                if self.debug:
                    print(f"WebSocket error: {e}")
                if websocket in self.active_connections:
                    self.active_connections.remove(websocket)

    async def _handle_websocket_message(self, websocket: WebSocket, message: dict):
        """Handle incoming WebSocket messages"""
        message_type = message.get('type')
        data = message.get('data', {})

        try:
            if message_type == 'execute_cell':
                await self._handle_execute_cell(websocket, data)
            elif message_type == 'add_cell':
                await self._handle_add_cell(websocket, data)
            elif message_type == 'delete_cell':
                await self._handle_delete_cell(websocket, data)
            elif message_type == 'update_cell':
                await self._handle_update_cell(websocket, data)
            elif message_type == 'reset_kernel':
                await self._handle_reset_kernel(websocket)
            elif message_type == 'save_notebook':
                await self._handle_save_notebook(websocket, data)
            else:
                await websocket.send_json({
                    "type": "error",
                    "data": {"error": f"Unknown message type: {message_type}"}
                })
        except Exception as e:
            await websocket.send_json({
                "type": "error",
                "data": {"error": str(e)}
            })

    async def _handle_execute_cell(self, websocket: WebSocket, data: dict):
        """Execute a cell and return results"""
        cell_index = data.get('cell_index')
        source_code = data.get('source')

        if source_code is None:
            await websocket.send_json({
                "type": "execution_error",
                "data": {"error": "No source code provided"}
            })
            return

        # Execute the cell
        result = self.executor.execute_cell(source_code)

        # Update cell in notebook if we have one
        if self.notebook_handler and cell_index is not None:
            if 0 <= cell_index < len(self.notebook_handler.cells):
                cell = self.notebook_handler.cells[cell_index]
                cell.outputs = result['outputs']
                cell.execution_count = result['execution_count']

        # Send result back
        await websocket.send_json({
            "type": "execution_result",
            "data": {
                "cell_index": cell_index,
                "result": result
            }
        })

    async def _handle_add_cell(self, websocket: WebSocket, data: dict):
        """Add a new cell"""
        index = data.get('index', -1)
        cell_type = data.get('cell_type', 'code')
        source = data.get('source', '')

        if self.notebook_handler:
            new_index = self.notebook_handler.add_cell(index, cell_type, source)
        else:
            # Create new notebook if none exists
            self.notebook_handler = NotebookHandler()
            new_index = self.notebook_handler.add_cell(index, cell_type, source)

        # Broadcast updated notebook to all connections
        notebook_data = self.notebook_handler.to_dict()
        for connection in self.active_connections:
            try:
                await connection.send_json({
                    "type": "notebook_updated",
                    "data": notebook_data
                })
            except:
                # Remove failed connections
                if connection in self.active_connections:
                    self.active_connections.remove(connection)

    async def _handle_delete_cell(self, websocket: WebSocket, data: dict):
        """Delete a cell"""
        cell_index = data.get('cell_index')

        if self.notebook_handler and cell_index is not None:
            success = self.notebook_handler.delete_cell(cell_index)
            if success:
                # Broadcast updated notebook to all connections
                notebook_data = self.notebook_handler.to_dict()
                for connection in self.active_connections:
                    try:
                        await connection.send_json({
                            "type": "notebook_updated",
                            "data": notebook_data
                        })
                    except:
                        # Remove failed connections
                        if connection in self.active_connections:
                            self.active_connections.remove(connection)
            else:
                await websocket.send_json({
                    "type": "delete_error",
                    "data": {"error": "Cell index out of range"}
                })

    async def _handle_update_cell(self, websocket: WebSocket, data: dict):
        """Update cell source code"""
        cell_index = data.get('cell_index')
        source = data.get('source', '')

        if self.notebook_handler and cell_index is not None:
            self.notebook_handler.update_cell(cell_index, source)

        await websocket.send_json({
            "type": "cell_updated",
            "data": {
                "cell_index": cell_index,
                "source": source
            }
        })

    async def _handle_reset_kernel(self, websocket: WebSocket):
        """Reset the execution kernel"""
        self.executor.reset_kernel()

        # Clear all cell outputs
        if self.notebook_handler:
            for cell in self.notebook_handler.cells:
                cell.outputs = []
                cell.execution_count = None

        # Broadcast kernel reset to all connections
        for connection in self.active_connections:
            try:
                await connection.send_json({
                    "type": "kernel_reset",
                    "data": {}
                })
            except:
                # Remove failed connections
                if connection in self.active_connections:
                    self.active_connections.remove(connection)

    async def _handle_save_notebook(self, websocket: WebSocket, data: dict):
        """Save the current notebook"""
        file_path = data.get('file_path', 'untitled.py')

        try:
            if self.notebook_handler:
                self.notebook_handler.save_file(file_path)
                await websocket.send_json({
                    "type": "save_success",
                    "data": {"file_path": file_path}
                })
            else:
                await websocket.send_json({
                    "type": "save_error",
                    "data": {"error": "No notebook loaded"}
                })
        except Exception as e:
            await websocket.send_json({
                "type": "save_error",
                "data": {"error": str(e)}
            })

    def set_notebook_file(self, file_path: str):
        """Set the current notebook file"""
        try:
            self.notebook_handler = NotebookHandler(file_path)
        except Exception as e:
            print(f"Error loading notebook file: {e}")
            # Create empty notebook as fallback
            self.notebook_handler = NotebookHandler()

    def run(self, debug=False):
        """Run the FastAPI server"""
        import uvicorn

        if debug:
            print(f"Starting MoreCompute FastAPI server on {self.host}:{self.port}")

        uvicorn.run(
            self.app,
            host=self.host,
            port=self.port,
            log_level="info" if debug else "error",
            access_log=debug
        )

    def shutdown(self):
        """Shutdown the server"""
        print("Server shutdown requested...")
