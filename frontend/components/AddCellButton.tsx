'use client';

import React from 'react';

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
      <img src="/assets/icons/add.svg" alt="Add cell" />
      <div className="cell-type-menu">
        <button
          type="button"
          className="cell-type-option"
          data-type="code"
          onClick={(e) => handleAdd('code', e)}
        >
          Code
        </button>
        <button
          type="button"
          className="cell-type-option"
          data-type="markdown"
          onClick={(e) => handleAdd('markdown', e)}
        >
          Text
        </button>
      </div>
    </div>
  );
};

export default AddCellButton;
