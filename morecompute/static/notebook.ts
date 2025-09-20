interface CellData {
    cell_type: string;
    source: string;
    execution_count?: number;
    outputs?: any[];
    metadata?: any;
}

interface NotebookData {
    cells: CellData[];
    metadata?: any;
    file_path?: string;
}

interface ExecutionResult {
    execution_count: number;
    outputs: any[];
    status: string;
    error?: any;
    execution_time?: string;
}

declare var io: any;
declare var CodeMirror: any;
declare var Sortable: any;

console.log('notebook.js loading...');

class NotebookApp {
    private socket: any;
    private cells: CellData[] = [];
    private currentCellIndex: number | null = null;
    private editors = new Map<number, any>();
    private sortable: any = null;

    constructor() {
        console.log('NotebookApp constructor called!');
        this.socket = io();
        this.initializeEventListeners();
        this.initializeSocketListeners();
        console.log('NotebookApp fully initialized!');
    }

    private initializeEventListeners(): void {
        document.addEventListener('keydown', (e) => {
            if (e.shiftKey && e.key === 'Enter') {
                e.preventDefault();
                this.executeCurrentCell();
            }
            
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.saveNotebook();
            }
            
            if (e.key === 'Escape') {
                this.clearActiveCells();
            }
        });
        
        this.initializeSortable();
    }

    private initializeSocketListeners(): void {
        this.socket.on('connect', () => {
            const statusEl = document.getElementById('connection-status');
            if (statusEl) statusEl.textContent = '🔌 Connected';
        });

        this.socket.on('disconnect', () => {
            const statusEl = document.getElementById('connection-status');
            if (statusEl) statusEl.textContent = '🔌 Disconnected';
        });

        this.socket.on('notebook_data', (data: NotebookData) => {
            this.loadNotebook(data);
        });

        this.socket.on('execution_result', (data: any) => {
            this.handleExecutionResult(data);
        });

        this.socket.on('execution_error', (data: any) => {
            console.error('Execution error:', data.error);
            this.showError(data.error);
        });

        this.socket.on('notebook_updated', (data: NotebookData) => {
            this.loadNotebook(data);
        });

        this.socket.on('kernel_reset', () => {
            this.clearAllOutputs();
            const statusEl = document.getElementById('kernel-status');
            if (statusEl) statusEl.textContent = '🧠 Reset';
        });

        this.socket.on('save_success', (data: any) => {
            this.showSaveSuccess(data.file_path);
        });

        this.socket.on('save_error', (data: any) => {
            console.error('Save error:', data.error);
            this.showError('Save failed: ' + data.error);
        });
    }

    private loadNotebook(data: NotebookData): void {
        this.cells = data.cells || [];
        this.renderNotebook();
    }

    private renderNotebook(): void {
        const notebook = document.getElementById('notebook');
        const emptyState = document.getElementById('empty-state');
        
        if (!notebook || !emptyState) return;

        const existingCells = notebook.querySelectorAll('.cell-wrapper');
        existingCells.forEach(cell => cell.remove());

        if (this.cells.length === 0) {
            emptyState.style.display = 'flex';
            this.setupAddCellListeners(emptyState.querySelector('.add-cell-line'), 0);
        } else {
            emptyState.style.display = 'none';
            this.cells.forEach((cellData, index) => {
                this.renderCell(cellData, index);
            });
            
            this.initializeSortable();
        }
    }

    private renderCell(cellData: CellData, index: number): void {
        const template = document.getElementById('cell-template') as HTMLTemplateElement;
        if (!template) return;

        const cellWrapper = template.content.cloneNode(true) as DocumentFragment;
        
        const cell = cellWrapper.querySelector('.cell') as HTMLElement;
        const wrapper = cellWrapper.querySelector('.cell-wrapper') as HTMLElement;
        
        if (!cell || !wrapper) return;

        cell.setAttribute('data-cell-index', index.toString());
        wrapper.setAttribute('data-cell-index', index.toString());

        const executionCount = cell.querySelector('.execution-count') as HTMLElement;
        if (executionCount) {
            if (cellData.execution_count) {
                executionCount.textContent = `[${cellData.execution_count}]`;
            } else {
                executionCount.textContent = '[ ]';
            }
        }

        const editor = cell.querySelector('.cell-editor') as HTMLTextAreaElement;
        if (editor) {
            editor.value = cellData.source || '';
        }

        this.setupCellEventListeners(wrapper, index);
        
        const addLineAbove = wrapper.querySelector('.add-line-above') as HTMLElement;
        const addLineBelow = wrapper.querySelector('.add-line-below') as HTMLElement;
        this.setupAddCellListeners(addLineAbove, index);
        this.setupAddCellListeners(addLineBelow, index + 1);

        const notebook = document.getElementById('notebook');
        if (notebook) {
            notebook.appendChild(wrapper);
        }

        this.initializeCodeMirror(cell, index, cellData.cell_type || 'code');

        if (cellData.outputs && cellData.outputs.length > 0) {
            this.renderCellOutputs(cell, cellData.outputs);
        }
    }

    private initializeSortable(): void {
        const notebook = document.getElementById('notebook');
        if (!notebook) return;

        if (this.sortable) {
            this.sortable.destroy();
        }
        
        this.sortable = Sortable.create(notebook, {
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            filter: '.empty-state, .add-cell-line',
            onEnd: (evt: any) => {
                const oldIndex = evt.oldIndex;
                const newIndex = evt.newIndex;
                if (oldIndex !== newIndex) {
                    this.reorderCells(oldIndex, newIndex);
                }
            }
        });
    }
    
    private setupAddCellListeners(addLine: HTMLElement | null, insertIndex: number): void {
        if (!addLine) {
            console.log('No addLine found');
            return;
        }
        
        const addButton = addLine.querySelector('.add-cell-button') as HTMLElement;
        const menu = addLine.querySelector('.cell-type-menu') as HTMLElement;
        
        console.log('Setting up add cell listeners for index:', insertIndex);
        console.log('Add button:', addButton);
        console.log('Menu:', menu);
        
        if (addButton) {
            addButton.addEventListener('click', (e) => {
                console.log('Add button clicked!');
                e.preventDefault();
                e.stopPropagation();
                this.showCellTypeMenu(menu);
            });
        }
        
        const codeOption = menu?.querySelector('[data-type="code"]') as HTMLElement;
        const markdownOption = menu?.querySelector('[data-type="markdown"]') as HTMLElement;
        
        console.log('Code option:', codeOption);
        console.log('Markdown option:', markdownOption);
        
        if (codeOption) {
            codeOption.addEventListener('click', (e) => {
                console.log('Code option clicked! Adding code cell at index:', insertIndex);
                e.preventDefault();
                e.stopPropagation();
                this.addCell('code', insertIndex);
                this.hideCellTypeMenu(menu);
            });
        }
        
        if (markdownOption) {
            markdownOption.addEventListener('click', (e) => {
                console.log('Markdown option clicked! Adding markdown cell at index:', insertIndex);
                e.preventDefault();
                e.stopPropagation();
                this.addCell('markdown', insertIndex);
                this.hideCellTypeMenu(menu);
            });
        }
    }
    
    private showCellTypeMenu(menu: HTMLElement | null): void {
        if (menu) {
            menu.style.display = 'block';
        }
    }
    
    private hideCellTypeMenu(menu: HTMLElement | null): void {
        if (menu) {
            menu.style.display = 'none';
        }
    }
    
    private clearActiveCells(): void {
        document.querySelectorAll('.cell.active').forEach(cell => {
            cell.classList.remove('active');
        });
        this.currentCellIndex = null;
    }
    
    private reorderCells(oldIndex: number, newIndex: number): void {
        const cell = this.cells.splice(oldIndex, 1)[0];
        this.cells.splice(newIndex, 0, cell);
        this.updateCellIndices();
    }
    
    private updateCellIndices(): void {
        const wrappers = document.querySelectorAll('.cell-wrapper');
        wrappers.forEach((wrapper, index) => {
            const cell = wrapper.querySelector('.cell') as HTMLElement;
            if (cell) {
                cell.setAttribute('data-cell-index', index.toString());
                (wrapper as HTMLElement).setAttribute('data-cell-index', index.toString());
            }
        });
    }
    
    private focusNextCell(currentIndex: number): void {
        const nextIndex = currentIndex + 1;
        if (nextIndex < this.cells.length) {
            this.setActiveCell(nextIndex);
        } else {
            this.addCell('markdown', nextIndex);
        }
    }

    private initializeCodeMirror(cell: HTMLElement, index: number, cellType: string): void {
        const textarea = cell.querySelector('.cell-editor') as HTMLTextAreaElement;
        if (!textarea) return;
        
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

        this.editors.set(index, editor);

        editor.on('change', () => {
            const source = editor.getValue();
            this.updateCellSource(index, source);
        });

        editor.on('focus', () => {
            this.setActiveCell(index);
        });
    }

    private setupCellEventListeners(wrapper: HTMLElement, index: number): void {
        const cell = wrapper.querySelector('.cell') as HTMLElement;
        if (!cell) return;
        
        const runBtn = cell.querySelector('.run-cell-btn') as HTMLElement;
        if (runBtn) {
            runBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.executeCell(index);
            });
        }

        const deleteBtn = cell.querySelector('.delete-cell-btn') as HTMLElement;
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteCell(index);
            });
        }

        cell.addEventListener('click', () => {
            this.setActiveCell(index);
        });
        
        const dragHandle = cell.querySelector('.drag-handle') as HTMLElement;
        if (dragHandle) {
            dragHandle.addEventListener('mousedown', (e) => {
                // Sortable handles the dragging
            });
        }
    }

    private addCell(cellType: string = 'code', index: number = -1): void {
        const insertIndex = index !== undefined && index >= 0 ? index : this.cells.length;
        
        console.log('addCell called with:', { cellType, index, insertIndex });
        
        this.socket.emit('add_cell', {
            index: insertIndex,
            cell_type: cellType,
            source: ''
        });
        
        console.log('Emitted add_cell event');
    }

    private deleteCell(index: number): void {
        if (this.cells.length <= 1) {
            return;
        }
        
        this.socket.emit('delete_cell', {
            cell_index: index
        });

        this.editors.delete(index);
    }

    private executeCell(index: number): void {
        const cell = document.querySelector(`.cell[data-cell-index="${index}"]`) as HTMLElement;
        const editor = this.editors.get(index);
        
        if (!editor) {
            console.error('No editor found for cell', index);
            return;
        }

        const source = editor.getValue();
        
        if (cell) {
            cell.classList.add('executing');
        }
        
        const timeEl = cell?.querySelector('.execution-time') as HTMLElement;
        if (timeEl) {
            timeEl.style.display = 'none';
        }
        
        this.socket.emit('execute_cell', {
            cell_index: index,
            source: source
        });
    }

    private executeCurrentCell(): void {
        if (this.currentCellIndex !== null) {
            this.executeCell(this.currentCellIndex);
        }
    }

    private updateCellSource(index: number, source: string): void {
        this.socket.emit('update_cell', {
            cell_index: index,
            source: source
        });
    }

    private changeCellType(index: number, newType: string): void {
        const editor = this.editors.get(index);
        if (editor) {
            const mode = newType === 'code' ? 'python' : 'text/plain';
            editor.setOption('mode', mode);
        }
        
        if (this.cells[index]) {
            this.cells[index].cell_type = newType;
        }
    }

    private setActiveCell(index: number): void {
        document.querySelectorAll('.cell').forEach(cell => {
            cell.classList.remove('active');
        });

        const cell = document.querySelector(`.cell[data-cell-index="${index}"]`) as HTMLElement;
        if (cell) {
            cell.classList.add('active');
            
            const editor = this.editors.get(index);
            if (editor) {
                setTimeout(() => editor.focus(), 100);
            }
        }

        this.currentCellIndex = index;
    }

    private handleExecutionResult(data: any): void {
        const { cell_index, result } = data;
        const cell = document.querySelector(`.cell[data-cell-index="${cell_index}"]`) as HTMLElement;
        
        if (!cell) return;

        cell.classList.remove('executing');

        const executionCountEl = cell.querySelector('.execution-count') as HTMLElement;
        if (result.execution_count && executionCountEl) {
            executionCountEl.textContent = `[${result.execution_count}]`;
        }
        
        const timeEl = cell.querySelector('.execution-time') as HTMLElement;
        if (timeEl && result.execution_time) {
            timeEl.textContent = result.execution_time;
            timeEl.style.display = 'block';
        }

        this.renderCellOutputs(cell, result.outputs);
    }

    private renderCellOutputs(cell: HTMLElement, outputs: any[]): void {
        const outputContainer = cell.querySelector('.cell-output') as HTMLElement;
        const outputContent = cell.querySelector('.output-content') as HTMLElement;
        
        if (!outputContainer || !outputContent) return;
        
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

    private createOutputElement(output: any): HTMLElement {
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

    private clearAllOutputs(): void {
        document.querySelectorAll('.cell-output').forEach(output => {
            (output as HTMLElement).style.display = 'none';
            const content = output.querySelector('.output-content') as HTMLElement;
            if (content) content.innerHTML = '';
        });

        document.querySelectorAll('.execution-count').forEach(count => {
            count.textContent = '[ ]';
        });
    }

    private saveNotebook(): void {
        this.socket.emit('save_notebook', {
            file_path: 'notebook.py'
        });
    }

    private resetKernel(): void {
        if (confirm('Are you sure you want to reset the kernel? This will clear all variables and outputs.')) {
            this.socket.emit('reset_kernel');
        }
    }

    private showError(message: string): void {
        console.error('Error:', message);
        alert('Error: ' + message);
    }
    
    private showSaveSuccess(filePath: string): void {
        const saveBtn = document.getElementById('save-btn') as HTMLElement;
        if (saveBtn) {
            const originalText = saveBtn.textContent;
            saveBtn.textContent = '✅ Saved';
            setTimeout(() => {
                saveBtn.textContent = originalText;
            }, 2000);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, creating NotebookApp...');
    (window as any).notebookApp = new NotebookApp();
    console.log('NotebookApp created and assigned to window!');
});
