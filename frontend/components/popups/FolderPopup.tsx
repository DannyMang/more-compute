import React, { useState, useEffect } from 'react';
import { Folder as FolderIcon, File as FileIcon, ArrowLeft, ArrowUp } from 'lucide-react';
import { fetchFileTree, fetchFilePreview, type FileTreeItem } from '@/lib/api';

interface FolderPopupProps {
  onClose?: () => void;
}

type ViewState = 'list' | 'preview';

const FolderPopup: React.FC<FolderPopupProps> = () => {
  const [currentPath, setCurrentPath] = useState<string>('.');
  const [rootPath, setRootPath] = useState<string>('');
  const [items, setItems] = useState<FileTreeItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [viewState, setViewState] = useState<ViewState>('list');
  const [selectedFile, setSelectedFile] = useState<FileTreeItem | null>(null);
  const [filePreview, setFilePreview] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    void loadDirectory(currentPath);
  }, [currentPath]);

  const loadDirectory = async (path: string) => {
    setLoading(true);
    setError(null);
    setViewState('list');
    try {
      const data = await fetchFileTree(path);
      setRootPath(data.root);
      setCurrentPath(data.path);
      setItems(data.items);
    } catch (err: any) {
      console.error('Failed to load files:', err);
      setError(err.message || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = async (item: FileTreeItem) => {
    if (item.type === 'directory') {
      setSelectedFile(null);
      setFilePreview('');
      setPreviewError(null);
      await loadDirectory(item.path);
    } else {
      await openFile(item);
    }
  };

  const openFile = async (item: FileTreeItem) => {
    setSelectedFile(item);
    setViewState('preview');
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const text = await fetchFilePreview(item.path);
      setFilePreview(text);
    } catch (err: any) {
      console.error('Failed to load file:', err);
      setPreviewError(err.message || 'Failed to load file');
    } finally {
      setPreviewLoading(false);
    }
  };

  const navigateUp = () => {
    if (currentPath === '.' || currentPath === '') {
      return;
    }
    const parts = currentPath.split('/');
    parts.pop();
    const parent = parts.join('/') || '.';
    setCurrentPath(parent);
  };

  const renderToolbar = () => (
    <div className="file-toolbar">
      {viewState === 'preview' && (
        <button type="button" className="file-toolbar-btn" onClick={() => setViewState('list')} aria-label="Back to files">
          <ArrowLeft size={16} />
        </button>
      )}
      {!(currentPath === '.' || currentPath === '') && (
        <button type="button" className="file-toolbar-btn" onClick={navigateUp} aria-label="Up one directory">
          <ArrowUp size={16} />
        </button>
      )}
    </div>
  );

  const renderList = () => {
    if (loading) {
      return <div className="file-tree">Loading…</div>;
    }

    if (error) {
      return (
        <div className="error">
          <p>{error}</p>
          <button type="button" onClick={() => void loadDirectory(currentPath)}>Retry</button>
        </div>
      );
    }

    if (!items.length) {
      return <div className="file-tree empty">No files found in this directory.</div>;
    }

    return (
      <div className="file-tree">
        <div className="file-list">
          {items.map((item) => (
            <div
              key={item.path}
              className={`file-item ${item.type}`}
              onClick={() => void handleItemClick(item)}
            >
              {item.type === 'directory' ? (
                <FolderIcon className="file-icon" size={18} />
              ) : (
                <FileIcon className="file-icon" size={18} />
              )}
              <div className="file-meta">
                <span className="file-name">{item.name}</span>
                <span className="file-details">
                  {item.type === 'directory' ? 'Folder' : 'File'}
                  {item.size !== undefined ? ` · ${item.size} bytes` : ''}
                  {item.modified ? ` · ${new Date(item.modified).toLocaleString()}` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderPreview = () => {
    if (!selectedFile) return null;

    return (
      <div className="file-preview">
        <div className="file-preview-body">
          {previewLoading ? (
            <div className="file-preview-loading">Loading preview…</div>
          ) : previewError ? (
            <div className="error">{previewError}</div>
          ) : (
            <pre className="file-preview-content">{filePreview}</pre>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="file-browser">
      {renderToolbar()}
      <div className="file-tree-container">
        {viewState === 'list' ? renderList() : renderPreview()}
      </div>
    </div>
  );
};

export default FolderPopup;
