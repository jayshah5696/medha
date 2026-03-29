# Medha — Comprehensive Feature Roadmap & Suggestions

> Generated 2026-03-28 after deep analysis of codebase (29 endpoints, 14 frontend components, 300+ tests), competitive landscape (18 tools analyzed), and industry trends.

---

## Table of Contents

1. [SQL Editor & Query Experience](#1-sql-editor--query-experience)
2. [Result Grid & Data Display](#2-result-grid--data-display)
3. [Data Visualization & Profiling](#3-data-visualization--profiling)
4. [AI Agent & Intelligence](#4-ai-agent--intelligence)
5. [File & Workspace Management](#5-file--workspace-management)
6. [Chat & Conversation UX](#6-chat--conversation-ux)
7. [Security Hardening](#7-security-hardening)
8. [Performance & Scalability](#8-performance--scalability)
9. [Desktop & Electron Shell](#9-desktop--electron-shell)
10. [Accessibility & UX Polish](#10-accessibility--ux-polish)
11. [Backend Infrastructure](#11-backend-infrastructure)
12. [Testing & Quality](#12-testing--quality)
13. [Ecosystem & Extensibility](#13-ecosystem--extensibility)
14. [Competitive Differentiators](#14-competitive-differentiators)

Priority labels: **P0** = table stakes / must-have, **P1** = strong differentiator, **P2** = nice-to-have, **P3** = future vision

---

## 1. SQL Editor & Query Experience

### P0 — Table Stakes

#### 1.1 Schema-Aware Autocomplete
- **Current state:** CodeMirror `sql()` provides keyword-only syntax highlighting. No awareness of actual table/column names.
- **Suggestion:** Feed DuckDB schema metadata (table names from workspace files, column names, types) into CodeMirror's `SQLConfig.schema` option. When a user types `SELECT ` and presses dot or space, show columns from active files.
- **Implementation:** Backend already has `/api/db/schema/{filename}` — build a frontend cache that fetches all schemas on workspace load, then pass to CodeMirror's SQL language config.
- **Competitive context:** DBeaver, DataGrip, DbGate, and Beekeeper all ship schema-aware autocomplete. This is the #1 expected feature in any SQL IDE.

#### 1.2 SQL Formatting / Auto-Format
- **Current state:** `sql-formatter` is already a dependency (used in DiffOverlay for diff display) but there's no "Format SQL" action.
- **Suggestion:** Add Shift+Alt+F (or a toolbar button) that formats the current editor content using `sql-formatter`. Use the DuckDB dialect config.
- **Low effort:** The library is already imported. Just wire a keyboard shortcut to `sqlFormatter.format(editorContent, { language: 'sql' })` and replace editor content.

#### 1.3 Multi-Statement Execution
- **Current state:** Cmd+Enter executes the entire editor content as a single query.
- **Suggestion:** Detect semicolons to split statements. Execute each sequentially, show results for the last SELECT statement (or all in tabs). Allow executing only the statement at cursor position.
- **Competitive context:** Every major SQL IDE supports this. DataGrip highlights the current statement for clarity.

#### 1.4 Query Execution History Search
- **Current state:** History popover (Cmd+H) shows last 20 queries, no search.
- **Suggestion:** Full-text search across all history entries. Backend stores queries as `.sql` files in `~/.medha/history/` — add a search endpoint that greps across them. Show results in a filtered list with timestamps and row counts.

### P1 — Differentiators

#### 1.5 Command Palette
- **Current state:** Keyboard shortcuts exist but are only shown in toolbar text.
- **Suggestion:** Implement a Cmd+P / Cmd+Shift+P command palette (like VS Code/Cursor). List all available actions: Run Query, Format SQL, Open Settings, Toggle Chat, New Tab, Save Query, Export CSV, etc. Make every action discoverable and keyboard-accessible.

#### 1.6 SQL Snippets & Templates
- **Suggestion:** Allow saving reusable SQL fragments (e.g., "Top N by column", "Group by date", "Join pattern"). Insert via autocomplete or command palette. Store as `.sql` files in a `snippets/` directory in the workspace.

#### 1.7 Multi-Cursor & Selection Execute
- **Suggestion:** Execute only the selected text (not the full editor). If text is selected, Cmd+Enter runs just the selection. This is standard in DataGrip and DBeaver.

#### 1.8 Query Plan Visualization
- **Current state:** DuckDB supports `EXPLAIN` and `EXPLAIN ANALYZE`.
- **Suggestion:** Add a "Show Query Plan" action that runs `EXPLAIN ANALYZE` and renders the plan as an indented tree or visual flowchart. Show row estimates, actual rows, and timing per node.
- **Competitive context:** DataGrip's query plan viewer is the gold standard here.

### P2 — Nice-to-Have

#### 1.9 Inline SQL Linting
- **Suggestion:** Use `sqlglot` (already a backend dependency) to parse SQL and flag errors before execution. Show red underlines in the editor for syntax issues.

#### 1.10 Code Folding
- **Suggestion:** Enable CodeMirror's code folding for CTEs, subqueries, and CASE statements. The `basicSetup` extension includes folding, but SQL-specific fold points may need custom configuration.

#### 1.11 Parameter Binding UI
- **Suggestion:** Support `$1`, `:name`, or `?` parameters in SQL. Show a small form above results to fill in parameter values before execution. Useful for testing parameterized queries.

---

## 2. Result Grid & Data Display

### P0 — Table Stakes

#### 2.1 Column Sorting
- **Current state:** TanStack Table is headless and supports sorting, but it's not wired up. Columns are read-only.
- **Suggestion:** Click column header to sort (asc → desc → none). Use client-side sort for loaded data. For large result sets beyond the page, re-execute with `ORDER BY` added to the original query.
- **Competitive context:** Every SQL IDE with a result grid supports column sorting.

#### 2.2 Column Filtering
- **Suggestion:** Add a filter icon on each column header. Click to show a filter input (text match for strings, range for numbers, date picker for dates). Filter client-side for loaded data.
- **DuckDB-native approach:** For "server-side" filtering, wrap the original query in `SELECT * FROM (...) WHERE col LIKE '%filter%'`.

#### 2.3 Copy to Clipboard
- **Current state:** Only CSV/Parquet file export exists.
- **Suggestion:** Right-click on cell → copy value. Select rows → Ctrl+C to copy as TSV (paste into Excel/Sheets). Copy column as list. Copy row as JSON. Copy entire result as CSV.
- **Important for workflow:** Users constantly need to grab values from results without downloading files.

#### 2.4 Column Type Indicators
- **Current state:** Column headers show name only.
- **Suggestion:** Add a small type badge below or beside the column name (INT, VARCHAR, TIMESTAMP, etc.). Use colored dots or icons. DuckDB types are available from the schema endpoint.

#### 2.5 Cell Expansion
- **Current state:** Long values truncated at 120 chars with tooltip.
- **Suggestion:** Click on a cell to expand it in a modal/popover. For JSON values, render with syntax highlighting and collapsible tree. For long strings, show full text with word wrap.

### P1 — Differentiators

#### 2.6 Column Resizing & Reordering
- **Suggestion:** Drag column borders to resize. Drag column headers to reorder. Persist layout per query or per workspace.

#### 2.7 Column Visibility Toggle
- **Suggestion:** Dropdown in the grid toolbar to show/hide columns. Useful for wide tables with 50+ columns. TanStack Table supports this natively with `columnVisibility` state.

#### 2.8 Row Selection & Bulk Actions
- **Suggestion:** Checkbox column for multi-select. Selected rows can be: copied, exported, or used as context for AI chat ("analyze these rows").

#### 2.9 Conditional Formatting / Heatmap
- **Suggestion:** Optionally color-code numeric columns (green for high, red for low). Highlight null values distinctly. Show negative numbers in red.

### P2 — Nice-to-Have

#### 2.10 Transpose View
- **Suggestion:** For single-row results or wide tables, offer a "transpose" toggle that shows columns as rows (key-value pairs). Useful for inspecting a single record.

#### 2.11 Diff Two Results
- **Suggestion:** Run two queries, diff their results side-by-side. Highlight added, removed, and changed rows. Useful for comparing data before/after transformations.

---

## 3. Data Visualization & Profiling

### P1 — Strong Differentiators

#### 3.1 Column Profiling / Data Explorer
- **Inspiration:** DuckDB UI's Column Explorer automatically shows distribution histograms, null counts, min/max, cardinality for each column.
- **Suggestion:** Add a "Profile" tab next to the result grid. For each column, show:
  - Type and nullability
  - Distinct count / cardinality
  - Min, max, mean, median (for numeric)
  - Top N most frequent values (for categorical)
  - Histogram or distribution chart
  - Null percentage bar
- **Implementation:** Run DuckDB aggregate queries (`SUMMARIZE` or custom stats) on the result set. DuckDB's `SUMMARIZE table_name` gives this for free.
- **Why it matters:** Turns Medha from "query runner" into "data understanding tool." This is the single most impactful visualization feature.

#### 3.2 One-Click Charting
- **Suggestion:** After running a query, show a "Chart" button. Auto-detect chart type:
  - 1 numeric column → histogram
  - 1 categorical + 1 numeric → bar chart
  - 1 date + 1 numeric → line chart
  - 2 numeric → scatter plot
- **Library recommendation:** Observable Plot (lightweight, SQL-friendly) or Apache ECharts (richer, good React bindings).
- **Competitive context:** Metabase, Evidence, and MotherDuck all offer auto-charting. DataGrip added charting in 2024.

#### 3.3 Data Quality Indicators
- **Suggestion:** After profiling, flag potential data quality issues:
  - Columns with >50% nulls
  - Constant columns (only one distinct value)
  - Outliers (values >3 standard deviations)
  - Mixed types in string columns (numbers stored as strings)
- **AI integration:** Have the agent comment on data quality when exploring a file for the first time.

### P2 — Nice-to-Have

#### 3.4 Saved Charts / Dashboard
- **Suggestion:** Save chart configurations alongside saved queries. Open a "dashboard" view that runs multiple queries and displays their charts together.

#### 3.5 Geospatial Preview
- **Suggestion:** If result contains lat/lon columns, offer a map view. DuckDB has spatial extensions. Use Leaflet or Mapbox GL for rendering.

---

## 4. AI Agent & Intelligence

### P0 — Table Stakes

#### 4.1 Query Error Explanation & Fix
- **Current state:** When a query fails, the error message is shown as-is from DuckDB.
- **Suggestion:** Add a "Fix with AI" button next to error messages. Send the query + error message to the LLM, get a corrected query and explanation. Show as a diff (reuse DiffOverlay).
- **Low effort:** The inline editing endpoint (`/api/ai/inline`) already handles this pattern.

#### 4.2 Streaming Token-Level Output
- **Current state:** AI responses stream per-node (entire model response at once), not per-token.
- **Suggestion:** Use litellm's streaming API (`stream=True`) to yield tokens as they're generated. Update SSE to emit individual tokens for a smoother chat UX.
- **Impact:** The current "wait → wall of text" pattern feels noticeably slower than ChatGPT-style streaming.

### P1 — Strong Differentiators

#### 4.3 Copilot-Style Inline Suggestions (Ghost Text)
- **Current state:** AI editing requires explicit Cmd+K invocation.
- **Suggestion:** As the user types SQL, show ghost text predictions inline (like GitHub Copilot). Use a lightweight model (gpt-4o-mini or local Ollama) for fast predictions. Accept with Tab.
- **Technical approach:** CodeMirror supports ghost text via custom completions or decorations. Debounce requests (300ms after typing stops). Only suggest when cursor is at end of line.
- **Differentiation:** No SQL IDE currently offers Copilot-style inline SQL suggestions with schema awareness. This could be a killer feature.

#### 4.4 AI-Powered Query Optimization
- **Suggestion:** After running a slow query, offer "Optimize with AI." Send the query + EXPLAIN ANALYZE output to the LLM. Get optimization suggestions (add indexes, rewrite subqueries, use CTEs).
- **For DuckDB specifically:** Suggest Parquet partitioning strategies, column pruning, predicate pushdown optimizations.

#### 4.5 Natural Language Data Questions
- **Suggestion:** Beyond SQL generation, support high-level questions: "What's the trend in sales over the last quarter?" Agent explores the data, generates multiple queries, and presents a narrative answer with supporting queries and results.
- **Implementation:** Add a new agent profile ("analyst") with a system prompt focused on data storytelling. Use existing tools (get_schema, sample_data, execute_query) with an analytical framing.

#### 4.6 Context-Aware Across Sessions
- **Current state:** Each chat thread is independent. No cross-thread learning.
- **Suggestion:** Maintain a "workspace knowledge base" that accumulates:
  - Schema summaries for all files
  - Common query patterns
  - Data quality observations
  - User-defined glossary (e.g., "revenue = price * quantity")
- **Feed to agent:** Include relevant context snippets in the system prompt based on active files and query content.

#### 4.7 Agent Tool: Create Chart
- **Suggestion:** Add a new agent tool `create_chart(sql, chart_type, x_column, y_column)` that executes a query and returns a chart configuration. The frontend renders it inline in the chat.
- **Impact:** The agent can then answer questions like "Show me a bar chart of sales by region" end-to-end.

### P2 — Nice-to-Have

#### 4.8 SQL-to-English Explanation
- **Suggestion:** "Explain this query" button that sends SQL to the LLM and returns a plain-English breakdown. Show as a popover or sidebar annotation.

#### 4.9 Data Anomaly Detection
- **Suggestion:** Agent proactively scans a new file and reports: unusual distributions, missing value patterns, potential PII columns, data freshness.

#### 4.10 Query Suggestion from Schema
- **Suggestion:** When a user opens a new file, show "Suggested Queries" based on the schema: "Show distribution of {categorical_column}", "Time series of {date_column}", "Top 10 by {numeric_column}".

#### 4.11 MCP Server Mode
- **Inspiration:** MotherDuck and Rill Data both offer MCP server support.
- **Suggestion:** Expose Medha as an MCP server so external LLMs (Claude Desktop, ChatGPT, etc.) can query local data through Medha. This turns Medha into a data access layer for any AI tool.
- **Implementation:** Add `mcp-server-medha` package that wraps the existing DuckDB query execution and schema introspection.

---

## 5. File & Workspace Management

### P0 — Table Stakes

#### 5.1 Drag-and-Drop File Import
- **Current state:** Files must already exist in the workspace directory.
- **Suggestion:** Allow drag-and-drop of CSV/Parquet/JSON files onto the app. Copy files into the workspace directory and auto-refresh the file list.
- **Electron integration:** Use Electron's `will-navigate` and `drop` events. For web mode, use HTML5 drag-and-drop API.

#### 5.2 File Schema Preview Panel
- **Current state:** Clicking a file auto-queries first 100 rows. Schema is only visible via agent tools.
- **Suggestion:** Show a schema panel when a file is selected: column names, types, row count, file size, format. This is a non-destructive preview that doesn't execute a query.
- **Implementation:** Backend already has `/api/db/schema/{filename}`. Add a UI panel (collapsible, below the file list or in a tooltip).

#### 5.3 Multiple Workspaces
- **Current state:** Single workspace at a time. Switching requires reconfiguring.
- **Suggestion:** Add a workspace switcher (dropdown or sidebar). Recent workspaces already tracked via `/api/workspaces/recent`. Allow quick switching without losing tabs/state.

### P1 — Differentiators

#### 5.4 File Metadata & Stats
- **Suggestion:** Show file-level metadata in the file explorer:
  - Row count (cached from DuckDB `SELECT COUNT(*) FROM file`)
  - File size
  - Last modified date
  - Column count
  - Format (Parquet/CSV/JSON with icon)
- **Implementation:** Extend the `/api/workspace/files` response to include metadata.

#### 5.5 File Preview Tooltip
- **Suggestion:** Hover over a file in the explorer to see a tooltip with: first 5 rows, column names, row count, file size. Quick way to understand data without running a query.

#### 5.6 Cross-File JOIN Builder
- **Suggestion:** Visual interface to select two files and a join key. Generate `SELECT * FROM file1.parquet f1 JOIN file2.csv f2 ON f1.key = f2.key`. The agent could suggest join keys based on matching column names/types.

### P2 — Nice-to-Have

#### 5.7 Remote File Support (S3/GCS/HTTP)
- **Current state:** Only local files supported (by design — zero egress).
- **Suggestion (opt-in):** Allow users to explicitly enable remote file access for specific URLs. This would require lifting the `httpfs` block for user-approved sources. Show a clear warning about data egress.

#### 5.8 Folder Watching with Notifications
- **Current state:** File watcher exists but only clears schema cache.
- **Suggestion:** When files are added/removed/modified in the workspace, show a notification and auto-refresh the file list. Useful when data pipelines drop new Parquet files.

---

## 6. Chat & Conversation UX

### P1 — Differentiators

#### 6.1 Thread Naming & Organization
- **Current state:** Thread slugs auto-generated by LLM. No manual naming or organization.
- **Suggestion:** Allow renaming threads (click title to edit). Add tags or categories. Pin important threads. Search across thread content.

#### 6.2 "Run This Query" Button in Chat
- **Current state:** Agent query results shown in the result grid. User can "Copy to Editor."
- **Suggestion:** Add a "Run in Editor" button on SQL code blocks in chat. Clicking it populates the editor AND executes immediately. Reduces steps from 2 (copy + Cmd+Enter) to 1.

#### 6.3 Chat Context Management
- **Current state:** @-mention system adds files to context. No way to add query results or schemas.
- **Suggestion:** Allow referencing:
  - `@file.parquet` — file schema (existing)
  - `@results` — current result grid data (send first N rows)
  - `@error` — current query error
  - `@history` — recent query history
- **Impact:** Richer context leads to more relevant AI responses.

#### 6.4 Multi-Modal Responses
- **Suggestion:** When the agent runs a query, show the results inline in the chat (small table preview) rather than only in the main grid. For chart-capable queries, show inline charts.

#### 6.5 Prompt Templates
- **Suggestion:** Pre-built prompt starters: "Explore this dataset", "Find anomalies", "Write a summary report", "Optimize my query", "Explain this schema". Show as quick-action buttons when starting a new thread.

### P2 — Nice-to-Have

#### 6.6 Voice Input
- **Suggestion:** Microphone button for voice-to-text. Use browser's Web Speech API. Natural for asking data questions: "What were the top 10 products by revenue last month?"

#### 6.7 Export Chat as Report
- **Suggestion:** Export a chat thread as a Markdown or HTML report. Include queries, results, and AI analysis. Useful for sharing findings with teammates.

---

## 7. Security Hardening

### P0 — Critical

#### 7.1 OS Keychain for API Keys
- **Current state:** API keys stored in `~/.medha/settings.json` with file permissions (0o600). Plain text on disk.
- **Suggestion:** Use OS-native credential storage:
  - macOS: Keychain Access via `security` CLI or `keytar` npm package
  - Windows: Windows Credential Manager
  - Linux: libsecret / GNOME Keyring
- **Why:** File-based storage is vulnerable to any process running as the same user. Keychain requires user authentication to access.

#### 7.2 Query Timeout
- **Current state:** No timeout on DuckDB queries. A pathological query (`SELECT * FROM generate_series(1, 1000000000)`) could hang the app.
- **Suggestion:** Add a configurable query timeout (default: 30 seconds). DuckDB supports `SET statement_timeout = '30s'`. Also implement application-level timeout via `asyncio.wait_for()`.
- **Backend + Frontend:** Show a "Query timed out" message with the option to extend the timeout.

#### 7.3 Prompt Injection Prevention
- **Current state:** File names and data content are sent to the LLM in agent tools. Malicious file names or data values could inject prompts.
- **Suggestion:**
  - Sanitize file names before including in prompts (strip special characters)
  - Wrap data in explicit delimiters: `<data>...</data>` with instructions to the LLM to treat content as data, not instructions
  - Limit data samples sent to LLM (already capped at `n=5` rows in `sample_data`, but no character limit per cell)
  - Add a character limit per cell value in tool responses (e.g., 500 chars)

#### 7.4 Rate Limiting on AI Endpoints
- **Current state:** No rate limiting. A runaway frontend or automated client could exhaust API credits.
- **Suggestion:** Add per-endpoint rate limits:
  - `/api/ai/chat`: 10 requests/minute
  - `/api/ai/inline`: 20 requests/minute
- **Implementation:** Use `slowapi` (FastAPI-compatible rate limiting library) or a simple in-memory counter.

#### 7.5 SQL Blocklist Improvements
- **Current state:** Regex-based keyword blocking. Known gap: relative paths in COPY statements.
- **Suggestions:**
  - Use `sqlglot` to parse the SQL AST instead of regex. Check for specific statement types (COPY, CREATE, etc.) in the parsed tree. More robust than string matching.
  - Block `PRAGMA` statements (can change DuckDB configuration)
  - Block `SET` statements (can change `FILE_SEARCH_PATH`, `threads`, etc.)
  - Block `CALL` statements (can invoke DuckDB functions like `duckdb_functions()`)
  - Add `PREPARE`/`EXECUTE` to prevent prepared statement abuse

### P1 — Important

#### 7.6 Audit Log
- **Suggestion:** Optional query audit log that records: timestamp, query text, execution time, row count, user action (manual/agent). Stored in a local SQLite or DuckDB file. Useful for enterprise users who need compliance tracking.

#### 7.7 Content Security Policy Tightening
- **Current state:** CSP allows `'unsafe-inline'` for styles.
- **Suggestion:** Move to nonce-based CSP for inline styles. Tighten `connect-src` to only allow the specific backend port, not all localhost ports.

#### 7.8 Electron Update Verification
- **Current state:** No auto-update mechanism. Users download DMGs manually.
- **Suggestion:** When implementing auto-update (see §9.1), ensure updates are code-signed and verified. Use `electron-updater` with Ed25519 signature verification.

---

## 8. Performance & Scalability

### P0 — Critical

#### 8.1 Query Result Caching
- **Current state:** Every query re-executes from scratch. No caching.
- **Suggestion:** Cache recent query results in memory (LRU, max 50MB). Hash the query text + workspace path as cache key. Invalidate on file changes (file watcher already exists). Show "cached" indicator in the UI.
- **Impact:** Instant results when re-running the same query (common during exploration).

#### 8.2 Request Cancellation on Navigation
- **Current state:** If a user navigates away while a query is running, the query continues.
- **Suggestion:** Use `AbortController` in the frontend fetch calls. Cancel pending requests when switching tabs, closing the app, or starting a new query.

### P1 — Important

#### 8.3 Lazy Schema Loading
- **Current state:** Schema caching exists but all schemas fetched sequentially.
- **Suggestion:** Fetch schemas lazily — only when a file is clicked or referenced in a query. For autocomplete, fetch all schemas in the background after workspace load (don't block UI).

#### 8.4 Arrow Format by Default
- **Current state:** Arrow format supported but JSON is the default.
- **Suggestion:** Switch to Arrow as the default transport format for query results. Arrow IPC is significantly faster for serialization/deserialization and uses less memory. Already implemented in `async_execute_arrow()` — just need to update the frontend to prefer it.
- **Benchmark opportunity:** Compare JSON vs Arrow for 10K-row results.

#### 8.5 Streaming Large Results
- **Suggestion:** For exports and large result sets, implement streaming (DuckDB cursor → chunked HTTP response). Avoid loading the entire result into memory before sending.

### P2 — Nice-to-Have

#### 8.6 WebAssembly DuckDB (Browser Mode)
- **Suggestion:** For the web version, consider running DuckDB-WASM in the browser. Eliminates the Python backend entirely for basic queries. Keep the Python backend for AI agent features.
- **Trade-off:** More complex architecture, but true zero-server-needed for non-AI use cases.

#### 8.7 Background Query Execution
- **Suggestion:** Allow long-running queries to execute in the background. Show a notification when complete. User can continue editing other queries in the meantime.
- **Requires:** Multiple DuckDB connections or a query queue.

---

## 9. Desktop & Electron Shell

### P0 — Table Stakes

#### 9.1 Auto-Update
- **Current state:** Manual DMG download only. Homebrew tap auto-updates.
- **Suggestion:** Implement in-app auto-update using `electron-updater`. Check for updates on launch, show a notification when an update is available. Download and install with one click.
- **Release pipeline:** Already publishes to GitHub Releases — `electron-updater` can consume these directly.

#### 9.2 Windows & Linux Builds
- **Current state:** macOS only (arm64 + x64). Windows/Linux configs exist in electron-builder.yml but no CI jobs.
- **Suggestion:** Add CI matrix jobs for Windows (NSIS installer) and Linux (AppImage/deb). PyInstaller builds need platform-specific testing.
- **Priority:** Windows is the larger market for data professionals.

### P1 — Differentiators

#### 9.3 Native File Associations
- **Suggestion:** Register Medha as the default application for `.parquet`, `.csv`, `.json` files on macOS/Windows. Double-clicking a data file opens it in Medha with auto-preview.
- **Implementation:** Add `fileAssociations` to electron-builder.yml. Handle file open events in Electron main process.

#### 9.4 System Tray / Menu Bar
- **Suggestion:** Minimize to system tray. Quick access to recent workspaces, last query, settings. Useful for users who keep Medha running as a data exploration companion.

#### 9.5 Multiple Windows
- **Current state:** Single window only.
- **Suggestion:** Support multiple windows for different workspaces. Each window gets its own backend DuckDB connection (or share with workspace scoping).

#### 9.6 Native Context Menus
- **Suggestion:** Right-click in the result grid for native context menus (Copy Cell, Copy Row, Export Selection, Filter by This Value). Right-click on files for Open, Schema, Delete.

### P2 — Nice-to-Have

#### 9.7 Touch Bar Support (macOS)
- **Suggestion:** Show query execution button, format SQL, toggle theme on MacBook Pro Touch Bar.

#### 9.8 Deep Linking
- **Suggestion:** `medha://open?workspace=/path/to/data` to open a specific workspace from the command line or URLs.

---

## 10. Accessibility & UX Polish

### P0 — Important

#### 10.1 ARIA Improvements
- **Current gaps:**
  - No `aria-expanded` on collapsible sections (SidebarSection, ThinkingBlock)
  - No `aria-label` on toggle buttons (theme, settings)
  - No `aria-live` on toast notifications or error banners
  - Modal dialogs may not trap focus properly
- **Suggestion:** Audit all interactive elements. Add `aria-expanded`, `aria-label`, `aria-live="polite"` for status updates, and focus trap for modals.

#### 10.2 Colorblind-Friendly Diff
- **Current state:** Diffs use red/green only.
- **Suggestion:** Add icons or patterns alongside colors: `+` prefix for added lines, `-` for removed. Use shapes (squares vs circles) in addition to color for status dots.

#### 10.3 Focus Management
- **Suggestion:** After closing a modal, return focus to the element that opened it. After executing a query, focus the result grid. After an error, focus the error message.

### P1 — Polish

#### 10.4 Responsive Layout
- **Current state:** Three-panel layout assumes wide screen.
- **Suggestion:** On narrow screens, collapse to two panels (file explorer overlay). On very narrow screens (tablet), single panel with bottom sheet for results.

#### 10.5 Onboarding Flow
- **Current state:** Onboarding banner shown when no LLM configured.
- **Suggestion:** Step-by-step first-run experience:
  1. Welcome → Choose a workspace directory
  2. File detected → Show schema preview
  3. Optional: Configure LLM API key
  4. Try a sample query (pre-populated)
  5. Try AI chat (suggested prompt)

#### 10.6 Loading States & Skeleton Screens
- **Suggestion:** Replace empty states with skeleton screens (gray placeholder blocks) during loading. Show progress indication for long operations (query execution, AI response).

---

## 11. Backend Infrastructure

### P1 — Important

#### 11.1 Structured Logging
- **Current state:** Errors logged as strings to console.
- **Suggestion:** Use `structlog` or Python's `logging` with JSON output. Include: timestamp, level, endpoint, query_id, duration_ms, error_type. Makes debugging production issues much easier.

#### 11.2 DuckDB Connection Pooling
- **Current state:** Single global connection with asyncio.Lock serializes all queries.
- **Suggestion:** For future multi-workspace or concurrent query support, use a pool of DuckDB connections (one per workspace). DuckDB supports multiple connections to the same in-memory database.

#### 11.3 Health Check Improvements
- **Current state:** `/health` returns `{"data": {"ok": true}}`.
- **Suggestion:** Add version, uptime, workspace status, DuckDB version, memory usage. Useful for Electron health monitoring and debugging.

#### 11.4 Error Recovery for LLM Calls
- **Current state:** `litellm.acompletion` errors surface as 500s (noted in REVIEW.md as unfixed).
- **Suggestion:** Wrap all litellm calls in try/except. Map known error types:
  - `AuthenticationError` → 401 with "Invalid API key" message
  - `RateLimitError` → 429 with retry suggestion
  - `APIConnectionError` → 503 with "Provider unreachable"
  - `Timeout` → 504 with timeout value
- **Already partially done in the SSE stream handler, but not in the inline endpoint.**

#### 11.5 Configuration Validation
- **Suggestion:** Validate settings on save (not just on use). Check that API key formats match expected patterns. Validate URLs for local providers. Return specific error messages for invalid configurations.

### P2 — Nice-to-Have

#### 11.6 WebSocket for Real-Time Updates
- **Current state:** SSE for file watcher and chat. SSE is one-directional.
- **Suggestion:** Consider WebSocket for bidirectional communication. Could enable: real-time query progress (percentage), collaborative features, live file updates.

#### 11.7 Plugin System (Backend)
- **Suggestion:** Allow custom tools to be added to the agent via Python files in a `plugins/` directory. Each plugin defines a tool function with a docstring. Agent discovers and binds plugins at startup.

---

## 12. Testing & Quality

### P0 — Gaps to Fill

#### 12.1 Frontend AI Component Tests
- **Current gaps:** ChatSidebar SSE streaming, DiffOverlay accept/reject flow, SettingsModal error cases.
- **Suggestion:** Add integration tests for:
  - SSE streaming with mocked ReadableStream
  - Diff overlay accept/reject → editor content update
  - Settings save with validation errors
  - @-mention autocomplete flow

#### 12.2 End-to-End Tests
- **Current state:** No E2E tests.
- **Suggestion:** Add Playwright tests for critical flows:
  - Open workspace → see files → run query → see results
  - Cmd+K → enter instruction → accept diff
  - Chat → send message → receive response → copy to editor
- **Framework:** Playwright supports Electron testing via `electron.launch()`.

#### 12.3 LLM Integration Tests
- **Current state:** LLM calls mocked in tests.
- **Suggestion:** Add integration tests that hit a local LLM (Ollama) for:
  - Inline edit generates valid SQL
  - Agent explores a file and returns meaningful results
  - Error recovery when LLM returns invalid tool calls
- **CI consideration:** Run these nightly, not on every PR (slow + requires GPU).

### P1 — Robustness

#### 12.4 Property-Based Testing
- **Suggestion:** Use `hypothesis` (Python) for property-based tests on:
  - SQL safety checker (generate random SQL, ensure blocked patterns always caught)
  - Path safety (generate path traversal attempts)
  - Result serialization (random DuckDB types → JSON round-trip)

#### 12.5 Performance Benchmarks
- **Suggestion:** Add benchmark tests:
  - Query execution time for 1K, 10K, 100K, 1M row results
  - JSON vs Arrow serialization time
  - Agent response time with different profiles
  - Frontend rendering time for large result grids

---

## 13. Ecosystem & Extensibility

### P1 — Differentiators

#### 13.1 CLI Mode
- **Suggestion:** `medha query "SELECT * FROM data.parquet"` — run queries from the command line without launching the GUI. Output as CSV/JSON/table. Useful for scripting and pipelines.
- **Implementation:** Add a `click` CLI that starts a minimal FastAPI server, executes the query, and exits.

#### 13.2 Saved Query Library
- **Current state:** Saved queries stored as `.sql` files in workspace. No organization.
- **Suggestion:** Add folders/categories for saved queries. Add descriptions. Support parameterized queries. Show a dedicated "Query Library" panel.

#### 13.3 Workspace Presets
- **Suggestion:** Save workspace configurations: which files are active, which tabs are open, chat sidebar state, result pane height. Restore exact state when re-opening a workspace.

### P2 — Future Vision

#### 13.4 Notebook Mode
- **Suggestion:** Sequential SQL cells with inline results (like Jupyter but for SQL). Each cell runs independently, results persist. Add markdown cells for documentation. Export as HTML report.
- **Competitive context:** DuckDB UI, MotherDuck, and Marimo all offer notebook-style interfaces.

#### 13.5 Data Pipeline Builder
- **Suggestion:** Visual interface to chain SQL transformations: File → Filter → Aggregate → Join → Export. Each step is a SQL query. The pipeline can be saved and re-run.

#### 13.6 Extension Marketplace
- **Suggestion:** Community-contributed extensions: custom visualizations, data source connectors, AI prompt templates, SQL snippets. Start with a simple plugin directory.

---

## 14. Competitive Differentiators — What Makes Medha Unique

Based on the competitive analysis, these are Medha's strongest differentiation opportunities:

### Already Unique
1. **True zero-egress local-first** — Only schemas (never data) sent to LLM. Stronger privacy than any cloud SQL tool.
2. **LLM-agnostic via litellm** — Works with OpenAI, Anthropic, Google, Ollama, LM Studio. No vendor lock-in.
3. **Cmd+K inline editing with diff** — Accept/reject workflow is ahead of most SQL IDEs.

### Highest-Impact New Differentiators
4. **Copilot-style ghost text SQL suggestions** (§4.3) — No SQL IDE offers this. Would be a first-of-kind feature.
5. **Column profiling / data explorer** (§3.1) — Turns Medha from "query runner" into "data understanding tool."
6. **MCP Server mode** (§4.11) — Expose local data to any AI tool. Medha becomes the data access layer for the AI ecosystem.
7. **AI data analyst profile** (§4.5) — Agent that tells data stories, not just generates SQL.

### Recommended Priority Order

| Phase | Focus | Key Features | Timeline |
|-------|-------|-------------|----------|
| **Phase 1: Polish** | Table stakes | Schema autocomplete, column sorting, copy to clipboard, SQL formatting, query timeout | 2-4 weeks |
| **Phase 2: Intelligence** | AI power | Ghost text suggestions, error fix button, token streaming, query optimization | 4-6 weeks |
| **Phase 3: Understanding** | Data insight | Column profiling, one-click charts, data quality indicators | 4-6 weeks |
| **Phase 4: Platform** | Ecosystem | MCP server, CLI mode, Windows/Linux builds, auto-update | 6-8 weeks |
| **Phase 5: Vision** | Differentiation | Notebook mode, pipeline builder, extension system | 8-12 weeks |

---

## Appendix: Tools Analyzed

DBeaver, DataGrip, TablePlus, Beekeeper Studio, DbGate, Harlequin, DuckDB UI, MotherDuck, Rill Data, Evidence, Observable, Marimo, Quadratic, Datasette, Metabase, VisiData, SQLMesh, SQL Chat

---

*This document should be treated as a living roadmap. Prioritize based on user feedback and usage patterns.*
