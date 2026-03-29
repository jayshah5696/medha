---
description: Show project health dashboard (git, tests, types, branches, security, plans)
---

Show project health dashboard:

1. **Git**: Run `git log --oneline -10` for recent commits, `git status` for working tree
2. **Tests**: Run `just test` and `just test-frontend` (report pass/fail counts)
3. **Types**: Run `just typecheck` (report errors)
4. **Open branches**: Run `git branch --list`
5. **Security**: Check @REVIEW.md for unresolved high-priority issues
6. **Plans**: List active plans from @docs/plans/

Present as a clean dashboard summary.
