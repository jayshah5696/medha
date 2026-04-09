# Medha Release Runbook

Use this runbook for every Medha desktop release. It covers local verification, versioning, tagging, GitHub Release automation, and Homebrew tap verification end to end.

## Scope

This runbook applies to:
- tagged desktop releases from `medha`
- GitHub Release automation in `.github/workflows/release.yml`
- automatic cask updates in `jayshah5696/homebrew-medha`

## Preconditions

Before starting a release, ensure:
- you are on `main`
- working tree is clean
- `gh` is authenticated if you plan to inspect workflow runs
- release secrets are already configured in GitHub Actions (especially the Homebrew tap token)

## Step 1: Local preflight verification

Run the full release preflight:

```bash
just verify-release
```

This checks:
- release automation tests (`tests/release-setup.test.mjs`)
- frontend tests
- frontend lint
- frontend build
- backend tests

Do not tag a release until this passes.

## Step 2: Bump version and create release tag

```bash
just release 0.3.2
```

This updates version metadata, commits the release bump, and creates tag `v0.3.2`.

## Step 3: Push main and tags

```bash
git push origin main --tags
```

This triggers the GitHub `Release` workflow on the new `v*` tag.

## Step 4: Monitor the GitHub Release workflow

Check the release workflow status:

```bash
gh run list -R jayshah5696/medha --workflow Release --limit 5
```

Inspect the latest release run if needed:

```bash
gh run view <run-id> -R jayshah5696/medha --verbose
gh run view <run-id> -R jayshah5696/medha --job <job-id> --log
```

### Expected successful jobs
- `build-sidecar (macos-14, arm64)`
- `build-sidecar (macos-15, x64)`
- `build-desktop (macos-14, arm64)`
- `build-desktop (macos-15, x64)`
- `test`
- `publish`
- `update-homebrew`

## Step 5: Verify GitHub Release assets

After publish succeeds:

```bash
gh release view v0.3.2 -R jayshah5696/medha --json tagName,name,isDraft,isPrerelease,publishedAt,assets
```

Expected DMG assets:
- `Medha-0.3.2-arm64.dmg`
- `Medha-0.3.2-x64.dmg`

## Step 6: Verify Homebrew automation

Update local taps and verify the cask:

```bash
brew update
brew info --cask jayshah5696/medha/medha
brew fetch --cask jayshah5696/medha/medha
```

Expected:
- Homebrew reports the new version
- `brew fetch` succeeds without checksum mismatch

You can also inspect the tap file directly:

```bash
brew cat --cask jayshah5696/medha/medha
```

## Step 7: Verify tap repository state

Optional direct verification:

```bash
cd ~/Documents/GitHub/homebrew-medha
git fetch origin
git checkout main
git reset --hard origin/main
sed -n '1,20p' Casks/medha.rb
```

Check that:
- `version` matches the release
- arm SHA matches the arm64 DMG
- intel SHA matches the x64 DMG
- arch line is still:
  ```ruby
  arch arm: "arm64", intel: "x64"
  ```

## Step 8: If Homebrew is wrong, recover immediately

If the cask version or checksum is wrong:

1. Inspect the `update-homebrew` workflow logs.
2. Compare computed SHA values in the log with the cask file.
3. Patch `homebrew-medha/Casks/medha.rb` manually and push a fix.
4. Patch the automation in `medha` before the next release.
5. Add or update a regression test in `tests/release-setup.test.mjs`.
6. Update `AGENTS.md` and `.agents/napkin.md` if a new failure mode was discovered.

## Automation safeguards in place

### Dedicated updater script
Homebrew cask updates must go through:

- `scripts/update-homebrew-cask.sh`

This script updates:
- `version`
- `sha256 arm`
- `intel`

It also validates exact replacement counts and expected values.

### Regression coverage
Release automation is protected by:

- `tests/release-setup.test.mjs`

These tests verify:
- the workflow uses the dedicated updater script
- both SHA lines are rewritten correctly
- the arch line is preserved

## Canonical release checklist

Use this exact checklist:

```bash
just verify-release
just release X.Y.Z
git push origin main --tags
brew update
brew info --cask jayshah5696/medha/medha
brew fetch --cask jayshah5696/medha/medha
```

If any step fails, stop and fix the automation before the next release.
