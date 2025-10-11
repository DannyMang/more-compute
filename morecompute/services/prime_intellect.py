import httpx
from fastapi import HTTPException

from ..models.api_models import (
    CreatePodRequest,
    CreateDiskRequest,
    PodResponse,
    DiskResponse,
)

# Helper methods for https://docs.primeintellect.ai/api-reference/


class PrimeIntellectService:
    """ service to collect pi stuff"""
    def __init__(self, api_key : str, base_url: str = "https://api.primeintellect.ai/api/v1"):
        self.api_key = api_key
        self.base_url = base_url
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

    async def _make_request(
            self,
            method: str,
            endpoint: str,
            params: dict[str, str | int | float | list[str]] | None = None,
            json_data: dict[str, object] | None = None
        ) -> dict[str, object]:
            """Internal method to make HTTP requests with error handling."""
            url = f"{self.base_url}{endpoint}"

            async with httpx.AsyncClient() as client:
                try:
                    response = await client.request(
                        method=method,
                        url=url,
                        headers=self.headers,
                        params=params,
                        json=json_data,
                        timeout=30.0
                    )
                    response.raise_for_status()
                    return response.json()
                except httpx.HTTPStatusError as e:
                    raise HTTPException(
                        status_code=e.response.status_code,
                        detail=f"Prime Intellect API error: {e.response.text}"
                    )
                except httpx.RequestError as e:
                    raise HTTPException(
                        status_code=503,
                        detail=f"Connection error: {str(e)}"
                    )


    async def get_gpu_availability(
        self,
        regions: list[str] | None = None,
        gpu_count: int | None = None,
        gpu_type: str | None = None,
        security: str | None = None
    ) -> dict[str, object]:
        """
        Get available GPU resources with pricing and specifications

        Args:
            regions,
            gpu_count,
            gpu_type (e.g H100, A100..)
            security: secure cloud or community cloud\

        Returns:
            Dict containing available gpus given the parameters.
        """
        params: dict[str, str | int | float | list[str]] = {}

        if regions is not None:
            params["regions"] = regions
        if gpu_count is not None:
            params["gpu_count"] = gpu_count
        if gpu_type is not None:
            params["gpu_type"] = gpu_type
        if security is not None:
            params["security"] = security
        return await self._make_request("GET", "/availability/", params=params)


    async def get_cluster(self) -> dict[str, object]:
        """
        Get availabile multi-node cluster configs
        """
        return await self._make_request("GET", "/cluster-availability")

    async def create_pod(self, pod_request: CreatePodRequest) -> PodResponse:
        """
        Create a new pod
        """
        import sys
        payload = pod_request.model_dump(exclude_none=True)
        print(f"[PI SERVICE] Creating pod with payload: {payload}", file=sys.stderr, flush=True)

        response = await self._make_request(
            "POST",
            "/pods/",
            json_data=payload
        )
        return PodResponse.model_validate(response)


    async def get_pods(
        self,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0
    ) -> dict[str, object]:

        """
        Get list of all pods that user has pulled

        Args:
            status: Filter by status (running, stopped, etc)
            limit: max # of results
            offset: pagination offset

        returns:
            dict with list of pods
        """
        params: dict[str, str | int | float | list[str]] = {"limit": limit, "offset": offset}
        if status is not None:
            params['status'] = status

        return await self._make_request("GET", "/pods/", params=params)

    async def get_pod(self, pod_id: str) -> PodResponse:
        """
        for searching up a pod via pod_id

        Args:
            pod_id: the pod identifier

        Returns:
            PodResponse with pod Information
        """
        response = await self._make_request("GET", f"/pods/{pod_id}")
        return PodResponse.model_validate(response)

    async def get_pod_status(self, pod_ids: list[str]) -> dict[str, object]:
        """
        for searching up pod status via pod_id

        Args:
            pod_ids: list of specific pod IDs to check

        Returns:
            Dict with status information for requested pods
        """
        params = {}
        if pod_ids:
            params['pod_ids'] = pod_ids

        return await self._make_request("GET", "/pods/status", params=params)


    async def get_pods_history(
            self,
            limit: int = 100,
            offset: int = 0
        ) -> dict[str, object]:
            """
            Get historical data for terminated pods.

            Args:
                limit: Maximum number of results
                offset: Pagination offset

            Returns:
                Dict with historical pod data
            """
            params: dict[str, str | int | float | list[str]] = {"limit": limit, "offset": offset}
            return await self._make_request("GET", "/pods/history", params=params)

    async def delete_pod(self, pod_id: str) -> dict[str, object]:
        """
        delete a pod

        args:
            pod_id: the pod identifier

        returns:
            Dict with deletion confirmation
        """
        return await self._make_request("DELETE", f"/pods/{pod_id}")

    async def get_pod_logs(self, pod_id: str) -> dict[str, object]:
        """
        Retrieve logs for a specific pod.

        Args:
            pod_id: The pod identifier

        Returns:
            Dict containing pod logs
        """
        return await self._make_request("GET", f"/pods/{pod_id}/logs")

    async def add_metrics(self, pod_id: str, metrics: dict[str, object]) -> dict[str, object]:
        """
        Add custom metrics for a pod.

        Args:
            pod_id: The pod identifier
            metrics: Dictionary of metric data

        Returns:
            Dict with confirmation
        """
        return await self._make_request("POST", f"/pods/{pod_id}/metrics", json_data=metrics)

    async def get_ssh_keys(self) -> dict[str, object]:
        """Get list of all SSH keys."""
        return await self._make_request("GET", "/ssh-keys/")

    async def upload_ssh_key(self, name: str, public_key: str) -> dict[str, object]:
        """
        Upload a new SSH public key.

        Args:
            name: Name for the SSH key
            public_key: The SSH public key content

        Returns:
            Dict with key information
        """
        data: dict[str, object] = {"name": name, "publicKey": public_key}
        return await self._make_request("POST", "/ssh-keys/", json_data=data)

    async def delete_ssh_key(self, key_id: str) -> dict[str, object]:
        """
        Delete an SSH key.

        Args:
            key_id: The SSH key identifier

        Returns:
            Dict with deletion confirmation
        """
        return await self._make_request("DELETE", f"/ssh-keys/{key_id}")

    async def set_primary_ssh_key(self, key_id: str) -> dict[str, object]:
        """
        Set an SSH key as primary.

        Args:
            key_id: The SSH key identifier

        Returns:
            Dict with confirmation
        """
        return await self._make_request("PATCH", f"/ssh-keys/{key_id}/primary")


    async def get_disks(
        self,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, object]:
        """
        Get list of all disks

        args:
            limit : max number of results (default : 100)
            offset : for Pagination

        returns:
            dict with:
                - data: list of disk objects
                - total_count : total number of disks
                - offset : current offset
                - limit: current limit
        """
        params : dict[str, str | int | float | list[str]] = {"limit":limit, "offset":offset}
        return await self._make_request("GET", "/disks/", params=params)

    async def create_disks(self, disk_request :CreateDiskRequest) -> DiskResponse:
        """
        Create new persistent disk

        Args:
            disk_reqeust: disk configuration request

        Returns:
            Disk response with disk details

        """
        import sys
        payload = disk_request.model_dump(exclude_none=True)
        print(f"[PI SERVICE] Creating disk with payload: + {payload}", file=sys.stderr, flush=True)
        response = await self._make_request("POST", "/disks/", json_data=payload)
        return DiskResponse.model_validate(response)

    async def get_disk(self, disk_id:str) -> DiskResponse:
        """
        Get details of specific disk

        args:
            disk_id: disk identifier

        returns:
            DiskResponse
        """
        response = await self._make_request("GET", f"/disks/{disk_id}")
        return DiskResponse.model_validate(response)

    async def update_disk(self, disk_id:str, name:str) -> dict[str,object]:
        """
        update disk name

        args:
            disk_id: disk identifier
            name: new name of disk

        returns:
            dict with update confirmation
        """
        data: dict[str, object] = {"name":name}
        return await self._make_request("PATCH", f"/disks/{disk_id}", json_data=data)

    async def delete_disk(self, disk_id: str) -> dict[str, object]:
        """
        Delete a disk.

        Args:
            disk_id: The disk identifier

        Returns:
            Dict with deletion confirmation
        """
        return await self._make_request("DELETE", f"/disks/{disk_id}")
