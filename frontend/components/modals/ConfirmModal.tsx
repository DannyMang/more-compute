import React from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDangerous?: boolean;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDangerous = false,
}) => {
  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "#1a1a1a",
          borderRadius: "8px",
          padding: "24px",
          maxWidth: "500px",
          width: "90%",
          maxHeight: "80vh",
          overflow: "auto",
          border: "2px solid #444",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.8)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {isDangerous && <AlertTriangle size={20} color="#ffc107" />}
            <h2
              style={{
                margin: 0,
                fontSize: "18px",
                fontWeight: 600,
                color: isDangerous ? "#ffc107" : "#e0e0e0",
              }}
            >
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              color: "#999",
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div
          style={{
            marginBottom: "20px",
            fontSize: "14px",
            lineHeight: "1.6",
            whiteSpace: "pre-line",
            color: "#e0e0e0",
          }}
        >
          {message}
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px",
              backgroundColor: "#2a2a2a",
              color: "#e0e0e0",
              border: "1px solid #444",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: "10px 20px",
              backgroundColor: isDangerous ? "#dc2626" : "#4a9eff",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
