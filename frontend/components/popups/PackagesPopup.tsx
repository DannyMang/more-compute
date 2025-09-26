import React, { useState, useEffect, useMemo } from 'react';
import { Search, CircleHelp } from 'lucide-react';

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
  const [query, setQuery] = useState('');

  useEffect(() => {
    loadPackages();
  }, []);

  const getPackages = async (): Promise<Package[]> => {
    // Mocked dataset for UI only
    await new Promise(resolve => setTimeout(resolve, 200));
    return [
      { name: 'numpy', version: '1.26.4', description: '' },
      { name: 'pandas', version: '2.2.2', description: '' },
      { name: 'matplotlib', version: '3.9.0', description: '' },
      { name: 'scipy', version: '1.13.1', description: '' },
      { name: 'jupyter', version: '1.1.1', description: '' },
      { name: 'fastapi', version: '0.115.0', description: '' },
      { name: 'uvicorn', version: '0.30.6', description: '' },
      { name: 'torch', version: '2.4.0', description: '' },
      { name: 'transformers', version: '4.44.2', description: '' },
      { name: 'requests', version: '2.32.3', description: '' },
    ];
  };

  const loadPackages = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPackages();
      setPackages(data);
    } catch (err) {
      setError('Failed to load packages');
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return packages;
    const q = query.toLowerCase();
    return packages.filter(p => p.name.toLowerCase().includes(q));
  }, [packages, query]);

  if (loading) return <div className="packages-list">Loading...</div>;
  if (error) return <div className="packages-list">{error}</div>;

  return (
    <div className="packages-container">
      <div className="packages-toolbar">
        <div className="packages-search">
          <Search className="packages-search-icon" size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search packages"
            className="packages-search-input"
          />
        </div>
        <div className="packages-subtext">
          <CircleHelp size={14} />
          <span>Install packages with !pip</span>
        </div>
      </div>

      <div className="packages-table">
        <div className="packages-table-header">
          <div className="col-name">Name</div>
          <div className="col-version">Version</div>
        </div>
        <div className="packages-list">
          {filtered.map((pkg) => (
            <div key={pkg.name} className="package-row">
              <div className="col-name package-name">{pkg.name}</div>
              <div className="col-version package-version">{pkg.version}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PackagesPopup;