/**
 * Error Handling Utilities for MoreCompute Notebook
 * Functions for creating and managing error outputs
 */

class ErrorUtils {
  /**
   * Create an enhanced error output with copy functionality
   * @param {Object} errorData - Error data object
   * @param {Object} options - Options for error display
   * @returns {HTMLElement}
   */
  static createErrorOutput(errorData, options = {}) {
    const {
      maxLines = 20,
      showCopyButton = true
    } = options;
    
    // Create container
    const container = DOMUtils.createContainer({
      className: 'error-output-container',
      styles: StyleUtils.errorStyles.container
    });
    
    // Add error type indicator for enhanced errors
    if (errorData.error_type) {
      this.addErrorTypeIndicator(container, errorData);
    }
    
    // Add suggestions if available
    if (errorData.suggestions && errorData.suggestions.length > 0) {
      this.addSuggestions(container, errorData.suggestions);
    }
    
    // Get full traceback
    const fullTraceback = errorData.traceback.join('\n');
    const tracebackLines = errorData.traceback;
    
    // Determine display content and truncation
    let displayContent;
    let isLimited = false;
    if (tracebackLines.length > maxLines) {
      const limitedLines = tracebackLines.slice(-maxLines);
      displayContent = limitedLines.join('\n');
      isLimited = true;
    } else {
      displayContent = fullTraceback;
    }
    
    // Create traceback section container with copy button
    const tracebackSection = document.createElement('div');
    tracebackSection.style.cssText = `
      position: relative;
      background: #fef2f2;
      border: 1px solid #fca5a5;
      border-radius: 6px;
      margin-top: 8px;
    `;
    
    // Add copy button to traceback section if requested
    if (showCopyButton) {
      const copyButton = this.createCopyButton(fullTraceback);
      // Override only positioning styles while preserving original functionality
      copyButton.style.position = 'absolute';
      copyButton.style.top = '8px';
      copyButton.style.right = '8px';
      copyButton.style.zIndex = '10';
      copyButton.style.background = 'rgba(255, 255, 255, 0.9)';
      copyButton.style.border = '1px solid #d1d5db';
      tracebackSection.appendChild(copyButton);
    }
    
    // Add truncation indicator if needed
    if (isLimited) {
      const truncatedIndicator = DOMUtils.createElement('div', '', 
        StyleUtils.errorStyles.truncateIndicator
      );
      truncatedIndicator.textContent = 
        `... (showing last ${maxLines} lines of ${tracebackLines.length} total lines - scroll up to see more)`;
      truncatedIndicator.style.cssText = `
        padding: 8px 12px;
        background: #fee2e2;
        color: #b91c1c;
        font-size: 11px;
        border-bottom: 1px solid #fca5a5;
        font-style: italic;
      `;
      tracebackSection.appendChild(truncatedIndicator);
    }
    
    // Create error content div
    const errorDiv = DOMUtils.createElement('div', 'output-error', 
      StyleUtils.errorStyles.content
    );
    errorDiv.textContent = displayContent;
    errorDiv.style.cssText = `
      padding: 12px;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 12px;
      line-height: 1.4;
      color: #b91c1c;
      background: transparent;
      white-space: pre-wrap;
      overflow-x: auto;
      margin: 0;
    `;
    
    tracebackSection.appendChild(errorDiv);
    container.appendChild(tracebackSection);
    
    return container;
  }
  
