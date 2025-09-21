// Settings Configuration Popup Component
class SettingsPopup {
  constructor(container) {
    this.container = container;
    this.settings = {};
    this.editor = null;
    
    this.initialize();
  }
  
  async initialize() {
    try {
      await this.loadSettings();
      this.render();
      this.setupEditor();
    } catch (error) {
      console.error('Failed to load settings:', error);
      this.container.innerHTML = '<div class="error">Failed to load settings</div>';
    }
  }
  
  async loadSettings() {
    try {
      // For now, we'll create default settings
      // In a real implementation, this would fetch from server or localStorage
      this.settings = await this.getDefaultSettings();
    } catch (error) {
      throw new Error('Failed to fetch settings: ' + error.message);
    }
  }
  
  async getDefaultSettings() {
    // Default settings for morecompute
    return {
      "theme": "light",
      "auto_save": true,
      "auto_save_interval": 30,
      "font_size": 14,
      "font_family": "SF Mono",
      "cell_execution": {
        "auto_focus_next": true,
        "clear_output_on_run": false,
        "show_execution_time": true
      },
      "notebook": {
        "max_cells": 100,
        "default_cell_type": "code",
        "enable_line_numbers": true,
        "enable_code_folding": true
      },
      "kernel": {
        "timeout": 300,
        "auto_restart_on_failure": false,
        "capture_stdout": true,
        "capture_stderr": true
      },
      "ui": {
        "sidebar_width": 60,
        "show_tooltips": true,
        "animation_speed": "normal",
        "compact_mode": false
      },
      "editor": {
        "tab_size": 4,
        "wrap_lines": true,
        "highlight_active_line": true,
        "show_invisibles": false,
        "vim_mode": false
      },
      "advanced": {
        "debug_mode": false,
        "experimental_features": false,
        "log_level": "info"
      }
    };
  }
  
  render() {
    this.container.innerHTML = '';
    
    // Add description
    const description = document.createElement('div');
    description.style.cssText = `
      margin-bottom: 16px;
      padding: 12px;
      background: #f8f9fa;
      border-radius: 6px;
      color: #6b7280;
      font-size: 13px;
      line-height: 1.5;
    `;
    description.innerHTML = `
      <strong>MoreCompute Settings</strong><br>
      Configure your notebook environment. Changes are saved automatically.
      <br><br>
      <em>Note: Some changes may require a page refresh to take effect.</em>
    `;
    
    this.container.appendChild(description);
    
    // Add settings editor
    const editorContainer = document.createElement('div');
    editorContainer.className = 'settings-editor-container';
    
    const editorLabel = document.createElement('label');
    editorLabel.textContent = 'Configuration (JSON):';
    editorLabel.style.cssText = `
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
      color: #374151;
    `;
    
    this.editor = document.createElement('textarea');
    this.editor.className = 'settings-editor';
    this.editor.value = JSON.stringify(this.settings, null, 2);
    
    editorContainer.appendChild(editorLabel);
    editorContainer.appendChild(this.editor);
    this.container.appendChild(editorContainer);
    
    // Add action buttons
    const actions = document.createElement('div');
    actions.className = 'settings-actions';
    
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn-secondary';
    resetBtn.id = 'reset-settings';
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.addEventListener('click', () => this.resetSettings());
    
    const validateBtn = document.createElement('button');
    validateBtn.className = 'btn btn-secondary';
    validateBtn.textContent = 'Validate JSON';
    validateBtn.style.background = '#f59e0b';
    validateBtn.style.color = 'white';
    validateBtn.style.border = 'none';
    validateBtn.addEventListener('click', () => this.validateJSON());
    
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.id = 'save-settings';
    saveBtn.textContent = 'Save Settings';
    saveBtn.addEventListener('click', () => this.saveSettings());
    
    actions.appendChild(resetBtn);
    actions.appendChild(validateBtn);
    actions.appendChild(saveBtn);
    this.container.appendChild(actions);
    
    // Add settings categories quick access
    this.addQuickAccess();
  }
  
