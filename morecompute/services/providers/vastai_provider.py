"""Vast.ai GPU cloud provider implementation."""

import json
from typing import Any
from datetime import datetime, timezone

from .base_provider import BaseGPUProvider, NormalizedPod
from .provider_factory import register_provider
from ...models.api_models import PodResponse


@register_provider
class VastAIProvider(BaseGPUProvider):
    """Vast.ai GPU cloud provider using REST API.

    Vast.ai provides community GPUs at competitive prices.
    """

    PROVIDER_NAME = "vastai"
    PROVIDER_DISPLAY_NAME = "Vast.ai"
    API_KEY_ENV_NAME = "VASTAI_API_KEY"
    SUPPORTS_SSH = True
    DASHBOARD_URL = "https://cloud.vast.ai/"

    BASE_URL = "https://console.vast.ai/api/v0"

    def __init__(self, api_key: str | None = None):
        super().__init__(api_key)

    def _get_auth_headers(self) -> dict[str, str]:
        """Get Vast.ai authentication headers."""
        return {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def _make_vast_request(
        self,
        method: str,
        endpoint: str,
        params: dict[str, Any] | None = None,
        json_data: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Make an authenticated request to Vast.ai API.

        Vast.ai uses api_key as a query parameter.
        """
        import httpx
        from fastapi import HTTPException

        url = f"{self.BASE_URL}{endpoint}"

        # Add API key to params
        if params is None:
            params = {}
        params["api_key"] = self.api_key

        async with httpx.AsyncClient(follow_redirects=True) as client:
            try:
                response = await client.request(
                    method=method,
                    url=url,
                    headers=self._get_auth_headers(),
                    params=params,
                    json=json_data,
                    timeout=30.0
                )
                response.raise_for_status()

                if response.status_code == 204 or not response.content:
                    return {}

                return response.json()
            except httpx.HTTPStatusError as e:
                raise HTTPException(
                    status_code=e.response.status_code,
                    detail=f"Vast.ai API error: {e.response.text}"
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Vast.ai connection error: {str(e)}"
                )

    async def get_gpu_availability(
        self,
        regions: list[str] | None = None,
        gpu_count: int | None = None,
        gpu_type: str | None = None,
        verified: bool | None = None,
        min_reliability: float | None = None,
        min_gpu_ram: float | None = None,
        **kwargs: Any
    ) -> dict[str, Any]:
        """Get available GPU offers from Vast.ai marketplace.

        Vast.ai has a marketplace model where users list their GPUs.

        Args:
            regions: Filter by region/geolocation
            gpu_count: Minimum number of GPUs
            gpu_type: Filter by GPU name (exact match)
            verified: If True, only show verified hosts
            min_reliability: Minimum reliability score (0.0-1.0)
            min_gpu_ram: Minimum GPU RAM in GB
        """
        # Build query for offers
        query = {
            "rentable": {"eq": True},
            "rented": {"eq": False},
            "order": [["dph_total", "asc"]],  # Sort by price
            "type": "on-demand"
        }

        # Filter by verified status (default to True if not specified)
        if verified is True or verified is None:
            query["verified"] = {"eq": True}

        # Filter by GPU type (partial match using contains-like behavior)
        if gpu_type:
            # Vast.ai uses exact match, so we'll do client-side filtering for partial match
            pass

        # Filter by GPU count
        if gpu_count:
            query["num_gpus"] = {"gte": gpu_count}

        # Filter by reliability
        if min_reliability is not None:
            query["reliability2"] = {"gte": min_reliability}

        # Filter by GPU RAM (in MB for Vast.ai)
        if min_gpu_ram is not None:
            query["gpu_ram"] = {"gte": min_gpu_ram * 1024}  # Convert GB to MB

        response = await self._make_vast_request(
            "GET",
            "/bundles",
            params={"q": json.dumps(query)}
        )

        offers = response.get("offers", [])

        # Transform to standardized format
        gpus = []
        for offer in offers:
            # Filter by region if specified
            if regions and offer.get("geolocation", "").split(",")[0] not in regions:
                continue

            # Client-side filter by GPU type (partial match)
            if gpu_type:
                gpu_name = offer.get("gpu_name", "").lower()
                if gpu_type.lower() not in gpu_name:
                    continue

            gpus.append({
                "gpuType": offer.get("gpu_name", ""),
                "gpuName": offer.get("gpu_name", ""),
                "gpuCount": offer.get("num_gpus", 1),
                "priceHr": offer.get("dph_total", 0),
                "cloudId": str(offer.get("id")),
                "socket": str(offer.get("id")),
                "region": offer.get("geolocation", "").split(",")[0] if offer.get("geolocation") else None,
                "geolocation": offer.get("geolocation"),
                "reliabilityScore": offer.get("reliability2", offer.get("reliability", 0)),
                "dlPerf": offer.get("dlperf", 0),
                "memoryGb": offer.get("gpu_ram", 0) / 1024,  # Convert MB to GB
                "storageGb": offer.get("disk_space", 0),
                "cpuCores": offer.get("cpu_cores_effective"),
                "cpuRam": offer.get("cpu_ram", 0) / 1024,  # Convert MB to GB
                "verified": offer.get("verified", False),
                "provider": self.PROVIDER_NAME
            })

        return {
            "data": gpus,
            "total_count": len(gpus),
            "provider": self.PROVIDER_NAME
        }

    async def create_pod(self, request: Any) -> PodResponse:
        """Create a new Vast.ai instance.

        Args:
            request: CreatePodRequest with pod configuration

        Returns:
            PodResponse with created instance info
        """
        import sys
        from fastapi import HTTPException

        pod_config = request.pod if hasattr(request, 'pod') else request

        offer_id = pod_config.cloudId if hasattr(pod_config, 'cloudId') else pod_config.get("cloudId")
        image = pod_config.image if hasattr(pod_config, 'image') else pod_config.get("image", "nvidia/cuda:12.1.0-devel-ubuntu22.04")
        disk_size = pod_config.diskSize if hasattr(pod_config, 'diskSize') else pod_config.get("diskSize", 20)
        name = pod_config.name if hasattr(pod_config, 'name') else pod_config.get("name", "morecompute-instance")

        # Create the instance - Vast.ai API format
        payload = {
            "image": image,
            "disk": float(disk_size),
            "label": name,
            "runtype": "ssh",
        }

        # Add environment variables if specified
        env_vars = pod_config.envVars if hasattr(pod_config, 'envVars') else pod_config.get("envVars")
        if env_vars:
            env_dict = {e.key: e.value for e in env_vars} if hasattr(env_vars[0], 'key') else env_vars
            payload["env"] = env_dict

        try:
            response = await self._make_vast_request(
                "PUT",
                f"/asks/{offer_id}/",
                json_data=payload
            )
        except HTTPException as e:
            # Check for specific error cases
            error_detail = str(e.detail) if hasattr(e, 'detail') else str(e)

            if "402" in error_detail or "insufficient" in error_detail.lower() or "balance" in error_detail.lower():
                raise HTTPException(
                    status_code=402,
                    detail="Insufficient funds in your Vast.ai account. Please add credits at https://cloud.vast.ai/"
                )
            raise

        instance_id = response.get("new_contract")
        if not instance_id:
            # Check if response indicates an error
            if response.get("success") is False:
                error_msg = response.get("error", response.get("msg", "Unknown error"))
                raise HTTPException(status_code=400, detail=f"Vast.ai error: {error_msg}")
            raise HTTPException(status_code=500, detail="Failed to create Vast.ai instance - no contract ID returned")

        # Get instance details
        return await self.get_pod(str(instance_id))

    async def get_pods(
        self,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0
    ) -> dict[str, Any]:
        """Get list of all Vast.ai instances."""
        response = await self._make_vast_request(
            "GET",
            "/instances"
        )

        instances = response.get("instances", [])

        # Filter by status if specified
        if status:
            status_lower = status.lower()
            instances = [i for i in instances if self._normalize_status(i.get("actual_status", "")).lower() == status_lower]

        # Apply pagination
        instances = instances[offset:offset + limit]

        # Transform to standardized format
        pods = []
        for instance in instances:
            ssh_connection = self._build_ssh_connection(instance)

            pods.append({
                "id": str(instance.get("id")),
                "name": instance.get("label", f"vast-{instance.get('id')}"),
                "status": self._normalize_status(instance.get("actual_status", "loading")),
                "gpuName": instance.get("gpu_name", ""),
                "gpuCount": instance.get("num_gpus", 1),
                "priceHr": instance.get("dph_total", 0),
                "sshConnection": ssh_connection,
                "ip": instance.get("public_ipaddr"),
                "region": instance.get("geolocation", "").split(",")[0] if instance.get("geolocation") else None,
                "createdAt": instance.get("start_date", datetime.now(timezone.utc).isoformat()),
                "updatedAt": datetime.now(timezone.utc).isoformat(),
                "provider": self.PROVIDER_NAME
            })

        return {
            "data": pods,
            "total_count": len(pods),
            "offset": offset,
            "limit": limit,
            "provider": self.PROVIDER_NAME
        }

    async def get_pod(self, pod_id: str) -> PodResponse:
        """Get details for a specific Vast.ai instance."""
        from fastapi import HTTPException

        response = await self._make_vast_request(
            "GET",
            "/instances",
            params={"owner": "me"}
        )

        instances = response.get("instances", [])
        instance = next((i for i in instances if str(i.get("id")) == pod_id), None)

        if not instance:
            raise HTTPException(status_code=404, detail=f"Instance {pod_id} not found")

        ssh_connection = self._build_ssh_connection(instance)

        now = datetime.now(timezone.utc)
        return PodResponse(
            id=str(instance.get("id", "")),
            userId="",
            teamId=None,
            name=instance.get("label", f"vast-{instance.get('id')}"),
            status=self._normalize_status(instance.get("actual_status", "loading")),
            gpuName=instance.get("gpu_name", ""),
            gpuCount=instance.get("num_gpus", 1),
            priceHr=instance.get("dph_total", 0),
            sshConnection=ssh_connection,
            ip=instance.get("public_ipaddr"),
            createdAt=now,
            updatedAt=now
        )

    def _build_ssh_connection(self, instance: dict[str, Any]) -> str | None:
        """Build SSH connection string from Vast.ai instance data."""
        ip = instance.get("public_ipaddr") or instance.get("ssh_host")
        port = instance.get("ssh_port", 22)

        if not ip:
            return None

        return f"ssh root@{ip} -p {port}"

    async def delete_pod(self, pod_id: str) -> dict[str, Any]:
        """Destroy a Vast.ai instance."""
        response = await self._make_vast_request(
            "DELETE",
            f"/instances/{pod_id}/"
        )

        return {
            "success": response.get("success", True),
            "pod_id": pod_id,
            "provider": self.PROVIDER_NAME
        }

    async def stop_pod(self, pod_id: str) -> dict[str, Any]:
        """Stop a Vast.ai instance (without destroying)."""
        response = await self._make_vast_request(
            "PUT",
            f"/instances/{pod_id}/",
            json_data={"state": "stopped"}
        )

        return {
            "success": True,
            "pod_id": pod_id,
            "action": "stopped"
        }

    async def start_pod(self, pod_id: str) -> dict[str, Any]:
        """Start a stopped Vast.ai instance."""
        response = await self._make_vast_request(
            "PUT",
            f"/instances/{pod_id}/",
            json_data={"state": "running"}
        )

        return {
            "success": True,
            "pod_id": pod_id,
            "action": "started"
        }

    def _normalize_status(self, vast_status: str) -> str:
        """Convert Vast.ai status to normalized status."""
        status_map = {
            "running": "ACTIVE",
            "loading": "STARTING",
            "created": "PENDING",
            "exited": "STOPPED",
            "offline": "STOPPED",
            "error": "ERROR",
            "destroying": "TERMINATING"
        }
        return status_map.get(vast_status.lower(), vast_status.upper())

    def normalize_pod(self, pod_data: dict[str, Any]) -> NormalizedPod:
        """Convert Vast.ai instance data to normalized format."""
        ssh_connection = self._build_ssh_connection(pod_data)

        return NormalizedPod(
            id=str(pod_data.get("id", "")),
            name=pod_data.get("label", f"vast-{pod_data.get('id')}"),
            status=self._normalize_status(pod_data.get("actual_status", "loading")),
            gpu_name=pod_data.get("gpu_name", ""),
            gpu_count=pod_data.get("num_gpus", 1),
            price_hr=pod_data.get("dph_total", 0),
            ssh_connection=ssh_connection,
            ip=pod_data.get("public_ipaddr"),
            provider=self.PROVIDER_NAME,
            created_at=pod_data.get("start_date", datetime.now(timezone.utc).isoformat()),
            updated_at=datetime.now(timezone.utc).isoformat()
        )
