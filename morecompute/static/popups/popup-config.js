// Popup configuration - titles, icons, and metadata
export const POPUP_CONFIG = {
  folder: {
    title: 'Files',
    icon: '📁',
    template: 'folder-popup.html'
  },
  packages: {
    title: 'Packages', 
    icon: '📦',
    template: 'packages-popup.html'
  },
  python: {
    title: 'Python Environment',
    icon: '🐍', 
    template: 'python-popup.html'
  },
  metrics: {
    title: 'System Metrics',
    icon: '📊',
    template: 'metrics-popup.html'
  },
  settings: {
    title: 'Settings',
    icon: '⚙️',
    template: 'settings-popup.html'
  }
};

// Helper function to get popup config
export function getPopupConfig(popupType) {
  return POPUP_CONFIG[popupType] || {
    title: 'Unknown',
    icon: '❓',
    template: null
  };
}
