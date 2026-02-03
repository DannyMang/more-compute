"""Abstract base class for GPU cloud providers."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any
import httpx
from fastapi import HTTPException

from ...models.api_models import PodResponse


class ProviderType(str, Enum):
    """Supported GPU cloud providers."""
    PRIME_INTELLECT = "prime_intellect"
    RUNPOD = "runpod"
    MODAL = "modal"
    LAMBDA_LABS = "lambda_labs"
    VASTAI = "vastai"


@dataclass
class ProviderInfo:
    """Information about a GPU provider."""
    name: str  # Internal name (e.g., "runpod")
    display_name: str  # Human-readable name (e.g., "RunPod")
    api_key_env_name: str  # Environment variable name (e.g., "RUNPOD_API_KEY")
    supports_ssh: bool  # Whether provider supports SSH connections
    dashboard_url: str  # URL to get API key
    configured: bool = False  # Whether API key is configured
    is_active: bool = False  # Whether this is the currently active provider


@dataclass
class GpuAvailability:
    """Normalized GPU availability information."""
    gpu_type: str
    gpu_name: str
    gpu_count: int
    price_hr: float
    cloud_id: str
    socket: str
    region: str | None = None
    security: str | None = None
    vcpus: int | None = None
    memory: int | None = None
    disk_size: int | None = None
    available: bool = True


@dataclass
class NormalizedPod:
    """Normalized pod information across providers."""
    id: str
    name: str
    status: str
    gpu_name: str
    gpu_count: int
    price_hr: float
    ssh_connection: str | None
    ip: str | None
    provider: str
    created_at: str
    updated_at: str
    user_id: str | None = None
    team_id: str | None = None


class BaseGPUProvider(ABC):
    """Abstract base class for GPU cloud providers.

    All provider implementations must extend this class and implement
    the abstract methods to provide a consistent interface.
    """

    # Class attributes to be defined by subclasses
    PROVIDER_NAME: str = ""  # e.g., "runpod"
    PROVIDER_DISPLAY_NAME: str = ""  # e.g., "RunPod"
    API_KEY_ENV_NAME: str = ""  # e.g., "RUNPOD_API_KEY"
    SUPPORTS_SSH: bool = True  # False for Modal
    DASHBOARD_URL: str = ""  # URL to get API key

    def __init__(self, api_key: str | None = None):
        """Initialize the provider with optional API key.

        Args:
            api_key: The API key for authentication. If None, provider
                    will be in unconfigured state.
        """
        self.api_key = api_key
        self._client: httpx.AsyncClient | None = None

    @property
    def is_configured(self) -> bool:
        """Check if the provider has a valid API key configured."""
        return self.api_key is not None and len(self.api_key.strip()) > 0

    def get_info(self, is_active: bool = False) -> ProviderInfo:
        """Get provider information."""
        return ProviderInfo(
            name=self.PROVIDER_NAME,
            display_name=self.PROVIDER_DISPLAY_NAME,
            api_key_env_name=self.API_KEY_ENV_NAME,
            supports_ssh=self.SUPPORTS_SSH,
            dashboard_url=self.DASHBOARD_URL,
            configured=self.is_configured,
            is_active=is_active
        )

    async def _make_request(
        self,
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
        json_data: dict[str, Any] | None = None,
        timeout: float = 30.0
    ) -> dict[str, Any]:
        """Make an HTTP request with error handling.

        Args:
            method: HTTP method (GET, POST, DELETE, etc.)
            url: Full URL to request
            headers: Request headers (will be merged with auth headers)
            params: Query parameters
            json_data: JSON body data
            timeout: Request timeout in seconds

        Returns:
            Parsed JSON response

        Raises:
            HTTPException: On API or connection errors
        """
        request_headers = self._get_auth_headers()
        if headers:
            request_headers.update(headers)

        async with httpx.AsyncClient() as client:
            try:
                response = await client.request(
                    method=method,
                    url=url,
                    headers=request_headers,
                    params=params,
                    json=json_data,
                    timeout=timeout
                )
                response.raise_for_status()

                # Handle empty responses
                if response.status_code == 204 or not response.content:
                    return {}

                return response.json()
            except httpx.HTTPStatusError as e:
                # Sanitize error message - don't expose full API response to clients
                status_code = e.response.status_code
                if status_code == 401:
                    detail = f"{self.PROVIDER_DISPLAY_NAME} authentication failed. Please check your API key."
                elif status_code == 402:
                    detail = f"Insufficient funds in your {self.PROVIDER_DISPLAY_NAME} account."
                elif status_code == 403:
                    detail = f"Access denied. Please check your {self.PROVIDER_DISPLAY_NAME} permissions."
                elif status_code == 404:
                    detail = f"{self.PROVIDER_DISPLAY_NAME} resource not found."
                elif status_code >= 500:
                    detail = f"{self.PROVIDER_DISPLAY_NAME} service error. Please try again later."
                else:
                    detail = f"{self.PROVIDER_DISPLAY_NAME} API error (status {status_code})."
                raise HTTPException(status_code=status_code, detail=detail)
            except httpx.RequestError:
                raise HTTPException(
                    status_code=503,
                    detail=f"Unable to connect to {self.PROVIDER_DISPLAY_NAME}. Please check your internet connection."
                )

    @abstractmethod
    def _get_auth_headers(self) -> dict[str, str]:
        """Get authentication headers for API requests.

        Returns:
            Dictionary of headers to include in requests
        """
        pass

    @abstractmethod
    async def get_gpu_availability(
        self,
        regions: list[str] | None = None,
        gpu_count: int | None = None,
        gpu_type: str | None = None,
        **kwargs: Any
    ) -> dict[str, Any]:
        """Get available GPU resources with pricing.

        Args:
            regions: Filter by regions
            gpu_count: Filter by GPU count
            gpu_type: Filter by GPU type (e.g., "H100", "A100")
            **kwargs: Provider-specific filters

        Returns:
            Dict containing available GPUs with pricing
        """
        pass

    @abstractmethod
    async def create_pod(self, request: Any) -> PodResponse:
        """Create a new GPU pod/instance.

        Args:
            request: Pod creation request (provider-specific format)

        Returns:
            PodResponse with created pod information
        """
        pass

    @abstractmethod
    async def get_pods(
        self,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0
    ) -> dict[str, Any]:
        """Get list of all pods for the user.

        Args:
            status: Filter by status
            limit: Maximum number of results
            offset: Pagination offset

        Returns:
            Dict with list of pods
        """
        pass

    @abstractmethod
    async def get_pod(self, pod_id: str) -> PodResponse:
        """Get details for a specific pod.

        Args:
            pod_id: The pod identifier

        Returns:
            PodResponse with pod information
        """
        pass

    @abstractmethod
    async def delete_pod(self, pod_id: str) -> dict[str, Any]:
        """Delete/terminate a pod.

        Args:
            pod_id: The pod identifier

        Returns:
            Dict with deletion confirmation
        """
        pass

    async def get_pod_status(self, pod_ids: list[str]) -> dict[str, Any]:
        """Get status for multiple pods.

        Default implementation fetches each pod individually.
        Providers can override for more efficient batch operations.

        Args:
            pod_ids: List of pod identifiers

        Returns:
            Dict with status information for requested pods
        """
        statuses = {}
        for pod_id in pod_ids:
            try:
                pod = await self.get_pod(pod_id)
                statuses[pod_id] = pod.status
            except HTTPException:
                statuses[pod_id] = "unknown"
        return {"statuses": statuses}

    def normalize_pod(self, pod_data: dict[str, Any]) -> NormalizedPod:
        """Convert provider-specific pod data to normalized format.

        Args:
            pod_data: Raw pod data from provider API

        Returns:
            NormalizedPod instance
        """
        # Default implementation - subclasses should override
        return NormalizedPod(
            id=pod_data.get("id", ""),
            name=pod_data.get("name", ""),
            status=pod_data.get("status", "unknown"),
            gpu_name=pod_data.get("gpuName", pod_data.get("gpu_name", "")),
            gpu_count=pod_data.get("gpuCount", pod_data.get("gpu_count", 1)),
            price_hr=pod_data.get("priceHr", pod_data.get("price_hr", 0.0)),
            ssh_connection=pod_data.get("sshConnection", pod_data.get("ssh_connection")),
            ip=pod_data.get("ip"),
            provider=self.PROVIDER_NAME,
            created_at=str(pod_data.get("createdAt", pod_data.get("created_at", ""))),
            updated_at=str(pod_data.get("updatedAt", pod_data.get("updated_at", ""))),
            user_id=pod_data.get("userId", pod_data.get("user_id")),
            team_id=pod_data.get("teamId", pod_data.get("team_id"))
        )

    def get_ssh_connection_info(self, pod: PodResponse | NormalizedPod) -> dict[str, Any] | None:
        """Parse SSH connection information from pod.

        Args:
            pod: Pod response or normalized pod

        Returns:
            Dict with host, port, user, or None if not available
        """
        if not self.SUPPORTS_SSH:
            return None

        ssh_conn = getattr(pod, 'sshConnection', None) or getattr(pod, 'ssh_connection', None)
        if not ssh_conn:
            return None

        # Parse common SSH connection format: "ssh user@host -p port"
        # This is a default implementation; providers can override
        import re
        match = re.match(r'ssh\s+(\w+)@([\w.-]+)\s+-p\s+(\d+)', ssh_conn)
        if match:
            return {
                "user": match.group(1),
                "host": match.group(2),
                "port": int(match.group(3))
            }
        return {"raw": ssh_conn}
