#!/bin/bash
# bump-version.sh — Bump version across all project files, commit, and tag.
#
# Usage: ./scripts/bump-version.sh 0.2.0
#
# Updates:
#   - package.json (Electron/root)
#   - backend/pyproject.toml (Python backend)
#
# Then commits and creates a git tag (v0.2.0).
# Push with: git push origin main --tags

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.2.0"
  exit 1
fi

VERSION="$1"

# Validate semver format
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: Version must be semver (e.g., 0.2.0)"
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

# Check for uncommitted changes
if ! git diff --quiet HEAD; then
  echo "Error: Uncommitted changes. Commit or stash first."
  exit 1
fi

# Check tag doesn't already exist
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Error: Tag v$VERSION already exists."
  exit 1
fi

echo "Bumping to v$VERSION..."

# 1. Root package.json (Electron reads this)
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json
echo "  Updated package.json"

# 2. Backend pyproject.toml
sed -i '' "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" backend/pyproject.toml
echo "  Updated backend/pyproject.toml"

# 3. Commit and tag
git add package.json backend/pyproject.toml
git commit -m "Release v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"

echo ""
echo "Done! Tagged v$VERSION."
echo ""
echo "To release:"
echo "  git push origin main --tags"
echo ""
echo "This will trigger the GitHub Actions release workflow."
