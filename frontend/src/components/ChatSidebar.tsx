import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../store";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ToolStatus {
  tool: string;
  status: string;
}

export default function ChatSidebar() {
  const { activeFiles } = useStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolStatuses, setToolStatuses] = useState<ToolStatus[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolStatuses]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);
    setToolStatuses([]);

    let assistantContent = "";

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          active_files: activeFiles,
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
              setToolStatuses((prev) => [
                ...prev.filter((t) => t.tool !== event.tool),
                { tool: event.tool, status: event.status },
              ]);
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
      setToolStatuses([]);
    }
  };

  return (
    <div
      style={{
        width: "var(--sidebar-right)",
        minWidth: "var(--sidebar-right)",
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
          fontSize: 10,
          fontWeight: 500,
          textTransform: "uppercase",
          color: "var(--text-dimmed)",
          letterSpacing: "0.08em",
          fontFamily: "var(--font-ui)",
          fontVariant: "small-caps",
          display: "flex",
          alignItems: "center",
        }}
      >
        assistant
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              color: "var(--text-dimmed)",
              fontSize: 11,
              textAlign: "center",
              marginTop: 24,
              fontFamily: "var(--font-ui)",
            }}
          >
            ask about your data
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              padding: "6px 8px",
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: "var(--font-mono)",
              borderRadius: 0,
              ...(msg.role === "user"
                ? {
                    borderLeft: "2px solid var(--accent)",
                    background: "transparent",
                    textAlign: "right" as const,
                    paddingLeft: 10,
                    color: "var(--text-primary)",
                  }
                : {
                    background: "var(--bg-tertiary)",
                    borderLeft: "2px solid transparent",
                    color: "var(--text-primary)",
                  }),
            }}
          >
            {msg.role === "assistant" ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.content}
              </ReactMarkdown>
            ) : (
              msg.content
            )}
          </div>
        ))}

        {toolStatuses
          .filter((t) => t.status === "start")
          .map((t) => (
            <div
              key={t.tool}
              style={{
                fontSize: 11,
                fontStyle: "italic",
                color: "var(--text-dimmed)",
                padding: "4px 8px",
                fontFamily: "var(--font-mono)",
              }}
            >
              [ running {t.tool}... ]
            </div>
          ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: "8px",
          borderTop: "1px solid var(--border)",
        }}
      >
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
            fontSize: 12,
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderRadius: 0,
            color: "var(--text-primary)",
            outline: "none",
            fontFamily: "var(--font-mono)",
          }}
        />
      </div>
    </div>
  );
}
