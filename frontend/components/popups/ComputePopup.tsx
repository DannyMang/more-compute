import React, { useState, useEffect } from "react";
import { Zap, ExternalLink, Plus, Activity } from "lucide-react";

interface GPUPod {
  id: string;
  name: string;
  status: "running" | "stopped" | "starting";
  gpuType: string;
  region: string;
  costPerHour: number;
}

interface ComputePopupProps {
  onClose?: () => void;
}

const ComputePopup: React.FC<ComputePopupProps> = ({ onClose }) => {
  const [gpuPods, setGpuPods] = useState<GPUPod[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadGPUPods();
  }, []);

  const loadGPUPods = async () => {
    try {
      setLoading(true);
      // Mock GPU pods data - replace with real API later
      const mockPods: GPUPod[] = [
        {
          id: "pod-1",
          name: "H100 Pod",
          status: "running",
          gpuType: "H100_80GB",
          region: "us-east-1",
          costPerHour: 2.49,
        },
        {
          id: "pod-2",
          name: "A100 Pod",
          status: "stopped",
          gpuType: "A100_40GB",
          region: "us-west-2",
          costPerHour: 1.1,
        },
      ];
      setGpuPods(mockPods);
    } catch (err) {
      console.error("Failed to load GPU pods:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectToPrimeIntellect = () => {
    window.open("https://app.primeintellect.ai", "_blank");
  };

  return (
    <div className="runtime-popup">
      {/* Kernel Status Section */}
      <section className="runtime-section">
        <h3 className="runtime-section-title">Kernel</h3>
        <div className="runtime-kernel-status">
          The kernel is currently{" "}
          <span className="kernel-status-active">running</span>.
        </div>
        <button className="runtime-btn runtime-btn-secondary">
          Stop kernel
        </button>
      </section>

      {/* Compute Profile Section */}
      <section className="runtime-section">
        <div className="runtime-section-header">
          <h3 className="runtime-section-title">Compute profile</h3>
          <span className="runtime-cost">$0.00 / hour</span>
        </div>

        <p className="runtime-subtitle">
          CPU and RAM are <em>reservations</em>. Usage can burst above the
          configured values.
        </p>

        {/* GPU Pods Section */}
        <div className="runtime-subsection">
          <div className="runtime-subsection-header">
            <h4 className="runtime-subsection-title">
              <Zap size={16} style={{ marginRight: "6px" }} />
              Remote GPU Pods
            </h4>
          </div>

          {gpuPods.length === 0 ? (
            <div className="runtime-empty-state">
              <p
                style={{ marginBottom: "12px", color: "var(--text-secondary)" }}
              >
                No GPU pods configured
              </p>
              <button
                className="runtime-btn runtime-btn-primary"
                onClick={handleConnectToPrimeIntellect}
              >
                <ExternalLink size={14} style={{ marginRight: "6px" }} />
                Connect to Prime Intellect
              </button>
            </div>
          ) : (
            <>
              <div className="runtime-gpu-list">
                {gpuPods.map((pod) => (
                  <div key={pod.id} className="runtime-gpu-item">
                    <div className="runtime-gpu-info">
                      <div className="runtime-gpu-header">
                        <span className="runtime-gpu-name">{pod.name}</span>
                        <span
                          className={`runtime-status-badge runtime-status-${pod.status}`}
                        >
                          <Activity size={10} />
                          {pod.status}
                        </span>
                      </div>
                      <div className="runtime-gpu-details">
                        <span className="runtime-gpu-type">{pod.gpuType}</span>
                        <span className="runtime-gpu-region">{pod.region}</span>
                        <span className="runtime-gpu-cost">
                          ${pod.costPerHour.toFixed(2)}/hour
                        </span>
                      </div>
                    </div>
                    <div>
                      {pod.status === "running" ? (
                        <button className="runtime-btn runtime-btn-sm">
                          Connect
                        </button>
                      ) : (
                        <button className="runtime-btn runtime-btn-sm runtime-btn-secondary">
                          Start
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="runtime-btn runtime-btn-link"
                onClick={handleConnectToPrimeIntellect}
              >
                <Plus size={14} style={{ marginRight: "4px" }} />
                Add new pod
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
};

export default ComputePopup;
