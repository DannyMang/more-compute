import os
import sys
import time
import shlex
import subprocess
import importlib
from typing import Dict, Any, Optional, List
from fastapi import WebSocket


class LineMagicHandlers:
    """Handlers for IPython line magic commands (%magic)"""

    def __init__(self, globals_dict: dict):
        self.globals_dict = globals_dict
        self.directory_stack = []
        self.directory_history = []
        self.loaded_extensions = {}  # Track loaded extensions
        self.matplotlib_backend = None  # Track matplotlib backend

    async def handle_pwd(self, args: list, result: Dict[str, Any],
                        websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """Handle %pwd - print working directory"""
        try:
            pwd = os.getcwd()
            output_data = {
                "output_type": "execute_result",
                "execution_count": None,
                "data": {
                    "text/plain": f"'{pwd}'"
                }
            }
            result["outputs"].append(output_data)

            if websocket:
                await websocket.send_json({
                    "type": "execute_result",
                    "data": {"data": output_data["data"]}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"PWD magic error: {str(e)}"]
            }

        return result

    async def handle_cd(self, args: list, result: Dict[str, Any],
                       websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """Handle %cd - change directory"""
        try:
            if not args:
                # No args - go to home directory
                new_dir = os.path.expanduser('~')
            else:
                new_dir = os.path.expanduser(args[0])

            old_dir = os.getcwd()
            os.chdir(new_dir)
            self.directory_history.append(new_dir)

            output_text = os.getcwd() + "\n"
            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"CD magic error: {str(e)}"]
            }

        return result

    async def handle_ls(self, args: list, result: Dict[str, Any],
                       websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """Handle %ls - list directory contents"""
        try:
            path = args[0] if args else '.'
            items = os.listdir(path)
            items.sort()

            output_text = '\n'.join(items) + "\n"
            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"LS magic error: {str(e)}"]
            }

        return result

    async def handle_env(self, args: list, result: Dict[str, Any],
                        websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %env - get/set environment variables.
        Usage:
            %env                  - list all env vars
            %env VAR              - get value of VAR
            %env VAR=value        - set VAR to value
            %env VAR=$OTHER       - set VAR to value of OTHER (with expansion)
        """
        try:
            if not args:
                # List all environment variables
                env_text = '\n'.join([f"{k}={v}" for k, v in sorted(os.environ.items())])
                output_text = env_text + "\n"
            elif '=' in args[0]:
                # Set environment variable
                var_assignment = ' '.join(args)
                var_name, var_value = var_assignment.split('=', 1)

                # Handle $VAR expansion
                if var_value.startswith('$'):
                    var_value = os.environ.get(var_value[1:], '')

                os.environ[var_name] = var_value
                output_text = f"env: {var_name}={var_value}\n"
            else:
                # Get environment variable
                var_name = args[0]
                var_value = os.environ.get(var_name, '')
                output_text = var_value + "\n" if var_value else f"env: {var_name} not set\n"

            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"ENV magic error: {str(e)}"]
            }

        return result

    async def handle_who(self, args: list, result: Dict[str, Any],
                        websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %who - list interactive variables.
        Usage: %who [type] - optionally filter by type (e.g., %who int, %who str)
        """
        try:
            # Get all user-defined variables (exclude built-ins and private vars)
            user_vars = {k: v for k, v in self.globals_dict.items()
                        if not k.startswith('_') and k not in ['In', 'Out']}

            # Filter by type if specified
            if args:
                type_name = args[0]
                type_map = {
                    'int': int,
                    'float': float,
                    'str': str,
                    'list': list,
                    'dict': dict,
                    'tuple': tuple,
                    'set': set,
                }
                if type_name in type_map:
                    user_vars = {k: v for k, v in user_vars.items()
                               if isinstance(v, type_map[type_name])}

            # Format output
            var_names = sorted(user_vars.keys())
            output_text = '\t'.join(var_names) + "\n" if var_names else "Interactive namespace is empty.\n"

            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"WHO magic error: {str(e)}"]
            }

        return result

    async def handle_whos(self, args: list, result: Dict[str, Any],
                         websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %whos - list variables with type and size information.
        """
        try:
            # Get all user-defined variables
            user_vars = {k: v for k, v in self.globals_dict.items()
                        if not k.startswith('_') and k not in ['In', 'Out']}

            if not user_vars:
                output_text = "Interactive namespace is empty.\n"
            else:
                # Build table header
                lines = []
                lines.append("Variable   Type        Data/Info")
                lines.append("-" * 50)

                for name in sorted(user_vars.keys()):
                    var = user_vars[name]
                    var_type = type(var).__name__

                    # Get size/shape info
                    if hasattr(var, 'shape'):  # NumPy arrays, pandas DataFrames
                        info = f"shape: {var.shape}"
                    elif hasattr(var, '__len__'):
                        try:
                            info = f"n={len(var)}"
                        except:
                            info = ""
                    else:
                        info = str(var)[:50]  # First 50 chars

                    lines.append(f"{name:<10} {var_type:<11} {info}")

                output_text = '\n'.join(lines) + "\n"

            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"WHOS magic error: {str(e)}"]
            }

        return result

    async def handle_time(self, args: list, result: Dict[str, Any],
                         websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %time - time single statement execution.
        Usage: %time statement
        """
        try:
            if not args:
                result["status"] = "error"
                result["error"] = {
                    "ename": "UsageError",
                    "evalue": "%time requires a statement to time",
                    "traceback": ["Usage: %time statement"]
                }
                return result

            statement = ' '.join(args)

            # Time the execution
            start_wall = time.time()
            start_cpu = time.process_time()

            # Execute the statement
            exec(statement, self.globals_dict)

            wall_time = time.time() - start_wall
            cpu_time = time.process_time() - start_cpu

            # Format output
            output_text = f"CPU times: user {cpu_time:.2f} s, sys: 0 s, total: {cpu_time:.2f} s\n"
            output_text += f"Wall time: {wall_time:.2f} s\n"

            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"TIME magic error: {str(e)}"]
            }

        return result

    async def handle_pip(self, args: list, result: Dict[str, Any],
                        special_handler, websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %pip - run pip within the kernel.
        This delegates to the shell command handler.
        """
        pip_command = 'pip ' + ' '.join(args)
        return await special_handler._execute_shell_command(
            pip_command, result, time.time(), websocket
        )

    async def handle_load(self, args: list, result: Dict[str, Any],
                         websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %load - load code from file or URL.
        Usage: %load filename
        """
        try:
            if not args:
                result["status"] = "error"
                result["error"] = {
                    "ename": "UsageError",
                    "evalue": "%load requires a filename",
                    "traceback": ["Usage: %load filename"]
                }
                return result

            source = args[0]

            # Check if it's a URL
            if source.startswith('http://') or source.startswith('https://'):
                import urllib.request
                with urllib.request.urlopen(source) as response:
                    code = response.read().decode('utf-8')
            else:
                # It's a file
                with open(source, 'r') as f:
                    code = f.read()

            # In IPython, %load replaces the cell content with the loaded code
            # For now, we'll just display it
            output_text = f"# Loaded from {source}\n{code}\n"

            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"LOAD magic error: {str(e)}"]
            }

        return result

    async def handle_reset(self, args: list, result: Dict[str, Any],
                          websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %reset - clear namespace.
        Usage: %reset [-f] [-s]
        -f: force (no confirmation)
        -s: soft (keep internal variables)
        """
        try:
            force = '-f' in args
            soft = '-s' in args

            # For now, implement force mode only
            if force or True:  # Always reset for now
                # Get list of user variables to delete
                user_vars = [k for k in self.globals_dict.keys()
                           if not k.startswith('_') and k not in ['In', 'Out']]

                for var in user_vars:
                    del self.globals_dict[var]

                output_text = "All user variables have been reset.\n"
            else:
                output_text = "Reset cancelled. Use %reset -f to force reset.\n"

            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"RESET magic error: {str(e)}"]
            }

        return result

    async def handle_lsmagic(self, args: list, result: Dict[str, Any],
                            websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """Handle %lsmagic - list available magic commands"""
        try:
            available_line = [
                'cd', 'pwd', 'ls', 'env', 'who', 'whos', 'time', 'timeit', 'pip',
                'load', 'reset', 'lsmagic', 'matplotlib', 'load_ext', 'reload_ext',
                'unload_ext', 'run'
            ]
            available_cell = [
                'capture', 'time', 'timeit', 'writefile', 'bash', 'sh',
                'html', 'markdown'
            ]

            output_text = "Available line magics:\n"
            output_text += "%" + "  %".join(available_line) + "\n\n"
            output_text += "Available cell magics:\n"
            output_text += "%%" + "  %%".join(available_cell) + "\n"

            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"LSMAGIC magic error: {str(e)}"]
            }

        return result

    async def handle_matplotlib(self, args: list, result: Dict[str, Any],
                               websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %matplotlib - setup matplotlib for interactive use.
        Usage: %matplotlib [backend]
        Common backends: inline, notebook, widget, qt, tk
        """
        try:
            backend = args[0] if args else 'inline'

            # Import matplotlib
            import matplotlib
            import matplotlib.pyplot as plt

            # Configure based on backend
            if backend == 'inline':
                # For inline backend, configure matplotlib
                matplotlib.use('Agg')  # Non-interactive backend
                self.matplotlib_backend = 'inline'

                # Configure for better inline display
                try:
                    from IPython.display import set_matplotlib_formats
                    set_matplotlib_formats('retina')
                except:
                    pass

            elif backend == 'notebook':
                # Interactive notebook backend
                try:
                    import ipympl
                    matplotlib.use('module://ipympl.backend_nbagg')
                    self.matplotlib_backend = 'notebook'
                except ImportError:
                    output_text = "Warning: ipympl not installed. Falling back to inline.\n"
                    result["outputs"].append({
                        "output_type": "stream",
                        "name": "stderr",
                        "text": output_text
                    })
                    matplotlib.use('Agg')
                    self.matplotlib_backend = 'inline'

            elif backend in ['qt', 'qt5', 'qt4']:
                matplotlib.use('Qt5Agg')
                self.matplotlib_backend = backend

            elif backend == 'tk':
                matplotlib.use('TkAgg')
                self.matplotlib_backend = backend

            elif backend == 'widget':
                # Jupyter widgets backend
                try:
                    import ipympl
                    matplotlib.use('module://ipympl.backend_nbagg')
                    self.matplotlib_backend = 'widget'
                except ImportError:
                    output_text = "Warning: ipympl not installed. Install with: pip install ipympl\n"
                    result["outputs"].append({
                        "output_type": "stream",
                        "name": "stderr",
                        "text": output_text
                    })
                    matplotlib.use('Agg')
                    self.matplotlib_backend = 'inline'

            else:
                matplotlib.use(backend)
                self.matplotlib_backend = backend

            # Store in globals for easy access
            self.globals_dict['plt'] = plt

            output_text = f"Using matplotlib backend: {self.matplotlib_backend}\n"
            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"MATPLOTLIB magic error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {"error": result["error"]}
                })

        return result

    async def handle_load_ext(self, args: list, result: Dict[str, Any],
                             websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %load_ext - load IPython extension.
        Usage: %load_ext extension_name
        Common extensions: autoreload, tensorboard
        """
        try:
            if not args:
                result["status"] = "error"
                result["error"] = {
                    "ename": "UsageError",
                    "evalue": "%load_ext requires an extension name",
                    "traceback": ["Usage: %load_ext extension_name"]
                }
                return result

            ext_name = args[0]

            # Check if already loaded
            if ext_name in self.loaded_extensions:
                output_text = f"The {ext_name} extension is already loaded.\n"
                result["outputs"].append({
                    "output_type": "stream",
                    "name": "stdout",
                    "text": output_text
                })
                return result

            # Handle special built-in extensions
            if ext_name == 'autoreload':
                # Basic autoreload implementation
                output_text = "Loaded autoreload extension (basic implementation)\n"
                output_text += "Note: Full autoreload functionality requires IPython kernel\n"
                self.loaded_extensions[ext_name] = {'type': 'builtin', 'config': {}}

            elif ext_name == 'tensorboard':
                # TensorBoard extension
                try:
                    import tensorboard
                    output_text = f"Loaded tensorboard extension\n"
                    self.loaded_extensions[ext_name] = {'type': 'builtin', 'module': tensorboard}
                except ImportError:
                    raise ImportError("TensorBoard not installed. Install with: pip install tensorboard")

            else:
                # Try to load as a Python module
                try:
                    module = importlib.import_module(ext_name)

                    # Look for IPython extension API
                    if hasattr(module, 'load_ipython_extension'):
                        # Would need IPython shell instance here
                        # For now, just load the module
                        self.loaded_extensions[ext_name] = {'type': 'module', 'module': module}
                        output_text = f"Loaded extension: {ext_name}\n"
                    else:
                        # Just a regular module
                        self.loaded_extensions[ext_name] = {'type': 'module', 'module': module}
                        output_text = f"Loaded module: {ext_name} (no IPython extension API found)\n"

                except ImportError as e:
                    raise ImportError(f"Could not load extension {ext_name}: {str(e)}")

            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"LOAD_EXT magic error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {"error": result["error"]}
                })

        return result

    async def handle_reload_ext(self, args: list, result: Dict[str, Any],
                               websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """Handle %reload_ext - reload IPython extension"""
        try:
            if not args:
                result["status"] = "error"
                result["error"] = {
                    "ename": "UsageError",
                    "evalue": "%reload_ext requires an extension name",
                    "traceback": ["Usage: %reload_ext extension_name"]
                }
                return result

            ext_name = args[0]

            if ext_name not in self.loaded_extensions:
                output_text = f"Extension {ext_name} is not loaded. Use %load_ext first.\n"
            else:
                # Unload and reload
                ext_info = self.loaded_extensions[ext_name]
                if ext_info['type'] == 'module':
                    module = ext_info['module']
                    importlib.reload(module)
                    output_text = f"Reloaded extension: {ext_name}\n"
                else:
                    output_text = f"Reloaded extension: {ext_name}\n"

            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"RELOAD_EXT magic error: {str(e)}"]
            }

        return result

    async def handle_unload_ext(self, args: list, result: Dict[str, Any],
                               websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """Handle %unload_ext - unload IPython extension"""
        try:
            if not args:
                result["status"] = "error"
                result["error"] = {
                    "ename": "UsageError",
                    "evalue": "%unload_ext requires an extension name",
                    "traceback": ["Usage: %unload_ext extension_name"]
                }
                return result

            ext_name = args[0]

            if ext_name in self.loaded_extensions:
                del self.loaded_extensions[ext_name]
                output_text = f"Unloaded extension: {ext_name}\n"
            else:
                output_text = f"Extension {ext_name} is not loaded.\n"

            result["outputs"].append({
                "output_type": "stream",
                "name": "stdout",
                "text": output_text
            })

            if websocket:
                await websocket.send_json({
                    "type": "stream_output",
                    "data": {"stream": "stdout", "text": output_text}
                })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"UNLOAD_EXT magic error: {str(e)}"]
            }

        return result

    async def handle_timeit(self, args: list, result: Dict[str, Any],
                           websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %timeit - time statement execution (line magic version).
        Usage: %timeit [-n<N>] [-r<R>] statement
        """
        import timeit

        # Parse arguments
        number = None
        repeat = 7
        quiet = '-q' in args

        # Remove flags and get statement
        statement_parts = []
        for arg in args:
            if arg.startswith('-n'):
                number = int(arg[2:]) if len(arg) > 2 else None
            elif arg.startswith('-r'):
                repeat = int(arg[2:]) if len(arg) > 2 else 7
            elif arg == '-q':
                quiet = True
            else:
                statement_parts.append(arg)

        statement = ' '.join(statement_parts)

        if not statement:
            result["status"] = "error"
            result["error"] = {
                "ename": "UsageError",
                "evalue": "%timeit requires a statement to time",
                "traceback": ["Usage: %timeit [-n<N>] [-r<R>] statement"]
            }
            return result

        try:
            # Create a timer
            timer = timeit.Timer(
                stmt=statement,
                globals=self.globals_dict
            )

            # Auto-determine number of iterations if not specified
            if number is None:
                for i in range(1, 10):
                    n = 10 ** i
                    try:
                        t = timer.timeit(n)
                        if t >= 0.2:
                            number = n
                            break
                    except:
                        number = 1
                        break
                if number is None:
                    number = 10 ** 7

            # Run the timing
            all_runs = timer.repeat(repeat=repeat, number=number)
            best = min(all_runs) / number

            # Format output
            if best < 1e-6:
                timing_str = f"{best * 1e9:.0f} ns"
            elif best < 1e-3:
                timing_str = f"{best * 1e6:.0f} µs"
            elif best < 1:
                timing_str = f"{best * 1e3:.0f} ms"
            else:
                timing_str = f"{best:.2f} s"

            output_text = f"{timing_str} ± {(max(all_runs) - min(all_runs)) / number * 1e6:.0f} µs per loop (mean ± std. dev. of {repeat} runs, {number} loops each)\n"

            if not quiet:
                result["outputs"].append({
                    "output_type": "stream",
                    "name": "stdout",
                    "text": output_text
                })

                if websocket:
                    await websocket.send_json({
                        "type": "stream_output",
                        "data": {"stream": "stdout", "text": output_text}
                    })

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"TIMEIT magic error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {"error": result["error"]}
                })

        return result

    async def handle_run(self, args: list, result: Dict[str, Any],
                        websocket: Optional[WebSocket] = None) -> Dict[str, Any]:
        """
        Handle %run - execute Python script or notebook.
        Usage: %run script.py [args]
        """
        try:
            if not args:
                result["status"] = "error"
                result["error"] = {
                    "ename": "UsageError",
                    "evalue": "%run requires a filename",
                    "traceback": ["Usage: %run filename [args]"]
                }
                return result

            filename = args[0]
            script_args = args[1:] if len(args) > 1 else []

            # Check file exists
            if not os.path.exists(filename):
                raise FileNotFoundError(f"File not found: {filename}")

            # Read the file
            with open(filename, 'r') as f:
                code = f.read()

            # Update sys.argv for the script
            old_argv = sys.argv
            sys.argv = [filename] + script_args

            try:
                # Compile and execute
                compiled_code = compile(code, filename, 'exec')
                exec(compiled_code, self.globals_dict)

                output_text = f"Executed: {filename}\n"
                result["outputs"].append({
                    "output_type": "stream",
                    "name": "stdout",
                    "text": output_text
                })

                if websocket:
                    await websocket.send_json({
                        "type": "stream_output",
                        "data": {"stream": "stdout", "text": output_text}
                    })

            finally:
                # Restore sys.argv
                sys.argv = old_argv

        except Exception as e:
            result["status"] = "error"
            result["error"] = {
                "ename": type(e).__name__,
                "evalue": str(e),
                "traceback": [f"RUN magic error: {str(e)}"]
            }

            if websocket:
                await websocket.send_json({
                    "type": "execution_error",
                    "data": {"error": result["error"]}
                })

        return result
