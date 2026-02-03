"""Configuration utilities for managing API keys and environment variables."""

from pathlib import Path
from typing import Optional
import os
import json


# Global config directory in user's home
CONFIG_DIR = Path.home() / ".morecompute"
CONFIG_FILE = CONFIG_DIR / "config.json"


def _ensure_config_dir() -> None:
    """Ensure the config directory exists with secure permissions."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)


def _load_config() -> dict:
    """Load config from JSON file."""
    if not CONFIG_FILE.exists():
        return {}
    try:
        with CONFIG_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {}


def _save_config(config: dict) -> None:
    """Save config to JSON file with secure permissions."""
    _ensure_config_dir()
    with CONFIG_FILE.open("w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    # Set secure file permissions (owner read/write only)
    CONFIG_FILE.chmod(0o600)


def load_api_key(key_name: str) -> Optional[str]:
    """
    Load API key from user config directory (~/.morecompute/config.json).
    Falls back to environment variable if not found in config.

    Args:
        key_name: Key name (e.g., "PRIME_INTELLECT_API_KEY")

    Returns:
        API key string or None if not found
    """
    # Check environment variable first
    env_key = os.getenv(key_name)
    if env_key:
        return env_key

    # Check config file
    config = _load_config()
    return config.get(key_name)


def save_api_key(key_name: str, api_key: str) -> None:
    """
    Save API key to user config directory (~/.morecompute/config.json).

    Args:
        key_name: Key name (e.g., "PRIME_INTELLECT_API_KEY")
        api_key: API key value to save

    Raises:
        ValueError: If API key is empty
        IOError: If file cannot be written
    """
    if not api_key.strip():
        raise ValueError("API key cannot be empty")

    config = _load_config()
    config[key_name] = api_key
    _save_config(config)


def delete_api_key(key_name: str) -> bool:
    """
    Delete an API key from config.

    Args:
        key_name: Key name to delete

    Returns:
        True if key was deleted, False if it didn't exist
    """
    config = _load_config()
    if key_name in config:
        del config[key_name]
        _save_config(config)
        return True
    return False


def get_active_provider() -> Optional[str]:
    """
    Get the currently active provider name.

    Returns:
        Provider name or None if not set
    """
    config = _load_config()
    return config.get("active_provider")


def set_active_provider(provider_name: str) -> None:
    """
    Set the active provider.

    Args:
        provider_name: The provider to make active
    """
    config = _load_config()
    config["active_provider"] = provider_name
    _save_config(config)


def get_all_configured_keys() -> dict[str, bool]:
    """
    Get a mapping of all API key names to whether they are configured.

    Returns:
        Dict mapping key names to True/False
    """
    config = _load_config()

    # Known provider API key names (SSH-based providers only)
    key_names = [
        "RUNPOD_API_KEY",
        "LAMBDA_LABS_API_KEY",
        "VASTAI_API_KEY",
    ]

    result = {}
    for key_name in key_names:
        # Check environment first, then config
        env_val = os.getenv(key_name)
        config_val = config.get(key_name)
        result[key_name] = bool(env_val or config_val)

    return result


def get_provider_api_keys(provider_name: str) -> dict[str, Optional[str]]:
    """
    Get all API keys needed for a specific provider.

    Args:
        provider_name: Provider name (e.g., "runpod", "modal")

    Returns:
        Dict mapping key names to their values (or None if not set)
    """
    # Provider to key name mappings (SSH-based providers only)
    provider_keys = {
        "runpod": ["RUNPOD_API_KEY"],
        "lambda_labs": ["LAMBDA_LABS_API_KEY"],
        "vastai": ["VASTAI_API_KEY"],
    }

    key_names = provider_keys.get(provider_name, [])
    return {key: load_api_key(key) for key in key_names}
