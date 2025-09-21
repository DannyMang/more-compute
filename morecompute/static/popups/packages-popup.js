// Packages Management Popup Component
class PackagesPopup {
  constructor(container) {
    this.container = container;
    this.packages = [];
    
    this.initialize();
  }
  
  async initialize() {
    try {
      await this.loadPackages();
      this.render();
    } catch (error) {
      console.error('Failed to load packages:', error);
      this.container.innerHTML = '<div class="error">Failed to load packages</div>';
    }
  }
  
  async loadPackages() {
    try {
      // For now, we'll create mock package data
      // In a real implementation, this would fetch from pip list or similar
      this.packages = await this.getMockPackages();
    } catch (error) {
      throw new Error('Failed to fetch packages: ' + error.message);
    }
  }
  
  async getMockPackages() {
    // Mock package list for demonstration
    // In production, this would call a server endpoint that runs `pip list`
    return [
      { name: 'numpy', version: '1.24.3', description: 'Fundamental package for array computing' },
      { name: 'pandas', version: '2.0.1', description: 'Data manipulation and analysis library' },
      { name: 'matplotlib', version: '3.7.1', description: 'Plotting library for Python' },
      { name: 'jupyter', version: '1.0.0', description: 'Interactive computing environment' },
      { name: 'fastapi', version: '0.95.2', description: 'Fast web framework for APIs' },
      { name: 'uvicorn', version: '0.22.0', description: 'ASGI server implementation' },
      { name: 'websockets', version: '11.0.3', description: 'WebSocket server and client library' },
      { name: 'ipython', version: '8.13.2', description: 'Interactive Python shell' },
      { name: 'requests', version: '2.31.0', description: 'HTTP library for Python' },
      { name: 'jinja2', version: '3.1.2', description: 'Template engine for Python' },
    ];
  }
  
  render() {
    this.container.innerHTML = '';
    
    // Add search and install section
    const controls = document.createElement('div');
    controls.className = 'package-controls';
    controls.style.cssText = `
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e5e7eb;
    `;
    
    const installSection = document.createElement('div');
    installSection.style.cssText = `
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    `;
    
    const packageInput = document.createElement('input');
    packageInput.type = 'text';
    packageInput.placeholder = 'Package name (e.g., numpy)';
    packageInput.style.cssText = `
      flex: 1;
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
    `;
    
    const installBtn = document.createElement('button');
    installBtn.className = 'btn btn-primary';
    installBtn.textContent = 'Install';
    installBtn.style.cssText = `
      padding: 8px 16px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    `;
    
    installBtn.addEventListener('click', () => {
      const packageName = packageInput.value.trim();
      if (packageName) {
        this.installPackage(packageName);
      }
    });
    
    installSection.appendChild(packageInput);
    installSection.appendChild(installBtn);
    controls.appendChild(installSection);
    
    // Add refresh button
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn-secondary';
    refreshBtn.textContent = 'Refresh List';
    refreshBtn.style.cssText = `
      padding: 6px 12px;
      background: #f3f4f6;
      color: #374151;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    `;
    
    refreshBtn.addEventListener('click', () => {
      this.refreshPackages();
    });
    
    controls.appendChild(refreshBtn);
    this.container.appendChild(controls);
    
    // Add package list
    const packageList = document.createElement('div');
    packageList.className = 'package-list';
    
    if (this.packages.length === 0) {
      packageList.innerHTML = '<div style="text-align: center; color: #6b7280; padding: 20px;">No packages found</div>';
    } else {
      this.packages.forEach(pkg => {
        const packageItem = this.createPackageItem(pkg);
        packageList.appendChild(packageItem);
      });
    }
    
    this.container.appendChild(packageList);
  }
  
