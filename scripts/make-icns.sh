#!/bin/bash
# make-icns.sh — Convert the Medha icon SVG to macOS .icns and copy
# the favicon.ico for Windows builds.
#
# Prerequisites:
#   - macOS (uses sips and iconutil, both built-in)
#   - rsvg-convert (from librsvg): brew install librsvg
#     OR: the pre-rendered PNGs in docs/brand/ (used as fallback)
#
# Usage:
#   ./scripts/make-icns.sh
#
# Output:
#   build/icon.icns   — macOS app icon
#   build/icon.ico    — Windows app icon (copied from favicon.ico)
#   build/icon.png    — 512px PNG for Linux builds

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRAND_DIR="$REPO_ROOT/docs/brand"
BUILD_DIR="$REPO_ROOT/build"
SVG_ICON="$BRAND_DIR/icon.svg"
ICONSET_DIR="$BUILD_DIR/icon.iconset"

echo "==> Creating iconset directory..."
mkdir -p "$ICONSET_DIR"

# -------------------------------------------------------------------
# Step 1: Generate PNGs at all required sizes
# macOS .iconset requires these exact filenames and sizes:
#   icon_16x16.png      (16px)
#   icon_16x16@2x.png   (32px)
#   icon_32x32.png      (32px)
#   icon_32x32@2x.png   (64px)
#   icon_128x128.png    (128px)
#   icon_128x128@2x.png (256px)
#   icon_256x256.png    (256px)
#   icon_256x256@2x.png (512px)
#   icon_512x512.png    (512px)
#   icon_512x512@2x.png (1024px)
# -------------------------------------------------------------------

# Render a PNG from the SVG at a given size.
# Falls back to resizing a pre-rendered PNG if rsvg-convert is missing.
render_png() {
    local size=$1
    local output=$2

    if command -v rsvg-convert &>/dev/null; then
        rsvg-convert -w "$size" -h "$size" "$SVG_ICON" -o "$output"
    elif [ -f "$BRAND_DIR/icon-512.png" ]; then
        # Fallback: resize the 512px PNG using sips (built into macOS)
        cp "$BRAND_DIR/icon-512.png" "$output"
        sips -z "$size" "$size" "$output" >/dev/null 2>&1
    else
        echo "ERROR: Neither rsvg-convert nor icon-512.png found." >&2
        echo "Install librsvg:  brew install librsvg" >&2
        exit 1
    fi
}

echo "==> Rendering PNGs at all required sizes..."

render_png   16 "$ICONSET_DIR/icon_16x16.png"
render_png   32 "$ICONSET_DIR/icon_16x16@2x.png"
render_png   32 "$ICONSET_DIR/icon_32x32.png"
render_png   64 "$ICONSET_DIR/icon_32x32@2x.png"
render_png  128 "$ICONSET_DIR/icon_128x128.png"
render_png  256 "$ICONSET_DIR/icon_128x128@2x.png"
render_png  256 "$ICONSET_DIR/icon_256x256.png"
render_png  512 "$ICONSET_DIR/icon_256x256@2x.png"
render_png  512 "$ICONSET_DIR/icon_512x512.png"
render_png 1024 "$ICONSET_DIR/icon_512x512@2x.png"

# -------------------------------------------------------------------
# Step 2: Convert the .iconset to .icns
# -------------------------------------------------------------------
echo "==> Converting iconset to .icns..."
iconutil -c icns "$ICONSET_DIR" -o "$BUILD_DIR/icon.icns"

# -------------------------------------------------------------------
# Step 3: Copy a 512px PNG for Linux builds (electron-builder default)
# -------------------------------------------------------------------
echo "==> Copying icon.png for Linux..."
cp "$ICONSET_DIR/icon_512x512.png" "$BUILD_DIR/icon.png"

# -------------------------------------------------------------------
# Step 4: Copy favicon.ico for Windows builds
# -------------------------------------------------------------------
if [ -f "$REPO_ROOT/frontend/public/favicon.ico" ]; then
    echo "==> Copying favicon.ico as Windows icon..."
    cp "$REPO_ROOT/frontend/public/favicon.ico" "$BUILD_DIR/icon.ico"
else
    echo "WARN: No favicon.ico found at frontend/public/favicon.ico"
    echo "      Windows builds will not have a custom icon."
fi

# -------------------------------------------------------------------
# Cleanup: remove the temporary .iconset directory
# -------------------------------------------------------------------
rm -rf "$ICONSET_DIR"

echo ""
echo "Done! Icons created in $BUILD_DIR/:"
ls -lh "$BUILD_DIR"/icon.*
