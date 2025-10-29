import React from "react";
import { Folder, Package, Cpu, Settings, ChartArea } from "lucide-react";

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
  { id: "settings", icon: <Settings size={16} />, tooltip: "Settings" },
];

interface SidebarProps {
  onTogglePopup: (popupType: string) => void;
  activePopup: string | null;
}

const Sidebar: React.FC<SidebarProps> = ({ onTogglePopup, activePopup }) => {
  const activeIndex = sidebarItems.findIndex((item) => item.id === activePopup);

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
          className={`sidebar-item ${activePopup === item.id ? "active" : ""}`}
          data-popup={item.id}
          onClick={() => onTogglePopup(item.id)}
        >
          <span className="sidebar-icon-wrapper">{item.icon}</span>
          <div className="sidebar-tooltip">{item.tooltip}</div>
        </div>
      ))}
    </div>
  );
};

export default Sidebar;
