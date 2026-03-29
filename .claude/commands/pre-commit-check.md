---
description: Run all pre-commit validation checks (fmt, lint, typecheck, tests) and fix issues
---

Run pre-commit validation checks on the current changes:

1. Run `just fmt` to format Python code
2. Run `just lint` to check for linting issues
3. Run `just typecheck` to verify TypeScript types
4. Run `just test` for backend tests
5. Run `just test-frontend` for frontend tests

Report results and fix any issues found. If all checks pass, confirm ready to commit.
