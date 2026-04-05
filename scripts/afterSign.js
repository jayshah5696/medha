// afterSign hook for electron-builder
//
// Problem: electron-builder's ad-hoc signing (with CSC_IDENTITY_AUTO_DISCOVERY=false)
// signs each binary independently via @electron/osx-sign. Each gets an independent
// ad-hoc signature with a different CDHash. When macOS App Translocation kicks in
// (quarantined apps, e.g. Homebrew installs), dyld treats these independent ad-hoc
// signatures as "different Team IDs" and refuses to load Electron Framework.
//
// Fix: After electron-builder finishes its signing pass, we re-sign the entire .app
// bundle in one `codesign --deep --force --sign -` call. This produces a single
// consistent signing chain where all nested binaries derive from the same root
// signature, which dyld accepts even under App Translocation.

const { execSync } = require("child_process");
const path = require("path");

exports.default = async function afterSign(context) {
  if (process.platform !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`[afterSign] Re-signing ${appPath} with consistent ad-hoc identity…`);

  try {
    // --deep: sign every nested bundle/framework/helper in one pass
    // --force: replace existing (inconsistent) signatures
    // "-": ad-hoc identity (no Apple Developer cert required)
    execSync(
      `codesign --deep --force --sign - "${appPath}"`,
      { stdio: "inherit" }
    );
    console.log("[afterSign] Re-signing complete.");

    // Verify the entire bundle
    execSync(
      `codesign --verify --deep --strict --verbose=2 "${appPath}"`,
      { stdio: "inherit" }
    );
    console.log("[afterSign] Verification passed.");
  } catch (err) {
    console.error("[afterSign] Re-signing failed:", err.message);
    throw err;
  }
};
