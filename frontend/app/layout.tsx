"use client";

import { useState, useEffect, useRef } from "react";
import Script from "next/script";
import Sidebar from "@/components/layout/Sidebar";
import FolderPopup from "@/components/popups/FolderPopup";
import PackagesPopup from "@/components/popups/PackagesPopup";
import ComputePopup from "@/components/popups/ComputePopup";
import MetricsPopup from "@/components/popups/MetricsPopup";
import SettingsPopup from "@/components/popups/SettingsPopup";
import ConfirmModal from "@/components/modals/ConfirmModal";
import { ConnectionBanner } from "@/components/layout/ConnectionBanner";
import {
  PodWebSocketProvider,
  usePodWebSocket,
} from "@/contexts/PodWebSocketContext";
import { loadSettings, applyTheme, type NotebookSettings } from "@/lib/settings";
import { fetchMetrics, type MetricsSnapshot } from "@/lib/api";
import "./globals.css";

const POLL_MS = 3000;

function AppContent({ children }: { children: React.ReactNode }) {
  const [appSettings, setAppSettings] = useState<NotebookSettings>(() => loadSettings());
  const [activePopup, setActivePopup] = useState<string | null>(null);
  const [showRestartModal, setShowRestartModal] = useState(false);
  const { connectionState, gpuPods, connectingPodId } = usePodWebSocket();

  // Persistent metrics collection
  const [metricsHistory, setMetricsHistory] = useState<MetricsSnapshot[]>([]);
  const intervalRef = useRef<number | null>(null);

  // Apply theme on initial mount
  useEffect(() => {
    const settings = loadSettings();
    applyTheme(settings.theme);
  }, []);

  // Persistent metrics collection (runs when mode is 'persistent')
  useEffect(() => {
    if (appSettings.metricsCollectionMode !== 'persistent') {
      // Stop collection if mode changes to on-demand
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Clear history when switching to on-demand mode
      setMetricsHistory([]);
      return;
    }

    // Start persistent collection
    const load = async () => {
      try {
        const snap = await fetchMetrics();
        setMetricsHistory((prev) => {
          const arr = [...prev, snap];
          return arr.slice(-100); // Keep last 100 snapshots
        });
      } catch {
        // Silently fail if metrics API is unavailable
      }
    };

    load(); // Initial load
    intervalRef.current = window.setInterval(load, POLL_MS);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [appSettings.metricsCollectionMode]);

  const handleSettingsChange = (settings: NotebookSettings) => {
    console.log("Settings updated:", settings);
    setAppSettings(settings);
  };

  const togglePopup = (popupType: string) => {
    setActivePopup((prev) => (prev === popupType ? null : popupType));
  };

  const closePopup = () => {
    setActivePopup(null);
  };

  const handleRestartKernel = () => {
    // Send reset kernel command via WebSocket
    const ws = new WebSocket('ws://127.0.0.1:3141/ws');
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'reset_kernel' }));
      setTimeout(() => ws.close(), 100);
    };
  };

  const renderPopup = () => {
    if (!activePopup) return null;

    const props = { onClose: closePopup };
    switch (activePopup) {
      case "folder":
        return <FolderPopup {...props} />;
      case "packages":
        return <PackagesPopup {...props} />;
      case "compute":
        return <ComputePopup {...props} />;
      case "metrics":
        return (
          <MetricsPopup
            {...props}
            sharedHistory={appSettings.metricsCollectionMode === 'persistent' ? metricsHistory : undefined}
          />
        );
      case "settings":
        return (
          <SettingsPopup {...props} onSettingsChange={handleSettingsChange} />
        );
      default:
        return null;
    }
  };

  const getPopupTitle = () => {
    switch (activePopup) {
      case "folder":
        return "Files";
      case "packages":
        return "Packages";
      case "compute":
        return "Kernel";
      case "metrics":
        return "System Metrics";
      case "settings":
        return "Settings";
      default:
        return "";
    }
  };

  // Get connecting pod name
  const connectingPod = connectingPodId
    ? gpuPods.find((p) => p.id === connectingPodId)
    : null;

  return (
    <>
      <ConnectionBanner
        connectionState={connectionState}
        podName={connectingPod?.name}
      />
      <div id="app">
        <Sidebar onTogglePopup={togglePopup} activePopup={activePopup} />
        <div
          id="popup-overlay"
          className="popup-overlay"
          style={{ display: activePopup ? "flex" : "none" }}
        >
          {activePopup && (
            <div className="popup-content">
              <div className="popup-header">
                <h2 className="popup-title">{getPopupTitle()}</h2>
                <button className="popup-close" onClick={closePopup}>
                  ×
                </button>
              </div>
              <div className="popup-body">{renderPopup()}</div>
            </div>
          )}
        </div>
        <div
          id="kernel-banner"
          className="kernel-banner"
          style={{ display: "none" }}
        >
          <div className="kernel-message">
            <span className="kernel-status-text">🔴 Kernel Disconnected</span>
            <span className="kernel-subtitle">
              The notebook kernel has stopped running. Restart to continue.
            </span>
          </div>
        </div>
        <div className="kernel-status-bar">
          <div className="kernel-status-indicator">
            <span
              id="kernel-status-dot"
              className="status-dot connecting"
            ></span>
            <span
              id="kernel-status-text"
              className="status-text"
              data-original-text="Connecting..."
              style={{
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                const originalText = e.currentTarget.textContent || '';
                e.currentTarget.setAttribute('data-original-text', originalText);
                e.currentTarget.textContent = 'Restart Kernel';
                e.currentTarget.style.color = 'var(--mc-primary)';
              }}
              onMouseLeave={(e) => {
                const originalText = e.currentTarget.getAttribute('data-original-text') || 'Connecting...';
                e.currentTarget.textContent = originalText;
                e.currentTarget.style.color = '';
              }}
              onClick={() => setShowRestartModal(true)}
              title="Click to restart kernel"
            >
              Connecting...
            </span>
          </div>
        </div>
        <div className="main-content">{children}</div>
        <div style={{ display: "none" }}>
          <span id="connection-status">Connected</span>
          <span id="kernel-status">Ready</span>
          <img
            id="copy-icon-template"
            src="/assets/icons/copy.svg"
            alt="Copy"
          />
          <img
            id="check-icon-template"
            src="/assets/icons/check.svg"
            alt="Copied"
          />
        </div>
      </div>
      <ConfirmModal
        isOpen={showRestartModal}
        onClose={() => setShowRestartModal(false)}
        onConfirm={handleRestartKernel}
        title="Restart Kernel"
        message="Are you sure you want to restart the kernel? All variables will be lost."
        confirmLabel="Restart"
        cancelLabel="Cancel"
        isDangerous={true}
      />
    </>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const notebookPath = process.env.NEXT_PUBLIC_NOTEBOOK_PATH || "";
  const notebookRoot = process.env.NEXT_PUBLIC_NOTEBOOK_ROOT || "";

  return (
    <html lang="en">
      <head>
        <title>MoreCompute</title>
        <meta name="description" content="Python notebook interface" />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/codemirror.min.css"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/theme/default.min.css"
        />
      </head>
      <body data-notebook-path={notebookPath} data-notebook-root={notebookRoot}>
        <PodWebSocketProvider>
          <AppContent>{children}</AppContent>
        </PodWebSocketProvider>
        <Script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/codemirror.min.js" />
        <Script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/mode/python/python.min.js" />
        <Script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/addon/edit/closebrackets.min.js" />
        <Script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/addon/edit/matchbrackets.min.js" />
        <Script src="https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js" />
      </body>
    </html>
  );
}
