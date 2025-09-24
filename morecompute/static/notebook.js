class NotebookApp {
  constructor() {
    this.cells = [];
    this.currentCellIndex = null;
    this.editors = new Map();
    this.sortable = null;
    this.executionTimers = new Map(); // Track execution timers
    this.cellResizeObservers = new Map(); // Track ResizeObserver instances for each cell
    this.executingCells = new Set(); // Track currently executing cells
    this.initializeEventListeners();
    this.initializeWebSocket();
    this.initializeSocketListeners();
    // Fallback: Update status after a short delay to ensure everything is initialized
    setTimeout(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        console.log("Fallback: Forcing kernel status update to connected");
        this.updateKernelStatus("connected");
      }
    }, 1000);
  }

  initializeWebSocket() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/ws`;

    // Initialize event handlers storage
    this.eventHandlers = {};
    this.onConnect = null;
    this.onDisconnect = null;

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log("WebSocket connected!");
      if (this.onConnect) {
        this.onConnect();
      }
    };

    this.socket.onclose = (event) => {
      console.log("WebSocket disconnected:", event);
      if (this.onDisconnect) {
        this.onDisconnect();
      }
    };

    this.socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const { type, data } = message;
      console.log("Received:", type, data);
      if (this.eventHandlers && this.eventHandlers[type]) {
        this.eventHandlers[type](data);
      }
    };

    // Socket.IO compatibility layer
    this.socket.on = (event, callback) => {
      console.log("Registering event handler for:", event);
      if (event === "connect") {
        this.onConnect = callback;
        // If already connected, call immediately
        if (this.socket.readyState === WebSocket.OPEN) {
          console.log(
            "Socket already connected, calling connect handler immediately",
          );
          setTimeout(() => callback(), 0);
        }
      } else if (event === "disconnect") {
        this.onDisconnect = callback;
      } else {
        this.eventHandlers[event] = callback;
      }
    };

    this.socket.emit = (event, data) => {
      console.log("Emitting:", event, data);
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: event, data }));
      } else {
        console.error("WebSocket not connected, cannot emit:", event);
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
      if (e.ctrlKey && e.key === "c") {
        // Only interrupt if there are executing cells
        if (this.executingCells.size > 0) {
          e.preventDefault();
          this.interruptKernel();
        }
      }
    });
    this.initializeSortable();
  }
  updateKernelStatus(status) {
    const dot = document.getElementById("kernel-status-dot");
    const text = document.getElementById("kernel-status-text");

    if (dot && text) {
      dot.classList.remove("connecting", "connected", "disconnected");

      switch (status) {
        case "connecting":
          dot.classList.add("connecting");
          text.textContent = "Connecting...";
          break;
        case "connected":
          dot.classList.add("connected");
          text.textContent = "Kernel Ready";
          break;
        case "disconnected":
          dot.classList.add("disconnected");
          text.textContent = "Kernel Disconnected";
          break;
      }
    }
    const statusEl = document.getElementById("connection-status");
    if (statusEl) {
      statusEl.textContent =
        status === "connected" ? "🔌 Connected" : "🔌 Disconnected";
    }
  }

  initializeSocketListeners() {
    this.socket.on("connect", () => {
      console.log("Connect event handler called!");
      this.updateKernelStatus("connected");
    });
    this.socket.on("disconnect", () => {
      console.log("Disconnect event handler called!");
      this.updateKernelStatus("disconnected");
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
    
    // Add streaming message handlers
    this.socket.on("execution_start", (data) => {
      this.handleExecutionStart(data);
    });
    this.socket.on("stream_output", (data) => {
      this.handleStreamOutput(data);
    });
    this.socket.on("execute_result", (data) => {
      this.handleExecuteResult(data);
    });
    this.socket.on("execution_complete", (data) => {
      this.handleExecutionComplete(data);
    });
    this.socket.on("stream_error", (data) => {
      this.handleStreamError(data);
    });
    this.socket.on("execution_interrupted", (data) => {
      this.handleExecutionInterrupted(data);
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
    
    // Set up content-aware sizing
    this.setupContentAwareSizing(cell, index);
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
      viewportMargin: 10, // Small margin instead of infinity
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
      // Update cell sizing based on content
      this.updateCellSizing(index, source);
    });
    editor.on("focus", () => {
      this.setActiveCell(index);
      // Add focused class for enhanced sizing when editing
      const cell = document.querySelector(`.cell[data-cell-index="${index}"]`);
      if (cell) cell.classList.add('cell-focused');
    });
    editor.on("blur", () => {
      // Remove focused class
      const cell = document.querySelector(`.cell[data-cell-index="${index}"]`);
      if (cell) cell.classList.remove('cell-focused');
    });
  }
  setupCellEventListeners(wrapper, index) {
    const cell = wrapper.querySelector(".cell");
    if (!cell) return;
    const runBtn = cell.querySelector(".run-cell-btn");
    if (runBtn) {
      runBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        
        // Check if this cell is currently executing
        if (this.executingCells.has(index)) {
          // If executing, interrupt the kernel
          this.interruptKernel();
        } else {
          // If not executing, run the cell
          this.executeCell(index);
        }
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
    this.cleanupCellObserver(index);
  }
  executeCell(index) {
    const cell = document.querySelector(`.cell[data-cell-index="${index}"]`);
    const editor = this.editors.get(index);
    if (!editor) {
      console.error("No editor found for cell", index);
      return;
    }
    const cellData = this.cells[index];
    const cellType = cellData ? cellData.cell_type : "code";

    if (cellType === "markdown" || cellType === "text") {
      // For text/markdown cells, render the content instead of executing
      console.log("Rendering text/markdown cell:", index);
      this.renderMarkdownCell(index);
      return;
    }

    // else cellType == code
    const source = editor.getValue();
    
    // Clear old output before starting new execution
    this.clearCellOutput(index);
    
    if (cell) {
      cell.classList.add("executing");
    }
    
    // Track execution state and update button
    this.executingCells.add(index);
    this.updateRunButtonToStop(index);

    this.startExecutionTimer(index);

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
    this.stopExecutionTimer(cell_index);
    
    // Clear execution state and reset button
    this.executingCells.delete(cell_index);
    this.updateRunButtonToPlay(cell_index);

    const executionCountEl = cell.querySelector(".execution-count");
    if (result.execution_count && executionCountEl) {
      executionCountEl.textContent = `[${result.execution_count}]`;
    }
    const timeEl = cell.querySelector(".execution-time");
    if (timeEl && result.execution_time) {
      timeEl.textContent = result.execution_time;
      timeEl.style.display = "block";
    }

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
    }

    // Render regular outputs
    this.renderCellOutputs(cell, result.outputs);
    
    // If there's an error and it's not already displayed, add it as an error output
    if (result.error) {
      // Check if there's already an error output in the outputs array OR in the DOM
      const hasErrorOutput = result.outputs && result.outputs.some(output => output.output_type === "error");
      const outputContent = cell.querySelector(".output-content");
      const hasErrorInDOM = outputContent && outputContent.querySelector(".error-output-container");
      
      if (!hasErrorOutput && !hasErrorInDOM) {
        const outputContainer = cell.querySelector(".cell-output");
        if (outputContainer && outputContent) {
          outputContainer.style.display = "block";
          
          // Create error output
          const errorOutput = {
            output_type: "error",
            ename: result.error.ename || "Error",
            evalue: result.error.evalue || "Unknown error",
            traceback: result.error.traceback || [result.error.evalue || "Unknown error"]
          };
          
          const errorElement = this.createErrorOutput(errorOutput);
          outputContent.appendChild(errorElement);
        }
      }
    }
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
        return this.createErrorOutput(output);
      default:
        div.className = "output-stream";
        div.textContent = JSON.stringify(output);
    }
    return div;
  }
  
  createErrorOutput(output) {
    const container = document.createElement("div");
    container.className = "error-output-container";
    container.style.position = "relative";
    container.style.margin = "8px 0";
    
    // Create error content div
    const errorDiv = document.createElement("div");
    errorDiv.className = "output-error";
    
    // Get full traceback
    const fullTraceback = output.traceback.join("\n");
    const tracebackLines = output.traceback;
    
    // Limit to last 20 lines if traceback is longer
    let displayContent;
    let isLimited = false;
    if (tracebackLines.length > 20) {
      const limitedLines = tracebackLines.slice(-20);
      displayContent = limitedLines.join("\n");
      isLimited = true;
    } else {
      displayContent = fullTraceback;
    }
    
    errorDiv.textContent = displayContent;
    
    // Add truncation indicator if needed
    if (isLimited) {
      const truncatedIndicator = document.createElement("div");
      truncatedIndicator.style.cssText = `
        color: #6b7280;
        font-style: italic;
        font-size: 12px;
        margin-bottom: 8px;
        padding: 4px 8px;
        background: #f9fafb;
        border-radius: 4px;
        border-left: 3px solid #d1d5db;
      `;
      truncatedIndicator.textContent = `... (showing last 20 lines of ${tracebackLines.length} total lines - scroll up to see more)`;
      container.appendChild(truncatedIndicator);
    }
    
    // Create copy button
    const copyButton = this.createCopyButton(fullTraceback);
    
    container.appendChild(errorDiv);
    container.appendChild(copyButton);
    
    return container;
  }
  
  createCopyButton(textToCopy) {
    const copyButton = document.createElement("button");
    copyButton.className = "error-copy-btn";
    copyButton.title = "Copy error to clipboard";
    copyButton.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      border: none;
      background: rgba(255, 255, 255, 0.9);
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.7;
      transition: all 0.2s ease;
      z-index: 10;
    `;
    
    // Clone the copy icon from template
    const copyIconTemplate = document.getElementById("copy-icon-template");
    if (!copyIconTemplate) {
      console.error("Copy icon template not found! Creating fallback.");
      const copyIcon = document.createElement("div");
      copyIcon.textContent = "📋";
      copyIcon.style.fontSize = "14px";
      copyButton.appendChild(copyIcon);
      return copyButton;
    }
    const copyIcon = copyIconTemplate.cloneNode(true);
    copyIcon.removeAttribute("id");
    copyIcon.style.cssText = "width: 14px; height: 14px; opacity: 0.8;";
    
    copyButton.appendChild(copyIcon);
    
    // Add hover effects
    copyButton.addEventListener("mouseenter", () => {
      copyButton.style.opacity = "1";
      copyButton.style.background = "rgba(255, 255, 255, 1)";
      copyButton.style.transform = "scale(1.05)";
    });
    
    copyButton.addEventListener("mouseleave", () => {
      copyButton.style.opacity = "0.7";
      copyButton.style.background = "rgba(255, 255, 255, 0.9)";
      copyButton.style.transform = "scale(1)";
    });
    
    // Add copy functionality
    copyButton.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(textToCopy);
        this.showCopyFeedback(copyButton, copyIcon);
      } catch (err) {
        console.error('Failed to copy error:', err);
        this.fallbackCopy(textToCopy);
        this.showCopyFeedback(copyButton, copyIcon);
      }
    });
    
    return copyButton;
  }
  
  showCopyFeedback(button, icon) {
    const checkIconTemplate = document.getElementById("check-icon-template");
    const originalSrc = icon.src;
    
    icon.src = checkIconTemplate.src;
    button.style.background = "#dcfdf4";
    button.title = "Copied!";
    
    setTimeout(() => {
      icon.src = originalSrc;
      button.style.background = "rgba(255, 255, 255, 0.9)";
      button.title = "Copy error to clipboard";
    }, 1500);
  }
  
  fallbackCopy(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
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

    // Enhanced markdown rendering
    let htmlContent = this.renderMarkdown(source);

    // Wrap in paragraphs if not already wrapped
    if (!htmlContent.startsWith("<h") && !htmlContent.startsWith("<p")) {
      htmlContent = '<p style="margin: 8px 0;">' + htmlContent + "</p>";
    }

    div.innerHTML = htmlContent;
    outputContent.appendChild(div);
    outputContainer.style.display = "block";

    console.log("Text cell rendered for index:", index);
  }
  
  renderMarkdown(source) {
    let html = source;
    
    // Store existing HTML elements to preserve them
    const htmlElements = [];
    html = html.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, (match) => {
      const placeholder = `__HTML_${htmlElements.length}__`;
      htmlElements.push(match);
      return placeholder;
    });
    
    // Store self-closing HTML tags
    html = html.replace(/<[^>]+\/>/g, (match) => {
      const placeholder = `__HTML_${htmlElements.length}__`;
      htmlElements.push(match);
      return placeholder;
    });
    
    // Code blocks (must be processed first)
    html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
      return `<pre style="background: #f8f9fa; padding: 12px; border-radius: 6px; overflow-x: auto; margin: 12px 0; font-family: 'SF Mono', Monaco, monospace; font-size: 13px; border-left: 3px solid #3b82f6;">${this.escapeHtml(code.trim())}</pre>`;
    });
    
    // Language-specific code blocks
    html = html.replace(/```(\w+)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre style="background: #f8f9fa; padding: 12px; border-radius: 6px; overflow-x: auto; margin: 12px 0; font-family: 'SF Mono', Monaco, monospace; font-size: 13px; border-left: 3px solid #3b82f6;"><code class="language-${lang}">${this.escapeHtml(code.trim())}</code></pre>`;
    });
    
    // Images ![alt](src "title")
    html = html.replace(/!\[([^\]]*)\]\(([^\)]+)(?:\s+"([^"]+)")?\)/g, (match, alt, src, title) => {
      const titleAttr = title ? `title="${title}"` : '';
      return `<img src="${src}" alt="${alt}" ${titleAttr} style="max-width: 100%; height: auto; margin: 8px 0; border-radius: 4px;" />`;
    });
    
    // Links [text](url "title")
    html = html.replace(/\[([^\]]+)\]\(([^\)]+)(?:\s+"([^"]+)")?\)/g, (match, text, url, title) => {
      const titleAttr = title ? `title="${title}"` : '';
      const isInternal = url.startsWith('#');
      const target = isInternal ? '' : 'target="_blank" rel="noopener noreferrer"';
      return `<a href="${url}" ${titleAttr} ${target} style="color: #3b82f6; text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.2s;" onmouseover="this.style.borderBottomColor='#3b82f6'" onmouseout="this.style.borderBottomColor='transparent'">${text}</a>`;
    });
    
    // Headers (with anchor links)
    html = html.replace(/^### (.*$)/gm, (match, text) => {
      const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      return `<h3 id="${id}" style="font-size: 1.1em; font-weight: 600; margin: 16px 0 8px 0; color: #111827;">${text}</h3>`;
    });
    html = html.replace(/^## (.*$)/gm, (match, text) => {
      const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      return `<h2 id="${id}" style="font-size: 1.3em; font-weight: 600; margin: 16px 0 8px 0; color: #111827;">${text}</h2>`;
    });
    html = html.replace(/^# (.*$)/gm, (match, text) => {
      const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      return `<h1 id="${id}" style="font-size: 1.5em; font-weight: 600; margin: 16px 0 8px 0; color: #111827;">${text}</h1>`;
    });
    
    // Unordered lists
    html = html.replace(/^(\s*)[-*+] (.+)$/gm, (match, indent, text) => {
      const depth = Math.floor(indent.length / 2);
      return `<ul-item data-depth="${depth}">${text}</ul-item>`;
    });
    html = html.replace(/<ul-item data-depth="0">([\s\S]*?)<\/ul-item>/g, '<li style="margin: 4px 0;">$1</li>');
    html = html.replace(/(<li[^>]*>[\s\S]*?<\/li>\s*)+/g, '<ul style="margin: 8px 0; padding-left: 20px;">$&</ul>');
    
    // Ordered lists
    html = html.replace(/^(\s*)\d+\. (.+)$/gm, (match, indent, text) => {
      return `<ol-item>${text}</ol-item>`;
    });
    html = html.replace(/<ol-item>([\s\S]*?)<\/ol-item>/g, '<li style="margin: 4px 0;">$1</li>');
    html = html.replace(/(<li[^>]*>[\s\S]*?<\/li>\s*){2,}/g, '<ol style="margin: 8px 0; padding-left: 20px;">$&</ol>');
    
    // Bold and italic (after links to avoid conflicts)
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Inline code (after code blocks)
    html = html.replace(/`([^`]+)`/g, '<code style="background: #f3f4f6; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 0.9em;">$1</code>');
    
    // Strikethrough
    html = html.replace(/~~([^~]+)~~/g, '<del style="text-decoration: line-through; opacity: 0.7;">$1</del>');
    
    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />');
    
    // Blockquotes
    html = html.replace(/^> (.+)$/gm, '<blockquote style="border-left: 4px solid #e5e7eb; padding-left: 12px; margin: 12px 0; color: #6b7280; font-style: italic;">$1</blockquote>');
    
    // Line breaks and paragraphs
    html = html.replace(/\n\n+/g, '</p><p style="margin: 8px 0;">');
    html = html.replace(/\n/g, '<br>');
    
    // Wrap in paragraphs if not already wrapped
    if (!html.match(/^<(h[1-6]|ul|ol|pre|blockquote|hr)/)) {
      html = '<p style="margin: 8px 0;">' + html + '</p>';
    }
    
    // Restore HTML elements
    htmlElements.forEach((element, index) => {
      html = html.replace(`__HTML_${index}__`, element);
    });
    
    return html;
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
  
  interruptKernel() {
    console.log("Interrupting kernel execution...");
    this.socket.emit("interrupt_kernel", {});
  }
  showError(message) {
    console.error("Error:", message);
    // Removed alert popup - errors are now handled in-line in cells
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

  startExecutionTimer(cellIndex) {
    // Clear any existing timer for this cell
    this.stopExecutionTimer(cellIndex);

    const cell = document.querySelector(
      `.cell[data-cell-index="${cellIndex}"]`,
    );
    if (!cell) return;

    const startTime = Date.now();

    // Show timer in the status area (where check/X icon appears)
    const statusEl = cell.querySelector(".execution-status");
    const statusIcon = cell.querySelector(".status-icon");

    if (statusEl && statusIcon) {
      statusEl.style.display = "block";
      // Hide the icon and show timer text instead
      statusIcon.style.display = "none";

      // Create or get timer display element
      let timerDisplay = statusEl.querySelector(".timer-display");
      if (!timerDisplay) {
        timerDisplay = document.createElement("span");
        timerDisplay.className = "timer-display";
        timerDisplay.style.cssText = `
          font-size: 12px;
          color: #666;
          font-weight: 500;
          font-family: 'SF Mono', Monaco, monospace;
        `;
        statusEl.appendChild(timerDisplay);
      }

      // Update timer every 100ms
      const timerId = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        timerDisplay.textContent = `${elapsed.toFixed(1)}s`;
      }, 100);

      // Store the timer ID so we can clear it later
      this.executionTimers.set(cellIndex, {
        timerId: timerId,
        startTime: startTime,
        timerDisplay: timerDisplay,
        statusIcon: statusIcon,
      });
    }
  }

  stopExecutionTimer(cellIndex) {
    const timerData = this.executionTimers.get(cellIndex);
    if (timerData) {
      // Clear the interval
      clearInterval(timerData.timerId);

      // Remove timer display and show icon again
      if (timerData.timerDisplay) {
        timerData.timerDisplay.remove();
      }
      if (timerData.statusIcon) {
        timerData.statusIcon.style.display = "block";
      }

      // Remove from our tracking
      this.executionTimers.delete(cellIndex);
    }
  }
  
  setupContentAwareSizing(cell, index) {
    // Set up ResizeObserver to watch for content changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cell = entry.target;
        const cellHeight = entry.contentRect.height;
        
        // Apply smart sizing classes based on actual height
        this.updateCellClassBasedOnHeight(cell, cellHeight);
      }
    });
    
    // Observe the cell content area
    resizeObserver.observe(cell);
    
    // Store observer for cleanup
    this.cellResizeObservers.set(index, resizeObserver);
    
    // Initial sizing based on content
    const editor = this.editors.get(index);
    if (editor) {
      const source = editor.getValue();
      this.updateCellSizing(index, source);
    }
  }
  
  updateCellSizing(index, source) {
    const cell = document.querySelector(`.cell[data-cell-index="${index}"]`);
    if (!cell) return;
    
    // Remove all sizing classes first
    cell.classList.remove('cell-empty', 'cell-single-line', 'cell-multi-line');
    
    const lines = source.split('\n');
    const nonEmptyLines = lines.filter(line => line.trim().length > 0);
    
    if (nonEmptyLines.length === 0) {
      cell.classList.add('cell-empty');
    } else if (nonEmptyLines.length === 1) {
      cell.classList.add('cell-single-line');
    } else {
      cell.classList.add('cell-multi-line');
    }
  }
  
  updateCellClassBasedOnHeight(cell, height) {
    // Additional height-based adjustments if needed
    if (height < 40) {
      cell.classList.add('cell-compact');
    } else {
      cell.classList.remove('cell-compact');
    }
  }
  
  cleanupCellObserver(index) {
    // Clean up ResizeObserver when cell is deleted
    const observer = this.cellResizeObservers.get(index);
    if (observer) {
      observer.disconnect();
      this.cellResizeObservers.delete(index);
    }
  }
  
  // Button state management methods
  updateRunButtonToStop(cellIndex) {
    const cell = document.querySelector(`.cell[data-cell-index="${cellIndex}"]`);
    if (!cell) return;
    
    const runBtn = cell.querySelector(".run-cell-btn");
    const runImg = runBtn?.querySelector("img");
    
    if (runBtn && runImg) {
      runImg.src = "/assets/icons/stop.svg";
      runImg.alt = "Stop";
      runBtn.title = "Stop execution (Ctrl+C)";
      runBtn.classList.add("stop-mode");
    }
  }
  
  updateRunButtonToPlay(cellIndex) {
    const cell = document.querySelector(`.cell[data-cell-index="${cellIndex}"]`);
    if (!cell) return;
    
    const runBtn = cell.querySelector(".run-cell-btn");
    const runImg = runBtn?.querySelector("img");
    
    if (runBtn && runImg) {
      runImg.src = "/assets/icons/play.svg";
      runImg.alt = "Run";
      runBtn.title = "Run cell (Shift+Enter)";
      runBtn.classList.remove("stop-mode");
    }
  }
  
  clearCellOutput(cellIndex) {
    const cell = document.querySelector(`.cell[data-cell-index="${cellIndex}"]`);
    if (!cell) return;
    
    const outputContainer = cell.querySelector(".cell-output");
    const outputContent = cell.querySelector(".output-content");
    
    if (outputContainer && outputContent) {
      // Clear all output content
      outputContent.innerHTML = "";
      // Hide output container
      outputContainer.style.display = "none";
    }
  }
  
  // Streaming execution handlers
  handleExecutionStart(data) {
    console.log("Execution started:", data);
    
    // Validate data
    if (!data) {
      console.warn("Invalid execution start data:", data);
      return;
    }
    
    // Show execution start indicator if needed
    if (data.execution_count) {
      const cell = document.querySelector(`.cell.executing`);
      if (cell) {
        const statusEl = cell.querySelector(".execution-status");
        if (statusEl) {
          statusEl.classList.add("streaming");
        }
      }
    }
  }
  
  handleStreamOutput(data) {
    console.log("Stream output:", data);
    
    // Validate data
    if (!data || !data.stream || !data.text) {
      console.warn("Invalid stream output data:", data);
      return;
    }
    
    // Find the currently executing cell
    const cell = document.querySelector(`.cell.executing`);
    if (!cell) return;
    
    // Get or create output container
    const outputContainer = cell.querySelector(".cell-output");
    const outputContent = cell.querySelector(".output-content");
    if (!outputContainer || !outputContent) return;
    
    // Show output container
    outputContainer.style.display = "block";
    
    // Find or create stream output element
    let streamElement = outputContent.querySelector(`.output-stream.${data.stream}.streaming`);
    if (!streamElement) {
      streamElement = document.createElement("div");
      streamElement.className = `output-stream ${data.stream} streaming`;
      streamElement.style.whiteSpace = "pre-wrap";
      streamElement.style.fontFamily = "monospace";
      streamElement.style.fontSize = "13px";
      streamElement.style.lineHeight = "1.4";
      if (data.stream === "stderr") {
        streamElement.style.color = "#dc2626";
      }
      outputContent.appendChild(streamElement);
    }
    
    // Append the new text
    streamElement.textContent += data.text + '\n';
    
    // Auto-scroll to bottom of output
    outputContainer.scrollTop = outputContainer.scrollHeight;
  }
  
  handleExecuteResult(data) {
    console.log("Execute result:", data);
    // Find the currently executing cell
    const cell = document.querySelector(`.cell.executing`);
    if (!cell) return;
    
    // Get or create output container
    const outputContainer = cell.querySelector(".cell-output");
    const outputContent = cell.querySelector(".output-content");
    if (!outputContainer || !outputContent) return;
    
    // Show output container
    outputContainer.style.display = "block";
    
    // Create result element
    const resultElement = document.createElement("div");
    resultElement.className = "output-result";
    resultElement.textContent = data.data["text/plain"] || "";
    resultElement.style.fontFamily = "monospace";
    resultElement.style.fontSize = "13px";
    resultElement.style.marginTop = "8px";
    resultElement.style.padding = "4px 0";
    resultElement.style.borderTop = "1px solid #e5e7eb";
    
    outputContent.appendChild(resultElement);
    
    // Auto-scroll to bottom
    outputContainer.scrollTop = outputContainer.scrollHeight;
  }
  
  handleExecutionComplete(data) {
    console.log("Execution completed:", data);
    // Find the currently executing cell
    const cell = document.querySelector(`.cell.executing`);
    if (!cell) return;
    
    // Remove executing class
    cell.classList.remove("executing");
    
    // Stop execution timer
    const cellIndex = parseInt(cell.getAttribute("data-cell-index"));
    this.stopExecutionTimer(cellIndex);
    
    // Clear execution state and reset button
    this.executingCells.delete(cellIndex);
    this.updateRunButtonToPlay(cellIndex);
    
    // Update execution count
    if (data.execution_count) {
      const executionCountEl = cell.querySelector(".execution-count");
      if (executionCountEl) {
        executionCountEl.textContent = `[${data.execution_count}]`;
      }
    }
    
    // Update execution time
    if (data.execution_time) {
      const timeEl = cell.querySelector(".execution-time");
      if (timeEl) {
        timeEl.textContent = data.execution_time;
        timeEl.style.display = "block";
      }
    }
    
    // Update status
    const statusEl = cell.querySelector(".execution-status");
    const statusIcon = cell.querySelector(".status-icon");
    if (statusEl && statusIcon) {
      statusEl.classList.remove("streaming");
      if (data.status === "ok") {
        statusIcon.src = "/assets/icons/check.svg";
        statusIcon.alt = "Success";
      } else {
        statusIcon.src = "/assets/icons/x.svg";
        statusIcon.alt = "Error";
      }
      statusEl.style.display = "block";
    }
    
    // Remove streaming class from all stream elements
    const streamElements = cell.querySelectorAll(".output-stream.streaming");
    streamElements.forEach(el => el.classList.remove("streaming"));
  }
  
  handleStreamError(data) {
    console.error("Stream error:", data);
    // Find the currently executing cell
    const cell = document.querySelector(`.cell.executing`);
    if (!cell) return;
    
    // Clean up execution state on error
    const cellIndex = parseInt(cell.getAttribute("data-cell-index"));
    if (!isNaN(cellIndex)) {
      this.executingCells.delete(cellIndex);
      this.updateRunButtonToPlay(cellIndex);
      cell.classList.remove("executing");
      this.stopExecutionTimer(cellIndex);
    }
    
    // Get or create output container
    const outputContainer = cell.querySelector(".cell-output");
    const outputContent = cell.querySelector(".output-content");
    if (!outputContainer || !outputContent) return;
    
    // Show output container
    outputContainer.style.display = "block";
    
    // Create error element
    const errorElement = document.createElement("div");
    errorElement.className = "output-error";
    errorElement.textContent = `Stream ${data.stream} error: ${data.error}`;
    errorElement.style.color = "#dc2626";
    errorElement.style.fontFamily = "monospace";
    errorElement.style.fontSize = "13px";
    errorElement.style.marginTop = "8px";
    errorElement.style.padding = "8px";
    errorElement.style.backgroundColor = "#fef2f2";
    errorElement.style.border = "1px solid #fecaca";
    errorElement.style.borderRadius = "4px";
    
    outputContent.appendChild(errorElement);
    
    // Auto-scroll to bottom
    outputContainer.scrollTop = outputContainer.scrollHeight;
  }
  
  handleExecutionInterrupted(data) {
    console.log("Execution interrupted:", data);
    
    // Find all currently executing cells and clean them up
    const executingCells = Array.from(this.executingCells);
    
    executingCells.forEach(cellIndex => {
      const cell = document.querySelector(`.cell[data-cell-index="${cellIndex}"]`);
      if (cell) {
        // Remove executing class
        cell.classList.remove("executing");
        
        // Stop execution timer
        this.stopExecutionTimer(cellIndex);
        
        // Clear execution state and reset button
        this.executingCells.delete(cellIndex);
        this.updateRunButtonToPlay(cellIndex);
        
        // Add interrupted message to output
        const outputContainer = cell.querySelector(".cell-output");
        const outputContent = cell.querySelector(".output-content");
        if (outputContainer && outputContent) {
          outputContainer.style.display = "block";
          
          // Create a fake error output for the interrupt message
          const interruptOutput = {
            output_type: "error",
            ename: "KeyboardInterrupt", 
            evalue: "Execution interrupted by user",
            traceback: [
              "KeyboardInterrupt: Execution interrupted by user",
              "\nThe kernel was interrupted during execution."
            ]
          };
          
          const interruptElement = this.createErrorOutput(interruptOutput);
          outputContent.appendChild(interruptElement);
        }
      }
    });
    
    // Clear all executing cells
    this.executingCells.clear();
  }
}
document.addEventListener("DOMContentLoaded", () => {
  window.notebookApp = new NotebookApp();
});
