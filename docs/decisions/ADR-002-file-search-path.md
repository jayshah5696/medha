# ADR-002: DuckDB FILE_SEARCH_PATH for Relative Path Resolution

**Date:** 2026-03-06  
**Status:** Accepted  
**Context:** Users write SQL with bare filenames (`SELECT * FROM 'train.csv'`) but DuckDB doesn't know the workspace root directory.

## Decision
Use DuckDB's native `SET FILE_SEARCH_PATH = '{workspace_root}'` instead of rewriting SQL to inject absolute paths.

## Consequences
- **Positive:** Single line of code in `set_workspace()`, zero regex or SQL parsing
- **Positive:** DuckDB handles all path resolution natively — works for all SQL patterns
- **Positive:** No risk of breaking SQL syntax via string manipulation
- **Negative:** Relies on DuckDB-specific feature (acceptable — DuckDB is the only supported engine)
