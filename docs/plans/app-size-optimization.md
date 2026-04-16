# Medha App Size & Memory Optimization Plan

**Date:** 2026-04-16
**Current app size:** 646 MB installed (`/Applications/Medha.app`)
**Target:** ~250 MB (61% reduction)
**DMG size:** ~232 MB → target ~90 MB

---

## Forensic Size Breakdown

```
/Applications/Medha.app (646 MB)
├── Contents/Frameworks/                    245 MB (38%)
│   └── Electron Framework.framework        244 MB  ← Chromium, irreducible
│
├── Contents/Resources/                     400 MB (62%)
│   ├── sidecar/medha-backend/              398 MB  ← THE PROBLEM
│   │   ├── medha-backend (exe)              38 MB
│   │   └── _internal/                      361 MB
│   │       ├── pyarrow/ (dir)              114 MB  🔴 DUPLICATED DYLIBS
│   │       ├── libarrow*.dylib (top-level)  86 MB  🔴 DUPLICATED DYLIBS
│   │       ├── _duckdb.cpython-313.so       37 MB
│   │       ├── litellm/                     31 MB  🔴 20MB IS PROXY (UNUSED)
│   │       ├── pandas/                      17 MB  🔴 NOT USED AT ALL
│   │       ├── libpython3.13.dylib          17 MB
│   │       ├── cryptography/                9.6 MB 🟡 transitive dep
│   │       ├── tokenizers/                  7.9 MB 🟡 litellm dep
│   │       ├── hf_xet/                      6.8 MB 🔴 NOT NEEDED
│   │       ├── numpy/                       6.6 MB
│   │       ├── pyarrow/include/ (headers!)  5.3 MB 🔴 DEV-ONLY
│   │       ├── pydantic_core/               4.1 MB
│   │       └── tiktoken/                    2.6 MB
│   │
│   ├── frontend-dist/                       1.8 MB ✅ already tiny
│   └── app.asar                              52 KB ✅ already tiny
│
└── Contents/MacOS/                           68 KB
```

---

## Root Causes

### 1. 🔴 PyArrow duplicated libs: ~90 MB wasted
PyInstaller copies libarrow dylibs TWICE:
- Once at `_internal/libarrow*.dylib` (top-level binaries)
- Once at `_internal/pyarrow/libarrow*.dylib` (inside the pyarrow package)

**Different inodes** — these are full copies, not hardlinks.

Plus: `pyarrow/include/` (5.3 MB C++ headers) and `pyarrow/src/` (728 KB) are development-only files bundled by `collect_data_files("pyarrow")`.

### 2. 🔴 PyArrow's Arrow Flight, Substrait, Acero, Dataset — NOT NEEDED
The app only uses:
- `pyarrow` (core)
- `pyarrow.ipc` (for IPC serialization)
- `pyarrow.lib`

It does NOT use: Arrow Flight (19 MB), Substrait (4.6 MB), Acero (2.1 MB), Dataset (2.6 MB), Parquet (4.3 MB), Flight-Python (130 KB). That's **~33 MB of unnecessary Arrow sub-libraries**.

### 3. 🔴 PyArrow itself may be removable (frontend doesn't use Arrow format!)
`runQueryArrow()` is defined in `api.ts` but **never called** from any component. The frontend only uses JSON format queries. The Arrow IPC endpoint is dead code.

If we remove the Arrow endpoint, we can **drop PyArrow entirely** (-200 MB including duplicates) and use DuckDB's native `fetchall()` which already works for the JSON path.

### 4. 🔴 Pandas: 17 MB — NOT IMPORTED ANYWHERE
Zero imports of pandas in `backend/app/`. It was in `pyproject.toml` as a dependency but is never used. Pure dead weight.

### 5. 🔴 litellm proxy: 20 MB of the 31 MB
The app uses `litellm.acompletion()` and `litellm.exceptions` — SDK-only usage. The `litellm/proxy/` directory (20 MB) includes Swagger UI, Prisma schemas, guardrails, experimental features, logos, etc. None of it is used. `litellm` has since shipped `litellm-proxy-extras` to separate this.

### 6. 🔴 hf_xet: 6.8 MB — NOT NEEDED
HuggingFace XET transport. Pulled in transitively by `tokenizers`. Not needed for API-based LLM calls.

