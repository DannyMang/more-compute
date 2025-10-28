"use client";

import React from "react";
import {
  usePodWebSocket,
  ConnectionState,
} from "@/contexts/PodWebSocketContext";

interface ConnectionBannerProps {
  connectionState: ConnectionState;
  podName?: string;
}

export const ConnectionBanner: React.FC<ConnectionBannerProps> = ({
  connectionState,
  podName,
}) => {
  if (!connectionState) return null;

  const getMessage = () => {
    switch (connectionState) {
      case "provisioning":
        return "PROVISIONING GPU";
      case "deploying":
        return "Deploying worker...";
      case "connected":
        return "Connected!";
      default:
        return null;
    }
  };

  const message = getMessage();
  if (!message) return null;

  return (
    <div className={`connection-banner ${connectionState}`}>
      <span className="connection-status-text">{message}</span>
    </div>
  );
};
