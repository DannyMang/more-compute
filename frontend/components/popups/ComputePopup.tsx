import React, { useState, useEffect } from "react";
import {
  Zap,
  ExternalLink,
  Plus,
  Activity,
  Search,
  Filter,
} from "lucide-react";
import {
  fetchGpuPods,
  fetchGpuConfig,
  setGpuApiKey,
  fetchGpuAvailability,
  createGpuPod,
  PodResponse,
  PodsListParams,
  GpuAvailability,
  GpuAvailabilityParams,
  CreatePodRequest,
} from "@/lib/api";

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

const GPU_TYPES = [
  { value: "H100_80GB", label: "H100 80GB" },
  { value: "H200_96GB", label: "H200 96GB" },
  { value: "GH200_96GB", label: "GH200 96GB" },
  { value: "H200_141GB", label: "H200 141GB" },
  { value: "B200_180GB", label: "B200 180GB" },
  { value: "A100_80GB", label: "A100 80GB" },
  { value: "A100_40GB", label: "A100 40GB" },
  { value: "A10_24GB", label: "A10 24GB" },
  { value: "A30_24GB", label: "A30 24GB" },
  { value: "A40_48GB", label: "A40 48GB" },
  { value: "RTX4090_24GB", label: "RTX 4090 24GB" },
  { value: "RTX5090_32GB", label: "RTX 5090 32GB" },
  { value: "RTX4080_16GB", label: "RTX 4080 16GB" },
  { value: "RTX4080Ti_16GB", label: "RTX 4080 Ti 16GB" },
  { value: "RTX4070Ti_12GB", label: "RTX 4070 Ti 12GB" },
  { value: "RTX3090_24GB", label: "RTX 3090 24GB" },
  { value: "RTX3090Ti_24GB", label: "RTX 3090 Ti 24GB" },
  { value: "RTX3080_10GB", label: "RTX 3080 10GB" },
  { value: "RTX3080Ti_12GB", label: "RTX 3080 Ti 12GB" },
  { value: "RTX3070_8GB", label: "RTX 3070 8GB" },
  { value: "L40S_48GB", label: "L40S 48GB" },
  { value: "L40_48GB", label: "L40 48GB" },
  { value: "L4_24GB", label: "L4 24GB" },
  { value: "V100_32GB", label: "V100 32GB" },
  { value: "V100_16GB", label: "V100 16GB" },
  { value: "T4_16GB", label: "T4 16GB" },
  { value: "P100_16GB", label: "P100 16GB" },
  { value: "A6000_48GB", label: "A6000 48GB" },
  { value: "A5000_24GB", label: "A5000 24GB" },
  { value: "A4000_16GB", label: "A4000 16GB" },
  { value: "RTX6000Ada_48GB", label: "RTX 6000 Ada 48GB" },
  { value: "RTX5000Ada_32GB", label: "RTX 5000 Ada 32GB" },
  { value: "RTX4000Ada_20GB", label: "RTX 4000 Ada 20GB" },
];

