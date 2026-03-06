# ADR-003: Agent Query Result → Editor Sync via Module Stash + SSE

**Date:** 2026-03-06  
**Status:** Accepted  
**Context:** When the LangGraph agent executes SQL via the `execute_query` tool, the result appeared only in the chat text. The SQL editor and result grid remained empty.

## Decision
Hybrid Pattern (2+3):
1. `execute_query` tool stashes structured result (columns + rows) in a module-level variable `_last_query_result`
2. After the agent yields the tool message, the SSE streamer calls `_pop_last_query_result()` and emits a `query_result` SSE event
3. Frontend `ChatSidebar` listens for the event and updates the Zustand store, which auto-populates `SqlEditor` and `ResultGrid`

## Alternatives Considered
- **Extend LangGraph state:** Would require schema changes and custom state reducers — heavyweight for a simple pass-through
- **Redis/queue:** Over-engineered for single-user local app
- **WebSocket:** Would require new transport alongside existing SSE

## Consequences
- **Positive:** Works within existing SSE streaming infrastructure, no new transport
- **Positive:** Module-level stash is simple and has clear single-request lifecycle (pop-once semantics)
- **Negative:** Module-level state is not safe for concurrent requests — acceptable for single-user local app
- **Negative:** Tight coupling between tools.py stash and agent.py emission — mitigated by clear pop-once contract
