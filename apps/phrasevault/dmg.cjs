/**
 * Builds the drag-to-Applications DMG from the Velopack portable app (macOS only).
 *
 * vpk has no DMG output. create-dmg produces the standard Mac installer window
 * (app icon, arrow, Applications folder) and signs the DMG. It is run through
 * pnpm dlx at a pinned version because its appdmg dependency is darwin-only and
 * would break `pnpm install` on Windows. The portable zip holds the notarized
 * .app with UpdateMac, so the DMG keeps in-app update support available.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CREATE_DMG = "create-dmg@8.1.0";
// Native addons create-dmg needs; pnpm skips their builds unless allowed.
const NATIVE_BUILDS = ["macos-alias", "fs-xattr"];

const noSign = process.env.npm_config_nosign === "true" || process.argv.includes("--nosign");
const version = require("./package.json").version;
const appIdentity = "Developer ID Application: Gerhard Petermeir (HCJ7D67RFZ)";
const notaryProfile = "PhraseVault-notarize";

const releasesDir = path.join(__dirname, "Releases");
const portableZip = path.join(releasesDir, "PhraseVault-osx-Portable.zip");
const dmgPath = path.join(releasesDir, `PhraseVault-${version}.dmg`);

function run(cmd, args) {
    console.log(`\n> ${cmd} ${args.join(" ")}`);
    const r = spawnSync(cmd, args, { stdio: "inherit" });
    if (r.error || r.status !== 0) {
        console.error(`${cmd} failed:`, r.error ? r.error.message : `exit ${r.status}`);
        process.exit(r.status || 1);
    }
}

if (process.platform !== "darwin") {
    console.log("Skipping DMG: macOS only.");
    process.exit(0);
}

if (!fs.existsSync(portableZip)) {
    console.error(`Missing ${portableZip}. Run 'pnpm run velopack' first.`);
    process.exit(1);
}

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "phrasevault-dmg-"));
try {
    const appDir = path.join(stage, "app");
    const outDir = path.join(stage, "out");
    fs.mkdirSync(outDir);
    // ditto restores the __MACOSX resource forks the zip carries; unzip would not.
    run("ditto", ["-x", "-k", portableZip, appDir]);
    const app = path.join(appDir, "PhraseVault.app");
    if (!fs.existsSync(app)) {
        console.error("Portable zip does not contain PhraseVault.app at its root.");
        process.exit(1);
    }

    run("pnpm", [
        "dlx",
        ...NATIVE_BUILDS.map((name) => `--allow-build=${name}`),
        CREATE_DMG,
        "--overwrite",
        noSign ? "--no-code-sign" : `--identity=${appIdentity}`,
        app,
        outDir,
    ]);

    // create-dmg names the file "PhraseVault <version>.dmg"; the upload script expects dashes.
    const built = fs.readdirSync(outDir).filter((name) => name.endsWith(".dmg"));
    if (built.length !== 1) {
        console.error(`Expected one DMG from create-dmg, found: ${built.join(", ") || "none"}`);
        process.exit(1);
    }
    fs.rmSync(dmgPath, { force: true });
    fs.copyFileSync(path.join(outDir, built[0]), dmgPath);
} finally {
    fs.rmSync(stage, { recursive: true, force: true });
}

if (!noSign) {
    // create-dmg only warns when signing fails; fail here before notarizing an unsigned DMG.
    run("codesign", ["--verify", "--strict", "--verbose=2", dmgPath]);
    run("xcrun", ["notarytool", "submit", dmgPath, "--keychain-profile", notaryProfile, "--wait"]);
    run("xcrun", ["stapler", "staple", dmgPath]);
    run("spctl", ["-a", "-vv", "-t", "open", "--context", "context:primary-signature", dmgPath]);
}

console.log(`\nDMG ready: ${dmgPath}`);
