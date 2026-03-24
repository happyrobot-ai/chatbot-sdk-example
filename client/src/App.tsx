import { useState, useRef, useEffect, useCallback } from "react";
import { HappyRobotChatClient } from "@happyrobot-ai/sdk/chat";
import type { ChatConnection } from "@happyrobot-ai/sdk/chat";

interface Attachment {
  file: File;
  media_id?: string;
  uploading: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: { filename: string; mime_type: string }[];
}

const SERVER_URL = "http://localhost:3001";

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const chatClientRef = useRef<HappyRobotChatClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const connectionRef = useRef<ChatConnection | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(scrollToBottom, [messages, streamingContent, scrollToBottom]);

  const connect = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${SERVER_URL}/api/chat/token`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to get chat token");
      const { token } = await res.json();

      const chatClient = new HappyRobotChatClient({ token });
      chatClientRef.current = chatClient;

      const { session_id } = await chatClient.createSession();
      sessionIdRef.current = session_id;

      const connection = chatClient.connect(session_id, {
        onConnected: () => {
          setIsConnected(true);
          setIsLoading(false);
        },
        onResponseStart: () => {
          setStreamingContent("");
        },
        onResponseChunk: (content) => {
          setStreamingContent((prev) => prev + content);
        },
        onResponseEnd: (content) => {
          setStreamingContent("");
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "assistant", content },
          ]);
        },
        onSessionClosed: (event) => {
          setIsConnected(false);
          console.log("Session closed:", event.reason);
        },
        onTokenExpired: () => {
          setIsConnected(false);
          setError("Session expired — please reconnect");
        },
        onError: () => {
          setError("WebSocket connection error");
          setIsConnected(false);
        },
        onClose: () => {
          setIsConnected(false);
        },
      });

      connectionRef.current = connection;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setIsLoading(false);
    }
  }, []);

  const endSession = useCallback(async () => {
    if (!connectionRef.current) return;
    try {
      await connectionRef.current.endSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end session");
    }
    connectionRef.current = null;
    chatClientRef.current = null;
    sessionIdRef.current = null;
    setMessages([]);
    setAttachments([]);
    setStreamingContent("");
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length || !chatClientRef.current) return;

      const newAttachments: Attachment[] = Array.from(files).map((file) => ({
        file,
        uploading: true,
      }));
      setAttachments((prev) => [...prev, ...newAttachments]);

      for (const attachment of newAttachments) {
        try {
          const result = await chatClientRef.current.uploadFile(
            attachment.file,
            attachment.file.name,
            attachment.file.type || "application/octet-stream"
          );
          setAttachments((prev) =>
            prev.map((a) =>
              a.file === attachment.file
                ? { ...a, media_id: result.media_id, uploading: false }
                : a
            )
          );
        } catch (err) {
          setError(
            `Failed to upload ${attachment.file.name}: ${err instanceof Error ? err.message : "unknown error"}`
          );
          setAttachments((prev) =>
            prev.filter((a) => a.file !== attachment.file)
          );
        }
      }

      // Reset file input so the same file can be selected again
      e.target.value = "";
    },
    []
  );

  const removeAttachment = useCallback((file: File) => {
    setAttachments((prev) => prev.filter((a) => a.file !== file));
  }, []);

  const sendMessage = useCallback(async () => {
    const content = input.trim();
    const readyAttachments = attachments.filter((a) => a.media_id && !a.uploading);
    if ((!content && readyAttachments.length === 0) || !connectionRef.current) return;

    const artifacts = readyAttachments.map((a) => ({
      media_id: a.media_id!,
      mime_type: a.file.type || "application/octet-stream",
      filename: a.file.name,
      size_bytes: a.file.size,
    }));

    setInput("");
    setAttachments([]);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: content || `Sent ${readyAttachments.length} file(s)`,
        attachments: readyAttachments.map((a) => ({
          filename: a.file.name,
          mime_type: a.file.type,
        })),
      },
    ]);

    try {
      await connectionRef.current.sendMessage({
        content: content || " ",
        ...(artifacts.length > 0 ? { artifacts } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    }
  }, [input, attachments]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  const uploading = attachments.some((a) => a.uploading);

  return (
    <div style={styles.container}>
      <div style={styles.chat}>
        <div style={styles.header}>
          <h1 style={styles.title}>Chatbot</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isConnected && (
              <button onClick={endSession} style={styles.endButton}>
                End Chat
              </button>
            )}
            <span
              style={{
                ...styles.status,
                backgroundColor: isConnected ? "#22c55e" : "#94a3b8",
              }}
            />
          </div>
        </div>

        <div style={styles.messages}>
          {!isConnected && !isLoading && (
            <div style={styles.startPrompt}>
              <button onClick={connect} style={styles.connectButton}>
                Start Chat
              </button>
            </div>
          )}

          {isLoading && (
            <div style={styles.startPrompt}>
              <p>Connecting...</p>
            </div>
          )}

          {error && <div style={styles.error}>{error}</div>}

          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                ...styles.message,
                ...(msg.role === "user" ? styles.userMessage : styles.botMessage),
              }}
            >
              <div style={styles.messageContent}>{msg.content}</div>
              {msg.attachments && msg.attachments.length > 0 && (
                <div style={styles.attachmentList}>
                  {msg.attachments.map((a, i) => (
                    <div key={i} style={styles.attachmentTag}>
                      📎 {a.filename}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {streamingContent && (
            <div style={{ ...styles.message, ...styles.botMessage }}>
              <div style={styles.messageContent}>{streamingContent}</div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {isConnected && (
          <div>
            {attachments.length > 0 && (
              <div style={styles.attachmentBar}>
                {attachments.map((a, i) => (
                  <div key={i} style={styles.attachmentChip}>
                    <span style={styles.attachmentChipText}>
                      {a.uploading ? "⏳" : "📎"} {a.file.name}
                    </span>
                    <button
                      onClick={() => removeAttachment(a.file)}
                      style={styles.removeAttachment}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={styles.inputArea}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={handleFileSelect}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={styles.attachButton}
                title="Attach files"
              >
                📎
              </button>
              <input
                style={styles.input}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                autoFocus
              />
              <button
                onClick={sendMessage}
                disabled={(!input.trim() && attachments.length === 0) || uploading}
                style={{
                  ...styles.sendButton,
                  opacity:
                    (input.trim() || attachments.length > 0) && !uploading
                      ? 1
                      : 0.5,
                }}
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "100vh",
    backgroundColor: "#f1f5f9",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    margin: 0,
    padding: 16,
    boxSizing: "border-box",
  },
  chat: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    maxWidth: 480,
    height: "100%",
    maxHeight: 700,
    backgroundColor: "#fff",
    borderRadius: 12,
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "1px solid #e2e8f0",
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
  },
  status: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    display: "inline-block",
  },
  endButton: {
    padding: "4px 12px",
    fontSize: 12,
    backgroundColor: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  startPrompt: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flex: 1,
  },
  connectButton: {
    padding: "12px 32px",
    fontSize: 16,
    backgroundColor: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  error: {
    padding: "8px 12px",
    backgroundColor: "#fef2f2",
    color: "#dc2626",
    borderRadius: 8,
    fontSize: 14,
  },
  message: {
    maxWidth: "80%",
    padding: "10px 14px",
    borderRadius: 12,
    fontSize: 14,
    lineHeight: 1.5,
    wordWrap: "break-word",
  },
  userMessage: {
    alignSelf: "flex-end",
    backgroundColor: "#3b82f6",
    color: "#fff",
  },
  botMessage: {
    alignSelf: "flex-start",
    backgroundColor: "#f1f5f9",
    color: "#1e293b",
  },
  messageContent: {
    whiteSpace: "pre-wrap",
  },
  attachmentList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 6,
  },
  attachmentTag: {
    fontSize: 12,
    opacity: 0.85,
  },
  attachmentBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    padding: "8px 16px 0",
  },
  attachmentChip: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 8px",
    backgroundColor: "#e2e8f0",
    borderRadius: 6,
    fontSize: 12,
  },
  attachmentChipText: {
    maxWidth: 150,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  removeAttachment: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 12,
    color: "#64748b",
    padding: 0,
    lineHeight: 1,
  },
  inputArea: {
    display: "flex",
    gap: 8,
    padding: "12px 16px",
    borderTop: "1px solid #e2e8f0",
  },
  attachButton: {
    background: "none",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
  },
  input: {
    flex: 1,
    padding: "10px 14px",
    fontSize: 14,
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    outline: "none",
  },
  sendButton: {
    padding: "10px 20px",
    fontSize: 14,
    backgroundColor: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
};
