import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, X } from "lucide-react";

// --- Types ---------------------------------------------------------------

type Provider = "openai" | "anthropic" | "openrouter" | "gemini" | "lm_studio" | "ollama";

interface SettingsData {
  provider_inline: Provider;
  provider_chat: Provider;
  model_inline: string;
  model_chat: string;
  agent_profile: string;
  openai_api_key: string;
  openrouter_api_key: string;
  anthropic_api_key: string;
  gemini_api_key: string;
  lm_studio_url: string;
  ollama_url: string;
}

interface ProviderConfig {
  label: string;
  keyField?: keyof SettingsData;
  keyPlaceholder?: string;
  urlField?: keyof SettingsData;
  urlLabel?: string;
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  openai: {
    label: "OpenAI",
    keyField: "openai_api_key",
    keyPlaceholder: "sk-...",
  },
  anthropic: {
    label: "Anthropic",
    keyField: "anthropic_api_key",
    keyPlaceholder: "sk-ant-...",
  },
  openrouter: {
    label: "OpenRouter",
    keyField: "openrouter_api_key",
    keyPlaceholder: "sk-or-...",
  },
  gemini: {
    label: "Google Gemini",
    keyField: "gemini_api_key",
    keyPlaceholder: "AIza...",
  },
  lm_studio: {
    label: "LM Studio",
    urlField: "lm_studio_url",
    urlLabel: "LM Studio URL",
  },
  ollama: {
    label: "Ollama",
    urlField: "ollama_url",
    urlLabel: "Ollama URL",
  },
};

const PROFILE_OPTIONS = ["default", "fast", "deep"];

const defaultSettings: SettingsData = {
  provider_inline: "openai",
  provider_chat: "openai",
  model_inline: "openai/gpt-4o-mini",
  model_chat: "openai/gpt-4o-mini",
  agent_profile: "default",
  openai_api_key: "",
  openrouter_api_key: "",
  anthropic_api_key: "",
  gemini_api_key: "",
  lm_studio_url: "http://localhost:1234/v1",
  ollama_url: "http://localhost:11434",
};

// --- Utilities -----------------------------------------------------------

const label: React.CSSProperties = {
  display: "block",
  fontSize: 'var(--font-size-sm)',
  color: "var(--text-dimmed)",
  fontFamily: "var(--font-mono)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 4,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 'var(--font-size-base)',
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  borderRadius: 0,
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  outline: "none",
  boxSizing: "border-box",
};

const select: React.CSSProperties = { ...input };

const sectionTitle: React.CSSProperties = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 600,
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  marginBottom: 10,
  paddingBottom: 4,
  borderBottom: "1px solid var(--border-strong)",
};

const row: React.CSSProperties = { marginBottom: 12 };

// --- ModelPicker sub-component -------------------------------------------

interface ModelPickerProps {
  label: string;
  provider: Provider;
  modelValue: string;
  onProviderChange: (p: Provider) => void;
  onModelChange: (m: string) => void;
  settings: SettingsData;
}

function ModelPicker({
  label: labelText,
  provider,
  modelValue,
  onProviderChange,
  onModelChange,
  settings,
}: ModelPickerProps) {
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<"idle" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [manualMode, setManualMode] = useState(false);

  const fetchModels = useCallback(async () => {
    setFetching(true);
    setFetchStatus("idle");
    setErrMsg("");
    try {
      const res = await fetch(`/api/models?provider=${provider}`);
      const data = await res.json();
      if (data.error) {
        setErrMsg(data.error);
        setFetchStatus("err");
        setManualMode(true);
        setModels([]);
      } else {
        setModels(data.models ?? []);
        setFetchStatus("ok");
        setManualMode(false);
        // If current model not in list, select first
        if (data.models?.length && !data.models.includes(modelValue)) {
          onModelChange(data.models[0]);
        }
      }
    } catch {
      setErrMsg("Network error — enter model manually");
      setFetchStatus("err");
      setManualMode(true);
    } finally {
      setFetching(false);
    }
  }, [provider, modelValue, onModelChange]);

  const statusDot = fetchStatus === "ok"
    ? { color: "var(--success)", title: "Connected" }
    : fetchStatus === "err"
    ? { color: "var(--error)", title: errMsg }
    : { color: "var(--border-strong)", title: "Not fetched" };

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Label */}
      <span style={label}>{labelText}</span>

      {/* Provider + Fetch row */}
      <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
        <select
          value={provider}
          onChange={(e) => {
            onProviderChange(e.target.value as Provider);
            setModels([]);
            setFetchStatus("idle");
            setManualMode(false);
          }}
          style={{ ...select, flex: 1 }}
        >
          {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
            <option key={p} value={p}>{PROVIDERS[p].label}</option>
          ))}
        </select>

        <button
          onClick={fetchModels}
          disabled={fetching}
          className="medha-btn"
          style={{ flexShrink: 0, fontSize: 'var(--font-size-sm)', padding: "4px 10px", opacity: fetching ? 0.5 : 1 }}
          title="Fetch model list from provider"
        >
          {fetching ? "..." : "fetch"}
        </button>

        {/* Connection dot */}
        <span
          style={{
            width: 8, height: 8, borderRadius: "50%",
            background: statusDot.color, flexShrink: 0,
            transition: "background 0.2s",
          }}
          title={statusDot.title}
        />
      </div>

      {/* Provider-specific credential field */}
      <ProviderCredentialField provider={provider} settings={settings} />

      {/* Model dropdown or manual input */}
      {manualMode || models.length === 0 ? (
        <input
          type="text"
          value={modelValue}
          onChange={(e) => onModelChange(e.target.value)}
          placeholder="e.g. openai/gpt-4o-mini"
          style={{ ...input }}
        />
      ) : (
        <select
          value={modelValue}
          onChange={(e) => onModelChange(e.target.value)}
          style={{ ...select }}
        >
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      )}

      {fetchStatus === "err" && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: "var(--error)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
          {errMsg}
        </div>
      )}
    </div>
  );
}

