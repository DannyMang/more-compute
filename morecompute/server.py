from cachetools import TTLCache
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
import os
from datetime import datetime, timezone
from pathlib import Path
import importlib.metadata as importlib_metadata
import zmq
import textwrap

from .notebook import Notebook
from .execution import NextZmqExecutor
from .utils.python_environment_util import PythonEnvironmentDetector
from .utils.system_environment_util import DeviceMetrics
from .utils.error_utils import ErrorUtils
from .utils.cache_util import make_cache_key
from .utils.notebook_util import coerce_cell_source
from .services.prime_intellect import PrimeIntellectService, CreatePodRequest, PodResponse
from .services.pod_manager import PodKernelManager


BASE_DIR = Path(os.getenv("MORECOMPUTE_ROOT", Path.cwd())).resolve()
PACKAGE_DIR = Path(__file__).resolve().parent
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
gpu_cache = TTLCache(maxsize=50, ttl = 60)
pod_cache = TTLCache(maxsize = 100, ttl = 300)
packages_cache = TTLCache(maxsize=1, ttl=300)  # 5 minutes cache for packages
environments_cache = TTLCache(maxsize=1, ttl=300)  # 5 minutes cache for environments

# Mount assets directory for icons, images, etc.
if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")

# Global instances for the application state
notebook_path_env = os.getenv("MORECOMPUTE_NOTEBOOK_PATH")
if notebook_path_env:
    notebook = Notebook(file_path=notebook_path_env)
else:
    notebook = Notebook()
error_utils = ErrorUtils()
executor = NextZmqExecutor(error_utils=error_utils)
metrics = DeviceMetrics()

# Initialize Prime Intellect service if API key is provided
# Check environment variable first, then .env file (commonly gitignored)
prime_api_key = os.getenv("PRIME_INTELLECT_API_KEY")
if not prime_api_key:
    env_path = BASE_DIR / ".env"
    if env_path.exists():
        try:
            with env_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("PRIME_INTELLECT_API_KEY="):
                        prime_api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass

prime_intellect = PrimeIntellectService(api_key=prime_api_key) if prime_api_key else None
pod_manager: PodKernelManager | None = None


@app.get("/api/packages")
async def list_installed_packages(force_refresh: bool = False):
    """
    Return installed packages for the current Python runtime.
    Args:
        force_refresh: If True, bypass cache and fetch fresh data
    """
    cache_key = "packages_list"

    # Check cache first unless force refresh is requested
    if not force_refresh and cache_key in packages_cache:
        return packages_cache[cache_key]

    try:
        packages = []
        for dist in importlib_metadata.distributions():
            name = dist.metadata.get("Name") or dist.metadata.get("Summary") or dist.metadata.get("name")
            version = dist.version
            if name and version:
                packages.append({"name": str(name), "version": str(version)})
        packages.sort(key=lambda p: p["name"].lower())

        result = {"packages": packages}
        packages_cache[cache_key] = result
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list packages: {exc}")


@app.get("/api/metrics")
async def get_metrics():
    try:
        return metrics.get_all_devices()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to get metrics: {exc}")

@app.get("/api/environments")
async def get_environments(full: bool = True, force_refresh: bool = False):
    """
    Return available Python environments.
    Args:
        full: If True (default), performs comprehensive scan (conda, system, venv).
              Takes a few seconds but finds all environments.
        force_refresh: If True, bypass cache and fetch fresh data
    """
    cache_key = f"environments_{full}"

    # Check cache first unless force refresh is requested
    if not force_refresh and cache_key in environments_cache:
        return environments_cache[cache_key]

    try:
        detector = PythonEnvironmentDetector()
        environments = detector.detect_all_environments()
        current_env = detector.get_current_environment()

        result = {
            "status": "success",
            "environments": environments,
            "current": current_env
        }

        environments_cache[cache_key] = result  # Cache the result
        return result

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to detect environments: {exc}")

@app.get("/api/files")
async def list_files(path: str = "."):
    directory = resolve_path(path)
    if not directory.exists() or not directory.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    items: list[dict[str, str | int]] = []
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