  addQuickAccess() {
    const quickAccess = document.createElement('div');
    quickAccess.style.cssText = `
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
    `;
    
    const title = document.createElement('h4');
    title.textContent = 'Quick Settings';
    title.style.cssText = `
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
    `;
    
    const quickOptions = document.createElement('div');
    quickOptions.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      font-size: 13px;
    `;
    
    // Theme toggle
    const themeOption = this.createQuickOption('Theme', 'theme', ['light', 'dark'], this.settings.theme);
    
    // Auto-save toggle
    const autoSaveOption = this.createToggleOption('Auto Save', 'auto_save', this.settings.auto_save);
    
    // Font size
    const fontSizeOption = this.createNumberOption('Font Size', 'font_size', this.settings.font_size, 10, 24);
    
    // Line numbers toggle
    const lineNumbersOption = this.createToggleOption('Line Numbers', 'notebook.enable_line_numbers', this.settings.notebook.enable_line_numbers);
    
    quickOptions.appendChild(themeOption);
    quickOptions.appendChild(autoSaveOption);
    quickOptions.appendChild(fontSizeOption);
    quickOptions.appendChild(lineNumbersOption);
    
    quickAccess.appendChild(title);
    quickAccess.appendChild(quickOptions);
    this.container.appendChild(quickAccess);
  }
  
  createQuickOption(label, path, options, currentValue) {
    const container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;
    
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = `
      font-weight: 500;
      color: #374151;
    `;
    
    const select = document.createElement('select');
    select.style.cssText = `
      padding: 4px 6px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 12px;
    `;
    
    options.forEach(option => {
      const optionEl = document.createElement('option');
      optionEl.value = option;
      optionEl.textContent = option.charAt(0).toUpperCase() + option.slice(1);
      optionEl.selected = option === currentValue;
      select.appendChild(optionEl);
    });
    
    select.addEventListener('change', () => {
      this.updateSettingValue(path, select.value);
    });
    
    container.appendChild(labelEl);
    container.appendChild(select);
    return container;
  }
  
  createToggleOption(label, path, currentValue) {
    const container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = currentValue;
    checkbox.addEventListener('change', () => {
      this.updateSettingValue(path, checkbox.checked);
    });
    
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = `
      font-weight: 500;
      color: #374151;
      cursor: pointer;
    `;
    labelEl.addEventListener('click', () => checkbox.click());
    
    container.appendChild(checkbox);
    container.appendChild(labelEl);
    return container;
  }
  
  createNumberOption(label, path, currentValue, min, max) {
    const container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;
    
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = `
      font-weight: 500;
      color: #374151;
    `;
    
    const input = document.createElement('input');
    input.type = 'number';
    input.min = min;
    input.max = max;
    input.value = currentValue;
    input.style.cssText = `
      padding: 4px 6px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 12px;
      width: 60px;
    `;
    
    input.addEventListener('change', () => {
      const value = parseInt(input.value);
      if (value >= min && value <= max) {
        this.updateSettingValue(path, value);
      }
    });
    
    container.appendChild(labelEl);
    container.appendChild(input);
    return container;
  }
  
  updateSettingValue(path, value) {
    // Update the settings object
    const pathParts = path.split('.');
    let obj = this.settings;
    
    for (let i = 0; i < pathParts.length - 1; i++) {
      obj = obj[pathParts[i]];
    }
    
    obj[pathParts[pathParts.length - 1]] = value;
    
    // Update the editor
    this.editor.value = JSON.stringify(this.settings, null, 2);
    
    this.showMessage(`Updated ${path} = ${value}`, 'success');
  }
  
  setupEditor() {
    // Add syntax highlighting and validation
    this.editor.addEventListener('input', () => {
      this.debounce(() => {
        this.validateJSON(false); // Silent validation
      }, 500);
    });
    
    // Add keyboard shortcuts
    this.editor.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
          e.preventDefault();
          this.saveSettings();
        } else if (e.key === 'r') {
          e.preventDefault();
          this.resetSettings();
        }
      }
    });
  }
  
  validateJSON(showMessage = true) {
    try {
      const jsonText = this.editor.value.trim();
      const parsed = JSON.parse(jsonText);
      
      // Basic structure validation
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Settings must be an object');
      }
      
      this.editor.style.borderColor = '#10b981';
      this.editor.style.backgroundColor = '#f0fdf4';
      
      if (showMessage) {
        this.showMessage('JSON is valid!', 'success');
      }
      
      return true;
    } catch (error) {
      this.editor.style.borderColor = '#ef4444';
      this.editor.style.backgroundColor = '#fef2f2';
      
      if (showMessage) {
        this.showMessage(`JSON Error: ${error.message}`, 'error');
      }
      
      return false;
    }
  }
  
  async saveSettings() {
    if (!this.validateJSON()) {
      this.showMessage('Please fix JSON errors before saving', 'error');
      return;
    }
    
    try {
      const newSettings = JSON.parse(this.editor.value);
      this.settings = newSettings;
      
      // In a real implementation, this would save to server or localStorage
      this.showMessage('Settings saved successfully! 📝', 'success');
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Re-render quick access with new values
      this.addQuickAccess();
      
    } catch (error) {
      this.showMessage('Failed to save settings: ' + error.message, 'error');
    }
  }
  
  async resetSettings() {
    if (confirm('Are you sure you want to reset all settings to default values?')) {
      try {
        this.settings = await this.getDefaultSettings();
        this.editor.value = JSON.stringify(this.settings, null, 2);
        this.editor.style.borderColor = '#d1d5db';
        this.editor.style.backgroundColor = '#f9fafb';
        
        this.showMessage('Settings reset to defaults', 'success');
        this.addQuickAccess();
      } catch (error) {
        this.showMessage('Failed to reset settings: ' + error.message, 'error');
      }
    }
  }
  
  debounce(func, delay) {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    this.debounceTimeout = setTimeout(func, delay);
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
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    this.settings = {};
    this.editor = null;
  }
}

// Export to global scope
window.SettingsPopup = SettingsPopup;
