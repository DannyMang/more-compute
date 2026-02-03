/**
 * TypeScript types for Claude AI copilot integration.
 */

/**
 * A single message in the Claude chat history.
 */
export interface ClaudeMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  proposedEdits?: ProposedEdit[];
}

/**
 * A proposed edit to a notebook cell.
 */
export interface ProposedEdit {
  id: string;
  cellIndex: number;
  originalCode: string;
  newCode: string;
  explanation: string;
  status: "pending" | "applied" | "rejected";
}

/**
 * Diff information for inline display.
 */
export interface DiffLine {
  type: "unchanged" | "added" | "removed";
  content: string;
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/**
 * Context information sent to Claude.
 */
export interface ClaudeContext {
  cells: CellContext[];
  gpuInfo?: GPUInfo;
  metrics?: SystemMetrics;
  packages?: PackageInfo[];
}

/**
 * Simplified cell context for Claude.
 */
export interface CellContext {
  index: number;
  cellType: "code" | "markdown";
  source: string;
  outputs?: OutputContext[];
  error?: ErrorContext;
}

/**
 * Simplified output context.
 */
export interface OutputContext {
  type: "stream" | "execute_result" | "display_data" | "error";
  text?: string;
  data?: Record<string, unknown>;
}

/**
 * Error context from cell execution.
 */
export interface ErrorContext {
  ename: string;
  evalue: string;
  traceback?: string[];
}

/**
 * GPU information for context.
 */
export interface GPUInfo {
  gpu: Array<{
    util_percent: number;
    mem_used: number;
    mem_total: number;
    temperature_c?: number;
  }>;
}

/**
 * System metrics for context.
 */
export interface SystemMetrics {
  cpu: {
    percent: number;
    cores: number;
  };
  memory: {
    percent: number;
    used: number;
    total: number;
  };
}

/**
 * Package information.
 */
export interface PackageInfo {
  name: string;
  version: string;
}

/**
 * Claude service configuration.
 */
export interface ClaudeConfig {
  apiKey: string;
  configured: boolean;
}

/**
 * WebSocket message types for Claude.
 */
export type ClaudeWebSocketMessage =
  | {
      type: "claude_message";
      data: {
        message: string;
        context?: ClaudeContext;
        history?: Array<{ role: string; content: string }>;
      };
    }
  | {
      type: "claude_stream_start";
      data: { messageId: string };
    }
  | {
      type: "claude_stream_chunk";
      data: { messageId: string; chunk: string };
    }
  | {
      type: "claude_stream_end";
      data: {
        messageId: string;
        fullResponse: string;
        proposedEdits?: ProposedEdit[];
      };
    }
  | {
      type: "claude_error";
      data: { error: string };
    }
  | {
      type: "claude_apply_edit";
      data: { editId: string; cellIndex: number; newCode: string };
    }
  | {
      type: "claude_reject_edit";
      data: { editId: string };
    };

/**
 * Available Claude models.
 */
export type ClaudeModel = "sonnet" | "haiku" | "opus";

/**
 * State for the Claude context provider.
 */
export interface ClaudeState {
  messages: ClaudeMessage[];
  pendingEdits: Map<number, ProposedEdit>;
  isPanelOpen: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  error: string | null;
  model: ClaudeModel;
}

/**
 * Actions for the Claude context.
 */
export interface ClaudeActions {
  sendMessage: (message: string) => void;
  applyEdit: (editId: string) => void;
  rejectEdit: (editId: string) => void;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  clearHistory: () => void;
  setApiKey: (apiKey: string) => Promise<boolean>;
  setModel: (model: ClaudeModel) => void;
}
