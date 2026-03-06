# ADR-001: Inline SVG Logo with CSS Variable Fill

**Date:** 2026-03-06  
**Status:** Accepted  
**Context:** The Medha logo was invisible in dark mode because opaque PNG logos (dark-on-dark, light-on-light) were being loaded.

## Decision
Replace both PNG logo assets with a single inline SVG element whose `fill` is set to `var(--accent)`.

## Consequences
- **Positive:** Zero external asset files, automatically adapts to any theme (current or future), single source of truth
- **Positive:** No conditional logic for theme-based image swapping
- **Negative:** Logo shape must be expressible as SVG paths (not an issue for simple logos)
- **Supersedes:** PNG-based logo with theme-conditional `src` attribute
