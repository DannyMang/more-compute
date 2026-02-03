import React from "react";
import {
  Folder,
  Package,
  Cpu,
  Settings,
  ChartArea,
  Sparkles,
} from "lucide-react";
import { useClaude } from "@/contexts/ClaudeContext";

interface SidebarItemData {
  id: string;
  icon: React.ReactNode;
  tooltip: string;
}

const sidebarItems: SidebarItemData[] = [
  { id: "folder", icon: <Folder size={16} />, tooltip: "Files" },
  { id: "packages", icon: <Package size={16} />, tooltip: "Packages" },
  { id: "compute", icon: <Cpu size={16} />, tooltip: "Compute" },
  { id: "metrics", icon: <ChartArea size={16} />, tooltip: "Metrics" },
  { id: "claude", icon: <Sparkles size={16} />, tooltip: "Claude" },
  { id: "settings", icon: <Settings size={16} />, tooltip: "Settings" },
];

interface SidebarProps {
  onTogglePopup: (popupType: string) => void;
  activePopup: string | null;
}

const Sidebar: React.FC<SidebarProps> = ({ onTogglePopup, activePopup }) => {
  const { isPanelOpen: isClaudePanelOpen, togglePanel: toggleClaudePanel } =
    useClaude();

  // Calculate active index, considering Claude panel state
  const getActiveIndex = () => {
    if (isClaudePanelOpen) {
      return sidebarItems.findIndex((item) => item.id === "claude");
    }
    return sidebarItems.findIndex((item) => item.id === activePopup);
  };

  const activeIndex = getActiveIndex();

  const handleItemClick = (itemId: string) => {
    if (itemId === "claude") {
      toggleClaudePanel();
    } else {
      onTogglePopup(itemId);
    }
  };

  const isItemActive = (itemId: string) => {
    if (itemId === "claude") {
      return isClaudePanelOpen;
    }
    return activePopup === itemId;
  };

  return (
    <div id="sidebar" className="sidebar">
      {activeIndex !== -1 && (
        <div
          className="sidebar-active-indicator"
          style={{
            transform: `translateY(${activeIndex * 44}px)`,
          }}
        />
      )}
      {sidebarItems.map((item) => (
        <div
          key={item.id}
          className={`sidebar-item ${isItemActive(item.id) ? "active" : ""} ${item.id === "claude" ? "claude-item" : ""}`}
          data-popup={item.id}
          onClick={() => handleItemClick(item.id)}
        >
          <span className="sidebar-icon-wrapper">{item.icon}</span>
          <div className="sidebar-tooltip">{item.tooltip}</div>
        </div>
      ))}
    </div>
  );
};

export default Sidebar;
