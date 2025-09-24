'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Cell as CellComponent } from './Cell';
import { Cell, ExecutionResult } from '@/types/notebook';
import { WebSocketService } from '@/lib/websocket-native';

interface NotebookProps {
  notebookName?: string;
}

export const Notebook: React.FC<NotebookProps> = ({ notebookName = 'default' }) => {
  const [cells, setCells] = useState<Cell[]>([]);
  const [currentCellIndex, setCurrentCellIndex] = useState<number | null>(null);
  const [executingCells, setExecutingCells] = useState<Set<number>>(new Set());
  const [kernelStatus, setKernelStatus] = useState<'idle' | 'busy' | 'disconnected'>('disconnected');
  
  const wsRef = useRef<WebSocketService>();

  useEffect(() => {
    // Initialize WebSocket connection
    wsRef.current = new WebSocketService();
    
    wsRef.current.connect().then(() => {
      wsRef.current?.loadNotebook(notebookName);
    }).catch(error => {
      console.error('Failed to connect:', error);
    });

    // Set up event listeners
    wsRef.current.on('notebook_loaded', handleNotebookLoaded);
    wsRef.current.on('cell_added', handleCellAdded);
    wsRef.current.on('cell_deleted', handleCellDeleted);
    wsRef.current.on('cell_updated', handleCellUpdated);
    wsRef.current.on('execution_result', handleExecutionResult);
    wsRef.current.on('kernel_status', handleKernelStatus);

    return () => {
      wsRef.current?.disconnect();
    };
  }, [notebookName]);

  const handleNotebookLoaded = (data: any) => {
    if (data.cells) {
      setCells(data.cells.map((cell: any, index: number) => ({
        ...cell,
        id: cell.id || `cell-${index}`,
        outputs: cell.outputs || []
      })));
    }
  };

  const handleCellAdded = (data: any) => {
    setCells(prev => {
      const newCells = [...prev];
      newCells.splice(data.index, 0, {
        id: `cell-${Date.now()}`,
        cell_type: data.cell_type,
        source: data.source || '',
        outputs: [],
      });
      return newCells;
    });
  };

  const handleCellDeleted = (data: any) => {
    setCells(prev => prev.filter((_, index) => index !== data.cell_index));
    setExecutingCells(prev => {
      const next = new Set(prev);
      next.delete(data.cell_index);
      return next;
    });
  };

  const handleCellUpdated = (data: any) => {
    setCells(prev => prev.map((cell, index) => 
      index === data.cell_index ? { ...cell, source: data.source } : cell
    ));
  };

  const handleExecutionResult = (data: ExecutionResult) => {
    const { cell_index, result } = data;
    
    setCells(prev => prev.map((cell, index) => {
      if (index === cell_index) {
        return {
          ...cell,
          outputs: result.outputs || [],
          execution_count: result.execution_count,
        };
      }
      return cell;
    }));

    setExecutingCells(prev => {
      const next = new Set(prev);
      next.delete(cell_index);
      return next;
    });
  };

  const handleKernelStatus = (data: any) => {
    setKernelStatus(data.status);
    const statusDot = document.getElementById('kernel-status-dot');
    const statusText = document.getElementById('kernel-status-text');
    if (statusDot && statusText) {
        statusDot.className = 'status-dot';
        if (data.status === 'busy') {
            statusDot.classList.add('connecting');
            statusText.textContent = 'Kernel Busy';
        } else if (data.status === 'idle') {
            statusDot.classList.add('connected');
            statusText.textContent = 'Kernel Ready';
        } else {
            statusDot.classList.add('disconnected');
            statusText.textContent = 'Kernel Disconnected';
        }
    }
  };

  const executeCell = (index: number) => {
    if (executingCells.has(index)) {
      // If executing, interrupt
      wsRef.current?.interruptKernel();
    } else {
      // Clear outputs before executing
      setCells(prev => prev.map((cell, i) => 
        i === index ? { ...cell, outputs: [] } : cell
      ));
      
      setExecutingCells(prev => new Set(prev).add(index));
      const cell = cells[index];
      wsRef.current?.executeCell(index, cell.source);
    }
  };

  const deleteCell = (index: number) => {
    wsRef.current?.deleteCell(index);
  };

  const updateCell = (index: number, source: string) => {
    wsRef.current?.updateCell(index, source);
  };

  const addCell = (type: 'code' | 'markdown' = 'code', index: number) => {
    wsRef.current?.addCell(index, type);
    setCurrentCellIndex(index);
  };

  const resetKernel = () => {
    if (confirm('Are you sure you want to restart the kernel? All variables will be lost.')) {
      wsRef.current?.resetKernel();
      // Clear all outputs
      setCells(prev => prev.map(cell => ({ ...cell, outputs: [], execution_count: undefined })));
      setExecutingCells(new Set());
    }
  };

  const saveNotebook = () => {
    wsRef.current?.saveNotebook();
  };

  return (
    <>
      {cells.map((cell, index) => (
        <CellComponent
          key={cell.id}
          cell={cell}
          index={index}
          isActive={currentCellIndex === index}
          isExecuting={executingCells.has(index)}
          onExecute={executeCell}
          onDelete={deleteCell}
          onUpdate={updateCell}
          onSetActive={setCurrentCellIndex}
          onAddCell={addCell}
        />
      ))}
      
      {cells.length === 0 && (
        <div id="empty-state" className="empty-state">
            <div className="add-cell-line" data-position="0">
                <div className="add-cell-button" onClick={() => addCell('code', 0)}>
                    <img src="/assets/icons/add.svg" alt="Add cell" />
                    <div className="cell-type-menu">
                        <button type="button" className="cell-type-option" data-type="code" onClick={(e) => { e.stopPropagation(); addCell('code', 0); }}>Code</button>
                        <button type="button" className="cell-type-option" data-type="markdown" onClick={(e) => { e.stopPropagation(); addCell('markdown', 0); }}>Text</button>
                    </div>
                </div>
            </div>
        </div>
      )}
    </>
  );
};