'use client';

import React, { useState } from 'react';
import { Output } from '@/types/notebook';

interface ErrorDisplayProps {
  error: Output;
  maxLines?: number;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, maxLines = 20 }) => {
  const [copied, setCopied] = useState(false);

  const fullTraceback = error.traceback?.join('\n') || '';
  const tracebackLines = error.traceback || [];
  
  // Determine display content and truncation
  let displayContent: string;
  let isLimited = false;
  
  if (tracebackLines.length > maxLines) {
    const limitedLines = tracebackLines.slice(-maxLines);
    displayContent = limitedLines.join('\n');
    isLimited = true;
  } else {
    displayContent = fullTraceback;
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(fullTraceback);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = fullTraceback;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const getErrorTypeIndicator = () => {
    switch (error.error_type) {
      case 'pip_error':
        return {
          text: '📦 Use !pip install instead of pip install',
          style: {
            background: '#fef3c7',
            color: '#d97706',
            border: '1px solid #fbbf24'
          }
        };
      case 'import_error':
        return {
          text: '📥 Import Error',
          style: {
            background: '#fee2e2',
            color: '#dc2626',
            border: '1px solid #f87171'
          }
        };
      case 'file_error':
        return {
          text: '📁 File Error',
          style: {
            background: '#fdf4ff',
            color: '#c026d3',
            border: '1px solid #e879f9'
          }
        };
      default:
        return {
          text: '⚠️ Error',
          style: {
            background: '#f3f4f6',
            color: '#6b7280',
            border: '1px solid #d1d5db'
          }
        };
    }
  };

  const indicator = getErrorTypeIndicator();

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

      {/* Suggestions Panel */}
      {error.suggestions && error.suggestions.length > 0 && (
        <div
          style={{
            marginBottom: '12px',
            padding: '12px',
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: '6px'
          }}
        >
          <div
            style={{
              fontWeight: 600,
              color: '#0369a1',
              marginBottom: '8px',
              fontSize: '13px'
            }}
          >
            💡 Suggestions:
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: '16px',
              color: '#0c4a6e',
              fontSize: '12px',
              lineHeight: 1.5
            }}
          >
            {error.suggestions.map((suggestion, idx) => (
              <SuggestionItem key={idx} suggestion={suggestion} />
            ))}
          </ul>
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
        {/* Copy Button */}
        <button
          onClick={copyToClipboard}
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            zIndex: 10,
            background: 'rgba(255, 255, 255, 0.9)',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            padding: '6px',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          title="Copy error to clipboard"
        >
          {copied ? '✓' : '📋'}
        </button>

        {/* Truncation Indicator */}
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
          {displayContent}
        </div>
      </div>
    </div>
  );
};

const SuggestionItem: React.FC<{ suggestion: string }> = ({ suggestion }) => {
  // Check if suggestion contains code
  const hasCode = suggestion.includes('!pip') || suggestion.includes('python') || suggestion.includes('subprocess');
  
  if (hasCode) {
    const parts = suggestion.split(/(!pip[^\s]*|python[^\s]*|subprocess[^\s]*)/g);
    return (
      <li style={{ marginBottom: '4px' }}>
        {parts.map((part, idx) => {
          if (part.match(/!pip|python|subprocess/)) {
            return (
              <code
                key={idx}
                style={{
                  background: '#e0f2fe',
                  padding: '2px 4px',
                  borderRadius: '3px',
                  fontFamily: "'SF Mono', Monaco, monospace",
                  fontSize: '11px',
                  color: '#01579b'
                }}
              >
                {part}
              </code>
            );
          }
          return <span key={idx}>{part}</span>;
        })}
      </li>
    );
  }
  
  return <li style={{ marginBottom: '4px' }}>{suggestion}</li>;
};