'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Cell as CellType } from '@/types/notebook';
import CellOutput from './CellOutput';
import AddCellButton from './AddCellButton';
import MarkdownRenderer from './MarkdownRenderer';
import { Check, X, Trash2, Play, StopCircle, MoveVertical } from 'lucide-react';

declare const CodeMirror: any;

interface CellProps {
  cell: CellType;
  index: number;
  isActive: boolean;
  isExecuting: boolean;
  onExecute: (index: number) => void;
  onDelete: (index: number) => void;
  onUpdate: (index: number, source: string) => void;
  onSetActive: (index: number) => void;
  onAddCell: (type: 'code' | 'markdown', index: number) => void;
}

export const Cell: React.FC<CellProps> = ({
  cell,
  index,
  isActive,
  isExecuting,
  onExecute,
  onDelete,
  onUpdate,
  onSetActive,
  onAddCell,
}) => {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const codeMirrorInstance = useRef<any>(null);
  // Keep a ref to the latest index to avoid stale closures in event handlers
  const indexRef = useRef<number>(index);
  useEffect(() => { indexRef.current = index; }, [index]);
  const [isEditing, setIsEditing] = useState(() => cell.cell_type === 'code' || !cell.source?.trim());

  useEffect(() => {
    if (isEditing) {
      if (!codeMirrorInstance.current && editorRef.current && typeof CodeMirror !== 'undefined') {
        const editor = CodeMirror.fromTextArea(editorRef.current, {
          mode: cell.cell_type === 'code' ? 'python' : 'text/plain',
          lineNumbers: cell.cell_type === 'code',
          theme: 'default',
          lineWrapping: true,
          placeholder: cell.cell_type === 'code' ? 'Enter code...' : 'Enter markdown...',
        });
        codeMirrorInstance.current = editor;

        editor.on('change', (instance: any) => onUpdate(indexRef.current, instance.getValue()));
        editor.on('focus', () => onSetActive(indexRef.current));
        editor.on('blur', () => {
          if (cell.cell_type === 'markdown') setIsEditing(false);
        });
        editor.on('keydown', (instance: any, event: KeyboardEvent) => {
          if (event.shiftKey && event.key === 'Enter') {
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

  const handleExecute = () => {
    if (cell.cell_type === 'markdown') {
      setIsEditing(false);
    } else {
      onExecute(indexRef.current);
    }
  };

  const handleCellClick = () => {
    onSetActive(indexRef.current);
    if (cell.cell_type === 'markdown') {
      setIsEditing(true);
    }
  };

  return (
    <div className="cell-wrapper">
      <div className="cell-status-indicator">
        {cell.error ? (
          <X size={14} color="#dc2626" />
        ) : cell.execution_count ? (
          <Check size={14} color="#16a34a" />
        ) : (
          <div className="status-placeholder" />
        )}
      </div>
      <div className="add-cell-line add-line-above">
        <AddCellButton onAddCell={(type) => onAddCell(type, indexRef.current)} />
      </div>

      <div
        className={`cell ${isActive ? 'active' : ''} ${isExecuting ? 'executing' : ''}`}
        data-cell-index={index}
      >
        <div className="cell-hover-controls">
          <div className="cell-actions-right">
            <button type="button" className="cell-action run-cell-btn" title="Run cell" onClick={(e) => { e.stopPropagation(); handleExecute(); }}>
              {isExecuting ? <StopCircle size={14} /> : <Play size={14} />}
            </button>
            <button type="button" className="cell-action drag-handle" title="Drag to reorder">
              <MoveVertical size={14} />
            </button>
            <button type="button" className="cell-action delete-cell-btn" title="Delete cell" onClick={(e) => { e.stopPropagation(); onDelete(indexRef.current); }}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="cell-content" onClick={handleCellClick}>
          <div className="cell-input">
            {isEditing || cell.cell_type === 'code' ? (
              <div className="cell-editor-container">
                <textarea ref={editorRef} defaultValue={cell.source} className="cell-editor" />
              </div>
            ) : (
              <MarkdownRenderer source={cell.source} onClick={() => setIsEditing(true)} />
            )}
          </div>
          <CellOutput outputs={cell.outputs} error={cell.error} />
        </div>
        
        {/* Execution Indicator and Status */}
      </div>

      <div className="add-cell-line add-line-below">
        <AddCellButton onAddCell={(type) => onAddCell(type, indexRef.current + 1)} />
      </div>
    </div>
  );
};