// Folder Browser Popup Component
class FolderPopup {
  constructor(container) {
    this.container = container;
    this.currentPath = '.';
    this.files = [];
    
    this.initialize();
  }
  
  async initialize() {
    try {
      await this.loadFiles();
      this.render();
    } catch (error) {
      console.error('Failed to load files:', error);
      this.container.innerHTML = '<div class="error">Failed to load files</div>';
    }
  }
  
  async loadFiles() {
    try {
      // For now, we'll create a mock file tree
      // In a real implementation, this would fetch from the server
      this.files = await this.getMockFileTree();
    } catch (error) {
      throw new Error('Failed to fetch file tree: ' + error.message);
    }
  }
  
  async getMockFileTree() {
    // Mock file tree for demonstration
    // In production, this would be an API call to the server
    return [
      { name: 'morecompute', type: 'folder', path: './morecompute' },
      { name: '__init__.py', type: 'file', path: './morecompute/__init__.py' },
      { name: 'notebook.py', type: 'file', path: './morecompute/notebook.py' },
      { name: 'server.py', type: 'file', path: './morecompute/server.py' },
      { name: 'static', type: 'folder', path: './morecompute/static' },
      { name: 'templates', type: 'folder', path: './morecompute/templates' },
      { name: 'assets', type: 'folder', path: './assets' },
      { name: 'README.md', type: 'file', path: './README.md' },
      { name: 'requirements.txt', type: 'file', path: './requirements.txt' },
      { name: 'setup.py', type: 'file', path: './setup.py' },
      { name: '.gitignore', type: 'file', path: './.gitignore' },
    ];
  }
  
  render() {
    this.container.innerHTML = '';
    
    // Add current path indicator
    const pathHeader = document.createElement('div');
    pathHeader.className = 'file-path-header';
    pathHeader.style.cssText = `
      padding: 8px 0;
      margin-bottom: 12px;
      font-size: 12px;
      color: #6b7280;
      border-bottom: 1px solid #e5e7eb;
    `;
    pathHeader.textContent = `Current: ${this.currentPath}`;
    this.container.appendChild(pathHeader);
    
    // Create file tree
    const tree = document.createElement('div');
    tree.className = 'file-tree';
    
    this.files.forEach(file => {
      const fileItem = this.createFileItem(file);
      tree.appendChild(fileItem);
    });
    
    this.container.appendChild(tree);
  }
  
  createFileItem(file) {
    const item = document.createElement('div');
    item.className = 'file-item';
    
    const icon = document.createElement('img');
    icon.className = 'file-icon';
    
    if (file.type === 'folder') {
      icon.src = '/assets/icons/folder.svg';
      icon.alt = 'Folder';
    } else {
      // Use a generic file icon - you could add more specific icons based on file extension
      icon.src = '/assets/icons/folder.svg'; // Using folder icon as placeholder for files
      icon.alt = 'File';
      icon.style.opacity = '0.5';
    }
    
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.name;
    
    item.appendChild(icon);
    item.appendChild(name);
    
    // Add click handler
    item.addEventListener('click', () => {
      if (file.type === 'folder') {
        this.navigateToFolder(file.path);
      } else {
        this.openFile(file.path);
      }
    });
    
    return item;
  }
  
  async navigateToFolder(folderPath) {
    try {
      this.currentPath = folderPath;
      this.container.innerHTML = '<div class="loading">Loading...</div>';
      
      // In a real implementation, this would fetch folder contents from server
      await new Promise(resolve => setTimeout(resolve, 300)); // Mock loading delay
      
      // For demo, just show a message
      this.container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #6b7280;">
          <p>Folder navigation will be implemented with server API</p>
          <p style="font-size: 12px; margin-top: 8px;">Path: ${folderPath}</p>
          <button style="margin-top: 12px; padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 4px; background: white;" onclick="window.sidebarManager.closePopup()">
            Close
          </button>
        </div>
      `;
    } catch (error) {
      console.error('Failed to navigate to folder:', error);
      this.container.innerHTML = '<div class="error">Failed to load folder contents</div>';
    }
  }
  
  openFile(filePath) {
    // In a real implementation, this would open the file in the editor or notebook
    console.log('Opening file:', filePath);
    
    // Show a notification
    this.container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #6b7280;">
        <p>File opening will be implemented with editor integration</p>
        <p style="font-size: 12px; margin-top: 8px;">File: ${filePath}</p>
        <button style="margin-top: 12px; padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 4px; background: white;" onclick="window.sidebarManager.closePopup()">
          Close
        </button>
      </div>
    `;
  }
  
  destroy() {
    // Cleanup when popup is closed
    this.files = [];
  }
}

// Export to global scope
window.FolderPopup = FolderPopup;
