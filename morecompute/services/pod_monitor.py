"""Service for monitoring GPU pod status updates."""

import asyncio
from typing import Callable, Awaitable, Union
from cachetools import TTLCache

from .prime_intellect import PrimeIntellectService
from .providers.base_provider import BaseGPUProvider


PodUpdateCallback = Callable[[dict], Awaitable[None]]

# Type alias for supported provider services
ProviderService = Union[PrimeIntellectService, BaseGPUProvider]


class PodMonitor:
    """Monitors GPU pod status and broadcasts updates.

    Supports monitoring pods from any GPU provider that implements
    the BaseGPUProvider interface.
    """

    POLL_INTERVAL_SECONDS = 5

    def __init__(
        self,
        pod_cache: TTLCache,
        update_callback: PodUpdateCallback,
        prime_intellect: PrimeIntellectService | None = None,
        provider_service: BaseGPUProvider | None = None,
    ):
        """
        Initialize pod monitor.

        Args:
            pod_cache: Cache to clear on updates
            update_callback: Async callback for broadcasting updates
            prime_intellect: Legacy Prime Intellect API service (deprecated, use provider_service)
            provider_service: GPU provider service implementing BaseGPUProvider
        """
        # Support both old and new interface
        if provider_service is not None:
            self.provider = provider_service
            self.provider_name = provider_service.PROVIDER_NAME
        elif prime_intellect is not None:
            # Backwards compatibility
            self.provider = prime_intellect
            self.provider_name = "prime_intellect"
        else:
            raise ValueError("Either prime_intellect or provider_service must be provided")

        self.pod_cache = pod_cache
        self.update_callback = update_callback
        self.monitoring_tasks: dict[str, asyncio.Task] = {}

    async def start_monitoring(self, pod_id: str) -> None:
        """
        Start monitoring a pod's status.

        Args:
            pod_id: ID of pod to monitor
        """
        # Don't start duplicate monitors
        if pod_id in self.monitoring_tasks:
            return

        task = asyncio.create_task(self._monitor_loop(pod_id))
        self.monitoring_tasks[pod_id] = task

    async def stop_monitoring(self, pod_id: str) -> None:
        """
        Stop monitoring a pod.

        Args:
            pod_id: ID of pod to stop monitoring
        """
        task = self.monitoring_tasks.pop(pod_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    def _normalize_status(self, status: str) -> str:
        """Normalize status across different providers."""
        # Common status normalization
        status_map = {
            # Common statuses
            "running": "ACTIVE",
            "active": "ACTIVE",
            "ready": "ACTIVE",
            "starting": "STARTING",
            "pending": "PENDING",
            "stopped": "STOPPED",
            "terminated": "TERMINATED",
            "error": "ERROR",
            # Provider-specific
            "exited": "TERMINATED",
            "loading": "STARTING",
            "booting": "STARTING",
        }
        return status_map.get(status.lower(), status.upper())

    async def _monitor_loop(self, pod_id: str) -> None:
        """
        Main monitoring loop for a pod.

        Args:
            pod_id: ID of pod to monitor
        """
        try:
            while True:
                try:
                    # Fetch current pod status
                    pod = await self.provider.get_pod(pod_id)

                    # Normalize the status
                    normalized_status = self._normalize_status(pod.status)

                    # Clear cache to force fresh data
                    self.pod_cache.clear()

                    # Broadcast update with provider info
                    await self.update_callback({
                        "type": "pod_status_update",
                        "data": {
                            "pod_id": pod_id,
                            "name": pod.name,
                            "status": normalized_status,
                            "ssh_connection": pod.sshConnection,
                            "ip": pod.ip,
                            "gpu_name": pod.gpuName,
                            "gpu_count": pod.gpuCount,
                            "price_hr": pod.priceHr,
                            "provider": self.provider_name
                        }
                    })

                    # Stop monitoring if ERROR or TERMINATED
                    if normalized_status in {"ERROR", "TERMINATED"}:
                        break

                    # If ACTIVE and has SSH connection, pod is fully ready - stop monitoring
                    # Note: Modal doesn't support SSH, so we just check for ACTIVE
                    if normalized_status == "ACTIVE":
                        if pod.sshConnection or self.provider_name == "modal":
                            break

                    # Wait before next check
                    await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

                except Exception:
                    await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

        finally:
            # Clean up
            self.monitoring_tasks.pop(pod_id, None)

    def stop_all(self) -> None:
        """Stop monitoring all pods."""
        for pod_id in list(self.monitoring_tasks.keys()):
            task = self.monitoring_tasks.pop(pod_id, None)
            if task and not task.done():
                task.cancel()
