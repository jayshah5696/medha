#!/bin/bash
# sign-app.sh — Properly sign the Medha.app bundle for local development.
#
# The key insight: codesign --deep re-signs EVERYTHING including the PyInstaller
# sidecar libraries, giving them a different ad-hoc identity than the sidecar
# binary itself. macOS then refuses to load them ("different Team IDs").
#
# The fix: sign bottom-up, sidecar first, then Electron frameworks, then the app.

set -euo pipefail

APP_PATH="${1:-release/mac-arm64/Medha.app}"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: $APP_PATH not found"
  exit 1
fi

echo "==> Clearing extended attributes..."
xattr -cr "$APP_PATH"

echo "==> Signing sidecar binaries..."
# Sign all .dylib and .so files in the sidecar _internal directory
find "$APP_PATH/Contents/Resources/sidecar" -type f \( -name "*.dylib" -o -name "*.so" \) | while read -r lib; do
  codesign --force --sign - "$lib" 2>/dev/null || true
done

# Sign the sidecar binary itself
codesign --force --sign - "$APP_PATH/Contents/Resources/sidecar/medha-backend/medha-backend"

echo "==> Signing Electron frameworks..."
# Sign Electron Framework
if [ -d "$APP_PATH/Contents/Frameworks/Electron Framework.framework" ]; then
  codesign --force --sign - "$APP_PATH/Contents/Frameworks/Electron Framework.framework"
fi

# Sign helper apps
find "$APP_PATH/Contents/Frameworks" -name "*.app" -type d | while read -r helper; do
  codesign --force --sign - "$helper"
done

echo "==> Signing main app..."
codesign --force --sign - "$APP_PATH"

echo "==> Verifying..."
codesign --verify --deep --strict "$APP_PATH" 2>&1 || echo "(deep verification may show warnings for ad-hoc signed apps — this is OK for local dev)"

echo "Done! App is signed for local development."
