// Sidebar Manager - Handles popup states and navigation
class SidebarManager {
  constructor() {
    this.activePopup = null;
    this.popupInstances = new Map();
    this.overlay = document.getElementById("popup-overlay");
    this.templateCache = new Map();

    this.initializeEventListeners();
  }

  initializeEventListeners() {
    // Handle sidebar item clicks
    document.querySelectorAll(".sidebar-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        e.preventDefault();
        const popupType = item.getAttribute("data-popup");
        this.togglePopup(popupType);
      });
    });

    // Handle overlay clicks to close popup
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.closePopup();
      }
    });

    // Handle escape key to close popup
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.activePopup) {
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
    this.closePopup();
    this.activePopup = popupType;

    // Update sidebar item states
    document.querySelectorAll(".sidebar-item").forEach((item) => {
      item.classList.remove("active");
      if (item.getAttribute("data-popup") === popupType) {
        item.classList.add("active");
      }
    });

    this.overlay.style.display = "block";
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
    document.querySelectorAll(".sidebar-item").forEach((item) => {
      item.classList.remove("active");
    });
    this.overlay.style.display = "none";
    this.overlay.innerHTML = "";
    this.popupInstances.clear();
  }

  async loadPopupContent(popupType) {
    try {
      const content = await this.createPopupContent(popupType);
      this.overlay.appendChild(content);

      // Initialize popup-specific functionality
      this.initializePopup(popupType);
    } catch (error) {
      console.error("Failed to load popup content:", error);
      this.showError(popupType, error.message);
    }
  }

  async createPopupContent(popupType) {
    const config = this.getPopupConfig(popupType);
    const templateHtml = await this.loadTemplate(config.template);

    const container = document.createElement("div");
    container.className = "popup-content";

    const header = document.createElement("div");
    header.className = "popup-header";

    const title = document.createElement("h2");
    title.className = "popup-title";
    title.textContent = config.title;

    const closeBtn = document.createElement("button");
    closeBtn.className = "popup-close";
    closeBtn.innerHTML = "×";
    closeBtn.addEventListener("click", () => this.closePopup());

    header.appendChild(title);
    header.appendChild(closeBtn);
    container.appendChild(header);

    const body = document.createElement("div");
    body.className = "popup-body";
    body.innerHTML = templateHtml;
    container.appendChild(body);

    return container;
  }

  async loadTemplate(templateName) {
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName);
    }

    try {
      const response = await fetch(`/static/popups/templates/${templateName}`);
      if (!response.ok) {
        throw new Error(`Template not found: ${templateName}`);
      }

      const html = await response.text();
      this.templateCache.set(templateName, html);
      return html;
    } catch (error) {
      console.error("Failed to load template:", error);
      return '<div class="error">Failed to load template</div>';
    }
  }

  getPopupConfig(popupType) {
    const configs = {
      folder: { title: "Files", template: "folder-popup.html" },
      packages: { title: "Packages", template: "packages-popup.html" },
      python: { title: "Python Environment", template: "python-popup.html" },
      metrics: { title: "System Metrics", template: "metrics-popup.html" },
      settings: { title: "Settings", template: "settings-popup.html" },
    };

    return configs[popupType] || { title: "Unknown", template: null };
  }

  async showError(popupType, message) {
    this.lastFailedPopupType = popupType; // Store for retry

    try {
      const errorTemplate = await this.loadTemplate("error-popup.html");
      const errorHtml = this.substituteVariables(errorTemplate, {
        message: `Failed to load ${popupType} popup`,
        details: message,
      });

      const container = document.createElement("div");
      container.className = "popup-content";

      const header = document.createElement("div");
      header.className = "popup-header";

      const title = document.createElement("h2");
      title.className = "popup-title";
      title.textContent = "Error";

      const closeBtn = document.createElement("button");
      closeBtn.className = "popup-close";
      closeBtn.innerHTML = "×";
      closeBtn.addEventListener("click", () => this.closePopup());

      header.appendChild(title);
      header.appendChild(closeBtn);
      container.appendChild(header);

      const body = document.createElement("div");
      body.className = "popup-body";
      body.innerHTML = errorHtml;
      container.appendChild(body);

      this.overlay.appendChild(container);
    } catch (error) {
      // Fallback if even the error template fails
      console.error("Failed to load error template:", error);
      this.overlay.innerHTML = `
        <div class="popup-content">
          <div class="popup-header">
            <h2 class="popup-title">Critical Error</h2>
            <button class="popup-close" onclick="window.sidebarManager.closePopup()">×</button>
          </div>
          <div class="popup-body">
            <p>Multiple errors occurred. Please refresh the page.</p>
          </div>
        </div>
      `;
    }
  }

  substituteVariables(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, "g");
      result = result.replace(regex, value || "");
    }
    return result;
  }

  retryPopup() {
    if (this.lastFailedPopupType) {
      // Clear template cache for failed popup
      const config = this.getPopupConfig(this.lastFailedPopupType);
      this.templateCache.delete(config.template);

      // Retry opening the popup
      this.closePopup();
      this.openPopup(this.lastFailedPopupType);
    }
  }

  initializePopup(popupType) {
    switch (popupType) {
      case "folder":
        if (window.FolderPopup) {
          const instance = new window.FolderPopup(
            this.overlay.querySelector(".file-tree"),
          );
          this.popupInstances.set(popupType, instance);
        }
        break;
      case "packages":
        if (window.PackagesPopup) {
          const instance = new window.PackagesPopup(
            this.overlay.querySelector(".package-list"),
          );
          this.popupInstances.set(popupType, instance);
        }
        break;
      case "python":
        if (window.PythonPopup) {
          const instance = new window.PythonPopup(
            this.overlay.querySelector(".python-env-list"),
          );
          this.popupInstances.set(popupType, instance);
        }
        break;
      case "metrics":
        if (window.MetricsPopup) {
          const instance = new window.MetricsPopup(
            this.overlay.querySelector(".metrics-container"),
          );
          this.popupInstances.set(popupType, instance);
        }
        break;
      case "settings":
        if (window.SettingsPopup) {
          const instance = new window.SettingsPopup(
            this.overlay.querySelector(".settings-container"),
          );
          this.popupInstances.set(popupType, instance);
        }
        break;
    }
  }
}

// Initialize sidebar when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  window.sidebarManager = new SidebarManager();
});
