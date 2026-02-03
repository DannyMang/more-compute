"use client";

import React, { useState, useRef, useEffect } from "react";
import { useClaude } from "@/contexts/ClaudeContext";
import {
  X,
  Send,
  Trash2,
  Sparkles,
  Check,
  XCircle,
  Key,
  Copy,
  CheckCheck,
} from "lucide-react";
import type { ClaudeMessage, ProposedEdit, ClaudeModel } from "@/types/claude";

// Simple markdown renderer for Claude messages
const renderMarkdown = (text: string): string => {
  let html = text;

  // Escape HTML first (but preserve our markdown)
  const escapeHtml = (str: string) => {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };

  // Extract and preserve code blocks first
  const codeBlocks: string[] = [];
  // Pattern matches ```language\n or ```edit:N\n (any non-newline chars for identifier)
  html = html.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const index = codeBlocks.length;
    const trimmedLang = lang.trim();
    const langClass = trimmedLang
      ? ` class="language-${trimmedLang.replace(/[^a-zA-Z0-9_-]/g, "-")}"`
      : "";
    // Display "edit" for edit blocks, otherwise show the language
    const displayLang = trimmedLang.startsWith("edit:")
      ? `edit (cell ${trimmedLang.split(":")[1]})`
      : trimmedLang || "code";
    codeBlocks.push(
      `<div class="claude-code-block"><div class="claude-code-header"><span class="claude-code-lang">${escapeHtml(displayLang)}</span></div><pre><code${langClass}>${escapeHtml(code.trim())}</code></pre></div>`,
    );
    return `__CODE_BLOCK_${index}__`;
  });

  // Simple code blocks without language
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(
      `<div class="claude-code-block"><pre><code>${escapeHtml(code.trim())}</code></pre></div>`,
    );
    return `__CODE_BLOCK_${index}__`;
  });

  // Headers
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

  // Bold and Italic
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Inline code
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="claude-inline-code">$1</code>',
  );

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // Lists - unordered
  html = html.replace(/^[\s]*[-*] (.+)$/gim, "<li>$1</li>");

  // Lists - ordered
  html = html.replace(/^[\s]*\d+\. (.+)$/gim, "<li>$1</li>");

  // Wrap consecutive li elements in ul/ol
  html = html.replace(/(<li>[\s\S]*?<\/li>)+/g, (match) => `<ul>${match}</ul>`);

  // Line breaks - double newline = paragraph, single = br
  html = html.replace(/\n\n+/g, "</p><p>");
  html = html.replace(/\n/g, "<br>");

  // Wrap in paragraph if needed
  if (!html.startsWith("<") && html.trim()) {
    html = "<p>" + html + "</p>";
  }

  // Restore code blocks
  codeBlocks.forEach((block, index) => {
    html = html.replace(`__CODE_BLOCK_${index}__`, block);
  });

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p><br><\/p>/g, "");

  return html;
};

// Model selector component
interface ModelSelectorProps {
  model: ClaudeModel;
  onChange: (model: ClaudeModel) => void;
}

const MODEL_OPTIONS: { value: ClaudeModel; label: string }[] = [
  { value: "haiku", label: "Haiku 4" },
  { value: "sonnet", label: "Sonnet 4" },
  { value: "opus", label: "Opus 4.5" },
];

