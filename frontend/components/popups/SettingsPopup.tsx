import React from 'react';

const SettingsPopup: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  return (
    <div className="settings-container">
      <div style={{
        padding: '32px 24px',
        textAlign: 'center',
        color: '#6b7280'
      }}>
        <h3 style={{
          fontSize: '18px',
          fontWeight: '600',
          color: '#111827',
          marginBottom: '12px'
        }}>
          Settings Coming Soon!
        </h3>
        <p style={{
          fontSize: '14px',
          lineHeight: 1.6,
          marginBottom: '16px'
        }}>
          We're working on bringing you customization options including:
        </p>
        <ul style={{
          listStyle: 'disc',
          paddingLeft: '24px',
          fontSize: '14px',
          lineHeight: 2,
          color: '#4b5563',
          textAlign: 'left',
          display: 'inline-block'
        }}>
          <li>Custom themes</li>
          <li>Font preferences</li>
          <li>Editor settings</li>
          <li>And whatever you want!</li>
        </ul>
        <p style={{
          fontSize: '13px',
          marginTop: '24px'
        }}>
          <a
            href="#roadmap"
            style={{ color: '#3b82f6', textDecoration: 'underline' }}
          >
            View our roadmap
          </a>
        </p>
      </div>
    </div>
  );
};

export default SettingsPopup;