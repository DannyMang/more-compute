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
import threading

# Import shared shell command utilities
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.shell_utils import prepare_shell_command, prepare_shell_environment

# Global reference to current subprocess for interrupt handling
_current_subprocess = None
_interrupt_requested = False
_current_process_group = None  # Store process group ID

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
            global _current_subprocess, _interrupt_requested, _current_process_group

            # Check if already interrupted before starting new command
            if _interrupt_requested:
                print(f"[WORKER] Shell command skipped due to previous interrupt", file=sys.stderr, flush=True)
                raise KeyboardInterrupt("Execution was interrupted")

            # Prepare command and environment (using shared utilities)
            shell_cmd = prepare_shell_command(cmd)
            env = prepare_shell_environment(cmd)

            # Use Popen for real-time streaming, CREATE NEW PROCESS GROUP
            process = subprocess.Popen(
                shell_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,  # Line buffered
                env=env,
                preexec_fn=os.setsid if os.name != 'nt' else None  # Create new process group on Unix
            )

            # Store reference globally for interrupt handling
            _current_subprocess = process
            if os.name != 'nt':
                _current_process_group = os.getpgid(process.pid)
                # Also create a new process group for clean killing
                print(f"[WORKER] Started subprocess PID={process.pid}, PGID={_current_process_group}", file=sys.stderr, flush=True)
            else:
                print(f"[WORKER] Started subprocess PID={process.pid}", file=sys.stderr, flush=True)

            sys.stderr.flush()

            try:
                # Stream output line by line
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

                # Wait for process to complete, checking interrupt flag
                while True:
                    try:
                        return_code = process.wait(timeout=0.01)  # 10ms for faster interrupt response
                        break
                    except subprocess.TimeoutExpired:
                        # Check if interrupted
                        if _interrupt_requested:
                            print(f"[WORKER] Interrupt detected, killing subprocess", file=sys.stderr, flush=True)
                            try:
                                process.kill()
                            except Exception:
                                pass
                            # Close pipes to unblock reader threads
                            try:
                                process.stdout.close()
                            except Exception:
                                pass
                            try:
                                process.stderr.close()
                            except Exception:
                                pass
                            # Don't wait for process or threads - raise immediately
                            print(f"[WORKER] Raising KeyboardInterrupt immediately", file=sys.stderr, flush=True)
                            raise KeyboardInterrupt("Execution interrupted by user")

                # Normal completion - join threads briefly
                stdout_thread.join(timeout=0.1)
                stderr_thread.join(timeout=0.1)

                return return_code
            except KeyboardInterrupt:
                # Kill subprocess on interrupt
                try:
                    process.kill()
                    process.wait(timeout=1)
                except Exception:
                    pass
                raise
            finally:
                _current_subprocess = None
                _current_process_group = None

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


