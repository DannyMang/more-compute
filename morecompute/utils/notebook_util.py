"""Notebook utility functions for cell processing."""


def coerce_cell_source(value):
    """
    Coerce various cell source formats to a string.

    Handles:
    - None → empty string
    - str → unchanged
    - bytes/bytearray → decoded to UTF-8
    - list → joined into single string

    Args:
        value: Cell source in various formats

    Returns:
        String representation of cell source
    """
    if value is None:
        return ''
    if isinstance(value, str):
        return value
    if isinstance(value, (bytes, bytearray)):
        try:
            return value.decode('utf-8')  # type: ignore[arg-type]
        except Exception:
            return value.decode('utf-8', errors='ignore')  # type: ignore[arg-type]
    if isinstance(value, list):
        parts = []
        for item in value:
            if item is None:
                continue
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, (bytes, bytearray)):
                try:
                    parts.append(item.decode('utf-8'))  # type: ignore[arg-type]
                except Exception:
                    parts.append(item.decode('utf-8', errors='ignore'))  # type: ignore[arg-type]
            else:
                parts.append(str(item))
        return ''.join(parts)
    return str(value)
