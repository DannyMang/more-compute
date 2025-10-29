"""Typed models for API requests and responses."""

from pydantic import BaseModel
from datetime import datetime


class ApiKeyRequest(BaseModel):
    """Request model for setting API key."""
    api_key: str


class ApiKeyResponse(BaseModel):
    """Response model for API key configuration."""
    configured: bool
    message: str | None = None


class ConfigStatusResponse(BaseModel):
    """Response model for configuration status."""
    configured: bool


class DatasetInfoRequest(BaseModel):
    """Request model for dataset info."""
    name: str
    config: str | None = None


class DatasetCheckRequest(BaseModel):
    """Request model for checking dataset load."""
    name: str
    config: str | None = None
    split: str | None = None
    auto_stream_threshold_gb: float = 10.0


class DatasetDiskRequest(BaseModel):
    """Request model for creating dataset disk."""
    pod_id: str
    disk_name: str
    size_gb: int
    provider_type: str = "runpod"


class PackageInfo(BaseModel):
    """Model for installed package information."""
    name: str
    version: str


class PackagesResponse(BaseModel):
    """Response model for package list."""
    packages: list[PackageInfo]


class EnvironmentInfo(BaseModel):
    """Model for Python environment information."""
    name: str
    path: str
    version: str
    is_current: bool


class EnvironmentsResponse(BaseModel):
    """Response model for environment list."""
    status: str
    environments: list[EnvironmentInfo]
    current: EnvironmentInfo | None


class FileItem(BaseModel):
    """Model for file/directory item."""
    name: str
    path: str
    type: str
    size: int | None = None
    modified: str | None = None


class FileTreeResponse(BaseModel):
    """Response model for file tree listing."""
    root: str
    path: str
    items: list[FileItem]


# ============================================================================
# Prime Intellect GPU API Models
# ============================================================================

class EnvVar(BaseModel):
    """Environment variable for pod configuration."""
    key: str
    value: str


class PodConfig(BaseModel):
    """Configuration for creating a GPU pod."""
    # Required fields
    name: str
    cloudId: str
    gpuType: str
    socket: str
    gpuCount: int = 1

    # Optional fields
    diskSize: int | None = None
    vcpus: int | None = None
    memory: int | None = None
    maxPrice: float | None = None
    image: str | None = None
    customTemplateId: str | None = None
    dataCenterId: str | None = None
    country: str | None = None
    security: str | None = None
    envVars: list[EnvVar] | None = None
    jupyterPassword: str | None = None
    autoRestart: bool | None = None


class ProviderConfig(BaseModel):
    """Cloud provider configuration."""
    type: str = "runpod"


class TeamConfig(BaseModel):
    """Team configuration for shared resources."""
    teamId: str | None = None


class CreatePodRequest(BaseModel):
    """Request to create a new GPU pod."""
    pod: PodConfig
    provider: ProviderConfig
    team: TeamConfig | None = None


class DiskConfig(BaseModel):
    """Configuration for creating a persistent disk."""
    name: str
    size: int  # Size in GB
    cloudId: str | None = None
    dataCenterId: str | None = None
    country: str | None = None


class CreateDiskRequest(BaseModel):
    """Request to create a new disk."""
    disk: DiskConfig
    provider: ProviderConfig
    team: TeamConfig | None = None


class DiskResponse(BaseModel):
    """Response with disk information."""
    id: str
    name: str
    remoteId: str
    providerType: str
    status: str
    size: int
    createdAt: datetime
    updatedAt: datetime
    terminatedAt: datetime | None
    priceHr: float | None
    stoppedPriceHr: float | None
    provisioningPriceHr: float | None
    userId: str | None
    teamId: str | None
    walletId: str | None
    pods: list[str]
    clusters: list[str]
    info: dict[str, object] | None


class PodResponse(BaseModel):
    """Response with GPU pod information."""
    id: str
    userId: str
    teamId: str | None
    name: str
    status: str
    gpuName: str
    gpuCount: int
    priceHr: float
    sshConnection: str | None
    ip: str | None
    createdAt: datetime
    updatedAt: datetime


class AvailabilityQuery(BaseModel):
    """Query parameters for GPU availability."""
    regions: list[str] | None = None
    gpu_count: int | None = None
    gpu_type: str | None = None
    security: str | None = None
