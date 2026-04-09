#!/bin/bash
# update-homebrew-cask.sh — Update Medha Homebrew cask version and checksums safely.
#
# Usage:
#   bash scripts/update-homebrew-cask.sh <version> <arm_sha> <intel_sha> <cask_path>
#
# This script is intentionally line-oriented and explicit because the Homebrew
# formula uses split sha256 lines:
#   sha256 arm:   "<hash>",
#          intel: "<hash>"
#
# Previous sed-based replacements accidentally updated only the arm line while
# leaving the intel SHA stale. We now replace the version line and both sha256
# lines independently with anchored patterns and validate the result.

set -euo pipefail

if [ $# -ne 4 ]; then
  echo "Usage: $0 <version> <arm_sha> <intel_sha> <cask_path>"
  exit 1
fi

VERSION="$1"
ARM_SHA="$2"
INTEL_SHA="$3"
CASK_PATH="$4"

if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "ERROR: version must be semver"
  exit 1
fi

for SHA in "$ARM_SHA" "$INTEL_SHA"; do
  if ! echo "$SHA" | grep -qE '^[0-9a-f]{64}$'; then
    echo "ERROR: invalid sha256: $SHA"
    exit 1
  fi
done

if [ ! -f "$CASK_PATH" ]; then
  echo "ERROR: cask file not found: $CASK_PATH"
  exit 1
fi

python3 - "$VERSION" "$ARM_SHA" "$INTEL_SHA" "$CASK_PATH" <<'PY'
import pathlib
import re
import sys

version, arm_sha, intel_sha, cask_path = sys.argv[1:5]
path = pathlib.Path(cask_path)
text = path.read_text()

text, version_count = re.subn(
    r'^\s*version\s+"[^"]+"$',
    f'  version "{version}"',
    text,
    count=1,
    flags=re.MULTILINE,
)
text, arm_count = re.subn(
    r'^\s*sha256\s+arm:\s+"[0-9a-f]{64}",$',
    f'  sha256 arm:   "{arm_sha}",',
    text,
    count=1,
    flags=re.MULTILINE,
)
text, intel_count = re.subn(
    r'^\s*intel:\s+"[0-9a-f]{64}"$',
    f'         intel: "{intel_sha}"',
    text,
    count=1,
    flags=re.MULTILINE,
)

if version_count != 1:
    raise SystemExit(f"ERROR: expected to update exactly 1 version line, updated {version_count}")
if arm_count != 1:
    raise SystemExit(f"ERROR: expected to update exactly 1 arm sha line, updated {arm_count}")
if intel_count != 1:
    raise SystemExit(f"ERROR: expected to update exactly 1 intel sha line, updated {intel_count}")

path.write_text(text)
PY

grep -q 'arch arm: "arm64", intel: "x64"' "$CASK_PATH" \
  || { echo "ERROR: arch line is corrupted"; cat "$CASK_PATH"; exit 1; }
grep -q "version \"$VERSION\"" "$CASK_PATH" \
  || { echo "ERROR: version line was not updated"; cat "$CASK_PATH"; exit 1; }
grep -qE "sha256 arm:\s+\"$ARM_SHA\"," "$CASK_PATH" \
  || { echo "ERROR: arm sha line was not updated"; cat "$CASK_PATH"; exit 1; }
grep -qE "intel:\s+\"$INTEL_SHA\"" "$CASK_PATH" \
  || { echo "ERROR: intel sha line was not updated"; cat "$CASK_PATH"; exit 1; }

echo "Updated cask formula:"
cat "$CASK_PATH"
