#!/bin/bash
# setup-homebrew-tap.sh — Create the jayshah5696/homebrew-medha repo on GitHub.
#
# Prerequisites:
#   - gh CLI authenticated (gh auth login)
#
# This creates the Homebrew tap repo and adds the initial cask formula.
# Users will install with: brew tap jayshah5696/medha && brew install --cask medha

set -euo pipefail

OWNER="jayshah5696"
REPO="homebrew-medha"
FULL_REPO="$OWNER/$REPO"

echo "Creating GitHub repo $FULL_REPO..."
gh repo create "$FULL_REPO" \
  --public \
  --description "Homebrew tap for Medha — local-first SQL IDE" \
  --clone 2>/dev/null || {
    echo "Repo may already exist, cloning..."
    gh repo clone "$FULL_REPO" "$REPO" 2>/dev/null || true
  }

cd "$REPO" 2>/dev/null || { echo "Could not cd into $REPO"; exit 1; }

mkdir -p Casks

cat > Casks/medha.rb << 'CASK'
cask "medha" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0"
  sha256 arm:   "PLACEHOLDER_ARM64_SHA256",
         intel: "PLACEHOLDER_X64_SHA256"

  url "https://github.com/jayshah5696/medha/releases/download/v#{version}/Medha-#{version}-#{arch}.dmg"
  name "Medha"
  desc "Local-first SQL IDE for flat files"
  homepage "https://github.com/jayshah5696/medha"

  depends_on macos: ">= :ventura"

  app "Medha.app"

  zap trash: [
    "~/Library/Application Support/medha",
    "~/Library/Caches/com.medha.app",
    "~/Library/Logs/medha",
    "~/Library/Preferences/com.medha.app.plist",
    "~/.medha",
  ]
end
CASK

cat > README.md << 'README'
# Homebrew Tap for Medha

[Medha](https://github.com/jayshah5696/medha) is a local-first SQL IDE for flat files.

## Install

```bash
brew tap jayshah5696/medha
brew install --cask medha
```

## Update

```bash
brew upgrade --cask medha
```

## Uninstall

```bash
brew uninstall --cask medha
```
README

git add -A
git commit -m "Initial cask formula for Medha" 2>/dev/null || echo "Nothing to commit"
git push origin main 2>/dev/null || git push origin master 2>/dev/null

echo ""
echo "Done! Users can now install with:"
echo "  brew tap jayshah5696/medha"
echo "  brew install --cask medha"
echo ""
echo "The sha256 hashes are placeholders — they'll be updated"
echo "automatically when you push a v* tag (via release.yml)."
