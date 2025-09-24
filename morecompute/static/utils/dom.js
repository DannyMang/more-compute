/**
 * DOM Utilities for MoreCompute Notebook
 * Common functions for creating and styling DOM elements
 */

class DOMUtils {
  /**
   * Create an element with specified tag, classes, and styles
   * @param {string} tag - HTML tag name
   * @param {string|string[]} className - CSS class name(s)
   * @param {Object} styles - CSS styles object
   * @param {Object} attributes - HTML attributes object
   * @returns {HTMLElement}
   */
  static createElement(tag, className = '', styles = {}, attributes = {}) {
    const element = document.createElement(tag);
    
    if (className) {
      if (Array.isArray(className)) {
        element.classList.add(...className);
      } else {
        element.className = className;
      }
    }
    
    if (Object.keys(styles).length > 0) {
      element.style.cssText = this.stylesToCSS(styles);
    }
    
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    
    return element;
  }
  
  /**
   * Convert styles object to CSS string
   * @param {Object} styles - CSS styles object
   * @returns {string}
   */
  static stylesToCSS(styles) {
    return Object.entries(styles)
      .map(([key, value]) => `${this.camelToKebab(key)}: ${value}`)
      .join('; ') + ';';
  }
  
  /**
   * Convert camelCase to kebab-case
   * @param {string} str - camelCase string
   * @returns {string}
   */
  static camelToKebab(str) {
    return str.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
  }
  
  /**
   * Create a button element with common styling
   * @param {string} text - Button text
   * @param {Object} options - Button options
   * @returns {HTMLElement}
   */
  static createButton(text, options = {}) {
    const {
      className = '',
      styles = {},
      onClick = null,
      title = '',
      disabled = false
    } = options;
    
    const defaultStyles = {
      border: 'none',
      borderRadius: '4px',
      cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.2s ease',
      opacity: disabled ? '0.6' : '1'
    };
    
    const button = this.createElement('button', className, {
      ...defaultStyles,
      ...styles
    }, { 
      title,
      disabled: disabled ? 'disabled' : null 
    });
    
    if (text) {
      button.textContent = text;
    }
    
    if (onClick && !disabled) {
      button.addEventListener('click', onClick);
    }
    
    return button;
  }
  
  /**
   * Create an icon button
   * @param {string} iconSrc - Icon source URL
   * @param {Object} options - Button options
   * @returns {HTMLElement}
   */
  static createIconButton(iconSrc, options = {}) {
    const {
      className = '',
      size = '24px',
      iconSize = '14px',
      onClick = null,
      title = ''
    } = options;
    
    const button = this.createButton('', {
      className,
      styles: {
        width: size,
        height: size,
        padding: '0',
        background: 'rgba(255, 255, 255, 0.9)',
        ...options.styles
      },
      onClick,
      title
    });
    
    const icon = this.createElement('img', '', {
      width: iconSize,
      height: iconSize,
      opacity: '0.8'
    }, {
      src: iconSrc,
      alt: title || 'Icon'
    });
    
    button.appendChild(icon);
    return button;
  }
  
  /**
   * Create a container div with positioning
   * @param {Object} options - Container options
   * @returns {HTMLElement}
   */
  static createContainer(options = {}) {
    const {
      className = '',
      position = 'relative',
      styles = {}
    } = options;
    
    return this.createElement('div', className, {
      position,
      ...styles
    });
  }
  
  /**
   * Clone an element from template
   * @param {string} templateId - Template element ID
   * @returns {HTMLElement|null}
   */
  static cloneFromTemplate(templateId) {
    const template = document.getElementById(templateId);
    if (!template) {
      console.warn(`Template with id "${templateId}" not found`);
      return null;
    }
    
    const clone = template.cloneNode(true);
    clone.removeAttribute('id');
    return clone;
  }
  
  /**
   * Add hover effects to an element
   * @param {HTMLElement} element - Target element
   * @param {Object} hoverStyles - Styles to apply on hover
   * @param {Object} normalStyles - Styles to apply when not hovering
   */
  static addHoverEffect(element, hoverStyles = {}, normalStyles = {}) {
    element.addEventListener('mouseenter', () => {
      Object.entries(hoverStyles).forEach(([key, value]) => {
        element.style[key] = value;
      });
    });
    
    element.addEventListener('mouseleave', () => {
      Object.entries(normalStyles).forEach(([key, value]) => {
        element.style[key] = value;
      });
    });
  }
  
  /**
   * Set element styles with CSS string or object
   * @param {HTMLElement} element - Target element
   * @param {string|Object} styles - CSS styles
   */
  static setStyles(element, styles) {
    if (typeof styles === 'string') {
      element.style.cssText = styles;
    } else if (typeof styles === 'object') {
      element.style.cssText = this.stylesToCSS(styles);
    }
  }
}

// Make available globally
window.DOMUtils = DOMUtils;