import { getAvailableThemes, getThemeColors } from './monaco-themes';

export type ThemeDefinition = {
  // Core colors
  background: string;
  cellBackground: string;
  textColor: string;
  markdownColor: string;
  lineNumberColor: string;

  // Primary/Secondary colors for UI elements
  primary: string;
  primaryHover: string;
  secondary: string;
  secondaryHover: string;

  // UI element colors
  border: string;
  borderHover: string;
  sidebarBackground: string;
  sidebarForeground: string;
  buttonBackground: string;
  buttonForeground: string;
  inputBackground: string;
  inputBorder: string;

  // Headings and emphasis
  headingColor: string;
  paragraphColor: string;

  // Output colors
  outputBackground: string;
  outputTextColor: string;
  outputBorder: string;
};

// Built-in simple themes
const BUILTIN_THEMES: Record<string, ThemeDefinition> = {
  light: {
    background: '#f3f3f3',
    cellBackground: '#ffffff',
    textColor: '#000000',
    markdownColor: '#000000',
    lineNumberColor: '#237893',
    primary: '#005fb8',
    primaryHover: '#004a8f',
    secondary: '#e5e5e5',
    secondaryHover: '#d1d1d1',
    border: '#e5e5e5',
    borderHover: '#d1d1d1',
    sidebarBackground: '#f3f3f3',
    sidebarForeground: '#424242',
    buttonBackground: '#005fb8',
    buttonForeground: '#ffffff',
    inputBackground: '#ffffff',
    inputBorder: '#cecece',
    headingColor: '#000000',
    paragraphColor: '#000000',
    outputBackground: '#f8f8f8',
    outputTextColor: '#000000',
    outputBorder: '#e5e5e5',
  },
  dark: {
    background: '#1e1e1e',
    cellBackground: '#252526',
    textColor: '#cccccc',
    markdownColor: '#cccccc',
    lineNumberColor: '#858585',
    primary: '#007acc',
    primaryHover: '#1088cc',
    secondary: '#3e3e42',
    secondaryHover: '#505050',
    border: '#3e3e42',
    borderHover: '#505050',
    sidebarBackground: '#252526',
    sidebarForeground: '#cccccc',
    buttonBackground: '#007acc',
    buttonForeground: '#ffffff',
    inputBackground: '#3c3c3c',
    inputBorder: '#3e3e42',
    headingColor: '#e5e5e5',
    paragraphColor: '#cccccc',
    outputBackground: '#1e1e1e',
    outputTextColor: '#cccccc',
    outputBorder: '#3e3e42',
  },
};

// Dynamically build THEMES object by combining built-in and Monaco themes
export const THEMES: Record<string, ThemeDefinition> = (() => {
  const themes: Record<string, ThemeDefinition> = { ...BUILTIN_THEMES };

  // Add Monaco themes
  try {
    const monacoThemes = getAvailableThemes();
    monacoThemes.forEach(({ name }) => {
      const colors = getThemeColors(name);
      if (colors) {
        themes[name] = colors;
      }
    });
  } catch (e) {
    console.warn('Failed to load Monaco themes:', e);
  }

  return themes;
})();

export type MetricsCollectionMode = 'persistent' | 'on-demand';

export type NotebookSettings = {
  theme: keyof typeof THEMES;
  metricsCollectionMode: MetricsCollectionMode;
};

export const DEFAULT_SETTINGS: NotebookSettings = {
  theme: 'light',
  metricsCollectionMode: 'on-demand', // Only collect metrics when popup is open to save memory
};

const STORAGE_KEY = 'morecompute-settings';

export function loadSettings(): NotebookSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    const theme = parsed.theme && THEMES[parsed.theme] ? parsed.theme : DEFAULT_SETTINGS.theme;

    // Return only valid settings fields (remove old auto_save, font_size, font_family, etc.)
    const cleanSettings: NotebookSettings = {
      theme,
      metricsCollectionMode: parsed.metricsCollectionMode === 'on-demand' || parsed.metricsCollectionMode === 'persistent'
        ? parsed.metricsCollectionMode
        : DEFAULT_SETTINGS.metricsCollectionMode,
    };

    // Save cleaned settings back to localStorage
    saveSettings(cleanSettings);

    return cleanSettings;
  } catch (error) {
    console.warn('Failed to load settings; defaulting', error);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: NotebookSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function applyTheme(themeName: keyof typeof THEMES) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const theme = THEMES[themeName] ?? THEMES.light;

  // Core colors
  root.style.setProperty('--mc-background', theme.background);
  root.style.setProperty('--mc-cell-background', theme.cellBackground);
  root.style.setProperty('--mc-text-color', theme.textColor);
  root.style.setProperty('--mc-markdown-color', theme.markdownColor);
  root.style.setProperty('--mc-line-number-color', theme.lineNumberColor);

  // Primary/Secondary colors
  root.style.setProperty('--mc-primary', theme.primary);
  root.style.setProperty('--mc-primary-hover', theme.primaryHover);
  root.style.setProperty('--mc-secondary', theme.secondary);
  root.style.setProperty('--mc-secondary-hover', theme.secondaryHover);

  // UI element colors
  root.style.setProperty('--mc-border', theme.border);
  root.style.setProperty('--mc-border-hover', theme.borderHover);
  root.style.setProperty('--mc-sidebar-background', theme.sidebarBackground);
  root.style.setProperty('--mc-sidebar-foreground', theme.sidebarForeground);
  root.style.setProperty('--mc-button-background', theme.buttonBackground);
  root.style.setProperty('--mc-button-foreground', theme.buttonForeground);
  root.style.setProperty('--mc-input-background', theme.inputBackground);
  root.style.setProperty('--mc-input-border', theme.inputBorder);

  // Headings and emphasis
  root.style.setProperty('--mc-markdown-heading-color', theme.headingColor);
  root.style.setProperty('--mc-markdown-paragraph-color', theme.paragraphColor);

  // Output colors
  root.style.setProperty('--mc-output-background', theme.outputBackground);
  root.style.setProperty('--mc-output-text-color', theme.outputTextColor);
  root.style.setProperty('--mc-output-border', theme.outputBorder);
}

export function resetSettings() {
  saveSettings(DEFAULT_SETTINGS);
  applyTheme(DEFAULT_SETTINGS.theme);
}

