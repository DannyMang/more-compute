"use client";

import { useState } from "react";
import Script from "next/script";
import Sidebar from "@/components/Sidebar";
import FolderPopup from "@/components/popups/FolderPopup";
import PackagesPopup from "@/components/popups/PackagesPopup";
import PythonPopup from "@/components/popups/PythonPopup";
import ComputePopup from "@/components/popups/ComputePopup";
import MetricsPopup from "@/components/popups/MetricsPopup";
import SettingsPopup from "@/components/popups/SettingsPopup";
import "./globals.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [appSettings, setAppSettings] = useState({});
  const [pythonEnvironment, setPythonEnvironment] = useState(null);
  const [activePopup, setActivePopup] = useState<string | null>(null);

  const handleSettingsChange = (settings: any) => {
    console.log("Settings updated:", settings);
    setAppSettings(settings);
  };

  const handleEnvironmentSwitch = (env: any) => {
    console.log("Switching to environment:", env);
    setPythonEnvironment(env);
  };

  const togglePopup = (popupType: string) => {
    setActivePopup((prev) => (prev === popupType ? null : popupType));
  };

  const closePopup = () => {
    setActivePopup(null);
  };

  const renderPopup = () => {
    if (!activePopup) return null;

    const props = { onClose: closePopup };
    switch (activePopup) {
      case "folder":
        return <FolderPopup {...props} />;
      case "packages":
        return <PackagesPopup {...props} />;
      case "python":
        return (
          <PythonPopup
            {...props}
            onEnvironmentSwitch={handleEnvironmentSwitch}
          />
        );
      case "compute":
        return <ComputePopup {...props} />;
      case "metrics":
        return <MetricsPopup {...props} />;
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
      case "python":
        return "Python Environment";
      case "compute":
        return "Compute Resources";
      case "metrics":
        return "System Metrics";
      case "settings":
        return "Settings";
      default:
        return "";
    }
  };

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
              <span id="kernel-status-text" className="status-text">
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
        <Script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/codemirror.min.js" />
        <Script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/mode/python/python.min.js" />
        <Script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/addon/edit/closebrackets.min.js" />
        <Script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/addon/edit/matchbrackets.min.js" />
        <Script src="https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js" />
      </body>
    </html>
  );
}
