import React from 'react';

interface SidebarItemData {
  id: string;
  icon: string;
  tooltip: string;
}

const sidebarItems: SidebarItemData[] = [
  { id: 'folder', icon: 'folder.svg', tooltip: 'Files' },
  { id: 'packages', icon: 'packages.svg', tooltip: 'Packages' },
  { id: 'python', icon: 'python.svg', tooltip: 'Python' },
  { id: 'metrics', icon: 'metric.svg', tooltip: 'Metrics' },
  { id: 'settings', icon: 'setting.svg', tooltip: 'Settings' },
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
            className={`sidebar-item ${activePopup === item.id ? 'active' : ''}`} 
            data-popup={item.id}
            onClick={() => onTogglePopup(item.id)}
        >
          <img src={`/assets/icons/${item.icon}`} alt={item.tooltip} className="sidebar-icon" />
          <div className="sidebar-tooltip">{item.tooltip}</div>
        </div>
      ))}
    </div>
  );
};

export default Sidebar;