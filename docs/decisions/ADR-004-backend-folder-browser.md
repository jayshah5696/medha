# ADR-004: Backend-Powered Folder Browser Instead of Web FileSystem API

**Date:** 2026-03-06  
**Status:** Accepted  
**Context:** The browser's `showDirectoryPicker()` API only returns the leaf folder name (e.g., `"SyntheticData"`), not the absolute path. Medha's backend requires absolute paths for the workspace sandbox.

## Decision
Remove the native directory picker entirely. Implement a backend-powered folder browser:
- `POST /api/workspace/browse` accepts a `path` parameter and returns directory entries with `is_dir` flags
- Frontend renders a modal with breadcrumb navigation, folder listing, and "Open" confirmation
- The selected path is the server-side absolute path — always valid

## Consequences
- **Positive:** Works in all browsers (not just Chromium), returns real absolute paths
- **Positive:** Server validates paths before returning them — impossible to configure an invalid workspace
- **Negative:** Exposes server filesystem structure to the frontend (mitigated: only directory names, local-only app)
- **Supersedes:** `showDirectoryPicker()` usage in FileExplorer.tsx
