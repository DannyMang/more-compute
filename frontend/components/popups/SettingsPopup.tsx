import React, { useState, useEffect, useCallback } from 'react';
import { THEMES, DEFAULT_SETTINGS, loadSettings, saveSettings, applyTheme, type NotebookSettings } from '@/lib/settings';

const SettingsPopup: React.FC<{ onSettingsChange?: (settings: NotebookSettings) => void }> = ({ onSettingsChange }) => {
  const [settings, setSettings] = useState<NotebookSettings>(() => loadSettings());
  const [settingsJson, setSettingsJson] = useState(() => JSON.stringify(loadSettings(), null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSettingsJson(JSON.stringify(settings, null, 2));
    applyTheme(settings.theme);
  }, [settings]);

  const persistSettings = useCallback((updated: NotebookSettings) => {
    setSettings(updated);
    setSettingsJson(JSON.stringify(updated, null, 2));
    saveSettings(updated);
    applyTheme(updated.theme);

    // Dispatch custom event to notify Monaco cells of theme change
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: updated.theme } }));

    onSettingsChange?.(updated);
  }, [onSettingsChange]);

  const handleSave = () => {
    try {
      const parsed = JSON.parse(settingsJson);
      const merged: NotebookSettings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        theme: parsed.theme && THEMES[parsed.theme] ? parsed.theme : DEFAULT_SETTINGS.theme,
      };
      setError(null);
      persistSettings(merged);
    } catch (err: unknown) {
      console.error('Failed to parse settings JSON', err);
      setError('Invalid JSON. Please fix the syntax and try again.');
    }
  };

  const handleReset = () => {
    setError(null);
    persistSettings(DEFAULT_SETTINGS);
  };

  return (
    <div className="settings-container">
      <div style={{ fontSize: '12px', marginBottom: '8px', color: 'var(--mc-text-secondary, #6b7280)' }}>
        See all themes at <a href="https://github.com/DannyMang/more-compute/blob/main/frontend/styling_README.md" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mc-link-color, #3b82f6)', textDecoration: 'underline' }}>styling_README.md</a>
      </div>
      <textarea
        className="settings-editor"
        value={settingsJson}
        onChange={(e) => setSettingsJson(e.target.value)}
        spellCheck={false}
      />
      {error && (
        <div style={{ color: 'var(--mc-error-color, #dc2626)', fontSize: '12px', marginTop: '8px' }}>{error}</div>
      )}
      <div className="settings-actions">
        <button className="btn btn-secondary" type="button" onClick={handleReset}>Reset to Defaults</button>
        <button className="btn btn-primary" type="button" onClick={handleSave}>Save Settings</button>
      </div>
    </div>
  );
};

export default SettingsPopup;
