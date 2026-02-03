"""RunPod GPU cloud provider implementation."""

from typing import Any
from datetime import datetime
import httpx
from fastapi import HTTPException

from .base_provider import BaseGPUProvider, NormalizedPod
from .provider_factory import register_provider
from ...models.api_models import PodResponse


@register_provider
class RunPodProvider(BaseGPUProvider):
    """RunPod GPU cloud provider using GraphQL API."""

    PROVIDER_NAME = "runpod"
    PROVIDER_DISPLAY_NAME = "RunPod"
    API_KEY_ENV_NAME = "RUNPOD_API_KEY"
    SUPPORTS_SSH = True
    DASHBOARD_URL = "https://www.runpod.io/console/user/settings"

    BASE_URL = "https://api.runpod.io/graphql"

    def __init__(self, api_key: str | None = None):
        super().__init__(api_key)

    def _get_auth_headers(self) -> dict[str, str]:
        """Get RunPod authentication headers."""
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}" if self.api_key else ""
        }

    async def _graphql_request(
        self,
        query: str,
        variables: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Make a GraphQL request to RunPod API.

        Args:
            query: GraphQL query string
            variables: Query variables

        Returns:
            Response data

        Raises:
            HTTPException: On API errors
        """
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    self.BASE_URL,
                    headers=self._get_auth_headers(),
                    json={
                        "query": query,
                        "variables": variables or {}
                    },
                    timeout=30.0
                )
                response.raise_for_status()
                result = response.json()

                if "errors" in result:
                    error_msg = result["errors"][0].get("message", "Unknown error")
                    raise HTTPException(
                        status_code=400,
                        detail=f"RunPod API error: {error_msg}"
                    )

                return result.get("data", {})
            except httpx.HTTPStatusError as e:
                raise HTTPException(
                    status_code=e.response.status_code,
                    detail=f"RunPod API error: {e.response.text}"
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"RunPod connection error: {str(e)}"
                )

    async def get_gpu_availability(
        self,
        regions: list[str] | None = None,
        gpu_count: int | None = None,
        gpu_type: str | None = None,
        secure_cloud: bool | None = None,
        community_cloud: bool | None = None,
        **kwargs: Any
    ) -> dict[str, Any]:
        """Get available GPU types from RunPod.

        Returns dict with available GPUs and their pricing.

        Args:
            regions: Filter by region (not supported by RunPod GPU types query)
            gpu_count: Number of GPUs to request pricing for
            gpu_type: Filter by GPU type name (partial match)
            secure_cloud: If True, only show GPUs available in Secure Cloud
            community_cloud: If True, only show GPUs available in Community Cloud
        """
        query = """
        query GpuTypes {
            gpuTypes {
                id
                displayName
                memoryInGb
                secureCloud
                communityCloud
                lowestPrice(input: {gpuCount: 1}) {
                    minimumBidPrice
                    uninterruptablePrice
                }
            }
        }
        """

        data = await self._graphql_request(query)
        gpu_types = data.get("gpuTypes", [])

        # Filter by GPU type if specified
        if gpu_type:
            gpu_type_lower = gpu_type.lower()
            gpu_types = [
                g for g in gpu_types
                if gpu_type_lower in g.get("displayName", "").lower()
                or gpu_type_lower in g.get("id", "").lower()
            ]

        # Filter by cloud type
        if secure_cloud is True:
            gpu_types = [g for g in gpu_types if g.get("secureCloud")]
        if community_cloud is True:
            gpu_types = [g for g in gpu_types if g.get("communityCloud")]

        # Transform to normalized format
        gpus = []
        for gpu in gpu_types:
            lowest_price = gpu.get("lowestPrice", {})
            price = lowest_price.get("uninterruptablePrice") or lowest_price.get("minimumBidPrice") or 0

            gpus.append({
                "gpuType": gpu.get("id"),
                "gpuName": gpu.get("displayName"),
                "gpuCount": gpu_count or 1,
                "priceHr": price,
                "cloudId": gpu.get("id"),
                "socket": gpu.get("id"),
                "memoryGb": gpu.get("memoryInGb"),
                "secureCloud": gpu.get("secureCloud"),
                "communityCloud": gpu.get("communityCloud"),
                "provider": self.PROVIDER_NAME
            })

        return {
            "data": gpus,
            "total_count": len(gpus),
            "provider": self.PROVIDER_NAME
        }

    async def create_pod(self, request: Any) -> PodResponse:
        """Create a new RunPod pod.

        Args:
            request: CreatePodRequest with pod configuration

        Returns:
            PodResponse with created pod info
        """
        pod_config = request.pod if hasattr(request, 'pod') else request

        mutation = """
        mutation CreatePod($input: PodFindAndDeployOnDemandInput!) {
            podFindAndDeployOnDemand(input: $input) {
                id
                name
                desiredStatus
                imageName
                gpuCount
                machineId
                machine {
                    gpuDisplayName
                }
                runtime {
                    uptimeInSeconds
                    ports {
                        ip
                        isIpPublic
                        privatePort
                        publicPort
                        type
                    }
                }
            }
        }
        """

        variables = {
            "input": {
                "name": pod_config.name if hasattr(pod_config, 'name') else pod_config.get("name"),
                "gpuTypeId": pod_config.gpuType if hasattr(pod_config, 'gpuType') else pod_config.get("gpuType"),
                "gpuCount": pod_config.gpuCount if hasattr(pod_config, 'gpuCount') else pod_config.get("gpuCount", 1),
                "volumeInGb": pod_config.diskSize if hasattr(pod_config, 'diskSize') else pod_config.get("diskSize", 20),
                "containerDiskInGb": 20,
                "dockerArgs": "",
                "deployCost": pod_config.maxPrice if hasattr(pod_config, 'maxPrice') else pod_config.get("maxPrice"),
                "startSsh": True,
                "imageName": pod_config.image if hasattr(pod_config, 'image') else pod_config.get("image", "runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04"),
            }
        }

        # Remove None values
        variables["input"] = {k: v for k, v in variables["input"].items() if v is not None}

        data = await self._graphql_request(mutation, variables)
        pod_data = data.get("podFindAndDeployOnDemand", {})

        # Get SSH connection info
        ssh_connection = await self._get_ssh_connection(pod_data.get("id"))

        now = datetime.utcnow()
        return PodResponse(
            id=pod_data.get("id", ""),
            userId="",
            teamId=None,
            name=pod_data.get("name", ""),
            status=self._normalize_status(pod_data.get("desiredStatus", "PENDING")),
            gpuName=pod_data.get("machine", {}).get("gpuDisplayName", ""),
            gpuCount=pod_data.get("gpuCount", 1),
            priceHr=0.0,  # Will be fetched separately
            sshConnection=ssh_connection,
            ip=None,
            createdAt=now,
            updatedAt=now
        )

    async def _get_ssh_connection(self, pod_id: str) -> str | None:
        """Get SSH connection string for a pod."""
        if not pod_id:
            return None

        query = """
        query Pod($podId: String!) {
            pod(input: {podId: $podId}) {
                id
                runtime {
                    ports {
                        ip
                        isIpPublic
                        privatePort
                        publicPort
                        type
                    }
                }
            }
        }
        """

        try:
            data = await self._graphql_request(query, {"podId": pod_id})
            pod = data.get("pod", {})
            runtime = pod.get("runtime", {})
            ports = runtime.get("ports", [])

            for port in ports:
                if port.get("privatePort") == 22 and port.get("isIpPublic"):
                    ip = port.get("ip")
                    public_port = port.get("publicPort")
                    return f"ssh root@{ip} -p {public_port}"
        except Exception:
            pass

        return None

    async def get_pods(
        self,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0
    ) -> dict[str, Any]:
        """Get list of all RunPod pods."""
        query = """
        query Pods {
            myself {
                pods {
                    id
                    name
                    desiredStatus
                    imageName
                    gpuCount
                    costPerHr
                    machineId
                    machine {
                        gpuDisplayName
                    }
                    runtime {
                        uptimeInSeconds
                        ports {
                            ip
                            isIpPublic
                            privatePort
                            publicPort
                            type
                        }
                    }
                }
            }
        }
        """

        data = await self._graphql_request(query)
        pods_raw = data.get("myself", {}).get("pods", [])

        # Filter by status if specified
        if status:
            status_upper = status.upper()
            pods_raw = [p for p in pods_raw if p.get("desiredStatus", "").upper() == status_upper]

        # Apply pagination
        pods_raw = pods_raw[offset:offset + limit]

        # Transform to standardized format
        pods = []
        for pod in pods_raw:
            ssh_connection = None
            runtime = pod.get("runtime", {})
            if runtime:
                ports = runtime.get("ports", [])
                for port in ports:
                    if port.get("privatePort") == 22 and port.get("isIpPublic"):
                        ip = port.get("ip")
                        public_port = port.get("publicPort")
                        ssh_connection = f"ssh root@{ip} -p {public_port}"
                        break

            pods.append({
                "id": pod.get("id"),
                "name": pod.get("name"),
                "status": self._normalize_status(pod.get("desiredStatus", "PENDING")),
                "gpuName": pod.get("machine", {}).get("gpuDisplayName", ""),
                "gpuCount": pod.get("gpuCount", 1),
                "priceHr": pod.get("costPerHr", 0),
                "sshConnection": ssh_connection,
                "ip": None,
                "createdAt": datetime.utcnow().isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
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
        """Get details for a specific RunPod pod."""
        query = """
        query Pod($podId: String!) {
            pod(input: {podId: $podId}) {
                id
                name
                desiredStatus
                imageName
                gpuCount
                costPerHr
                machineId
                machine {
                    gpuDisplayName
                }
                runtime {
                    uptimeInSeconds
                    ports {
                        ip
                        isIpPublic
                        privatePort
                        publicPort
                        type
                    }
                }
            }
        }
        """

        data = await self._graphql_request(query, {"podId": pod_id})
        pod = data.get("pod")

        if not pod:
            raise HTTPException(status_code=404, detail=f"Pod {pod_id} not found")

        # Extract SSH connection
        ssh_connection = None
        runtime = pod.get("runtime", {})
        if runtime:
            ports = runtime.get("ports", [])
            for port in ports:
                if port.get("privatePort") == 22 and port.get("isIpPublic"):
                    ip = port.get("ip")
                    public_port = port.get("publicPort")
                    ssh_connection = f"ssh root@{ip} -p {public_port}"
                    break

        now = datetime.utcnow()
        return PodResponse(
            id=pod.get("id", ""),
            userId="",
            teamId=None,
            name=pod.get("name", ""),
            status=self._normalize_status(pod.get("desiredStatus", "PENDING")),
            gpuName=pod.get("machine", {}).get("gpuDisplayName", ""),
            gpuCount=pod.get("gpuCount", 1),
            priceHr=pod.get("costPerHr", 0),
            sshConnection=ssh_connection,
            ip=None,
            createdAt=now,
            updatedAt=now
        )

    async def delete_pod(self, pod_id: str) -> dict[str, Any]:
        """Delete/terminate a RunPod pod."""
        mutation = """
        mutation TerminatePod($podId: String!) {
            podTerminate(input: {podId: $podId})
        }
        """

        await self._graphql_request(mutation, {"podId": pod_id})
        return {"success": True, "pod_id": pod_id, "provider": self.PROVIDER_NAME}

    async def stop_pod(self, pod_id: str) -> dict[str, Any]:
        """Stop a RunPod pod (without deleting)."""
        mutation = """
        mutation StopPod($podId: String!) {
            podStop(input: {podId: $podId})
        }
        """

        await self._graphql_request(mutation, {"podId": pod_id})
        return {"success": True, "pod_id": pod_id, "action": "stopped"}

    async def resume_pod(self, pod_id: str) -> dict[str, Any]:
        """Resume a stopped RunPod pod."""
        mutation = """
        mutation ResumePod($podId: String!) {
            podResume(input: {podId: $podId}) {
                id
                desiredStatus
            }
        }
        """

        data = await self._graphql_request(mutation, {"podId": pod_id})
        return {
            "success": True,
            "pod_id": pod_id,
            "status": data.get("podResume", {}).get("desiredStatus", "RUNNING")
        }

    def _normalize_status(self, runpod_status: str) -> str:
        """Convert RunPod status to normalized status."""
        status_map = {
            "RUNNING": "ACTIVE",
            "PENDING": "PENDING",
            "EXITED": "TERMINATED",
            "STOPPED": "STOPPED",
            "STOPPING": "STOPPING",
            "STARTING": "STARTING",
            "TERMINATING": "TERMINATING",
            "TERMINATED": "TERMINATED",
            "ERROR": "ERROR"
        }
        return status_map.get(runpod_status.upper(), runpod_status)

    def normalize_pod(self, pod_data: dict[str, Any]) -> NormalizedPod:
        """Convert RunPod pod data to normalized format."""
        ssh_connection = None
        runtime = pod_data.get("runtime", {})
        if runtime:
            ports = runtime.get("ports", [])
            for port in ports:
                if port.get("privatePort") == 22 and port.get("isIpPublic"):
                    ip = port.get("ip")
                    public_port = port.get("publicPort")
                    ssh_connection = f"ssh root@{ip} -p {public_port}"
                    break

        return NormalizedPod(
            id=pod_data.get("id", ""),
            name=pod_data.get("name", ""),
            status=self._normalize_status(pod_data.get("desiredStatus", "PENDING")),
            gpu_name=pod_data.get("machine", {}).get("gpuDisplayName", ""),
            gpu_count=pod_data.get("gpuCount", 1),
            price_hr=pod_data.get("costPerHr", 0.0),
            ssh_connection=ssh_connection,
            ip=None,
            provider=self.PROVIDER_NAME,
            created_at=datetime.utcnow().isoformat(),
            updated_at=datetime.utcnow().isoformat()
        )
