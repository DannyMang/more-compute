'use client';

import { FC, useState } from 'react';
import { Output } from '@/types/notebook';
import ErrorDisplay from './ErrorDisplay';
import { Copy, Check } from 'lucide-react';

interface CellOutputProps {
  outputs: Output[];
  error: any;
}

interface OutputWithCopyProps {
  content: string;
  className: string;
}

const OutputWithCopy: FC<OutputWithCopyProps> = ({ content, className }) => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(content).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Copy Button */}
      <button
        onClick={copyToClipboard}
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          zIndex: 10,
          background: 'var(--mc-cell-background)',
          border: '1px solid var(--mc-border)',
          borderRadius: '4px',
          padding: '6px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--mc-secondary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--mc-cell-background)';
        }}
        title="Copy output to clipboard"
      >
        {isCopied ? <Check size={14} style={{ color: 'var(--mc-primary)' }} /> : <Copy size={14} />}
      </button>

      {/* Output Content */}
      <pre className={className}>{content}</pre>
    </div>
  );
};

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
                <OutputWithCopy
                  key={index}
                  content={output.text}
                  className={`output-stream ${output.name}`}
                />
              );
            case 'execute_result':
              return (
                <OutputWithCopy
                  key={index}
                  content={output.data?.['text/plain'] || ''}
                  className="output-result"
                />
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
                <OutputWithCopy
                  key={index}
                  content={(output as any).data?.['text/plain'] || ''}
                  className="output-result"
                />
              );
            }
            case 'error':
              return <ErrorDisplay key={index} error={output} />;
            default:
              return (
                <OutputWithCopy
                  key={index}
                  content={JSON.stringify(output, null, 2)}
                  className="output-unknown"
                />
              );
          }
        })}
      </div>
    </div>
  );
};

export default CellOutput;