const ComputePopup: React.FC<ComputePopupProps> = ({ onClose }) => {
  const [gpuPods, setGpuPods] = useState<GPUPod[]>([]);
  const [loading, setLoading] = useState(false);
  const [kernelStatus, setKernelStatus] = useState(false);
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // GPU Availability state
  const [showBrowseGPUs, setShowBrowseGPUs] = useState(false);
  const [availableGPUs, setAvailableGPUs] = useState<GpuAvailability[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [filters, setFilters] = useState<GpuAvailabilityParams>({});
  const [creatingPodId, setCreatingPodId] = useState<string | null>(null);
  const [podCreationError, setPodCreationError] = useState<string | null>(null);

  useEffect(() => {
    const checkApiConfig = async () => {
      try {
        const config = await fetchGpuConfig();
        setApiConfigured(config.configured);
        if (config.configured) {
          await loadGPUPods();
        }
      } catch (err) {
        console.error("Failed to check GPU config:", err);
        setApiConfigured(false);
      }
    };
    checkApiConfig();
  }, []);

  const loadGPUPods = async (params?: PodsListParams) => {
    setLoading(true);
    try {
      const response = await fetchGpuPods(params || { limit: 100 });
      const pods = (response.data || []).map((pod: PodResponse) => ({
        id: pod.id,
        name: pod.name,
        status: pod.status as "running" | "stopped" | "starting",
        gpuType: pod.gpuName,
        region: "Unknown", //look at later
        costPerHour: pod.priceHr,
      }));
      setGpuPods(pods);
    } catch (err) {
      console.error("Failed to load GPU pods:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableGPUs = async () => {
    setLoadingAvailability(true);
    try {
      const response = await fetchGpuAvailability(filters);
      const gpuList: GpuAvailability[] = [];
      Object.values(response).forEach((gpus) => {
        gpuList.push(...gpus);
      });
      setAvailableGPUs(gpuList);
    } catch (err) {
      console.error("Failed to load GPU availability:", err);
    } finally {
      setLoadingAvailability(false);
    }
  };

  const createPodFromGpu = async (gpu: GpuAvailability) => {
    setCreatingPodId(gpu.cloudId);
    setPodCreationError(null);

    try {
      // Generate a pod name based on GPU type and timestamp
      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:-]/g, "");
      const podName = `${gpu.gpuType.toLowerCase()}-${timestamp}`;

      const podRequest: CreatePodRequest = {
        pod: {
          name: podName,
          type: "HOSTED",
          providerType: gpu.provider.toLowerCase(),
          gpuName: gpu.gpuType,
          gpuCount: gpu.gpuCount,
          socket: gpu.socket,
          priceHr: gpu.prices?.onDemand || 0,
          cloudId: gpu.cloudId,
          diskSize: gpu.disk?.defaultCount || 100,
          vcpus: gpu.vcpu?.defaultCount || 16,
          memory: gpu.memory?.defaultCount || 128,
          image: gpu.images?.[0] || "ubuntu_22_cuda_12",
          security: gpu.security,
        },
        provider: {
          type: gpu.provider.toLowerCase(),
        },
      };

      const newPod = await createGpuPod(podRequest);

      // Refresh the pods list
      await loadGPUPods();

      // Close browse section and show success
      setShowBrowseGPUs(false);
      alert(`Pod "${newPod.name}" created successfully!`);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to create pod";
      setPodCreationError(errorMsg);
      alert(`Failed to create pod: ${errorMsg}`);
    } finally {
      setCreatingPodId(null);
    }
  };

  const handleConnectToPrimeIntellect = () => {
    window.open("https://app.primeintellect.ai/dashboard/tokens", "_blank");
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      setSaveError("API key cannot be empty");
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      await setGpuApiKey(apiKey);
      setApiConfigured(true);
      setApiKey("");
      await loadGPUPods();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save API key",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="runtime-popup">
      {/* Kernel Status Section */}
      <section className="runtime-section" style={{ padding: "6px 12px" }}>
        <h3
          className="runtime-section-title"
          style={{ fontSize: "12px", marginBottom: "3px" }}
        >
          Kernel
        </h3>
        <div
          className="runtime-kernel-status"
          style={{ fontSize: "11px", marginBottom: "4px" }}
        >
          Kernel:{" "}
          <span
            className={
              kernelStatus ? "kernel-status-active" : "kernel-status-inactive"
            }
          >
            {kernelStatus ? "running" : "not running"}
          </span>
        </div>
        <button
          className="runtime-btn runtime-btn-secondary"
          style={{ fontSize: "11px", padding: "3px 8px" }}
        >
          Stop kernel
        </button>
      </section>

      {/* Compute Profile Section */}
      <section className="runtime-section" style={{ padding: "6px 12px" }}>
        <div className="runtime-section-header" style={{ marginBottom: "3px" }}>
          <h3 className="runtime-section-title" style={{ fontSize: "12px" }}>
            Compute profile
          </h3>
          <span className="runtime-cost" style={{ fontSize: "11px" }}>
            $0.00 / hour
          </span>
        </div>

        <p
          className="runtime-subtitle"
          style={{ fontSize: "10px", marginBottom: "6px" }}
        >
          CPU and RAM are reservations. Usage can burst above configured values.
        </p>

        {/* GPU Pods Section */}
        <div className="runtime-subsection">
          <div
            className="runtime-subsection-header"
            style={{ marginBottom: "4px" }}
          >
            <h4
              className="runtime-subsection-title"
              style={{ fontSize: "11px" }}
            >
              <Zap size={12} style={{ marginRight: "3px" }} />
              Remote GPU Pods
            </h4>
          </div>

          {apiConfigured === false ? (
            <div className="runtime-empty-state" style={{ padding: "6px" }}>
              <p
                style={{
                  marginBottom: "4px",
                  color: "var(--text-secondary)",
                  fontSize: "10px",
                }}
              >
                Enter API key to enable GPU pods
              </p>
              <div style={{ marginBottom: "4px", width: "100%" }}>
                <input
                  type="password"
                  placeholder="API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleSaveApiKey()}
                  style={{
                    width: "100%",
                    padding: "4px 6px",
                    borderRadius: "3px",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--background)",
                    color: "var(--text)",
                    fontSize: "11px",
                    marginBottom: "3px",
                  }}
                />
                {saveError && (
                  <p
                    style={{
                      color: "var(--error-color)",
                      fontSize: "10px",
                      marginBottom: "4px",
                    }}
                  >
                    {saveError}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: "4px", width: "100%" }}>
                <button
                  className="runtime-btn runtime-btn-primary"
                  onClick={handleSaveApiKey}
                  disabled={saving}
                  style={{ flex: 1, fontSize: "11px", padding: "4px 8px" }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  className="runtime-btn runtime-btn-secondary"
                  onClick={handleConnectToPrimeIntellect}
                  style={{ fontSize: "11px", padding: "4px 8px" }}
                >
                  <ExternalLink size={10} style={{ marginRight: "3px" }} />
                  Get Key
                </button>
              </div>
            </div>
          ) : loading || apiConfigured === null ? (
            <div className="runtime-empty-state" style={{ padding: "6px" }}>
              <p style={{ color: "var(--text-secondary)", fontSize: "10px" }}>
                Loading...
              </p>
            </div>
          ) : gpuPods.length === 0 ? (
            <div className="runtime-empty-state" style={{ padding: "6px" }}>
              <p
                style={{
                  marginBottom: "4px",
                  color: "var(--text-secondary)",
                  fontSize: "10px",
                }}
              >
                No GPU pods. Browse GPUs to create.
              </p>
              <div style={{ display: "flex", gap: "4px", width: "100%" }}>
                <button
                  className="runtime-btn runtime-btn-primary"
                  onClick={() => {
                    setShowBrowseGPUs(!showBrowseGPUs);
                    if (!showBrowseGPUs && availableGPUs.length === 0) {
                      loadAvailableGPUs();
                    }
                  }}
                  style={{ flex: 1, fontSize: "11px", padding: "4px 8px" }}
                >
                  <Search size={10} style={{ marginRight: "3px" }} />
                  Browse GPUs
                </button>
                <button
                  className="runtime-btn runtime-btn-secondary"
                  onClick={handleConnectToPrimeIntellect}
                  style={{ fontSize: "11px", padding: "4px 8px" }}
                >
                  <ExternalLink size={10} style={{ marginRight: "3px" }} />
                  Manage
                </button>
              </div>
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
                        <button
                          className="runtime-btn runtime-btn-sm"
                          style={{ fontSize: "11px", padding: "4px 8px" }}
                        >
                          Connect
                        </button>
                      ) : (
                        <button
                          className="runtime-btn runtime-btn-sm runtime-btn-secondary"
                          style={{ fontSize: "11px", padding: "4px 8px" }}
                        >
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
                style={{ fontSize: "12px", padding: "6px 8px" }}
              >
                <Plus size={12} style={{ marginRight: "4px" }} />
                Add new pod
              </button>
            </>
          )}
        </div>

        {/* Browse Available GPUs Section */}
        {apiConfigured && showBrowseGPUs && (
          <div className="runtime-subsection" style={{ marginTop: "6px" }}>
            <div
              className="runtime-subsection-header"
              style={{ marginBottom: "4px" }}
            >
              <h4
                className="runtime-subsection-title"
                style={{ fontSize: "11px" }}
              >
                <Filter size={10} style={{ marginRight: "2px" }} />
                Browse GPUs
              </h4>
              <button
                className="runtime-btn runtime-btn-sm runtime-btn-secondary"
                onClick={() => setShowBrowseGPUs(false)}
                style={{ fontSize: "10px", padding: "2px 6px" }}
              >
                Hide
              </button>
            </div>

            {/* Filters */}
            <div
              style={{
                marginBottom: "6px",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "4px",
                }}
              >
                <div>
                  <label
                    style={{
                      fontSize: "10px",
                      color: "var(--text-secondary)",
                      display: "block",
                      marginBottom: "1px",
                    }}
                  >
                    GPU Type
                  </label>
                  <select
                    value={filters.gpu_type || ""}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        gpu_type: e.target.value || undefined,
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "2px 4px",
                      borderRadius: "3px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--background)",
                      color: "var(--text)",
                      fontSize: "10px",
                      maxHeight: "100px",
                    }}
                    size={5}
                  >
                    <option value="">All Types</option>
                    {GPU_TYPES.map((gpu) => (
                      <option key={gpu.value} value={gpu.value}>
                        {gpu.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      fontSize: "10px",
                      color: "var(--text-secondary)",
                      display: "block",
                      marginBottom: "1px",
                    }}
                  >
                    Count
                  </label>
                  <select
                    value={filters.gpu_count || ""}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        gpu_count: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "2px 4px",
                      borderRadius: "3px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--background)",
                      color: "var(--text)",
                      fontSize: "10px",
                    }}
                  >
                    <option value="">Any</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="4">4</option>
                    <option value="8">8</option>
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      fontSize: "10px",
                      color: "var(--text-secondary)",
                      display: "block",
                      marginBottom: "1px",
                    }}
                  >
                    Security
                  </label>
                  <select
                    value={filters.security || ""}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        security: e.target.value || undefined,
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "2px 4px",
                      borderRadius: "3px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--background)",
                      color: "var(--text)",
                      fontSize: "10px",
                    }}
                  >
                    <option value="">All</option>
                    <option value="secure_cloud">Secure Cloud</option>
                    <option value="community_cloud">Community Cloud</option>
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      fontSize: "10px",
                      color: "var(--text-secondary)",
                      display: "block",
                      marginBottom: "1px",
                    }}
                  >
                    Socket
                  </label>
                  <select
                    value={filters.socket || ""}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        socket: e.target.value || undefined,
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "2px 4px",
                      borderRadius: "3px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--background)",
                      color: "var(--text)",
                      fontSize: "10px",
                    }}
                  >
                    <option value="">All</option>
                    <option value="PCIe">PCIe</option>
                    <option value="SXM4">SXM4</option>
                    <option value="SXM5">SXM5</option>
                    <option value="SXM6">SXM6</option>
                  </select>
                </div>
              </div>

              <button
                className="runtime-btn runtime-btn-primary"
                onClick={loadAvailableGPUs}
                disabled={loadingAvailability}
                style={{ width: "100%", padding: "4px 8px", fontSize: "11px" }}
              >
                <Search size={10} style={{ marginRight: "3px" }} />
                {loadingAvailability ? "Searching..." : "Search"}
              </button>
            </div>

            {/* Results */}
            {loadingAvailability ? (
              <div className="runtime-empty-state" style={{ padding: "6px" }}>
                <p style={{ color: "var(--text-secondary)", fontSize: "10px" }}>
                  Loading...
                </p>
              </div>
            ) : availableGPUs.length === 0 ? (
              <div className="runtime-empty-state" style={{ padding: "6px" }}>
                <p style={{ color: "var(--text-secondary)", fontSize: "10px" }}>
                  Click Search to find GPUs
                </p>
              </div>
            ) : (
              <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                {availableGPUs.map((gpu, index) => (
                  <div
                    key={`${gpu.cloudId}-${index}`}
                    style={{
                      padding: "4px 6px",
                      borderRadius: "3px",
                      border: "1px solid var(--border-color)",
                      marginBottom: "3px",
                      backgroundColor: "var(--background-secondary)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: "3px",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "11px",
                            marginBottom: "1px",
                          }}
                        >
                          {gpu.gpuType} ({gpu.gpuCount}x)
                        </div>
                        <div
                          style={{
                            fontSize: "9px",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {gpu.provider} • {gpu.socket} • {gpu.gpuMemory}GB
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "11px",
                            color: "var(--accent)",
                          }}
                        >
                          ${gpu.prices?.onDemand?.toFixed(2) || "N/A"}/hr
                        </div>
                        {gpu.stockStatus && (
                          <div
                            style={{
                              fontSize: "9px",
                              color:
                                gpu.stockStatus === "Available"
                                  ? "var(--success)"
                                  : "var(--text-secondary)",
                              marginTop: "1px",
                            }}
                          >
                            {gpu.stockStatus}
                          </div>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "4px",
                        fontSize: "9px",
                        color: "var(--text-secondary)",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: "4px",
                          flexWrap: "wrap",
                          flex: 1,
                        }}
                      >
                        {gpu.region && <span>📍 {gpu.region}</span>}
                        {gpu.dataCenter && <span>🏢 {gpu.dataCenter}</span>}
                        {gpu.security && (
                          <span
                            style={{
                              backgroundColor:
                                gpu.security === "secure_cloud"
                                  ? "var(--success-bg)"
                                  : "var(--info-bg)",
                              color:
                                gpu.security === "secure_cloud"
                                  ? "var(--success)"
                                  : "var(--info)",
                              padding: "1px 4px",
                              borderRadius: "2px",
                              fontSize: "9px",
                            }}
                          >
                            {gpu.security === "secure_cloud"
                              ? "🔒 Secure"
                              : "🌐 Community"}
                          </span>
                        )}
                      </div>
                      <button
                        className="runtime-btn runtime-btn-sm runtime-btn-primary"
                        onClick={() => createPodFromGpu(gpu)}
                        disabled={creatingPodId === gpu.cloudId}
                        style={{
                          fontSize: "10px",
                          padding: "3px 6px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {creatingPodId === gpu.cloudId
                          ? "Creating..."
                          : "Create"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default ComputePopup;