const ModelSelector: React.FC<ModelSelectorProps> = ({ model, onChange }) => {
  return (
    <div className="claude-model-selector">
      {MODEL_OPTIONS.map((option) => (
        <button
          key={option.value}
          className={`claude-model-option ${model === option.value ? "active" : ""}`}
          onClick={() => onChange(option.value)}
          title={
            option.value === "haiku"
              ? "Fast & cheap"
              : option.value === "opus"
                ? "Most capable"
                : "Balanced"
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

const ClaudePanel: React.FC = () => {
  const {
    messages,
    isPanelOpen,
    isLoading,
    isConfigured,
    error,
    model,
    sendMessage,
    applyEdit,
    rejectEdit,
    closePanel,
    clearHistory,
    setApiKey,
    setModel,
  } = useClaude();

  const [inputValue, setInputValue] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSettingKey, setIsSettingKey] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isPanelOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isPanelOpen]);

  const handleSend = () => {
    if (!inputValue.trim() || isLoading) return;
    sendMessage(inputValue);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSetApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setIsSettingKey(true);
    const success = await setApiKey(apiKeyInput);
    if (success) {
      setApiKeyInput("");
    }
    setIsSettingKey(false);
  };

  if (!isPanelOpen) return null;

  return (
    <div className="claude-panel">
      {/* Header */}
      <div className="claude-panel-header">
        <div className="claude-panel-title">
          <Sparkles size={16} />
          <span>Claude</span>
        </div>
        <div className="claude-panel-actions">
          <button
            className="claude-panel-btn"
            onClick={clearHistory}
            title="Clear history"
          >
            <Trash2 size={14} />
          </button>
          <button
            className="claude-panel-btn"
            onClick={closePanel}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="claude-error-banner">
          <XCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Messages */}
      <div className="claude-messages">
        {messages.length === 0 ? (
          <div className="claude-empty-state">
            <Sparkles size={24} />
            <p>Ask Claude to help with your code</p>
            <p className="claude-empty-hint">this is a work in progress</p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onApplyEdit={applyEdit}
              onRejectEdit={rejectEdit}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* API Key Config */}
      {!isConfigured && (
        <div className="claude-config-banner">
          <div className="claude-config-title">
            <Key size={14} />
            <span>Configure your Claude API key to get started</span>
          </div>
          <div className="claude-config-form">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="sk-ant-..."
              className="claude-config-input"
              onKeyDown={(e) => e.key === "Enter" && handleSetApiKey()}
            />
            <button
              onClick={handleSetApiKey}
              disabled={isSettingKey || !apiKeyInput.trim()}
              className="claude-config-btn"
            >
              {isSettingKey ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="claude-input-container">
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isConfigured ? "Ask Claude..." : "Configure API key above"
          }
          disabled={!isConfigured || isLoading}
          className="claude-input"
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={!isConfigured || isLoading || !inputValue.trim()}
          className="claude-send-btn"
        >
          {isLoading ? (
            <div className="claude-loading-spinner" />
          ) : (
            <Send size={16} />
          )}
        </button>
      </div>

      {/* Model Selector */}
      <div className="claude-model-row">
        <span className="claude-model-label">Model:</span>
        <ModelSelector model={model} onChange={setModel} />
      </div>
    </div>
  );
};

interface MessageBubbleProps {
  message: ClaudeMessage;
  onApplyEdit: (editId: string) => void;
  onRejectEdit: (editId: string) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  onApplyEdit,
  onRejectEdit,
}) => {
  const isUser = message.role === "user";

  // Format the message content, removing edit blocks for display
  const formatContent = (content: string) => {
    // Remove edit blocks from display
    return content.replace(/```edit:\d+\n[\s\S]*?```/g, "").trim();
  };

  const formattedContent = formatContent(message.content);

  return (
    <div className={`claude-message ${isUser ? "user" : "assistant"}`}>
      <div className="claude-message-content">
        {message.isStreaming ? (
          <div className="claude-streaming">
            <div
              className="claude-message-text"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(formattedContent) || "Thinking...",
              }}
            />
            <span className="claude-cursor">|</span>
          </div>
        ) : (
          <>
            {isUser ? (
              <div className="claude-message-text">{formattedContent}</div>
            ) : (
              <div
                className="claude-message-text claude-markdown"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(formattedContent),
                }}
              />
            )}
            {/* Proposed Edits */}
            {message.proposedEdits && message.proposedEdits.length > 0 && (
              <div className="claude-edits">
                {message.proposedEdits.map((edit) => (
                  <EditCard
                    key={edit.id}
                    edit={edit}
                    onApply={() => onApplyEdit(edit.id)}
                    onReject={() => onRejectEdit(edit.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

interface EditCardProps {
  edit: ProposedEdit;
  onApply: () => void;
  onReject: () => void;
}

const EditCard: React.FC<EditCardProps> = ({ edit, onApply, onReject }) => {
  const [copied, setCopied] = useState(false);
  const isPending = edit.status === "pending";
  const isApplied = edit.status === "applied";
  const isRejected = edit.status === "rejected";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(edit.newCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`claude-edit-card ${isApplied ? "applied" : ""} ${isRejected ? "rejected" : ""}`}
    >
      <div className="claude-edit-header">
        <span className="claude-edit-cell">Cell {edit.cellIndex}</span>
        <div className="claude-edit-actions">
          <button
            className="claude-edit-btn copy"
            onClick={handleCopy}
            title="Copy code"
          >
            {copied ? <CheckCheck size={12} /> : <Copy size={12} />}
          </button>
          {isPending && (
            <>
              <button
                className="claude-edit-btn accept"
                onClick={onApply}
                title="Apply edit"
              >
                <Check size={12} />
                Apply
              </button>
              <button
                className="claude-edit-btn reject"
                onClick={onReject}
                title="Reject edit"
              >
                <X size={12} />
                Reject
              </button>
            </>
          )}
        </div>
        {isApplied && (
          <span className="claude-edit-status applied">Applied</span>
        )}
        {isRejected && (
          <span className="claude-edit-status rejected">Rejected</span>
        )}
      </div>
      {edit.explanation && (
        <div className="claude-edit-explanation">{edit.explanation}</div>
      )}
      <div className="claude-edit-preview">
        <pre className="claude-edit-code">
          <code>{edit.newCode}</code>
        </pre>
      </div>
    </div>
  );
};

export default ClaudePanel;
