import React, { useState, useEffect } from 'react';

const SettingsPopup: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const [settings, setSettings] = useState('');

  const defaultSettings = {
      theme: "light",
      auto_save: true,
      font_size: 14,
      font_family: "SF Mono",
  };

  useEffect(() => {
    setSettings(JSON.stringify(defaultSettings, null, 2));
  }, []);

  return (
    <div className="settings-container">
      <div style={{ marginBottom: '16px', padding: '12px', background: '#f8f9fa', borderRadius: '6px', color: '#6b7280', fontSize: '13px', lineHeight: 1.5 }}>
        <strong>MoreCompute Settings</strong><br />
        Configure your notebook environment. Changes are saved automatically.
        <br /><br />
        <em>Note: Some changes may require a page refresh to take effect.</em>
      </div>
      <textarea 
        className="settings-editor" 
        value={settings} 
        onChange={(e) => setSettings(e.target.value)}
      />
      <div className="settings-actions">
        <button className="btn btn-secondary">Reset to Defaults</button>
        <button className="btn btn-primary">Save Settings</button>
      </div>
    </div>
  );
};

export default SettingsPopup;