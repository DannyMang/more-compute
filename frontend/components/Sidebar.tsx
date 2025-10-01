import React from "react";
import { Folder, Package, Cpu, Settings, ChartArea, Zap } from "lucide-react";

interface SidebarItemData {
  id: string;
  icon: React.ReactNode;
  tooltip: string;
}

const sidebarItems: SidebarItemData[] = [
  { id: "folder", icon: <Folder size={18} />, tooltip: "Files" },
  { id: "packages", icon: <Package size={18} />, tooltip: "Packages" },
  {
    id: "python",
    icon: <img src="assets/icons/python.svg" width={18} height={18} />,
    tooltip: "Python",
  },
  { id: "compute", icon: <Cpu size={18} />, tooltip: "Compute" },
  { id: "metrics", icon: <ChartArea size={18} />, tooltip: "Metrics" },
  { id: "settings", icon: <Settings size={18} />, tooltip: "Settings" },
];

interface SidebarProps {
  onTogglePopup: (popupType: string) => void;
  activePopup: string | null;
}

const Sidebar: React.FC<SidebarProps> = ({ onTogglePopup, activePopup }) => {
  return (
    <div id="sidebar" className="sidebar">
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
