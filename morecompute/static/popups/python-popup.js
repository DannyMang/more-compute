// Python Environment Selector Popup Component
class PythonPopup {
  constructor(container) {
    this.container = container;
    this.environments = [];
    this.currentEnv = null;
    
    this.initialize();
  }
  
  async initialize() {
    try {
      await this.loadEnvironments();
      this.render();
    } catch (error) {
      console.error('Failed to load Python environments:', error);
      this.container.innerHTML = '<div class="error">Failed to load Python environments</div>';
    }
  }
  
  async loadEnvironments() {
    try {
      // For now, we'll create mock environment data
      // In a real implementation, this would detect Python installations and conda envs
      this.environments = await this.getMockEnvironments();
      this.currentEnv = this.environments[0]; // Set first as current
    } catch (error) {
      throw new Error('Failed to fetch Python environments: ' + error.message);
    }
  }
  
  async getMockEnvironments() {
    // Mock Python environments for demonstration
    // In production, this would detect actual Python installations
    return [
      { 
        name: 'System Python', 
        path: '/usr/bin/python3', 
        version: '3.11.4', 
        type: 'system',
        active: true 
      },
      { 
        name: 'morecompute-env', 
        path: '/Users/user/.conda/envs/morecompute-env/bin/python', 
        version: '3.10.12', 
        type: 'conda',
        active: false 
      },
      { 
        name: 'data-science', 
        path: '/Users/user/.conda/envs/data-science/bin/python', 
        version: '3.9.16', 
        type: 'conda',
        active: false 
      },
      { 
        name: 'ml-research', 
        path: '/Users/user/venvs/ml-research/bin/python', 
        version: '3.11.2', 
        type: 'venv',
        active: false 
      },
      { 
        name: 'web-dev', 
        path: '/Users/user/venvs/web-dev/bin/python', 
        version: '3.10.8', 
        type: 'venv',
        active: false 
      },
    ];
  }
  
  render() {
    this.container.innerHTML = '';
    
    // Add current environment indicator
    const currentSection = document.createElement('div');
    currentSection.className = 'current-env-section';
    currentSection.style.cssText = `
      margin-bottom: 20px;
      padding: 16px;
      background: #f0f9ff;
      border: 1px solid #0ea5e9;
      border-radius: 8px;
    `;
    
    const currentTitle = document.createElement('h3');
    currentTitle.textContent = 'Current Environment';
    currentTitle.style.cssText = `
      margin: 0 0 8px 0;
      font-size: 14px;
      font-weight: 600;
      color: #0369a1;
    `;
    
    const currentInfo = document.createElement('div');
    if (this.currentEnv) {
      currentInfo.innerHTML = `
        <div style="font-weight: 500; margin-bottom: 4px;">${this.currentEnv.name}</div>
        <div style="font-size: 12px; color: #6b7280; margin-bottom: 2px;">Python ${this.currentEnv.version}</div>
        <div style="font-size: 11px; color: #6b7280; font-family: monospace;">${this.currentEnv.path}</div>
      `;
    } else {
      currentInfo.innerHTML = '<div style="color: #6b7280;">No environment selected</div>';
    }
    
    currentSection.appendChild(currentTitle);
    currentSection.appendChild(currentInfo);
    this.container.appendChild(currentSection);
    
    // Add refresh button
    const controls = document.createElement('div');
    controls.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    `;
    
    const title = document.createElement('h3');
    title.textContent = 'Available Environments';
    title.style.cssText = `
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
    `;
    
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn-secondary';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.style.cssText = `
      padding: 6px 12px;
      background: #f3f4f6;
      color: #374151;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    `;
    
    refreshBtn.addEventListener('click', () => {
      this.refreshEnvironments();
    });
    
    controls.appendChild(title);
    controls.appendChild(refreshBtn);
    this.container.appendChild(controls);
    
    // Add environment list
    const envList = document.createElement('div');
    envList.className = 'python-env-list';
    
    if (this.environments.length === 0) {
      envList.innerHTML = '<div style="text-align: center; color: #6b7280; padding: 20px;">No Python environments found</div>';
    } else {
      this.environments.forEach(env => {
        const envItem = this.createEnvironmentItem(env);
        envList.appendChild(envItem);
      });
    }
    
    this.container.appendChild(envList);
  }
  
