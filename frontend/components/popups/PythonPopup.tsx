import React, { useState, useEffect } from "react";
import { RotateCw, Cpu } from "lucide-react";

interface PythonEnvironment {
  name: string;
  version: string;
  path: string;
  type: string;
  active?: boolean;
}

interface PythonPopupProps {
  onClose?: () => void;
  onEnvironmentSwitch?: (env: PythonEnvironment) => void;
}

const PythonPopup: React.FC<PythonPopupProps> = ({
  onClose,
  onEnvironmentSwitch,
}) => {
  const [environments, setEnvironments] = useState<PythonEnvironment[]>([]);
  const [currentEnv, setCurrentEnv] = useState<PythonEnvironment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadEnvironments();
  }, []);

  const loadEnvironments = async (full: boolean = true, forceRefresh: boolean = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/environments?full=${full}${forceRefresh ? '&force_refresh=true' : ''}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch environments: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.status === "success") {
        setEnvironments(
          data.environments.map((env: any) => ({
            ...env,
            active: env.path === data.current.path,
          })),
        );
        setCurrentEnv(data.current);
      } else {
        throw new Error(data.message || "Failed to load environments");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load environments");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="runtime-popup-loading">
        Loading runtime environments...
      </div>
    );
  }

  if (error) {
    return <div className="runtime-popup-error">{error}</div>;
  }

  return (
    <div className="runtime-popup">
      {/* Python Environment Section */}
      <section className="runtime-section">
        <p className="runtime-subtitle">
          Select the Python interpreter for local execution.
        </p>

        {/* Current Environment */}
        {currentEnv && (
          <div
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: "2px solid var(--accent)",
              backgroundColor: "var(--accent-bg)",
              marginBottom: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: "8px",
                fontSize: "10px",
                fontWeight: 600,
                color: "var(--accent)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              <Cpu size={14} style={{ marginRight: "6px" }} />
              Current Environment
            </div>
            <div style={{ fontWeight: 500, fontSize: "12px", marginBottom: "4px" }}>
              {currentEnv.name}
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)" }}>
              Python {currentEnv.version} • {currentEnv.type}
            </div>
            <div
              style={{
                fontSize: "9px",
                color: "var(--text-tertiary)",
                marginTop: "6px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={currentEnv.path}
            >
              {currentEnv.path}
            </div>
          </div>
        )}

        {/* Available Environments */}
        <div className="runtime-subsection">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <h4
              style={{
                fontSize: "11px",
                fontWeight: 600,
                margin: 0,
                color: "var(--text)",
              }}
            >
              Available Environments
            </h4>
            <button
              onClick={() => loadEnvironments(true, true)}
              aria-label="Refresh environments"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "6px",
                borderRadius: "4px",
                border: "1px solid var(--border-color)",
                backgroundColor: "var(--background)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--hover-background)";
                e.currentTarget.style.borderColor = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "var(--background)";
                e.currentTarget.style.borderColor = "var(--border-color)";
              }}
            >
              <RotateCw size={12} style={{ color: "var(--text-secondary)" }} />
            </button>
          </div>

          <div
            style={{
              maxHeight: "320px",
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {environments.map((env, index) => (
              <div
                key={index}
                onClick={() => {
                  if (!env.active && onEnvironmentSwitch) {
                    onEnvironmentSwitch(env);
                  }
                }}
                style={{
                  padding: "12px",
                  borderRadius: "6px",
                  border: env.active
                    ? "2px solid var(--accent)"
                    : "1.5px solid var(--border-color)",
                  marginBottom: "8px",
                  cursor: env.active ? "default" : "pointer",
                  backgroundColor: env.active
                    ? "var(--accent-bg)"
                    : "var(--background)",
                  transition: "all 0.15s ease",
                  position: "relative",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
                }}
                onMouseEnter={(e) => {
                  if (!env.active) {
                    e.currentTarget.style.backgroundColor =
                      "var(--hover-background)";
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.boxShadow =
                      "0 2px 8px rgba(0, 0, 0, 0.1)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!env.active) {
                    e.currentTarget.style.backgroundColor =
                      "var(--background)";
                    e.currentTarget.style.borderColor = "var(--border-color)";
                    e.currentTarget.style.boxShadow =
                      "0 1px 3px rgba(0, 0, 0, 0.05)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 500,
                        fontSize: "11px",
                        marginBottom: "3px",
                        color: env.active ? "var(--accent)" : "var(--text)",
                      }}
                    >
                      {env.name}
                    </div>
                    <div
                      style={{
                        fontSize: "10px",
                        color: "var(--text-secondary)",
                        marginBottom: "4px",
                      }}
                    >
                      Python {env.version} • {env.type}
                    </div>
                    <div
                      style={{
                        fontSize: "9px",
                        color: "var(--text-tertiary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={env.path}
                    >
                      {env.path}
                    </div>
                  </div>
                  {env.active && (
                    <div
                      style={{
                        fontSize: "9px",
                        fontWeight: 600,
                        color: "var(--accent)",
                        backgroundColor: "var(--accent-bg)",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        marginLeft: "8px",
                        flexShrink: 0,
                      }}
                    >
                      ACTIVE
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default PythonPopup;
