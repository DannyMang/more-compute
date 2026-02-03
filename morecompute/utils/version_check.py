"""
Version checking utility - notifies users when a newer version is available.
"""

import json
import time
from pathlib import Path
from typing import Optional, Tuple

# Check at most once per day
CHECK_INTERVAL_SECONDS = 86400  # 24 hours
CACHE_FILE = Path.home() / ".cache" / "morecompute" / "version_check.json"
PYPI_URL = "https://pypi.org/pypi/more-compute/json"


def _get_cache() -> dict:
    """Read the version check cache."""
    try:
        if CACHE_FILE.exists():
            return json.loads(CACHE_FILE.read_text())
    except Exception:
        pass
    return {}


def _save_cache(data: dict) -> None:
    """Save the version check cache."""
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(data))
    except Exception:
        pass  # Don't fail if we can't cache


def _parse_version(version: str) -> Tuple[int, ...]:
    """Parse version string into tuple for comparison."""
    try:
        # Handle versions like "0.4.4" or "0.4.4.post1"
        parts = version.split(".")
        return tuple(int(p.split("-")[0].split("a")[0].split("b")[0].split("post")[0]) 
                     for p in parts[:3])
    except Exception:
        return (0, 0, 0)


def _fetch_latest_version() -> Optional[str]:
    """Fetch the latest version from PyPI."""
    try:
        import urllib.request
        import json as json_module
        
        request = urllib.request.Request(
            PYPI_URL,
            headers={"Accept": "application/json"}
        )
        with urllib.request.urlopen(request, timeout=3.0) as response:
            data = json_module.loads(response.read().decode())
            return data.get("info", {}).get("version")
    except Exception:
        pass  # Network errors are fine, just skip the check
    return None


def check_for_updates(current_version: str, force: bool = False) -> Optional[str]:
    """
    Check if a newer version is available on PyPI.
    
    Args:
        current_version: The currently installed version
        force: If True, bypass the cache and check immediately
        
    Returns:
        A message string if an update is available, None otherwise
    """
    cache = _get_cache()
    now = time.time()
    
    # Check if we should skip (already checked recently)
    if not force:
        last_check = cache.get("last_check", 0)
        if now - last_check < CHECK_INTERVAL_SECONDS:
            # Use cached result
            latest = cache.get("latest_version")
            if latest and _parse_version(latest) > _parse_version(current_version):
                return _format_update_message(current_version, latest)
            return None
    
    # Fetch from PyPI
    latest = _fetch_latest_version()
    
    # Update cache
    cache["last_check"] = now
    if latest:
        cache["latest_version"] = latest
    _save_cache(cache)
    
    # Compare versions
    if latest and _parse_version(latest) > _parse_version(current_version):
        return _format_update_message(current_version, latest)
    
    return None


def _format_update_message(current: str, latest: str) -> str:
    """Format the update notification message."""
    return f"""
╭─────────────────────────────────────────────────────────────╮
│  A new version of MoreCompute is available: {latest:>6}          │
│  You are currently running: {current:>6}                         │
│                                                             │
│  To update, run:                                            │
│    pip install --upgrade more-compute                       │
│                                                             │
│  Or with uv:                                                │
│    uv tool upgrade more-compute                             │
╰─────────────────────────────────────────────────────────────╯
"""
