export type ThemeDefinition = {
  background: string;
  cellBackground: string;
  textColor: string;
  markdownColor: string;
  lineNumberColor: string;
};

export const THEMES: Record<string, ThemeDefinition> = {
  light: {
    background: '#f8fafc',
    cellBackground: '#ffffff',
    textColor: '#1f2937',
    markdownColor: '#1f2937',
    lineNumberColor: '#9ca3af',
  },
  dark: {
    background: '#111827',
    cellBackground: '#1f2937',
    textColor: '#f9fafb',
    markdownColor: '#e5e7eb',
    lineNumberColor: '#6b7280',
  },
  catppuccin: {
    background: '#1e1e2e',
    cellBackground: '#313244',
    textColor: '#cdd6f4',
    markdownColor: '#cdd6f4',
    lineNumberColor: '#9399b2',
  },
};

export type NotebookSettings = {
  theme: keyof typeof THEMES;
  auto_save: boolean;
  font_size: number;
  font_family: string;
};

export const DEFAULT_SETTINGS: NotebookSettings = {
  theme: 'light',
  auto_save: true,
  font_size: 14,
  font_family: 'SF Mono',
};

const STORAGE_KEY = 'morecompute-settings';

export function loadSettings(): NotebookSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    const theme = parsed.theme && THEMES[parsed.theme] ? parsed.theme : DEFAULT_SETTINGS.theme;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      theme,
    };
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
  root.style.setProperty('--mc-background', theme.background);
  root.style.setProperty('--mc-cell-background', theme.cellBackground);
  root.style.setProperty('--mc-text-color', theme.textColor);
  root.style.setProperty('--mc-markdown-color', theme.markdownColor);
  root.style.setProperty('--mc-line-number-color', theme.lineNumberColor);
}

export function resetSettings() {
  saveSettings(DEFAULT_SETTINGS);
  applyTheme(DEFAULT_SETTINGS.theme);
}

