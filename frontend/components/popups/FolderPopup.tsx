import React, { useState, useEffect } from 'react';

interface FileItem {
  name: string;
  type: 'file' | 'folder';
  path: string;
}

interface FolderPopupProps {
  onClose?: () => void;
}

const FolderPopup: React.FC<FolderPopupProps> = ({ onClose }) => {
  const [currentPath, setCurrentPath] = useState('.');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFiles();
  }, [currentPath]);

  const loadFiles = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const mockFiles = await getMockFileTree();
      setFiles(mockFiles);
    } catch (err) {
      setError('Failed to load files');
      console.error('Failed to load files:', err);
    } finally {
      setLoading(false);
    }
  };

  const getMockFileTree = async (): Promise<FileItem[]> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    return [
      { name: 'morecompute', type: 'folder', path: './morecompute' },
      { name: '__init__.py', type: 'file', path: './morecompute/__init__.py' },
      { name: 'notebook.py', type: 'file', path: './morecompute/notebook.py' },
      { name: 'server.py', type: 'file', path: './morecompute/server.py' },
      { name: 'static', type: 'folder', path: './morecompute/static' },
      { name: 'templates', type: 'folder', path: './morecompute/templates' },
      { name: 'assets', type: 'folder', path: './assets' },
      { name: 'README.md', type: 'file', path: './README.md' },
      { name: 'requirements.txt', type: 'file', path: './requirements.txt' },
      { name: 'setup.py', type: 'file', path: './setup.py' },
      { name: '.gitignore', type: 'file', path: './.gitignore' },
    ];
  };

  const handleItemClick = async (file: FileItem) => {
    if (file.type === 'folder') {
      navigateToFolder(file.path);
    } else {
      openFile(file.path);
    }
  };

  const navigateToFolder = async (folderPath: string) => {
    setCurrentPath(folderPath);
  };

  const openFile = (filePath: string) => {
    console.log('Opening file:', filePath);
  };

  if (loading) {
    return <div className="file-tree">Loading...</div>;
  }

  if (error) {
    return (
      <div className="error">
        <p>{error}</p>
        <button onClick={loadFiles}>Retry</button>
      </div>
    )
  }

  return (
    <div className="file-tree">
      <div className="file-path-header" style={{ padding: '8px 0', marginBottom: '12px', fontSize: '12px', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
        Current: {currentPath}
      </div>
      {files.map((file, index) => (
        <div key={index} className="file-item" onClick={() => handleItemClick(file)}>
          <img 
            src={`/assets/icons/${file.type === 'folder' ? 'folder.svg' : 'folder.svg'}`} // Placeholder for file icon
            alt={file.type}
            className="file-icon"
            style={file.type === 'file' ? { opacity: '0.5' } : {}}
          />
          <span className="file-name">{file.name}</span>
        </div>
      ))}
    </div>
  );
};

export default FolderPopup;