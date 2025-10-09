'use client';

import React from 'react';
import { CodeIcon, PlusIcon, TextIcon } from '@radix-ui/react-icons';

interface AddCellButtonProps {
  onAddCell: (type: 'code' | 'markdown') => void;
}

export const AddCellButton: React.FC<AddCellButtonProps> = ({ onAddCell }) => {
  const handleAdd = (type: 'code' | 'markdown', e: React.MouseEvent) => {
    e.stopPropagation();
    onAddCell(type);
  };

  return (
    <div className="add-cell-button">
      <div className="cell-type-menu">
        <button
          type="button"
          className="cell-type-option"
          data-type="code"
          onClick={(e) => handleAdd('code', e)}
        >
          <CodeIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          className="cell-type-option"
          data-type="markdown"
          onClick={(e) => handleAdd('markdown', e)}
        >
          <TextIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default AddCellButton;
