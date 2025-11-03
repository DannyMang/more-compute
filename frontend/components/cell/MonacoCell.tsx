"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import Editor, { Monaco } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { Cell as CellType } from "@/types/notebook";
import CellOutput from "../output/CellOutput";
import AddCellButton from "./AddCellButton";
import MarkdownRenderer from "../output/MarkdownRenderer";
import CellButton from "./CellButton";
import {
  UpdateIcon,
  LinkBreak2Icon,
  PlayIcon,
  StopIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "@radix-ui/react-icons";
import { Check, X } from "lucide-react";
import { loadMonacoThemes } from "@/lib/monaco-themes";
import { loadSettings } from "@/lib/settings";

interface CellProps {
  cell: CellType;
  index: number;
  totalCells: number;
  isActive: boolean;
  isExecuting: boolean;
  onExecute: (index: number) => void;
  onInterrupt: (index: number) => void;
  onDelete: (index: number) => void;
  onUpdate: (index: number, source: string) => void;
  onSetActive: (index: number) => void;
  onAddCell: (type: "code" | "markdown", index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

// Global registry of cell editors for LSP
const cellEditors = new Map<string, monaco.editor.IStandaloneCodeEditor>();

// Global flag to ensure providers are registered only once
let providersRegistered = false;
// Global flag to ensure themes are loaded only once
let themesLoaded = false;

// Load Monaco themes globally once
function loadMonacoThemesGlobally(monacoInstance: Monaco) {
  if (themesLoaded) return;
  themesLoaded = true;

  try {
    loadMonacoThemes(monacoInstance);
  } catch (e) {
    console.warn('Failed to load Monaco themes:', e);
  }
}

// Register global LSP providers once
function registerGlobalLSPProviders(monacoInstance: Monaco) {
  if (providersRegistered) return;
  providersRegistered = true;

  // Global completion provider that looks up the editor by model URI
  monacoInstance.languages.registerCompletionItemProvider("python", {
    async provideCompletionItems(model, position) {
      try {
        const cellId = extractCellIdFromUri(model.uri.toString());
        if (!cellId) return { suggestions: [] };

        const source = model.getValue();
        const response = await fetch("/api/lsp/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cell_id: cellId,
            source,
            line: position.lineNumber - 1,
            character: position.column - 1,
          }),
        });

        if (!response.ok) return { suggestions: [] };

        const data = await response.json();
        const completions = data.completions || [];

        const suggestions: monaco.languages.CompletionItem[] = completions.map(
          (item: any) => ({
            label: item.label,
            kind: mapCompletionKind(item.kind, monacoInstance),
            detail: item.detail,
            documentation: item.documentation?.value || item.documentation,
            insertText: item.insertText || item.label,
            range: new monacoInstance.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column
            ),
          })
        );

        return { suggestions };
      } catch (error) {
        console.error("LSP completion error:", error);
        return { suggestions: [] };
      }
    },
    triggerCharacters: [".", "(", "["],
  });

  // Global hover provider
  monacoInstance.languages.registerHoverProvider("python", {
    async provideHover(model, position) {
      try {
        const cellId = extractCellIdFromUri(model.uri.toString());
        if (!cellId) return null;

        const source = model.getValue();
        const response = await fetch("/api/lsp/hover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cell_id: cellId,
            source,
            line: position.lineNumber - 1,
            character: position.column - 1,
          }),
        });

        if (!response.ok) return null;

        const data = await response.json();
        const hover = data.hover;

        if (!hover || !hover.contents) return null;

        const contents = Array.isArray(hover.contents)
          ? hover.contents
          : [hover.contents];

        return {
          contents: contents.map((content: any) => ({
            value: typeof content === "string" ? content : content.value,
          })),
        };
      } catch (error) {
        console.error("LSP hover error:", error);
        return null;
      }
    },
  });
}

function extractCellIdFromUri(uri: string): string | null {
  // Monaco creates URIs like "inmemory://model/1", "inmemory://model/2", etc.
  // We need to extract the model number and map it to a cell ID
  const match = uri.match(/model\/(\d+)$/);
  if (match) {
    const modelNumber = match[1];
    // Find the editor with this model
    for (const [cellId, editor] of cellEditors.entries()) {
      if (editor.getModel()?.uri.toString().includes(modelNumber)) {
        return cellId;
      }
    }
  }
  return null;
}

