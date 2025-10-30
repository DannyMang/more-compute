"""
Shared utilities for shell command execution.
Used by both special_commands.py and cell_magics.py to avoid duplication.
"""
import os
import shlex
import platform
from typing import List, Dict


def prepare_shell_command(cmd: str) -> List[str]:
    """
    Convert shell command to subprocess-compatible format.
    Handles pip routing, python unbuffering, and platform-specific shells.

    Args:
        cmd: Shell command string (e.g., "pip install pandas")

    Returns:
        List of command arguments for subprocess
    """
    if cmd.startswith('pip '):
        # Route pip through Python module for better control
        parts = ['python', '-m'] + shlex.split(cmd)
        # Add progress bar control for pip
        if 'install' in cmd and '--progress-bar' not in cmd:
            parts.extend(['--progress-bar', 'off'])
        return parts

    elif cmd.startswith('python '):
        # Add unbuffered flag to python commands
        parts = shlex.split(cmd)
        parts.insert(1, '-u')  # Add -u after 'python'
        return parts

    else:
        # For other shell commands, use platform-appropriate shell
        system = platform.system()
        if system == 'Windows':
            return ['cmd', '/c', cmd]
        elif system == 'Darwin':
            return ['/bin/bash', '-c', cmd]
        else:
            return ['/bin/bash', '-c', cmd]


def prepare_shell_environment(cmd: str) -> Dict[str, str]:
    """
    Prepare environment variables for shell command execution.

    Args:
        cmd: Shell command string

    Returns:
        Environment dictionary
    """
    env = os.environ.copy()

    # Always set unbuffered Python
    env['PYTHONUNBUFFERED'] = '1'
    env['PYTHONDONTWRITEBYTECODE'] = '1'

    # Additional settings for pip commands
    if 'pip install' in cmd:
        env['PIP_DISABLE_PIP_VERSION_CHECK'] = '1'
        env['PIP_NO_CACHE_DIR'] = '1'

    return env
