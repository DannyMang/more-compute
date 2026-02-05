from cachetools import TTLCache
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import PlainTextResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
import os
import sys
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
from .utils.config_util import load_api_key, save_api_key, get_active_provider as get_active_provider_name, set_active_provider as set_active_provider_name
from .utils.zmq_util import reconnect_zmq_sockets, reset_to_local_zmq
from .services.pod_manager import PodKernelManager
from .services.data_manager import DataManager
from .services.pod_monitor import PodMonitor
from .services.lsp_service import LSPService
from .services.claude_service import ClaudeService, ClaudeContext as ClaudeCtx, ProposedEdit
from .services.providers import (
    list_providers as list_all_providers,
    get_provider,
    configure_provider,
    get_active_provider,
    set_active_provider,
    refresh_provider,
    BaseGPUProvider,
)
from .models.api_models import (
    ApiKeyRequest,
    ApiKeyResponse,
    ConfigStatusResponse,
    CreatePodRequest,
    PodResponse,
    ProviderInfo,
    ProviderListResponse,
    ProviderConfigRequest,
    SetActiveProviderRequest,
    GpuAvailabilityResponse,
    PodListResponse,
    CreatePodWithProviderRequest,
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


app = FastAPI(redirect_slashes=False)
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
pod_manager: PodKernelManager | None = None
pod_connection_error: str | None = None  # Store connection errors for status endpoint
data_manager = DataManager()
pod_monitor: PodMonitor | None = None

# LSP service for Python autocomplete
lsp_service: LSPService | None = None

# Claude AI service
claude_api_key = load_api_key("CLAUDE_API_KEY")
claude_service: ClaudeService | None = None
if claude_api_key:
    try:
        claude_service = ClaudeService(api_key=claude_api_key)
    except ImportError:
        pass  # anthropic package not installed


@app.on_event("startup")
async def startup_event():
    """Initialize services on startup."""
    global lsp_service
    try:
        lsp_service = LSPService(workspace_root=BASE_DIR)
        await lsp_service.start()
    except Exception:
        lsp_service = None


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup services on shutdown."""
    global lsp_service, executor

    # Shutdown executor and worker process
    if executor and executor.worker_proc:
        try:
            executor.worker_proc.terminate()
            executor.worker_proc.wait(timeout=2)
        except Exception:
            try:
                executor.worker_proc.kill()
            except Exception:
                pass

    # Shutdown LSP service
    if lsp_service:
        try:
            await lsp_service.shutdown()
        except Exception:
            pass


@app.get("/api/packages")
async def list_installed_packages(force_refresh: bool = False):
    """
    Return installed packages for the current Python runtime.
    Fetches from remote pod if connected, otherwise from local environment.
    Args:
        force_refresh: If True, bypass cache and fetch fresh data
    """
    global pod_manager
    cache_key = "packages_list"

    # Clear cache if force refresh is requested
    if force_refresh and cache_key in packages_cache:
        del packages_cache[cache_key]

    # Check cache first unless force refresh is requested
    if not force_refresh and cache_key in packages_cache:
        return packages_cache[cache_key]

    try:
        # If connected to remote pod, fetch packages from there
        if pod_manager and pod_manager.pod:
            try:
                stdout, stderr, returncode = await pod_manager.execute_ssh_command(
                    "python3 -m pip list --format=json 2>/dev/null || pip list --format=json"
                )

                if returncode == 0 and stdout.strip():
                    import json
                    pkgs_data = json.loads(stdout)
                    packages = [{"name": p["name"], "version": p["version"]} for p in pkgs_data]
                    packages.sort(key=lambda p: p["name"].lower())
                    result = {"packages": packages}
                    packages_cache[cache_key] = result
                    return result
                # Fall through to local packages on error
            except Exception:
                pass  # Fall through to local packages

        # Local packages (fallback or when not connected)
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
    global pod_manager
    try:
        # If connected to remote pod, fetch metrics from there
        if pod_manager and pod_manager.pod:
            try:
                # Python script to collect metrics on remote pod
                metrics_script = """
import json, psutil
try:
    import pynvml
    pynvml.nvmlInit()
    gpu_count = pynvml.nvmlDeviceGetCount()
    gpus = []
    for i in range(gpu_count):
        handle = pynvml.nvmlDeviceGetHandleByIndex(i)
        util = pynvml.nvmlDeviceGetUtilizationRates(handle)
        mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
        try:
            temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
        except:
            temp = None
        gpus.append({
            "util_percent": util.gpu,
            "mem_used": mem.used,
            "mem_total": mem.total,
            "temperature_c": temp
        })
    pynvml.nvmlShutdown()
except:
    gpus = []
cpu = psutil.cpu_percent(interval=0.1)
mem = psutil.virtual_memory()
disk = psutil.disk_usage('/')
net = psutil.net_io_counters()
proc = psutil.Process()
mem_info = proc.memory_info()
print(json.dumps({
    "cpu": {"percent": cpu, "cores": psutil.cpu_count()},
    "memory": {"percent": mem.percent, "used": mem.used, "total": mem.total},
    "storage": {"percent": disk.percent, "used": disk.used, "total": disk.total},
    "gpu": gpus,
    "network": {"bytes_sent": net.bytes_sent, "bytes_recv": net.bytes_recv},
    "process": {"rss": mem_info.rss, "threads": proc.num_threads()}
}))
"""
                # Escape single quotes in the script for shell
                escaped_script = metrics_script.replace("'", "'\"'\"'")
                stdout, stderr, returncode = await pod_manager.execute_ssh_command(
                    f"python3 -c '{escaped_script}'"
                )

                if returncode == 0 and stdout.strip():
                    import json
                    return json.loads(stdout)
                # Fall through to local metrics on error
            except Exception:
                pass  # Fall through to local metrics

        # Local metrics (fallback or when not connected)
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


@app.post("/api/lsp/completions")
async def get_lsp_completions(request: Request):
    """
    Get LSP code completions for Python.

    Body:
        cell_id: Unique cell identifier
        source: Full source code of the cell
        line: Line number (0-indexed)
        character: Character position in line

    Returns:
        List of completion items with label, kind, detail, documentation
    """
    if not lsp_service:
        raise HTTPException(status_code=503, detail="LSP service not available")

    try:
        body = await request.json()
        cell_id = body.get("cell_id", "0")
        source = body.get("source", "")
        line = body.get("line", 0)
        character = body.get("character", 0)

        completions = await lsp_service.get_completions(
            cell_id=str(cell_id),
            source=source,
            line=line,
            character=character
        )

        return {"completions": completions}

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"LSP completion error: {exc}")


@app.post("/api/lsp/hover")
async def get_lsp_hover(request: Request):
    """
    Get hover information for Python code.

    Body:
        cell_id: Unique cell identifier
        source: Full source code of the cell
        line: Line number (0-indexed)
        character: Character position in line

    Returns:
        Hover information with documentation
    """
    if not lsp_service:
        raise HTTPException(status_code=503, detail="LSP service not available")

    try:
        body = await request.json()
        cell_id = body.get("cell_id", "0")
        source = body.get("source", "")
        line = body.get("line", 0)
        character = body.get("character", 0)

        hover_info = await lsp_service.get_hover(
            cell_id=str(cell_id),
            source=source,
            line=line,
            character=character
        )

        return {"hover": hover_info}

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"LSP hover error: {exc}")


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
        tasks = set()

        def task_done_callback(task):
            tasks.discard(task)
            # Check for exceptions in completed tasks
            try:
                task.exception()
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

        while True:
            try:
                message = await websocket.receive_json()
                # Process messages concurrently so interrupts can arrive during execution
                task = asyncio.create_task(self._handle_message(websocket, message))
                tasks.add(task)
                task.add_done_callback(task_done_callback)
            except WebSocketDisconnect:
                self.disconnect(websocket)
                # Cancel all pending tasks
                for task in tasks:
                    task.cancel()
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
            "move_cell": self._handle_move_cell,
            "interrupt_kernel": self._handle_interrupt_kernel,
            "reset_kernel": self._handle_reset_kernel,
            "load_notebook": self._handle_load_notebook,
            "save_notebook": self._handle_save_notebook,
            "claude_message": self._handle_claude_message,
            "claude_apply_edit": self._handle_claude_apply_edit,
            "claude_reject_edit": self._handle_claude_reject_edit,
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

        # Save the notebook after adding cell
        try:
            self.notebook.save_to_file()
        except Exception as e:
            print(f"Warning: Failed to save notebook after adding cell: {e}", file=sys.stderr)

        await self.broadcast_notebook_update()

    async def _handle_delete_cell(self, websocket: WebSocket, data: dict):
        index = data.get('cell_index')
        if index is not None:
            self.notebook.delete_cell(index)
            # Save the notebook after deleting cell
            try:
                self.notebook.save_to_file()
            except Exception as e:
                print(f"Warning: Failed to save notebook after deleting cell: {e}", file=sys.stderr)
            await self.broadcast_notebook_update()

    async def _handle_update_cell(self, websocket: WebSocket, data: dict):
        index = data.get('cell_index')
        source = data.get('source')
        if index is not None and source is not None:
            self.notebook.update_cell(index, source)
            #self.notebook.save_to_file()
            #to -do?

    async def _handle_move_cell(self, websocket: WebSocket, data: dict):
        from_index = data.get('from_index')
        to_index = data.get('to_index')
        if from_index is not None and to_index is not None:
            self.notebook.move_cell(from_index, to_index)
            # Save the notebook after moving cells
            try:
                self.notebook.save_to_file()
            except Exception:
                pass  # Silently continue if save fails
            await self.broadcast_notebook_update()

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
        # Perform the interrupt (this may take up to 1 second)
        # The execution handler will send the appropriate error and completion messages
        await self.executor.interrupt_kernel(cell_index=cell_index)

        # Note: We don't send completion messages here anymore because:
        # 1. For shell commands: AsyncSpecialCommandHandler._execute_shell_command sends them
        # 2. For Python code: The worker sends them
        # Sending duplicate messages causes the frontend to get confused

    async def _handle_reset_kernel(self, websocket: WebSocket, data: dict):
        self.executor.reset_kernel()
        self.notebook.clear_all_outputs()

        # Note: We don't save the notebook here - this preserves execution times
        # from the last session, which is useful for seeing how long things took

        # Broadcast kernel restart to all clients
        await self.broadcast_pod_update({
            "type": "kernel_restarted",
            "data": {}
        })
        await self.broadcast_notebook_update()

    async def _handle_claude_message(self, websocket: WebSocket, data: dict):
        """Handle a message to Claude and stream the response."""
        import uuid

        if not claude_service:
            await websocket.send_json({
                "type": "claude_error",
                "data": {"error": "Claude API key not configured. Please configure it in the Claude panel."}
            })
            return

        message = data.get("message", "")
        history = data.get("history", [])
        model = data.get("model", "sonnet")  # Default to sonnet

        if not message.strip():
            await websocket.send_json({
                "type": "claude_error",
                "data": {"error": "Message cannot be empty"}
            })
            return

        # Build context from notebook state
        cells = self.notebook.cells
        context = ClaudeCtx(
            cells=cells,
            gpu_info=None,  # Could fetch metrics here if needed
            metrics=None,
            packages=None
        )

        # Generate message ID
        message_id = str(uuid.uuid4())

        # Send stream start
        await websocket.send_json({
            "type": "claude_stream_start",
            "data": {"messageId": message_id}
        })

        full_response = []
        try:
            async for chunk in claude_service.stream_response(message, context, history, model=model):
                full_response.append(chunk)
                await websocket.send_json({
                    "type": "claude_stream_chunk",
                    "data": {"messageId": message_id, "chunk": chunk}
                })

            # Parse edit blocks from full response
            full_text = "".join(full_response)
            proposed_edits = ClaudeService.parse_edit_blocks(full_text, cells)

            # Convert edits to serializable format
            edits_data = [
                {
                    "id": str(uuid.uuid4()),
                    "cellIndex": edit.cell_index,
                    "originalCode": edit.original_code,
                    "newCode": edit.new_code,
                    "explanation": edit.explanation,
                    "status": "pending"
                }
                for edit in proposed_edits
            ]

            await websocket.send_json({
                "type": "claude_stream_end",
                "data": {
                    "messageId": message_id,
                    "fullResponse": full_text,
                    "proposedEdits": edits_data
                }
            })

        except Exception as e:
            await websocket.send_json({
                "type": "claude_error",
                "data": {"error": f"Error communicating with Claude: {str(e)}"}
            })

    async def _handle_claude_apply_edit(self, websocket: WebSocket, data: dict):
        """Apply a proposed edit to a cell."""
        cell_index = data.get("cellIndex")
        new_code = data.get("newCode", "")
        edit_id = data.get("editId", "")

        if cell_index is None or not (0 <= cell_index < len(self.notebook.cells)):
            await websocket.send_json({
                "type": "claude_error",
                "data": {"error": f"Invalid cell index: {cell_index}"}
            })
            return

        # Update the cell source
        self.notebook.update_cell(cell_index, new_code)

        # Broadcast the notebook update
        await self.broadcast_notebook_update()

        await websocket.send_json({
            "type": "claude_edit_applied",
            "data": {"editId": edit_id, "cellIndex": cell_index}
        })

    async def _handle_claude_reject_edit(self, websocket: WebSocket, data: dict):
        """Reject a proposed edit (just acknowledge, no action needed on notebook)."""
        edit_id = data.get("editId", "")

        await websocket.send_json({
            "type": "claude_edit_rejected",
            "data": {"editId": edit_id}
        })

    async def _send_error(self, websocket: WebSocket, error_message: str):
        await websocket.send_json({"type": "error", "data": {"error": error_message}})


manager = WebSocketManager()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    await manager.handle_message_loop(websocket)


# ============================================================================
# Multi-Provider GPU API
# ============================================================================

@app.get("/api/gpu/providers")
async def list_gpu_providers():
    """List all available GPU providers with their configuration status."""
    providers = list_all_providers()
    active = get_active_provider_name()

    return {
        "providers": [
            {
                "name": p.name,
                "display_name": p.display_name,
                "api_key_env_name": p.api_key_env_name,
                "supports_ssh": p.supports_ssh,
                "dashboard_url": p.dashboard_url,
                "configured": p.configured,
                "is_active": p.is_active
            }
            for p in providers
        ],
        "active_provider": active
    }


@app.post("/api/gpu/providers/{provider_name}/config")
async def configure_gpu_provider(provider_name: str, request: ProviderConfigRequest):
    """Configure a GPU provider with API key."""
    global pod_monitor

    # Handle Modal's special case (requires two tokens)
    if provider_name == "modal" and request.token_secret:
        # Save token secret separately
        save_api_key("MODAL_TOKEN_SECRET", request.token_secret)

    success = configure_provider(provider_name, request.api_key, make_active=request.make_active)

    if not success:
        raise HTTPException(status_code=400, detail=f"Provider '{provider_name}' not found")

    # If this is being set as active, update the pod monitor
    if request.make_active:
        provider = get_provider(provider_name)
        if provider:
            pod_monitor = PodMonitor(
                provider_service=provider,
                pod_cache=pod_cache,
                update_callback=lambda msg: manager.broadcast_pod_update(msg)
            )

    return {
        "configured": True,
        "provider": provider_name,
        "is_active": request.make_active
    }


@app.post("/api/gpu/providers/active")
async def set_active_gpu_provider(request: SetActiveProviderRequest):
    """Set the active GPU provider."""
    success = set_active_provider(request.provider)
    if not success:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot activate provider '{request.provider}'. Make sure it is configured with a valid API key."
        )

    # Update pod monitor with new provider
    global pod_monitor
    provider = get_provider(request.provider)
    if provider:
        pod_monitor = PodMonitor(
            provider_service=provider,
            pod_cache=pod_cache,
            update_callback=lambda msg: manager.broadcast_pod_update(msg)
        )

    return {
        "active_provider": request.provider,
        "success": True
    }


@app.get("/api/gpu/providers/{provider_name}/availability")
async def get_provider_gpu_availability(
    provider_name: str,
    regions: list[str] | None = None,
    gpu_count: int | None = None,
    gpu_type: str | None = None,
    # RunPod specific filters
    secure_cloud: bool | None = None,
    community_cloud: bool | None = None,
    # Vast.ai specific filters
    verified: bool | None = None,
    min_reliability: float | None = None,
    min_gpu_ram: float | None = None
):
    """Get available GPU resources from a specific provider.

    Args:
        provider_name: Provider identifier (runpod, lambda_labs, vastai)
        regions: Filter by region
        gpu_count: Filter by GPU count
        gpu_type: Filter by GPU type (partial match)
        secure_cloud: RunPod - only show Secure Cloud GPUs
        community_cloud: RunPod - only show Community Cloud GPUs
        verified: Vast.ai - only show verified hosts
        min_reliability: Vast.ai - minimum reliability score (0.0-1.0)
        min_gpu_ram: Vast.ai - minimum GPU RAM in GB
    """
    provider = get_provider(provider_name)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_name}' not found")

    if not provider.is_configured:
        raise HTTPException(
            status_code=503,
            detail=f"{provider.PROVIDER_DISPLAY_NAME} API key not configured"
        )

    cache_key = make_cache_key(
        f"gpu_avail_{provider_name}",
        regions=regions,
        gpu_count=gpu_count,
        gpu_type=gpu_type,
        secure_cloud=secure_cloud,
        community_cloud=community_cloud,
        verified=verified,
        min_reliability=min_reliability,
        min_gpu_ram=min_gpu_ram
    )

    if cache_key in gpu_cache:
        return gpu_cache[cache_key]

    result = await provider.get_gpu_availability(
        regions=regions,
        gpu_count=gpu_count,
        gpu_type=gpu_type,
        secure_cloud=secure_cloud,
        community_cloud=community_cloud,
        verified=verified,
        min_reliability=min_reliability,
        min_gpu_ram=min_gpu_ram
    )
    gpu_cache[cache_key] = result
    return result


@app.get("/api/gpu/providers/{provider_name}/pods")
async def get_provider_pods(
    provider_name: str,
    status: str | None = None,
    limit: int = 100,
    offset: int = 0
):
    """Get list of pods from a specific provider."""
    provider = get_provider(provider_name)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_name}' not found")

    if not provider.is_configured:
        raise HTTPException(
            status_code=503,
            detail=f"{provider.PROVIDER_DISPLAY_NAME} API key not configured"
        )

    cache_key = make_cache_key(
        f"gpu_pods_{provider_name}",
        status=status,
        limit=limit,
        offset=offset
    )

    if cache_key in pod_cache:
        return pod_cache[cache_key]

    result = await provider.get_pods(status=status, limit=limit, offset=offset)
    pod_cache[cache_key] = result
    return result


@app.post("/api/gpu/providers/{provider_name}/pods")
async def create_provider_pod(provider_name: str, pod_request: CreatePodRequest):
    """Create a new GPU pod with a specific provider."""
    provider = get_provider(provider_name)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_name}' not found")

    if not provider.is_configured:
        raise HTTPException(
            status_code=503,
            detail=f"{provider.PROVIDER_DISPLAY_NAME} API key not configured"
        )

    try:
        result = await provider.create_pod(pod_request)

        # Clear cache and start monitoring
        pod_cache.clear()

        # Create/update pod monitor for this provider and start monitoring
        global pod_monitor
        pod_monitor = PodMonitor(
            provider_service=provider,
            pod_cache=pod_cache,
            update_callback=lambda msg: manager.broadcast_pod_update(msg)
        )
        await pod_monitor.start_monitoring(result.id)

        return result

    except HTTPException as e:
        if e.status_code == 402:
            raise HTTPException(
                status_code=402,
                detail=f"Insufficient funds in your {provider.PROVIDER_DISPLAY_NAME} account."
            )
        elif e.status_code in (401, 403):
            raise HTTPException(
                status_code=e.status_code,
                detail=f"Authentication failed. Please check your {provider.PROVIDER_DISPLAY_NAME} API key."
            )
        else:
            raise


@app.get("/api/gpu/providers/{provider_name}/pods/{pod_id}")
async def get_provider_pod(provider_name: str, pod_id: str):
    """Get details of a specific pod from a provider."""
    provider = get_provider(provider_name)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_name}' not found")

    if not provider.is_configured:
        raise HTTPException(
            status_code=503,
            detail=f"{provider.PROVIDER_DISPLAY_NAME} API key not configured"
        )

    return await provider.get_pod(pod_id)


@app.delete("/api/gpu/providers/{provider_name}/pods/{pod_id}")
async def delete_provider_pod(provider_name: str, pod_id: str):
    """Delete a pod from a specific provider."""
    provider = get_provider(provider_name)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_name}' not found")

    if not provider.is_configured:
        raise HTTPException(
            status_code=503,
            detail=f"{provider.PROVIDER_DISPLAY_NAME} API key not configured"
        )

    result = await provider.delete_pod(pod_id)
    pod_cache.clear()
    return result


@app.get("/api/gpu/providers/{provider_name}/ssh-keys")
async def get_provider_ssh_keys(provider_name: str):
    """Get list of SSH keys registered with a provider (Lambda Labs only)."""
    provider = get_provider(provider_name)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_name}' not found")

    if not provider.is_configured:
        raise HTTPException(
            status_code=503,
            detail=f"{provider.PROVIDER_DISPLAY_NAME} API key not configured"
        )

    # Only Lambda Labs supports listing SSH keys via API
    if provider_name != "lambda_labs":
        return {
            "supported": False,
            "message": f"{provider.PROVIDER_DISPLAY_NAME} does not support listing SSH keys via API. Please check your provider's dashboard.",
            "dashboard_url": provider.DASHBOARD_URL
        }

    try:
        # Get detailed SSH key info
        detailed_keys = await provider.get_ssh_keys_detailed()
        key_names = await provider._get_ssh_key_ids()

        return {
            "supported": True,
            "ssh_keys": key_names,
            "ssh_keys_detailed": detailed_keys,
            "selected_key": key_names[0] if key_names else None,
            "note": "ed25519 keys are preferred. The first key shown will be used when creating new instances."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch SSH keys: {str(e)}")


@app.post("/api/gpu/providers/{provider_name}/pods/{pod_id}/connect")
async def connect_to_provider_pod(provider_name: str, pod_id: str):
    """Connect to a GPU pod from a specific provider."""
    global pod_manager

    provider = get_provider(provider_name)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_name}' not found")

    if not provider.is_configured:
        raise HTTPException(
            status_code=503,
            detail=f"{provider.PROVIDER_DISPLAY_NAME} API key not configured"
        )

    if not provider.SUPPORTS_SSH:
        raise HTTPException(
            status_code=400,
            detail=f"{provider.PROVIDER_DISPLAY_NAME} does not support SSH connections. Use the provider's SDK for code execution."
        )

    if pod_manager is None:
        pod_manager = PodKernelManager(provider_service=provider)
    else:
        # Update the provider on the pod manager
        pod_manager.provider_service = provider
        pod_manager.provider_type = provider_name

    # Start the connection in the background
    asyncio.create_task(_connect_to_pod_background(pod_id))

    return {
        "status": "connecting",
        "message": "Connection initiated. Check status endpoint for updates.",
        "pod_id": pod_id,
        "provider": provider_name
    }


# ============================================================================
# Legacy GPU API (Prime Intellect - for backwards compatibility)
# ============================================================================

# GPU connection API (legacy endpoints - use provider system)
@app.get("/api/gpu/config", response_model=ConfigStatusResponse)
async def get_gpu_config() -> ConfigStatusResponse:
    """Check if any GPU provider is configured."""
    active_provider = get_active_provider()
    if active_provider and active_provider.is_configured:
        return ConfigStatusResponse(configured=True)
    return ConfigStatusResponse(configured=False)


@app.post("/api/gpu/config", response_model=ApiKeyResponse)
async def set_gpu_config(request: ApiKeyRequest) -> ApiKeyResponse:
    """Legacy endpoint - use /api/gpu/providers/{provider}/config instead."""
    raise HTTPException(
        status_code=400,
        detail="Please use /api/gpu/providers/{provider}/config to configure a specific provider"
    )


@app.get("/api/gpu/availability")
async def get_gpu_availability(
    regions: list[str] | None = None,
    gpu_count: int | None = None,
    gpu_type: str | None = None,
    # RunPod specific filters
    secure_cloud: bool | None = None,
    community_cloud: bool | None = None,
    # Vast.ai specific filters
    verified: bool | None = None,
    min_reliability: float | None = None,
    min_gpu_ram: float | None = None
):
    """Get available GPU resources from active provider."""
    active_provider = get_active_provider()
    if not active_provider or not active_provider.is_configured:
        raise HTTPException(status_code=503, detail="No GPU provider configured. Please select and configure a provider.")

    cache_key = make_cache_key(
        f"gpu_avail_{active_provider.PROVIDER_NAME}",
        regions=regions,
        gpu_count=gpu_count,
        gpu_type=gpu_type,
        secure_cloud=secure_cloud,
        community_cloud=community_cloud,
        verified=verified,
        min_reliability=min_reliability,
        min_gpu_ram=min_gpu_ram
    )

    if cache_key in gpu_cache:
        return gpu_cache[cache_key]

    result = await active_provider.get_gpu_availability(
        regions=regions,
        gpu_count=gpu_count,
        gpu_type=gpu_type,
        secure_cloud=secure_cloud,
        community_cloud=community_cloud,
        verified=verified,
        min_reliability=min_reliability,
        min_gpu_ram=min_gpu_ram
    )
    gpu_cache[cache_key] = result
    return result

@app.get("/api/gpu/pods")
async def get_gpu_pods(status: str | None = None, limit: int = 100, offset: int = 0):
    """Get list of user's GPU pods from active provider."""
    active_provider = get_active_provider()
    if not active_provider or not active_provider.is_configured:
        raise HTTPException(status_code=503, detail="No GPU provider configured. Please select and configure a provider.")

    cache_key = make_cache_key(
        f"gpu_pod_{active_provider.PROVIDER_NAME}",
        status=status,
        limit=limit,
        offset=offset
    )

    if cache_key in pod_cache:
        return pod_cache[cache_key]

    result = await active_provider.get_pods(status=status, limit=limit, offset=offset)
    pod_cache[cache_key] = result
    return result


@app.post("/api/gpu/pods")
async def create_gpu_pod(pod_request: CreatePodRequest) -> PodResponse:
    """Create a new GPU pod with active provider."""
    active_provider = get_active_provider()
    if not active_provider or not active_provider.is_configured:
        raise HTTPException(status_code=503, detail="No GPU provider configured. Please select and configure a provider.")

    try:
        result = await active_provider.create_pod(pod_request)

        # Clear cache and start monitoring
        pod_cache.clear()
        if pod_monitor:
            await pod_monitor.start_monitoring(result.id)

        return result

    except HTTPException as e:
        if e.status_code == 402:
            raise HTTPException(
                status_code=402,
                detail=f"Insufficient funds. Please add credits to your {active_provider.PROVIDER_DISPLAY_NAME} account."
            )
        elif e.status_code in (401, 403):
            raise HTTPException(
                status_code=e.status_code,
                detail=f"Authentication failed. Please check your {active_provider.PROVIDER_DISPLAY_NAME} API key."
            )
        else:
            raise


@app.get("/api/gpu/pods/{pod_id}")
async def get_gpu_pod(pod_id: str) -> PodResponse:
    """Get details of a specific GPU pod."""
    active_provider = get_active_provider()
    if not active_provider or not active_provider.is_configured:
        raise HTTPException(status_code=503, detail="No GPU provider configured. Please select and configure a provider.")

    cache_key = make_cache_key(f"gpu_pod_detail_{active_provider.PROVIDER_NAME}", pod_id=pod_id)

    if cache_key in pod_cache:
        return pod_cache[cache_key]

    result = await active_provider.get_pod(pod_id)
    pod_cache[cache_key] = result
    return result


@app.delete("/api/gpu/pods/{pod_id}")
async def delete_gpu_pod(pod_id: str):
    """Delete a GPU pod."""
    active_provider = get_active_provider()
    if not active_provider or not active_provider.is_configured:
        raise HTTPException(status_code=503, detail="No GPU provider configured. Please select and configure a provider.")

    result = await active_provider.delete_pod(pod_id)
    pod_cache.clear()
    return result


async def _connect_to_pod_background(pod_id: str):
    """Background task to connect to pod without blocking the HTTP response."""
    global pod_manager, pod_connection_error

    # Clear any previous error
    pod_connection_error = None

    try:
        # Disconnect from any existing pod first
        # TO-DO have to fix this for multi-gpu
        if pod_manager and pod_manager.pod is not None:
            await pod_manager.disconnect()

        result = await pod_manager.connect_to_pod(pod_id)

        if result.get("status") == "ok":
            pod_manager.attach_executor(executor)
            addresses = pod_manager.get_executor_addresses()
            reconnect_zmq_sockets(
                executor,
                cmd_addr=addresses["cmd_addr"],
                pub_addr=addresses["pub_addr"],
                is_remote=True  # Critical: Tell executor this is a remote worker
            )
        else:
            # Connection failed - store the error message
            error_msg = result.get("message", "Connection failed")
            pod_connection_error = error_msg
            if pod_manager and pod_manager.pod:
                await pod_manager.disconnect()

    except Exception as e:
        pod_connection_error = str(e)
        # Clean up on error
        if pod_manager and pod_manager.pod:
            try:
                await pod_manager.disconnect()
            except Exception:
                pass


@app.post("/api/gpu/pods/{pod_id}/connect")
async def connect_to_pod(pod_id: str):
    """Connect to a GPU pod and establish SSH tunnel for remote execution."""
    global pod_manager

    active_provider = get_active_provider()
    if not active_provider or not active_provider.is_configured:
        raise HTTPException(status_code=503, detail="No GPU provider configured. Please select and configure a provider.")

    if pod_manager is None:
        pod_manager = PodKernelManager(provider_service=active_provider)

    # Start the connection in the background
    asyncio.create_task(_connect_to_pod_background(pod_id))

    # Return immediately with a "connecting" status
    return {
        "status": "connecting",
        "message": "Connection initiated. Check status endpoint for updates.",
        "pod_id": pod_id
    }


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
    """
    Get status of current pod connection.

    Returns connection status AND any running pods from the active provider's API.
    This ensures we don't lose track of running pods after backend restart.
    """
    global pod_connection_error

    # Check if there's a connection error to report
    if pod_connection_error:
        error_msg = pod_connection_error
        pod_connection_error = None  # Clear after reporting
        return {
            "connected": False,
            "pod": None,
            "error": error_msg
        }

    # Check local connection state first
    local_status = None
    if pod_manager is not None:
        local_status = await pod_manager.get_status()
        if local_status.get("connected"):
            return local_status

    # If not locally connected, check the active provider's API for any running pods
    active_provider = get_active_provider()
    if active_provider and active_provider.is_configured:
        try:
            pods_response = await active_provider.get_pods(status=None, limit=100, offset=0)
            pods = pods_response.get("data", [])

            # Find any ACTIVE pods with SSH connection info
            running_pods = [
                pod for pod in pods
                if pod.get("status") == "ACTIVE" and pod.get("sshConnection")
            ]

            if running_pods:
                # Return the first running pod as "discovered but not connected"
                first_pod = running_pods[0]
                return {
                    "connected": False,
                    "discovered_running_pods": running_pods,
                    "pod": {
                        "id": first_pod.get("id"),
                        "name": first_pod.get("name"),
                        "status": first_pod.get("status"),
                        "gpu_type": first_pod.get("gpuName"),
                        "gpu_count": first_pod.get("gpuCount"),
                        "price_hr": first_pod.get("priceHr"),
                        "ssh_connection": first_pod.get("sshConnection")
                    },
                    "provider": active_provider.PROVIDER_NAME,
                    "message": "Found running pod but not connected. Backend may have restarted."
                }
        except Exception:
            pass

    # No connection and no running pods found
    return {"connected": False, "pod": None}


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

    # Extract user and host from user@host
    ssh_user, ssh_host = host_part.split("@")
    ssh_port = ssh_parts[ssh_parts.index("-p") + 1] if "-p" in ssh_parts else "22"

    ssh_key = pod_manager._get_ssh_key()
    cmd = ["ssh", "-p", ssh_port]
    if ssh_key:
        cmd.extend(["-i", ssh_key])
    cmd.extend([
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "BatchMode=yes",
        f"{ssh_user}@{ssh_host}",
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
    active_provider = get_active_provider()
    if not active_provider or not active_provider.is_configured:
        raise HTTPException(status_code=503, detail="No GPU provider configured. Please select and configure a provider.")

    try:
        body = await request.json()
        pod_id = body.get("pod_id")
        disk_name = body.get("disk_name")
        size_gb = body.get("size_gb")
        provider_type = body.get("provider_type", active_provider.PROVIDER_NAME)

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


# ============================================================================
# Claude AI API
# ============================================================================

@app.get("/api/claude/config")
async def get_claude_config():
    """Check if Claude API is configured."""
    return {"configured": claude_service is not None}


@app.post("/api/claude/config")
async def set_claude_config(request: Request):
    """Save Claude API key to user config and reinitialize service."""
    global claude_service

    body = await request.json()
    api_key = body.get("api_key", "").strip()

    if not api_key:
        raise HTTPException(status_code=400, detail="API key is required")

    try:
        # Test the API key by creating a service
        test_service = ClaudeService(api_key=api_key)
        # If successful, save and use it
        save_api_key("CLAUDE_API_KEY", api_key)
        claude_service = test_service
        return {"configured": True, "message": "Claude API key saved successfully"}
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"anthropic package not installed: {e}")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid API key. Please check your credentials.")


# ============================================================================
# Static Frontend Serving (Production Mode)
# ============================================================================

# Location of pre-built static frontend files
STATIC_DIR = PACKAGE_DIR / "_static"


def _get_index_html() -> str | None:
    """Read the index.html file from static directory."""
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return index_path.read_text()
    return None


# Serve static frontend if available (production mode)
if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
    # Mount static assets (JS, CSS, etc.) - must be before catch-all route
    app.mount("/_next", StaticFiles(directory=str(STATIC_DIR / "_next")), name="next_static")

    # Serve index.html for the root and any non-API routes (SPA routing)
    @app.get("/", response_class=HTMLResponse)
    async def serve_index():
        """Serve the main index.html for the SPA."""
        html = _get_index_html()
        if html:
            return HTMLResponse(content=html)
        raise HTTPException(status_code=404, detail="Frontend not found")

    # Catch-all route for SPA client-side routing
    # This must be defined last to not interfere with API routes
    @app.get("/{path:path}")
    async def serve_spa(path: str):
        """Serve static files or fall back to index.html for SPA routing."""
        # Don't interfere with API, WebSocket, or assets routes
        if path.startswith(("api/", "ws", "assets/")):
            raise HTTPException(status_code=404, detail="Not found")

        # Try to serve static file directly
        static_file = STATIC_DIR / path
        if static_file.exists() and static_file.is_file():
            return FileResponse(static_file)

        # For directories, try index.html inside them (Next.js static export)
        if static_file.exists() and static_file.is_dir():
            index_in_dir = static_file / "index.html"
            if index_in_dir.exists():
                return FileResponse(index_in_dir)

        # Fall back to main index.html for SPA routing
        html = _get_index_html()
        if html:
            return HTMLResponse(content=html)

        raise HTTPException(status_code=404, detail="Not found")
