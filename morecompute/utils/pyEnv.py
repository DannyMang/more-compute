import os
import sys
import json
import subprocess
import platform
from pathlib import Path
from typing import List, Dict, Optional, Tuple


class PythonEnvironmentDetector:
    """Detects Python environments like VSCode does"""

    def __init__(self):
        self.system = platform.system().lower()
    
    def detect_fast_environments(self) -> List[Dict[str, str]]:
        """Fast detection of only basic system Python (for web UI)"""
        environments = []
        
        # Only detect system Python quickly
        python_names = ['python3', 'python']
        
        for python_name in python_names:
            try:
                cmd = 'where' if self.system == 'windows' else 'which'
                result = subprocess.run([cmd, python_name], 
                                      capture_output=True, text=True, timeout=3)
                
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
                        
            except (subprocess.TimeoutExpired, FileNotFoundError, Exception):
                continue
        
        return environments

    def detect_all_environments(self) -> List[Dict[str, str]]:
        """Detect all Python environments on the system"""
        environments = []
        
        try:
            # 1. System Python installations (fast)
            environments.extend(self._detect_system_python())
        except Exception as e:
            print(f"Warning: System Python detection failed: {e}")

        try:
            # 2. Conda environments (can be slow)
            environments.extend(self._detect_conda_environments())
        except Exception as e:
            print(f"Warning: Conda detection failed: {e}")

        try:
            # 3. Virtual environments (medium speed)
            environments.extend(self._detect_virtual_environments())
        except Exception as e:
            print(f"Warning: Virtual env detection failed: {e}")

        try:
            # 4. PyEnv environments (can be slow)
            environments.extend(self._detect_pyenv_environments())
        except Exception as e:
            print(f"Warning: PyEnv detection failed: {e}")

        try:
            # 5. Poetry environments (can be slow)
            environments.extend(self._detect_poetry_environments())
        except Exception as e:
            print(f"Warning: Poetry detection failed: {e}")

        # Remove duplicates based on path
        seen_paths = set()
        unique_environments = []
        for env in environments:
            if env['path'] not in seen_paths:
                seen_paths.add(env['path'])
                unique_environments.append(env)

        return sorted(unique_environments, key=lambda x: x['name'])

    def _detect_system_python(self) -> List[Dict[str, str]]:
        """Detect system Python installations"""
        environments = []

        # Common Python executable names
        python_names = ['python', 'python3', 'python3.11', 'python3.10', 'python3.9']

        if self.system == 'windows':
            python_names.extend(['py', 'python.exe'])

        for python_name in python_names:
            try:
                # Use 'where' on Windows, 'which' on Unix-like systems
                cmd = 'where' if self.system == 'windows' else 'which'
                result = subprocess.run([cmd, python_name],
                                      capture_output=True, text=True, timeout=10)

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

    def _detect_conda_environments(self) -> List[Dict[str, str]]:
        """Detect Conda/Mamba environments"""
        environments = []

        # Try conda first, then mamba
        for cmd in ['conda', 'mamba']:
            try:
                result = subprocess.run([cmd, 'env', 'list', '--json'],
                                      capture_output=True, text=True, timeout=10)

                if result.returncode == 0:
                    data = json.loads(result.stdout)

                    for env_path in data.get('envs', []):
                        python_path = self._find_python_in_env(env_path)
                        if python_path:
                            env_name = os.path.basename(env_path)
                            if env_name == 'base':
                                env_name = f'{cmd} base'

                            version = self._get_python_version(python_path)
                            if version:
                                environments.append({
                                    'name': env_name,
                                    'path': python_path,
                                    'version': version,
                                    'type': 'conda',
                                    'active': python_path == sys.executable
                                })
                    break  # If conda works, don't try mamba

            except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError):
                continue

        return environments

    def _detect_virtual_environments(self) -> List[Dict[str, str]]:
        """Detect virtual environments (venv/virtualenv)"""
        environments = []

        # Common virtual environment locations
        search_paths = []

        home = Path.home()
        search_paths.extend([
            home / 'venvs',
            home / '.virtualenvs',
            home / 'envs',
            home / '.local' / 'share' / 'virtualenvs',  # pipenv default
            Path.cwd() / 'venv',
            Path.cwd() / '.venv',
        ])

        # Also check WORKON_HOME (virtualenvwrapper)
        if 'WORKON_HOME' in os.environ:
            search_paths.append(Path(os.environ['WORKON_HOME']))

        for search_path in search_paths:
            if search_path.exists() and search_path.is_dir():
                environments.extend(self._scan_directory_for_venvs(search_path))

        return environments

    def _detect_pyenv_environments(self) -> List[Dict[str, str]]:
        """Detect PyEnv environments"""
        environments = []

        try:
            # Check if pyenv is installed
            result = subprocess.run(['pyenv', 'versions', '--bare'],
                                  capture_output=True, text=True, timeout=10)

            if result.returncode == 0:
                pyenv_root = os.environ.get('PYENV_ROOT', Path.home() / '.pyenv')

                for version in result.stdout.strip().split('\n'):
                    version = version.strip()
                    if version:
                        python_path = Path(pyenv_root) / 'versions' / version / 'bin' / 'python'

                        if python_path.exists():
                            py_version = self._get_python_version(str(python_path))
                            if py_version:
                                environments.append({
                                    'name': f'pyenv: {version}',
                                    'path': str(python_path),
                                    'version': py_version,
                                    'type': 'pyenv',
                                    'active': str(python_path) == sys.executable
                                })

        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

        return environments

    def _detect_poetry_environments(self) -> List[Dict[str, str]]:
        """Detect Poetry environments"""
        environments = []

        try:
            result = subprocess.run(['poetry', 'env', 'list', '--full-path'],
                                  capture_output=True, text=True, timeout=10)

            if result.returncode == 0:
                for line in result.stdout.strip().split('\n'):
                    if line.strip():
                        # Poetry output format: "env-name (Activated)" or just "env-name"
                        env_path = line.split()[0]
                        python_path = self._find_python_in_env(env_path)

                        if python_path:
                            env_name = f"poetry: {os.path.basename(env_path)}"
                            version = self._get_python_version(python_path)

                            if version:
                                environments.append({
                                    'name': env_name,
                                    'path': python_path,
                                    'version': version,
                                    'type': 'poetry',
                                    'active': python_path == sys.executable
                                })

        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

        return environments

    def _scan_directory_for_venvs(self, directory: Path) -> List[Dict[str, str]]:
        """Scan a directory for virtual environments"""
        environments = []

        try:
            for item in directory.iterdir():
                if item.is_dir():
                    python_path = self._find_python_in_env(str(item))
                    if python_path:
                        # Check if it's actually a virtual environment
                        if self._is_virtual_environment(str(item)):
                            version = self._get_python_version(python_path)
                            if version:
                                environments.append({
                                    'name': item.name,
                                    'path': python_path,
                                    'version': version,
                                    'type': 'venv',
                                    'active': python_path == sys.executable
                                })
        except PermissionError:
            pass

        return environments

    def _find_python_in_env(self, env_path: str) -> Optional[str]:
        """Find Python executable in an environment directory"""
        env_path = Path(env_path)

        # Common Python executable locations in environments
        if self.system == 'windows':
            python_paths = [
                env_path / 'python.exe',
                env_path / 'Scripts' / 'python.exe',
            ]
        else:
            python_paths = [
                env_path / 'bin' / 'python',
                env_path / 'bin' / 'python3',
            ]

        for python_path in python_paths:
            if python_path.exists() and python_path.is_file():
                return str(python_path)

        return None

    def _is_virtual_environment(self, env_path: str) -> bool:
        """Check if a directory is a virtual environment"""
        env_path = Path(env_path)

        # Look for virtual environment indicators
        indicators = [
            env_path / 'pyvenv.cfg',  # venv
            env_path / 'bin' / 'activate',  # Unix venv/virtualenv
            env_path / 'Scripts' / 'activate',  # Windows venv/virtualenv
        ]

        return any(indicator.exists() for indicator in indicators)

    def _get_python_version(self, python_path: str) -> Optional[str]:
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

    def get_current_environment(self) -> Dict[str, str]:
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
