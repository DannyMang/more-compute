"""
Language Server Protocol (LSP) service for Python autocomplete.
Manages Pyright language server for providing IntelliSense features.
"""

import asyncio
import json
import subprocess
import sys
from typing import Optional, Dict, Any, List
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


class LSPService:
    """Manages Pyright language server for Python code intelligence."""

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root
        self.process: Optional[subprocess.Popen] = None
        self.msg_id = 0
        self.pending_requests: Dict[int, asyncio.Future] = {}
        self.initialized = False
        self.documents: Dict[str, str] = {}  # Track open documents
        self._reader_task: Optional[asyncio.Task] = None

    async def start(self):
        """Start the Pyright language server process."""
        try:
            # Start Pyright in LSP mode
            self.process = subprocess.Popen(
                ["pyright-langserver", "--stdio"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
            )

            logger.info("Pyright language server started")

            # Start reading responses in background
            self._reader_task = asyncio.create_task(self._read_responses())

            # Initialize the language server
            init_result = await self._send_request("initialize", {
                "processId": None,
                "rootUri": f"file://{self.workspace_root}",
                "capabilities": {
                    "textDocument": {
                        "completion": {
                            "completionItem": {
                                "snippetSupport": True,
                                "documentationFormat": ["markdown", "plaintext"],
                                "resolveSupport": {
                                    "properties": ["documentation", "detail"]
                                }
                            },
                            "contextSupport": True
                        },
                        "hover": {
                            "contentFormat": ["markdown", "plaintext"]
                        },
                        "signatureHelp": {
                            "signatureInformation": {
                                "documentationFormat": ["markdown", "plaintext"]
                            }
                        }
                    }
                },
                "initializationOptions": {
                    "python": {
                        "analysis": {
                            "autoSearchPaths": True,
                            "useLibraryCodeForTypes": True,
                            "diagnosticMode": "openFilesOnly"
                        }
                    }
                }
            })

            # Send initialized notification
            await self._send_notification("initialized", {})
            self.initialized = True
            logger.info("Pyright language server initialized")

        except Exception as e:
            logger.error(f"Failed to start LSP service: {e}")
            raise

    async def get_completions(self, cell_id: str, source: str, line: int, character: int) -> List[Dict[str, Any]]:
        """Get code completions at a specific position."""
        if not self.initialized:
            return []

        try:
            # Create a virtual file URI for the cell
            file_uri = f"file://{self.workspace_root}/cell_{cell_id}.py"

            # Update the document
            if file_uri in self.documents:
                # Document already open, send change notification
                await self._send_notification("textDocument/didChange", {
                    "textDocument": {
                        "uri": file_uri,
                        "version": self.documents[file_uri]["version"] + 1
                    },
                    "contentChanges": [{"text": source}]
                })
                self.documents[file_uri]["version"] += 1
                self.documents[file_uri]["text"] = source
            else:
                # Open new document
                await self._send_notification("textDocument/didOpen", {
                    "textDocument": {
                        "uri": file_uri,
                        "languageId": "python",
                        "version": 1,
                        "text": source
                    }
                })
                self.documents[file_uri] = {"version": 1, "text": source}

            # Request completions
            result = await self._send_request("textDocument/completion", {
                "textDocument": {"uri": file_uri},
                "position": {"line": line, "character": character},
                "context": {"triggerKind": 1}  # Invoked
            })

            if not result:
                return []

            # Handle both list and CompletionList formats
            items = result.get("items", []) if isinstance(result, dict) else result

            return items if isinstance(items, list) else []

        except Exception as e:
            logger.error(f"Error getting completions: {e}")
            return []

    async def get_hover(self, cell_id: str, source: str, line: int, character: int) -> Optional[Dict[str, Any]]:
        """Get hover information at a specific position."""
        if not self.initialized:
            return None

        try:
            file_uri = f"file://{self.workspace_root}/cell_{cell_id}.py"

            # Ensure document is open
            if file_uri not in self.documents:
                await self._send_notification("textDocument/didOpen", {
                    "textDocument": {
                        "uri": file_uri,
                        "languageId": "python",
                        "version": 1,
                        "text": source
                    }
                })
                self.documents[file_uri] = {"version": 1, "text": source}

            result = await self._send_request("textDocument/hover", {
                "textDocument": {"uri": file_uri},
                "position": {"line": line, "character": character}
            })

            return result

        except Exception as e:
            logger.error(f"Error getting hover info: {e}")
            return None

    async def _send_request(self, method: str, params: Dict[str, Any]) -> Any:
        """Send a JSON-RPC request and wait for response."""
        if not self.process or not self.process.stdin:
            raise RuntimeError("LSP process not running")

        self.msg_id += 1
        msg_id = self.msg_id

        message = {
            "jsonrpc": "2.0",
            "id": msg_id,
            "method": method,
            "params": params
        }

        # Create future for response
        future: asyncio.Future = asyncio.Future()
        self.pending_requests[msg_id] = future

        # Send message
        content = json.dumps(message)
        headers = f"Content-Length: {len(content)}\r\n\r\n"
        try:
            self.process.stdin.write((headers + content).encode())
            self.process.stdin.flush()
        except Exception as e:
            del self.pending_requests[msg_id]
            raise RuntimeError(f"Failed to send LSP request: {e}")

        # Wait for response with timeout
        try:
            result = await asyncio.wait_for(future, timeout=5.0)
            return result
        except asyncio.TimeoutError:
            del self.pending_requests[msg_id]
            logger.warning(f"LSP request timeout for method: {method}")
            return None

    async def _send_notification(self, method: str, params: Dict[str, Any]):
        """Send a notification (no response expected)."""
        if not self.process or not self.process.stdin:
            raise RuntimeError("LSP process not running")

        message = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }

        content = json.dumps(message)
        headers = f"Content-Length: {len(content)}\r\n\r\n"
        self.process.stdin.write((headers + content).encode())
        self.process.stdin.flush()

    async def _read_responses(self):
        """Background task to read LSP responses."""
        if not self.process or not self.process.stdout:
            return

        buffer = b""

        try:
            while self.process.poll() is None:
                # Read data
                chunk = await asyncio.get_event_loop().run_in_executor(
                    None, self.process.stdout.read, 1024
                )

                if not chunk:
                    break

                buffer += chunk

                # Process complete messages
                while b"\r\n\r\n" in buffer:
                    header_end = buffer.index(b"\r\n\r\n")
                    headers = buffer[:header_end].decode('utf-8')
                    buffer = buffer[header_end + 4:]

                    # Parse Content-Length
                    content_length = 0
                    for line in headers.split("\r\n"):
                        if line.startswith("Content-Length:"):
                            content_length = int(line.split(":")[1].strip())
                            break

                    # Wait for complete message
                    while len(buffer) < content_length:
                        chunk = await asyncio.get_event_loop().run_in_executor(
                            None, self.process.stdout.read, content_length - len(buffer)
                        )
                        if not chunk:
                            break
                        buffer += chunk

                    # Parse message
                    message_data = buffer[:content_length]
                    buffer = buffer[content_length:]

                    try:
                        message = json.loads(message_data.decode('utf-8'))
                        await self._handle_message(message)
                    except json.JSONDecodeError as e:
                        logger.error(f"Failed to parse LSP message: {e}")

        except Exception as e:
            logger.error(f"Error reading LSP responses: {e}")

    async def _handle_message(self, message: Dict[str, Any]):
        """Handle incoming LSP message."""
        # Response to our request
        if "id" in message and message["id"] in self.pending_requests:
            future = self.pending_requests.pop(message["id"])
            if "result" in message:
                future.set_result(message["result"])
            elif "error" in message:
                future.set_exception(RuntimeError(message["error"]))
            else:
                future.set_result(None)

        # Notification from server (e.g., diagnostics)
        elif "method" in message:
            # We can handle server notifications here if needed
            pass

    async def shutdown(self):
        """Shutdown the language server."""
        if not self.initialized:
            return

        try:
            # Close all documents
            for uri in list(self.documents.keys()):
                await self._send_notification("textDocument/didClose", {
                    "textDocument": {"uri": uri}
                })

            # Shutdown
            await self._send_request("shutdown", {})
            await self._send_notification("exit", {})

            # Cancel reader task
            if self._reader_task:
                self._reader_task.cancel()
                try:
                    await self._reader_task
                except asyncio.CancelledError:
                    pass

            # Terminate process
            if self.process:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()

            logger.info("LSP service shutdown complete")

        except Exception as e:
            logger.error(f"Error during LSP shutdown: {e}")
