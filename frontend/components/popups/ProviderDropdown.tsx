"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import {
  ProviderInfo,
  fetchGpuProviders,
  setActiveGpuProvider,
} from "../../lib/api";

// Provider logos stored in public/assets/icons/providers/
// Only SSH-based providers are supported
const PROVIDER_LOGOS: Record<string, string> = {
  runpod: "/assets/icons/providers/runpod.svg",
  lambda_labs: "/assets/icons/providers/lambda_labs.svg",
  vastai: "/assets/icons/providers/vastai.svg",
};

const DEFAULT_LOGO = "/assets/icons/providers/runpod.svg";

interface ProviderDropdownProps {
  onProviderChange: (provider: ProviderInfo) => void;
  onConfigureProvider: (provider: ProviderInfo) => void;
  selectedProvider: ProviderInfo | null;
  disabled?: boolean;
}

export default function ProviderDropdown({
  onProviderChange,
  onConfigureProvider,
  selectedProvider,
  disabled = false,
}: ProviderDropdownProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load providers on mount
  useEffect(() => {
    loadProviders();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function loadProviders() {
    try {
      setLoading(true);
      setError(null);
      const response = await fetchGpuProviders();
      setProviders(response.providers);

      // If no provider is selected, try to restore from backend or localStorage
      if (!selectedProvider) {
        // First try backend active provider
        let providerToSelect = response.active_provider;

        // Fallback to localStorage if no backend active provider
        if (!providerToSelect) {
          const savedProvider = localStorage.getItem(
            "morecompute_active_provider",
          );
          if (savedProvider) {
            providerToSelect = savedProvider;
          }
        }

        if (providerToSelect) {
          const active = response.providers.find(
            (p) => p.name === providerToSelect,
          );
          // Only auto-select if the provider is configured
          if (active && active.configured) {
            onProviderChange(active);
          } else if (active && !active.configured) {
            // Provider saved but not configured - clear localStorage and don't auto-select
            localStorage.removeItem("morecompute_active_provider");
            // Still set the provider so the UI shows it needs configuration
            onProviderChange(active);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectProvider(provider: ProviderInfo) {
    if (!provider.configured) {
      // Open configuration modal for unconfigured providers
      onConfigureProvider(provider);
      setIsOpen(false);
      return;
    }

    try {
      // Set as active provider
      await setActiveGpuProvider(provider.name);

      // Save to localStorage for persistence
      localStorage.setItem("morecompute_active_provider", provider.name);

      onProviderChange(provider);
      setIsOpen(false);

      // Refresh provider list to update active status
      await loadProviders();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to switch provider",
      );
    }
  }

  function getProviderLogo(providerName: string): string {
    return PROVIDER_LOGOS[providerName] || DEFAULT_LOGO;
  }

  return (
    <div className="provider-dropdown" ref={dropdownRef}>
      <button
        className="provider-dropdown-button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || loading}
      >
        {loading ? (
          <span className="provider-loading">Loading...</span>
        ) : selectedProvider ? (
          <Image
            src={getProviderLogo(selectedProvider.name)}
            alt={selectedProvider.display_name}
            width={120}
            height={28}
            className="provider-logo"
            style={{ objectFit: "contain" }}
          />
        ) : (
          <span className="provider-placeholder">Select Provider</span>
        )}
      </button>

      {isOpen && !loading && (
        <div className="provider-dropdown-menu">
          {error && <div className="provider-error">{error}</div>}

          {providers.map((provider) => (
            <div key={provider.name} className="provider-option-row">
              <button
                className={`provider-option ${
                  provider.is_active ? "active" : ""
                } ${!provider.configured ? "unconfigured" : ""}`}
                onClick={() => handleSelectProvider(provider)}
              >
                <span className="provider-logo-container">
                  <Image
                    src={getProviderLogo(provider.name)}
                    alt={provider.display_name}
                    width={90}
                    height={24}
                    className="provider-logo"
                    style={{ objectFit: "contain" }}
                  />
                </span>
              </button>
              <button
                className="provider-config-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onConfigureProvider(provider);
                  setIsOpen(false);
                }}
                title={
                  provider.configured
                    ? "Reconfigure API Key"
                    : "Configure API Key"
                }
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </div>
          ))}

          <div className="provider-dropdown-footer">
            <a
              href={selectedProvider?.dashboard_url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="provider-link"
            >
              Get API Keys
            </a>
          </div>
        </div>
      )}

      <style jsx>{`
        .provider-dropdown {
          position: relative;
          width: 100%;
        }

        .provider-dropdown-button {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          padding: 12px 16px;
          border: 1px solid #2a2a4e;
          border-radius: 8px;
          background: #1a1a2e;
          color: var(--mc-text-color);
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
          min-height: 52px;
        }

        .provider-dropdown-button:hover:not(:disabled) {
          border-color: var(--mc-primary);
          background: #252545;
        }

        .provider-dropdown-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .provider-logo-container {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 32px;
          min-width: 110px;
          background: #1a1a2e;
          padding: 6px 12px;
          border-radius: 6px;
        }

        .provider-placeholder {
          opacity: 0.6;
        }

        .provider-loading {
          opacity: 0.6;
        }

        .provider-dropdown-menu {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          background: #1a1a2e;
          border: 1px solid #2a2a4e;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          z-index: 100;
          max-height: 300px;
          overflow-y: auto;
        }

        .provider-error {
          padding: 8px 12px;
          color: #ef4444;
          font-size: 12px;
        }

        .provider-option {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          flex: 1;
          padding: 16px 12px;
          border: none;
          background: transparent;
          color: #ffffff;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.15s;
          text-align: center;
          min-height: 56px;
        }

        .provider-option:hover {
          background: #2a2a4e;
        }

        .provider-option.active {
          background: rgba(99, 102, 241, 0.1);
        }

        .provider-option-row.active-row {
          border-left: 3px solid var(--mc-primary);
        }

        .provider-option.unconfigured {
          opacity: 0.8;
        }

        .provider-option-row {
          display: flex;
          align-items: stretch;
          border-bottom: 1px solid #2a2a4e;
        }

        .provider-option-row:last-of-type {
          border-bottom: none;
        }

        .provider-config-btn {
          align-self: stretch;
          min-width: 54px;
          padding: 0 14px;
          background: transparent;
          border: none;
          color: #6b7280;
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 0;
        }

        .provider-config-btn:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.1);
        }

        .provider-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
          flex-shrink: 0;
        }

        .provider-status-active {
          background: #10b981;
        }

        .provider-status-setup {
          background: #fbbf24;
        }

        .provider-dropdown-footer {
          padding: 8px 12px;
          border-top: 1px solid #2a2a4e;
        }

        .provider-link {
          color: #60a5fa;
          font-size: 12px;
          text-decoration: none;
        }

        .provider-link:hover {
          text-decoration: underline;
          color: #93c5fd;
        }
      `}</style>

      <style jsx global>{`
        .provider-logo {
          flex-shrink: 0;
          max-width: 100%;
          height: auto;
        }
      `}</style>
    </div>
  );
}
