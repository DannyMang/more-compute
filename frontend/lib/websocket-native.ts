type EventCallback = (data: unknown) => void;

export class WebSocketService {
  private ws: WebSocket | null = null;
  private listeners: Map<string, EventCallback[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private url: string = '';

  connect(url: string = 'ws://localhost:8888/ws'): Promise<void> {
    this.url = url;
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
          console.log('Connected to server');
          this.reconnectAttempts = 0;
          this.emit('connect', null);
          resolve();
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.emit('disconnect', null);
          reject(error);
        };

        this.ws.onclose = (ev) => {
          console.log('Disconnected from server', { code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
          this.emit('disconnect', null);
          this.handleDisconnect();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('[WS RECV]', data);
            this.handleMessage(data);
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(data: { type: string; data: unknown }) {
    const messageType = data.type;
    const messageData = data.data;
  
    // Map FastAPI message types to our expected events
    switch (messageType) {
      case 'notebook_data':
        this.emit('notebook_loaded', messageData);
        break;
      case 'notebook_updated':
        this.emit('notebook_updated', messageData);
        break;
      case 'execution_start':
        this.emit('execution_start', messageData);
        break;
      case 'heartbeat':
        this.emit('heartbeat', messageData);
        break;
      case 'stream_output':
        this.emit('stream_output', messageData);
        break;
      case 'execution_result':
        this.emit('execution_result', messageData);
        break;
      case 'execution_complete': // This may be sent by some legacy paths
        this.emit('execution_complete', messageData);
        break;
      case 'execution_error':
        this.emit('execution_error', messageData);
        break;
      case 'execution_interrupted':
        this.emit('execution_interrupted', messageData);
        break;
      case 'cell_updated': // Note: This is now handled by notebook_updated
        this.emit('cell_updated', messageData);
        break;
      case 'cell_added':
        this.emit('cell_added', messageData);
        break;
      case 'cell_deleted':
        this.emit('cell_deleted', messageData);
        break;
      case 'kernel_status':
        this.emit('kernel_status', messageData);
        break;
      case 'packages_updated':
        // Notify listeners and also broadcast a DOM event for decoupled UIs
        this.emit('packages_updated', messageData);
        try {
          window.dispatchEvent(new CustomEvent('mc:packages-updated', { detail: messageData }));
        } catch {}
        break;
      case 'notebook_saved':
        this.emit('notebook_saved', messageData);
        break;
      case 'error':
        this.emit('error', messageData);
        break;
      default:
        console.warn('Unknown message type:', messageType);
    }
  }

  private handleDisconnect() {
    this.emit('disconnect', null);
    // Attempt to reconnect
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => {
        this.connect(this.url).catch(console.error);
      }, 1000 * this.reconnectAttempts);
    }
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

  private emit(event: string, data: unknown) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }

  private send(type: string, data: Record<string, unknown> = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    } else {
      console.error('WebSocket is not connected');
    }
  }

  // Notebook operations
  loadNotebook(notebookName: string) {
    this.send('load_notebook', { notebook_name: notebookName });
  }

  saveNotebook() {
    this.send('save_notebook');
  }

  // Cell operations
  addCell(index: number, cellType: 'code' | 'markdown', source: string = '', fullCell?: unknown) {
    this.send('add_cell', {
      index,
      cell_type: cellType,
      source,
      full_cell: fullCell,
    });
  }

  deleteCell(cellIndex: number) {
    this.send('delete_cell', { cell_index: cellIndex });
  }

  updateCell(cellIndex: number, source: string) {
    this.send('update_cell', {
      cell_index: cellIndex,
      source,
    });
  }

  moveCell(fromIndex: number, toIndex: number) {
    this.send('move_cell', {
      from_index: fromIndex,
      to_index: toIndex,
    });
  }

  executeCell(cellIndex: number, source: string) {
    this.send('execute_cell', {
      cell_index: cellIndex,
      source,
    });
  }

  // Kernel operations
  resetKernel() {
    this.send('reset_kernel');
  }

  interruptKernel(cellIndex?: number) {
    this.send('interrupt_kernel', { cell_index: cellIndex });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}