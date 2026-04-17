# Immediate Next Steps (Low-Hanging Fruit)

**Status:** All items ✅ DONE  
**Date:** 2026-04-17

---

## Completed ✅

### 1. Lazy-Import AI Stack
- **Result:** Backend idle RSS 199 MB → 78 MB, startup 2.3s → 0.44s
- **What changed:** `routers/ai.py` and `routers/chats.py` now import litellm/langchain/langgraph inside endpoint functions, not at module level
- **Commit:** `perf: lazy-import AI stack + DuckDB memory cap`

### 2. DuckDB Memory Cap
- **Result:** `SET memory_limit = '512MB'` and `SET threads = 4` in `db.py`
- **Prevents:** Unbounded buffer pool growth on large queries

### 3. PyInstaller Bundle Cleanup
- **Verdict:** Skipped — marginal savings (~2 MB) not worth debugging risk
- **Rationale:** dist-info (1.2 MB) + benchmarks (116 KB) cleanup would require spec rewrite for minimal gain

### 4. Product Improvements (from product-improvements.md)
- **Execute Selected SQL:** Cmd+Enter sends only selected text if selection exists
- **Column Type Indicators:** Backend returns `column_types`, ResultGrid shows type badges
- **Copy to Clipboard:** Cmd+C copies selected row as TSV
- **Command Palette:** Cmd+Shift+P opens fuzzy-search action list

### 5. Release v0.4.1
- **Status:** Ready to release — run `just verify-release && just release 0.4.1`

---

## Current App Profile (After All Optimizations)

| Metric | v0.3.1 (before) | v0.4.0 (size opt) | v0.4.1 (current) |
|--------|-----------------|-------------------|------------------|
| App size (installed) | 646 MB | 371 MB | 371 MB |
| Backend idle RSS | ~200 MB | ~200 MB | **78 MB** |
| Backend startup | ~2.3s | ~2.3s | **0.44s** |
| Modules at idle | 2,540 | 2,540 | **591** |
| Total app RSS | ~450 MB | ~450 MB | **253 MB** |
| DuckDB memory | Unbounded | Unbounded | **Capped 512 MB** |
| Frontend tests | 134 | 142 | **156** |
| Backend tests | 218 | 221 | **222** |
