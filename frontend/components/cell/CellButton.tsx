'use client';

import React, { useState } from 'react';

interface CellButtonProps {
  icon: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
}

export const CellButton: React.FC<CellButtonProps> = ({
  icon,
  onClick,
  title,
  disabled = false,
  isLoading = false,
  className = ''
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    if (onClick && !disabled) {
      // Allow clicks even when loading (for stop/interrupt functionality)
      onClick(e);
    }
  };

  return (
    <button
      type="button"
      className={`cell-button ${className}`}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={disabled}
      title={title}
      style={{
        width: '28px',
        height: '28px',
        border: '1px solid var(--mc-border)',
        borderRadius: '4px',
        backgroundColor: isHovered ? 'var(--mc-secondary)' : 'var(--mc-cell-background)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background-color 0.15s ease',
        opacity: disabled ? 0.5 : isLoading ? 0.8 : 1
      }}
    >
      {icon}
    </button>
  );
};

export default CellButton;