  createPackageItem(pkg) {
    const item = document.createElement('div');
    item.className = 'package-item';
    item.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      margin: 8px 0;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      transition: all 0.2s ease;
    `;
    
    const info = document.createElement('div');
    info.className = 'package-info';
    
    const name = document.createElement('div');
    name.style.cssText = `
      font-weight: 500;
      color: #1f2937;
      margin-bottom: 2px;
    `;
    name.textContent = pkg.name;
    
    const version = document.createElement('div');
    version.style.cssText = `
      font-size: 12px;
      color: #3b82f6;
      margin-bottom: 4px;
    `;
    version.textContent = `v${pkg.version}`;
    
    const description = document.createElement('div');
    description.style.cssText = `
      font-size: 12px;
      color: #6b7280;
    `;
    description.textContent = pkg.description;
    
    info.appendChild(name);
    info.appendChild(version);
    info.appendChild(description);
    
    const actions = document.createElement('div');
    actions.className = 'package-actions';
    actions.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;
    
    const updateBtn = document.createElement('button');
    updateBtn.textContent = 'Update';
    updateBtn.style.cssText = `
      padding: 4px 8px;
      font-size: 11px;
      background: #f59e0b;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;
    updateBtn.addEventListener('click', () => this.updatePackage(pkg.name));
    
    const uninstallBtn = document.createElement('button');
    uninstallBtn.textContent = 'Remove';
    uninstallBtn.style.cssText = `
      padding: 4px 8px;
      font-size: 11px;
      background: #ef4444;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;
    uninstallBtn.addEventListener('click', () => this.uninstallPackage(pkg.name));
    
    actions.appendChild(updateBtn);
    actions.appendChild(uninstallBtn);
    
    item.appendChild(info);
    item.appendChild(actions);
    
    return item;
  }
  
  installPackage(packageName) {
    this.showMessage(`Installing ${packageName}...`, 'info');
    
    // In a real implementation, this would make an API call to install the package
    setTimeout(() => {
      this.showMessage(`Package ${packageName} installation will be implemented with pip integration`, 'success');
    }, 1000);
  }
  
  updatePackage(packageName) {
    this.showMessage(`Updating ${packageName}...`, 'info');
    
    // In a real implementation, this would make an API call to update the package
    setTimeout(() => {
      this.showMessage(`Package ${packageName} update will be implemented with pip integration`, 'success');
    }, 1000);
  }
  
  uninstallPackage(packageName) {
    if (confirm(`Are you sure you want to uninstall ${packageName}?`)) {
      this.showMessage(`Uninstalling ${packageName}...`, 'info');
      
      // In a real implementation, this would make an API call to uninstall the package
      setTimeout(() => {
        this.showMessage(`Package ${packageName} removal will be implemented with pip integration`, 'success');
      }, 1000);
    }
  }
  
  async refreshPackages() {
    this.container.innerHTML = '<div class="loading" style="padding: 20px; text-align: center;">Refreshing packages...</div>';
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Mock loading delay
      await this.loadPackages();
      this.render();
    } catch (error) {
      console.error('Failed to refresh packages:', error);
      this.showMessage('Failed to refresh package list', 'error');
    }
  }
  
  showMessage(message, type = 'info') {
    // Create a temporary message element
    const messageEl = document.createElement('div');
    messageEl.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 16px;
      border-radius: 6px;
      color: white;
      font-size: 14px;
      z-index: 1000;
      max-width: 300px;
    `;
    
    switch (type) {
      case 'success':
        messageEl.style.background = '#10b981';
        break;
      case 'error':
        messageEl.style.background = '#ef4444';
        break;
      case 'info':
      default:
        messageEl.style.background = '#3b82f6';
        break;
    }
    
    messageEl.textContent = message;
    document.body.appendChild(messageEl);
    
    // Remove after 3 seconds
    setTimeout(() => {
      if (document.body.contains(messageEl)) {
        document.body.removeChild(messageEl);
      }
    }, 3000);
  }
  
  destroy() {
    // Cleanup when popup is closed
    this.packages = [];
  }
}

// Export to global scope
window.PackagesPopup = PackagesPopup;
