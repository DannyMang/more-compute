"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import type {
  ClaudeMessage,
  ProposedEdit,
  ClaudeState,
  ClaudeActions,
  ClaudeModel,
} from "@/types/claude";

interface ClaudeContextType extends ClaudeState, ClaudeActions {}

const ClaudeContext = createContext<ClaudeContextType | undefined>(undefined);

export const useClaude = () => {
  const context = useContext(ClaudeContext);
  if (!context) {
    throw new Error("useClaude must be used within a ClaudeProvider");
  }
  return context;
};

interface ClaudeProviderProps {
  children: React.ReactNode;
}

export const ClaudeProvider: React.FC<ClaudeProviderProps> = ({ children }) => {
  const [messages, setMessages] = useState<ClaudeMessage[]>([]);
  const [pendingEdits, setPendingEdits] = useState<Map<number, ProposedEdit>>(
    new Map()
  );
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModelState] = useState<ClaudeModel>("sonnet");

  const wsRef = useRef<WebSocket | null>(null);
  const currentMessageRef = useRef<string>("");
  const currentMessageIdRef = useRef<string | null>(null);

  // Check if Claude is configured on mount
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const response = await fetch("/api/claude/config");
        if (response.ok) {
          const data = await response.json();
          setIsConfigured(data.configured);
        }
      } catch (e) {
        console.error("[Claude] Failed to check config:", e);
      }
    };
    checkConfig();
  }, []);

  // Connect to WebSocket for Claude messages
  useEffect(() => {
    const connectWebSocket = () => {
      const ws = new WebSocket("ws://127.0.0.1:3141/ws");

      ws.onopen = () => {
        // WebSocket connected
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        } catch (err) {
          console.error("[Claude] Failed to parse message:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("[Claude] WebSocket error:", error);
      };

      ws.onclose = () => {
        wsRef.current = null;
        // Reconnect after a delay
        setTimeout(connectWebSocket, 2000);
      };

      wsRef.current = ws;
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleWebSocketMessage = useCallback((message: any) => {
    switch (message.type) {
      case "claude_stream_start":
        currentMessageIdRef.current = message.data.messageId;
        currentMessageRef.current = "";
        setIsLoading(true);
        setError(null);

        // Add a new assistant message that will be updated
        setMessages((prev) => [
          ...prev,
          {
            id: message.data.messageId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            isStreaming: true,
          },
        ]);
        break;

      case "claude_stream_chunk":
        if (message.data.messageId === currentMessageIdRef.current) {
          currentMessageRef.current += message.data.chunk;

          // Update the message with new content
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === currentMessageIdRef.current
                ? { ...msg, content: currentMessageRef.current }
                : msg
            )
          );
        }
        break;

      case "claude_stream_end":
        if (message.data.messageId === currentMessageIdRef.current) {
          const proposedEdits = message.data.proposedEdits || [];

          // Update the message with final content and edits
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === currentMessageIdRef.current
                ? {
                    ...msg,
                    content: message.data.fullResponse,
                    isStreaming: false,
                    proposedEdits: proposedEdits.map((e: any) => ({
                      id: e.id,
                      cellIndex: e.cellIndex,
                      originalCode: e.originalCode,
                      newCode: e.newCode,
                      explanation: e.explanation,
                      status: "pending" as const,
                    })),
                  }
                : msg
            )
          );

          // Add pending edits to the map
          const newPendingEdits = new Map<number, ProposedEdit>();
          for (const edit of proposedEdits) {
            newPendingEdits.set(edit.cellIndex, {
              id: edit.id,
              cellIndex: edit.cellIndex,
              originalCode: edit.originalCode,
              newCode: edit.newCode,
              explanation: edit.explanation,
              status: "pending",
            });
          }
          setPendingEdits(newPendingEdits);

          setIsLoading(false);
          currentMessageIdRef.current = null;
        }
        break;

      case "claude_error":
        setError(message.data.error);
        setIsLoading(false);
        currentMessageIdRef.current = null;
        break;

      case "claude_edit_applied":
        // Update the edit status
        setPendingEdits((prev) => {
          const next = new Map(prev);
          const edit = Array.from(prev.values()).find(
            (e) => e.id === message.data.editId
          );
          if (edit) {
            next.delete(edit.cellIndex);
          }
          return next;
        });

        // Update message edit status
        setMessages((prev) =>
          prev.map((msg) => ({
            ...msg,
            proposedEdits: msg.proposedEdits?.map((e) =>
              e.id === message.data.editId ? { ...e, status: "applied" as const } : e
            ),
          }))
        );
        break;

      case "claude_edit_rejected":
        // Update the edit status
        setPendingEdits((prev) => {
          const next = new Map(prev);
          const edit = Array.from(prev.values()).find(
            (e) => e.id === message.data.editId
          );
          if (edit) {
            next.delete(edit.cellIndex);
          }
          return next;
        });

        // Update message edit status
        setMessages((prev) =>
          prev.map((msg) => ({
            ...msg,
            proposedEdits: msg.proposedEdits?.map((e) =>
              e.id === message.data.editId ? { ...e, status: "rejected" as const } : e
            ),
          }))
        );
        break;
    }
  }, []);

  const sendMessage = useCallback(
    (message: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setError("Not connected to server");
        return;
      }

      if (!message.trim()) {
        return;
      }

      // Add user message to history
      const userMessage: ClaudeMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: message,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Build history for context
      const history = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Send to backend
      wsRef.current.send(
        JSON.stringify({
          type: "claude_message",
          data: {
            message,
            history,
            model,
          },
        })
      );
    },
    [messages, model]
  );

  const applyEdit = useCallback((editId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Not connected to server");
      return;
    }

    // Find the edit
    const edit = Array.from(pendingEdits.values()).find((e) => e.id === editId);
    if (!edit) {
      return;
    }

    wsRef.current.send(
      JSON.stringify({
        type: "claude_apply_edit",
        data: {
          editId,
          cellIndex: edit.cellIndex,
          newCode: edit.newCode,
        },
      })
    );
  }, [pendingEdits]);

  const rejectEdit = useCallback((editId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Not connected to server");
      return;
    }

    wsRef.current.send(
      JSON.stringify({
        type: "claude_reject_edit",
        data: {
          editId,
        },
      })
    );
  }, []);

  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => !prev);
  }, []);

  const openPanel = useCallback(() => {
    setIsPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setPendingEdits(new Map());
    setError(null);
  }, []);

  const setModel = useCallback((newModel: ClaudeModel) => {
    setModelState(newModel);
  }, []);

  const setApiKey = useCallback(async (apiKey: string): Promise<boolean> => {
    try {
      const response = await fetch("/api/claude/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ api_key: apiKey }),
      });

      if (response.ok) {
        setIsConfigured(true);
        setError(null);
        return true;
      } else {
        const data = await response.json();
        setError(data.detail || "Failed to save API key");
        return false;
      }
    } catch (e) {
      setError("Failed to connect to server");
      return false;
    }
  }, []);

  const value: ClaudeContextType = {
    messages,
    pendingEdits,
    isPanelOpen,
    isLoading,
    isConfigured,
    error,
    model,
    sendMessage,
    applyEdit,
    rejectEdit,
    togglePanel,
    openPanel,
    closePanel,
    clearHistory,
    setApiKey,
    setModel,
  };

  return (
    <ClaudeContext.Provider value={value}>{children}</ClaudeContext.Provider>
  );
};
