import os
import sys
import time
import signal
import base64
import io
import traceback


def _setup_worker_signals():
    def _handler(signum, frame):
        # Exit quickly; parent will respawn if needed
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        os._exit(0)

    signal.signal(signal.SIGTERM, _handler)
    try:
        signal.signal(signal.SIGINT, _handler)
    except Exception:
        pass


class _StreamForwarder:
    def __init__(self, output_queue, stream_name, cell_index):
        self.output_queue = output_queue
        self.stream_name = stream_name
        self.buf = []
        self.cell_index = cell_index

    def write(self, text):
        if not text:
            return
        # Handle carriage returns for progress bars by emitting stream_update
        if '\r' in text and '\n' not in text:
            # Overwrite current line
            self.output_queue.put({
                'type': 'stream_update',
                'name': self.stream_name,
                'text': text.split('\r')[-1],
                'cell_index': self.cell_index,
            })
            return
        lines = text.split('\n')
        for i, line in enumerate(lines):
            if i < len(lines) - 1:
                self.buf.append(line)
                complete = ''.join(self.buf) + '\n'
                self.output_queue.put({
                    'type': 'stream',
                    'name': self.stream_name,
                    'text': complete,
                    'cell_index': self.cell_index,
                })
                self.buf = []
            else:
                self.buf.append(line)

    def flush(self):
        if self.buf:
            self.output_queue.put({
                'type': 'stream',
                'name': self.stream_name,
                'text': ''.join(self.buf),
                'cell_index': self.cell_index,
            })
            self.buf = []


def _capture_matplotlib(output_queue, cell_index):
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except Exception:
        return
    try:
        figs = plt.get_fignums()
        if not figs:
            return
        for num in figs:
            try:
                fig = plt.figure(num)
                buf = io.BytesIO()
                fig.savefig(buf, format='png', bbox_inches='tight')
                buf.seek(0)
                b64 = base64.b64encode(buf.read()).decode('ascii')
                output_queue.put({
                    'type': 'display_data',
                    'data': {
                        'image/png': b64,
                        'text/plain': f'<Figure size {int(fig.get_figwidth()*fig.dpi)}x{int(fig.get_figheight()*fig.dpi)}>'
                    },
                    'cell_index': cell_index,
                })
            except Exception:
                continue
        try:
            plt.close('all')
        except Exception:
            pass
    except Exception:
        return


def worker_main(command_queue, output_queue, shutdown_event):
    # New process group for POSIX
    try:
        if os.name != 'nt':
            os.setsid()
    except Exception:
        pass

    _setup_worker_signals()
    user_globals = {"__name__": "__main__"}
    user_locals = user_globals
    exec_count = 0

    while not shutdown_event.is_set():
        try:
            try:
                cmd = command_queue.get(timeout=0.1)
            except Exception:
                continue

            if not isinstance(cmd, dict):
                continue

            ctype = cmd.get('type')
            if ctype == 'shutdown':
                break
            if ctype == 'execute_cell':
                code = cmd.get('code', '')
                cell_index = cmd.get('cell_index')
                output_queue.put({'type': 'execution_start', 'cell_index': cell_index, 'execution_count': exec_count + 1})

                # Redirect stdout/stderr
                old_out, old_err = sys.stdout, sys.stderr
                sys.stdout = _StreamForwarder(output_queue, 'stdout', cell_index)
                sys.stderr = _StreamForwarder(output_queue, 'stderr', cell_index)
                start = time.time()
                status = 'ok'
                error_payload = None
                try:
                    compiled = compile(code, '<cell>', 'exec')
                    exec(compiled, user_globals, user_locals)
                    # Try to evaluate last expression (simple heuristic)
                    lines = code.strip().split('\n')
                    if lines:
                        last = lines[-1].strip()
                        if last and not last.startswith('#'):
                            try:
                                result = eval(last, user_globals, user_locals)
                            except Exception:
                                result = None
                            else:
                                if result is not None:
                                    output_queue.put({
                                        'type': 'execute_result',
                                        'cell_index': cell_index,
                                        'execution_count': exec_count + 1,
                                        'data': {'text/plain': repr(result)}
                                    })
                    _capture_matplotlib(output_queue, cell_index)
                except KeyboardInterrupt:
                    status = 'error'
                    error_payload = {
                        'ename': 'KeyboardInterrupt',
                        'evalue': 'Execution interrupted by user',
                        'traceback': []
                    }
                except Exception as exc:
                    status = 'error'
                    tb = traceback.format_exc().split('\n')
                    error_payload = {
                        'ename': type(exc).__name__,
                        'evalue': str(exc),
                        'traceback': tb
                    }
                finally:
                    try:
                        sys.stdout.flush(); sys.stderr.flush()
                    except Exception:
                        pass
                    sys.stdout, sys.stderr = old_out, old_err

                exec_count += 1
                duration_ms = f"{(time.time()-start)*1000:.1f}ms"
                if error_payload:
                    output_queue.put({'type': 'execution_error', 'cell_index': cell_index, 'error': error_payload})
                output_queue.put({
                    'type': 'execution_complete',
                    'cell_index': cell_index,
                    'result': {
                        'status': status,
                        'execution_count': exec_count,
                        'execution_time': duration_ms,
                        'outputs': [],
                        'error': error_payload,
                    }
                })
        except Exception:
            # Avoid worker crash on unexpected errors
            continue


