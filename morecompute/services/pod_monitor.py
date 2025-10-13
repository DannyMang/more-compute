"""Service for monitoring GPU pod status updates."""

import asyncio
import sys
from typing import Callable, Awaitable
from cachetools import TTLCache

from .prime_intellect import PrimeIntellectService


PodUpdateCallback = Callable[[dict], Awaitable[None]]


class PodMonitor:
    """Monitors GPU pod status and broadcasts updates."""

    POLL_INTERVAL_SECONDS = 5

    def __init__(
        self,
        prime_intellect: PrimeIntellectService,
        pod_cache: TTLCache,
        update_callback: PodUpdateCallback
    ):
        """
        Initialize pod monitor.

        Args:
            prime_intellect: Prime Intellect API service
            pod_cache: Cache to clear on updates
            update_callback: Async callback for broadcasting updates
        """
        self.pi_service = prime_intellect
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
            print(f"[POD MONITOR] Already monitoring pod {pod_id}", file=sys.stderr, flush=True)
            return

        task = asyncio.create_task(self._monitor_loop(pod_id))
        self.monitoring_tasks[pod_id] = task
        print(f"[POD MONITOR] Started monitoring pod {pod_id}", file=sys.stderr, flush=True)

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
        print(f"[POD MONITOR] Stopped monitoring pod {pod_id}", file=sys.stderr, flush=True)

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
                    pod = await self.pi_service.get_pod(pod_id)

                    print(
                        f"[POD MONITOR] Pod {pod_id} status: {pod.status}",
                        file=sys.stderr,
                        flush=True
                    )

                    # Clear cache to force fresh data
                    self.pod_cache.clear()

                    # Broadcast update
                    await self.update_callback({
                        "type": "pod_status_update",
                        "data": {
                            "pod_id": pod_id,
                            "name": pod.name,
                            "status": pod.status,
                            "ssh_connection": pod.sshConnection,
                            "ip": pod.ip,
                            "gpu_name": pod.gpuName,
                            "price_hr": pod.priceHr
                        }
                    })

                    # Stop monitoring if ERROR or TERMINATED
                    if pod.status in {"ERROR", "TERMINATED"}:
                        print(
                            f"[POD MONITOR] Pod {pod_id} reached terminal state: {pod.status}",
                            file=sys.stderr,
                            flush=True
                        )
                        break

                    # If ACTIVE and has SSH connection, pod is fully ready - stop monitoring
                    if pod.status == "ACTIVE" and pod.sshConnection:
                        print(
                            f"[POD MONITOR] Pod {pod_id} is ACTIVE with SSH connection: {pod.sshConnection}",
                            file=sys.stderr,
                            flush=True
                        )
                        break

                    # Wait before next check
                    await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

                except Exception as e:
                    print(
                        f"[POD MONITOR] Error checking pod {pod_id}: {e}",
                        file=sys.stderr,
                        flush=True
                    )
                    await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

        finally:
            # Clean up
            self.monitoring_tasks.pop(pod_id, None)
            print(f"[POD MONITOR] Stopped monitoring pod {pod_id}", file=sys.stderr, flush=True)