function mapCompletionKind(
  lspKind: number,
  monacoInstance: Monaco
): monaco.languages.CompletionItemKind {
  const kindMap: { [key: number]: monaco.languages.CompletionItemKind } = {
    1: monacoInstance.languages.CompletionItemKind.Text,
    2: monacoInstance.languages.CompletionItemKind.Method,
    3: monacoInstance.languages.CompletionItemKind.Function,
    4: monacoInstance.languages.CompletionItemKind.Constructor,
    5: monacoInstance.languages.CompletionItemKind.Field,
    6: monacoInstance.languages.CompletionItemKind.Variable,
    7: monacoInstance.languages.CompletionItemKind.Class,
    8: monacoInstance.languages.CompletionItemKind.Interface,
    9: monacoInstance.languages.CompletionItemKind.Module,
    10: monacoInstance.languages.CompletionItemKind.Property,
    11: monacoInstance.languages.CompletionItemKind.Unit,
    12: monacoInstance.languages.CompletionItemKind.Value,
    13: monacoInstance.languages.CompletionItemKind.Enum,
    14: monacoInstance.languages.CompletionItemKind.Keyword,
    15: monacoInstance.languages.CompletionItemKind.Snippet,
    16: monacoInstance.languages.CompletionItemKind.Color,
    17: monacoInstance.languages.CompletionItemKind.File,
    18: monacoInstance.languages.CompletionItemKind.Reference,
    19: monacoInstance.languages.CompletionItemKind.Folder,
    20: monacoInstance.languages.CompletionItemKind.EnumMember,
    21: monacoInstance.languages.CompletionItemKind.Constant,
    22: monacoInstance.languages.CompletionItemKind.Struct,
    23: monacoInstance.languages.CompletionItemKind.Event,
    24: monacoInstance.languages.CompletionItemKind.Operator,
    25: monacoInstance.languages.CompletionItemKind.TypeParameter,
  };
  return kindMap[lspKind] || monacoInstance.languages.CompletionItemKind.Text;
}


