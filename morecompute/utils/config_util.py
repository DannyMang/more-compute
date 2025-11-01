"""Configuration utilities for managing API keys and environment variables."""

from pathlib import Path
from typing import Optional
import os
import json


# Global config directory in user's home
CONFIG_DIR = Path.home() / ".morecompute"
CONFIG_FILE = CONFIG_DIR / "config.json"


def _ensure_config_dir() -> None:
    """Ensure the config directory exists."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


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
    """Save config to JSON file."""
    _ensure_config_dir()
    with CONFIG_FILE.open("w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)


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
