"use client";

import React from "react";

interface MarkdownRendererProps {
  source: string;
  onClick?: () => void;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  source,
  onClick,
}) => {
  if (!source || !source.trim()) {
    return (
      <div
        className="markdown-rendered markdown-empty"
        onClick={onClick}
        style={{
          minHeight: "2.5rem",
          padding: "0.5rem",
          color: "#9ca3af",
          fontStyle: "italic",
          cursor: "pointer",
        }}
      ></div>
    );
  }

  const escapeHtml = (text: string) => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };

  const renderMarkdown = (text: string) => {
    let html = text;

    // Code blocks (must be processed first)
    html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
      return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
    });

    // Language-specific code blocks
    html = html.replace(/```(\w+)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`;
    });

    // Headers
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

    // Bold and Italic
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // Strikethrough
    html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    // Links
    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );

    // Unordered lists
    html = html.replace(
      /^\s*[-*+] (.+)$/gim,
      (match, item) => `<li>${item}</li>`,
    );
    html = html
      .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
      .replace(/<\/ul>\s*<ul>/g, "");

    // Ordered lists
    html = html
      .replace(
        /^\s*\d+\. (.+)$/gim,
        (match, item) => `<ol><li>${item}</li></ol>`,
      )
      .replace(/<\/ol>\s*<ol>/g, "");

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Blockquotes
    html = html.replace(/^> (.+)$/gim, "<blockquote>$1</blockquote>");

    // Handle HTML br tags first - convert them to proper line breaks
    html = html.replace(/<br\s*\/?>/gi, "\n");

    // Line breaks and paragraphs - handle paragraph separation properly
    // Split by double newlines to create paragraphs, but preserve single line breaks within paragraphs
    html = html.replace(/\n\s*\n/g, "</p><p>"); // Paragraph breaks (double newlines with optional whitespace)
    html = html.replace(/\n(?!<\/p>)/g, "<br>"); // Line breaks within paragraphs (but not paragraph breaks)

    // Ensure content is wrapped in paragraph tags if not already in a block element
    if (!html.match(/^<(h[1-6]|ul|ol|pre|blockquote|hr|p)/) && html.trim()) {
      html = "<p>" + html + "</p>";
    }

    return html;
  };

  return (
    <div
      className="markdown-rendered"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
    />
  );
};

export default MarkdownRenderer;
