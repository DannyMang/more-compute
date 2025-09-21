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
      console.error("Failed to load settings:", error);
      this.container.innerHTML =
        '<div class="error">Failed to load settings</div>';
    }
  }

  async loadSettings() {
    try {
      // For now, we'll create default settings
      // In a real implementation, this would fetch from server or localStorage
      this.settings = await this.getDefaultSettings();
    } catch (error) {
      throw new Error("Failed to fetch settings: " + error.message);
    }
  }

  async getDefaultSettings() {
    // Default settings for morecompute
    return {
      theme: "light",
      auto_save: true,
      auto_save_interval: 30,
      font_size: 14,
      font_family: "SF Mono",
      cell_execution: {
        auto_focus_next: true,
        clear_output_on_run: false,
        show_execution_time: true,
      },
      notebook: {
        max_cells: 100,
        default_cell_type: "code",
        enable_line_numbers: true,
        enable_code_folding: true,
      },
      kernel: {
        timeout: 300,
        auto_restart_on_failure: false,
        capture_stdout: true,
        capture_stderr: true,
      },
      ui: {
        sidebar_width: 60,
        show_tooltips: true,
        animation_speed: "normal",
        compact_mode: false,
      },
      editor: {
        tab_size: 4,
        wrap_lines: true,
        highlight_active_line: true,
        show_invisibles: false,
        vim_mode: false,
      },
      advanced: {
        debug_mode: false,
        experimental_features: false,
        log_level: "info",
      },
    };
  }

  render() {
    this.container.innerHTML = "";

    // Add description
    const description = document.createElement("div");
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
    const editorContainer = document.createElement("div");
    editorContainer.className = "settings-editor-container";

    const editorLabel = document.createElement("label");
    editorLabel.textContent = "Configuration (JSON):";
    editorLabel.style.cssText = `
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
      color: #374151;
    `;

    this.editor = document.createElement("textarea");
    this.editor.className = "settings-editor";
    this.editor.value = JSON.stringify(this.settings, null, 2);

    editorContainer.appendChild(editorLabel);
    editorContainer.appendChild(this.editor);
    this.container.appendChild(editorContainer);

    // Add action buttons
    const actions = document.createElement("div");
    actions.className = "settings-actions";

    const resetBtn = document.createElement("button");
    resetBtn.className = "btn btn-secondary";
    resetBtn.id = "reset-settings";
    resetBtn.textContent = "Reset to Defaults";
    resetBtn.addEventListener("click", () => this.resetSettings());

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary";
    saveBtn.id = "save-settings";
    saveBtn.textContent = "Save Settings";
    saveBtn.addEventListener("click", () => this.saveSettings());

    actions.appendChild(resetBtn);
    actions.appendChild(saveBtn);
    this.container.appendChild(actions);
  }

  setupEditor() {
    // Add syntax highlighting and validation
    this.editor.addEventListener("input", () => {
      this.debounce(() => {
        this.validateJSON(false); // Silent validation
      }, 500);
    });

    // Add keyboard shortcuts
    this.editor.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "s") {
          e.preventDefault();
          this.saveSettings();
        } else if (e.key === "r") {
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
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Settings must be an object");
      }

      this.editor.style.borderColor = "#10b981";
      this.editor.style.backgroundColor = "#f0fdf4";

      if (showMessage) {
        this.showMessage("JSON is valid!", "success");
      }

      return true;
    } catch (error) {
      this.editor.style.borderColor = "#ef4444";
      this.editor.style.backgroundColor = "#fef2f2";

      if (showMessage) {
        this.showMessage(`JSON Error: ${error.message}`, "error");
      }

      return false;
    }
  }

  async saveSettings() {
    // Automatically validate JSON before saving
    if (!this.validateJSON(true)) {
      return; // Validation failed, error message already shown
    }

    try {
      const newSettings = JSON.parse(this.editor.value);
      this.settings = newSettings;

      // In a real implementation, this would save to server or localStorage
      this.showMessage("Settings saved successfully!", "success");

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      this.showMessage("Failed to save settings: " + error.message, "error");
    }
  }

  async resetSettings() {
    if (
      confirm("Are you sure you want to reset all settings to default values?")
    ) {
      try {
        this.settings = await this.getDefaultSettings();
        this.editor.value = JSON.stringify(this.settings, null, 2);
        this.editor.style.borderColor = "#d1d5db";
        this.editor.style.backgroundColor = "#f9fafb";

        this.showMessage("Settings reset to defaults", "success");
      } catch (error) {
        this.showMessage("Failed to reset settings: " + error.message, "error");
      }
    }
  }

  debounce(func, delay) {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    this.debounceTimeout = setTimeout(func, delay);
  }

  showMessage(message, type = "info") {
    // Create a temporary message element
    const messageEl = document.createElement("div");
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
      case "success":
        messageEl.style.background = "#10b981";
        break;
      case "error":
        messageEl.style.background = "#ef4444";
        break;
      case "info":
      default:
        messageEl.style.background = "#3b82f6";
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
