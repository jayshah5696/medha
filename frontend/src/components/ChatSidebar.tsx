import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../store";
import { getChats, getChat } from "../lib/api";
import type { ChatMessage as ApiChatMessage } from "../lib/api";
import ContextPill from "./ContextPill";
import type { ToolStepData } from "./ToolStep";
import ThinkingBlock from "./ThinkingBlock";

interface ChatSettings {
  model_chat: string;
  agent_profile: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function ChatSidebar({ width }: { width: number }) {
  const { activeFiles, currentThreadId, setThreadId, chatHistory, setChatHistory, setEditorContent, setQueryResult, setLastError, setAgentLastQuery, bumpHistoryVersion } = useStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolSteps, setToolSteps] = useState<ToolStepData[]>([]);
  const [hitlWarning, setHitlWarning] = useState<string | null>(null);
  const toolStartTimes = useRef<Record<string, number>>({});
  const [threadsOpen, setThreadsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [chatSettings, setChatSettings] = useState<ChatSettings>({
    model_chat: "openai/gpt-4o-mini",
    agent_profile: "default",
  });

  // Priority-8: fetch settings so we send model/profile with each chat request
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setChatSettings({
          model_chat: data.model_chat || "openai/gpt-4o-mini",
          agent_profile: data.agent_profile || "default",
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolSteps]);

  const loadThreadList = async () => {
    try {
      const threads = await getChats();
      setChatHistory(threads);
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    if (threadsOpen) {
      loadThreadList();
    }
  }, [threadsOpen]);

  const handleLoadThread = async (slug: string) => {
    try {
      const thread = await getChat(slug);
      const msgs: ChatMessage[] = thread.messages
        .filter((m: ApiChatMessage) => m.role === "user" || m.role === "assistant")
        .map((m: ApiChatMessage) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
      setMessages(msgs);
      setThreadId(slug);
    } catch {
      // silently fail
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setThreadId(null);
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);
    setToolSteps([]);
    toolStartTimes.current = {};

    let assistantContent = "";

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          active_files: activeFiles,
          thread_id: currentThreadId || "",
          model: chatSettings.model_chat,
          profile: chatSettings.agent_profile,
        }),
      });

      if (!res.ok) {
        throw new Error(`Chat error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === "token") {
              assistantContent += event.content;
              setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                  updated[lastIdx] = {
                    role: "assistant",
                    content: assistantContent,
                  };
                } else {
                  updated.push({
                    role: "assistant",
                    content: assistantContent,
                  });
                }
                return updated;
              });
            } else if (event.type === "tool_call") {
              if (event.status === "start") {
                const stepId = `${event.tool}-${Date.now()}`;
                toolStartTimes.current[event.tool] = Date.now();
                setToolSteps((prev) => [
                  ...prev,
                  { id: stepId, tool: event.tool, status: "running" },
                ]);
              } else if (event.status === "end") {
                const startTime = toolStartTimes.current[event.tool];
                const durationMs = startTime ? Date.now() - startTime : undefined;
                delete toolStartTimes.current[event.tool];
                setToolSteps((prev) =>
                  prev.map((s) =>
                    s.tool === event.tool && s.status === "running"
                      ? { ...s, status: "done" as const, durationMs }
                      : s
                  )
                );
              }
            } else if (event.type === "hitl") {
              setHitlWarning(event.message);
            } else if (event.type === "query_result") {
              // Agent executed a query — push result to grid but DON'T
              // overwrite the user's editor content. Store the agent's
              // SQL separately so the user can load it if they want.
              if (event.sql) setAgentLastQuery(event.sql);
              if (event.result) setQueryResult(event.result);
              setLastError(null);  // Clear stale errors from previous manual queries
              bumpHistoryVersion(); // Refresh history sidebar
            } else if (event.type === "thread_id") {
              setThreadId(event.slug);
              loadThreadList();
            } else if (event.type === "error") {
              assistantContent += `\n\nError: ${event.message}`;
              setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                  updated[lastIdx] = {
                    role: "assistant",
                    content: assistantContent,
                  };
                } else {
                  updated.push({
                    role: "assistant",
                    content: assistantContent,
                  });
                }
                return updated;
              });
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
    } finally {
      setIsStreaming(false);
      // Mark any remaining running steps as done
      setToolSteps((prev) =>
        prev.map((s) =>
          s.status === "running" ? { ...s, status: "done" as const } : s
        )
      );
    }
  };

  return (
    <div
      style={{
        width: width,
        minWidth: width,
        background: "var(--bg-secondary)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "0 10px",
          height: 28,
          minHeight: 28,
          borderBottom: "1px solid var(--border)",
          fontSize: 'var(--font-size-sm)',
          fontWeight: 500,
          textTransform: "uppercase",
          color: "var(--text-dimmed)",
          letterSpacing: "0.08em",
          fontFamily: "var(--font-ui)",
          fontVariant: "small-caps",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 'var(--font-size-sm)', letterSpacing: "0.15em", color: "#444" }}>assistant</span>
        <button
          onClick={handleNewChat}
          className="medha-btn"
          style={{
            fontSize: 'var(--font-size-sm)',
            padding: "1px 8px",
            lineHeight: 1.4,
          }}
        >
          new
        </button>
      </div>

      {/* Threads panel */}
      <div style={{ borderBottom: "1px solid var(--border)" }}>
        <div
          onClick={() => setThreadsOpen(!threadsOpen)}
          style={{
            padding: "5px 10px",
            fontSize: 'var(--font-size-sm)',
            fontWeight: 500,
            textTransform: "uppercase",
            color: "var(--text-dimmed)",
            letterSpacing: "0.08em",
            fontFamily: "var(--font-ui)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            userSelect: "none",
          }}
        >
          <span style={{ fontSize: 'var(--font-size-xs)' }}>{threadsOpen ? "\u25BC" : "\u25B6"}</span>
          <span style={{ fontSize: 'var(--font-size-sm)', letterSpacing: "0.15em", color: "#444" }}>threads</span>
        </div>
        {threadsOpen && (
          <div style={{ maxHeight: 160, overflow: "auto" }}>
            {chatHistory.length === 0 && (
              <div
                style={{
                  padding: "10px 10px",
                  fontSize: 'var(--font-size-base)',
                  color: "#333",
                  fontFamily: "var(--font-mono)",
                  textAlign: "center",
                }}
              >
                No saved threads yet.
              </div>
            )}
            {chatHistory.map((thread) => (
              <div
                key={thread.slug}
                onClick={() => handleLoadThread(thread.slug)}
                style={{
                  padding: "4px 10px",
                  cursor: "pointer",
                  background: currentThreadId === thread.slug ? "var(--bg-tertiary)" : "transparent",
                  borderLeft: currentThreadId === thread.slug ? "2px solid var(--accent)" : "2px solid transparent",
                }}
              >
                <div
                  style={{
                    fontSize: 'var(--font-size-base)',
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {thread.slug}
                </div>
                <div
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    color: "var(--text-dimmed)",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  {thread.created_at?.slice(0, 10)} / {thread.model}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              color: "#333",
              fontSize: 'var(--font-size-base)',
              textAlign: "center",
              marginTop: 24,
              fontFamily: "var(--font-mono)",
            }}
          >
            ask about your data
          </div>
        )}

        {messages.map((msg, i) => {
          // Determine if the thinking block should render before this message.
          // It goes right before the LAST assistant message (the response that
          // follows the tool calls). During streaming, it goes before the
          // currently-streaming assistant message.
          const isLastAssistant =
            msg.role === "assistant" &&
            toolSteps.length > 0 &&
            // Only show before the last assistant message in the sequence
            (i === messages.length - 1 ||
              !messages.slice(i + 1).some((m) => m.role === "assistant"));

          return (
            <div key={i}>
              {/* ThinkingBlock renders before the assistant response */}
              {isLastAssistant && (
                <ThinkingBlock steps={toolSteps} isStreaming={isStreaming} />
              )}

              <div
                style={{
                  textAlign: msg.role === "user" ? ("right" as const) : ("left" as const),
                }}
              >
                <div
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.15em",
                    marginBottom: 2,
                    fontFamily: "var(--font-mono)",
                    color: msg.role === "user" ? "#00D8FF" : "#555",
                  }}
                >
                  {msg.role === "user" ? "you" : "medha"}
                </div>
                <div
                  style={{
                    padding: "6px 10px",
                    fontSize: 'var(--font-size-md)',
                    lineHeight: 1.5,
                    fontFamily: "var(--font-mono)",
                    borderRadius: 0,
                    ...(msg.role === "user"
                      ? {
                          borderLeft: "2px solid #00D8FF",
                          background: "rgba(0, 216, 255, 0.04)",
                          color: "var(--text-primary)",
                        }
                      : {
                          borderLeft: "2px solid #1a1a1f",
                          background: "rgba(255, 255, 255, 0.02)",
                          color: "var(--text-primary)",
                        }),
                  }}
                >
                  {msg.role === "assistant" ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ className, children, ...props }) {
                          const codeText = String(children).replace(/\n$/, "");
                          const isBlock = className?.startsWith("language-");
                          if (!isBlock) return <code {...props}>{children}</code>;
                          return (
                            <div style={{ position: "relative", marginTop: 4 }}>
                              <pre style={{
                                background: "var(--bg-tertiary)",
                                padding: "8px 10px",
                                fontSize: 'var(--font-size-xs)',
                                overflow: "auto",
                                border: "1px solid var(--border)",
                              }}>
                                <code>{codeText}</code>
                              </pre>
                              <button
                                onClick={() => setEditorContent(codeText)}
                                title="Copy to SQL Editor"
                                style={{
                                  position: "absolute",
                                  top: 4,
                                  right: 4,
                                  fontSize: 'var(--font-size-xs)',
                                  padding: "2px 6px",
                                  background: "var(--bg-elevated)",
                                  border: "1px solid var(--border)",
                                  color: "var(--accent)",
                                  cursor: "pointer",
                                  fontFamily: "var(--font-mono)",
                                  textTransform: "uppercase" as const,
                                  letterSpacing: "0.08em",
                                }}
                              >
                                → editor
                              </button>
                            </div>
                          );
                        },
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Show thinking block at the end when tools are running but no assistant message yet */}
        {toolSteps.length > 0 &&
          !messages.some((m) => m.role === "assistant") &&
          isStreaming && (
            <ThinkingBlock steps={toolSteps} isStreaming={isStreaming} />
          )}

        <div ref={messagesEndRef} />
      </div>

      {/* HITL warning banner (Spec §4E) */}
      {hitlWarning && (
        <div
          style={{
            padding: "8px 10px",
            margin: "0 8px 4px",
            background: "rgba(251, 191, 36, 0.08)",
            borderLeft: "2px solid #fbbf24",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-mono)",
            color: "#fbbf24",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            large query warning
          </div>
          <div style={{ color: "var(--text-secondary)", marginBottom: 6 }}>
            {hitlWarning}
          </div>
          <button
            onClick={() => setHitlWarning(null)}
            className="medha-btn"
            style={{ fontSize: "var(--font-size-sm)", padding: "2px 8px" }}
          >
            dismiss
          </button>
        </div>
      )}

      {/* Input */}
      <div
        style={{
          padding: "8px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <ContextPill inputText={input} />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="ask..."
          disabled={isStreaming}
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: 'var(--font-size-base)',
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderRadius: 0,
            color: "var(--text-primary)",
            outline: "none",
            fontFamily: "var(--font-mono)",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
        />
      </div>
    </div>
  );
}
