import { useState, useEffect } from "react";

interface SettingsData {
  model_inline: string;
  model_chat: string;
  agent_profile: string;
  openai_api_key: string;
  openrouter_api_key: string;
  lm_studio_url: string;
}

const MODEL_OPTIONS = [
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-opus-4.6",
  "openrouter/anthropic/claude-sonnet-4.6",
];

const PROFILE_OPTIONS = ["default", "fast", "deep"];

const defaultSettings: SettingsData = {
  model_inline: "openai/gpt-4o-mini",
  model_chat: "openai/gpt-4o-mini",
  agent_profile: "default",
  openai_api_key: "",
  openrouter_api_key: "",
  lm_studio_url: "http://localhost:1234/v1",
};

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsData>(defaultSettings);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings({ ...defaultSettings, ...data });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setStatus(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setStatus("saved");
      setTimeout(() => setStatus(null), 2000);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "error");
    }
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    fontSize: 12,
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border)",
    borderRadius: 0,
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    outline: "none",
  };

  const inputStyle: React.CSSProperties = {
    ...selectStyle,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: "var(--text-dimmed)",
    fontFamily: "var(--font-ui)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: 4,
    display: "block",
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: 16,
  };

  if (loading) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 0,
          width: 400,
          maxHeight: "80vh",
          overflow: "auto",
          padding: 20,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--accent)",
              fontFamily: "var(--font-ui)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            settings
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dimmed)",
              cursor: "pointer",
              fontSize: 14,
              fontFamily: "var(--font-mono)",
              padding: "0 4px",
            }}
          >
            x
          </button>
        </div>

        {/* Models section */}
        <div style={sectionStyle}>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-primary)",
              fontFamily: "var(--font-ui)",
              fontWeight: 500,
              marginBottom: 10,
              borderBottom: "1px solid var(--border)",
              paddingBottom: 4,
            }}
          >
            Models
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Inline / Cmd+K Model</label>
            <select
              value={settings.model_inline}
              onChange={(e) =>
                setSettings({ ...settings, model_inline: e.target.value })
              }
              style={selectStyle}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Chat / Cmd+L Model</label>
            <select
              value={settings.model_chat}
              onChange={(e) =>
                setSettings({ ...settings, model_chat: e.target.value })
              }
              style={selectStyle}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Agent Profile</label>
            <select
              value={settings.agent_profile}
              onChange={(e) =>
                setSettings({ ...settings, agent_profile: e.target.value })
              }
              style={selectStyle}
            >
              {PROFILE_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* API Keys section */}
        <div style={sectionStyle}>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-primary)",
              fontFamily: "var(--font-ui)",
              fontWeight: 500,
              marginBottom: 10,
              borderBottom: "1px solid var(--border)",
              paddingBottom: 4,
            }}
          >
            API Keys
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>OpenAI API Key</label>
            <input
              type="password"
              value={settings.openai_api_key}
              onChange={(e) =>
                setSettings({ ...settings, openai_api_key: e.target.value })
              }
              placeholder="sk-..."
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>OpenRouter API Key</label>
            <input
              type="password"
              value={settings.openrouter_api_key}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  openrouter_api_key: e.target.value,
                })
              }
              placeholder="sk-or-..."
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>LM Studio URL</label>
            <input
              type="text"
              value={settings.lm_studio_url}
              onChange={(e) =>
                setSettings({ ...settings, lm_studio_url: e.target.value })
              }
              style={inputStyle}
            />
          </div>
        </div>

        {/* Save */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={handleSave}
            style={{
              padding: "6px 16px",
              fontSize: 11,
              fontFamily: "var(--font-ui)",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              background: "var(--accent)",
              color: "var(--bg-primary)",
              border: "none",
              borderRadius: 0,
              cursor: "pointer",
            }}
          >
            save
          </button>
          {status && (
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color:
                  status === "saved" ? "var(--success)" : "var(--error)",
              }}
            >
              {status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
