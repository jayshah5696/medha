# Changelog

All notable changes to Medha will be documented in this file.

## [Unreleased]

## [0.1.0] - 2026-03-28

### Added
- **Electron desktop app** with Python sidecar, local proxy, native folder picker
- **Multi-tab SQL editor** with save/close/rename (Cmd+T, Cmd+W, Cmd+S)
- **Virtualized result grid** with row virtualization, infinite scroll, horizontal column sync
- **Chat agent** (Cmd+L) with LangGraph ReAct agent, SSE streaming, tool traces
- **Inline AI edit** (Cmd+K) with diff overlay accept/reject
- **YAML agent profiles** (default, fast, deep)
- **SQL history** persisted to `~/.medha/history/`
- **Chat threads** persisted to `~/.medha/chats/`
- **Dark & light themes** with full CSS token system, self-hosted fonts
- **Lucide-react icons** replacing emoji/text icons
- **CSV/Parquet export** from status bar
- **File watcher** with toast notifications
- **Settings modal** with provider-aware model selection
- **DuckDB safety**: SQL blocklist, path traversal prevention, result cap
- **API key masking** in settings responses
- **State persistence**: workspace/keys restored on boot
- **macOS menu bar** with standard shortcuts
- **Window state persistence** (size/position remembered)
- **Homebrew tap** setup for distribution
- **CI/CD** with GitHub Actions (tests + release automation)
