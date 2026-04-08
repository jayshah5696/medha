// afterSign hook for electron-builder
//
// Problem: electron-builder's ad-hoc signing signs each bundle independently.
// The PyInstaller sidecar (in Resources/sidecar/) contains ~145 .dylib/.so files
// that also have independent ad-hoc signatures. Under App Translocation
// (quarantined apps, e.g. Homebrew installs), dyld treats independently-signed
// ad-hoc binaries as having "different Team IDs" and refuses to load them.
//
// Fix: After electron-builder finishes signing, we re-sign EVERY Mach-O binary
// in the entire .app bundle with a single consistent `codesign --force --sign -`
// pass, then re-sign the top-level .app with --deep to seal the bundle.

const { execSync } = require("child_process");
const path = require("path");

exports.default = async function afterSign(context) {
  if (process.platform !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`[afterSign] Re-signing all binaries in ${appPath}…`);

  try {
    // Step 1: Find and re-sign every Mach-O binary (dylib, so, executable) individually.
    // This catches loose binaries in Resources/sidecar/ that --deep doesn't reach.
    // `find` + `file` + grep for Mach-O to avoid signing non-binary files.
    const findAndSign = `
      find "${appPath}" -type f \\( -name "*.dylib" -o -name "*.so" -o -perm +111 \\) | while read -r f; do
        if file "$f" | grep -q "Mach-O"; then
          codesign --force --sign - "$f" 2>/dev/null
        fi
      done
    `;
    execSync(findAndSign, { stdio: "inherit", shell: "/bin/bash" });
    console.log("[afterSign] All individual binaries re-signed.");

    // Step 2: Re-sign all .framework and .app bundles (bottom-up, inner first)
    // --deep on the top-level .app re-seals everything into one consistent chain.
    execSync(
      `codesign --deep --force --sign - "${appPath}"`,
      { stdio: "inherit" }
    );
    console.log("[afterSign] Top-level bundle re-signed with --deep.");

    // Step 3: Verify the entire bundle
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
