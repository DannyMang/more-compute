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
import FilterPopup from "./FilterPopup";

interface GPUPod {
  id: string;
  name: string;
  status: "running" | "stopped" | "starting";
  gpuType: string;
  region: string;
  costPerHour: number;
  sshConnection: string | null;
}

interface ComputePopupProps {
  onClose?: () => void;
}

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
  const [connectionHealth, setConnectionHealth] = useState<"healthy" | "unhealthy" | "unknown">("unknown");

  // Filter popup state
  const [showFilterPopup, setShowFilterPopup] = useState(false);

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

  // Health check effect - runs every 10 seconds when connected
  useEffect(() => {
    if (!connectedPodId) {
      setConnectionHealth("unknown");
      return;
    }

    const checkConnectionHealth = async () => {
      try {
        const status: PodConnectionStatus = await getPodConnectionStatus();
        if (status.connected && status.pod?.id === connectedPodId) {
          setConnectionHealth("healthy");
        } else {
          setConnectionHealth("unhealthy");
          // Auto-disconnect if connection is dead
          setConnectedPodId(null);
          setKernelStatus(false);
        }
      } catch (err) {
        console.error("Connection health check failed:", err);
        setConnectionHealth("unhealthy");
      }
    };

    // Initial check
    checkConnectionHealth();

    // Set up periodic health checks
    const interval = setInterval(checkConnectionHealth, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [connectedPodId]);

  useEffect(() => {
    const checkApiConfig = async () => {
      try {
        const config = await fetchGpuConfig();
        setApiConfigured(config.configured);
        if (config.configured) {
          await loadGPUPods();
          // Check if already connected to a pod
          const status: PodConnectionStatus = await getPodConnectionStatus();
          if (status.connected && status.pod) {
            setConnectedPodId(status.pod.id);
            setKernelStatus(true); // Kernel is running when connected to pod
            setConnectionHealth("healthy");
          }
        }
      } catch (err) {
        console.error("Failed to check GPU config:", err);
        setApiConfigured(false);
      }
    };
    checkApiConfig();

    // Connect to WebSocket for real-time pod status updates
    const wsUrl = 'ws://127.0.0.1:8000/ws';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("WebSocket connected for pod status updates");
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "pod_status_update" && message.data) {
          const podData = message.data;

          // Map API status to UI status
          // Pod must be ACTIVE *and* have SSH connection info to be "running"
          let uiStatus: "running" | "stopped" | "starting" = "stopped";
          const isFullyReady = podData.status === "ACTIVE" && podData.ssh_connection;

          if (isFullyReady) {
            uiStatus = "running";
          } else if (podData.status === "ACTIVE" || podData.status === "PROVISIONING" || podData.status === "PENDING") {
            uiStatus = "starting";
          }

          // Update pod in the list
          setGpuPods((prevPods) => {
            const existingPodIndex = prevPods.findIndex((p) => p.id === podData.pod_id);

            if (existingPodIndex >= 0) {
              // Update existing pod
              const updatedPods = [...prevPods];
              const wasStarting = prevPods[existingPodIndex].status === "starting";

              updatedPods[existingPodIndex] = {
                id: podData.pod_id,
                name: podData.name,
                status: uiStatus,
                gpuType: podData.gpu_name,
                region: prevPods[existingPodIndex].region, // Keep existing region
                costPerHour: podData.price_hr,
                sshConnection: podData.ssh_connection || null,
              };

              // Auto-connect if pod just became ready (was starting, now running)
              if (wasStarting && isFullyReady) {
                console.log(`[AUTO-CONNECT] Pod ${podData.pod_id} is ready, auto-connecting...`);
                setTimeout(() => {
                  handleConnectToPod(podData.pod_id);
                }, 1000);
              }

              return updatedPods;
            } else {
              // Add new pod if not in list
              return [
                ...prevPods,
                {
                  id: podData.pod_id,
                  name: podData.name,
                  status: uiStatus,
                  gpuType: podData.gpu_name,
                  region: "Unknown",
                  costPerHour: podData.price_hr,
                  sshConnection: podData.ssh_connection || null,
                },
              ];
            }
          });
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
    };

    return () => {
      ws.close();
    };
  }, [apiConfigured]);

  const loadGPUPods = async (params?: PodsListParams) => {
    setLoading(true);
    try {
      const response = await fetchGpuPods(params || { limit: 100 });
      const pods = (response.data || []).map((pod: PodResponse) => {
        // Map API status to UI status
        // Pod must be ACTIVE *and* have SSH connection info to be "running"
        let uiStatus: "running" | "stopped" | "starting" = "stopped";
        if (pod.status === "ACTIVE" && pod.sshConnection) {
          uiStatus = "running";
        } else if (pod.status === "ACTIVE" || pod.status === "PROVISIONING" || pod.status === "PENDING") {
          uiStatus = "starting";
        }

        return {
          id: pod.id,
          name: pod.name,
          status: uiStatus,
          gpuType: pod.gpuName,
          region: "Unknown", //look at later
          costPerHour: pod.priceHr,
          sshConnection: pod.sshConnection,
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
      alert(
        `Pod "${newPod.name}" created successfully! Wait for provisioning (~2-5 min).`,
      );
    } catch (err) {
      let errorMsg = "Failed to create pod";

      if (err instanceof Error) {
        errorMsg = err.message;

        // Parse specific error cases
        if (
          errorMsg.includes("402") ||
          errorMsg.includes("Insufficient funds")
        ) {
          errorMsg =
            "Insufficient funds. Please add credits to your Prime Intellect wallet:\nhttps://app.primeintellect.ai/dashboard/billing";
        } else if (errorMsg.includes("401") || errorMsg.includes("403")) {
          errorMsg = "Authentication failed. Check your API key configuration.";
        } else if (errorMsg.includes("data_center_id")) {
          errorMsg =
            "Pod configuration error: Missing data center ID. Try a different GPU or provider.";
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
    setConnectionHealth("unknown"); // Reset health status during connection
    try {
      const result = await connectToPod(podId);
      if (result.status === "ok") {
        setConnectedPodId(podId);
        setKernelStatus(true); // Mark kernel as running
        setConnectionHealth("healthy"); // Mark connection as healthy
        setErrorModal({
          isOpen: true,
          title: "✓ Connected!",
          message:
            "Successfully connected to GPU pod. You can now run code on the remote GPU.",
        });
      } else {
        // Show detailed error message from backend
        let errorMsg = result.message || "Connection failed";
        setConnectionHealth("unhealthy");

        // Check for SSH key issues
        if (
          errorMsg.includes("SSH authentication") ||
          errorMsg.includes("SSH public key")
        ) {
          setErrorModal({
            isOpen: true,
            title: "SSH Key Required",
            message: errorMsg,
            actionLabel: "Add SSH Key",
            actionUrl: "https://app.primeintellect.ai/dashboard/tokens",
          });
        } else if (errorMsg.includes("not ready yet") || errorMsg.includes("provisioning")) {
          setErrorModal({
            isOpen: true,
            title: "Pod Not Ready",
            message: "Pod is still starting up. Please wait a minute and try connecting again.",
          });
        } else if (errorMsg.includes("tunnel") || errorMsg.includes("SSH")) {
          setErrorModal({
            isOpen: true,
            title: "Connection Failed",
            message: `${errorMsg}\n\nTroubleshooting:\n• Check your SSH key is added to Prime Intellect\n• Verify the pod is running\n• Check your network connection`,
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
      setConnectionHealth("unhealthy");

      setErrorModal({
        isOpen: true,
        title: "Connection Error",
        message: `${errorMsg}\n\nThis could be due to:\n• Network connectivity issues\n• Pod may have stopped running\n• SSH tunnel creation failed`,
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
      setConnectionHealth("unknown"); // Reset health status
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
        setConnectionHealth("unknown");
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
        <section
          className="runtime-section"
          style={{ padding: "6px 12px", marginBottom: "16px" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h3 className="runtime-section-title" style={{ fontSize: "12px" }}>
              Kernel:{" "}
              <span
                className={
                  kernelStatus
                    ? "kernel-status-active"
                    : "kernel-status-inactive"
                }
              >
                {kernelStatus ? "running" : "not running"}
              </span>
              {connectedPodId && (
                <span
                  style={{
                    marginLeft: "8px",
                    fontSize: "10px",
                    color:
                      connectionHealth === "healthy"
                        ? "var(--success)"
                        : connectionHealth === "unhealthy"
                          ? "var(--error-color)"
                          : "var(--text-secondary)",
                  }}
                  title={
                    connectionHealth === "healthy"
                      ? "Connection healthy"
                      : connectionHealth === "unhealthy"
                        ? "Connection lost"
                        : "Checking connection..."
                  }
                >
                  {connectionHealth === "healthy"
                    ? "● Connected"
                    : connectionHealth === "unhealthy"
                      ? "● Disconnected"
                      : "○ Checking..."}
                </span>
              )}
            </h3>
            <button
              className="runtime-btn runtime-btn-secondary"
              style={{ fontSize: "11px", padding: "3px 8px" }}
            >
              Stop kernel
            </button>
          </div>
        </section>

        {/* Compute Profile Section */}
        <section className="runtime-section" style={{ padding: "6px 12px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "3px",
            }}
          >
            <h3 className="runtime-section-title" style={{ fontSize: "12px" }}>
              Compute profile
            </h3>
            <span className="runtime-cost" style={{ fontSize: "11px" }}>
              {connectedPodId
                ? `$${(gpuPods.find((p) => p.id === connectedPodId)?.costPerHour || 0).toFixed(2)} / hour`
                : "$0.00 / hour"}
            </span>
          </div>

          {/* GPU Pods Section */}
          <div className="runtime-subsection" style={{ marginTop: "30px" }}>
            <div
              className="runtime-subsection-header"
              style={{ marginBottom: "4px" }}
            >
              <h4
                className="runtime-subsection-title"
                style={{ fontSize: "11px" }}
              >
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
                          <span className="runtime-gpu-type">
                            {pod.gpuType}
                          </span>
                          <span className="runtime-gpu-region">
                            {pod.region}
                          </span>
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
                            {pod.status === "starting"
                              ? "Starting..."
                              : "Stopped"}
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
              </div>

              {/* Filter and Search Bar */}
              <div
                style={{
                  marginBottom: "6px",
                  display: "flex",
                  gap: "4px",
                  alignItems: "center",
                }}
              >
                <button
                  className="runtime-btn runtime-btn-secondary"
                  onClick={() => setShowFilterPopup(!showFilterPopup)}
                  style={{
                    padding: "4px 8px",
                    fontSize: "11px",
                    position: "relative",
                  }}
                >
                  <Filter size={10} style={{ marginRight: "3px" }} />
                  Filter
                  {(filters.gpu_type ||
                    filters.gpu_count ||
                    filters.security ||
                    filters.socket) && (
                    <span
                      style={{
                        position: "absolute",
                        top: "-2px",
                        right: "-2px",
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: "var(--accent)",
                      }}
                    />
                  )}
                </button>
                <button
                  className="runtime-btn runtime-btn-primary"
                  onClick={loadAvailableGPUs}
                  disabled={loadingAvailability}
                  style={{
                    flex: 1,
                    padding: "4px 8px",
                    fontSize: "11px",
                  }}
                >
                  <Search size={10} style={{ marginRight: "3px" }} />
                  {loadingAvailability ? "Searching..." : "Search"}
                </button>
              </div>

              {/* Filter Popup */}
              <FilterPopup
                isOpen={showFilterPopup}
                onClose={() => setShowFilterPopup(false)}
                filters={filters}
                onFiltersChange={setFilters}
                onApply={loadAvailableGPUs}
              />

              {/* Results */}
              {loadingAvailability ? (
                <div className="runtime-empty-state" style={{ padding: "6px" }}>
                  <p
                    style={{ color: "var(--text-secondary)", fontSize: "10px" }}
                  >
                    Loading...
                  </p>
                </div>
              ) : availableGPUs.length === 0 ? (
                <div className="runtime-empty-state" style={{ padding: "6px" }}>
                  <p
                    style={{ color: "var(--text-secondary)", fontSize: "10px" }}
                  >
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
                            {gpu.provider} - {gpu.socket} - {gpu.gpuMemory}GB
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
                          {gpu.region && (
                            <span style={{ marginRight: "8px" }}>
                              {gpu.region}
                            </span>
                          )}
                          {gpu.dataCenter && (
                            <span style={{ marginRight: "8px" }}>
                              {gpu.dataCenter}
                            </span>
                          )}
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
                                ? "Secure"
                                : "Community"}
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
