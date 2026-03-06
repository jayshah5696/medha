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

## Key Learnings
_Persistent memory: update this table when an agent makes a mistake so future sessions don't repeat it._

| Date | What Went Wrong | What To Do Instead |
|------|-----------------|--------------------|
| 2026-03-06 | Agent SSE `query_result` event called `setEditorContent()`, overwriting user's work mid-typing | Store agent results in separate state (`agentLastQuery`), never hijack user-facing editor content from background processes |
| 2026-03-06 | `asyncio.Lock()` at module level binds to wrong event loop in tests/ASGI | Create locks lazily via getter function (`_get_db_lock()`) with `reset_db_lock()` for test isolation |


## meta Design
- When you hit a complex bug or make an architectural mistake, write this learning in the napkin (.agents/napkin.md)
- write documents and plan in docs/plans/ and docs/solutions/ and docs/decisions/