// --- ProviderCredentialField ---------------------------------------------

interface CredFieldProps {
  provider: Provider;
  settings: SettingsData;
}

function ProviderCredentialField({ provider, settings }: CredFieldProps) {
  // These fields are display-only in the picker; real editing happens in the Keys section
  const cfg = PROVIDERS[provider];
  if (!cfg.keyField && !cfg.urlField) return null;

  const fieldKey = cfg.keyField || cfg.urlField!;
  const val = settings[fieldKey] as string;

  if (!val) {
    return (
      <div style={{
        fontSize: 'var(--font-size-xs)', color: "var(--warning)", fontFamily: "var(--font-mono)",
        marginBottom: 6, padding: "3px 6px",
        background: "rgba(245,166,35,0.06)", border: "1px solid rgba(245,166,35,0.15)",
      }}>
        <AlertTriangle size={12} style={{ marginRight: 4, verticalAlign: "middle" }} /> {cfg.keyField ? "API key not set — see Keys section." : `${cfg.urlLabel} not configured.`}
      </div>
    );
  }
  return null;
}

// --- Main component -------------------------------------------------------

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

  const set = <K extends keyof SettingsData>(key: K, val: SettingsData[K]) =>
    setSettings((prev) => ({ ...prev, [key]: val }));

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

  if (loading) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "var(--bg-secondary)", border: "1px solid var(--border-strong)",
          width: 440, maxWidth: "90vw", maxHeight: "88vh", overflow: "auto", padding: "18px 20px",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: "var(--accent)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            settings
          </span>
          <button
            onClick={onClose}
            aria-label="Close settings"
            style={{ background: "none", border: "none", color: "var(--text-dimmed)", cursor: "pointer", fontSize: 'var(--font-size-lg)', lineHeight: 1, padding: 2 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ---- LLM Models (Provider-first) ---- */}
        <div style={{ marginBottom: 20 }}>
          <div style={sectionTitle}>Models</div>

          <ModelPicker
            label="Inline / Cmd+K"
            provider={settings.provider_inline}
            modelValue={settings.model_inline}
            onProviderChange={(p) => set("provider_inline", p)}
            onModelChange={(m) => set("model_inline", m)}
            settings={settings}
          />

          <ModelPicker
            label="Chat / Cmd+L"
            provider={settings.provider_chat}
            modelValue={settings.model_chat}
            onProviderChange={(p) => set("provider_chat", p)}
            onModelChange={(m) => set("model_chat", m)}
            settings={settings}
          />

          <div style={row}>
            <span style={label}>Agent Profile</span>
            <select value={settings.agent_profile} onChange={(e) => set("agent_profile", e.target.value)} style={select}>
              {PROFILE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* ---- API Keys ---- */}
        <div style={{ marginBottom: 20 }}>
          <div style={sectionTitle}>API Keys</div>

          {(["openai_api_key", "openrouter_api_key", "anthropic_api_key", "gemini_api_key"] as const).map((field) => {
            const providerLabel: Record<string, string> = {
              openai_api_key: "OpenAI", openrouter_api_key: "OpenRouter",
              anthropic_api_key: "Anthropic", gemini_api_key: "Google Gemini",
            };
            const placeholder: Record<string, string> = {
              openai_api_key: "sk-...", openrouter_api_key: "sk-or-...",
              anthropic_api_key: "sk-ant-...", gemini_api_key: "AIza...",
            };
            return (
              <div key={field} style={row}>
                <span style={label}>{providerLabel[field]}</span>
                <input
                  type="password"
                  value={settings[field]}
                  onChange={(e) => set(field, e.target.value)}
                  placeholder={placeholder[field]}
                  style={input}
                />
              </div>
            );
          })}
        </div>

        {/* ---- Local Providers ---- */}
        <div style={{ marginBottom: 20 }}>
          <div style={sectionTitle}>Local Providers</div>
          <div style={row}>
            <span style={label}>LM Studio URL</span>
            <input type="text" value={settings.lm_studio_url} onChange={(e) => set("lm_studio_url", e.target.value)} style={input} />
          </div>
          <div style={row}>
            <span style={label}>Ollama URL</span>
            <input type="text" value={settings.ollama_url} onChange={(e) => set("ollama_url", e.target.value)} style={input} />
          </div>
        </div>

        {/* ---- Save ---- */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={handleSave} className="medha-btn" style={{ padding: "5px 18px" }}>
            save
          </button>
          {status && (
            <span style={{ fontSize: 'var(--font-size-xs)', fontFamily: "var(--font-mono)", color: status === "saved" ? "var(--success)" : "var(--error)" }}>
              {status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