export const MonacoCell: React.FC<CellProps> = ({
  cell,
  index,
  totalCells,
  isActive,
  isExecuting,
  onExecute,
  onDelete,
  onInterrupt,
  onUpdate,
  onSetActive,
  onAddCell,
  onMoveUp,
  onMoveDown,
}) => {
  // ============================================================================
  // REFS & STATE
  // ============================================================================
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const wasEditingMarkdown = useRef(false);
  const indexRef = useRef<number>(index);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const disposablesRef = useRef<monaco.IDisposable[]>([]);
  const isUnmountingRef = useRef(false);

  const [isEditing, setIsEditing] = useState(
    () => cell.cell_type === "code" || !cell.source?.trim()
  );
  const [elapsedLabel, setElapsedLabel] = useState<string | null>(
    cell.execution_time ?? null
  );

  // ============================================================================
  // UTILITIES
  // ============================================================================
  const formatMs = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}s`;
  };

  const parseExecTime = (s?: string | null): number | null => {
    if (!s) return null;
    if (s.endsWith("ms")) return parseFloat(s.replace("ms", ""));
    if (s.endsWith("s")) return parseFloat(s.replace("s", "")) * 1000;
    return null;
  };

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================
  const isMarkdownWithContent =
    cell.cell_type === "markdown" && !isEditing && cell.source?.trim();

  // ============================================================================
  // HANDLERS
  // ============================================================================
  const handleExecute = useCallback(() => {
    if (cell.cell_type === "markdown") {
      onExecute(indexRef.current);
      setIsEditing(false);
    } else {
      onExecute(indexRef.current);
    }
  }, [cell.cell_type, onExecute]);

  const handleInterrupt = useCallback(() => {
    onInterrupt(indexRef.current);
  }, [onInterrupt]);

  const handleCellClick = () => {
    onSetActive(indexRef.current);
    if (cell.cell_type === "markdown") {
      setIsEditing(true);
    }
  };

  // ============================================================================
  // MONACO SETUP
  // ============================================================================
  const handleEditorWillMount = (monacoInstance: Monaco) => {
    // Clean up any previous editor instance before mounting new one
    if (editorRef.current) {
      try {
        editorRef.current.dispose();
      } catch (e) {
        // Ignore
      }
      editorRef.current = null;
    }

    // Load themes globally once
    loadMonacoThemesGlobally(monacoInstance);

    // Apply theme globally before editor is created
    const settings = loadSettings();
    const userTheme = settings.theme;

    if (userTheme === 'light') {
      monacoInstance.editor.setTheme('vs');
    } else if (userTheme === 'dark') {
      monacoInstance.editor.setTheme('vs-dark');
    } else {
      try {
        monacoInstance.editor.setTheme(userTheme);
      } catch (e) {
        const isDark = userTheme.includes('dark') || userTheme.includes('night') || userTheme.includes('synthwave');
        monacoInstance.editor.setTheme(isDark ? 'vs-dark' : 'vs');
      }
    }
  };

  const handleEditorDidMount = (
    editor: monaco.editor.IStandaloneCodeEditor,
    monacoInstance: Monaco
  ) => {
    editorRef.current = editor;
    monacoRef.current = monacoInstance;

    // Register global LSP providers once
    registerGlobalLSPProviders(monacoInstance);

    // Apply theme again after editor is mounted to ensure it takes effect
    const settings = loadSettings();
    const userTheme = settings.theme;

    if (userTheme === 'light') {
      monacoInstance.editor.setTheme('vs');
    } else if (userTheme === 'dark') {
      monacoInstance.editor.setTheme('vs-dark');
    } else {
      try {
        monacoInstance.editor.setTheme(userTheme);
      } catch (e) {
        const isDark = userTheme.includes('dark') || userTheme.includes('night') || userTheme.includes('synthwave');
        monacoInstance.editor.setTheme(isDark ? 'vs-dark' : 'vs');
      }
    }

    // Register this cell's editor in the global map for LSP
    if (cell.cell_type === "code") {
      cellEditors.set(cell.id, editor);
    }

    // Focus editor if active
    if (isActive) {
      editor.focus();
    }

    // Handle content changes
    const changeDisposable = editor.onDidChangeModelContent(() => {
      if (!isUnmountingRef.current) {
        onUpdate(indexRef.current, editor.getValue());
      }
    });

    // Handle Shift+Enter to execute
    const keyDisposable = editor.addCommand(
      monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.Enter,
      () => {
        handleExecute();
      }
    );

    // Markdown blur behavior
    if (cell.cell_type === "markdown") {
      const blurDisposable = editor.onDidBlurEditorText(() => {
        if (!isUnmountingRef.current) {
          if (cell.source?.trim()) {
            onExecute(indexRef.current);
            setIsEditing(false);
          }
          wasEditingMarkdown.current = false;
        }
      });
      disposablesRef.current.push(blurDisposable);
    }

    if (changeDisposable && typeof changeDisposable.dispose === 'function') {
      disposablesRef.current.push(changeDisposable);
    }
    // Note: addCommand returns a command ID (string), not a disposable
    // We don't need to track it for cleanup
  };

  // ============================================================================
  // EFFECTS
  // ============================================================================
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Execution timer
  useEffect(() => {
    if (isExecuting) {
      const start = Date.now();
      setElapsedLabel("0ms");
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        setElapsedLabel(formatMs(Date.now() - start));
      }, 100);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      const ms = parseExecTime(cell.execution_time as any);
      if (ms != null) setElapsedLabel(formatMs(ms));
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isExecuting, cell.execution_time]);

  // Track markdown editing
  useEffect(() => {
    if (isActive && cell.cell_type === "markdown" && isEditing) {
      wasEditingMarkdown.current = true;
    }
  }, [isActive, cell.cell_type, isEditing]);

  // Auto-save markdown on blur
  useEffect(() => {
    if (
      !isActive &&
      wasEditingMarkdown.current &&
      cell.cell_type === "markdown"
    ) {
      if (cell.source?.trim()) {
        onExecute(indexRef.current);
        setIsEditing(false);
      }
      wasEditingMarkdown.current = false;
    }
  }, [isActive, cell.cell_type, cell.source, onExecute]);

  // Cleanup
  useEffect(() => {
    // Reset unmounting flag on mount
    isUnmountingRef.current = false;

    return () => {
      // Set unmounting flag to prevent async operations
      isUnmountingRef.current = true;

      // Dispose the editor instance first
      if (editorRef.current) {
        try {
          const model = editorRef.current.getModel();

          // Stop any pending operations
          if (editorRef.current) {
            editorRef.current.dispose();
          }

          if (model && !model.isDisposed()) {
            model.dispose();
          }
        } catch (e) {
          // Silently ignore errors during cleanup
        }
        editorRef.current = null;
      }

      // Remove editor from global registry
      if (cell.cell_type === "code") {
        cellEditors.delete(cell.id);
      }

      // Dispose all Monaco disposables
      disposablesRef.current.forEach((d) => {
        if (d && typeof d.dispose === 'function') {
          try {
            d.dispose();
          } catch (e) {
            // Silently ignore errors during cleanup
          }
        }
      });
      disposablesRef.current = [];
    };
  }, [cell.id, cell.cell_type]);

  // Focus when active
  useEffect(() => {
    if (isActive && editorRef.current) {
      editorRef.current.focus();
    }
  }, [isActive]);

  // Listen for theme changes and update Monaco editor
  useEffect(() => {
    const handleThemeChange = () => {
      if (!monacoRef.current) return;

      const settings = loadSettings();
      const userTheme = settings.theme;

      if (userTheme === 'light') {
        monacoRef.current.editor.setTheme('vs');
      } else if (userTheme === 'dark') {
        monacoRef.current.editor.setTheme('vs-dark');
      } else {
        try {
          monacoRef.current.editor.setTheme(userTheme);
        } catch (e) {
          const isDark = userTheme.includes('dark') || userTheme.includes('night') || userTheme.includes('synthwave');
          monacoRef.current.editor.setTheme(isDark ? 'vs-dark' : 'vs');
        }
      }
    };

    // Listen for storage events (theme changes from settings)
    window.addEventListener('storage', handleThemeChange);
    // Also listen for custom theme change event
    window.addEventListener('themeChanged', handleThemeChange);

    return () => {
      window.removeEventListener('storage', handleThemeChange);
      window.removeEventListener('themeChanged', handleThemeChange);
    };
  }, []);

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="cell-wrapper">
      {/* Status Indicator */}
      {!isMarkdownWithContent && (
        <div className="cell-status-indicator">
          <span className="status-indicator">
            <span className="status-bracket">[</span>
            {isExecuting ? (
              <UpdateIcon className="w-1 h-1" />
            ) : cell.error ? (
              <X size={14} color="#dc2626" />
            ) : cell.execution_count != null ? (
              <Check size={14} color="#16a34a" />
            ) : (
              <span
                style={{
                  width: "14px",
                  height: "14px",
                  display: "inline-block",
                }}
              ></span>
            )}
            <span className="status-bracket">]</span>
          </span>
          {elapsedLabel && (
            <span className="status-timer" title="Execution time">
              {elapsedLabel}
            </span>
          )}
        </div>
      )}

      {/* Add Cell Above Button */}
      <div className="add-cell-line add-line-above">
        <AddCellButton onAddCell={(type) => onAddCell(type, indexRef.current)} />
      </div>

      {/* Main Cell Container */}
      <div
        className={`cell ${isActive ? "active" : ""} ${isExecuting ? "executing" : ""} ${isMarkdownWithContent ? "markdown-display-mode" : ""}`}
        data-cell-index={index}
      >
        {/* Hover Controls */}
        <div className="cell-hover-controls">
          <div className="cell-actions-right">
            {!isMarkdownWithContent && (
              <>
                <CellButton
                  icon={<PlayIcon className="w-6 h-6" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExecute();
                  }}
                  title="Run cell"
                  disabled={isExecuting}
                />
                <CellButton
                  icon={<StopIcon className="w-6 h-6" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleInterrupt();
                  }}
                  title="Stop execution"
                  disabled={!isExecuting}
                />
              </>
            )}
            <CellButton
              icon={<ChevronUpIcon className="w-6 h-6" />}
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp(indexRef.current);
              }}
              title={isExecuting ? "Cannot move while executing" : "Move cell up"}
              disabled={isExecuting || index === 0}
            />
            <CellButton
              icon={<ChevronDownIcon className="w-6 h-6" />}
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown(indexRef.current);
              }}
              title={isExecuting ? "Cannot move while executing" : "Move cell down"}
              disabled={isExecuting || index === totalCells - 1}
            />
            <CellButton
              icon={<LinkBreak2Icon className="w-5 h-5" />}
              onClick={(e) => {
                e.stopPropagation();
                // If cell is executing, interrupt it first
                if (isExecuting) {
                  onInterrupt(indexRef.current);
                  // Wait a bit for interrupt to complete, then delete
                  setTimeout(() => {
                    onDelete(indexRef.current);
                  }, 500);
                } else {
                  onDelete(indexRef.current);
                }
              }}
              title={isExecuting ? "Stop and delete cell" : "Delete cell"}
            />
          </div>
        </div>

        {/* Cell Content */}
        <div
          className={`cell-content ${isMarkdownWithContent ? "cursor-pointer" : ""}`}
          onClick={handleCellClick}
        >
          <div className="cell-input">
            {isEditing || cell.cell_type === "code" ? (
              <div
                className={`monaco-editor-container ${cell.cell_type === "markdown" ? "markdown-editor-container" : "code-editor-container"}`}
              >
                <Editor
                  key={`${cell.id}-${index}`}
                  height={Math.max((cell.source.split('\n').length * 19) + 40, 100)}
                  defaultLanguage={
                    cell.cell_type === "code" ? "python" : "markdown"
                  }
                  defaultValue={cell.source}
                  beforeMount={handleEditorWillMount}
                  onMount={handleEditorDidMount}
                  options={{
                    minimap: { enabled: false },
                    lineNumbers: cell.cell_type === "code" ? "on" : "off",
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    wrappingStrategy: "advanced",
                    fontSize: 14,
                    fontFamily: "'Fira Code', 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
                    lineHeight: 24,
                    automaticLayout: true,
                    tabSize: 4,
                    insertSpaces: true,
                    quickSuggestions: cell.cell_type === "code",
                    suggestOnTriggerCharacters: cell.cell_type === "code",
                    acceptSuggestionOnEnter: "on",
                    tabCompletion: "on",
                    suggest: {
                      showIcons: true,
                      showSnippets: true,
                      showWords: false,
                      insertMode: 'replace',
                      filterGraceful: true,
                    },
                    contextmenu: true,
                    folding: cell.cell_type === "code",
                    glyphMargin: false,
                    lineDecorationsWidth: 0,
                    lineNumbersMinChars: 3,
                    renderLineHighlight: "none", // Remove grey rectangle
                    occurrencesHighlight: "off",
                    selectionHighlight: false,
                    renderLineHighlightOnlyWhenFocus: false,
                    hideCursorInOverviewRuler: true,
                    overviewRulerBorder: false,
                    overviewRulerLanes: 0,
                    // NOTE: fixedOverflowWidgets has known positioning bugs in 2024 - disabled
                    padding: { top: 8, bottom: 8, left: 8 }, // All padding managed by Monaco
                    scrollbar: {
                      vertical: "auto",
                      horizontal: "auto",
                      verticalScrollbarSize: 10,
                      horizontalScrollbarSize: 10,
                    },
                  }}
                />
              </div>
            ) : (
              <MarkdownRenderer
                source={cell.source}
                onClick={() => setIsEditing(true)}
              />
            )}
          </div>
          <CellOutput
            outputs={cell.outputs}
            error={cell.error}
          />
        </div>
      </div>

      {/* Add Cell Below Button */}
      <div className="add-cell-line add-line-below">
        <AddCellButton
          onAddCell={(type) => onAddCell(type, indexRef.current + 1)}
        />
      </div>
    </div>
  );
};
