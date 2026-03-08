import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, X } from "lucide-react";
import "./SettingsModal.css";

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
    <div className="sm-model-picker">
      {/* Label */}
      <span className="sm-label">{labelText}</span>

      {/* Provider + Fetch row */}
      <div className="sm-provider-row">
        <select
          value={provider}
          onChange={(e) => {
            onProviderChange(e.target.value as Provider);
            setModels([]);
            setFetchStatus("idle");
            setManualMode(false);
          }}
          className="sm-select sm-provider-select"
        >
          {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
            <option key={p} value={p}>{PROVIDERS[p].label}</option>
          ))}
        </select>

        <button
          onClick={fetchModels}
          disabled={fetching}
          className="medha-btn sm-fetch-btn"
          style={fetching ? { opacity: 0.5 } : undefined}
          title="Fetch model list from provider"
        >
          {fetching ? "..." : "fetch"}
        </button>

        {/* Connection dot */}
        <span
          className="sm-status-dot"
          style={{ background: statusDot.color }}
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
          className="sm-input"
        />
      ) : (
        <select
          value={modelValue}
          onChange={(e) => onModelChange(e.target.value)}
          className="sm-select"
        >
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      )}

      {fetchStatus === "err" && (
        <div className="sm-error-msg">
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
      <div className="sm-warning-box">
        <AlertTriangle size={12} className="sm-warning-icon" /> {cfg.keyField ? "API key not set — see Keys section." : `${cfg.urlLabel} not configured.`}
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
      className="sm-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="sm-panel">
        {/* Header */}
        <div className="sm-header">
          <span className="sm-header-title">
            settings
          </span>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="sm-close-btn"
          >
            <X size={16} />
          </button>
        </div>

        {/* ---- LLM Models (Provider-first) ---- */}
        <div className="sm-section">
          <div className="sm-section-title">Models</div>

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

          <div className="sm-row">
            <span className="sm-label">Agent Profile</span>
            <select value={settings.agent_profile} onChange={(e) => set("agent_profile", e.target.value)} className="sm-select">
              {PROFILE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* ---- API Keys ---- */}
        <div className="sm-section">
          <div className="sm-section-title">API Keys</div>

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
              <div key={field} className="sm-row">
                <span className="sm-label">{providerLabel[field]}</span>
                <input
                  type="password"
                  value={settings[field]}
                  onChange={(e) => set(field, e.target.value)}
                  placeholder={placeholder[field]}
                  className="sm-input"
                />
              </div>
            );
          })}
        </div>

        {/* ---- Local Providers ---- */}
        <div className="sm-section">
          <div className="sm-section-title">Local Providers</div>
          <div className="sm-row">
            <span className="sm-label">LM Studio URL</span>
            <input type="text" value={settings.lm_studio_url} onChange={(e) => set("lm_studio_url", e.target.value)} className="sm-input" />
          </div>
          <div className="sm-row">
            <span className="sm-label">Ollama URL</span>
            <input type="text" value={settings.ollama_url} onChange={(e) => set("ollama_url", e.target.value)} className="sm-input" />
          </div>
        </div>

        {/* ---- Save ---- */}
        <div className="sm-save-row">
          <button onClick={handleSave} className="medha-btn sm-save-btn">
            save
          </button>
          {status && (
            <span className={`sm-status-text ${status === "saved" ? "sm-status-saved" : "sm-status-error"}`}>
              {status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