def control_thread_main(ctrl, current_cell_ref):
    """Run control channel in separate thread (Jupyter pattern)"""
    global _interrupt_requested, _current_subprocess, _current_process_group

    print(f"[CONTROL] Control thread started", file=sys.stderr, flush=True)

    while True:
        try:
            # Block waiting for control messages
            identity = ctrl.recv()
            msg = ctrl.recv_json()

            print(f"[CONTROL] Received: {msg}", file=sys.stderr, flush=True)

            mtype = msg.get('type')
            if mtype == 'interrupt':
                requested_cell = msg.get('cell_index')
                current_cell = current_cell_ref[0]

                print(f"[CONTROL] Interrupt check: requested={requested_cell}, current={current_cell}, subprocess={_current_subprocess}, pgid={_current_process_group}", file=sys.stderr)
                sys.stderr.flush()

                if requested_cell is None or requested_cell == current_cell:
                    print(f"[CONTROL] ✓ Match! Processing interrupt for cell {requested_cell}", file=sys.stderr)
                    sys.stderr.flush()

                    # Set global flag
                    _interrupt_requested = True

                    # Send SIGINT to process group (Jupyter pattern)
                    if _current_process_group and os.name != 'nt':
                        try:
                            print(f"[CONTROL] Sending SIGINT to process group {_current_process_group}", file=sys.stderr)
                            sys.stderr.flush()
                            os.killpg(_current_process_group, signal.SIGINT)
                            print(f"[CONTROL] SIGINT sent successfully", file=sys.stderr)
                            sys.stderr.flush()
                        except Exception as e:
                            print(f"[CONTROL] Failed to kill process group: {e}", file=sys.stderr)
                            sys.stderr.flush()

                    # Also kill subprocess directly
                    if _current_subprocess:
                        try:
                            print(f"[CONTROL] Killing subprocess PID={_current_subprocess.pid}", file=sys.stderr)
                            sys.stderr.flush()
                            _current_subprocess.kill()
                            print(f"[CONTROL] Subprocess killed", file=sys.stderr)
                            sys.stderr.flush()
                        except Exception as e:
                            print(f"[CONTROL] Failed to kill subprocess: {e}", file=sys.stderr)
                            sys.stderr.flush()

                    # Don't send SIGINT to self - let the execution thread finish gracefully
                    # Sending SIGINT here can interrupt the execution thread before it sends
                    # completion messages, leaving the frontend in a confused state
                    print(f"[CONTROL] Interrupt signal sent, waiting for execution thread to finish", file=sys.stderr)
                    sys.stderr.flush()
                else:
                    print(f"[CONTROL] ✗ NO MATCH! Ignoring interrupt (requested cell {requested_cell} != current cell {current_cell})", file=sys.stderr)
                    sys.stderr.flush()

                # Reply
                ctrl.send(identity, zmq.SNDMORE)
                ctrl.send_json({'ok': True, 'pid': os.getpid()})

            elif mtype == 'shutdown':
                ctrl.send(identity, zmq.SNDMORE)
                ctrl.send_json({'ok': True, 'pid': os.getpid()})
                break

        except Exception as e:
            print(f"[CONTROL] Error: {e}", file=sys.stderr, flush=True)
            import traceback
            traceback.print_exc()


