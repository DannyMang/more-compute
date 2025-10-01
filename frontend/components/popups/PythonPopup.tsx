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

  const loadEnvironments = async (full: boolean = true) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/environments?full=${full}`);
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
          <div className="runtime-metric">
            <div className="runtime-metric-label">
              <Cpu size={16} style={{ marginRight: "8px" }} />
              Current Environment
            </div>
            <div className="runtime-metric-value">
              <div style={{ fontWeight: 500, fontSize: "14px" }}>
                {currentEnv.name}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                Python {currentEnv.version}
              </div>
            </div>
          </div>
        )}

        {/* Available Environments */}
        <div className="runtime-subsection">
          <div className="runtime-subsection-header">
            <h4 className="runtime-subsection-title">Available Environments</h4>
            <button
              className="runtime-icon-btn"
              onClick={() => loadEnvironments()}
              aria-label="Refresh environments"
            >
              <RotateCw size={14} />
            </button>
          </div>

          <div className="runtime-env-list">
            {environments.map((env, index) => (
              <div
                key={index}
                className={`runtime-env-item ${env.active ? "active" : ""}`}
              >
                <div className="runtime-env-info">
                  <div className="runtime-env-name">{env.name}</div>
                  <div className="runtime-env-meta">
                    <span className="runtime-env-version">
                      Python {env.version}
                    </span>
                    <span className="runtime-env-type">{env.type}</span>
                  </div>
                  <div className="runtime-env-path">{env.path}</div>
                </div>
                <div>
                  {env.active ? (
                    <span className="runtime-badge runtime-badge-success">
                      Active
                    </span>
                  ) : (
                    <button className="runtime-btn runtime-btn-sm">
                      Switch
                    </button>
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
