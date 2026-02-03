import React from "react";
import { GpuAvailabilityParams } from "@/lib/api";

interface FilterPopupProps {
  isOpen: boolean;
  onClose: () => void;
  filters: GpuAvailabilityParams;
  onFiltersChange: (filters: GpuAvailabilityParams) => void;
  onApply: () => void;
  providerName?: string;
}

// Common GPU types across providers
const GPU_TYPES = [
  { value: "H100", label: "H100" },
  { value: "H200", label: "H200" },
  { value: "A100", label: "A100" },
  { value: "A10", label: "A10" },
  { value: "A30", label: "A30" },
  { value: "A40", label: "A40" },
  { value: "A6000", label: "A6000" },
  { value: "A5000", label: "A5000" },
  { value: "A4000", label: "A4000" },
  { value: "L40S", label: "L40S" },
  { value: "L40", label: "L40" },
  { value: "L4", label: "L4" },
  { value: "RTX 4090", label: "RTX 4090" },
  { value: "RTX 4080", label: "RTX 4080" },
  { value: "RTX 4070", label: "RTX 4070" },
  { value: "RTX 3090", label: "RTX 3090" },
  { value: "RTX 3080", label: "RTX 3080" },
  { value: "RTX 3070", label: "RTX 3070" },
  { value: "RTX 6000", label: "RTX 6000 Ada" },
  { value: "RTX 5000", label: "RTX 5000 Ada" },
  { value: "RTX 4000", label: "RTX 4000 Ada" },
  { value: "V100", label: "V100" },
  { value: "T4", label: "T4" },
  { value: "P100", label: "P100" },
];

// Provider-specific filter categories
type FilterCategory = "gpu_type" | "gpu_count" | "cloud_type" | "verified" | "reliability";

const getFilterCategoriesForProvider = (provider: string): { value: FilterCategory; label: string }[] => {
  const common = [
    { value: "gpu_type" as FilterCategory, label: "GPU Type" },
    { value: "gpu_count" as FilterCategory, label: "GPU Count" },
  ];

  switch (provider) {
    case "runpod":
      return [
        ...common,
        { value: "cloud_type" as FilterCategory, label: "Cloud Type" },
      ];
    case "vastai":
      return [
        ...common,
        { value: "verified" as FilterCategory, label: "Verified" },
        { value: "reliability" as FilterCategory, label: "Reliability" },
      ];
    case "lambda_labs":
    default:
      return common;
  }
};

