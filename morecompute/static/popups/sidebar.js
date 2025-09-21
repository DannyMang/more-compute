// Sidebar Manager - Handles popup states and navigation
class SidebarManager {
  constructor() {
    this.activePopup = null;
    this.popupInstances = new Map();
    this.overlay = document.getElementById('popup-overlay');
    
    this.initializeEventListeners();
  }
  
  initializeEventListeners() {
    // Handle sidebar item clicks
    document.querySelectorAll('.sidebar-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const popupType = item.getAttribute('data-popup');
        this.togglePopup(popupType);
      });
    });
    
    // Handle overlay clicks to close popup
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.closePopup();
      }
    });
    
    // Handle escape key to close popup
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activePopup) {
        this.closePopup();
      }
    });
  }
  
  togglePopup(popupType) {
    if (this.activePopup === popupType) {
      this.closePopup();
    } else {
      this.openPopup(popupType);
    }
  }
  
  openPopup(popupType) {
    // Close any existing popup
    this.closePopup();
    
    // Set active popup
    this.activePopup = popupType;
    
    // Update sidebar item states
    document.querySelectorAll('.sidebar-item').forEach(item => {
      item.classList.remove('active');
      if (item.getAttribute('data-popup') === popupType) {
        item.classList.add('active');
      }
    });
    
    // Show overlay
    this.overlay.style.display = 'block';
    
    // Load popup content
    this.loadPopupContent(popupType);
  }
  
  closePopup() {
    if (!this.activePopup) return;
    
    // Clear active popup instance
    const instance = this.popupInstances.get(this.activePopup);
    if (instance && instance.destroy) {
      instance.destroy();
    }
    
    this.activePopup = null;
    
    // Update sidebar item states
    document.querySelectorAll('.sidebar-item').forEach(item => {
      item.classList.remove('active');
    });
    
    // Hide overlay
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = '';
    
    // Clear popup instance
    this.popupInstances.clear();
  }
  
  loadPopupContent(popupType) {
    const content = this.createPopupContent(popupType);
    this.overlay.appendChild(content);
    
    // Initialize popup-specific functionality
    this.initializePopup(popupType);
  }
  
  createPopupContent(popupType) {
    const container = document.createElement('div');
    container.className = 'popup-content';
    
    const header = document.createElement('div');
    header.className = 'popup-header';
    
    const title = document.createElement('h2');
    title.className = 'popup-title';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'popup-close';
    closeBtn.innerHTML = '×';
    closeBtn.addEventListener('click', () => this.closePopup());
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    container.appendChild(header);
    
    const body = document.createElement('div');
    body.className = 'popup-body';
    container.appendChild(body);
    
    // Set popup-specific content
    switch (popupType) {
      case 'folder':
        title.textContent = 'Files';
        body.innerHTML = '<div class="file-tree">Loading...</div>';
        break;
      case 'packages':
        title.textContent = 'Packages';
        body.innerHTML = '<div class="package-list">Loading...</div>';
        break;
      case 'python':
        title.textContent = 'Python Environment';
        body.innerHTML = '<div class="python-env-list">Loading...</div>';
        break;
      case 'settings':
        title.textContent = 'Settings';
        body.innerHTML = `
          <div class="settings-container">
            <textarea class="settings-editor" placeholder="Loading settings..."></textarea>
            <div class="settings-actions">
              <button class="btn btn-secondary" id="reset-settings">Reset</button>
              <button class="btn btn-primary" id="save-settings">Save</button>
            </div>
          </div>
        `;
        break;
    }
    
    return container;
  }
  
  initializePopup(popupType) {
    switch (popupType) {
      case 'folder':
        if (window.FolderPopup) {
          const instance = new window.FolderPopup(this.overlay.querySelector('.file-tree'));
          this.popupInstances.set(popupType, instance);
        }
        break;
      case 'packages':
        if (window.PackagesPopup) {
          const instance = new window.PackagesPopup(this.overlay.querySelector('.package-list'));
          this.popupInstances.set(popupType, instance);
        }
        break;
      case 'python':
        if (window.PythonPopup) {
          const instance = new window.PythonPopup(this.overlay.querySelector('.python-env-list'));
          this.popupInstances.set(popupType, instance);
        }
        break;
      case 'settings':
        if (window.SettingsPopup) {
          const instance = new window.SettingsPopup(this.overlay.querySelector('.settings-container'));
          this.popupInstances.set(popupType, instance);
        }
        break;
    }
  }
}

// Initialize sidebar when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.sidebarManager = new SidebarManager();
});