### 7. 🟡 collect_submodules() is a nuclear option
The spec file calls `collect_submodules()` on litellm, langchain, langchain_core, langchain_community, pyarrow, sqlglot, and pydantic. This bundles **every submodule** even if the app only uses 2-3. This is the root cause of the bloat.

### 8. 🟡 langchain_community: included but never imported
Zero imports of `langchain_community` in the app code. It's a dependency but adds unnecessary weight.

### 9. 🟡 strip=False on binaries
The PyInstaller spec has `strip=False` on both EXE and COLLECT. Stripping debug symbols from dylibs/so files can save 10-30% on native binaries.

---

## Optimization Plan (Ordered by Impact)

### Phase 1: Quick Wins — Remove Dead Weight (~220 MB saved)

| # | Action | Savings | Risk | Effort |
|---|--------|---------|------|--------|
| 1a | **Remove `pandas` from dependencies** — zero imports in app code | **17 MB** | None | 5 min |
| 1b | **Remove `pyarrow` entirely** — drop the unused Arrow IPC endpoint, use `fetchall()` for everything | **~200 MB** | Low — frontend never calls `runQueryArrow()` | 1 hour |
| 1c | **Remove `hf_xet` from bundle** — add to PyInstaller excludes | **6.8 MB** | None | 5 min |

**Details for 1b — Removing PyArrow:**
- Delete `async_execute_arrow()` and `_execute_sync_arrow()` from `db.py`
- Remove the `format == "arrow"` branch from `routers/db.py`
- Remove `runQueryArrow()` from `frontend/src/lib/api.ts` (dead code)
- Remove `pyarrow` from `pyproject.toml`
- Remove all pyarrow hidden imports, data files, and submodule collection from `medha.spec`
- This eliminates: pyarrow dir (114 MB) + all libarrow dylibs (86 MB) + numpy (used only by pyarrow) = ~200 MB
- DuckDB's `fetchall()` returns Python-native types; this is what the JSON path already uses

> **Note:** If we ever need Arrow format later (for huge result sets), DuckDB 1.3+ has a built-in `arrow` extension that can produce Arrow IPC without PyArrow.

### Phase 2: Trim litellm (~20 MB saved)

| # | Action | Savings | Risk | Effort |
|---|--------|---------|------|--------|
| 2a | **Exclude litellm.proxy from PyInstaller bundle** — add exclude patterns in spec | **20 MB** | Low — we only use SDK | 30 min |
| 2b | **Exclude litellm transitive deps we don't use** — `hf_xet`, excess `tokenizers` data | **~3 MB** | Low | 15 min |

**Implementation for 2a:**
Add to `medha.spec` excludes or add a post-build cleanup step:
```python
# In the spec file, add a Tree exclusion or hook
excludes += [
    "litellm.proxy",
    "litellm.proxy._experimental",
    "litellm.proxy.swagger",
    "litellm.proxy.guardrails",
]
```
Or add a custom PyInstaller hook to strip the proxy directory after collection.

### Phase 3: Stop Using Nuclear collect_submodules() (~15 MB saved)

| # | Action | Savings | Risk | Effort |
|---|--------|---------|------|--------|
| 3a | **Replace `collect_submodules("litellm")` with explicit imports** | **~10 MB** | Medium — must test | 1 hour |
| 3b | **Replace `collect_submodules("langchain_community")` — not even imported** | **~3 MB** | None | 10 min |
| 3c | **Replace `collect_submodules("sqlglot")` with explicit dialect imports** | **~2 MB** | Low | 15 min |

Only keep `collect_submodules()` for packages that truly need it (pydantic, langchain_core).

### Phase 4: Strip Binaries (~15-25 MB saved)

