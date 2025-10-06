import { io, Socket } from 'socket.io-client';
import { Cell, ExecutionResult } from '@/types/notebook';

export class WebSocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, Function[]> = new Map();

  connect(url: string = 'ws://localhost:8000'): Promise<void> {
    return new Promise((resolve, reject) => {
      // For development, connect directly to the backend WebSocket
      const wsUrl = process.env.NODE_ENV === 'production' 
        ? '/ws' 
        : 'ws://localhost:8000/ws';
      
      // Use native WebSocket for FastAPI compatibility
      const ws = new WebSocket(wsUrl);
      
      // Wrap WebSocket in Socket.IO-like interface
      this.socket = this.createSocketWrapper(ws);

      this.socket.on('connect', () => {
        console.log('Connected to server');
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        reject(error);
      });

      this.socket.on('disconnect', () => {
        console.log('Disconnected from server');
      });

      // Set up event forwarding
      this.setupEventForwarding();
    });
  }

  private setupEventForwarding() {
    if (!this.socket) return;

    // Forward common events
    const events = [
      'notebook_loaded',
      'cell_added', 
      'cell_deleted',
      'cell_updated',
      'execution_result',
      'kernel_status',
      'error',
    ];

    events.forEach(event => {
      this.socket!.on(event, (data) => {
        this.emit(event, data);
      });
    });
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }

  // Notebook operations
  loadNotebook(notebookName: string) {
    this.socket?.emit('load_notebook', { notebook_name: notebookName });
  }

  saveNotebook() {
    this.socket?.emit('save_notebook');
  }

  // Cell operations
  addCell(index: number, cellType: 'code' | 'markdown', source: string = '') {
    this.socket?.emit('add_cell', {
      index,
      cell_type: cellType,
      source,
    });
  }

  deleteCell(cellIndex: number) {
    this.socket?.emit('delete_cell', { cell_index: cellIndex });
  }

  updateCell(cellIndex: number, source: string) {
    this.socket?.emit('update_cell', {
      cell_index: cellIndex,
      source,
    });
  }

  executeCell(cellIndex: number, source: string) {
    this.socket?.emit('execute_cell', {
      cell_index: cellIndex,
      source,
    });
  }

  // Kernel operations
  resetKernel() {
    this.socket?.emit('reset_kernel');
  }

  interruptKernel() {
    this.socket?.emit('interrupt_kernel');
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}