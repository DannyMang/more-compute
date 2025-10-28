/**
 * LEGACY COMPONENT - NO LONGER USED
 *
 * This component has been replaced by MonacoCell.tsx which provides:
 * - Modern Monaco Editor (VSCode engine)
 * - LSP support for Python autocomplete and hover
 * - Better performance and features
 *
 * Kept for reference only. Do not use in new code.
 */

"use client";

import React, { useRef, useEffect, useState } from "react";
import { Cell as CellType } from "@/types/notebook";
import CellOutput from "./CellOutput";
import AddCellButton from "./AddCellButton";
import MarkdownRenderer from "./MarkdownRenderer";
import CellButton from "./CellButton";
import {
  UpdateIcon,
  LinkBreak2Icon,
  PlayIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "@radix-ui/react-icons";
import { Check, X } from "lucide-react";
import { fixIndentation } from "@/lib/api";

declare const CodeMirror: any;

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

export const Cell: React.FC<CellProps> = ({
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
  // REFS
  // ============================================================================
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const codeMirrorInstance = useRef(null);
  const wasEditingMarkdown = useRef(false);
  const indexRef = useRef<number>(index);
  const intervalRef = useRef(null);

  // ============================================================================
  // STATE
  // ============================================================================
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
  const handleExecute = () => {
    if (cell.cell_type === "markdown") {
      onExecute(indexRef.current);
      setIsEditing(false);
    } else {
      if (isExecuting) {
        onInterrupt(indexRef.current);
      } else {
        onExecute(indexRef.current);
      }
    }
  };

  const handleCellClick = () => {
    onSetActive(indexRef.current);
    if (cell.cell_type === "markdown") {
      setIsEditing(true);
    }
  };

  const handleFixIndentation = async () => {
    try {
      const fixedCode = await fixIndentation(cell.source);
      onUpdate(indexRef.current, fixedCode);

      if (codeMirrorInstance.current) {
        codeMirrorInstance.current.setValue(fixedCode);
      }
    } catch (err) {
      console.error("Failed to fix indentation:", err);
    }
  };

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Keep indexRef in sync
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

  // Track when user is editing markdown (for auto-save on click away)
  useEffect(() => {
    if (isActive && cell.cell_type === "markdown" && isEditing) {
      wasEditingMarkdown.current = true;
    }
  }, [isActive, cell.cell_type]);

  // Auto-save markdown when user clicks away
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
  }, [isActive, cell.cell_type]);

  // CodeMirror editor initialization and cleanup
  useEffect(() => {
    if (isEditing) {
      if (
        !codeMirrorInstance.current &&
        editorRef.current &&
        typeof CodeMirror !== "undefined"
      ) {
        const editor = CodeMirror.fromTextArea(editorRef.current, {
          mode: cell.cell_type === "code" ? "python" : "text/plain",
          lineNumbers: cell.cell_type === "code",
          theme: "default",
          lineWrapping: true,
          placeholder:
            cell.cell_type === "code" ? "Enter code..." : "Enter markdown...",
        });
        codeMirrorInstance.current = editor;

        editor.on("change", (instance: any) =>
          onUpdate(indexRef.current, instance.getValue())
        );
        editor.on("focus", () => onSetActive(indexRef.current));
        editor.on("blur", () => {
          if (cell.cell_type === "markdown") {
            if (cell.source?.trim()) {
              // Auto-save on blur
              onExecute(indexRef.current);
              setIsEditing(false);
            }
            // If empty, stay in editing mode but mark as no longer editing
            wasEditingMarkdown.current = false;
          }
        });
        editor.on("keydown", (instance: any, event: KeyboardEvent) => {
          if (event.shiftKey && event.key === "Enter") {
            event.preventDefault();
            handleExecute();
          }
        });

        if (editor.getValue() !== cell.source) {
          editor.setValue(cell.source);
        }
      }
    } else {
      if (codeMirrorInstance.current) {
        codeMirrorInstance.current.toTextArea();
        codeMirrorInstance.current = null;
      }
    }
  }, [isEditing, cell.source]);

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
        {!isMarkdownWithContent && (
          <div className="cell-hover-controls">
            <div className="cell-actions-right">
              <CellButton
                icon={<PlayIcon className="w-6 h-6" />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleExecute();
                }}
                title={isExecuting ? "Stop execution" : "Run cell"}
                isLoading={isExecuting}
              />
              <CellButton
                icon={<ChevronUpIcon className="w-6 h-6" />}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp(indexRef.current);
                }}
                title="Move cell up"
                disabled={index === 0}
              />
              <CellButton
                icon={<ChevronDownIcon className="w-6 h-6" />}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown(indexRef.current);
                }}
                title="Move cell down"
                disabled={index === totalCells - 1}
              />
              <CellButton
                icon={<LinkBreak2Icon className="w-5 h-5" />}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(indexRef.current);
                }}
                title="Delete cell"
              />
            </div>
          </div>
        )}

        {/* Cell Content */}
        <div
          className={`cell-content ${isMarkdownWithContent ? "cursor-pointer" : ""}`}
          onClick={handleCellClick}
        >
          <div className="cell-input">
            {isEditing || cell.cell_type === "code" ? (
              <div
                className={`cell-editor-container ${cell.cell_type === "markdown" ? "markdown-editor-container" : "code-editor-container"}`}
              >
                <textarea
                  ref={editorRef}
                  defaultValue={cell.source}
                  className={`cell-editor ${cell.cell_type === "markdown" ? "markdown-editor" : "code-editor"}`}
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
            onFixIndentation={handleFixIndentation}
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
