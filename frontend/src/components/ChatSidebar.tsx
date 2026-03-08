import { useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight } from "lucide-react";
import { useStore } from "../store";
import { getChats, getChat } from "../lib/api";
import type { ChatMessage as ApiChatMessage } from "../lib/api";
import ContextPill from "./ContextPill";
import type { ToolStepData } from "./ToolStep";
import ThinkingBlock from "./ThinkingBlock";
import "./ChatSidebar.css";

interface ChatSettings {
  model_chat: string;
  agent_profile: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tool_steps?: ToolStepData[];
}

export default function ChatSidebar({ width }: { width: number }) {
  const { activeFiles, files, addActiveFile, currentThreadId, setThreadId, chatHistory, setChatHistory, setEditorContent, setQueryResult, setLastError, setAgentLastQuery, bumpHistoryVersion } = useStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [hitlWarning, setHitlWarning] = useState<string | null>(null);
  const toolStartTimes = useRef<Record<string, number>>({});
  const [threadsOpen, setThreadsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [chatSettings, setChatSettings] = useState<ChatSettings>({
    model_chat: "openai/gpt-4o-mini",
    agent_profile: "default",
  });

  // @-mention autocomplete state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);

  const mentionFiles = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.toLowerCase();
    return files.filter((f) => !q || f.name.toLowerCase().includes(q));
  }, [mentionOpen, mentionQuery, files]);

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
  }, [messages]);

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
          tool_steps: m.tool_steps as ToolStepData[] | undefined,
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

  const handleInputChange = (value: string) => {
    setInput(value);
    // Detect @-mention trigger
    const atMatch = value.match(/@(\S*)$/);
    if (atMatch) {
      setMentionOpen(true);
      setMentionQuery(atMatch[1]);
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
      setMentionQuery("");
    }
  };

  const handleMentionSelect = (fileName: string) => {
    // Remove the @query from input text
    const newInput = input.replace(/@\S*$/, "").trimEnd();
    setInput(newInput);
    addActiveFile(fileName);
    setMentionOpen(false);
    setMentionQuery("");
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const initialAssistantMsg: ChatMessage = { role: "assistant", content: "", tool_steps: [] };
    setMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    setInput("");
    setIsStreaming(true);
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
                    ...updated[lastIdx],
                    content: assistantContent,
                  };
                }
                return updated;
              });
            } else if (event.type === "tool_call") {
              if (event.status === "start") {
                const stepId = `${event.tool}-${Date.now()}`;
                toolStartTimes.current[event.tool] = Date.now();
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                    const currentSteps = updated[lastIdx].tool_steps || [];
                    updated[lastIdx] = {
                      ...updated[lastIdx],
                      tool_steps: [...currentSteps, { id: stepId, tool: event.tool, status: "running" }],
                    };
                  }
                  return updated;
                });
              } else if (event.status === "end") {
                const startTime = toolStartTimes.current[event.tool];
                const durationMs = startTime ? Date.now() - startTime : undefined;
                delete toolStartTimes.current[event.tool];
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                    const currentSteps = updated[lastIdx].tool_steps || [];
                    updated[lastIdx] = {
                      ...updated[lastIdx],
                      tool_steps: currentSteps.map((s) =>
                        s.tool === event.tool && s.status === "running"
                          ? { ...s, status: "done" as const, durationMs }
                          : s
                      ),
                    };
                  }
                  return updated;
                });
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
                    ...updated[lastIdx],
                    content: assistantContent,
                  };
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
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
          const currentSteps = updated[lastIdx].tool_steps || [];
          updated[lastIdx] = {
            ...updated[lastIdx],
            tool_steps: currentSteps.map((s) =>
              s.status === "running" ? { ...s, status: "done" as const } : s
            ),
          };
        }
        return updated;
      });
    }
  };

  return (
    <div
      className="cs-root"
      style={{ width, minWidth: width }}
    >
      {/* Header */}
      <div className="cs-header">
        <span className="cs-header-label">assistant</span>
        <button
          onClick={handleNewChat}
          className="medha-btn cs-new-btn"
        >
          new
        </button>
      </div>

      {/* Threads panel */}
      <div className="cs-threads">
        <div
          onClick={() => setThreadsOpen(!threadsOpen)}
          className="cs-threads-toggle"
        >
          <span className="cs-threads-arrow">{threadsOpen ? "\u25BC" : "\u25B6"}</span>
          <span className="cs-threads-label">threads</span>
        </div>
        {threadsOpen && (
          <div className="cs-threads-list">
            {chatHistory.length === 0 && (
              <div className="cs-threads-empty">
                No saved threads yet.
              </div>
            )}
            {chatHistory.map((thread) => (
              <div
                key={thread.slug}
                onClick={() => handleLoadThread(thread.slug)}
                className={`cs-thread-item ${currentThreadId === thread.slug ? "cs-thread-item--active" : ""}`}
              >
                <div className="cs-thread-slug">
                  {thread.slug}
                </div>
                <div className="cs-thread-meta">
                  {thread.created_at?.slice(0, 10)} / {thread.model}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="cs-messages">
        {messages.length === 0 && (
          <div className="cs-empty-state">
            ask about your data
          </div>
        )}

        {messages.map((msg, i) => {
          const isStreamingThisMessage = isStreaming && i === messages.length - 1;
          const hasSteps = msg.tool_steps && msg.tool_steps.length > 0;

          return (
            <div key={i}>
              {hasSteps && (
                <ThinkingBlock steps={msg.tool_steps!} isStreaming={isStreamingThisMessage} />
              )}

              <div className={`cs-msg-wrap ${msg.role === "user" ? "cs-msg-wrap--user" : ""}`}>
                <div className={`cs-role ${msg.role === "user" ? "cs-role--user" : ""}`}>
                  {msg.role === "user" ? "you" : "medha"}
                </div>
                <div className={`cs-bubble ${msg.role === "user" ? "cs-bubble--user" : ""}`}>
                  {msg.role === "assistant" ? (
                    <div className="markdown-body">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table({ children, ...props }) {
                            return (
                              <div data-testid="table-scroll-wrapper" className="cs-table-scroll">
                                <table {...props}>{children}</table>
                              </div>
                            );
                          },
                          code({ className, children, ...props }) {
                            const codeText = String(children).replace(/\n$/, "");
                            const isBlock = className?.startsWith("language-");
                            if (!isBlock) return <code {...props}>{children}</code>;
                            return (
                              <div className="cs-code-wrap">
                                <pre className="cs-code-pre">
                                  <code>{codeText}</code>
                                </pre>
                                <button
                                  onClick={() => setEditorContent(codeText)}
                                  title="Copy to SQL Editor"
                                  className="cs-code-copy"
                                >
                                  <ArrowRight size={10} className="cs-code-copy-icon" /> editor
                                </button>
                              </div>
                            );
                          },
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* HITL warning banner (Spec §4E) */}
      {hitlWarning && (
        <div className="cs-hitl">
          <div className="cs-hitl-title">
            large query warning
          </div>
          <div className="cs-hitl-body">
            {hitlWarning}
          </div>
          <button
            onClick={() => setHitlWarning(null)}
            className="medha-btn cs-hitl-dismiss"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Input */}
      <div className="cs-input-area">
        <ContextPill inputText={input} />
        <div className="cs-input-rel">
          {/* @-mention autocomplete popover */}
          {mentionOpen && mentionFiles.length > 0 && (
            <div
              data-testid="mention-popover"
              className="cs-mention-popover"
            >
              {mentionFiles.map((f, idx) => (
                <div
                  key={f.name}
                  onClick={() => handleMentionSelect(f.name)}
                  className={`cs-mention-item ${idx === mentionIndex ? "cs-mention-item--active" : ""}`}
                >
                  {f.name}
                </div>
              ))}
            </div>
          )}
          <input
            type="text"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (mentionOpen && mentionFiles.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIndex((prev) => Math.min(prev + 1, mentionFiles.length - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIndex((prev) => Math.max(prev - 1, 0));
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleMentionSelect(mentionFiles[mentionIndex].name);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionOpen(false);
                  return;
                }
              }
              if (e.key === "Enter") handleSend();
            }}
            placeholder="ask..."
            disabled={isStreaming}
            className="cs-input"
          />
        </div>
      </div>
    </div>
  );
}
