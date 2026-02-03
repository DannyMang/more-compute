"use client";

import { useState, useEffect } from "react";
import { ProviderInfo, configureGpuProvider } from "../../lib/api";

interface ProviderConfigModalProps {
  provider: ProviderInfo;
  onClose: () => void;
  onConfigured: (provider: ProviderInfo) => void;
}

export default function ProviderConfigModal({
  provider,
  onClose,
  onConfigured,
}: ProviderConfigModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [makeActive, setMakeActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when provider changes
  useEffect(() => {
    setApiKey("");
    setError(null);
    setMakeActive(true);
  }, [provider.name]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!apiKey.trim()) {
      setError("API key is required");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await configureGpuProvider(provider.name, {
        api_key: apiKey.trim(),
        make_active: makeActive,
      });

      // Update provider status and notify parent
      const updatedProvider: ProviderInfo = {
        ...provider,
        configured: true,
        is_active: makeActive,
      };
      onConfigured(updatedProvider);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to configure provider"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Configure {provider.display_name}</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="modal-description">
              Enter your {provider.display_name} API key to enable GPU access.
            </p>

            <div className="form-group">
              <label htmlFor="apiKey">API Key</label>
              <input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Enter your ${provider.display_name} API key`}
                disabled={loading}
                autoFocus
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
              />
            </div>

            <div className="form-group checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={makeActive}
                  onChange={(e) => setMakeActive(e.target.checked)}
                  disabled={loading}
                />
                Set as active provider
              </label>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="help-text">
              <a
                href={provider.dashboard_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get your API key from {provider.display_name}
              </a>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Saving..." : "Save & Connect"}
            </button>
          </div>
        </form>

        <style jsx>{`
          .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
          }

          .modal-content {
            background: var(--mc-cell-background);
            border: 1px solid var(--mc-border);
            border-radius: 12px;
            width: 100%;
            max-width: 420px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          }

          .modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid var(--mc-border);
          }

          .modal-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--mc-text-color);
          }

          .modal-close {
            background: none;
            border: none;
            color: var(--mc-text-color);
            opacity: 0.6;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            line-height: 1;
          }

          .modal-close:hover {
            opacity: 1;
          }

          .modal-body {
            padding: 20px;
          }

          .modal-description {
            margin: 0 0 16px;
            color: var(--mc-text-color);
            opacity: 0.7;
            font-size: 13px;
            line-height: 1.5;
          }

          .warning-text {
            color: #f59e0b;
          }

          .form-group {
            margin-bottom: 16px;
          }

          .form-group label {
            display: block;
            margin-bottom: 6px;
            color: var(--mc-text-color);
            font-size: 13px;
            font-weight: 500;
          }

          .form-group input[type="password"],
          .form-group input[type="text"] {
            width: 100%;
            padding: 10px 12px;
            background: var(--mc-background);
            border: 1px solid var(--mc-border);
            border-radius: 6px;
            color: var(--mc-text-color);
            font-size: 14px;
            transition: border-color 0.2s;
          }

          .form-group input:focus {
            outline: none;
            border-color: var(--mc-primary);
          }

          .form-group input:disabled {
            opacity: 0.5;
          }

          .form-group.checkbox label {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
          }

          .form-group.checkbox input[type="checkbox"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
          }

          .error-message {
            padding: 10px 12px;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 6px;
            color: #ef4444;
            font-size: 13px;
            margin-bottom: 16px;
          }

          .help-text {
            font-size: 12px;
          }

          .help-text a {
            color: var(--mc-primary);
            text-decoration: none;
          }

          .help-text a:hover {
            text-decoration: underline;
          }

          .modal-footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            padding: 16px 20px;
            border-top: 1px solid var(--mc-border);
          }

          .btn-secondary,
          .btn-primary {
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
          }

          .btn-secondary {
            background: transparent;
            border: 1px solid var(--mc-border);
            color: var(--mc-text-color);
            opacity: 0.8;
          }

          .btn-secondary:hover:not(:disabled) {
            background: var(--mc-secondary);
            opacity: 1;
          }

          .btn-primary {
            background: var(--mc-primary);
            border: none;
            color: white;
          }

          .btn-primary:hover:not(:disabled) {
            background: var(--mc-primary-hover);
          }

          .btn-secondary:disabled,
          .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
        `}</style>
      </div>
    </div>
  );
}
