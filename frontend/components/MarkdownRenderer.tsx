'use client';

import React from 'react';

interface MarkdownRendererProps {
  source: string;
  onClick?: () => void;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ source, onClick }) => {
  const escapeHtml = (text: string) => {
    const div = document.createElement('div');
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
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Bold and Italic
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Strikethrough
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Unordered lists
    html = html.replace(/^\s*[-*+] (.+)$/gim, (match, item) => `<li>${item}</li>`);
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>').replace(/<\/ul>\s*<ul>/g, '');

    // Ordered lists
    html = html.replace(/^\s*\d+\. (.+)$/gim, (match, item) => `<ol><li>${item}</li></ol>`).replace(/<\/ol>\s*<ol>/g, '');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Blockquotes
    html = html.replace(/^> (.+)$/gim, '<blockquote>$1</blockquote>');
    
    // Line breaks and paragraphs
    html = html.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>');
    if (!html.match(/^<(h[1-6]|ul|ol|pre|blockquote|hr|p)/)) {
        html = '<p>' + html + '</p>';
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