  createEnvironmentItem(env) {
    const item = document.createElement('div');
    item.className = `env-item ${env.active ? 'active' : ''}`;
    
    const info = document.createElement('div');
    info.className = 'env-info';
    
    const name = document.createElement('div');
    name.className = 'env-name';
    name.textContent = env.name;
    
    const details = document.createElement('div');
    details.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 2px;
    `;
    
    const version = document.createElement('span');
    version.className = 'env-version';
    version.textContent = `Python ${env.version}`;
    
    const type = document.createElement('span');
    type.style.cssText = `
      font-size: 10px;
      color: #6b7280;
      background: #f3f4f6;
      padding: 2px 6px;
      border-radius: 10px;
      text-transform: uppercase;
    `;
    type.textContent = env.type;
    
    details.appendChild(version);
    details.appendChild(type);
    
    const path = document.createElement('div');
    path.className = 'env-path';
    path.textContent = env.path;
    
    info.appendChild(name);
    info.appendChild(details);
    info.appendChild(path);
    
    const actions = document.createElement('div');
    actions.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;
    
    if (!env.active) {
      const switchBtn = document.createElement('button');
      switchBtn.textContent = 'Switch';
      switchBtn.style.cssText = `
        padding: 4px 8px;
        font-size: 11px;
        background: #10b981;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      `;
      switchBtn.addEventListener('click', () => this.switchEnvironment(env));
      actions.appendChild(switchBtn);
    } else {
      const activeLabel = document.createElement('span');
      activeLabel.textContent = 'Active';
      activeLabel.style.cssText = `
        padding: 4px 8px;
        font-size: 11px;
        background: #10b981;
        color: white;
        border-radius: 4px;
        text-align: center;
      `;
      actions.appendChild(activeLabel);
    }
    
    if (env.type !== 'system') {
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.style.cssText = `
        padding: 4px 8px;
        font-size: 11px;
        background: #ef4444;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      `;
      deleteBtn.addEventListener('click', () => this.deleteEnvironment(env));
      actions.appendChild(deleteBtn);
    }
    
    item.appendChild(info);
    item.appendChild(actions);
    
    return item;
  }
  
  switchEnvironment(env) {
    this.showMessage(`Switching to ${env.name}...`, 'info');
    
    // Update current environment
    this.environments.forEach(e => e.active = false);
    env.active = true;
    this.currentEnv = env;
    
    // In a real implementation, this would restart the kernel with the new environment
    setTimeout(() => {
      this.showMessage(`Switched to ${env.name}. Environment switching will be fully implemented with kernel integration.`, 'success');
      this.render(); // Re-render to show updated state
    }, 1000);
  }
  
  deleteEnvironment(env) {
    if (confirm(`Are you sure you want to delete the environment '${env.name}'? This action cannot be undone.`)) {
      this.showMessage(`Deleting ${env.name}...`, 'info');
      
      // In a real implementation, this would delete the actual environment
      setTimeout(() => {
        this.showMessage(`Environment deletion will be implemented with conda/venv integration`, 'success');
      }, 1000);
    }
  }
  
  async refreshEnvironments() {
    this.container.innerHTML = '<div class="loading" style="padding: 20px; text-align: center;">Detecting Python environments...</div>';
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1500)); // Mock detection delay
      await this.loadEnvironments();
      this.render();
    } catch (error) {
      console.error('Failed to refresh environments:', error);
      this.showMessage('Failed to detect Python environments', 'error');
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
    
    // Remove after 4 seconds (longer for environment messages)
    setTimeout(() => {
      if (document.body.contains(messageEl)) {
        document.body.removeChild(messageEl);
      }
    }, 4000);
  }
  
  destroy() {
    // Cleanup when popup is closed
    this.environments = [];
    this.currentEnv = null;
  }
}

// Export to global scope
window.PythonPopup = PythonPopup;
