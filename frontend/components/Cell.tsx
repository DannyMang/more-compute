'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Cell as CellType } from '@/types/notebook';
import { CellOutput } from './CellOutput';

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

  useEffect(() => {
    if (editorRef.current && typeof CodeMirror !== 'undefined') {
      if (!codeMirrorInstance.current) {
        const editor = CodeMirror.fromTextArea(editorRef.current, {
          mode: cell.cell_type === 'code' ? 'python' : 'text/plain',
          lineNumbers: cell.cell_type === 'code',
          theme: 'default',
          autoCloseBrackets: cell.cell_type === 'code',
          matchBrackets: cell.cell_type === 'code',
          indentUnit: 4,
          lineWrapping: true,
          viewportMargin: 10,
          placeholder: cell.cell_type === 'code' ? 'Enter your code here...' : 'Enter markdown text here...',
        });
        codeMirrorInstance.current = editor;

        editor.on('change', (instance: any) => {
          onUpdate(index, instance.getValue());
        });

        editor.on('focus', () => {
          onSetActive(index);
        });

        editor.on('keydown', (instance: any, event: KeyboardEvent) => {
            if (event.shiftKey && event.key === 'Enter') {
                event.preventDefault();
                onExecute(index);
            }
        });
      } else {
        codeMirrorInstance.current.setOption('mode', cell.cell_type === 'code' ? 'python' : 'text/plain');
      }

      if (codeMirrorInstance.current.getValue() !== cell.source) {
          codeMirrorInstance.current.setValue(cell.source);
      }
    }
  }, [cell.cell_type, cell.source, onUpdate, index, onSetActive, onExecute]);

  const [executionTime, setExecutionTime] = useState<string>('');
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (isExecuting) {
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        setExecutionTime(`${(elapsed / 1000).toFixed(1)}s`);
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isExecuting]);

  return (
    <div className="cell-wrapper">
        <div className="add-cell-line add-line-above" data-position="above">
            <div className="add-cell-button" onClick={() => onAddCell('code', index)}>
                <img src="/assets/icons/add.svg" alt="Add cell" />
                <div className="cell-type-menu">
                    <button type="button" className="cell-type-option" data-type="code" onClick={(e) => { e.stopPropagation(); onAddCell('code', index); }}>Code</button>
                    <button type="button" className="cell-type-option" data-type="markdown" onClick={(e) => { e.stopPropagation(); onAddCell('markdown', index); }}>Text</button>
                </div>
            </div>
        </div>

        <div 
            className={`cell ${isActive ? 'active' : ''} ${isExecuting ? 'executing' : ''}`}
            data-cell-index={index}
            onClick={() => onSetActive(index)}
        >
            <div className="cell-hover-controls">
                <div className="cell-actions-right">
                    <button type="button" className="cell-action run-cell-btn" title="Run cell (Shift+Enter)" onClick={(e) => { e.stopPropagation(); onExecute(index); }}>
                        <img src={`/assets/icons/${isExecuting ? 'stop' : 'play'}.svg`} alt="Run" />
                    </button>
                    <button type="button" className="cell-action drag-handle" title="Drag to reorder">
                        <img src="/assets/icons/up-down.svg" alt="Drag" />
                    </button>
                    <button type="button" className="cell-action delete-cell-btn" title="Delete cell" onClick={(e) => { e.stopPropagation(); onDelete(index); }}>
                        <img src="/assets/icons/trash.svg" alt="Delete" />
                    </button>
                </div>
            </div>
            
            <div className="cell-content">
                <div className="cell-input">
                    <div className="cell-editor-container">
                        <textarea ref={editorRef} defaultValue={cell.source}></textarea>
                    </div>
                </div>
                <CellOutput 
                    outputs={cell.outputs} 
                    visible={cell.outputs && cell.outputs.length > 0}
                />
            </div>
            
            <div className="execution-indicator">
                <span className="execution-count">[{cell.execution_count || ' '}]</span>
                {isExecuting && <span className="execution-time">{executionTime}</span>}
            </div>

            {cell.outputs?.some(o => o.output_type === 'error') && !isExecuting &&
                <div className="execution-status">
                    <img className="status-icon" src="/assets/icons/x.svg" alt="Status" />
                </div>
            }
             {cell.execution_count && !isExecuting && !cell.outputs?.some(o => o.output_type === 'error') &&
                <div className="execution-status">
                    <img className="status-icon" src="/assets/icons/check.svg" alt="Status" />
                </div>
            }
        </div>
        
        <div className="add-cell-line add-line-below" data-position="below">
            <div className="add-cell-button" onClick={() => onAddCell('code', index + 1)}>
                <img src="/assets/icons/add.svg" alt="Add cell" />
                <div className="cell-type-menu">
                    <button type="button" className="cell-type-option" data-type="code" onClick={(e) => { e.stopPropagation(); onAddCell('code', index + 1); }}>Code</button>
                    <button type="button" className="cell-type-option" data-type="markdown" onClick={(e) => { e.stopPropagation(); onAddCell('markdown', index + 1); }}>Text</button>
                </div>
            </div>
        </div>
    </div>
  );
};