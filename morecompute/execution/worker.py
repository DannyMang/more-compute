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
                if command_type == 'special':
                    # This path should be handled in-process; worker only handles python execution
                    exec_count += 1
                    pub.send_json({'type': 'execution_complete', 'cell_index': cell_index, 'result': {'status': 'ok', 'execution_count': exec_count, 'execution_time': '0.0ms', 'outputs': [], 'error': None}})
                    rep.send_json({'ok': True})
                    current_cell = None
                    continue
                compiled = compile(code, '<cell>', 'exec')
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
