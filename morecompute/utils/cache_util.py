import hashlib
import json


def make_cache_key(prefix: str, **params) -> str:
    """
    Create a cache key from parameters.

    Args:
        prefix: Cache key prefix (e.g., "gpu_avail", "pod_list")
        **params: Parameters to hash into the key

    Returns:
        Cache key string in format "prefix:hash"

    Example:
        >>> make_cache_key("gpu_avail", regions=["us"], gpu_type="H100")
        "gpu_avail:a3f2c1e8"
    """
    # Sort params for consistency: {a:1, b:2} == {b:2, a:1}
    param_str = json.dumps(params, sort_keys=True, default=str)
    hash_val = hashlib.md5(param_str.encode()).hexdigest()[:8]
    return f"{prefix}:{hash_val}"
