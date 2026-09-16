const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const noSign = process.env.npm_config_nosign === "true" || process.argv.includes("--nosign");
const yes =
    process.env.npm_config_yes === "true" ||
    process.argv.includes("--yes") ||
    process.argv.includes("-y");
const version = process.env.npm_package_version.replace(/^v/, ""); // Strip 'v' prefix for SemVer2
const platform = process.platform;

let args;

if (platform === "darwin") {
    // macOS build (Apple Silicon)
    args = [
        "pack",
        "--packId", "PhraseVault",
        "--packVersion", version,
        "--packTitle", "PhraseVault",
        "--packAuthors", "SPQRK Web Solutions",
        "--packDir", "./out/PhraseVault-darwin-arm64/PhraseVault.app",
        "--mainExe", "PhraseVault",
        "--icon", "./assets/img/icon.icns",
    ];

    if (!noSign) {
        args.push("--signAppIdentity", "Developer ID Application: Gerhard Petermeir (HCJ7D67RFZ)");
        args.push("--signInstallIdentity", "Developer ID Installer: Gerhard Petermeir (HCJ7D67RFZ)");
        args.push("--signEntitlements", "./entitlements.entitlements");
        args.push("--notaryProfile", "PhraseVault-notarize");
    }
} else {
    // Windows build
    args = [
        "pack",
        "--packId", "PhraseVault",
        "--packVersion", version,
        "--packTitle", "PhraseVault",
        "--packAuthors", "SPQRK Web Solutions",
        "--packDir", "./out/PhraseVault-win32-x64",
        "--mainExe", "PhraseVault.exe",
        "--icon", "./assets/img/icon.ico",
    ];

    if (!noSign) {
        args.push("--azureTrustedSignFile", path.resolve(__dirname, '../../metadata.json'));
    }
}

if (yes) {
    // Need both -x (non-interactive) and -y (answer yes) for unattended overwrite
    // See: https://docs.velopack.io/reference/cli/content/vpk-windows
    args.unshift("-x", "-y");
}

console.log("Running vpk with args:", args.join(" "));

const r = spawnSync("vpk", args, { stdio: "inherit" });

if (r.error) {
    console.error("Failed to run vpk:", r.error.message);
    if (r.error.code === "ENOENT") {
        console.error("The 'vpk' command was not found. Make sure Velopack CLI is installed.");
        console.error("Install it with: dotnet tool install -g vpk");
    }
    process.exit(1);
}

if (r.status !== 0) {
    console.error(`vpk exited with status code: ${r.status}`);
    process.exit(r.status ?? 1);
}

process.exit(0);
