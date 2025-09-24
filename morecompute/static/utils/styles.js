/**
 * Style Utilities for MoreCompute Notebook
 * Common style constants and utility functions
 */

class StyleUtils {
  // Color palette
  static colors = {
    primary: '#3b82f6',
    success: '#10b981',
    error: '#dc2626',
    warning: '#f59e0b',
    
    // Grays
    gray50: '#f9fafb',
    gray100: '#f3f4f6',
    gray200: '#e5e7eb',
    gray300: '#d1d5db',
    gray400: '#9ca3af',
    gray500: '#6b7280',
    gray600: '#4b5563',
    gray700: '#374151',
    gray800: '#1f2937',
    gray900: '#111827',
    
    // Backgrounds
    errorBg: '#fef2f2',
    errorBorder: '#fecaca',
    successBg: '#dcfdf4',
    warningBg: '#fffbeb'
  };
  
  // Common font families
  static fonts = {
    mono: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
    sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  };
  
  // Common spacing
  static spacing = {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    xxl: '24px'
  };
  
  // Common border radius
  static radius = {
    sm: '3px',
    md: '4px',
    lg: '6px',
    xl: '8px'
  };
  
  // Shadow presets
  static shadows = {
    sm: '0 1px 2px rgba(0, 0, 0, 0.1)',
    md: '0 2px 4px rgba(0, 0, 0, 0.1)',
    lg: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    xl: '0 2px 8px rgba(0, 0, 0, 0.1)'
  };
  
  // Common button styles
  static buttonStyles = {
    base: {
      border: 'none',
      borderRadius: this.radius.md,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.2s ease',
      fontWeight: '500'
    },
    
    primary: {
      background: this.colors.primary,
      color: 'white'
    },
    
    secondary: {
      background: this.colors.gray100,
      color: this.colors.gray700,
      border: `1px solid ${this.colors.gray200}`
    },
    
    ghost: {
      background: 'rgba(255, 255, 255, 0.9)',
      border: 'none',
      opacity: '0.7'
    }
  };
  
  // Error output styles
  static errorStyles = {
    container: {
      position: 'relative',
      margin: `${this.spacing.sm} 0`
    },
    
    content: {
      backgroundColor: this.colors.errorBg,
      color: this.colors.error,
      padding: `${this.spacing.md} ${this.spacing.lg}`,
      borderRadius: this.radius.lg,
      border: `1px solid ${this.colors.errorBorder}`,
      fontFamily: this.fonts.mono,
      fontSize: '13px',
      whiteSpace: 'pre-wrap',
      wordWrap: 'break-word'
    },
    
    truncateIndicator: {
      color: this.colors.gray500,
      fontStyle: 'italic',
      fontSize: '12px',
      marginBottom: this.spacing.sm,
      padding: `${this.spacing.xs} ${this.spacing.sm}`,
      background: this.colors.gray50,
      borderRadius: this.radius.md,
      borderLeft: `3px solid ${this.colors.gray300}`
    },
    
    copyButton: {
      position: 'absolute',
      top: this.spacing.sm,
      right: this.spacing.sm,
      width: '24px',
      height: '24px',
      background: 'rgba(255, 255, 255, 0.9)',
      borderRadius: this.radius.md,
      opacity: '0.7',
      zIndex: '10'
    }
  };
  
  // Stream output styles
  static streamStyles = {
    base: {
      background: this.colors.gray50,
      padding: `${this.spacing.md} ${this.spacing.lg}`,
      margin: `${this.spacing.sm} 0`,
      borderRadius: this.radius.lg,
      fontFamily: this.fonts.mono,
      fontSize: '13px',
      whiteSpace: 'pre-wrap',
      wordWrap: 'break-word',
      borderLeft: `3px solid ${this.colors.gray200}`
    },
    
    stdout: {
      color: this.colors.gray700,
      borderLeftColor: this.colors.gray500
    },
    
    stderr: {
      color: this.colors.error,
      background: this.colors.errorBg,
      borderLeftColor: this.colors.error
    }
  };
  
  // Result output styles
  static resultStyles = {
    base: {
      background: 'white',
      padding: `${this.spacing.md} ${this.spacing.lg}`,
      margin: `${this.spacing.sm} 0`,
      borderRadius: this.radius.lg,
      border: `1px solid ${this.colors.gray200}`,
      fontFamily: this.fonts.mono,
      fontSize: '13px',
      whiteSpace: 'pre-wrap',
      wordWrap: 'break-word'
    }
  };
  
  /**
   * Get button styles by type
   * @param {string} type - Button type (primary, secondary, ghost)
   * @param {Object} overrides - Style overrides
   * @returns {Object}
   */
  static getButtonStyles(type = 'ghost', overrides = {}) {
    return {
      ...this.buttonStyles.base,
      ...this.buttonStyles[type],
      ...overrides
    };
  }
  
  /**
   * Get hover styles for buttons
   * @param {string} type - Button type
   * @returns {Object}
   */
  static getButtonHoverStyles(type = 'ghost') {
    const hoverMap = {
      primary: { background: '#2563eb' },
      secondary: { background: this.colors.gray200 },
      ghost: { 
        opacity: '1', 
        background: 'rgba(255, 255, 255, 1)',
        transform: 'scale(1.05)'
      }
    };
    
    return hoverMap[type] || hoverMap.ghost;
  }
  
  /**
   * Get stream output styles by type
   * @param {string} streamType - Stream type (stdout, stderr)
   * @returns {Object}
   */
  static getStreamStyles(streamType = 'stdout') {
    return {
      ...this.streamStyles.base,
      ...this.streamStyles[streamType]
    };
  }
  
  /**
   * Create a CSS string from styles object
   * @param {Object} styles - Styles object
   * @returns {string}
   */
  static createCSSString(styles) {
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
}

// Make available globally
window.StyleUtils = StyleUtils;