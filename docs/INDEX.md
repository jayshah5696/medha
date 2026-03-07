# Medha Documentation Index

## Audits
- **[AUDIT.md](AUDIT.md)** — Gemini 3.1 Pro full codebase audit (2026-03-05): spec gaps, code quality, test coverage, security findings, UX gaps

## Issues
- **[Phase 6 UI & Agent Audit](issues/phase6_ui_agent_audit.md)** — 4 critical bugs (logo, typography, dir picker, file extensions) — all resolved
- **[Phase 7 Bugs & Features](issues/phase7_bugs_and_features.md)** — 4 bugs + 4 feature requests from live UI testing (agent awareness, slug gen, history, resizable panes, multi-tab editor, click-to-preview, chart tabs)
- **[Phase 7 State Persistence](issues/phase7_state_persistence.md)** — Making Medha stateful across restarts: backend boot restore, `/api/boot` endpoint, Zustand persist middleware
- **[Phase 7 Typography System](issues/phase7_typography_system.md)** — 92 inline font sizes using 10 different values → unified 5-level CSS variable scale
- **[Phase 8 Bugs & Features](issues/phase8_bugs_and_features.md)** — Agent recursion limit, `[object Object]` JSON rendering, stale active files, pill overflow, live file watcher, CSV/Parquet export, workspace-scoped state design

## Session Logs
- **[2026-03-06: Phase 6 Audit Fixes](sessions/2026-03-06_phase6-audit-fixes.md)** — Complete log of 10 tasks: bug fixes, active-files pipeline, query-result sync, meta config, serialization hardening. 96 backend + 25 frontend tests passing.

## Architecture Decision Records (ADRs)
- **[ADR-001: Inline SVG Logo](decisions/ADR-001-svg-logo.md)** — CSS variable fill replaces PNG assets
- **[ADR-002: FILE_SEARCH_PATH](decisions/ADR-002-file-search-path.md)** — DuckDB native path resolution vs SQL rewriting
- **[ADR-003: Query Result Sync](decisions/ADR-003-query-result-sync.md)** — Module stash + SSE event for agent→editor pipeline
- **[ADR-004: Backend Folder Browser](decisions/ADR-004-backend-folder-browser.md)** — Server-side browse replaces Web FileSystem API
- **[ADR-005: Meta Config](decisions/ADR-005-meta-config-slug-model.md)** — model_slug and last_workspace in Settings JSON

## Brand Assets
- **[brand/](brand/)** — Logo variants and brand guidelines