def worker_main():
    global _current_subprocess, _interrupt_requested, _current_process_group

    print(f"[WORKER] ========================================", file=sys.stderr, flush=True)
    print(f"[WORKER] Starting THREADED worker (new code!)", file=sys.stderr, flush=True)
    print(f"[WORKER] PID: {os.getpid()}", file=sys.stderr, flush=True)
    print(f"[WORKER] ========================================", file=sys.stderr, flush=True)

    _setup_signals()
    cmd_addr = os.environ['MC_ZMQ_CMD_ADDR']
    pub_addr = os.environ['MC_ZMQ_PUB_ADDR']
    ctrl_addr = os.environ.get('MC_ZMQ_CTRL_ADDR', cmd_addr.replace('5555', '5557'))

    print(f"[WORKER] Binding to control socket: {ctrl_addr}", file=sys.stderr, flush=True)

    ctx = zmq.Context.instance()
    rep = ctx.socket(zmq.REP)
    rep.bind(cmd_addr)
    rep.setsockopt(zmq.RCVTIMEO, 100)  # 100ms timeout for heartbeat

    pub = ctx.socket(zmq.PUB)
    pub.bind(pub_addr)

    # Separate control socket for interrupts
    ctrl = ctx.socket(zmq.ROUTER)
    ctrl.bind(ctrl_addr)

    # Shared reference for current cell (thread-safe via list)
    current_cell_ref = [None]

    # Start control thread (Jupyter pattern)
    ctrl_thread = threading.Thread(target=control_thread_main, args=(ctrl, current_cell_ref), daemon=True)
    ctrl_thread.start()
    print(f"[WORKER] Started control thread", file=sys.stderr, flush=True)

    # Persistent REPL state
    g = {"__name__": "__main__"}
    l = g
    exec_count = 0

    last_hb = time.time()
    shutdown_requested = False

    while True:
        try:
            msg = rep.recv_json()
        except zmq.Again:
            # Timeout - send heartbeat
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
            continue
        if mtype == 'execute_cell':
            code = msg.get('code', '')
            cell_index = msg.get('cell_index')
            requested_count = msg.get('execution_count')

            print(f"[WORKER] Setting current_cell_ref[0] = {cell_index}", file=sys.stderr, flush=True)
            current_cell_ref[0] = cell_index  # Update for control thread
            print(f"[WORKER] Confirmed current_cell_ref[0] = {current_cell_ref[0]}", file=sys.stderr, flush=True)

            if isinstance(requested_count, int):
                exec_count = requested_count - 1

            # Reset interrupt flag
            _interrupt_requested = False

            pub.send_json({'type': 'execution_start', 'cell_index': cell_index, 'execution_count': exec_count + 1})

            # Check if this is a special command (shell command starting with !)
            is_special_cmd = code.strip().startswith('!')

            if is_special_cmd:
                # Handle shell commands
                exec_count += 1
                status = 'ok'
                error_payload = None
                start = time.time()

                try:
                    shell_cmd = code.strip()[1:].strip()
                    print(f"[WORKER] Executing shell: {shell_cmd[:50]}...", file=sys.stderr, flush=True)

                    # Run shell command with streaming
                    process = subprocess.Popen(
                        ['/bin/bash', '-c', shell_cmd],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        bufsize=1,  # Line buffered
                        preexec_fn=os.setsid if os.name != 'nt' else None  # New process group
                    )

                    # Store reference for interrupt handling
                    _current_subprocess = process
                    if os.name != 'nt':
                        _current_process_group = os.getpgid(process.pid)

                    try:
                        # Stream output in real-time
                        def stream_output(stream, stream_name):
                            try:
                                for line in iter(stream.readline, ''):
                                    if not line:
                                        break
                                    pub.send_json({
                                        'type': 'stream',
                                        'name': stream_name,
                                        'text': line,
                                        'cell_index': cell_index
                                    })
                            except Exception:
                                pass
                            finally:
                                stream.close()

                        stdout_thread = threading.Thread(target=stream_output, args=(process.stdout, 'stdout'))
                        stderr_thread = threading.Thread(target=stream_output, args=(process.stderr, 'stderr'))
                        stdout_thread.daemon = True
                        stderr_thread.daemon = True
                        stdout_thread.start()
                        stderr_thread.start()

                        # Wait for process, checking interrupt flag
                        while True:
                            try:
                                return_code = process.wait(timeout=0.01)  # 10ms for faster interrupt response
                                break
                            except subprocess.TimeoutExpired:
                                if _interrupt_requested:
                                    print(f"[WORKER] Interrupt detected, killing shell process", file=sys.stderr, flush=True)
                                    try:
                                        process.kill()
                                    except Exception:
                                        pass
                                    # Close pipes to unblock reader threads
                                    try:
                                        process.stdout.close()
                                    except Exception:
                                        pass
                                    try:
                                        process.stderr.close()
                                    except Exception:
                                        pass
                                    # Set interrupted status immediately
                                    print(f"[WORKER] Setting error status for interrupted shell command", file=sys.stderr, flush=True)
                                    status = 'error'
                                    error_payload = {
                                        'ename': 'KeyboardInterrupt',
                                        'evalue': 'Execution interrupted',
                                        'traceback': []
                                    }
                                    # Break out and send completion immediately
                                    break

                        # For normal completion (not interrupted), join threads and check return code
                        if not _interrupt_requested:
                            # Give threads brief time to finish
                            stdout_thread.join(timeout=0.1)
                            stderr_thread.join(timeout=0.1)

                            print(f"[WORKER] Shell process finished: return_code={return_code}", file=sys.stderr, flush=True)

                            # Check return code
                            if return_code != 0:
                                status = 'error'
                                error_payload = {
                                    'ename': 'ShellCommandError',
                                    'evalue': f'Command failed with return code {return_code}',
                                    'traceback': [f'Shell command failed: {shell_cmd}']
                                }
                                print(f"[WORKER] Set error_payload to ShellCommandError", file=sys.stderr, flush=True)
                    except KeyboardInterrupt:
                        status = 'error'
                        error_payload = {
                            'ename': 'KeyboardInterrupt',
                            'evalue': 'Execution interrupted',
                            'traceback': []
                        }
                    finally:
                        _current_subprocess = None
                        _current_process_group = None

                except Exception as exc:
                    status = 'error'
                    error_payload = {'ename': type(exc).__name__, 'evalue': str(exc), 'traceback': traceback.format_exc().split('\n')}

                duration_ms = f"{(time.time()-start)*1000:.1f}ms"
                print(f"[WORKER] Sending completion messages: status={status}, error={error_payload is not None}", file=sys.stderr, flush=True)
                if error_payload:
                    pub.send_json({'type': 'execution_error', 'cell_index': cell_index, 'error': error_payload})
                    print(f"[WORKER] Sent execution_error", file=sys.stderr, flush=True)
                pub.send_json({'type': 'execution_complete', 'cell_index': cell_index, 'result': {'status': status, 'execution_count': exec_count, 'execution_time': duration_ms, 'outputs': [], 'error': error_payload}})
                print(f"[WORKER] Sent execution_complete", file=sys.stderr, flush=True)
                rep.send_json({'ok': True, 'pid': os.getpid()})

                print(f"[WORKER] Clearing current_cell_ref[0] (was {current_cell_ref[0]})", file=sys.stderr, flush=True)
                current_cell_ref[0] = None
                print(f"[WORKER] Confirmed current_cell_ref[0] = {current_cell_ref[0]}", file=sys.stderr, flush=True)
                continue

            # Regular Python code execution
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
                # Preprocess shell commands
                preprocessed_code = _preprocess_shell_commands(code)

                # Inject shell command function into globals
                _inject_shell_command_function(g)

                compiled = compile(preprocessed_code, '<cell>', 'exec')
                exec(compiled, g, l)

                # Try to evaluate last expression for display
                lines = code.strip().split('\n')
                if lines:
                    last = lines[-1].strip()
                    if not last or last.startswith('#'):
                        last = None
                    elif last.lstrip().startswith(')') or last.lstrip().startswith('}') or last.lstrip().startswith(']'):
                        last = None

                    if last:
                        is_statement = False
                        if '=' in last and not any(op in last for op in ['==', '!=', '<=', '>=', '=<', '=>']):
                            is_statement = True
                        statement_keywords = ['import', 'from', 'def', 'class', 'if', 'elif', 'else',
                                            'for', 'while', 'try', 'except', 'finally', 'with',
                                            'assert', 'del', 'global', 'nonlocal', 'pass', 'break',
                                            'continue', 'return', 'raise', 'yield']
                        first_word_match = re.match(r'^(\w+)', last)
                        first_word = first_word_match.group(1) if first_word_match else ''
                        if first_word in statement_keywords:
                            is_statement = True
                        if '(' in last and ')' in last:
                            is_statement = True

                        if not is_statement:
                            try:
                                res = eval(last, g, l)
                                if res is not None:
                                    pub.send_json({'type': 'execute_result', 'cell_index': cell_index, 'execution_count': exec_count + 1, 'data': {'text/plain': repr(res)}})
                            except Exception:
                                pass

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
            print(f"[WORKER] Sending completion messages (Python): status={status}, error={error_payload is not None}", file=sys.stderr, flush=True)
            if error_payload:
                pub.send_json({'type': 'execution_error', 'cell_index': cell_index, 'error': error_payload})
                print(f"[WORKER] Sent execution_error", file=sys.stderr, flush=True)
            pub.send_json({'type': 'execution_complete', 'cell_index': cell_index, 'result': {'status': status, 'execution_count': exec_count, 'execution_time': duration_ms, 'outputs': [], 'error': error_payload}})
            print(f"[WORKER] Sent execution_complete", file=sys.stderr, flush=True)
            rep.send_json({'ok': True, 'pid': os.getpid()})

            print(f"[WORKER] Clearing current_cell_ref[0] (was {current_cell_ref[0]})", file=sys.stderr, flush=True)
            current_cell_ref[0] = None
            print(f"[WORKER] Confirmed current_cell_ref[0] = {current_cell_ref[0]}", file=sys.stderr, flush=True)

    try:
        rep.close(0); pub.close(0); ctrl.close(0)
    except Exception:
        pass
    try:
        ctx.term()
    except Exception:
        pass


if __name__ == '__main__':
    worker_main()
