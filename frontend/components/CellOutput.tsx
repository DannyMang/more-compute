'use client';

import { FC } from 'react';
import { Output } from '@/types/notebook';
import ErrorDisplay from './ErrorDisplay';

interface CellOutputProps {
  outputs: Output[];
  error: any;
  onFixIndentation?: () => void;
}

const CellOutput: FC<CellOutputProps> = ({ outputs, error, onFixIndentation }) => {
  if (error) {
    return <ErrorDisplay error={error} onFixIndentation={onFixIndentation} />;
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
            case 'display_data': {
              const img = (output as any).data?.['image/png'];
              const alt = (output as any).data?.['text/plain'] || 'image/png';
              if (img) {
                return (
                  <div key={index} className="output-result">
                    <img src={`data:image/png;base64,${img}`} alt={alt} />
                  </div>
                );
              }
              return (
                <pre key={index} className="output-result">
                  {(output as any).data?.['text/plain']}
                </pre>
              );
            }
            case 'error':
              return <ErrorDisplay key={index} error={output} onFixIndentation={onFixIndentation} />;
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