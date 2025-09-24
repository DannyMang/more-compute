'use client';

import React from 'react';
import { Output } from '@/types/notebook';
import { ErrorDisplay } from './ErrorDisplay';

interface CellOutputProps {
  outputs: Output[];
  visible: boolean;
}

export const CellOutput: React.FC<CellOutputProps> = ({ outputs, visible }) => {
  if (!visible || !outputs || outputs.length === 0) {
    return null;
  }

  return (
    <div className="cell-output" style={{ display: 'block' }}>
      <div className="output-content">
        {outputs.map((output, idx) => (
          <OutputElement key={idx} output={output} />
        ))}
      </div>
    </div>
  );
};

const OutputElement: React.FC<{ output: Output }> = ({ output }) => {
  switch (output.output_type) {
    case 'stream':
      return (
        <div className={`output-stream ${output.name}`}>
          {output.text}
        </div>
      );
    
    case 'execute_result':
      return (
        <div className="output-result">
          {output.data?.['text/plain'] || ''}
        </div>
      );
    
    case 'error':
      return <ErrorDisplay error={output} />;
    
    default:
      return (
        <div className="output-stream">
          {JSON.stringify(output)}
        </div>
      );
  }
};