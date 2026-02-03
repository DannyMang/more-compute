"""Factory and registry for GPU cloud providers."""

from typing import Type
from .base_provider import BaseGPUProvider, ProviderInfo, ProviderType
from ...utils.config_util import load_api_key, save_api_key, _load_config, _save_config


# Registry of provider classes
_PROVIDER_REGISTRY: dict[str, Type[BaseGPUProvider]] = {}

# Cached provider instances
_PROVIDER_INSTANCES: dict[str, BaseGPUProvider] = {}


def register_provider(provider_class: Type[BaseGPUProvider]) -> Type[BaseGPUProvider]:
    """Decorator to register a provider class.

    Usage:
        @register_provider
        class MyProvider(BaseGPUProvider):
            PROVIDER_NAME = "my_provider"
            ...
    """
    name = provider_class.PROVIDER_NAME
    if not name:
        raise ValueError(f"Provider class {provider_class.__name__} must define PROVIDER_NAME")
    _PROVIDER_REGISTRY[name] = provider_class
    return provider_class


def get_provider_class(provider_name: str) -> Type[BaseGPUProvider] | None:
    """Get a registered provider class by name.

    Args:
        provider_name: The provider identifier (e.g., "runpod")

    Returns:
        Provider class or None if not found
    """
    return _PROVIDER_REGISTRY.get(provider_name)


def get_provider(provider_name: str, force_new: bool = False) -> BaseGPUProvider | None:
    """Get a provider instance, creating it if necessary.

    Args:
        provider_name: The provider identifier (e.g., "runpod")
        force_new: If True, create a new instance even if one is cached

    Returns:
        Provider instance or None if provider not found
    """
    if not force_new and provider_name in _PROVIDER_INSTANCES:
        return _PROVIDER_INSTANCES[provider_name]

    provider_class = get_provider_class(provider_name)
    if not provider_class:
        return None

    # Load API key for this provider
    api_key = load_api_key(provider_class.API_KEY_ENV_NAME)

    # Create instance
    instance = provider_class(api_key=api_key)
    _PROVIDER_INSTANCES[provider_name] = instance
    return instance


def refresh_provider(provider_name: str) -> BaseGPUProvider | None:
    """Refresh a provider instance (e.g., after API key update).

    Args:
        provider_name: The provider identifier

    Returns:
        New provider instance or None if provider not found
    """
    # Clear cached instance
    if provider_name in _PROVIDER_INSTANCES:
        del _PROVIDER_INSTANCES[provider_name]
    return get_provider(provider_name, force_new=True)


def list_providers() -> list[ProviderInfo]:
    """List all registered providers with their configuration status.

    Returns:
        List of ProviderInfo for all registered providers
    """
    active_provider = get_active_provider_name()
    providers = []

    for name, provider_class in _PROVIDER_REGISTRY.items():
        api_key = load_api_key(provider_class.API_KEY_ENV_NAME)
        info = ProviderInfo(
            name=name,
            display_name=provider_class.PROVIDER_DISPLAY_NAME,
            api_key_env_name=provider_class.API_KEY_ENV_NAME,
            supports_ssh=provider_class.SUPPORTS_SSH,
            dashboard_url=provider_class.DASHBOARD_URL,
            configured=api_key is not None and len(api_key.strip()) > 0,
            is_active=(name == active_provider)
        )
        providers.append(info)

    # Sort by display name for consistent ordering
    providers.sort(key=lambda p: p.display_name)
    return providers


def get_configured_providers() -> list[ProviderInfo]:
    """Get list of providers that have API keys configured.

    Returns:
        List of ProviderInfo for configured providers only
    """
    return [p for p in list_providers() if p.configured]


def get_active_provider_name() -> str | None:
    """Get the name of the currently active provider.

    Returns:
        Provider name or None if not set
    """
    config = _load_config()
    return config.get("active_provider")


def set_active_provider(provider_name: str) -> bool:
    """Set the active provider.

    Args:
        provider_name: The provider to make active

    Returns:
        True if successful, False if provider not found or not configured
    """
    if provider_name not in _PROVIDER_REGISTRY:
        return False

    provider_class = _PROVIDER_REGISTRY[provider_name]
    api_key = load_api_key(provider_class.API_KEY_ENV_NAME)

    if not api_key:
        return False

    config = _load_config()
    config["active_provider"] = provider_name
    _save_config(config)
    return True


def get_active_provider() -> BaseGPUProvider | None:
    """Get the currently active provider instance.

    Returns:
        Active provider instance or None if not set
    """
    active_name = get_active_provider_name()
    if not active_name:
        return None
    return get_provider(active_name)


def configure_provider(provider_name: str, api_key: str, make_active: bool = False) -> bool:
    """Configure a provider with an API key.

    Args:
        provider_name: The provider to configure
        api_key: The API key to save
        make_active: If True, also make this the active provider

    Returns:
        True if successful, False if provider not found
    """
    if provider_name not in _PROVIDER_REGISTRY:
        return False

    provider_class = _PROVIDER_REGISTRY[provider_name]
    save_api_key(provider_class.API_KEY_ENV_NAME, api_key)

    # Refresh the provider instance
    refresh_provider(provider_name)

    if make_active:
        set_active_provider(provider_name)

    return True


def clear_all_providers() -> None:
    """Clear all cached provider instances. Useful for testing."""
    _PROVIDER_INSTANCES.clear()
