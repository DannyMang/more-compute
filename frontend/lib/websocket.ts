type EventCallback = (data?: unknown) => void;

interface SocketWrapper {
  on: (event: string, callback: EventCallback) => void;
  emit: (event: string, data?: Record<string, unknown>) => void;
  disconnect: () => void;
}

export class WebSocketService {
  private socket: SocketWrapper | null = null;
  private listeners: Map<string, EventCallback[]> = new Map();

  private createSocketWrapper(ws: WebSocket): SocketWrapper {
    const eventHandlers = new Map<string, EventCallback>();

    ws.onopen = () => {
      const handler = eventHandlers.get('connect');
      if (handler) handler();
    };

    ws.onerror = (error) => {
      const handler = eventHandlers.get('connect_error');
      if (handler) handler(error);
    };

    ws.onclose = () => {
      const handler = eventHandlers.get('disconnect');
      if (handler) handler();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const handler = eventHandlers.get(message.type);
        if (handler) handler(message.data);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    return {
      on: (event: string, callback: EventCallback) => {
        eventHandlers.set(event, callback);
      },
      emit: (event: string, data?: Record<string, unknown>) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: event, data }));
        }
      },
      disconnect: () => {
        ws.close();
      },
    };
  }

  connect(url: string = 'ws://localhost:3141'): Promise<void> {
    return new Promise((resolve, reject) => {
      // For development, connect directly to the backend WebSocket
      const wsUrl = process.env.NODE_ENV === 'production'
        ? '/ws'
        : 'ws://localhost:3141/ws';

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

  on(event: string, callback: EventCallback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: EventCallback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private emit(event: string, data?: unknown) {
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