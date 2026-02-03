"""GPU cloud provider implementations.

This module provides a unified interface for multiple GPU cloud providers:
- RunPod (GraphQL API, SSH support)
- Lambda Labs (REST API, SSH support)
- Vast.ai (REST API, community GPUs, SSH support)
- Prime Intellect (REST API, SSH support) - original provider

All providers support SSH tunneling for remote code execution.

Usage:
    from morecompute.services.providers import (
        get_provider,
        list_providers,
        configure_provider,
        get_active_provider
    )

    # List all available providers
    providers = list_providers()

    # Configure a provider with API key
    configure_provider("runpod", "your-api-key", make_active=True)

    # Get the active provider instance
    provider = get_active_provider()

    # Get GPU availability
    gpus = await provider.get_gpu_availability(gpu_type="H100")

    # Create a pod
    pod = await provider.create_pod(request)
"""

# Base classes
from .base_provider import (
    BaseGPUProvider,
    ProviderInfo,
    ProviderType,
    GpuAvailability,
    NormalizedPod,
)

# Factory functions
from .provider_factory import (
    register_provider,
    get_provider_class,
    get_provider,
    refresh_provider,
    list_providers,
    get_configured_providers,
    get_active_provider_name,
    set_active_provider,
    get_active_provider,
    configure_provider,
    clear_all_providers,
)

# Import provider implementations to trigger registration
from . import runpod_provider
from . import lambda_labs_provider
from . import vastai_provider

# Export provider classes for direct access if needed
from .runpod_provider import RunPodProvider
from .lambda_labs_provider import LambdaLabsProvider
from .vastai_provider import VastAIProvider

__all__ = [
    # Base classes
    "BaseGPUProvider",
    "ProviderInfo",
    "ProviderType",
    "GpuAvailability",
    "NormalizedPod",
    # Factory functions
    "register_provider",
    "get_provider_class",
    "get_provider",
    "refresh_provider",
    "list_providers",
    "get_configured_providers",
    "get_active_provider_name",
    "set_active_provider",
    "get_active_provider",
    "configure_provider",
    "clear_all_providers",
    # Provider classes
    "RunPodProvider",
    "LambdaLabsProvider",
    "VastAIProvider",
]
