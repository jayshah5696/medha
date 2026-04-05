# Changelog

All notable changes to Medha will be documented in this file.

## [Unreleased]

### Added
- AI-assisted query repair from the SQL error banner, reusing the existing diff review flow before any SQL is applied
- Backend and frontend regression coverage for inline error-context prompting and the auto-open repair diff path

## [0.2.0] - 2026-04-04

### Added
- Schema-aware SQL autocomplete driven by active workspace file schemas
- SQL formatting from the editor toolbar and keyboard flow
- Query cancel action wired through frontend aborts and backend DuckDB interruption
- Interactive result-grid sorting, column filtering, and click-to-copy cell values
- Release-setup regression tests covering Electron packaging recipes and version bumps

### Changed
- Query timeout handling now interrupts DuckDB at the application layer and returns HTTP 408 on timeout
- Desktop build recipes now rebuild the PyInstaller sidecar, avoid accidental publish/sign discovery, and support repeatable local packaging
- Version bumping now keeps `package-lock.json` in sync through `npm version`

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
