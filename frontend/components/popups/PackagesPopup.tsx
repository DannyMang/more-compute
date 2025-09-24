import React, { useState, useEffect } from 'react';

interface Package {
  name: string;
  version: string;
  description: string;
}

interface PackagesPopupProps {
  onClose?: () => void;
}

const PackagesPopup: React.FC<PackagesPopupProps> = ({ onClose }) => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPackages();
  }, []);

  const loadPackages = async () => {
    setLoading(true);
    setError(null);
    try {
      const mockPackages = await getMockPackages();
      setPackages(mockPackages);
    } catch (err) {
      setError('Failed to load packages');
    } finally {
      setLoading(false);
    }
  };

  const getMockPackages = async (): Promise<Package[]> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    return [
      { name: 'numpy', version: '1.24.3', description: 'Fundamental package for array computing' },
      { name: 'pandas', version: '2.0.1', description: 'Data manipulation and analysis library' },
      { name: 'matplotlib', version: '3.7.1', description: 'Plotting library for Python' },
      { name: 'jupyter', version: '1.0.0', description: 'Interactive computing environment' },
      { name: 'fastapi', version: '0.95.2', description: 'Fast web framework for APIs' },
      { name: 'uvicorn', version: '0.22.0', description: 'ASGI server implementation' },
    ];
  };

  if (loading) {
    return <div className="package-list">Loading...</div>;
  }

  if (error) {
    return <div>{error}</div>;
  }

  return (
    <div className="package-list">
        <div className="package-controls" style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input type="text" placeholder="Package name (e.g., numpy)" style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }} />
                <button className="btn btn-primary">Install</button>
            </div>
            <button className="btn btn-secondary" onClick={loadPackages}>Refresh List</button>
        </div>
        {packages.map(pkg => (
            <div key={pkg.name} className="package-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', margin: '8px 0', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                <div>
                    <div style={{ fontWeight: 500, color: '#1f2937' }}>{pkg.name}</div>
                    <div style={{ fontSize: '12px', color: '#3b82f6' }}>v{pkg.version}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>{pkg.description}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <button className="btn btn-primary" style={{ fontSize: '11px', padding: '4px 8px' }}>Update</button>
                    <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '4px 8px', background: '#ef4444', color: 'white' }}>Remove</button>
                </div>
            </div>
        ))}
    </div>
  );
};

export default PackagesPopup;