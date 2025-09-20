// MoreCompute Notebook Frontend - Marimo Style
class NotebookApp {
    constructor() {
        this.socket = io();
        this.cells = [];
        this.currentCellIndex = null;
        this.editors = new Map(); // Store CodeMirror instances
        this.sortable = null; // For drag and drop
        
        this.initializeEventListeners();
        this.initializeSocketListeners();
    }

    initializeEventListeners() {
        // Global keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.shiftKey && e.key === 'Enter') {
                e.preventDefault();
                this.executeCurrentCell();
            }
            
            // Ctrl+S to save
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.saveNotebook();
            }
            
            // Escape to clear focus
            if (e.key === 'Escape') {
                this.clearActiveCells();
            }
        });
        
        // Initialize sortable for drag and drop
        this.initializeSortable();
    }

    initializeSocketListeners() {
        this.socket.on('connect', () => {
            document.getElementById('connection-status').textContent = '🔌 Connected';
            console.log('Connected to server');
        });

        this.socket.on('disconnect', () => {
            document.getElementById('connection-status').textContent = '🔌 Disconnected';
            console.log('Disconnected from server');
        });

        this.socket.on('notebook_data', (data) => {
            this.loadNotebook(data);
        });

        this.socket.on('execution_result', (data) => {
            this.handleExecutionResult(data);
        });

        this.socket.on('execution_error', (data) => {
            console.error('Execution error:', data.error);
            this.showError(data.error);
        });

        this.socket.on('notebook_updated', (data) => {
            this.loadNotebook(data);
        });

        this.socket.on('kernel_reset', () => {
            this.clearAllOutputs();
            document.getElementById('kernel-status').textContent = '🧠 Reset';
        });

        this.socket.on('save_success', (data) => {
            console.log('Notebook saved successfully:', data.file_path);
            this.showSaveSuccess(data.file_path);
        });

        this.socket.on('save_error', (data) => {
            console.error('Save error:', data.error);
            this.showError('Save failed: ' + data.error);
        });
    }

    loadNotebook(data) {
        this.cells = data.cells || [];
        this.renderNotebook();
    }

    renderNotebook() {
        const notebook = document.getElementById('notebook');
        const emptyState = document.getElementById('empty-state');
        
        // Clear existing cells
        const existingCells = notebook.querySelectorAll('.cell-wrapper');
        existingCells.forEach(cell => cell.remove());

        if (this.cells.length === 0) {
            // Show empty state
            emptyState.style.display = 'flex';
            this.setupAddCellListeners(emptyState.querySelector('.add-cell-line'));
        } else {
            // Hide empty state and render cells
            emptyState.style.display = 'none';
            this.cells.forEach((cellData, index) => {
                this.renderCell(cellData, index);
            });
            
            // Re-initialize sortable after rendering
            this.initializeSortable();
        }
    }

    renderCell(cellData, index) {
        const template = document.getElementById('cell-template');
        const cellWrapper = template.content.cloneNode(true);
        
        const cell = cellWrapper.querySelector('.cell');
        const wrapper = cellWrapper.querySelector('.cell-wrapper');
        
        // Set data attributes
        cell.setAttribute('data-cell-index', index);
        wrapper.setAttribute('data-cell-index', index);
        
        // Set execution count
        const executionCount = cell.querySelector('.execution-count');
        if (cellData.execution_count) {
            executionCount.textContent = `[${cellData.execution_count}]`;
        } else {
            executionCount.textContent = '[ ]';
        }

        // Setup editor
        const editor = cell.querySelector('.cell-editor');
        editor.value = cellData.source || '';

        // Setup event listeners for the wrapper
        this.setupCellEventListeners(wrapper, index);
        
        // Setup add cell lines
        const addLineAbove = wrapper.querySelector('.add-line-above');
        const addLineBelow = wrapper.querySelector('.add-line-below');
        this.setupAddCellListeners(addLineAbove, index);
        this.setupAddCellListeners(addLineBelow, index + 1);

        // Append to notebook
        document.getElementById('notebook').appendChild(wrapper);

        // Initialize CodeMirror
        this.initializeCodeMirror(cell, index, cellData.cell_type || 'code');

        // Render outputs if any
        if (cellData.outputs && cellData.outputs.length > 0) {
            this.renderCellOutputs(cell, cellData.outputs);
        }
    }
    
    initializeSortable() {
        const notebook = document.getElementById('notebook');
        if (this.sortable) {
            this.sortable.destroy();
        }
        
        this.sortable = Sortable.create(notebook, {
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            filter: '.empty-state, .add-cell-line',
            onEnd: (evt) => {
                const oldIndex = evt.oldIndex;
                const newIndex = evt.newIndex;
                if (oldIndex !== newIndex) {
                    this.reorderCells(oldIndex, newIndex);
                }
            }
        });
    }
    
    setupAddCellListeners(addLine, insertIndex) {
        if (!addLine) return;
        
        const addButton = addLine.querySelector('.add-cell-button');
        const menu = addLine.querySelector('.cell-type-menu');
        
        // Handle add button click
        addButton?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showCellTypeMenu(menu);
        });
        
        // Handle cell type selection
        const codeOption = menu?.querySelector('[data-type="code"]');
        const markdownOption = menu?.querySelector('[data-type="markdown"]');
        
        codeOption?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.addCell('code', insertIndex);
            this.hideCellTypeMenu(menu);
        });
        
        markdownOption?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.addCell('markdown', insertIndex);
            this.hideCellTypeMenu(menu);
        });
    }
    
    showCellTypeMenu(menu) {
        if (menu) {
            menu.style.display = 'block';
        }
    }
    
    hideCellTypeMenu(menu) {
        if (menu) {
            menu.style.display = 'none';
        }
    }
    
    clearActiveCells() {
        document.querySelectorAll('.cell.active').forEach(cell => {
            cell.classList.remove('active');
        });
        this.currentCellIndex = null;
    }
    
    reorderCells(oldIndex, newIndex) {
        // This would emit a reorder event to the server
        // For now, we'll just update locally
        const cell = this.cells.splice(oldIndex, 1)[0];
        this.cells.splice(newIndex, 0, cell);
        
        // Update cell indices
        this.updateCellIndices();
    }
    
    updateCellIndices() {
        const wrappers = document.querySelectorAll('.cell-wrapper');
        wrappers.forEach((wrapper, index) => {
            const cell = wrapper.querySelector('.cell');
            cell.setAttribute('data-cell-index', index);
            wrapper.setAttribute('data-cell-index', index);
        });
    }
    
    focusNextCell(currentIndex) {
        const nextIndex = currentIndex + 1;
        if (nextIndex < this.cells.length) {
            this.setActiveCell(nextIndex);
        } else {
            // Create a new cell if we're at the end
            this.addCell('markdown', nextIndex);
        }
    }

    initializeCodeMirror(cell, index, cellType) {
        const textarea = cell.querySelector('.cell-editor');
        
        const mode = cellType === 'code' ? 'python' : 'text/plain';
        
        const editor = CodeMirror.fromTextArea(textarea, {
            mode: mode,
            lineNumbers: false,
            theme: 'default',
            autoCloseBrackets: cellType === 'code',
            matchBrackets: cellType === 'code',
            indentUnit: 4,
            lineWrapping: true,
            placeholder: cellType === 'code' ? 'Enter your code here...' : 'Enter markdown text here...',
            extraKeys: {
                'Shift-Enter': () => {
                    if (cellType === 'code') {
                        this.executeCell(index);
                    } else {
                        // For markdown, just add a new line or focus next cell
                        this.focusNextCell(index);
                    }
                },
                'Ctrl-Enter': () => {
                    this.executeCell(index);
                },
                'Tab': cellType === 'code' ? 'indentMore' : false,
                'Shift-Tab': cellType === 'code' ? 'indentLess' : false
            }
        });

        // Store editor reference
        this.editors.set(index, editor);

        // Update cell content on change
        editor.on('change', () => {
            const source = editor.getValue();
            this.updateCellSource(index, source);
        });

        // Focus handling
        editor.on('focus', () => {
            this.setActiveCell(index);
        });
    }

    setupCellEventListeners(wrapper, index) {
        const cell = wrapper.querySelector('.cell');
        
        // Run button
        const runBtn = cell.querySelector('.run-cell-btn');
        runBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.executeCell(index);
        });

        // Delete button
        const deleteBtn = cell.querySelector('.delete-cell-btn');
        deleteBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteCell(index);
        });

        // Cell click to focus
        cell.addEventListener('click', () => {
            this.setActiveCell(index);
        });
        
        // Drag handle - no additional listeners needed (handled by Sortable)
        const dragHandle = cell.querySelector('.drag-handle');
        dragHandle?.addEventListener('mousedown', (e) => {
            // Sortable will handle the dragging
        });
    }

    addCell(cellType = 'code', index = -1) {
        // If index is provided, use it; otherwise append at the end
        const insertIndex = index !== undefined && index >= 0 ? index : this.cells.length;
        
        this.socket.emit('add_cell', {
            index: insertIndex,
            cell_type: cellType,
            source: ''
        });
    }

    deleteCell(index) {
        if (this.cells.length <= 1) {
            // Don't delete the last cell
            return;
        }
        
        this.socket.emit('delete_cell', {
            cell_index: index
        });

        // Remove editor reference
        this.editors.delete(index);
    }

    executeCell(index) {
        const cell = document.querySelector(`.cell[data-cell-index="${index}"]`);
        const editor = this.editors.get(index);
        
        if (!editor) {
            console.error('No editor found for cell', index);
            return;
        }

        const source = editor.getValue();
        
        // Mark cell as executing
        cell.classList.add('executing');
        
        // Hide previous execution time
        const timeEl = cell.querySelector('.execution-time');
        if (timeEl) {
            timeEl.style.display = 'none';
        }
        
        this.socket.emit('execute_cell', {
            cell_index: index,
            source: source
        });
    }

    executeCurrentCell() {
        if (this.currentCellIndex !== null) {
            this.executeCell(this.currentCellIndex);
        }
    }

    updateCellSource(index, source) {
        this.socket.emit('update_cell', {
            cell_index: index,
            source: source
        });
    }

    changeCellType(index, newType) {
        const editor = this.editors.get(index);
        if (editor) {
            // Update CodeMirror mode
            const mode = newType === 'code' ? 'python' : 'text/plain';
            editor.setOption('mode', mode);
        }
        
        // Update cell data
        if (this.cells[index]) {
            this.cells[index].cell_type = newType;
        }
    }

    setActiveCell(index) {
        // Remove active class from all cells
        document.querySelectorAll('.cell').forEach(cell => {
            cell.classList.remove('active');
        });

        // Add active class to current cell
        const cell = document.querySelector(`.cell[data-cell-index="${index}"]`);
        if (cell) {
            cell.classList.add('active');
            
            // Focus the CodeMirror editor
            const editor = this.editors.get(index);
            if (editor) {
                setTimeout(() => editor.focus(), 100);
            }
        }

        this.currentCellIndex = index;
    }

    handleExecutionResult(data) {
        const { cell_index, result } = data;
        const cell = document.querySelector(`.cell[data-cell-index="${cell_index}"]`);
        
        if (!cell) return;

        // Remove executing state
        cell.classList.remove('executing');

        // Update execution count
        if (result.execution_count) {
            cell.querySelector('.execution-count').textContent = `[${result.execution_count}]`;
        }
        
        // Update execution time (if provided)
        const timeEl = cell.querySelector('.execution-time');
        if (timeEl && result.execution_time) {
            timeEl.textContent = result.execution_time;
            timeEl.style.display = 'block';
        }

        // Render outputs
        this.renderCellOutputs(cell, result.outputs);
    }

    renderCellOutputs(cell, outputs) {
        const outputContainer = cell.querySelector('.cell-output');
        const outputContent = cell.querySelector('.output-content');
        
        if (!outputs || outputs.length === 0) {
            outputContainer.style.display = 'none';
            return;
        }

        outputContent.innerHTML = '';
        outputContainer.style.display = 'block';

        outputs.forEach(output => {
            const outputElement = this.createOutputElement(output);
            outputContent.appendChild(outputElement);
        });
    }

    createOutputElement(output) {
        const div = document.createElement('div');
        
        switch (output.output_type) {
            case 'stream':
                div.className = `output-stream ${output.name}`;
                div.textContent = output.text;
                break;
            
            case 'execute_result':
                div.className = 'output-result';
                div.textContent = output.data['text/plain'] || '';
                break;
            
            case 'error':
                div.className = 'output-error';
                div.textContent = output.traceback.join('\n');
                break;
            
            default:
                div.className = 'output-stream';
                div.textContent = JSON.stringify(output);
        }
        
        return div;
    }

    clearAllOutputs() {
        document.querySelectorAll('.cell-output').forEach(output => {
            output.style.display = 'none';
            output.querySelector('.output-content').innerHTML = '';
        });

        document.querySelectorAll('.execution-count').forEach(count => {
            count.textContent = '[ ]';
        });
    }

    saveNotebook() {
        // For now, just emit a save event
        // In a full implementation, this would show a file dialog
        this.socket.emit('save_notebook', {
            file_path: 'notebook.py'
        });
    }

    resetKernel() {
        if (confirm('Are you sure you want to reset the kernel? This will clear all variables and outputs.')) {
            this.socket.emit('reset_kernel');
        }
    }

    showError(message) {
        // Simple error display - could be enhanced with a proper toast/notification system
        console.error('Error:', message);
        alert('Error: ' + message);
    }
    
    showSaveSuccess(filePath) {
        // Show temporary feedback
        const saveBtn = document.getElementById('save-btn');
        const originalText = saveBtn.textContent;
        saveBtn.textContent = '✅ Saved';
        setTimeout(() => {
            saveBtn.textContent = originalText;
        }, 2000);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.notebookApp = new NotebookApp();
});
