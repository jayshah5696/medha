// afterPack hook for electron-builder
// Re-signs the .app bundle with a consistent ad-hoc identity so that
// the main binary and all embedded frameworks (Electron Framework, helpers)
// share the same signature origin. Without this, macOS dyld refuses to load
// frameworks when the app has a quarantine flag (e.g. Homebrew installs).

const { execSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (process.platform !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`[afterPack] Re-signing ${appPath} with consistent ad-hoc identity…`);

  try {
    // --deep signs every nested bundle/framework/helper with the same identity
    // --force replaces any existing signatures
    // "-" is the ad-hoc identity (no Apple Developer cert required)
    execSync(
      `codesign --deep --force --sign - "${appPath}"`,
      { stdio: "inherit" }
    );
    console.log("[afterPack] Re-signing complete.");

    // Verify the result
    execSync(
      `codesign --verify --deep --verbose=2 "${appPath}"`,
      { stdio: "inherit" }
    );
    console.log("[afterPack] Verification passed.");
  } catch (err) {
    console.error("[afterPack] Re-signing failed:", err.message);
    throw err;
  }
};
