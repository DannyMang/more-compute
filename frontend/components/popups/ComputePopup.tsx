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
  deleteGpuPod,
  connectToPod,
  disconnectFromPod,
  getPodConnectionStatus,
  PodResponse,
  PodsListParams,
  GpuAvailability,
  GpuAvailabilityParams,
  CreatePodRequest,
  PodConnectionStatus,
} from "@/lib/api";
import ErrorModal from "@/components/ErrorModal";

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
  const [connectingPodId, setConnectingPodId] = useState<string | null>(null);
  const [connectedPodId, setConnectedPodId] = useState<string | null>(null);
  const [deletingPodId, setDeletingPodId] = useState<string | null>(null);

  // Error modal state
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    actionLabel?: string;
    actionUrl?: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
  });

  useEffect(() => {
    const checkApiConfig = async () => {
      try {
        const config = await fetchGpuConfig();
        setApiConfigured(config.configured);
        if (config.configured) {
          await loadGPUPods();
          // Check if already connected to a pod
          const status = await getPodConnectionStatus();
          if (status.connected && status.pod) {
            setConnectedPodId(status.pod.id);
            setKernelStatus(true); // Kernel is running when connected to pod
          }
        }
      } catch (err) {
        console.error("Failed to check GPU config:", err);
        setApiConfigured(false);
      }
    };
    checkApiConfig();

    // Poll pod list every 10 seconds if configured
    const pollInterval = setInterval(async () => {
      if (apiConfigured) {
        await loadGPUPods();
      }
    }, 10000);

    return () => clearInterval(pollInterval);
  }, [apiConfigured]);

  const loadGPUPods = async (params?: PodsListParams) => {
    setLoading(true);
    try {
      const response = await fetchGpuPods(params || { limit: 100 });
      const pods = (response.data || []).map((pod: PodResponse) => {
        // Map API status to UI status
        let uiStatus: "running" | "stopped" | "starting" = "stopped";
        if (pod.status === "ACTIVE") {
          uiStatus = "running";
        } else if (pod.status === "PROVISIONING" || pod.status === "PENDING") {
          uiStatus = "starting";
        }

        return {
          id: pod.id,
          name: pod.name,
          status: uiStatus,
          gpuType: pod.gpuName,
          region: "Unknown", //look at later
          costPerHour: pod.priceHr,
        };
      });
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
          cloudId: gpu.cloudId,
          gpuType: gpu.gpuType,
          socket: gpu.socket,
          gpuCount: gpu.gpuCount,
          diskSize: gpu.disk?.defaultCount || 100,
          vcpus: gpu.vcpu?.defaultCount || 16,
          memory: gpu.memory?.defaultCount || 128,
          image: gpu.images?.[0] || "ubuntu_22_cuda_12",
          security: gpu.security,
          dataCenterId: gpu.dataCenter || undefined,
          country: gpu.country || undefined,
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
      alert(`Pod "${newPod.name}" created successfully! Wait for provisioning (~2-5 min).`);
    } catch (err) {
      let errorMsg = "Failed to create pod";

      if (err instanceof Error) {
        errorMsg = err.message;

        // Parse specific error cases
        if (errorMsg.includes("402") || errorMsg.includes("Insufficient funds")) {
          errorMsg = "Insufficient funds. Please add credits to your Prime Intellect wallet:\nhttps://app.primeintellect.ai/dashboard/billing";
        } else if (errorMsg.includes("401") || errorMsg.includes("403")) {
          errorMsg = "Authentication failed. Check your API key configuration.";
        } else if (errorMsg.includes("data_center_id")) {
          errorMsg = "Pod configuration error: Missing data center ID. Try a different GPU or provider.";
        }
      }

      setPodCreationError(errorMsg);

      // Show error in modal with link to billing if insufficient funds
      if (errorMsg.includes("Insufficient funds")) {
        setErrorModal({
          isOpen: true,
          title: "Insufficient Funds",
          message: errorMsg,
          actionLabel: "Add Credits",
          actionUrl: "https://app.primeintellect.ai/dashboard/billing",
        });
      } else {
        setErrorModal({
          isOpen: true,
          title: "Failed to Create Pod",
          message: errorMsg,
        });
      }
    } finally {
      setCreatingPodId(null);
    }
  };

  const handleConnectToPod = async (podId: string) => {
    setConnectingPodId(podId);
    try {
      const result = await connectToPod(podId);
      if (result.status === "ok") {
        setConnectedPodId(podId);
        setKernelStatus(true); // Mark kernel as running
        setErrorModal({
          isOpen: true,
          title: "✓ Connected!",
          message: "Successfully connected to GPU pod. You can now run code on the remote GPU.",
        });
      } else {
        // Show detailed error message from backend
        let errorMsg = result.message || "Connection failed";

        // Check for SSH key issues
        if (errorMsg.includes("SSH authentication") || errorMsg.includes("SSH public key")) {
          setErrorModal({
            isOpen: true,
            title: "SSH Key Required",
            message: errorMsg,
            actionLabel: "Add SSH Key",
            actionUrl: "https://app.primeintellect.ai/dashboard/tokens",
          });
        } else {
          setErrorModal({
            isOpen: true,
            title: "Connection Failed",
            message: errorMsg,
          });
        }
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to connect to pod";
      setErrorModal({
        isOpen: true,
        title: "Connection Error",
        message: errorMsg,
      });
    } finally {
      setConnectingPodId(null);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectFromPod();
      setConnectedPodId(null);
      setKernelStatus(false); // Mark kernel as not running
      alert("Disconnected from pod");
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to disconnect";
      alert(`Disconnect error: ${errorMsg}`);
    }
  };

  const handleDeletePod = async (podId: string, podName: string) => {
    if (!confirm(`Are you sure you want to terminate pod "${podName}"?`)) {
      return;
    }

    setDeletingPodId(podId);
    try {
      // Disconnect if this is the connected pod
      if (connectedPodId === podId) {
        await disconnectFromPod();
        setConnectedPodId(null);
        setKernelStatus(false);
      }

      await deleteGpuPod(podId);
      alert(`Pod "${podName}" terminated successfully`);
      await loadGPUPods();
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to terminate pod";
      alert(`Terminate error: ${errorMsg}`);
    } finally {
      setDeletingPodId(null);
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
    <>
      <ErrorModal
        isOpen={errorModal.isOpen}
        onClose={() => setErrorModal({ ...errorModal, isOpen: false })}
        title={errorModal.title}
        message={errorModal.message}
        actionLabel={errorModal.actionLabel}
        actionUrl={errorModal.actionUrl}
      />
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
                    <div style={{ display: "flex", gap: "4px" }}>
                      {pod.status === "running" ? (
                        connectedPodId === pod.id ? (
                          <button
                            className="runtime-btn runtime-btn-sm"
                            onClick={handleDisconnect}
                            style={{
                              fontSize: "11px",
                              padding: "4px 8px",
                              backgroundColor: "var(--success)",
                            }}
                          >
                            Disconnect
                          </button>
                        ) : (
                          <button
                            className="runtime-btn runtime-btn-sm"
                            onClick={() => handleConnectToPod(pod.id)}
                            disabled={connectingPodId === pod.id}
                            style={{ fontSize: "11px", padding: "4px 8px" }}
                          >
                            {connectingPodId === pod.id
                              ? "Connecting..."
                              : "Connect"}
                          </button>
                        )
                      ) : (
                        <button
                          className="runtime-btn runtime-btn-sm runtime-btn-secondary"
                          style={{ fontSize: "11px", padding: "4px 8px" }}
                          disabled
                        >
                          {pod.status === "starting" ? "Starting..." : "Stopped"}
                        </button>
                      )}
                      <button
                        className="runtime-btn runtime-btn-sm"
                        onClick={() => handleDeletePod(pod.id, pod.name)}
                        disabled={deletingPodId === pod.id}
                        style={{
                          fontSize: "11px",
                          padding: "4px 8px",
                          backgroundColor: "var(--error-color)",
                          color: "white",
                        }}
                      >
                        {deletingPodId === pod.id ? "..." : "×"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  className="runtime-btn runtime-btn-link"
                  onClick={() => loadGPUPods()}
                  style={{ fontSize: "12px", padding: "6px 8px", flex: 1 }}
                >
                  Refresh
                </button>
                <button
                  className="runtime-btn runtime-btn-link"
                  onClick={() => {
                    setShowBrowseGPUs(!showBrowseGPUs);
                    if (!showBrowseGPUs && availableGPUs.length === 0) {
                      loadAvailableGPUs();
                    }
                  }}
                  style={{ fontSize: "12px", padding: "6px 8px", flex: 1 }}
                >
                  <Plus size={12} style={{ marginRight: "4px" }} />
                  Browse GPUs
                </button>
              </div>
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
    </>
  );
};

export default ComputePopup;
