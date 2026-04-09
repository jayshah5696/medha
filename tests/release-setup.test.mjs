import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const justfile = readFileSync(new URL("../justfile", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const bumpVersionScript = readFileSync(
  new URL("../scripts/bump-version.sh", import.meta.url),
  "utf8"
);
const releaseWorkflow = readFileSync(
  new URL("../.github/workflows/release.yml", import.meta.url),
  "utf8"
);
const updateHomebrewCaskScript = new URL(
  "../scripts/update-homebrew-cask.sh",
  import.meta.url
);

test("install recipe includes root electron dependency install", () => {
  assert.match(justfile, /^install:\n(?:    .*\n)*    npm install$/m);
  assert.match(justfile, /^install:\n(?:    .*\n)*    cd backend && uv sync$/m);
  assert.match(
    justfile,
    /^install:\n(?:    .*\n)*    cd frontend && NODE_ENV=development npm install$/m
  );
});

test("desktop build recipes rebuild the sidecar and clean packaged artifacts", () => {
  assert.match(
    justfile,
    /^build-sidecar:\n    cd backend && uv run pyinstaller -y medha\.spec$/m
  );
  assert.match(
    justfile,
    /^build-desktop: build-sidecar build-frontend build-electron$/m
  );
  assert.match(justfile, /^clean-desktop:\n(?:    .*\n)*    rm -rf backend\/dist backend\/build$/m);
});

test("local desktop packaging commands never auto-publish and disable cert autodiscovery", () => {
  assert.equal(
    packageJson.scripts["electron:pack"],
    "CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir --publish never"
  );
  assert.equal(
    packageJson.scripts["electron:dist"],
    "CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --publish never"
  );
  assert.match(
    justfile,
    /^build-desktop: build-sidecar build-frontend build-electron\n    CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --publish never$/m
  );
  assert.match(
    justfile,
    /^pack-mac: build-sidecar build-frontend build-electron\n    CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --publish never$/m
  );
  assert.match(
    justfile,
    /^build-release: build-sidecar build-frontend build-electron\n(?:    .*\n)*    CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --publish never$/m
  );
});

test("version bump script uses npm version to keep package-lock in sync", () => {
  assert.match(
    bumpVersionScript,
    /npm version "\$VERSION" --no-git-tag-version --allow-same-version/
  );
  assert.match(bumpVersionScript, /git add package\.json package-lock\.json backend\/pyproject\.toml/);
});

test("release workflow uses dedicated homebrew cask updater script", () => {
  assert.match(
    releaseWorkflow,
    /bash scripts\/update-homebrew-cask\.sh\s+\\\s+"\$\{\{ steps\.version\.outputs\.version \}\}"\s+\\\s+"\$\{\{ steps\.sha\.outputs\.arm64 \}\}"\s+\\\s+"\$\{\{ steps\.sha\.outputs\.x64 \}\}"\s+\\\s+tap\/Casks\/medha\.rb/
  );
});

test("homebrew cask updater replaces both split sha lines and preserves arch line", () => {
  const dir = mkdtempSync(join(tmpdir(), "medha-cask-test-"));
  const caskPath = join(dir, "medha.rb");

  writeFileSync(
    caskPath,
    `cask "medha" do\n  arch arm: "arm64", intel: "x64"\n\n  version "0.2.1"\n  sha256 arm:   "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",\n         intel: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"\n\n  url "https://github.com/jayshah5696/medha/releases/download/v#{version}/Medha-#{version}-#{arch}.dmg"\nend\n`
  );

  execFileSync(
    "bash",
    [
      updateHomebrewCaskScript.pathname,
      "0.3.1",
      "e41fcc67e097b5890a98f22ee70da7e233362d1f27c93cfc30d7e15ee8f0604d",
      "1d1cdc01f9a062e78b4e432b431f4331c43fa2b7869aae321d2329fc77da6370",
      caskPath,
    ],
    { stdio: "pipe" }
  );

  const updated = readFileSync(caskPath, "utf8");
  assert.match(updated, /arch arm: "arm64", intel: "x64"/);
  assert.match(updated, /version "0\.3\.1"/);
  assert.match(updated, /sha256 arm:\s+"e41fcc67e097b5890a98f22ee70da7e233362d1f27c93cfc30d7e15ee8f0604d",/);
  assert.match(updated, /intel: "1d1cdc01f9a062e78b4e432b431f4331c43fa2b7869aae321d2329fc77da6370"/);
  assert.doesNotMatch(updated, /bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);

  rmSync(dir, { recursive: true, force: true });
});
