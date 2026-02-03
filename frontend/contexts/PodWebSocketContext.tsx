"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { PodResponse } from '@/lib/api';

export interface GPUPod {
  id: string;
  name: string;
  status: "running" | "stopped" | "starting";
  gpuType: string;
  region: string;
  costPerHour: number;
  sshConnection: string | null;
  provider?: string;  // Provider name (e.g., "runpod", "lambda_labs", "prime_intellect")
  gpuCount?: number;  // Number of GPUs
}

export type ConnectionState = 'provisioning' | 'deploying' | 'connected' | null;

interface PodWebSocketContextType {
  gpuPods: GPUPod[];
  isConnected: boolean;
  updatePod: (pod: GPUPod) => void;
  setPods: (pods: GPUPod[]) => void;
  addPod: (pod: GPUPod) => void;
  removePod: (podId: string) => void;
  registerAutoConnect: (podId: string, callback: (podId: string) => void) => void;
  connectionState: ConnectionState;
  connectingPodId: string | null;
  connectedPodId: string | null;
  setConnectionState: (state: ConnectionState) => void;
  setConnectingPodId: (podId: string | null) => void;
  setConnectedPodId: (podId: string | null) => void;
}

const PodWebSocketContext = createContext<PodWebSocketContextType | undefined>(undefined);

export const usePodWebSocket = () => {
  const context = useContext(PodWebSocketContext);
  if (!context) {
    throw new Error('usePodWebSocket must be used within a PodWebSocketProvider');
  }
  return context;
};

interface PodWebSocketProviderProps {
  children: React.ReactNode;
}

export const PodWebSocketProvider: React.FC<PodWebSocketProviderProps> = ({ children }) => {
  const [gpuPods, setGpuPods] = useState<GPUPod[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>(null);
  const [connectingPodId, setConnectingPodId] = useState<string | null>(null);
  const [connectedPodId, setConnectedPodId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const autoConnectCallbacksRef = useRef<Map<string, (podId: string) => void>>(new Map());

  const updatePod = useCallback((updatedPod: GPUPod) => {
    setGpuPods((prevPods) => {
      const existingIndex = prevPods.findIndex((p) => p.id === updatedPod.id);
      if (existingIndex >= 0) {
        const newPods = [...prevPods];
        newPods[existingIndex] = updatedPod;
        return newPods;
      } else {
        return [...prevPods, updatedPod];
      }
    });
  }, []);

  const setPods = useCallback((pods: GPUPod[]) => {
    setGpuPods(pods);
  }, []);

  const addPod = useCallback((pod: GPUPod) => {
    setGpuPods((prevPods) => {
      const exists = prevPods.some((p) => p.id === pod.id);
      if (exists) {
        return prevPods.map((p) => (p.id === pod.id ? pod : p));
      }
      return [...prevPods, pod];
    });
  }, []);

  const removePod = useCallback((podId: string) => {
    setGpuPods((prevPods) => prevPods.filter((p) => p.id !== podId));
  }, []);

  const connectWebSocket = useCallback(() => {
    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsUrl = 'ws://127.0.0.1:3141/ws';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "pod_status_update" && message.data) {
          const podData = message.data;

          // Map API status to UI status
          let uiStatus: "running" | "stopped" | "starting" = "stopped";
          const isFullyReady = podData.status === "ACTIVE" && podData.ssh_connection;

          if (isFullyReady) {
            uiStatus = "running";
          } else if (podData.status === "ACTIVE" || podData.status === "PROVISIONING" || podData.status === "PENDING" || podData.status === "STARTING") {
            uiStatus = "starting";
          }

          // Check for auto-connect callback - do this OUTSIDE of setGpuPods to avoid closure issues
          const callback = autoConnectCallbacksRef.current.get(podData.pod_id);
          if (callback && isFullyReady) {
            autoConnectCallbacksRef.current.delete(podData.pod_id);
            setTimeout(() => {
              callback(podData.pod_id);
            }, 5000);
          }

          // Update pod in the list
          setGpuPods((prevPods) => {
            const existingPodIndex = prevPods.findIndex((p) => p.id === podData.pod_id);

            if (existingPodIndex >= 0) {
              // Update existing pod
              const updatedPods = [...prevPods];

              updatedPods[existingPodIndex] = {
                id: podData.pod_id,
                name: podData.name,
                status: uiStatus,
                gpuType: podData.gpu_name,
                region: prevPods[existingPodIndex].region,
                costPerHour: podData.price_hr,
                sshConnection: podData.ssh_connection || null,
                provider: podData.provider || prevPods[existingPodIndex].provider,
                gpuCount: podData.gpu_count || prevPods[existingPodIndex].gpuCount,
              };

              return updatedPods;
            } else {
              // Add new pod if not in list
              return [
                ...prevPods,
                {
                  id: podData.pod_id,
                  name: podData.name,
                  status: uiStatus,
                  gpuType: podData.gpu_name,
                  region: "Unknown",
                  costPerHour: podData.price_hr,
                  sshConnection: podData.ssh_connection || null,
                  provider: podData.provider,
                  gpuCount: podData.gpu_count,
                },
              ];
            }
          });
        }
      } catch (err) {
        console.error('[PodWebSocket] Failed to parse message:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('[PodWebSocket] Error:', error);
      setIsConnected(false);
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;

      // Attempt to reconnect with exponential backoff
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connectWebSocket();
        }, delay);
      }
    };

    wsRef.current = ws;
  }, []);

  // Register auto-connect callback
  const registerAutoConnect = useCallback((podId: string, callback: (podId: string) => void) => {
    autoConnectCallbacksRef.current.set(podId, callback);
  }, []);

  // Expose registerAutoConnect through context
  const contextValue: PodWebSocketContextType = React.useMemo(() => ({
    gpuPods,
    isConnected,
    updatePod,
    setPods,
    addPod,
    removePod,
    registerAutoConnect,
    connectionState,
    connectingPodId,
    connectedPodId,
    setConnectionState,
    setConnectingPodId,
    setConnectedPodId,
  }), [gpuPods, isConnected, updatePod, setPods, addPod, removePod, registerAutoConnect, connectionState, connectingPodId, connectedPodId]);

  useEffect(() => {
    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  return (
    <PodWebSocketContext.Provider value={contextValue}>
      {children}
    </PodWebSocketContext.Provider>
  );
};
