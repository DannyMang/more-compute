import React, { useState, useEffect, useMemo } from 'react';
import { Search, CircleHelp } from 'lucide-react';
import { fetchInstalledPackages } from '@/lib/api';

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
    // Always force refresh on initial load to ensure fresh data
    loadPackages(true);
    const handler = () => loadPackages(true);  // Force refresh when packages updated
    if (typeof window !== 'undefined') {
      window.addEventListener('mc:packages-updated', handler as EventListener);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('mc:packages-updated', handler as EventListener);
      }
    };
  }, []);

  const getPackages = async (forceRefresh: boolean = false): Promise<Package[]> => {
    const pkgs = await fetchInstalledPackages(forceRefresh);
    const seen = new Set<string>();
    const out: Package[] = [];
    for (const p of pkgs) {
      const name = p.name || '';
      const version = p.version || '';
       // ignore base package
       // we might need to remove this? idk double check later 
      if (name.toLowerCase() === 'morecompute') continue; 
      const key = `${name}@${version}`.toLowerCase();
      if (seen.has(key)) continue; // dedupe exact duplicates
      seen.add(key);
      out.push({ name, version, description: '' });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  };

  const loadPackages = async (forceRefresh: boolean = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPackages(forceRefresh);
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
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--mc-text-color)' }}>
              Loading packages...
            </div>
          ) : error ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#dc2626' }}>
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--mc-text-color)', opacity: 0.6 }}>
              {query ? 'No packages found' : 'No packages installed'}
            </div>
          ) : (
            filtered.map((pkg) => (
              <div key={`${pkg.name}@${pkg.version}`} className="package-row">
                <div className="col-name package-name">{pkg.name}</div>
                <div className="col-version package-version">{pkg.version}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default PackagesPopup;