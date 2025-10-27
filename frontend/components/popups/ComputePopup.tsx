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
import { usePodWebSocket } from "@/contexts/PodWebSocketContext";

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
  const {
    gpuPods,
    setPods,
    registerAutoConnect,
    connectionState,
    setConnectionState,
    connectingPodId,
    setConnectingPodId,
    connectedPodId,
    setConnectedPodId,
  } = usePodWebSocket();
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
          // Load available GPUs automatically
          await loadAvailableGPUs();
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
  }, []);

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
      setPods(pods);
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

      // Register auto-connect callback for when pod becomes ready
      registerAutoConnect(newPod.id, handleConnectToPod);

      // Set provisioning state for the banner
      setConnectingPodId(newPod.id);
      setConnectionState("provisioning"); // Show "PROVISIONING" banner

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
    // Prevent double-connecting
    if (connectingPodId === podId || connectedPodId === podId) {
      console.log(`[CONNECT] Already connecting/connected to pod ${podId}, skipping`);
      return;
    }

    setConnectingPodId(podId);
    setConnectionState("deploying"); // Show "Deploying worker..." banner
    setConnectionHealth("unknown"); // Reset health status during connection
    try {
      // Initiate connection (now returns immediately with "connecting" status)
      const result = await connectToPod(podId);

      if (result.status === "connecting") {
        console.log("[CONNECT] Connection initiated, polling for completion...");

        // Poll connection status until it's connected or fails
        const maxAttempts = 30; // 30 seconds max
        let attempts = 0;
        let isComplete = false; // Track if polling is complete to prevent race conditions

        const pollInterval = setInterval(async () => {
          if (isComplete) return; // Skip if already completed
          attempts++;

          try {
            const status: PodConnectionStatus = await getPodConnectionStatus();

            if (status.connected && status.pod?.id === podId && !isComplete) {
              // Successfully connected!
              isComplete = true;
              clearInterval(pollInterval);

              setConnectedPodId(podId);
              setKernelStatus(true);
              setConnectionHealth("healthy");
              setConnectingPodId(null);
              setConnectionState("connected"); // Show "Connected!" banner

              setErrorModal({
                isOpen: true,
                title: "✓ Connected!",
                message: "Successfully connected to GPU pod. You can now run code on the remote GPU.",
              });

              // Hide the connected banner after 3 seconds
              setTimeout(() => {
                setConnectionState(null);
              }, 3000);
            } else if (attempts >= maxAttempts && !isComplete) {
              // Timeout
              clearInterval(pollInterval);
              setConnectionHealth("unhealthy");
              setConnectingPodId(null);
              setConnectionState(null); // Hide banner on failure

              setErrorModal({
                isOpen: true,
                title: "Connection Timeout",
                message: "Connection took too long. The pod may not be ready yet. Check the pod status and try again.",
              });
            }
          } catch (err) {
            // Error during polling
            clearInterval(pollInterval);
            setConnectionHealth("unhealthy");
            setConnectingPodId(null);
            setConnectionState(null); // Hide banner on error

            setErrorModal({
              isOpen: true,
              title: "Connection Failed",
              message: "Failed to establish connection. Please try again.",
            });
          }
        }, 1000); // Poll every second

      } else if (result.status === "ok") {
        // Immediate success (backwards compatible)
        setConnectedPodId(podId);
        setKernelStatus(true);
        setConnectionHealth("healthy");
        setConnectingPodId(null);
        setConnectionState("connected"); // Show "Connected!" banner

        setErrorModal({
          isOpen: true,
          title: "✓ Connected!",
          message: "Successfully connected to GPU pod. You can now run code on the remote GPU.",
        });

        // Hide the connected banner after 3 seconds
        setTimeout(() => {
          setConnectionState(null);
        }, 3000);
      } else {
        // Error
        setConnectionHealth("unhealthy");
        setConnectingPodId(null);
        setConnectionState(null); // Hide banner on error

        let errorMsg = result.message || "Connection failed";

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
      const errorMsg = err instanceof Error ? err.message : "Failed to connect to pod";
      setConnectionHealth("unhealthy");
      setConnectingPodId(null);
      setConnectionState(null); // Hide banner on error

      setErrorModal({
        isOpen: true,
        title: "Connection Error",
        message: `${errorMsg}\n\nThis could be due to:\n• Network connectivity issues\n• Pod may have stopped running\n• SSH tunnel creation failed`,
      });
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectFromPod();
      setConnectedPodId(null);
      setKernelStatus(false); // Mark kernel as not running
      setConnectionHealth("unknown"); // Reset health status
      setConnectionState(null); // Hide banner
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

      // Clear connection state if deleting the connecting pod
      if (connectingPodId === podId) {
        setConnectingPodId(null);
        setConnectionState(null);
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
          style={{ padding: "16px 20px" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                The kernel is currently: {kernelStatus ? "Running" : "Stopped"}
              </div>
            </div>
          </div>
        </section>

        {/* Divider */}
        <div style={{
          height: "1px",
          backgroundColor: "rgba(128, 128, 128, 0.2)",
          margin: "0 16px"
        }} />

        {/* Compute Profile Section */}
        <section className="runtime-section" style={{ padding: "12px 16px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h3 className="runtime-section-title" style={{ fontSize: "12px", fontWeight: 500 }}>
              Compute Profile
            </h3>
            <span className="runtime-cost" style={{ fontSize: "12px", fontWeight: 500 }}>
              {connectedPodId
                ? `$${(gpuPods.find((p) => p.id === connectedPodId)?.costPerHour || 0).toFixed(2)} / hour`
                : "$0.00 / hour"}
            </span>
          </div>
        </section>

        {/* Divider */}
        <div style={{
          height: "1px",
          backgroundColor: "rgba(128, 128, 128, 0.2)",
          margin: "0 16px"
        }} />

          {/* GPU Pods Section */}
          <section className="runtime-section" style={{ padding: "12px 16px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px"
              }}
            >
              <h3 className="runtime-section-title" style={{ fontSize: "12px", fontWeight: 500 }}>
                Remote GPU Pods
              </h3>
              {apiConfigured && (
                <button
                  className="runtime-btn runtime-btn-secondary"
                  onClick={handleConnectToPrimeIntellect}
                  style={{
                    fontSize: "11px",
                    padding: "6px 12px",
                    backgroundColor: "#000",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer"
                  }}
                >
                  Manage
                </button>
              )}
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
                      padding: "6px 12px",
                      borderRadius: "8px",
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
                    style={{
                      flex: 1,
                      fontSize: "11px",
                      padding: "6px 12px",
                      backgroundColor: "#000",
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer"
                    }}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    className="runtime-btn runtime-btn-secondary"
                    onClick={handleConnectToPrimeIntellect}
                    style={{
                      fontSize: "11px",
                      padding: "6px 12px",
                      backgroundColor: "#000",
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer"
                    }}
                  >
                    <ExternalLink size={10} style={{ marginRight: "3px" }} />
                    Get Key
                  </button>
                </div>
              </div>
            ) : loading || apiConfigured === null ? (
              <div style={{ padding: "8px 0", color: "var(--text-secondary)", fontSize: "11px" }}>
                Loading...
              </div>
            ) : !connectedPodId ? (
              <div style={{ padding: "8px 0", color: "var(--text-secondary)", fontSize: "11px" }}>
                Currently not connected to any.
              </div>
            ) : (
              gpuPods
                .filter((pod) => pod.id === connectedPodId)
                .map((pod) => (
                  <div key={pod.id} style={{ padding: "8px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                      <div>
                        <div style={{ fontSize: "11px", marginBottom: "4px" }}>
                          <span style={{ fontWeight: 500 }}>{pod.name}</span>
                        </div>
                        <div style={{ fontSize: "10px", color: "var(--text-secondary)" }}>
                          {pod.gpuType} • ${pod.costPerHour.toFixed(2)}/hour
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          className="runtime-btn runtime-btn-secondary"
                          onClick={handleDisconnect}
                          style={{
                            fontSize: "10px",
                            padding: "6px 12px",
                            backgroundColor: "#000",
                            color: "white",
                            border: "none",
                            borderRadius: "8px",
                            cursor: "pointer"
                          }}
                        >
                          Disconnect
                        </button>
                        <button
                          className="runtime-btn runtime-btn-secondary"
                          onClick={() => handleDeletePod(pod.id, pod.name)}
                          disabled={deletingPodId === pod.id}
                          style={{
                            fontSize: "10px",
                            padding: "6px 12px",
                            backgroundColor: "#dc2626",
                            color: "white",
                            border: "none",
                            borderRadius: "8px",
                            cursor: "pointer"
                          }}
                        >
                          {deletingPodId === pod.id ? "..." : "Terminate"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
            )}
          </section>

        {/* Divider */}
        <div style={{
          height: "1px",
          backgroundColor: "rgba(128, 128, 128, 0.2)",
          margin: "0 16px"
        }} />

          {/* Browse Available GPUs Section */}
          {apiConfigured && (
            <section className="runtime-section" style={{ padding: "12px 16px" }}>
              {/* Search and Filter Bar */}
              <div
                style={{
                  marginBottom: "20px",
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                }}
              >
                <input
                  type="text"
                  placeholder="Search"
                  style={{
                    flex: 1,
                    padding: "6px 12px",
                    fontSize: "11px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                    backgroundColor: "var(--background)",
                    color: "var(--text)",
                  }}
                />
                <button
                  className="runtime-btn runtime-btn-secondary"
                  onClick={() => setShowFilterPopup(!showFilterPopup)}
                  style={{
                    padding: "6px 12px",
                    fontSize: "11px",
                    position: "relative",
                    backgroundColor: "#000",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer"
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
                <div style={{ padding: "16px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: "11px" }}>
                  Loading...
                </div>
              ) : availableGPUs.length === 0 ? (
                <div style={{ padding: "16px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: "11px" }}>
                  Use filters to find available GPUs
                </div>
              ) : (
                <div style={{ maxHeight: "calc(100vh - 400px)", overflowY: "auto", paddingRight: "12px" }}>
                  {availableGPUs.map((gpu, index) => (
                    <React.Fragment key={`${gpu.cloudId}-${index}`}>
                      {index > 0 && (
                        <div style={{
                          height: "1px",
                          backgroundColor: "rgba(128, 128, 128, 0.15)",
                          margin: "8px 0"
                        }} />
                      )}
                      <div
                        style={{
                          padding: "8px 0",
                        }}
                      >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: "8px",
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
                        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                          <div>
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
                          <button
                            className="runtime-btn runtime-btn-sm runtime-btn-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              createPodFromGpu(gpu);
                            }}
                            disabled={creatingPodId === gpu.cloudId}
                            style={{
                              fontSize: "10px",
                              padding: "6px 16px",
                              whiteSpace: "nowrap",
                              backgroundColor: "#000",
                              color: "white",
                              border: "none",
                              borderRadius: "8px",
                              cursor: "pointer"
                            }}
                          >
                            {creatingPodId === gpu.cloudId
                              ? "Selecting..."
                              : "Select"}
                          </button>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "4px",
                          fontSize: "9px",
                          color: "var(--text-secondary)",
                          alignItems: "center",
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
                    </div>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </section>
          )}
      </div>
    </>
  );
};

export default ComputePopup;
