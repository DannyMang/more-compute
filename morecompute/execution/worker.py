import os
import sys
import time
import signal
import base64
import io
import traceback
import zmq
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import re
import subprocess
import shlex
import platform

# Import shared shell command utilities
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.shell_utils import prepare_shell_command, prepare_shell_environment

def _preprocess_shell_commands(code: str) -> str:
    """
    Preprocess code to transform IPython-style shell commands (!cmd) into Python function calls.
    Returns transformed code with shell commands converted to _run_shell_command() calls.
    """
    lines = code.split('\n')
    transformed_lines = []

    for line in lines:
        # Match shell commands: "    !pip install pandas"
        shell_match = re.match(r'^(\s*)!(.+)$', line)

        if shell_match:
            indent = shell_match.group(1)
            shell_cmd = shell_match.group(2).strip()
            # Use repr() for proper escaping
            shell_cmd_repr = repr(shell_cmd)
            # Transform to function call
            transformed = f"{indent}_run_shell_command({shell_cmd_repr})"
            transformed_lines.append(transformed)
        else:
            transformed_lines.append(line)

    return '\n'.join(transformed_lines)

def _inject_shell_command_function(globals_dict: dict):
    """Inject the _run_shell_command function into globals if not present."""
    if '_run_shell_command' not in globals_dict:
        def _run_shell_command(cmd: str):
            """Execute a shell command synchronously with streaming output"""
            # Prepare command and environment (using shared utilities)
            shell_cmd = prepare_shell_command(cmd)
            env = prepare_shell_environment(cmd)

            # Use Popen for real-time streaming
            process = subprocess.Popen(
                shell_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,  # Line buffered
                env=env
            )

            # Stream output line by line
            import threading

            def read_stream(stream, output_type):
                try:
                    for line in iter(stream.readline, ''):
                        if not line:
                            break
                        if output_type == 'stdout':
                            print(line, end='')
                            sys.stdout.flush()
                        else:
                            print(line, end='', file=sys.stderr)
                            sys.stderr.flush()
                except Exception:
                    pass
                finally:
                    stream.close()

            stdout_thread = threading.Thread(target=read_stream, args=(process.stdout, 'stdout'))
            stderr_thread = threading.Thread(target=read_stream, args=(process.stderr, 'stderr'))
            stdout_thread.daemon = True
            stderr_thread.daemon = True
            stdout_thread.start()
            stderr_thread.start()

            return_code = process.wait()
            stdout_thread.join()
            stderr_thread.join()

            return return_code

        globals_dict['_run_shell_command'] = _run_shell_command

def _setup_signals():
    def _handler(signum, frame):
        try:
            sys.stdout.flush(); sys.stderr.flush()
        except Exception:
            pass
        os._exit(0)
    try:
        signal.signal(signal.SIGTERM, _handler)
        signal.signal(signal.SIGINT, signal.default_int_handler)
    except Exception:
        pass


class _StreamForwarder:
    def __init__(self, pub, cell_index):
        self.pub = pub
        self.cell_index = cell_index
        self.out_buf = []
        self.err_buf = []

    def write_out(self, text):
        self._write('stdout', text)

    def write_err(self, text):
        self._write('stderr', text)

    def _write(self, name, text):
        if not text:
            return
        if '\r' in text and '\n' not in text:
            self.pub.send_json({'type': 'stream_update', 'name': name, 'text': text.split('\r')[-1], 'cell_index': self.cell_index})
            return
        lines = text.split('\n')
        buf = self.out_buf if name == 'stdout' else self.err_buf
        for i, line in enumerate(lines):
            if i < len(lines) - 1:
                buf.append(line)
                complete = ''.join(buf) + '\n'
                self.pub.send_json({'type': 'stream', 'name': name, 'text': complete, 'cell_index': self.cell_index})
                buf.clear()
            else:
                buf.append(line)

    def flush(self):
        if self.out_buf:
            self.pub.send_json({'type': 'stream', 'name': 'stdout', 'text': ''.join(self.out_buf), 'cell_index': self.cell_index})
            self.out_buf.clear()
        if self.err_buf:
            self.pub.send_json({'type': 'stream', 'name': 'stderr', 'text': ''.join(self.err_buf), 'cell_index': self.cell_index})
            self.err_buf.clear()


