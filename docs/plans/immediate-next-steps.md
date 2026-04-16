# Immediate Next Steps (Low-Hanging Fruit)

**Status:** Lazy imports + DuckDB memory cap ✅ DONE  
**Date:** 2026-04-16

---

## Completed ✅

### 1. Lazy-Import AI Stack
- **Result:** Backend idle RSS 199 MB → 78 MB, startup 2.3s → 0.44s
- **What changed:** `routers/ai.py` and `routers/chats.py` now import litellm/langchain/langgraph inside endpoint functions, not at module level
- **Commit:** `perf: lazy-import AI stack + DuckDB memory cap`

### 2. DuckDB Memory Cap
- **Result:** `SET memory_limit = '512MB'` and `SET threads = 4` in `db.py`
- **Prevents:** Unbounded buffer pool growth on large queries

---

## Remaining Quick Wins

### 3. PyInstaller Bundle Cleanup
**Effort: 30 min | Savings: ~2 MB**

The bundle includes some unnecessary data files that `collect_data_files()` pulls in:
- `jsonschema/benchmarks/` (116 KB) — test benchmarks
- `litellm/proxy/` Python stubs are 192 KB (kept for import compatibility but could be stubbed further)
- `dist-info` directories (1.2 MB total) — package metadata, not needed at runtime

Add to `medha.spec` excludes or post-build strip script:
```python
# After COLLECT, strip unnecessary files
import shutil
for pattern in ['*/benchmarks/*', '*/.dist-info/RECORD', '*/.dist-info/top_level.txt']:
    # strip matching files
```

**Verdict:** Marginal savings. Not worth the debugging risk unless we're doing a spec rewrite anyway.

### 4. Push Lazy-Import Changes to Release
**Effort: 10 min**

The lazy-import and DuckDB cap changes are committed but not released. Next version bump should include them. Users will notice faster app launch immediately.

```bash
just verify-release
just release 0.4.1
git push origin main --tags
```

---

## Current App Profile (After All Optimizations)

| Metric | v0.3.1 (before) | v0.4.0 (size opt) | Current (lazy) |
|--------|-----------------|-------------------|----------------|
| App size (installed) | 646 MB | 371 MB | 371 MB |
| Backend idle RSS | ~200 MB | ~200 MB | **78 MB** |
| Backend startup | ~2.3s | ~2.3s | **0.44s** |
| Modules at idle | 2,540 | 2,540 | **591** |
| Total app RSS | ~450 MB | ~450 MB | **253 MB** |
| DuckDB memory | Unbounded | Unbounded | **Capped 512 MB** |
