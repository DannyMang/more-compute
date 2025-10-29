import React from "react";
import { ExternalLink, X } from "lucide-react";

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  actionLabel?: string;
  actionUrl?: string;
}

const ErrorModal: React.FC<ErrorModalProps> = ({
  isOpen,
  onClose,
  title,
  message,
  actionLabel,
  actionUrl,
}) => {
  if (!isOpen) return null;

  const handleAction = () => {
    if (actionUrl) {
      window.open(actionUrl, "_blank");
    }
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
          <h2
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: 600,
              color: "#ff6b6b",
            }}
          >
            {title}
          </h2>
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
          {actionUrl && actionLabel && (
            <button
              onClick={handleAction}
              style={{
                padding: "10px 20px",
                backgroundColor: "#4a9eff",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {actionLabel}
              <ExternalLink size={16} />
            </button>
          )}
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
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ErrorModal;
