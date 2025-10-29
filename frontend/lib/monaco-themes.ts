import { editor } from 'monaco-editor';
import generatedThemes from './themes.json';

export type MonacoThemeName = keyof typeof generatedThemes.themes;

interface VSCodeTokenColor {
  name?: string;
  scope: string | string[];
  settings?: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

interface VSCodeTheme {
  displayName: string;
  name: string;
  type: 'light' | 'dark';
  colors?: Record<string, string>;
  tokenColors?: VSCodeTokenColor[];
}

/**
 * Convert VS Code theme to Monaco theme definition
 */
function convertToMonacoTheme(vsCodeTheme: VSCodeTheme): editor.IStandaloneThemeData {
  const colors = vsCodeTheme.colors || {};
  const tokenColors = vsCodeTheme.tokenColors || [];

  // Convert token colors to Monaco rules format
  const rules: editor.ITokenThemeRule[] = [];
  tokenColors.forEach((tokenColor: VSCodeTokenColor) => {
    const scopes = Array.isArray(tokenColor.scope) ? tokenColor.scope : [tokenColor.scope];
    const settings = tokenColor.settings || {};

    scopes.forEach((scope: string) => {
      if (scope && settings) {
        rules.push({
          token: scope,
          foreground: settings.foreground?.replace('#', ''),
          background: settings.background?.replace('#', ''),
          fontStyle: settings.fontStyle,
        });
      }
    });
  });

  const monacoColors: Record<string, string> = {
    'editor.background': colors['editor.background'],
    'editor.foreground': colors['editor.foreground'],
    'editor.lineHighlightBackground': colors['editor.lineHighlightBackground'] || colors['editor.background'],
    'editor.selectionBackground': colors['editor.selectionBackground'],
    'editorCursor.foreground': colors['editorCursor.foreground'],
    'editorLineNumber.foreground': colors['editorLineNumber.foreground'],
    'editorLineNumber.activeForeground': colors['editorLineNumber.activeForeground'],
  };

  // Remove undefined values
  Object.keys(monacoColors).forEach(key => {
    if (monacoColors[key] === undefined) {
      delete monacoColors[key];
    }
  });

  return {
    base: vsCodeTheme.type === 'light' ? 'vs' : 'vs-dark',
    inherit: true,
    rules,
    colors: monacoColors,
  };
}

/**
 * Load and define all themes in Monaco Editor
 */
export function loadMonacoThemes(monaco: typeof import('monaco-editor')) {
  Object.entries(generatedThemes.themes).forEach(([themeName, themeData]) => {
    const monacoTheme = convertToMonacoTheme(themeData as VSCodeTheme);
    monaco.editor.defineTheme(themeName, monacoTheme);
  });
}

/**
 * Get list of available theme names
 */
export function getAvailableThemes(): Array<{ name: string; displayName: string; type: 'light' | 'dark' }> {
  return Object.entries(generatedThemes.themes).map(([name, data]) => ({
    name,
    displayName: data.displayName,
    type: data.type as 'light' | 'dark',
  }));
}

/**
 * Lighten or darken a hex color
 */
function adjustColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + percent));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + percent));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + percent));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/**
 * Get simplified color scheme for UI elements (non-Monaco parts)
 */
export function getThemeColors(themeName: string) {
  const theme = generatedThemes.themes[themeName as keyof typeof generatedThemes.themes];
  if (!theme) return null;

  const colors: Record<string, string | undefined> = theme.colors || {};
  const isLight = theme.type === 'light';

  // Extract colors from VS Code theme
  const editorBg = colors['editor.background'] || (isLight ? '#ffffff' : '#1e1e1e');
  const editorFg = colors['editor.foreground'] || (isLight ? '#1f2937' : '#d4d4d4');
  const activityBarBg = colors['activityBar.background'] || editorBg;
  const sidebarBg = colors['sideBar.background'] || activityBarBg;
  const buttonBg = colors['button.background'] || (isLight ? '#3b82f6' : '#60a5fa');
  const buttonFg = colors['button.foreground'] || (isLight ? '#ffffff' : '#000000');

  // Derive border colors
  const borderColor = isLight ? adjustColor(editorBg, -20) : adjustColor(editorBg, 20);

  return {
    // Core colors
    background: adjustColor(editorBg, isLight ? -5 : -10),
    cellBackground: editorBg,
    textColor: editorFg,
    markdownColor: editorFg,
    lineNumberColor: colors['editorLineNumber.foreground'] || (isLight ? '#9ca3af' : '#6b7280'),

    // Primary/Secondary colors
    primary: buttonBg,
    primaryHover: adjustColor(buttonBg, isLight ? -20 : 20),
    secondary: borderColor,
    secondaryHover: adjustColor(borderColor, isLight ? -15 : 15),

    // UI element colors
    border: borderColor,
    borderHover: adjustColor(borderColor, isLight ? -10 : 10),
    sidebarBackground: sidebarBg,
    sidebarForeground: colors['sideBar.foreground'] || editorFg,
    buttonBackground: buttonBg,
    buttonForeground: buttonFg,
    inputBackground: editorBg,
    inputBorder: borderColor,

    // Headings and emphasis
    headingColor: adjustColor(editorFg, isLight ? -30 : 30),
    paragraphColor: editorFg,

    // Output colors
    outputBackground: adjustColor(editorBg, isLight ? -10 : -5),
    outputTextColor: editorFg,
    outputBorder: borderColor,
  };
}