@app.post("/api/fix-indentation")
async def fix_indentation(request: Request):
    """Fix indentation in Python code using textwrap.dedent()."""
    try:
        body = await request.json()
        code = body.get("code", "")
        fixed_code = textwrap.dedent(code)
        return {"fixed_code": fixed_code}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fix indentation: {exc}")


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
    def __init__(self) -> None:
        self.clients: dict[WebSocket, None] = {}
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
        import sys
        cell_index = data.get("cell_index")
        if cell_index is None or not (0 <= cell_index < len(self.notebook.cells)):
            await self._send_error(websocket, "Invalid cell index.")
            return

        source = coerce_cell_source(self.notebook.cells[cell_index].get('source', ''))

        await websocket.send_json({
            "type": "execution_start",
            "data": {"cell_index": cell_index, "execution_count": getattr(self.executor, 'execution_count', 0) + 1}
        })

        try:
            result = await self.executor.execute_cell(cell_index, source, websocket)
        except Exception as e:
            error_msg = str(e)
            print(f"[SERVER ERROR] execute_cell failed: {error_msg}", file=sys.stderr, flush=True)

            # Send error to frontend
            result = {
                'status': 'error',
                'execution_count': None,
                'execution_time': '0ms',
                'outputs': [],
                'error': {
                    'output_type': 'error',
                    'ename': type(e).__name__,
                    'evalue': error_msg,
                    'traceback': [f'{type(e).__name__}: {error_msg}', 'Worker failed to start or crashed. Check server logs.']
                }
            }
            await websocket.send_json({
                "type": "execution_error",
                "data": {
                    "cell_index": cell_index,
                    "error": result['error']
                }
            })

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

        import sys
        print(f"[SERVER] Interrupt request received for cell {cell_index}", file=sys.stderr, flush=True)

        # Perform the interrupt (this may take up to 1 second)
        await self.executor.interrupt_kernel(cell_index=cell_index)

        print(f"[SERVER] Interrupt completed, sending error message", file=sys.stderr, flush=True)

        # Inform all clients that the currently running cell (if any) is interrupted
        try:
            await websocket.send_json({
                "type": "execution_error",
                "data": {
                    "cell_index": cell_index,
                    "error": {
                        "output_type": "error",
                        "ename": "KeyboardInterrupt",
                        "evalue": "Execution interrupted by user",
                        "traceback": ["KeyboardInterrupt: Execution was stopped by user"]
                    }
                }
            })
            await websocket.send_json({
                "type": "execution_complete",
                "data": {
                    "cell_index": cell_index,
                    "result": {
                        "status": "error",
                        "execution_count": None,
                        "execution_time": "interrupted",
                        "outputs": [],
                        "error": {
                            "output_type": "error",
                            "ename": "KeyboardInterrupt",
                            "evalue": "Execution interrupted by user",
                            "traceback": ["KeyboardInterrupt: Execution was stopped by user"]
                        }
                    }
                }
            })
            print(f"[SERVER] Error messages sent for cell {cell_index}", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[SERVER] Failed to send error messages: {e}", file=sys.stderr, flush=True)

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


#gpu connection api
@app.get("/api/gpu/config")
async def get_gpu_config():
    """Check if Prime Intellect API is configured."""
    return {"configured": prime_intellect is not None}


@app.post("/api/gpu/config")
async def set_gpu_config(request: Request):
    """Save Prime Intellect API key to .env file (commonly gitignored) and reinitialize service."""
    global prime_intellect

    try:
        body = await request.json()
        api_key = body.get("api_key", "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="API key is required")

        env_path = BASE_DIR / ".env"

        # Read existing .env content
        existing_lines = []
        if env_path.exists():
            with env_path.open("r", encoding="utf-8") as f:
                existing_lines = f.readlines()

        # Remove any existing PRIME_INTELLECT_API_KEY lines
        new_lines = [line for line in existing_lines if not line.strip().startswith("PRIME_INTELLECT_API_KEY=")]
        # Add the new API key
        new_lines.append(f"PRIME_INTELLECT_API_KEY={api_key}\n")
        # Write back to .env
        with env_path.open("w", encoding="utf-8") as f:
            f.writelines(new_lines)
        prime_intellect = PrimeIntellectService(api_key=api_key)

        return {"configured": True, "message": "API key saved successfully"}

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save API key: {exc}")


@app.get("/api/gpu/availability")
async def get_gpu_availability(
    regions: list[str] | None = None,
    gpu_count: int | None = None,
    gpu_type: str | None = None,
    security: str | None = None
):
    """Get available GPU resources from Prime Intellect."""
    if not prime_intellect:
        raise HTTPException(status_code=503, detail="Prime Intellect API key not configured")

    cache_key = make_cache_key(
        "gpu_avail",
        regions = regions,
        gpu_count = gpu_count,
        gpu_type = gpu_type,
        security=security
    )

    if cache_key in gpu_cache:
        return gpu_cache[cache_key]

    #cache miss
    result = await prime_intellect.get_gpu_availability(regions, gpu_count, gpu_type, security)
    gpu_cache[cache_key] = result
    return result

@app.get("/api/gpu/pods")
async def get_gpu_pods(status: str | None = None, limit: int = 100, offset: int = 0):
    """Get list of user's GPU pods."""
    if not prime_intellect:
        raise HTTPException(status_code=503, detail="Prime Intellect API key not configured")

    cache_key = make_cache_key(
        "gpu_pod",
        status=status,
        limit=limit,
        offset=offset
    )

    if cache_key in pod_cache:
        return pod_cache[cache_key]

    # Cache miss: fetch from API
    result = await prime_intellect.get_pods(status, limit, offset)
    pod_cache[cache_key] = result
    return result

@app.post("/api/gpu/pods")
async def create_gpu_pod(pod_request: CreatePodRequest) -> PodResponse:
    """Create a new GPU pod."""
    import sys
    print(f"[CREATE POD] Received request: {pod_request.model_dump()}", file=sys.stderr, flush=True)

    if not prime_intellect:
        raise HTTPException(status_code=503, detail="Prime Intellect API key not configured")

    try:
        result = await prime_intellect.create_pod(pod_request)
        print(f"[CREATE POD] Success: {result}", file=sys.stderr, flush=True)
        pod_cache.clear()

        return result
    except HTTPException as e:
        if e.status_code == 402:
            raise HTTPException(
                status_code=402,
                detail="Insufficient funds in your Prime Intellect wallet. Please add credits at https://app.primeintellect.ai/dashboard/billing"
            )
        elif e.status_code == 401 or e.status_code == 403:
            raise HTTPException(
                status_code=e.status_code,
                detail="Authentication failed. Please check your Prime Intellect API key."
            )
        else:
            print(f"[CREATE POD] Error: {e}", file=sys.stderr, flush=True)
            raise


@app.get("/api/gpu/pods/{pod_id}")
async def get_gpu_pod(pod_id: str) -> PodResponse:
    """Get details of a specific GPU pod."""
    if not prime_intellect:
        raise HTTPException(status_code=503, detail="Prime Intellect API key not configured")

    cache_key = make_cache_key("gpu_pod_detail", pod_id=pod_id)

    if cache_key in pod_cache:
        return pod_cache[cache_key]

    result = await prime_intellect.get_pod(pod_id)
    pod_cache[cache_key] = result
    return result


@app.delete("/api/gpu/pods/{pod_id}")
async def delete_gpu_pod(pod_id: str):
    """Delete a GPU pod."""
    if not prime_intellect:
        raise HTTPException(status_code=503, detail="Prime Intellect API key not configured")

    result = await prime_intellect.delete_pod(pod_id)
    pod_cache.clear()
    return result


@app.post("/api/gpu/pods/{pod_id}/connect")
async def connect_to_pod(pod_id: str):
    """Connect to a GPU pod and establish SSH tunnel for remote execution."""
    global pod_manager

    if not prime_intellect:
        raise HTTPException(status_code=503, detail="Prime Intellect API key not configured")
    if pod_manager is None:
        pod_manager = PodKernelManager(pi_service=prime_intellect)

    # Disconnect from any existing pod first, may need to fix later for multi-pod
    if pod_manager.pod is not None:
        await pod_manager.disconnect()

    # Connect to the new pod
    result = await pod_manager.connect_to_pod(pod_id)

    if result.get("status") == "ok":
        pod_manager.attach_executor(executor)
        addresses = pod_manager.get_executor_addresses()
        executor.cmd_addr = addresses["cmd_addr"]
        executor.pub_addr = addresses["pub_addr"]

        # Reconnect executor sockets to tunneled ports
        executor.req.close(0)  # type: ignore[reportAttributeAccessIssue]
        executor.req = executor.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
        executor.req.connect(executor.cmd_addr)  # type: ignore[reportAttributeAccessIssue]

        executor.sub.close(0)  # type: ignore[reportAttributeAccessIssue]
        executor.sub = executor.ctx.socket(zmq.SUB)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
        executor.sub.connect(executor.pub_addr)  # type: ignore[reportAttributeAccessIssue]
        executor.sub.setsockopt_string(zmq.SUBSCRIBE, '')  # type: ignore[reportAttributeAccessIssue]

    return result


@app.post("/api/gpu/pods/disconnect")
async def disconnect_from_pod():
    """Disconnect from current GPU pod."""
    global pod_manager

    if pod_manager is None or pod_manager.pod is None:
        return {"status": "ok", "message": "No active connection"}

    result = await pod_manager.disconnect()

    # Reset executor to local addresses
    executor.cmd_addr = os.getenv('MC_ZMQ_CMD_ADDR', 'tcp://127.0.0.1:5555')
    executor.pub_addr = os.getenv('MC_ZMQ_PUB_ADDR', 'tcp://127.0.0.1:5556')

    # Reconnect to local worker
    executor.req.close(0)  # type: ignore[reportAttributeAccessIssue]
    executor.req = executor.ctx.socket(zmq.REQ)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
    executor.req.connect(executor.cmd_addr)  # type: ignore[reportAttributeAccessIssue]

    executor.sub.close(0)  # type: ignore[reportAttributeAccessIssue]
    executor.sub = executor.ctx.socket(zmq.SUB)  # type: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
    executor.sub.connect(executor.pub_addr)  # type: ignore[reportAttributeAccessIssue]
    executor.sub.setsockopt_string(zmq.SUBSCRIBE, '')  # type: ignore[reportAttributeAccessIssue]

    return result


@app.get("/api/gpu/pods/connection/status")
async def get_pod_connection_status():
    """Get status of current pod connection."""
    if pod_manager is None:
        return {"connected": False, "pod": None}

    return await pod_manager.get_status()
