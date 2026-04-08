import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const justfile = readFileSync(new URL("../justfile", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const bumpVersionScript = readFileSync(
  new URL("../scripts/bump-version.sh", import.meta.url),
  "utf8"
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
