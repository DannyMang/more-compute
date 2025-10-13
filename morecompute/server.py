from cachetools import TTLCache
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
import os
import asyncio
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
from .utils.config_util import load_api_key_from_env, save_api_key_to_env
from .utils.zmq_util import reconnect_zmq_sockets, reset_to_local_zmq
from .services.prime_intellect import PrimeIntellectService
from .services.pod_manager import PodKernelManager
from .services.data_manager import DataManager
from .services.pod_monitor import PodMonitor
from .models.api_models import (
    ApiKeyRequest,
    ApiKeyResponse,
    ConfigStatusResponse,
    CreatePodRequest,
    PodResponse,
)


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

notebook_path_env = os.getenv("MORECOMPUTE_NOTEBOOK_PATH")
if notebook_path_env:
    notebook = Notebook(file_path=notebook_path_env)
else:
    notebook = Notebook()
error_utils = ErrorUtils()
executor = NextZmqExecutor(error_utils=error_utils)
metrics = DeviceMetrics()
prime_api_key = load_api_key_from_env("PRIME_INTELLECT_API_KEY", BASE_DIR / ".env")
prime_intellect = PrimeIntellectService(api_key=prime_api_key) if prime_api_key else None
pod_manager: PodKernelManager | None = None
data_manager = DataManager(prime_intellect=prime_intellect)
pod_monitor: PodMonitor | None = None
if prime_intellect:
    pod_monitor = PodMonitor(
        prime_intellect=prime_intellect,
        pod_cache=pod_cache,
        update_callback=lambda msg: manager.broadcast_pod_update(msg)
    )


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

    async def broadcast_pod_update(self, message: dict):
        """Broadcast pod status updates to all connected clients."""
        for client in self.clients:
            try:
                await client.send_json(message)
            except Exception:
                pass

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
        source = data.get('source', '')
        full_cell = data.get('full_cell')

        if full_cell:
            # Restore full cell data (for undo functionality)
            self.notebook.add_cell(index=index, cell_type=cell_type, source=source, full_cell=full_cell)
        else:
            # Normal add cell
            self.notebook.add_cell(index=index, cell_type=cell_type, source=source)
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


# GPU connection API
@app.get("/api/gpu/config", response_model=ConfigStatusResponse)
async def get_gpu_config() -> ConfigStatusResponse:
    """Check if Prime Intellect API is configured."""
    return ConfigStatusResponse(configured=prime_intellect is not None)


@app.post("/api/gpu/config", response_model=ApiKeyResponse)
async def set_gpu_config(request: ApiKeyRequest) -> ApiKeyResponse:
    """Save Prime Intellect API key to .env file and reinitialize service."""
    global prime_intellect, pod_monitor

    if not request.api_key.strip():
        raise HTTPException(status_code=400, detail="API key is required")

    try:
        save_api_key_to_env("PRIME_INTELLECT_API_KEY", request.api_key, BASE_DIR / ".env")
        prime_intellect = PrimeIntellectService(api_key=request.api_key)
        if prime_intellect:
            pod_monitor = PodMonitor(
                prime_intellect=prime_intellect,
                pod_cache=pod_cache,
                update_callback=lambda msg: manager.broadcast_pod_update(msg)
            )

        return ApiKeyResponse(configured=True, message="API key saved successfully")

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
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

    if not prime_intellect or not pod_monitor:
        raise HTTPException(status_code=503, detail="Prime Intellect API key not configured")

    print(f"[CREATE POD] Received request: {pod_request.model_dump()}", file=sys.stderr, flush=True)

    try:
        result = await prime_intellect.create_pod(pod_request)
        print(f"[CREATE POD] Success: {result}", file=sys.stderr, flush=True)

        # Clear cache and start monitoring
        pod_cache.clear()
        await pod_monitor.start_monitoring(result.id)

        return result

    except HTTPException as e:
        if e.status_code == 402:
            raise HTTPException(
                status_code=402,
                detail="Insufficient funds in your Prime Intellect wallet. Please add credits at https://app.primeintellect.ai/dashboard/billing"
            )
        elif e.status_code in (401, 403):
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

    # Disconnect from any existing pod first
    if pod_manager.pod is not None:
        await pod_manager.disconnect()

    # Connect to the new pod
    result = await pod_manager.connect_to_pod(pod_id)

    if result.get("status") == "ok":
        pod_manager.attach_executor(executor)
        addresses = pod_manager.get_executor_addresses()
        reconnect_zmq_sockets(
            executor,
            cmd_addr=addresses["cmd_addr"],
            pub_addr=addresses["pub_addr"]
        )

    return result


@app.post("/api/gpu/pods/disconnect")
async def disconnect_from_pod():
    """Disconnect from current GPU pod."""
    global pod_manager

    if pod_manager is None or pod_manager.pod is None:
        return {"status": "ok", "message": "No active connection"}

    result = await pod_manager.disconnect()

    # Reset executor to local addresses
    reset_to_local_zmq(executor)

    return result


@app.get("/api/gpu/pods/connection/status")
async def get_pod_connection_status():
    """Get status of current pod connection."""
    if pod_manager is None:
        return {"connected": False, "pod": None}

    return await pod_manager.get_status()


