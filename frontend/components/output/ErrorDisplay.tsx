'use client';

import React, { FC, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Output, ErrorOutput } from '@/types/notebook';

/*
 I would like custom error handling for most general errors

 imagine like user does not know pip is ran with !pip install, and just runs pip install,

 it would be nice just to have a custom error message pointing user to use !pip rather than just fail, etc
*/


interface ErrorDisplayProps {
  error: Output;
  maxLines?: number;
}

const TypedErrorDisplay: FC<{ error: ErrorOutput }> = ({ error }) => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = () => {
    const errorDetails = `Error: ${error.ename}: ${error.evalue}\n\nTraceback:\n${error.traceback.join('\n')}`;
    navigator.clipboard.writeText(errorDetails).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const getErrorIcon = (errorType?: string) => {
    switch (errorType) {
      case 'pip_error':
        return {
          text: 'Use !pip install instead of pip install',
          style: {
            background: '#fef3c7',
            color: '#d97706',
            border: '1px solid #fbbf24'
          }
        };
      case 'import_error':
        return {
          text: 'Import Error',
          style: {
            background: '#fee2e2',
            color: '#dc2626',
            border: '1px solid #f87171'
          }
        };
      case 'file_error':
        return {
          text: 'File Error',
          style: {
            background: '#fdf4ff',
            color: '#c026d3',
            border: '1px solid #e879f9'
          }
        };
      default:
        return {
          text: 'Error',
          style: {
            background: '#f3f4f6',
            color: '#6b7280',
            border: '1px solid #d1d5db'
          }
        };
    }
  };

  const indicator = getErrorIcon(error.error_type);

  return (
    <div className="error-output-container">
      {/* Error Type Indicator */}
      {error.error_type && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: '8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '0.3px',
            ...indicator.style
          }}
        >
          {indicator.text}
        </div>
      )}

      {/* Traceback Section */}
      <div
        style={{
          position: 'relative',
          background: '#fef2f2',
          border: '1px solid #fca5a5',
          borderRadius: '6px',
          marginTop: '8px'
        }}
      >
        {/* Action Buttons */}
        <div style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          zIndex: 10,
          display: 'flex',
          gap: '4px'
        }}>
          {/* Copy Button */}
          <button
            onClick={copyToClipboard}
            style={{
              background: 'rgba(255, 255, 255, 0.9)',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              padding: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease'
            }}
            title="Copy error to clipboard"
          >
            {isCopied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
          </button>
        </div>

        {/* Truncation Indicator */}
        {/* The original code had this, but the new TypedErrorDisplay doesn't have it.
            Assuming it's not needed for the new TypedErrorDisplay or that it's handled differently.
            For now, removing it as it's not in the new_code. */}
        {/*
        {isLimited && (
          <div
            style={{
              padding: '8px 12px',
              background: '#fee2e2',
              color: '#b91c1c',
              fontSize: '11px',
              borderBottom: '1px solid #fca5a5',
              fontStyle: 'italic'
            }}
          >
            ... (showing last {maxLines} lines of {tracebackLines.length} total lines - scroll up to see more)
          </div>
        )}
        */}

        {/* Error Content */}
        <div
          style={{
            padding: '12px',
            fontFamily: "'SF Mono', Monaco, Consolas, monospace",
            fontSize: '12px',
            lineHeight: 1.4,
            color: '#b91c1c',
            background: 'transparent',
            whiteSpace: 'pre-wrap',
            overflowX: 'auto',
            margin: 0
          }}
        >
          {/* Always show error name and message */}
          {error.ename && (
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
              {error.ename}: {error.evalue}
            </div>
          )}
          {/* Show traceback if available */}
          {error.traceback && error.traceback.length > 0 && (
            <div>{error.traceback.join('\n')}</div>
          )}
          {/* Fallback if no traceback */}
          {(!error.traceback || error.traceback.length === 0) && !error.ename && (
            <div>An unknown error occurred</div>
          )}
        </div>
      </div>
    </div>
  );
};

const ErrorDisplay: FC<ErrorDisplayProps> = ({ error }) => {
  // Type guard to ensure we have an ErrorOutput
  if (error.output_type !== 'error') {
    return null;
  }
  return <TypedErrorDisplay error={error} />;
};

export default ErrorDisplay;