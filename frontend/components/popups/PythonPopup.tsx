import React, { useState, useEffect } from 'react';
import { RotateCw } from 'lucide-react';

interface PythonEnvironment {
  name: string;
  version: string;
  path: string;
  type: string;
  active?: boolean;
}

interface PythonPopupProps {
  onClose?: () => void;
  onEnvironmentSwitch?: (env: PythonEnvironment) => void;
}

const PythonPopup: React.FC<PythonPopupProps> = ({ onClose, onEnvironmentSwitch }) => {
  const [environments, setEnvironments] = useState<PythonEnvironment[]>([]);
  const [currentEnv, setCurrentEnv] = useState<PythonEnvironment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadEnvironments();
  }, []);

  const loadEnvironments = async () => {
    setLoading(true);
    setError(null);
    try {
      // Mocking API call
      const data = await new Promise<any>(resolve => setTimeout(() => resolve({
        status: 'success',
        environments: [
          { name: 'System Python', version: '3.9.6', path: '/usr/bin/python3', type: 'system' },
          { name: '.venv', version: '3.10.2', path: '/Users/danielung/Desktop/projects/MORECOMPUTE/.venv/bin/python', type: 'venv' }
        ],
        current: { name: '.venv', version: '3.10.2', path: '/Users/danielung/Desktop/projects/MORECOMPUTE/.venv/bin/python', type: 'venv' }
      }), 500));

      if (data.status === 'success') {
        setEnvironments(data.environments.map((env: any) => ({ ...env, active: env.path === data.current.path })));
        setCurrentEnv(data.current);
      } else {
        throw new Error(data.message);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load environments');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="python-env-list">Loading...</div>;
  }

  if (error) {
    return <div>{error}</div>;
  }

  return (
    <div className="python-env-list">
        {currentEnv &&
            <div className="current-env-section" style={{ marginBottom: '20px', padding: '16px', background: '#f0f9ff', border: '1px solid #0ea5e9', borderRadius: '8px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: '#0369a1' }}>Current Environment</h3>
                <div>
                    <div style={{ fontWeight: 500 }}>{currentEnv.name}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Python {currentEnv.version}</div>
                    <div style={{ fontSize: '11px', color: '#6b7280', fontFamily: 'monospace' }}>{currentEnv.path}</div>
                </div>
            </div>
        }
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Available Environments</h3>
            <button className="file-toolbar-btn" onClick={loadEnvironments} aria-label="Refresh environments">
                <RotateCw size={16} />
            </button>
        </div>
      {environments.map((env, index) => (
        <div key={index} className={`env-item ${env.active ? 'active' : ''}`}>
            <div className="env-info">
                <div className="env-name">{env.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                    <span className="env-version">Python {env.version}</span>
                    <span style={{ fontSize: '10px', color: '#6b7280', background: '#f3f4f6', padding: '2px 6px', borderRadius: '10px' }}>{env.type}</span>
                </div>
                <div className="env-path">{env.path}</div>
            </div>
            <div>
                {env.active ? 
                    <span style={{ padding: '4px 8px', fontSize: '11px', background: '#10b981', color: 'white', borderRadius: '4px' }}>Active</span> : 
                    <button className="btn btn-primary" style={{ fontSize: '11px', padding: '4px 8px' }}>Switch</button>
                }
            </div>
        </div>
      ))}
    </div>
  );
};

export default PythonPopup;