# Phase 7: State Persistence — TDD Implementation Plan

**Date:** 2026-03-06
**Approach:** Test-Driven Development — tests first, implementation second
**Scope:** Backend only (main.py lifespan + /api/boot endpoint)

---

## Overview

Three backend changes to make Medha stateful across restarts:

1. **Lifespan: apply API keys** — read `settings.json`, push keys to `os.environ`
2. **Lifespan: restore workspace** — call `set_workspace(last_workspace)` on boot
3. **New endpoint: `GET /api/boot`** — single hydration payload for frontend

---

## Step-by-Step TDD Plan

### Step 1: Write Tests (RED phase)

Create `backend/tests/test_boot.py` with the following test cases:

#### 1a. Lifespan — API key restoration

| Test | Asserts |
|------|---------|
| `test_lifespan_applies_api_keys_from_settings` | After app startup with settings.json containing API keys, `os.environ` has them |
| `test_lifespan_skips_empty_api_keys` | Empty strings in settings.json are NOT pushed to os.environ (don't clobber existing .env values) |
| `test_lifespan_settings_keys_override_env` | If both .env and settings.json have a key, settings.json wins (UI is source of truth) |

**Strategy:** These tests need to mock `load_settings()` to return controlled `Settings` objects, then verify `os.environ` after lifespan startup. Use the existing `client` fixture which triggers lifespan via ASGI transport.

**Key detail:** The `client` fixture creates the ASGI transport which triggers `lifespan()`. So we need to either:
- Create a dedicated fixture that patches `load_settings` before creating the client, OR
- Test `_apply_api_keys()` as a unit function directly (simpler, preferred)

**Decision: Unit-test `_apply_api_keys()` directly.** It's a pure function — give it a `Settings` object, check `os.environ`. No need for ASGI overhead.

#### 1b. Lifespan — workspace restoration

| Test | Asserts |
|------|---------|
| `test_lifespan_restores_workspace_from_settings` | After startup with `last_workspace` pointing to a valid dir, `db.workspace_root` is set |
| `test_lifespan_ignores_missing_workspace` | If `last_workspace` points to a deleted dir, startup completes without error, `db.workspace_root` stays `None` |
| `test_lifespan_no_workspace_when_empty` | If `last_workspace` is `""`, no workspace is configured |

**Strategy:** Mock `load_settings()` to return a Settings with `last_workspace` set to a `tmp_path` directory. After lifespan runs, check `db.workspace_root`. Clean up in teardown.

**Key detail:** `set_workspace()` also starts the file watcher. In tests, we need to ensure `stop_watcher()` is called in teardown. The existing `configured_client` fixture pattern already handles this — reset `db.workspace_root = None` after test.

#### 1c. `GET /api/boot` — no workspace

| Test | Asserts |
|------|---------|
| `test_boot_no_workspace` | Returns 200 with `workspace_path: ""`, `files: []`, `threads: []`, `recent_history: []`, and `settings` dict |
| `test_boot_response_shape` | All expected keys present in response |

#### 1d. `GET /api/boot` — with workspace configured

| Test | Asserts |
|------|---------|
| `test_boot_with_workspace` | Returns workspace_path, files list with sample.csv/sample.parquet, settings with model_chat |
| `test_boot_includes_threads` | If chats exist on disk, threads list is populated |
| `test_boot_includes_history` | If history exists on disk, recent_history list is populated |
| `test_boot_settings_keys_masked` | API keys in boot response are NOT exposed (or not included at all) |

### Step 2: Run Tests — Confirm RED

```bash
cd backend && uv run pytest tests/test_boot.py -v
```

All tests should FAIL since `_apply_api_keys()` and `GET /api/boot` don't exist yet.

### Step 3: Implement (GREEN phase)

#### 3a. `main.py` — add `_apply_api_keys()` function

```python
def _apply_api_keys(settings):
    """Push saved API keys to os.environ for litellm."""
    import os
    key_map = {
        "OPENAI_API_KEY": settings.openai_api_key,
        "OPENROUTER_API_KEY": settings.openrouter_api_key,
        "ANTHROPIC_API_KEY": settings.anthropic_api_key,
        "GEMINI_API_KEY": settings.gemini_api_key,
    }
    for env_var, value in key_map.items():
        if value:  # only set non-empty keys
            os.environ[env_var] = value
```

#### 3b. `main.py` — update lifespan

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.routers.workspace import load_settings
    from app.workspace import set_workspace, start_watcher, stop_watcher
    from app import db

    # 1. Load settings and push API keys
    settings = load_settings()
    _apply_api_keys(settings)

    # 2. Restore last workspace (silently skip if dir missing)
    if settings.last_workspace:
        try:
            set_workspace(settings.last_workspace)
        except (FileNotFoundError, ValueError, OSError):
            pass  # dir deleted/moved — start with no workspace

    # 3. Start file watcher if workspace restored
    if db.workspace_root is not None:
        start_watcher()

    yield

    # Shutdown
    stop_watcher()
    from app.db import conn
    conn.close()
```

**Note:** `set_workspace()` already calls `start_watcher()` internally, so we may not need step 3 explicitly. Need to verify — if `set_workspace` calls `start_watcher`, remove the redundant call.

#### 3c. New endpoint: `GET /api/boot`

Add to `app/routers/workspace.py` (since it already has settings/workspace logic):

```python
@router.get("/api/boot")
async def boot():
    """Single hydration payload for frontend on startup."""
    from app.routers.chats import _list_threads
    from app.routers.history import _list_history_entries

    settings = load_settings()
    files = scan_files() if db.workspace_root else []
    threads = _list_threads()
    history = _list_history_entries(20)

    return {
        "workspace_path": str(db.workspace_root) if db.workspace_root else "",
        "files": files,
        "threads": threads,
        "recent_history": history,
        "settings": {
            "model_chat": settings.model_chat,
            "model_inline": settings.model_inline,
            "agent_profile": settings.agent_profile,
            "last_workspace": settings.last_workspace,
        },
    }
```

**Key decision:** Settings in boot response contain model preferences only — NO API keys in the response. API keys are server-side only.

### Step 4: Run Tests — Confirm GREEN

```bash
cd backend && uv run pytest tests/test_boot.py -v
```

All tests should PASS.

### Step 5: Run Full Suite — No Regressions

```bash
cd backend && uv run pytest -v
```

Verify existing workspace, settings, and phase7 tests still pass. The lifespan change could affect test isolation if `set_workspace` is called during ASGI startup in the `client` fixture.

**Risk:** The `client` fixture triggers lifespan. If settings.json on the dev machine has `last_workspace` set, it would auto-configure a workspace during test startup. Mitigation: mock `load_settings` in conftest or ensure tests reset state.

### Step 6: Refactor (REFACTOR phase)

- Extract boot logic into a `boot.py` module if workspace.py gets too large
- Consider whether `_list_threads()` and `_list_history_entries()` should be `async def` wrappers (they do disk I/O)
- Wrap `_list_threads()` and `_list_history_entries()` calls in `asyncio.to_thread()` in the boot endpoint

---

## Test Isolation Concerns

The lifespan now does real work (reads settings, sets workspace). This could break existing tests if `settings.json` on the developer's machine has state.

**Solution:** Patch `load_settings` at the conftest level to return a clean `Settings()` default during tests:

```python
# In conftest.py — add autouse fixture
@pytest.fixture(autouse=True)
def _isolate_lifespan_settings(monkeypatch):
    """Prevent lifespan from loading real settings during tests."""
    from app.routers.workspace import Settings
    monkeypatch.setattr(
        "app.routers.workspace.load_settings",
        lambda: Settings(),
    )
```

Or more surgically: only patch in tests that need isolation, and let `test_boot.py` control its own settings.

**Preferred approach:** Add the monkeypatch to `conftest.py` as autouse, then in `test_boot.py` override it for specific tests that need custom settings.

---

## File Changes Summary

| File | Change |
|------|--------|
| `backend/tests/test_boot.py` | **NEW** — all state persistence tests |
| `backend/tests/conftest.py` | Add lifespan isolation fixture |
| `backend/app/main.py` | Add `_apply_api_keys()`, update lifespan |
| `backend/app/routers/workspace.py` | Add `GET /api/boot` endpoint |

---

## Execution Order

1. Write `test_boot.py` with all test cases
2. Run tests — confirm all RED
3. Update `conftest.py` with isolation fixture
4. Implement `_apply_api_keys()` in main.py
5. Update lifespan in main.py
6. Add `GET /api/boot` in workspace.py
7. Run `test_boot.py` — confirm all GREEN
8. Run full suite — confirm no regressions