| # | Action | Savings | Risk | Effort |
|---|--------|---------|------|--------|
| 4a | **Set `strip=True`** in PyInstaller EXE and COLLECT | **15-25 MB** | None — only removes debug symbols | 5 min |
| 4b | **Enable UPX compression** (already `upx=True` but verify it's installed) | **5-15 MB** | None | 10 min |

### Phase 5: Remove langchain_community (~2 MB saved)

| # | Action | Savings | Risk | Effort |
|---|--------|---------|------|--------|
| 5a | **Remove `langchain-community` from dependencies** — zero imports | **~2 MB** | Check transitive deps | 15 min |

---

## Memory Optimization

### Current Memory Profile
The app runs 3+ processes:
1. **Electron main** (~80 MB) — Chromium main process
2. **Electron renderer** (~150-300 MB) — Chromium renderer (the UI)
3. **medha-backend (Python)** (~100-200 MB) — FastAPI + DuckDB + litellm

### Memory Reduction Strategies

| # | Strategy | Impact | Effort |
|---|----------|--------|--------|
| M1 | **Lazy-import litellm** — only import when AI features are used. litellm loads tokenizers, tiktoken, and many providers at import time | Saves ~50 MB RSS when AI is idle | 2 hours |
| M2 | **Lazy-import LangGraph** — same rationale | Saves ~20 MB RSS when AI is idle | 1 hour |
| M3 | **DuckDB memory limit** — set `SET memory_limit = '256MB'` to cap DuckDB's buffer pool | Prevents unbounded growth | 5 min |
| M4 | **Electron `--max-old-space-size`** — limit V8 heap if needed | Caps renderer memory | 5 min |
| M5 | **Consider duckdb-wasm in renderer** — eliminate the Python sidecar entirely for query execution (long-term) | Eliminates Python process | Large effort |

---

## Projected Results

| Component | Current | After Phase 1 | After All Phases |
|-----------|---------|---------------|------------------|
| Electron Framework | 244 MB | 244 MB | 244 MB |
| PyArrow + Arrow libs | ~200 MB | **0 MB** | **0 MB** |
| Pandas | 17 MB | **0 MB** | **0 MB** |
| litellm | 31 MB | 31 MB | **~8 MB** |
| DuckDB | 37 MB | 37 MB | 37 MB |
| Python runtime | 17 MB | 17 MB | 17 MB |
| hf_xet | 6.8 MB | **0 MB** | **0 MB** |
| Other (numpy, crypto, etc.) | ~50 MB | ~44 MB | ~35 MB |
| **Total** | **646 MB** | **~400 MB** | **~250 MB** |
| **DMG (compressed)** | **~232 MB** | **~145 MB** | **~90 MB** |

---

## Long-Term Architecture Options (Phase 6+)

### Option A: DuckDB-WASM — Eliminate Python Sidecar Entirely
Move query execution to `duckdb-wasm` running in the Electron renderer. The Python backend only serves AI features.
- **Pro:** Eliminates ~200 MB (Python runtime + DuckDB .so + all native deps). App becomes ~250 MB (Electron) + ~10 MB (tiny Python AI sidecar or use API directly).
- **Con:** duckdb-wasm has feature limitations, no filesystem access without Electron IPC bridge.

### Option B: Tauri Instead of Electron
Replace Electron with Tauri (Rust + system WebView).
- **Pro:** App shell drops from 244 MB to ~5-10 MB. Total app could be ~50 MB.
- **Con:** Major rewrite of the main process. No Chromium DevTools. WebView compatibility varies.

### Option C: DuckDB-WASM + Tauri (Ultimate)
Combine both. Query engine in WASM, AI calls go to APIs directly from the frontend.
- **Pro:** Total app ~20-30 MB.
- **Con:** Largest engineering effort. Loss of Python ecosystem.

---

## Implementation Order (Recommended)

```
Week 1: Phase 1 (Quick wins)
  └── Remove pandas, pyarrow, hf_xet → saves ~220 MB
  └── Write tests first per TDD mandate

Week 1: Phase 4 (Strip binaries)
  └── strip=True, verify UPX → saves ~15 MB

Week 2: Phase 2 (Trim litellm)
  └── Exclude proxy, swagger → saves ~20 MB

Week 2: Phase 3 (Fix collect_submodules)
  └── Replace nuclear imports with explicit → saves ~15 MB

Week 2: Memory optimizations (M1-M4)
  └── Lazy imports, DuckDB memory cap

Total: ~270 MB saved → app drops to ~375 MB (Phase 1+4)
                      → app drops to ~250 MB (all phases)
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Removing pyarrow breaks something we didn't know about | Check all `fetch_arrow_table` paths; DuckDB works fine without pyarrow via `fetchall()` |
| litellm proxy exclusion breaks dynamic imports | litellm SDK path (`acompletion`, `completion`) never imports proxy; test thoroughly |
| strip=True causes codesign issues | Strip before signing, not after. The `afterSign.js` hook re-signs everything |
| numpy removal breaks something | numpy is only needed by pyarrow/pandas; DuckDB doesn't require it for `fetchall()` |
| collect_submodules removal causes ImportError at runtime | Test each removal individually with a fresh build and run through all features |
