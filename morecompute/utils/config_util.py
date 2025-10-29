"""Configuration utilities for managing API keys and environment variables."""

from pathlib import Path
import os


def load_api_key_from_env(env_var: str, env_file_path: Path | None = None) -> str | None:
    """
    Load API key from environment variable or .env file.

    Args:
        env_var: Environment variable name to check
        env_file_path: Path to .env file (optional)

    Returns:
        API key string or None if not found
    """
    api_key = os.getenv(env_var)
    if api_key:
        return api_key

    if env_file_path and env_file_path.exists():
        try:
            with env_file_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith(f"{env_var}="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass

    return None


def save_api_key_to_env(env_var: str, api_key: str, env_file_path: Path) -> None:
    """
    Save API key to .env file, replacing existing value if present.

    Args:
        env_var: Environment variable name
        api_key: API key value to save
        env_file_path: Path to .env file

    Raises:
        ValueError: If API key is empty
        IOError: If file cannot be written
    """
    if not api_key.strip():
        raise ValueError("API key cannot be empty")

    existing_lines = []
    if env_file_path.exists():
        with env_file_path.open("r", encoding="utf-8") as f:
            existing_lines = f.readlines()

    new_lines = [line for line in existing_lines if not line.strip().startswith(f"{env_var}=")]
    new_lines.append(f"{env_var}={api_key}\n")
    with env_file_path.open("w", encoding="utf-8") as f:
        f.writelines(new_lines)
