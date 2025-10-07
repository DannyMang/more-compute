import os
import sys
import json
import subprocess
import platform
from pathlib import Path


class PythonEnvironmentDetector:
    """Detects Python environments (system Python and conda)"""

    def __init__(self):
        self.system = platform.system().lower()

    def detect_all_environments(self) -> list[dict[str, str]]:
        """Detect all Python environments on the system"""
        environments = []

        try:
            # 1. Conda environments (check first for proper naming)
            environments.extend(self._detect_conda_environments())
        except Exception as e:
            print(f"Warning: Conda detection failed: {e}")

        try:
            # 2. System Python installations
            environments.extend(self._detect_system_python())
        except Exception as e:
            print(f"Warning: System Python detection failed: {e}")

        try:
            # 3. Check for venv in current directory
            environments.extend(self._detect_local_venv())
        except Exception as e:
            print(f"Warning: Local venv detection failed: {e}")

        # Remove duplicates based on path (keep first occurrence)
        seen_paths = set()
        unique_environments = []
        for env in environments:
            if env['path'] not in seen_paths:
                seen_paths.add(env['path'])
                unique_environments.append(env)

        return sorted(unique_environments, key=lambda x: x['name'])

    def _detect_system_python(self) -> list[dict[str, str]]:
        """Detect system Python installations"""
        environments = []

        # Common Python executable names
        python_names = ['python3', 'python']

        if self.system == 'windows':
            python_names.extend(['py', 'python.exe'])

        for python_name in python_names:
            try:
                cmd = 'where' if self.system == 'windows' else 'which'
                result = subprocess.run([cmd, python_name],
                                      capture_output=True, text=True, timeout=5)

                if result.returncode == 0:
                    python_path = result.stdout.strip().split('\n')[0]
                    version = self._get_python_version(python_path)

                    if version:
                        environments.append({
                            'name': f'System Python ({python_name})',
                            'path': python_path,
                            'version': version,
                            'type': 'system',
                            'active': python_path == sys.executable
                        })

            except (subprocess.TimeoutExpired, FileNotFoundError):
                continue

        return environments

    def _detect_conda_environments(self) -> list[dict[str, str]]:
        """Detect Conda/Mamba environments"""
        environments = []

        # Try conda first, then mamba
        for cmd in ['conda', 'mamba']:
            try:
                result = subprocess.run([cmd, 'env', 'list', '--json'],
                                      capture_output=True, text=True, timeout=10)

                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    root_prefix = data.get('root_prefix', '')

                    for env_path in data.get('envs', []):
                        # Find python in conda env
                        env_path_obj = Path(env_path)
                        if self.system == 'windows':
                            python_path = env_path_obj / 'python.exe'
                        else:
                            python_path = env_path_obj / 'bin' / 'python'

                        if python_path.exists() and python_path.is_file():
                            # Check if this is the base/root environment
                            if env_path == root_prefix:
                                env_name = f'{cmd} (base)'
                            else:
                                env_name = os.path.basename(env_path)

                            version = self._get_python_version(str(python_path))
                            if version:
                                environments.append({
                                    'name': env_name,
                                    'path': str(python_path),
                                    'version': version,
                                    'type': 'conda',
                                    'active': str(python_path) == sys.executable
                                })
                    break

            except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError):
                continue

        return environments

    def _detect_local_venv(self) -> list[dict[str, str]]:
        """Detect virtual environments in current directory only"""
        environments = []

        # Only check common venv names in current directory
        venv_names = ['.venv', 'venv']

        for venv_name in venv_names:
            venv_path = Path.cwd() / venv_name
            if venv_path.exists() and venv_path.is_dir():
                # Find python executable
                if self.system == 'windows':
                    python_path = venv_path / 'Scripts' / 'python.exe'
                else:
                    python_path = venv_path / 'bin' / 'python'

                if python_path.exists() and python_path.is_file():
                    version = self._get_python_version(str(python_path))
                    if version:
                        environments.append({
                            'name': venv_name,
                            'path': str(python_path),
                            'version': version,
                            'type': 'venv',
                            'active': str(python_path) == sys.executable
                        })

        return environments

    def _get_python_version(self, python_path: str) -> str | None:
        """Get Python version from executable"""
        try:
            result = subprocess.run([python_path, '--version'],
                                  capture_output=True, text=True, timeout=5)

            if result.returncode == 0:
                # Parse "Python 3.11.4" -> "3.11.4"
                version_line = result.stdout.strip()
                if version_line.startswith('Python '):
                    return version_line[7:]  # Remove "Python "

        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

        return None

    def get_current_environment(self) -> dict[str, str]:
        """Get information about the currently active Python environment"""
        return {
            'name': 'Current Python',
            'path': sys.executable,
            'version': f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            'type': 'current',
            'active': True
        }


# Example usage
if __name__ == "__main__":
    detector = PythonEnvironmentDetector()

    print("Detecting Python environments...")
    environments = detector.detect_all_environments()

    print(f"\nFound {len(environments)} Python environments:")
    print("-" * 60)

    for env in environments:
        status = "ACTIVE" if env['active'] else ""
        print(f"{env['name']:<25} Python {env['version']:<8} {env['type']:<8} {status}")
        print(f"{'':25} {env['path']}")
        print()
