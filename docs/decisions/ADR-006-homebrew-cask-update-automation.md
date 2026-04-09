# ADR-006: Safe Homebrew cask update automation

- **Date:** 2026-04-08
- **Status:** Accepted

## Context

Medha publishes macOS DMGs to GitHub Releases and then updates the Homebrew cask in `jayshah5696/homebrew-medha`.

The original release workflow updated the cask with `sed` substitutions in `.github/workflows/release.yml`. That approach was fragile because the cask stores the checksum across two physical lines:

```ruby
sha256 arm:   "<arm_sha>",
       intel: "<intel_sha>"
```

The workflow used `/sha256/`-scoped `sed`, which only operates on the first line containing `sha256`. As a result, the arm checksum updated, but the Intel checksum could remain stale while validation still passed.

## Decision

We will use a dedicated script, `scripts/update-homebrew-cask.sh`, to update the cask formula.

The script must:

1. Update the `version` line.
2. Update the `sha256 arm:` line.
3. Update the `intel:` line.
4. Validate exact replacement counts.
5. Validate that the `arch arm: "arm64", intel: "x64"` line remains intact.
6. Validate that the expected computed SHA values are written, not just any 64-character hex string.

The release workflow calls this script instead of inline `sed`.

## Consequences

### Positive
- Prevents partial checksum updates.
- Makes the workflow easier to reason about and test.
- Allows regression tests to verify updater behavior without running a full release.
- Aligns with project guidance to avoid brittle release automation.

### Negative
- Adds one release-maintenance script to the repository.
- Slightly increases workflow complexity, but in a controlled and testable way.

## Verification

This decision is protected by regression tests in:

- `tests/release-setup.test.mjs`

Those tests assert:

- the workflow uses the dedicated updater script
- the updater script correctly rewrites both SHA lines
- the `arch` line is preserved

## Operational guidance

If a Homebrew release looks wrong:

1. Inspect the `update-homebrew` job logs in GitHub Actions.
2. Compare the computed SHA values in the logs with the actual cask contents.
3. If they differ, fix the cask in `homebrew-medha` immediately.
4. Patch the updater script and/or tests in `medha` before the next release.