def _capture_matplotlib(pub, cell_index):
    try:
        figs = plt.get_fignums()
        for num in figs:
            try:
                fig = plt.figure(num)
                buf = io.BytesIO()
                fig.savefig(buf, format='png', bbox_inches='tight')
                buf.seek(0)
                b64 = base64.b64encode(buf.read()).decode('ascii')
                pub.send_json({'type': 'display_data', 'data': {'image/png': b64}, 'cell_index': cell_index})
            except Exception:
                continue
        try:
            plt.close('all')
        except Exception:
            pass
    except Exception:
        return


def worker_main():
    _setup_signals()
    cmd_addr = os.environ['MC_ZMQ_CMD_ADDR']
    pub_addr = os.environ['MC_ZMQ_PUB_ADDR']

    ctx = zmq.Context.instance()
    rep = ctx.socket(zmq.REP)
    rep.bind(cmd_addr)
    # Set timeout so we can check for signals during execution
    rep.setsockopt(zmq.RCVTIMEO, 100)  # 100ms timeout

    pub = ctx.socket(zmq.PUB)
    pub.bind(pub_addr)

    # Persistent REPL state
    g = {"__name__": "__main__"}
    l = g
    exec_count = 0

    last_hb = time.time()
    current_cell = None
    shutdown_requested = False

    while True:
        try:
            msg = rep.recv_json()
        except zmq.Again:
            # Timeout - check if we should send heartbeat
            if time.time() - last_hb > 5.0:
                pub.send_json({'type': 'heartbeat', 'ts': time.time()})
                last_hb = time.time()
            if shutdown_requested:
                break
            continue
        except Exception:
            if shutdown_requested:
                break
            continue
        mtype = msg.get('type')
        if mtype == 'ping':
            rep.send_json({'ok': True, 'pid': os.getpid()})
            continue
        if mtype == 'shutdown':
            rep.send_json({'ok': True, 'pid': os.getpid()})
            shutdown_requested = True
            # Don't break immediately - let the loop handle cleanup
            continue
        if mtype == 'interrupt':
            requested = msg.get('cell_index') if isinstance(msg, dict) else None
            if requested is None or requested == current_cell:
                try:
                    os.kill(os.getpid(), signal.SIGINT)
                except Exception:
                    pass
            rep.send_json({'ok': True, 'pid': os.getpid()})
            continue
        if mtype == 'execute_cell':
            code = msg.get('code', '')
            cell_index = msg.get('cell_index')
            requested_count = msg.get('execution_count')
            current_cell = cell_index
            if isinstance(requested_count, int):
                exec_count = requested_count - 1
            command_type = msg.get('command_type')
            pub.send_json({'type': 'execution_start', 'cell_index': cell_index, 'execution_count': exec_count + 1})

            # Check if this is a special command (shell command starting with ! or magic command)
            is_special_cmd = code.strip().startswith('!') or code.strip().startswith('%')

            if is_special_cmd:
                # Handle special commands on remote worker
                exec_count += 1
                status = 'ok'
                error_payload = None
                start = time.time()

                try:
                    import subprocess
                    import shlex

                    # Strip the ! prefix for shell commands
                    if code.strip().startswith('!'):
                        shell_cmd = code.strip()[1:].strip()

                        # Run shell command
                        process = subprocess.Popen(
                            ['/bin/bash', '-c', shell_cmd],
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            text=True
                        )
                        stdout, stderr = process.communicate()

                        # Send stdout
                        if stdout:
                            pub.send_json({'type': 'stream', 'name': 'stdout', 'text': stdout, 'cell_index': cell_index})

                        # Send stderr
                        if stderr:
                            pub.send_json({'type': 'stream', 'name': 'stderr', 'text': stderr, 'cell_index': cell_index})

                        # Check return code
                        if process.returncode != 0:
                            status = 'error'
                            # Only set error if we don't have detailed stderr
                            if not stderr.strip():
                                error_payload = {
                                    'ename': 'ShellCommandError',
                                    'evalue': f'Command failed with return code {process.returncode}',
                                    'traceback': [f'Shell command failed: {shell_cmd}']
                                }
                    else:
                        # Magic commands not fully supported on remote yet
                        status = 'error'
                        error_payload = {
                            'ename': 'NotImplementedError',
                            'evalue': 'Magic commands (%) not yet supported on remote GPU pods',
                            'traceback': ['Use ! for shell commands instead']
                        }

                except Exception as exc:
                    status = 'error'
                    error_payload = {'ename': type(exc).__name__, 'evalue': str(exc), 'traceback': traceback.format_exc().split('\n')}

                duration_ms = f"{(time.time()-start)*1000:.1f}ms"
                if error_payload:
                    pub.send_json({'type': 'execution_error', 'cell_index': cell_index, 'error': error_payload})
                pub.send_json({'type': 'execution_complete', 'cell_index': cell_index, 'result': {'status': status, 'execution_count': exec_count, 'execution_time': duration_ms, 'outputs': [], 'error': error_payload}})
                rep.send_json({'ok': True, 'pid': os.getpid()})
                current_cell = None
                continue

            # Regular Python code execution
            # Redirect streams
            sf = _StreamForwarder(pub, cell_index)
            old_out, old_err = sys.stdout, sys.stderr
            class _O:
                def write(self, t): sf.write_out(t)
                def flush(self): sf.flush()
            class _E:
                def write(self, t): sf.write_err(t)
                def flush(self): sf.flush()
            sys.stdout, sys.stderr = _O(), _E()
            status = 'ok'
            error_payload = None
            start = time.time()
            try:
                # Preprocess shell commands (!cmd) to Python function calls
                # This allows code like "import os; !pip install pandas" to work
                preprocessed_code = _preprocess_shell_commands(code)

                # Inject shell command function into globals if needed
                _inject_shell_command_function(g)

                compiled = compile(preprocessed_code, '<cell>', 'exec')
                exec(compiled, g, l)

                # Try to evaluate last expression for display (like Jupyter)
                lines = code.strip().split('\n')
                if lines:
                    last = lines[-1].strip()
                    # Skip comments and empty lines
                    if last and not last.startswith('#'):
                        # Check if it looks like a statement (assignment, import, etc)
                        is_statement = False

                        # Check for assignment (but not comparison operators)
                        if '=' in last and not any(op in last for op in ['==', '!=', '<=', '>=', '=<', '=>']):
                            is_statement = True

                        # Check for statement keywords (handle both "assert x" and "assert(x)")
                        statement_keywords = ['import', 'from', 'def', 'class', 'if', 'elif', 'else',
                                            'for', 'while', 'try', 'except', 'finally', 'with',
                                            'assert', 'del', 'global', 'nonlocal', 'pass', 'break',
                                            'continue', 'return', 'raise', 'yield']

                        # Get first word, handling cases like "assert(...)" by splitting on non-alphanumeric
                        first_word_match = re.match(r'^(\w+)', last)
                        first_word = first_word_match.group(1) if first_word_match else ''

                        if first_word in statement_keywords:
                            is_statement = True

                        # Don't eval function calls - they were already executed by exec()
                        # This prevents double execution of code like: what()
                        if '(' in last and ')' in last:
                            is_statement = True

                        if not is_statement:
                            try:
                                res = eval(last, g, l)
                                if res is not None:
                                    pub.send_json({'type': 'execute_result', 'cell_index': cell_index, 'execution_count': exec_count + 1, 'data': {'text/plain': repr(res)}})
                            except Exception as e:
                                print(f"[WORKER] Failed to eval last expression '{last[:50]}...': {e}", file=sys.stderr, flush=True)

                _capture_matplotlib(pub, cell_index)
            except KeyboardInterrupt:
                status = 'error'
                error_payload = {'ename': 'KeyboardInterrupt', 'evalue': 'Execution interrupted by user', 'traceback': []}
            except Exception as exc:
                status = 'error'
                error_payload = {'ename': type(exc).__name__, 'evalue': str(exc), 'traceback': traceback.format_exc().split('\n')}
            finally:
                sys.stdout, sys.stderr = old_out, old_err
            exec_count += 1
            duration_ms = f"{(time.time()-start)*1000:.1f}ms"
            if error_payload:
                pub.send_json({'type': 'execution_error', 'cell_index': cell_index, 'error': error_payload})
            pub.send_json({'type': 'execution_complete', 'cell_index': cell_index, 'result': {'status': status, 'execution_count': exec_count, 'execution_time': duration_ms, 'outputs': [], 'error': error_payload}})
            rep.send_json({'ok': True, 'pid': os.getpid()})
            current_cell = None

    try:
        rep.close(0); pub.close(0)
    except Exception:
        pass
    try:
        ctx.term()
    except Exception:
        pass


if __name__ == '__main__':
    worker_main()
