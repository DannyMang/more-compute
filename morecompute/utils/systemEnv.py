import os
import time
import shutil
import subprocess
from typing import Any, Dict, List, Optional

import psutil  # type: ignore


class DeviceMetrics:
    """Collects system metrics with graceful fallbacks.

    - Uses psutil for CPU, memory, disk, network and process metrics
    - Uses nvidia-smi when available for basic GPU metrics
    """

    def get_all_devices(self) -> Dict[str, Any]:
        return {
            "timestamp": time.time(),
            "cpu": self.get_cpu_metrics(),
            "memory": self.get_memory_metrics(),
            "gpu": self.get_gpu_metrics(),
            "storage": self.get_storage_metrics(),
            "network": self.get_network_metrics(),
            "process": self.get_process_metrics(),
        }

    def get_cpu_metrics(self) -> Dict[str, Any]:
        try:
            cpu_percent = psutil.cpu_percent(interval=None)
            freq = psutil.cpu_freq()
            return {
                "percent": cpu_percent,
                "frequency_mhz": freq.current if freq else None,
                "cores": psutil.cpu_count(logical=True),
            }
        except Exception:
            return {"percent": None, "frequency_mhz": None, "cores": None}

    def get_memory_metrics(self) -> Dict[str, Any]:
        try:
            vm = psutil.virtual_memory()
            sm = psutil.swap_memory()
            return {
                "total": vm.total,
                "available": vm.available,
                "used": vm.used,
                "percent": vm.percent,
                "swap_total": sm.total,
                "swap_used": sm.used,
                "swap_percent": sm.percent,
            }
        except Exception:
            return {"total": None, "available": None, "used": None, "percent": None}

    def get_gpu_metrics(self) -> Optional[List[Dict[str, Any]]]:
        """Return list of GPU dicts or None when no GPU available.

        Uses nvidia-smi if present. If not found or fails, returns None.
        """
        if shutil.which("nvidia-smi") is None:
            return None
        try:
            # Query a few basic metrics; avoid JSON for broader compat
            query = "power.draw,clocks.sm,temperature.gpu,utilization.gpu,memory.used,memory.total"
            cmd = [
                "nvidia-smi",
                f"--query-gpu={query}",
                "--format=csv,noheader,nounits",
            ]
            out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT, timeout=3)
            gpus: List[Dict[str, Any]] = []
            for line in out.strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 6:
                    gpus.append(
                        {
                            "power_w": _to_float(parts[0]),
                            "clock_sm_mhz": _to_float(parts[1]),
                            "temperature_c": _to_float(parts[2]),
                            "util_percent": _to_float(parts[3]),
                            "mem_used_mb": _to_float(parts[4]),
                            "mem_total_mb": _to_float(parts[5]),
                        }
                    )
            return gpus or None
        except Exception:
            return None

    def get_storage_metrics(self) -> Dict[str, Any]:
        try:
            usage = psutil.disk_usage("/")
            io = psutil.disk_io_counters()
            return {
                "total": usage.total,
                "used": usage.used,
                "percent": usage.percent,
                "read_bytes": getattr(io, "read_bytes", None),
                "write_bytes": getattr(io, "write_bytes", None),
            }
        except Exception:
            return {"total": None, "used": None, "percent": None}

    def get_network_metrics(self) -> Dict[str, Any]:
        try:
            net = psutil.net_io_counters()
            return {
                "bytes_sent": net.bytes_sent,
                "bytes_recv": net.bytes_recv,
                "packets_sent": net.packets_sent,
                "packets_recv": net.packets_recv,
            }
        except Exception:
            return {"bytes_sent": None, "bytes_recv": None}

    def get_process_metrics(self) -> Dict[str, Any]:
        try:
            p = psutil.Process(os.getpid())
            mem = p.memory_info()
            return {
                "rss": mem.rss,
                "vms": getattr(mem, "vms", None),
                "threads": p.num_threads(),
                "cpu_percent": p.cpu_percent(interval=None),
            }
        except Exception:
            return {"rss": None, "threads": None}


def _to_float(value: str) -> Optional[float]:
    try:
        return float(value)
    except Exception:
        return None