const FilterPopup: React.FC<FilterPopupProps> = ({
  isOpen,
  onClose,
  filters,
  onFiltersChange,
  onApply,
  providerName = "runpod",
}) => {
  const categories = getFilterCategoriesForProvider(providerName);
  const [filterCategory, setFilterCategory] = React.useState<FilterCategory>(categories[0]?.value || "gpu_type");
  const [filterSearch, setFilterSearch] = React.useState<string>("");

  // Reset category when provider changes
  React.useEffect(() => {
    const validCategories = getFilterCategoriesForProvider(providerName);
    if (!validCategories.find(c => c.value === filterCategory)) {
      setFilterCategory(validCategories[0]?.value || "gpu_type");
    }
  }, [providerName, filterCategory]);

  if (!isOpen) return null;

  const handleClearAll = () => {
    onFiltersChange({});
    setFilterSearch("");
  };

  // Get the count of active filters
  const getActiveFilterCount = (): number => {
    let count = 0;
    if (filters.gpu_type) count++;
    if (filters.gpu_count) count++;
    if (filters.secure_cloud !== undefined || filters.community_cloud !== undefined) count++;
    if (filters.verified !== undefined) count++;
    if (filters.min_reliability !== undefined) count++;
    return count;
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
            Filter {getActiveFilterCount() > 0 && `(${getActiveFilterCount()})`}
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
            setFilterCategory(e.target.value as FilterCategory);
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
          {categories.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>

        {/* Search within category (only for GPU type) */}
        {filterCategory === "gpu_type" && (
          <input
            type="text"
            placeholder="Search GPU types..."
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
        )}

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
          {/* GPU Type Filter - Universal */}
          {filterCategory === "gpu_type" && (
            <>
              <label
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
                  checked={!filters.gpu_type}
                  onChange={() =>
                    onFiltersChange({
                      ...filters,
                      gpu_type: undefined,
                    })
                  }
                  style={{ marginRight: "10px", cursor: "pointer" }}
                />
                All GPUs
              </label>
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

          {/* GPU Count Filter - Universal */}
          {filterCategory === "gpu_count" && (
            <>
              {[
                { value: undefined, label: "Any" },
                { value: 1, label: "1 GPU" },
                { value: 2, label: "2 GPUs" },
                { value: 4, label: "4 GPUs" },
                { value: 8, label: "8 GPUs" },
              ].map((option) => (
                <label
                  key={option.label}
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
                    checked={filters.gpu_count === option.value}
                    onChange={() =>
                      onFiltersChange({
                        ...filters,
                        gpu_count: option.value,
                      })
                    }
                    style={{ marginRight: "10px", cursor: "pointer" }}
                  />
                  {option.label}
                </label>
              ))}
            </>
          )}

          {/* Cloud Type Filter - RunPod specific */}
          {filterCategory === "cloud_type" && providerName === "runpod" && (
            <>
              {[
                { secure: undefined, community: undefined, label: "All Clouds" },
                { secure: true, community: undefined, label: "Secure Cloud Only" },
                { secure: undefined, community: true, label: "Community Cloud Only" },
              ].map((option) => (
                <label
                  key={option.label}
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
                      filters.secure_cloud === option.secure &&
                      filters.community_cloud === option.community
                    }
                    onChange={() =>
                      onFiltersChange({
                        ...filters,
                        secure_cloud: option.secure,
                        community_cloud: option.community,
                      })
                    }
                    style={{ marginRight: "10px", cursor: "pointer" }}
                  />
                  {option.label}
                </label>
              ))}
              <div style={{ padding: "8px 6px", fontSize: "11px", color: "var(--mc-text-secondary)", borderTop: "1px solid var(--mc-border)", marginTop: "8px" }}>
                Secure Cloud: T3/T4 certified data centers<br />
                Community Cloud: User-hosted GPUs
              </div>
            </>
          )}

          {/* Verified Filter - Vast.ai specific */}
          {filterCategory === "verified" && providerName === "vastai" && (
            <>
              {[
                { value: undefined, label: "All Hosts" },
                { value: true, label: "Verified Hosts Only" },
              ].map((option) => (
                <label
                  key={option.label}
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
                    checked={filters.verified === option.value}
                    onChange={() =>
                      onFiltersChange({
                        ...filters,
                        verified: option.value,
                      })
                    }
                    style={{ marginRight: "10px", cursor: "pointer" }}
                  />
                  {option.label}
                </label>
              ))}
              <div style={{ padding: "8px 6px", fontSize: "11px", color: "var(--mc-text-secondary)", borderTop: "1px solid var(--mc-border)", marginTop: "8px" }}>
                Verified hosts have been validated by Vast.ai for reliability
              </div>
            </>
          )}

          {/* Reliability Filter - Vast.ai specific */}
          {filterCategory === "reliability" && providerName === "vastai" && (
            <>
              {[
                { value: undefined, label: "Any Reliability" },
                { value: 0.9, label: "90%+ Reliability" },
                { value: 0.95, label: "95%+ Reliability" },
                { value: 0.99, label: "99%+ Reliability" },
              ].map((option) => (
                <label
                  key={option.label}
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
                    checked={filters.min_reliability === option.value}
                    onChange={() =>
                      onFiltersChange({
                        ...filters,
                        min_reliability: option.value,
                      })
                    }
                    style={{ marginRight: "10px", cursor: "pointer" }}
                  />
                  {option.label}
                </label>
              ))}
              <div style={{ padding: "8px 6px", fontSize: "11px", color: "var(--mc-text-secondary)", borderTop: "1px solid var(--mc-border)", marginTop: "8px" }}>
                Higher reliability means fewer unexpected interruptions
              </div>
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
