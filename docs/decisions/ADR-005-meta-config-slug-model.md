# ADR-005: Meta Config Fields for Slug Model and Last Workspace

**Date:** 2026-03-06  
**Status:** Accepted  
**Context:** (a) Slug generation for chat titles used the expensive chat model (e.g., GPT-4o) for trivial 1-line summaries. (b) The last-used workspace path was lost between app restarts.

## Decision
Add two fields to the existing `Settings` model in `~/.medha/settings.json`:
- `model_slug` (default: `"gpt-4o-mini"`) — cheap model used only for chat slug generation
- `last_workspace` (optional string) — absolute path of last configured workspace, written on configure

## Consequences
- **Positive:** Single config file for all settings, no proliferation of config locations
- **Positive:** `model_slug` saves significant API cost on a call that doesn't need intelligence
- **Positive:** `last_workspace` enables future auto-configure on boot (Phase C)
- **Negative:** Settings JSON grows — acceptable, still small
