"use client";

import { useEffect, useRef, useCallback } from "react";
import * as monaco from "monaco-editor";
import * as Diff from "diff";
import type { ProposedEdit } from "@/types/claude";

interface UseInlineDiffProps {
  editor: monaco.editor.IStandaloneCodeEditor | null;
  cellIndex: number;
  pendingEdit: ProposedEdit | undefined;
  onApply: (editId: string) => void;
  onReject: (editId: string) => void;
}

interface DiffDecoration {
  range: monaco.Range;
  options: monaco.editor.IModelDecorationOptions;
}

/**
 * Hook to manage inline diff decorations in Monaco editor.
 * Shows red/green line highlighting for proposed edits with accept/reject buttons.
 */
export function useInlineDiff({
  editor,
  cellIndex,
  pendingEdit,
  onApply,
  onReject,
}: UseInlineDiffProps) {
  const decorationsRef = useRef<string[]>([]);
  const widgetRef = useRef<monaco.editor.IContentWidget | null>(null);
  const commandsRef = useRef<monaco.IDisposable[]>([]);

  // Clear decorations and widgets
  const clearDecorations = useCallback(() => {
    if (!editor) return;

    // Remove decorations
    if (decorationsRef.current.length > 0) {
      editor.deltaDecorations(decorationsRef.current, []);
      decorationsRef.current = [];
    }

    // Remove widget
    if (widgetRef.current) {
      editor.removeContentWidget(widgetRef.current);
      widgetRef.current = null;
    }

    // Dispose commands
    commandsRef.current.forEach((d) => d.dispose());
    commandsRef.current = [];
  }, [editor]);

  // Apply diff decorations
  const applyDiffDecorations = useCallback(() => {
    if (!editor || !pendingEdit || pendingEdit.status !== "pending") {
      clearDecorations();
      return;
    }

    const model = editor.getModel();
    if (!model) return;

    // Clear previous decorations first
    clearDecorations();

    // Compute diff between original and new code
    const originalCode = pendingEdit.originalCode || "";
    const newCode = pendingEdit.newCode || "";
    const changes = Diff.diffLines(originalCode, newCode);

    const decorations: DiffDecoration[] = [];

    // Track line numbers in the new code (what's displayed)
    let newLineNumber = 1;
    // Track position for removed line indicators
    let removedLinesBuffer: number[] = [];

    // Calculate decorations based on diff
    for (const change of changes) {
      // Count actual lines (handle trailing newline edge case)
      const lines = change.value.split('\n');
      const lineCount = change.value.endsWith('\n') ? lines.length - 1 : lines.length;

      if (change.added) {
        // Added lines - green background (these lines exist in the editor)
        for (let i = 0; i < lineCount; i++) {
          const targetLine = newLineNumber + i;
          if (targetLine <= model.getLineCount()) {
            decorations.push({
              range: new monaco.Range(targetLine, 1, targetLine, 1),
              options: {
                isWholeLine: true,
                className: "monaco-diff-added",
                glyphMarginClassName: "monaco-diff-added-glyph",
                overviewRuler: {
                  color: "#22c55e",
                  position: monaco.editor.OverviewRulerLane.Left,
                },
              },
            });
          }
        }
        // Flush any pending removed lines indicator at this position
        if (removedLinesBuffer.length > 0) {
          const removedCount = removedLinesBuffer.reduce((a, b) => a + b, 0);
          if (newLineNumber <= model.getLineCount()) {
            decorations.push({
              range: new monaco.Range(newLineNumber, 1, newLineNumber, 1),
              options: {
                isWholeLine: false,
                glyphMarginClassName: "monaco-diff-removed-glyph",
                overviewRuler: {
                  color: "#ef4444",
                  position: monaco.editor.OverviewRulerLane.Left,
                },
              },
            });
          }
          removedLinesBuffer = [];
        }
        newLineNumber += lineCount;
      } else if (change.removed) {
        // Removed lines - track for indicator (these lines don't exist in editor)
        removedLinesBuffer.push(lineCount);
      } else {
        // Unchanged lines - flush any removed indicator first
        if (removedLinesBuffer.length > 0) {
          const removedCount = removedLinesBuffer.reduce((a, b) => a + b, 0);
          if (newLineNumber <= model.getLineCount()) {
            decorations.push({
              range: new monaco.Range(newLineNumber, 1, newLineNumber, 1),
              options: {
                isWholeLine: false,
                glyphMarginClassName: "monaco-diff-removed-glyph",
                overviewRuler: {
                  color: "#ef4444",
                  position: monaco.editor.OverviewRulerLane.Left,
                },
              },
            });
          }
          removedLinesBuffer = [];
        }
        newLineNumber += lineCount;
      }
    }

    // Handle any remaining removed lines at the end
    if (removedLinesBuffer.length > 0) {
      const lastLine = Math.min(newLineNumber, model.getLineCount());
      if (lastLine >= 1) {
        decorations.push({
          range: new monaco.Range(lastLine, 1, lastLine, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: "monaco-diff-removed-glyph",
            overviewRuler: {
              color: "#ef4444",
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        });
      }
    }

    // Apply decorations
    decorationsRef.current = editor.deltaDecorations(
      [],
      decorations.map((d) => ({
        range: d.range,
        options: d.options,
      }))
    );

    // Add content widget for accept/reject buttons at the top of the editor
    const widget: monaco.editor.IContentWidget = {
      getId: () => `claude-diff-widget-${cellIndex}`,
      getDomNode: () => {
        const container = document.createElement("div");
        container.className = "diff-widget-overlay";

        const keepBtn = document.createElement("button");
        keepBtn.className = "diff-widget-btn accept";
        keepBtn.innerHTML = `<span>Keep</span> <kbd>Cmd+Y</kbd>`;
        keepBtn.onclick = () => onApply(pendingEdit.id);

        const undoBtn = document.createElement("button");
        undoBtn.className = "diff-widget-btn reject";
        undoBtn.innerHTML = `<span>Undo</span> <kbd>Cmd+N</kbd>`;
        undoBtn.onclick = () => onReject(pendingEdit.id);

        container.appendChild(keepBtn);
        container.appendChild(undoBtn);

        return container;
      },
      getPosition: () => ({
        position: { lineNumber: 1, column: 1 },
        preference: [
          monaco.editor.ContentWidgetPositionPreference.ABOVE,
          monaco.editor.ContentWidgetPositionPreference.BELOW,
        ],
      }),
    };

    editor.addContentWidget(widget);
    widgetRef.current = widget;

    // Add keyboard shortcuts
    const acceptCommand = editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY,
      () => onApply(pendingEdit.id)
    );
    const rejectCommand = editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN,
      () => onReject(pendingEdit.id)
    );

    // Note: addCommand returns a command ID (string), not disposable
    // We'll track via decoration cleanup instead
  }, [editor, pendingEdit, cellIndex, onApply, onReject, clearDecorations]);

  // Effect to apply/update decorations when edit changes
  useEffect(() => {
    applyDiffDecorations();

    return () => {
      clearDecorations();
    };
  }, [applyDiffDecorations, clearDecorations]);

  // Return whether there's an active diff
  return {
    hasDiff: pendingEdit?.status === "pending",
    clearDecorations,
  };
}

/**
 * Utility function to compute unified diff for display
 */
export function computeUnifiedDiff(
  originalCode: string,
  newCode: string
): { type: "added" | "removed" | "unchanged"; content: string }[] {
  const changes = Diff.diffLines(originalCode, newCode);
  const result: { type: "added" | "removed" | "unchanged"; content: string }[] =
    [];

  for (const change of changes) {
    const lines = change.value.split("\n").filter((l) => l !== "");

    for (const line of lines) {
      if (change.added) {
        result.push({ type: "added", content: line });
      } else if (change.removed) {
        result.push({ type: "removed", content: line });
      } else {
        result.push({ type: "unchanged", content: line });
      }
    }
  }

  return result;
}
