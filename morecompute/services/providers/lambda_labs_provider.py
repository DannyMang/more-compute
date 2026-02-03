"""Lambda Labs GPU cloud provider implementation."""

from typing import Any
from datetime import datetime, timezone

from .base_provider import BaseGPUProvider, NormalizedPod
from .provider_factory import register_provider
from ...models.api_models import PodResponse


@register_provider
class LambdaLabsProvider(BaseGPUProvider):
    """Lambda Labs GPU cloud provider using REST API."""

    PROVIDER_NAME = "lambda_labs"
    PROVIDER_DISPLAY_NAME = "Lambda Labs"
    API_KEY_ENV_NAME = "LAMBDA_LABS_API_KEY"
    SUPPORTS_SSH = True
    DASHBOARD_URL = "https://cloud.lambdalabs.com/api-keys"

    BASE_URL = "https://cloud.lambdalabs.com/api/v1"

    def __init__(self, api_key: str | None = None):
        super().__init__(api_key)

    def _get_auth_headers(self) -> dict[str, str]:
        """Get Lambda Labs authentication headers."""
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}" if self.api_key else ""
        }

    async def get_gpu_availability(
        self,
        regions: list[str] | None = None,
        gpu_count: int | None = None,
        gpu_type: str | None = None,
        **kwargs: Any
    ) -> dict[str, Any]:
        """Get available GPU instance types from Lambda Labs.

        Lambda Labs returns instance types with availability info.
        """
        response = await self._make_request(
            "GET",
            f"{self.BASE_URL}/instance-types"
        )

        instance_types = response.get("data", {})
        gpus = []

        for instance_type_name, instance_info in instance_types.items():
            instance_type = instance_info.get("instance_type", {})
            regions_available = instance_info.get("regions_with_capacity_available", [])

            # Filter by region if specified
            if regions:
                regions_available = [r for r in regions_available if r.get("name") in regions]

            # Skip if no availability
            if not regions_available:
                continue

            specs = instance_type.get("specs", {})
            gpu_spec = specs.get("gpus", 1)
            gpu_name = instance_type.get("description", instance_type_name)

            # Filter by GPU type if specified
            if gpu_type and gpu_type.lower() not in gpu_name.lower():
                continue

            # Filter by GPU count if specified
            if gpu_count and gpu_spec != gpu_count:
                continue

            for region in regions_available:
                gpus.append({
                    "gpuType": instance_type_name,
                    "gpuName": gpu_name,
                    "gpuCount": gpu_spec,
                    "priceHr": instance_type.get("price_cents_per_hour", 0) / 100,
                    "cloudId": instance_type_name,
                    "socket": instance_type_name,
                    "region": region.get("name"),
                    "regionDescription": region.get("description"),
                    "vcpus": specs.get("vcpus"),
                    "memoryGb": specs.get("memory_gib"),
                    "storageGb": specs.get("storage_gib"),
                    "provider": self.PROVIDER_NAME
                })

        return {
            "data": gpus,
            "total_count": len(gpus),
            "provider": self.PROVIDER_NAME
        }

    async def create_pod(self, request: Any) -> PodResponse:
        """Launch a new Lambda Labs instance.

        Args:
            request: CreatePodRequest with pod configuration

        Returns:
            PodResponse with created instance info
        """
        import sys
        from fastapi import HTTPException

        pod_config = request.pod if hasattr(request, 'pod') else request

        # Get SSH key IDs (Lambda requires exactly one SSH key)
        ssh_keys = await self._get_ssh_key_ids()
        if not ssh_keys:
            raise HTTPException(
                status_code=400,
                detail="No SSH keys found. Please add an SSH key to your Lambda Labs account at https://cloud.lambdalabs.com/ssh-keys"
            )
        # Lambda Labs requires exactly one SSH key - use the first one
        ssh_key = ssh_keys[0]

        instance_type = pod_config.gpuType if hasattr(pod_config, 'gpuType') else pod_config.get("gpuType")
        name = pod_config.name if hasattr(pod_config, 'name') else pod_config.get("name", "morecompute-instance")

        # Try multiple field names for region
        region = None
        for field in ['dataCenterId', 'region', 'regionName', 'region_name']:
            if hasattr(pod_config, field):
                region = getattr(pod_config, field)
            elif isinstance(pod_config, dict) and pod_config.get(field):
                region = pod_config.get(field)
            if region:
                break

        if not region:
            # Get all availability and find region for this specific instance type
            availability = await self.get_gpu_availability()  # Get all, don't filter
            if availability.get("data"):
                # Find the GPU entry matching this instance type
                for gpu in availability["data"]:
                    if gpu.get("cloudId") == instance_type or gpu.get("gpuType") == instance_type:
                        region = gpu.get("region")
                        break

        if not region:
            raise HTTPException(
                status_code=400,
                detail=f"No available regions found for instance type '{instance_type}'. This GPU may be out of stock. Please try a different GPU."
            )

        payload = {
            "instance_type_name": instance_type,
            "ssh_key_names": [ssh_key],  # Lambda requires exactly one SSH key
            "name": name,
            "quantity": 1,
            "region_name": region  # Always required
        }

        response = await self._make_request(
            "POST",
            f"{self.BASE_URL}/instance-operations/launch",
            json_data=payload
        )

        instance_ids = response.get("data", {}).get("instance_ids", [])
        if not instance_ids:
            raise HTTPException(status_code=500, detail="Failed to launch Lambda Labs instance")

        # Get instance details
        instance_id = instance_ids[0]
        return await self.get_pod(instance_id)

    async def _get_ssh_key_ids(self) -> list[str]:
        """Get list of SSH key names registered with Lambda Labs.

        Returns keys sorted to prefer ed25519 keys (more common for modern setups).
        """
        response = await self._make_request(
            "GET",
            f"{self.BASE_URL}/ssh-keys"
        )

        keys = response.get("data", [])

        # Separate ed25519 keys from others (prefer ed25519 as they're more common locally)
        ed25519_keys = []
        other_keys = []

        for key in keys:
            name = key.get("name")
            public_key = key.get("public_key", "")
            if name:
                if public_key.startswith("ssh-ed25519"):
                    ed25519_keys.append(name)
                else:
                    other_keys.append(name)

        # Return ed25519 keys first, then others
        return ed25519_keys + other_keys

    async def get_ssh_keys_detailed(self) -> list[dict[str, Any]]:
        """Get detailed list of SSH keys with their types."""
        response = await self._make_request(
            "GET",
            f"{self.BASE_URL}/ssh-keys"
        )

        keys = response.get("data", [])
        result = []

        for key in keys:
            public_key = key.get("public_key", "")
            key_type = "unknown"
            if public_key.startswith("ssh-ed25519"):
                key_type = "ed25519"
            elif public_key.startswith("ssh-rsa"):
                key_type = "rsa"
            elif public_key.startswith("ecdsa"):
                key_type = "ecdsa"

            result.append({
                "name": key.get("name"),
                "type": key_type,
                "fingerprint": public_key[:50] + "..." if len(public_key) > 50 else public_key
            })

        return result

    async def add_ssh_key(self, name: str, public_key: str) -> dict[str, Any]:
        """Add a new SSH key to Lambda Labs account."""
        response = await self._make_request(
            "POST",
            f"{self.BASE_URL}/ssh-keys",
            json_data={
                "name": name,
                "public_key": public_key
            }
        )
        return response.get("data", {})

    async def get_pods(
        self,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0
    ) -> dict[str, Any]:
        """Get list of all Lambda Labs instances."""
        response = await self._make_request(
            "GET",
            f"{self.BASE_URL}/instances"
        )

        instances = response.get("data", [])

        # Filter by status if specified
        if status:
            status_lower = status.lower()
            instances = [i for i in instances if i.get("status", "").lower() == status_lower]

        # Apply pagination
        instances = instances[offset:offset + limit]

        # Transform to standardized format
        pods = []
        for instance in instances:
            ssh_connection = None
            ip = instance.get("ip")
            if ip:
                ssh_connection = f"ssh ubuntu@{ip}"

            pods.append({
                "id": instance.get("id"),
                "name": instance.get("name"),
                "status": self._normalize_status(instance.get("status", "unknown")),
                "gpuName": instance.get("instance_type", {}).get("description", ""),
                "gpuCount": instance.get("instance_type", {}).get("specs", {}).get("gpus", 1),
                "priceHr": instance.get("instance_type", {}).get("price_cents_per_hour", 0) / 100,
                "sshConnection": ssh_connection,
                "ip": ip,
                "region": instance.get("region", {}).get("name"),
                "createdAt": instance.get("created_at", datetime.now(timezone.utc).isoformat()),
                "updatedAt": instance.get("created_at", datetime.now(timezone.utc).isoformat()),
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
        """Get details for a specific Lambda Labs instance."""
        response = await self._make_request(
            "GET",
            f"{self.BASE_URL}/instances/{pod_id}"
        )

        instance = response.get("data", {})
        if not instance:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail=f"Instance {pod_id} not found")

        ssh_connection = None
        ip = instance.get("ip")
        if ip:
            ssh_connection = f"ssh ubuntu@{ip}"

        now = datetime.now(timezone.utc)
        instance_type = instance.get("instance_type", {})

        return PodResponse(
            id=instance.get("id", ""),
            userId="",
            teamId=None,
            name=instance.get("name", ""),
            status=self._normalize_status(instance.get("status", "unknown")),
            gpuName=instance_type.get("description", ""),
            gpuCount=instance_type.get("specs", {}).get("gpus", 1),
            priceHr=instance_type.get("price_cents_per_hour", 0) / 100,
            sshConnection=ssh_connection,
            ip=ip,
            createdAt=now,
            updatedAt=now
        )

    async def delete_pod(self, pod_id: str) -> dict[str, Any]:
        """Terminate a Lambda Labs instance."""
        response = await self._make_request(
            "POST",
            f"{self.BASE_URL}/instance-operations/terminate",
            json_data={
                "instance_ids": [pod_id]
            }
        )

        terminated = response.get("data", {}).get("terminated_instances", [])
        return {
            "success": pod_id in [t.get("id") for t in terminated],
            "pod_id": pod_id,
            "provider": self.PROVIDER_NAME
        }

    async def restart_pod(self, pod_id: str) -> dict[str, Any]:
        """Restart a Lambda Labs instance."""
        response = await self._make_request(
            "POST",
            f"{self.BASE_URL}/instance-operations/restart",
            json_data={
                "instance_ids": [pod_id]
            }
        )

        restarted = response.get("data", {}).get("restarted_instances", [])
        return {
            "success": pod_id in [r.get("id") for r in restarted],
            "pod_id": pod_id,
            "action": "restarted"
        }

    def _normalize_status(self, lambda_status: str) -> str:
        """Convert Lambda Labs status to normalized status."""
        status_map = {
            "active": "ACTIVE",
            "booting": "STARTING",
            "unhealthy": "ERROR",
            "terminated": "TERMINATED"
        }
        return status_map.get(lambda_status.lower(), lambda_status.upper())

    def normalize_pod(self, pod_data: dict[str, Any]) -> NormalizedPod:
        """Convert Lambda Labs instance data to normalized format."""
        ssh_connection = None
        ip = pod_data.get("ip")
        if ip:
            ssh_connection = f"ssh ubuntu@{ip}"

        instance_type = pod_data.get("instance_type", {})

        return NormalizedPod(
            id=pod_data.get("id", ""),
            name=pod_data.get("name", ""),
            status=self._normalize_status(pod_data.get("status", "unknown")),
            gpu_name=instance_type.get("description", ""),
            gpu_count=instance_type.get("specs", {}).get("gpus", 1),
            price_hr=instance_type.get("price_cents_per_hour", 0) / 100,
            ssh_connection=ssh_connection,
            ip=ip,
            provider=self.PROVIDER_NAME,
            created_at=pod_data.get("created_at", datetime.now(timezone.utc).isoformat()),
            updated_at=pod_data.get("created_at", datetime.now(timezone.utc).isoformat())
        )
