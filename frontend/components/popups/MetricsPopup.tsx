import React, { useEffect, useRef, useState } from "react";
import { fetchMetrics, type MetricsSnapshot } from "@/lib/api";
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Gauge,
  ServerCrash,
} from "lucide-react";

const POLL_MS = 3000;

const MetricsPopup: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [history, setHistory] = useState<MetricsSnapshot[]>([]);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await fetchMetrics();
        setMetrics(snap);
        setHistory((prev) => {
          const arr = [...prev, snap];
          return arr.slice(-100);
        });
      } catch {}
    };
    load();
    intervalRef.current = window.setInterval(load, POLL_MS);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, []);

  const hasGPU = metrics?.gpu && metrics.gpu.length > 0;

  return (
    <div className="metrics-container">
      <div className="metrics-grid">
        {metrics?.cpu && (
          <Panel title="CPU Utilization" icon={<Cpu size={14} />}>
            <BigValue
              value={fmtPct(metrics.cpu.percent)}
              subtitle={`${metrics.cpu.cores ?? "-"} cores`}
            />
            <MiniChart data={history.map((h) => h.cpu?.percent ?? 0)} />
          </Panel>
        )}

        {metrics?.memory && (
          <Panel title="Memory In Use" icon={<MemoryStick size={14} />}>
            <BigValue
              value={fmtPct(metrics.memory.percent)}
              subtitle={`${fmtBytes(metrics.memory.used)} / ${fmtBytes(metrics.memory.total)}`}
            />
            <MiniChart data={history.map((h) => h.memory?.percent ?? 0)} />
          </Panel>
        )}

        {metrics?.storage && (
          <Panel title="Disk Utilization" icon={<HardDrive size={14} />}>
            <BigValue
              value={fmtPct(metrics.storage.percent)}
              subtitle={`${fmtBytes(metrics.storage.used)} / ${fmtBytes(metrics.storage.total)}`}
            />
            <MiniChart data={history.map((h) => h.storage?.percent ?? 0)} />
          </Panel>
        )}

        {hasGPU && (
          <Panel title="GPU Utilization" icon={<Gauge size={14} />}>
            <BigValue
              value={fmtPct(metrics!.gpu![0].util_percent)}
              subtitle={`Temp ${metrics!.gpu![0].temperature_c ?? "-"}°C`}
            />
            <MiniChart
              data={history.map((h) => (h.gpu && h.gpu[0]?.util_percent) || 0)}
            />
          </Panel>
        )}

        {metrics?.network && (
          <Panel title="Network" icon={<Activity size={14} />}>
            <BigValue
              value={`${fmtBytes(metrics.network.bytes_recv)} ↓ / ${fmtBytes(metrics.network.bytes_sent)} ↑`}
              subtitle="total"
            />
          </Panel>
        )}

        {metrics?.process && (
          <Panel title="Process" icon={<ServerCrash size={14} />}>
            <BigValue
              value={`${fmtBytes(metrics.process.rss)} RSS`}
              subtitle={`${metrics.process.threads ?? "-"} threads`}
            />
          </Panel>
        )}
      </div>
    </div>
  );
};

const Panel: React.FC<{
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => {
  return (
    <div className="metric-panel">
      <div className="metric-panel-header">
        <span className="metric-panel-title">
          {icon}
          {icon && " "}
          {title}
        </span>
      </div>
      <div className="metric-panel-body">{children}</div>
    </div>
  );
};

const BigValue: React.FC<{ value: string; subtitle?: string }> = ({
  value,
  subtitle,
}) => (
  <div className="metric-big-value">
    <div className="value">{value}</div>
    {subtitle && <div className="subtitle">{subtitle}</div>}
  </div>
);

const MiniChart: React.FC<{ data: number[] }> = ({ data }) => {
  const width = 220;
  const height = 48;
  const max = Math.max(100, ...data);
  const points = data
    .map((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * width;
      const y = height - (Math.min(100, Math.max(0, v)) / max) * height;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="mini-chart">
      <polyline points={points} fill="none" stroke="#3b82f6" strokeWidth="2" />
    </svg>
  );
};

function fmtPct(v?: number | null): string {
  return v == null ? "-" : `${v.toFixed(0)}%`;
}
function fmtBytes(v?: number | null): string {
  if (v == null) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let val = v;
  let u = 0;
  while (val >= 1024 && u < units.length - 1) {
    val /= 1024;
    u++;
  }
  return `${val.toFixed(1)} ${units[u]}`;
}

export default MetricsPopup;
