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

interface MetricsPopupProps {
  onClose?: () => void;
  sharedHistory?: MetricsSnapshot[]; // Passed from parent when in persistent mode
}

const MetricsPopup: React.FC<MetricsPopupProps> = ({ onClose, sharedHistory }) => {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [localHistory, setLocalHistory] = useState<MetricsSnapshot[]>([]);
  const intervalRef = useRef<number | null>(null);

  // Use shared history if provided (persistent mode), otherwise use local history (on-demand mode)
  const history = sharedHistory ?? localHistory;
  const isPersistentMode = sharedHistory !== undefined;

  // Update current metrics from shared history
  useEffect(() => {
    if (isPersistentMode && sharedHistory && sharedHistory.length > 0) {
      setMetrics(sharedHistory[sharedHistory.length - 1]);
    }
  }, [isPersistentMode, sharedHistory]);

  // On-demand mode: poll metrics when popup is open
  useEffect(() => {
    if (isPersistentMode) {
      // Don't poll in persistent mode - use shared history
      return;
    }

    const load = async () => {
      try {
        const snap = await fetchMetrics();
        setMetrics(snap);
        setLocalHistory((prev) => {
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
  }, [isPersistentMode]);

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

        {hasGPU && metrics!.gpu!.map((gpu, index) => (
          <Panel
            key={index}
            title={`GPU ${index} Utilization`}
            icon={<Gauge size={14} />}
          >
            <BigValue
              value={fmtPct(gpu.util_percent)}
              subtitle={`Temp ${gpu.temperature_c ?? "-"}°C`}
            />
            <MiniChart
              data={history.map((h) => (h.gpu && h.gpu[index]?.util_percent) || 0)}
            />
          </Panel>
        ))}

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
  const width = 100;
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
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="mini-chart"
      style={{ display: 'block' }}
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--mc-primary)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
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
