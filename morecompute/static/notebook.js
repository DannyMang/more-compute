// MoreCompute Notebook Frontend
class NotebookApp {
    constructor() {
        this.socket = io();
        this.cells = [];
        this.currentCellIndex = null;
        this.editors = new Map(); // Store CodeMirror instances
        
        this.initializeEventListeners();
        this.initializeSocketListeners();
    }

    initializeEventListeners() {
        // Header controls
        document.getElementById('add-cell-btn').addEventListener('click', () => {
            this.addCell('code');
        });
        
        document.getElementById('add-text-cell-btn').addEventListener('click', () => {
            this.addCell('markdown');
        });
        
        document.getElementById('save-btn').addEventListener('click', () => {
            this.saveNotebook();
        });
        
        document.getElementById('reset-kernel-btn').addEventListener('click', () => {
            this.resetKernel();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.shiftKey && e.key === 'Enter') {
                e.preventDefault();
                this.executeCurrentCell();
            }
        });
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
        notebook.innerHTML = '';

        if (this.cells.length === 0) {
            this.addCell('code');
            return;
        }

        this.cells.forEach((cellData, index) => {
            this.renderCell(cellData, index);
        });
    }

    renderCell(cellData, index) {
        const template = document.getElementById('cell-template');
        const cellElement = template.content.cloneNode(true);
        
        const cell = cellElement.querySelector('.cell');
        cell.setAttribute('data-cell-index', index);
        
        // Set cell type
        const typeSelector = cell.querySelector('.cell-type-dropdown');
        typeSelector.value = cellData.cell_type || 'code';
        
        // Set execution count
        if (cellData.execution_count) {
            cell.querySelector('.execution-count').textContent = `[${cellData.execution_count}]`;
        }

        // Setup editor
        const editor = cell.querySelector('.cell-editor');
        editor.value = cellData.source || '';

        // Add event listeners
        this.setupCellEventListeners(cell, index);

        // Append to notebook
        document.getElementById('notebook').appendChild(cell);

        // Initialize CodeMirror
        this.initializeCodeMirror(cell, index, cellData.cell_type || 'code');

        // Render outputs if any
        if (cellData.outputs && cellData.outputs.length > 0) {
            this.renderCellOutputs(cell, cellData.outputs);
        }
    }

    initializeCodeMirror(cell, index, cellType) {
        const textarea = cell.querySelector('.cell-editor');
        
        const mode = cellType === 'code' ? 'python' : 'text/plain';
        
        const editor = CodeMirror.fromTextArea(textarea, {
            mode: mode,
            lineNumbers: false,
            theme: 'default',
            autoCloseBrackets: true,
            matchBrackets: true,
            indentUnit: 4,
            lineWrapping: true,
            extraKeys: {
                'Shift-Enter': () => {
                    this.executeCell(index);
                },
                'Ctrl-Enter': () => {
                    this.executeCell(index);
                },
                'Tab': 'indentMore',
                'Shift-Tab': 'indentLess'
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

    setupCellEventListeners(cell, index) {
        // Run button
        cell.querySelector('.run-cell-btn').addEventListener('click', () => {
            this.executeCell(index);
        });

        // Delete button
        cell.querySelector('.delete-cell-btn').addEventListener('click', () => {
            this.deleteCell(index);
        });

        // Cell type change
        cell.querySelector('.cell-type-dropdown').addEventListener('change', (e) => {
            const newType = e.target.value;
            this.changeCellType(index, newType);
        });

        // Cell click to focus
        cell.addEventListener('click', () => {
            this.setActiveCell(index);
        });
    }

    addCell(cellType = 'code', index = -1) {
        this.socket.emit('add_cell', {
            index: index,
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
        const cell = document.querySelector(`[data-cell-index="${index}"]`);
        const editor = this.editors.get(index);
        
        if (!editor) {
            console.error('No editor found for cell', index);
            return;
        }

        const source = editor.getValue();
        
        // Mark cell as executing
        cell.classList.add('executing');
        
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
        const cell = document.querySelector(`[data-cell-index="${index}"]`);
        if (cell) {
            cell.classList.add('active');
        }

        this.currentCellIndex = index;
    }

    handleExecutionResult(data) {
        const { cell_index, result } = data;
        const cell = document.querySelector(`[data-cell-index="${cell_index}"]`);
        
        if (!cell) return;

        // Remove executing state
        cell.classList.remove('executing');

        // Update execution count
        if (result.execution_count) {
            cell.querySelector('.execution-count').textContent = `[${result.execution_count}]`;
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
