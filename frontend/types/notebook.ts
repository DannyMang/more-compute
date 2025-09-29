export interface Cell {
  id: string;
  cell_type: 'code' | 'markdown';
  source: string;
  outputs: Output[];
  metadata: Record<string, unknown>;
  execution_count: number | null;
  execution_time?: string; // e.g., "123.4ms" or "1.2s"
  error?: any;
  isEditing?: boolean;
}

export type Output = StreamOutput | ExecuteResultOutput | ErrorOutput | DisplayDataOutput;

export interface StreamOutput {
  output_type: 'stream';
  name: 'stdout' | 'stderr';
  text: string;
}

export interface ExecuteResultOutput {
  output_type: 'execute_result';
  data: { 'text/plain'?: string };
  execution_count: number;
}

export interface DisplayDataOutput {
  output_type: 'display_data';
  data: { 'text/plain'?: string; 'image/png'?: string };
}

export interface ErrorOutput {
  output_type: 'error';
  ename: string;
  evalue: string;
  traceback: string[];
  error_type?: 'pip_error' | 'import_error' | 'file_error' | 'generic_error';
  suggestions?: string[];
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