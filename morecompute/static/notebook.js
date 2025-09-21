class NotebookApp {
  constructor() {
    this.cells = [];
    this.currentCellIndex = null;
    this.editors = new Map();
    this.sortable = null;
    this.initializeEventListeners();
    this.initializeWebSocket();
    this.initializeSocketListeners();
    
    // Fallback: Update status after a short delay to ensure everything is initialized
    setTimeout(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        console.log('Fallback: Forcing kernel status update to connected');
        this.updateKernelStatus('connected');
      }
    }, 1000);
  }
  
  initializeWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;
    
    // Initialize event handlers storage
    this.eventHandlers = {};
    this.onConnect = null;
    this.onDisconnect = null;
    
    this.socket = new WebSocket(wsUrl);
    
    this.socket.onopen = () => {
      console.log('WebSocket connected!');
      if (this.onConnect) {
        this.onConnect();
      }
    };
    
    this.socket.onclose = (event) => {
      console.log('WebSocket disconnected:', event);
      if (this.onDisconnect) {
        this.onDisconnect();
      }
    };
    
    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const { type, data } = message;
      console.log('Received:', type, data);
      if (this.eventHandlers && this.eventHandlers[type]) {
        this.eventHandlers[type](data);
      }
    };
    
    // Socket.IO compatibility layer
    this.socket.on = (event, callback) => {
      console.log('Registering event handler for:', event);
      if (event === 'connect') {
        this.onConnect = callback;
        // If already connected, call immediately
        if (this.socket.readyState === WebSocket.OPEN) {
          console.log('Socket already connected, calling connect handler immediately');
          setTimeout(() => callback(), 0);
        }
      } else if (event === 'disconnect') {
        this.onDisconnect = callback;
      } else {
        this.eventHandlers[event] = callback;
      }
    };
    
    this.socket.emit = (event, data) => {
      console.log('Emitting:', event, data);
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: event, data }));
      } else {
        console.error('WebSocket not connected, cannot emit:', event);
      }
    };
  }
  
  initializeEventListeners() {
    document.addEventListener("keydown", (e) => {
      if (e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        this.executeCurrentCell();
      }
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        this.saveNotebook();
      }
      if (e.key === "Escape") {
        this.clearActiveCells();
      }
    });
    this.initializeSortable();
  }
  updateKernelStatus(status) {
    const dot = document.getElementById('kernel-status-dot');
    const text = document.getElementById('kernel-status-text');
    
    if (dot && text) {
      dot.classList.remove('connecting', 'connected', 'disconnected');
      
      switch (status) {
        case 'connecting':
          dot.classList.add('connecting');
          text.textContent = 'Connecting...';
          break;
        case 'connected':
          dot.classList.add('connected');
          text.textContent = 'Kernel Ready';
          break;
        case 'disconnected':
          dot.classList.add('disconnected');
          text.textContent = 'Kernel Disconnected';
          break;
      }
    }
    
    // Also update the old connection-status element if it exists
    const statusEl = document.getElementById("connection-status");
    if (statusEl) {
      statusEl.textContent = status === 'connected' ? "🔌 Connected" : "🔌 Disconnected";
    }
  }
  
  initializeSocketListeners() {
    this.socket.on("connect", () => {
      console.log('Connect event handler called!');
      this.updateKernelStatus('connected');
    });
    this.socket.on("disconnect", () => {
      console.log('Disconnect event handler called!');
      this.updateKernelStatus('disconnected');
    });
    this.socket.on("notebook_data", (data) => {
      this.loadNotebook(data);
    });
    this.socket.on("execution_result", (data) => {
      this.handleExecutionResult(data);
    });
    this.socket.on("execution_error", (data) => {
      console.error("Execution error:", data.error);
      this.showError(data.error);
    });
    this.socket.on("notebook_updated", (data) => {
      this.loadNotebook(data);
    });
    this.socket.on("kernel_reset", () => {
      this.clearAllOutputs();
      const statusEl = document.getElementById("kernel-status");
      if (statusEl) statusEl.textContent = "🧠 Reset";
    });
    this.socket.on("save_success", (data) => {
      this.showSaveSuccess(data.file_path);
    });
    this.socket.on("save_error", (data) => {
      console.error("Save error:", data.error);
      this.showError("Save failed: " + data.error);
    });
  }
  loadNotebook(data) {
    this.cells = data.cells || [];
    this.renderNotebook();
  }
  renderNotebook() {
    const notebook = document.getElementById("notebook");
    const emptyState = document.getElementById("empty-state");
    if (!notebook || !emptyState) return;
    const existingCells = notebook.querySelectorAll(".cell-wrapper");
    existingCells.forEach((cell) => cell.remove());
    if (this.cells.length === 0) {
      emptyState.style.display = "flex";
      this.setupAddCellListeners(emptyState.querySelector(".add-cell-line"), 0);
    } else {
      emptyState.style.display = "none";
      this.cells.forEach((cellData, index) => {
        this.renderCell(cellData, index);
      });
      this.initializeSortable();
    }
  }
  renderCell(cellData, index) {
    const template = document.getElementById("cell-template");
    if (!template) return;
    const cellWrapper = template.content.cloneNode(true);
    const cell = cellWrapper.querySelector(".cell");
    const wrapper = cellWrapper.querySelector(".cell-wrapper");
    if (!cell || !wrapper) return;
    cell.setAttribute("data-cell-index", index.toString());
    wrapper.setAttribute("data-cell-index", index.toString());
    const executionCount = cell.querySelector(".execution-count");
    if (executionCount) {
      if (cellData.execution_count) {
        executionCount.textContent = `[${cellData.execution_count}]`;
      } else {
        executionCount.textContent = "[ ]";
      }
    }
    const editor = cell.querySelector(".cell-editor");
    if (editor) {
      editor.value = cellData.source || "";
    }
    this.setupCellEventListeners(wrapper, index);
    const addLineAbove = wrapper.querySelector(".add-line-above");
    const addLineBelow = wrapper.querySelector(".add-line-below");
    this.setupAddCellListeners(addLineAbove, index);
    this.setupAddCellListeners(addLineBelow, index + 1);
    const notebook = document.getElementById("notebook");
    if (notebook) {
      notebook.appendChild(wrapper);
    }
    this.initializeCodeMirror(cell, index, cellData.cell_type || "code");
    if (cellData.outputs && cellData.outputs.length > 0) {
      this.renderCellOutputs(cell, cellData.outputs);
    }
  }
  initializeSortable() {
    const notebook = document.getElementById("notebook");
    if (!notebook) return;
    if (this.sortable) {
      this.sortable.destroy();
    }
    this.sortable = Sortable.create(notebook, {
      handle: ".drag-handle",
      animation: 150,
      ghostClass: "sortable-ghost",
      dragClass: "sortable-drag",
      filter: ".empty-state",
      onEnd: (evt) => {
        const oldIndex = evt.oldIndex;
        const newIndex = evt.newIndex;
        if (oldIndex !== newIndex) {
          this.reorderCells(oldIndex, newIndex);
        }
      },
    });
  }
  setupAddCellListeners(addLine, insertIndex) {
    if (!addLine) {
      console.log("No addLine found");
      return;
    }
    const addButton = addLine.querySelector(".add-cell-button");
    const menu = addLine.querySelector(".cell-type-menu");
    if (addButton) {
      addButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showCellTypeMenu(menu);
      });
    }
    const codeOption =
      menu === null || menu === void 0
        ? void 0
        : menu.querySelector('[data-type="code"]');
    const markdownOption =
      menu === null || menu === void 0
        ? void 0
        : menu.querySelector('[data-type="markdown"]');
    if (codeOption) {
      codeOption.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.addCell("code", insertIndex);
        this.hideCellTypeMenu(menu);
      });
    }
    if (markdownOption) {
      markdownOption.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.addCell("markdown", insertIndex);
        this.hideCellTypeMenu(menu);
      });
    }
  }
  showCellTypeMenu(menu) {
    if (menu) {
      menu.style.display = "block";
    }
  }
  hideCellTypeMenu(menu) {
    if (menu) {
      menu.style.display = "none";
    }
  }
  clearActiveCells() {
    document.querySelectorAll(".cell.active").forEach((cell) => {
      cell.classList.remove("active");
    });
    this.currentCellIndex = null;
  }
  reorderCells(oldIndex, newIndex) {
    const cell = this.cells.splice(oldIndex, 1)[0];
    this.cells.splice(newIndex, 0, cell);
    this.updateCellIndices();
  }
  updateCellIndices() {
    const wrappers = document.querySelectorAll(".cell-wrapper");
    wrappers.forEach((wrapper, index) => {
      const cell = wrapper.querySelector(".cell");
      if (cell) {
        cell.setAttribute("data-cell-index", index.toString());
        wrapper.setAttribute("data-cell-index", index.toString());
      }
    });
  }
  focusNextCell(currentIndex) {
    const nextIndex = currentIndex + 1;
    if (nextIndex < this.cells.length) {
      this.setActiveCell(nextIndex);
    } else {
      this.addCell("markdown", nextIndex);
    }
  }
  initializeCodeMirror(cell, index, cellType) {
    const textarea = cell.querySelector(".cell-editor");
    if (!textarea) return;
    const mode = cellType === "code" ? "python" : "text/plain";
    const editor = CodeMirror.fromTextArea(textarea, {
      mode: mode,
      lineNumbers: false,
      theme: "default",
      autoCloseBrackets: cellType === "code",
      matchBrackets: cellType === "code",
      indentUnit: 4,
      lineWrapping: true,
      placeholder:
        cellType === "code"
          ? "Enter your code here..."
          : "Enter markdown text here...",
      extraKeys: {
        "Shift-Enter": () => {
          if (cellType === "code") {
            this.executeCell(index);
          } else {
            this.focusNextCell(index);
          }
        },
        "Ctrl-Enter": () => {
          this.executeCell(index);
        },
        Tab: cellType === "code" ? "indentMore" : false,
        "Shift-Tab": cellType === "code" ? "indentLess" : false,
      },
    });
    this.editors.set(index, editor);
    editor.on("change", () => {
      const source = editor.getValue();
      this.updateCellSource(index, source);
    });
    editor.on("focus", () => {
      this.setActiveCell(index);
    });
  }
  setupCellEventListeners(wrapper, index) {
    const cell = wrapper.querySelector(".cell");
    if (!cell) return;
    const runBtn = cell.querySelector(".run-cell-btn");
    if (runBtn) {
      runBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.executeCell(index);
      });
    }
    const deleteBtn = cell.querySelector(".delete-cell-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.deleteCell(index);
      });
    }
    cell.addEventListener("click", () => {
      this.setActiveCell(index);
    });
    const dragHandle = cell.querySelector(".drag-handle");
    if (dragHandle) {
      dragHandle.addEventListener("mousedown", (e) => {
        // Sortable handles the dragging
      });
    }
  }
  addCell(cellType = "code", index = -1) {
    const insertIndex =
      index !== undefined && index >= 0 ? index : this.cells.length;
    this.socket.emit("add_cell", {
      index: insertIndex,
      cell_type: cellType,
      source: "",
    });
  }
  deleteCell(index) {
    this.socket.emit("delete_cell", {
      cell_index: index,
    });
    this.editors.delete(index);
  }
  executeCell(index) {
    const cell = document.querySelector(`.cell[data-cell-index="${index}"]`);
    const editor = this.editors.get(index);
    if (!editor) {
      console.error("No editor found for cell", index);
      return;
    }
    
    // Check if this is a text/markdown cell
    const cellData = this.cells[index];
    const cellType = cellData ? cellData.cell_type : 'code';
    
    if (cellType === 'markdown' || cellType === 'text') {
      // For text/markdown cells, render the content instead of executing
      console.log('Rendering text/markdown cell:', index);
      this.renderMarkdownCell(index);
      return;
    }
    
    // For code cells, execute normally
    const source = editor.getValue();
    if (cell) {
      cell.classList.add("executing");
    }
    const timeEl =
      cell === null || cell === void 0
        ? void 0
        : cell.querySelector(".execution-time");
    if (timeEl) {
      timeEl.style.display = "none";
    }
    this.socket.emit("execute_cell", {
      cell_index: index,
      source: source,
    });
  }
  executeCurrentCell() {
    if (this.currentCellIndex !== null) {
      this.executeCell(this.currentCellIndex);
    }
  }
  updateCellSource(index, source) {
    this.socket.emit("update_cell", {
      cell_index: index,
      source: source,
    });
  }
  changeCellType(index, newType) {
    const editor = this.editors.get(index);
    if (editor) {
      const mode = newType === "code" ? "python" : "text/plain";
      editor.setOption("mode", mode);
    }
    if (this.cells[index]) {
      this.cells[index].cell_type = newType;
    }
  }
  setActiveCell(index) {
    document.querySelectorAll(".cell").forEach((cell) => {
      cell.classList.remove("active");
    });
    const cell = document.querySelector(`.cell[data-cell-index="${index}"]`);
    if (cell) {
      cell.classList.add("active");
      const editor = this.editors.get(index);
      if (editor) {
        setTimeout(() => editor.focus(), 100);
      }
    }
    this.currentCellIndex = index;
  }
  handleExecutionResult(data) {
    const { cell_index, result } = data;
    const cell = document.querySelector(
      `.cell[data-cell-index="${cell_index}"]`,
    );
    if (!cell) return;
    cell.classList.remove("executing");
    const executionCountEl = cell.querySelector(".execution-count");
    if (result.execution_count && executionCountEl) {
      executionCountEl.textContent = `[${result.execution_count}]`;
    }
    const timeEl = cell.querySelector(".execution-time");
    if (timeEl && result.execution_time) {
      timeEl.textContent = result.execution_time;
      timeEl.style.display = "block";
    }

    // Show execution status icon
    const statusEl = cell.querySelector(".execution-status");
    const statusIcon = cell.querySelector(".status-icon");
    if (statusEl && statusIcon) {
      if (result.status === "ok") {
        statusIcon.src = "/assets/icons/check.svg";
        statusIcon.alt = "Success";
      } else {
        statusIcon.src = "/assets/icons/x.svg";
        statusIcon.alt = "Error";
      }
      statusEl.style.display = "block";

      // Hide the status icon after 3 seconds
      setTimeout(() => {
        statusEl.style.display = "none";
      }, 3000);
    }

    this.renderCellOutputs(cell, result.outputs);
  }
  renderCellOutputs(cell, outputs) {
    const outputContainer = cell.querySelector(".cell-output");
    const outputContent = cell.querySelector(".output-content");
    if (!outputContainer || !outputContent) return;
    if (!outputs || outputs.length === 0) {
      outputContainer.style.display = "none";
      return;
    }
    outputContent.innerHTML = "";
    outputContainer.style.display = "block";
    outputs.forEach((output) => {
      const outputElement = this.createOutputElement(output);
      outputContent.appendChild(outputElement);
    });
  }
  createOutputElement(output) {
    const div = document.createElement("div");
    switch (output.output_type) {
      case "stream":
        div.className = `output-stream ${output.name}`;
        div.textContent = output.text;
        break;
      case "execute_result":
        div.className = "output-result";
        div.textContent = output.data["text/plain"] || "";
        break;
      case "error":
        div.className = "output-error";
        div.textContent = output.traceback.join("\n");
        break;
      default:
        div.className = "output-stream";
        div.textContent = JSON.stringify(output);
    }
    return div;
  }
  clearAllOutputs() {
    document.querySelectorAll(".cell-output").forEach((output) => {
      output.style.display = "none";
      const content = output.querySelector(".output-content");
      if (content) content.innerHTML = "";
    });
    document.querySelectorAll(".execution-count").forEach((count) => {
      count.textContent = "[ ]";
    });
  }
  
  renderMarkdownCell(index) {
    const cell = document.querySelector(`.cell[data-cell-index="${index}"]`);
    const editor = this.editors.get(index);
    if (!editor || !cell) return;
    
    const source = editor.getValue().trim();
    const outputContainer = cell.querySelector(".cell-output");
    const outputContent = cell.querySelector(".output-content");
    
    if (!outputContainer || !outputContent) return;
    
    // Clear previous output
    outputContent.innerHTML = "";
    
    if (!source) {
      // Empty text cell
      outputContainer.style.display = "none";
      return;
    }
    
    // Create rendered text output
    const div = document.createElement("div");
    div.className = "text-cell-output";
    div.style.cssText = `
      padding: 12px 16px;
      line-height: 1.6;
      color: #1f2937;
      background: #ffffff;
      border-radius: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    // Simple markdown-like rendering
    let htmlContent = source
      // Headers
      .replace(/^# (.*$)/gm, '<h1 style="font-size: 1.5em; font-weight: 600; margin: 16px 0 8px 0; color: #111827;">$1</h1>')
      .replace(/^## (.*$)/gm, '<h2 style="font-size: 1.3em; font-weight: 600; margin: 16px 0 8px 0; color: #111827;">$1</h2>')
      .replace(/^### (.*$)/gm, '<h3 style="font-size: 1.1em; font-weight: 600; margin: 16px 0 8px 0; color: #111827;">$1</h3>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code
      .replace(/`(.*?)`/g, '<code style="background: #f3f4f6; padding: 2px 4px; border-radius: 3px; font-family: monospace;">$1</code>')
      // Line breaks
      .replace(/\n\n/g, '</p><p style="margin: 8px 0;">')
      .replace(/\n/g, '<br>');
    
    // Wrap in paragraphs if not already wrapped
    if (!htmlContent.startsWith('<h') && !htmlContent.startsWith('<p')) {
      htmlContent = '<p style="margin: 8px 0;">' + htmlContent + '</p>';
    }
    
    div.innerHTML = htmlContent;
    outputContent.appendChild(div);
    outputContainer.style.display = "block";
    
    console.log('Text cell rendered for index:', index);
  }
  
  saveNotebook() {
    this.socket.emit("save_notebook", {
      file_path: "notebook.py",
    });
  }
  resetKernel() {
    if (
      confirm(
        "Are you sure you want to reset the kernel? This will clear all variables and outputs.",
      )
    ) {
      this.socket.emit("reset_kernel");
    }
  }
  showError(message) {
    console.error("Error:", message);
    alert("Error: " + message);
  }
  showSaveSuccess(filePath) {
    const saveBtn = document.getElementById("save-btn");
    if (saveBtn) {
      const originalText = saveBtn.textContent;
      saveBtn.textContent = "✅ Saved";
      setTimeout(() => {
        saveBtn.textContent = originalText;
      }, 2000);
    }
  }
}
document.addEventListener("DOMContentLoaded", () => {
  window.notebookApp = new NotebookApp();
});