@app.get("/api/gpu/pods/worker-logs")
async def get_worker_logs():
    """Fetch worker logs from connected pod."""
    import subprocess

    if not pod_manager or not pod_manager.pod:
        raise HTTPException(status_code=400, detail="Not connected to any pod")

    ssh_parts = pod_manager.pod.sshConnection.split()
    host_part = next((p for p in ssh_parts if "@" in p), None)
    if not host_part:
        raise HTTPException(status_code=500, detail="Invalid SSH connection")

    ssh_host = host_part.split("@")[1]
    ssh_port = ssh_parts[ssh_parts.index("-p") + 1] if "-p" in ssh_parts else "22"

    ssh_key = pod_manager._get_ssh_key()
    cmd = ["ssh", "-p", ssh_port]
    if ssh_key:
        cmd.extend(["-i", ssh_key])
    cmd.extend([
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "BatchMode=yes",
        f"root@{ssh_host}",
        "cat /tmp/worker.log 2>&1 || echo 'No worker log found'"
    ])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return {"logs": result.stdout, "stderr": result.stderr, "returncode": result.returncode}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch logs: {str(e)}")


# Dataset Management API
@app.get("/api/datasets/info")
async def get_dataset_info(name: str, config: str | None = None):
    """
    Get dataset metadata without downloading.

    Args:
        name: HuggingFace dataset name (e.g., "openai/gsm8k")
        config: Optional dataset configuration

    Returns:
        Dataset metadata including size, splits, features
    """
    try:
        info = data_manager.get_dataset_info(name, config)
        return {
            "name": info.name,
            "size_gb": info.size_gb,
            "splits": info.splits,
            "features": info.features
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to get dataset info: {exc}")


@app.post("/api/datasets/check")
async def check_dataset_load(request: Request):
    """
    Check if dataset can be loaded and get recommendations.

    Body:
        name: Dataset name
        config: Optional configuration
        split: Optional split
        auto_stream_threshold_gb: Threshold for auto-streaming (default: 10)

    Returns:
        Dict with action, recommendation, import_code, alternatives
    """
    try:
        body = await request.json()
        name = body.get("name")
        config = body.get("config")
        split = body.get("split")
        threshold = body.get("auto_stream_threshold_gb", 10.0)

        if not name:
            raise HTTPException(status_code=400, detail="Dataset name is required")

        result = await data_manager.load_smart(
            dataset_name=name,
            config=config,
            split=split,
            auto_stream_threshold_gb=threshold
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to check dataset: {exc}")


@app.get("/api/datasets/cache")
async def list_cached_datasets():
    """
    List all cached datasets.

    Returns:
        List of cached datasets with name, size, path
    """
    try:
        datasets = data_manager.list_cached_datasets()
        cache_size = data_manager.get_cache_size()
        return {
            "datasets": datasets,
            "total_cache_size_gb": cache_size,
            "max_cache_size_gb": data_manager.max_cache_size_gb
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list cache: {exc}")


@app.delete("/api/datasets/cache/{dataset_id}")
async def clear_dataset_cache(dataset_id: str):
    """
    Clear specific dataset from cache.

    Args:
        dataset_id: Dataset identifier (or "all" to clear everything)
    """
    try:
        if dataset_id == "all":
            result = data_manager.clear_cache(None)
        else:
            result = data_manager.clear_cache(dataset_id)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to clear cache: {exc}")


@app.post("/api/datasets/disk/create")
async def create_dataset_disk(request: Request):
    """
    Create disk for large dataset via Prime Intellect.

    Body:
        pod_id: Pod to attach disk to
        disk_name: Human-readable name for the disk
        size_gb: Disk size in GB
        provider_type: Cloud provider (default: "runpod")

    Returns:
        Dict with disk_id, mount_path, instructions
    """
    if not prime_intellect:
        raise HTTPException(status_code=503, detail="Prime Intellect API not configured")

    try:
        body = await request.json()
        pod_id = body.get("pod_id")
        disk_name = body.get("disk_name")
        size_gb = body.get("size_gb")
        provider_type = body.get("provider_type", "runpod")

        if not pod_id or not disk_name or not size_gb:
            raise HTTPException(status_code=400, detail="pod_id, disk_name, and size_gb are required")

        result = await data_manager.create_and_attach_disk(
            pod_id=pod_id,
            disk_name=disk_name,
            size_gb=int(size_gb),
            provider_type=provider_type
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create disk: {exc}")


@app.get("/api/datasets/subset")
async def get_subset_code(
    name: str,
    num_samples: int = 1000,
    split: str = "train",
    config: str | None = None
):
    """
    Get code to load a dataset subset for testing.

    Args:
        name: Dataset name
        num_samples: Number of samples to load (default: 1000)
        split: Which split to use (default: "train")
        config: Optional configuration

    Returns:
        Dict with import_code and recommendation
    """
    try:
        result = data_manager.load_subset(
            dataset_name=name,
            num_samples=num_samples,
            split=split,
            config=config
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate subset code: {exc}")
