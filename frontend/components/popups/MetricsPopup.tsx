import React from 'react';

const MetricsPopup: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  return (
    <div className="metrics-container">
      <div className="metrics-placeholder">
        <h3>📊 Metrics Dashboard</h3>
        <p>System resource monitoring is not implemented yet.</p>
        <div className="coming-soon">
          <ul>
            <li>🖥️ CPU Usage & Temperature</li>
            <li>🎮 GPU Utilization & Memory</li>
            <li>💾 RAM & Storage Metrics</li>
            <li>🌐 Network I/O Statistics</li>
            <li>⚡ Real-time Performance Tracking</li>
          </ul>
          <p><em>Coming soon...</em></p>
        </div>
      </div>
    </div>
  );
};

export default MetricsPopup;