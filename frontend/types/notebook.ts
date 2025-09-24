export interface Cell {
  id: string;
  cell_type: 'code' | 'markdown';
  source: string;
  outputs: Output[];
  execution_count?: number;
  metadata?: Record<string, any>;
}

export interface Output {
  output_type: 'stream' | 'execute_result' | 'error';
  name?: string;
  text?: string;
  data?: {
    'text/plain'?: string;
    'text/html'?: string;
    'image/png'?: string;
  };
  ename?: string;
  evalue?: string;
  traceback?: string[];
  suggestions?: string[];
  error_type?: 'pip_error' | 'import_error' | 'file_error' | 'generic_error';
}

export interface ExecutionResult {
  cell_index: number;
  result: {
    execution_count?: number;
    outputs: Output[];
    error?: Output;
    status: 'ok' | 'error';
    execution_time?: string;
  };
}

export interface NotebookState {
  cells: Cell[];
  currentCellIndex: number | null;
  executingCells: Set<number>;
  kernelStatus: 'idle' | 'busy' | 'disconnected';
  notebookName: string;
}