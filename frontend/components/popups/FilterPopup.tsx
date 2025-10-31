import React from "react";
import { GpuAvailabilityParams } from "@/lib/api";

interface FilterPopupProps {
  isOpen: boolean;
  onClose: () => void;
  filters: GpuAvailabilityParams;
  onFiltersChange: (filters: GpuAvailabilityParams) => void;
  onApply: () => void;
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

const FilterPopup: React.FC<FilterPopupProps> = ({
  isOpen,
  onClose,
  filters,
  onFiltersChange,
  onApply,
}) => {
  const [filterCategory, setFilterCategory] = React.useState<string>("gpu_type");
  const [filterSearch, setFilterSearch] = React.useState<string>("");

  if (!isOpen) return null;

  const handleClearAll = () => {
    onFiltersChange({});
    setFilterSearch("");
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          zIndex: 9998,
        }}
      />
      {/* Filter Popup */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          backgroundColor: "var(--mc-cell-background)",
          border: "1px solid var(--mc-border)",
          borderRadius: "8px",
          padding: "16px",
          width: "320px",
          maxHeight: "480px",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 10px 25px rgba(0, 0, 0, 0.2)",
          zIndex: 9999,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h4
            style={{
              fontSize: "14px",
              fontWeight: 600,
              margin: 0,
              color: "var(--mc-text-color)",
            }}
          >
            Filter
          </h4>
          <button
            onClick={handleClearAll}
            style={{
              fontSize: "11px",
              color: "var(--mc-primary)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px",
              fontWeight: 500,
            }}
          >
            Clear All
          </button>
        </div>

        {/* Category Dropdown */}
        <select
          value={filterCategory}
          onChange={(e) => {
            setFilterCategory(e.target.value);
            setFilterSearch("");
          }}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: "6px",
            border: "1px solid var(--mc-border)",
            backgroundColor: "var(--mc-input-background)",
            color: "var(--mc-text-color)",
            fontSize: "12px",
            marginBottom: "12px",
            cursor: "pointer",
          }}
        >
          <option value="gpu_type">GPU Type</option>
          <option value="gpu_count">GPU Count</option>
          <option value="security">Security</option>
          <option value="socket">Socket</option>
        </select>

        {/* Search within category */}
        <input
          type="text"
          placeholder="Search"
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: "6px",
            border: "1px solid var(--mc-border)",
            backgroundColor: "var(--mc-input-background)",
            color: "var(--mc-text-color)",
            fontSize: "12px",
            marginBottom: "12px",
            boxSizing: "border-box",
          }}
        />

        {/* Options List */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            marginBottom: "16px",
            maxHeight: "240px",
            border: "1px solid var(--mc-border)",
            borderRadius: "6px",
            padding: "4px",
          }}
        >
          {filterCategory === "gpu_type" && (
            <>
              {GPU_TYPES.filter((gpu) =>
                gpu.label.toLowerCase().includes(filterSearch.toLowerCase())
              ).map((gpu) => (
                <label
                  key={gpu.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "8px 6px",
                    cursor: "pointer",
                    fontSize: "12px",
                    color: "var(--mc-text-color)",
                    borderRadius: "4px",
                    transition: "background-color 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = "var(--mc-secondary)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  <input
                    type="radio"
                    checked={filters.gpu_type === gpu.value}
                    onChange={() =>
                      onFiltersChange({
                        ...filters,
                        gpu_type: gpu.value,
                      })
                    }
                    style={{ marginRight: "10px", cursor: "pointer" }}
                  />
                  {gpu.label}
                </label>
              ))}
            </>
          )}

          {filterCategory === "gpu_count" && (
            <>
              {[
                { value: "", label: "Any" },
                { value: "1", label: "1 GPU" },
                { value: "2", label: "2 GPUs" },
                { value: "4", label: "4 GPUs" },
                { value: "8", label: "8 GPUs" },
              ]
                .filter((option) =>
                  option.label.toLowerCase().includes(filterSearch.toLowerCase())
                )
                .map((option) => (
                  <label
                    key={option.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "8px 6px",
                      cursor: "pointer",
                      fontSize: "12px",
                      color: "var(--mc-text-color)",
                      borderRadius: "4px",
                      transition: "background-color 0.15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "var(--mc-secondary)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                  >
                    <input
                      type="radio"
                      checked={
                        (filters.gpu_count?.toString() || "") === option.value
                      }
                      onChange={() =>
                        onFiltersChange({
                          ...filters,
                          gpu_count: option.value
                            ? parseInt(option.value)
                            : undefined,
                        })
                      }
                      style={{ marginRight: "10px", cursor: "pointer" }}
                    />
                    {option.label}
                  </label>
                ))}
            </>
          )}

          {filterCategory === "security" && (
            <>
              {[
                { value: "", label: "All" },
                { value: "secure_cloud", label: "Secure Cloud" },
                {
                  value: "community_cloud",
                  label: "Community Cloud",
                },
              ]
                .filter((option) =>
                  option.label.toLowerCase().includes(filterSearch.toLowerCase())
                )
                .map((option) => (
                  <label
                    key={option.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "8px 6px",
                      cursor: "pointer",
                      fontSize: "12px",
                      color: "var(--mc-text-color)",
                      borderRadius: "4px",
                      transition: "background-color 0.15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "var(--mc-secondary)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                  >
                    <input
                      type="radio"
                      checked={(filters.security || "") === option.value}
                      onChange={() =>
                        onFiltersChange({
                          ...filters,
                          security: option.value || undefined,
                        })
                      }
                      style={{ marginRight: "10px", cursor: "pointer" }}
                    />
                    {option.label}
                  </label>
                ))}
            </>
          )}

          {filterCategory === "socket" && (
            <>
              {[
                { value: "", label: "All" },
                { value: "PCIe", label: "PCIe" },
                { value: "SXM4", label: "SXM4" },
                { value: "SXM5", label: "SXM5" },
                { value: "SXM6", label: "SXM6" },
              ]
                .filter((option) =>
                  option.label.toLowerCase().includes(filterSearch.toLowerCase())
                )
                .map((option) => (
                  <label
                    key={option.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "8px 6px",
                      cursor: "pointer",
                      fontSize: "12px",
                      color: "var(--mc-text-color)",
                      borderRadius: "4px",
                      transition: "background-color 0.15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "var(--mc-secondary)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                  >
                    <input
                      type="radio"
                      checked={(filters.socket || "") === option.value}
                      onChange={() =>
                        onFiltersChange({
                          ...filters,
                          socket: option.value || undefined,
                        })
                      }
                      style={{ marginRight: "10px", cursor: "pointer" }}
                    />
                    {option.label}
                  </label>
                ))}
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "8px 16px",
              fontSize: "12px",
              borderRadius: "6px",
              border: "1px solid var(--mc-border)",
              backgroundColor: "var(--mc-secondary)",
              color: "var(--mc-text-color)",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onApply();
              onClose();
            }}
            style={{
              flex: 1,
              padding: "8px 16px",
              fontSize: "12px",
              borderRadius: "6px",
              border: "none",
              backgroundColor: "var(--mc-primary)",
              color: "var(--mc-button-foreground)",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </>
  );
};

export default FilterPopup;
