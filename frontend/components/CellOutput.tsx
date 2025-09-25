'use client';

import { FC } from 'react';
import { Output } from '@/types/notebook';
import ErrorDisplay from './ErrorDisplay';

interface CellOutputProps {
  outputs: Output[];
  error: any;
}

const CellOutput: FC<CellOutputProps> = ({ outputs, error }) => {
  if (error) {
    return <ErrorDisplay error={error} />;
  }

  if (!outputs || outputs.length === 0) {
    return null;
  }

  return (
    <div className="cell-output">
      <div className="output-content">
        {outputs.map((output, index) => {
          switch (output.output_type) {
            case 'stream':
              return (
                <pre key={index} className={`output-stream ${output.name}`}>
                  {output.text}
                </pre>
              );
            case 'execute_result':
              return (
                <pre key={index} className="output-result">
                  {output.data?.['text/plain']}
                </pre>
              );
            case 'error':
              return <ErrorDisplay key={index} error={output} />;
            default:
              return (
                <pre key={index} className="output-unknown">
                  {JSON.stringify(output, null, 2)}
                </pre>
              );
          }
        })}
      </div>
    </div>
  );
};

export default CellOutput;