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
    
    // Add truncation indicator if needed
    if (isLimited) {
      const truncatedIndicator = DOMUtils.createElement('div', '', 
        StyleUtils.errorStyles.truncateIndicator
      );
      truncatedIndicator.textContent = 
        `... (showing last ${maxLines} lines of ${tracebackLines.length} total lines - scroll up to see more)`;
      container.appendChild(truncatedIndicator);
    }
    
    // Create error content div
    const errorDiv = DOMUtils.createElement('div', 'output-error', 
      StyleUtils.errorStyles.content
    );
    errorDiv.textContent = displayContent;
    container.appendChild(errorDiv);
    
    // Add copy button if requested
    if (showCopyButton) {
      const copyButton = this.createCopyButton(fullTraceback);
      container.appendChild(copyButton);
    }
    
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
      const checkIconTemplate = DOMUtils.cloneFromTemplate('check-icon-template');
      if (checkIconTemplate && success) {
        const originalIcon = icon.src;
        icon.src = checkIconTemplate.src;
        
        setTimeout(() => {
          icon.src = originalIcon;
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
}

// Make available globally
window.ErrorUtils = ErrorUtils;