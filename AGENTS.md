# Medha AI Agent Instructions

## Core Working Agreement
- **Test-Driven Development (TDD) is MANDATORY**: Before adding features or editing code, ensure a test exists for those scenarios. Otherwise, create the test case first, then implement the code.

## Preferences
- Use absolute imports from `backend/app/`
- Prioritize clear, robust error handling over silent failures
- Follow FastAPI best practices for routing and dependency injection
- Use frontend design skills for all UI-related tasks
- Use LangGraph for all agent-related development

## Patterns
- API endpoints should generally use Pydantic models for validation
- Follow the existing workspace and agent routing paradigms

## Architecture Decisions
- **No Tauri** — stay with Electron. Do not propose or implement a Tauri migration.
- **Minimize app bundle size** — see `docs/plans/app-size-optimization.md` for the active plan. Every new dependency must justify its disk weight.

## Desktop Build & Release
- **Follow the end-to-end runbook in `docs/solutions/release-runbook.md`** for every tagged release and Homebrew update
- **Never disable code signing** — always re-sign the full `.app` bundle (including PyInstaller sidecar dylibs) via `scripts/afterSign.js`
- **Test every build with quarantine flag** before releasing: `xattr -w com.apple.quarantine "0083;..." Medha.app` then launch
- **PyInstaller sidecar has ~34 loose `.dylib`/`.so` files** (reduced from ~145 after pyarrow removal) — `codesign --deep` only covers `.app`/`.framework` bundles, not loose binaries in `Resources/sidecar/`. The `afterSign.js` hook handles this; do not remove or bypass it
- After `cp`-ing an `.app` to `/Applications`, always verify it's the new binary (`stat -f "%m"`) — stale copies cause phantom failures
- Before pushing a release tag, run the documented preflight (`just verify-release`) and after the workflow finishes verify Homebrew with `brew update`, `brew info --cask jayshah5696/medha/medha`, and `brew fetch --cask jayshah5696/medha/medha`

## Key Learnings
_Persistent memory: update this table when an agent makes a mistake so future sessions don't repeat it._

| Date | What Went Wrong | What To Do Instead |
|------|-----------------|--------------------|
| 2026-03-06 | Agent SSE `query_result` event called `setEditorContent()`, overwriting user's work mid-typing | Store agent results in separate state (`agentLastQuery`), never hijack user-facing editor content from background processes |
| 2026-03-06 | `asyncio.Lock()` at module level binds to wrong event loop in tests/ASGI | Create locks lazily via getter function (`_get_db_lock()`) with `reset_db_lock()` for test isolation |
| 2026-04-05 | Ad-hoc signed Electron app crashes on launch when quarantine flag is set (Homebrew installs) — dyld reports "different Team IDs" | Use `afterSign.js` hook (not afterPack — that runs before electron-builder signs) to re-sign every Mach-O binary in the bundle, including PyInstaller sidecar dylibs |
| 2026-04-05 | CI `sed` to update Homebrew cask SHA256 also matched the `arch` line (`intel: "x64"` → `intel: "<sha256>"`), breaking all installs | Scope `sed` with `/sha256/` line address and `[0-9a-f]{64}` pattern. CI validates the cask formula structure before pushing |
| 2026-04-08 | Agent fixed frontend UI regressions before creating regression tests, violating mandatory TDD and making it harder to verify stateful UI behavior | For any UI bug or feature, write or update the failing frontend test first (store/component/integration), then implement the fix, then run `vitest`, `lint`, and `build` before pushing |
| 2026-04-08 | Homebrew release workflow updated `version` and arm SHA but silently left the intel SHA stale because the cask stores `sha256` across two lines and the sed-based replacement only matched the arm line | Never patch the Homebrew cask with ad-hoc sed. Use a dedicated updater script that replaces `version`, `sha256 arm`, and `intel` lines independently, validates exact replacement counts, and is covered by a release regression test before pushing workflow changes |
| 2026-04-16 | PyInstaller spec used `collect_submodules()` on 8 packages + bundled pyarrow (200 MB), pandas (17 MB), litellm proxy (20 MB) — none actually used. App was 646 MB | Audit actual imports before adding deps. Use explicit hiddenimports, not nuclear `collect_submodules()`. Always verify `runQueryArrow()` etc. are actually called before keeping heavy deps. Set `strip=True` in spec |


## meta Design
- When you hit a complex bug or make an architectural mistake, write this learning in the napkin (.agents/napkin.md)
- write documents and plan in docs/plans/ and docs/solutions/ and docs/decisions/