  /**
   * Create a copy button for error text
   * @param {string} textToCopy - Text to copy to clipboard
   * @returns {HTMLElement}
   */
  static createCopyButton(textToCopy) {
    // Get copy icon from template
    const copyIconTemplate = DOMUtils.cloneFromTemplate('copy-icon-template');
    if (!copyIconTemplate) {
      console.warn('Copy icon template not found, creating fallback');
      return this.createFallbackCopyButton(textToCopy);
    }
    
    // Create button
    const copyButton = DOMUtils.createButton('', {
      className: 'error-copy-btn',
      styles: StyleUtils.errorStyles.copyButton,
      title: 'Copy error to clipboard'
    });
    
    // Style the icon
    DOMUtils.setStyles(copyIconTemplate, {
      width: '14px',
      height: '14px',
      opacity: '0.8'
    });
    
    copyButton.appendChild(copyIconTemplate);
    
    // Add hover effects
    DOMUtils.addHoverEffect(
      copyButton,
      { 
        opacity: '1', 
        background: 'rgba(255, 255, 255, 1)',
        transform: 'scale(1.05)'
      },
      { 
        opacity: '0.7', 
        background: 'rgba(255, 255, 255, 0.9)',
        transform: 'scale(1)'
      }
    );
    
    // Add copy functionality
    copyButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.copyToClipboard(textToCopy, copyButton, copyIconTemplate);
    });
    
    return copyButton;
  }
  
  /**
   * Create a fallback copy button when icon template is not available
   * @param {string} textToCopy - Text to copy
   * @returns {HTMLElement}
   */
  static createFallbackCopyButton(textToCopy) {
    const copyButton = DOMUtils.createButton('📋', {
      className: 'error-copy-btn',
      styles: {
        ...StyleUtils.errorStyles.copyButton,
        fontSize: '14px'
      },
      title: 'Copy error to clipboard'
    });
    
    copyButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.copyToClipboard(textToCopy, copyButton);
    });
    
    return copyButton;
  }
  
  /**
   * Copy text to clipboard with visual feedback
   * @param {string} text - Text to copy
   * @param {HTMLElement} button - Button element for feedback
   * @param {HTMLElement} icon - Icon element to change (optional)
   */
  static async copyToClipboard(text, button, icon = null) {
    try {
      await navigator.clipboard.writeText(text);
      this.showCopyFeedback(button, icon, true);
    } catch (err) {
      console.error('Failed to copy error:', err);
      // Fallback for older browsers
      this.fallbackCopy(text);
      this.showCopyFeedback(button, icon, true);
    }
  }
  
  /**
   * Fallback copy method for older browsers
   * @param {string} text - Text to copy
   */
  static fallbackCopy(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }
  
  /**
   * Show visual feedback after copying
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} icon - Icon element (optional)
   * @param {boolean} success - Whether copy was successful
   */
  static showCopyFeedback(button, icon = null, success = true) {
    const originalTitle = button.title;
    
    // Update button appearance
    button.style.background = success ? StyleUtils.colors.successBg : StyleUtils.colors.errorBg;
    button.title = success ? 'Copied!' : 'Copy failed';
    
    // Update icon if provided
    if (icon) {
      if (success) {
        const originalSrc = icon.src;
        icon.src = '/assets/icons/check.svg';
        
        setTimeout(() => {
          icon.src = originalSrc;
        }, 1500);
      }
    }
    
    // Reset after delay
    setTimeout(() => {
      button.style.background = StyleUtils.errorStyles.copyButton.background;
      button.title = originalTitle;
    }, 1500);
  }
  
  /**
   * Create a simple error element (for inline errors)
   * @param {string} message - Error message
   * @param {Object} options - Styling options
   * @returns {HTMLElement}
   */
  static createSimpleError(message, options = {}) {
    const { 
      className = 'output-error',
      styles = StyleUtils.errorStyles.content
    } = options;
    
    const errorDiv = DOMUtils.createElement('div', className, styles);
    errorDiv.textContent = message;
    return errorDiv;
  }
  
  /**
   * Create an interrupt error message
   * @returns {Object} Error data object
   */
  static createInterruptError() {
    return {
      output_type: 'error',
      ename: 'KeyboardInterrupt',
      evalue: 'Execution interrupted by user',
      traceback: [
        'KeyboardInterrupt: Execution interrupted by user',
        '\nThe kernel was interrupted during execution.'
      ]
    };
  }
  
  /**
   * Create a stream error message
   * @param {string} stream - Stream name
   * @param {string} error - Error message
   * @returns {Object} Error data object
   */
  static createStreamError(stream, error) {
    return {
      output_type: 'error',
      ename: 'StreamError',
      evalue: `Stream ${stream} error: ${error}`,
      traceback: [`StreamError: Stream ${stream} error: ${error}`]
    };
  }
  
  /**
   * Add error type indicator to container
   * @param {HTMLElement} container - Container element
   * @param {Object} errorData - Error data with type info
   */
  static addErrorTypeIndicator(container, errorData) {
    const indicator = document.createElement('div');
    indicator.className = 'error-type-indicator';
    indicator.style.cssText = `
      padding: 8px 12px;
      margin-bottom: 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.3px;
    `;
    
    // Style based on error type
    switch (errorData.error_type) {
      case 'pip_error':
        indicator.style.background = '#fef3c7';
        indicator.style.color = '#d97706';
        indicator.style.border = '1px solid #fbbf24';
        indicator.textContent = '📦 Use !pip install instead of pip install';
        break;
      case 'import_error':
        indicator.style.background = '#fee2e2';
        indicator.style.color = '#dc2626';
        indicator.style.border = '1px solid #f87171';
        indicator.textContent = '📥 Import Error';
        break;
      case 'file_error':
        indicator.style.background = '#fdf4ff';
        indicator.style.color = '#c026d3';
        indicator.style.border = '1px solid #e879f9';
        indicator.textContent = '📁 File Error';
        break;
      default:
        indicator.style.background = '#f3f4f6';
        indicator.style.color = '#6b7280';
        indicator.style.border = '1px solid #d1d5db';
        indicator.textContent = '⚠️ Error';
    }
    
    container.appendChild(indicator);
  }
  
  /**
   * Add suggestions section to container
   * @param {HTMLElement} container - Container element
   * @param {Array} suggestions - Array of suggestion strings
   */
  static addSuggestions(container, suggestions) {
    const suggestionsContainer = document.createElement('div');
    suggestionsContainer.className = 'error-suggestions';
    suggestionsContainer.style.cssText = `
      margin-bottom: 12px;
      padding: 12px;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 6px;
    `;
    
    const title = document.createElement('div');
    title.style.cssText = `
      font-weight: 600;
      color: #0369a1;
      margin-bottom: 8px;
      font-size: 13px;
    `;
    title.textContent = '💡 Suggestions:';
    suggestionsContainer.appendChild(title);
    
    const list = document.createElement('ul');
    list.style.cssText = `
      margin: 0;
      padding-left: 16px;
      color: #0c4a6e;
      font-size: 12px;
      line-height: 1.5;
    `;
    
    suggestions.forEach(suggestion => {
      const item = document.createElement('li');
      item.style.marginBottom = '4px';
      
      // Check if suggestion contains code (contains pip, python, etc.)
      if (suggestion.includes('!pip') || suggestion.includes('python') || suggestion.includes('subprocess')) {
        const parts = suggestion.split(/(!pip[^\s]*|python[^\s]*|subprocess[^\s]*)/g);
        parts.forEach(part => {
          if (part.match(/!pip|python|subprocess/)) {
            const code = document.createElement('code');
            code.style.cssText = `
              background: #e0f2fe;
              padding: 2px 4px;
              border-radius: 3px;
              font-family: 'SF Mono', Monaco, monospace;
              font-size: 11px;
              color: #01579b;
            `;
            code.textContent = part;
            item.appendChild(code);
          } else {
            item.appendChild(document.createTextNode(part));
          }
        });
      } else {
        item.textContent = suggestion;
      }
      
      list.appendChild(item);
    });
    
    suggestionsContainer.appendChild(list);
    container.appendChild(suggestionsContainer);
  }
}

// Make available globally
window.ErrorUtils = ErrorUtils;
