const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const noSign = process.env.npm_config_nosign === "true" || process.argv.includes("--nosign");
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
        "--splashImage", "./assets/img/splash.png",
    ];

    if (!noSign) {
        args.push("--signParams", '/n "Gerhard Petermeir" /a /tr http://timestamp.digicert.com /td SHA256 /fd SHA256');
    }
}

const r = spawnSync("vpk", args, { stdio: "inherit" });

if (r.status === 0) {
    // Copy versioned files to dist folder
    const distDir = path.join(__dirname, "dist");
    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }

    let filesToCopy;
    if (platform === "darwin") {
        filesToCopy = [
            { src: "PhraseVault-osx-Setup.pkg", dest: `PhraseVault-macOS-${version}.pkg` },
            { src: "PhraseVault-osx-Portable.zip", dest: `PhraseVault-macOS-Portable-${version}.zip` },
        ];
    } else {
        filesToCopy = [
            { src: "PhraseVault-win-Setup.exe", dest: `PhraseVault-Setup-${version}.exe` },
            { src: "PhraseVault-win-Portable.zip", dest: `PhraseVault-Portable-${version}.zip` },
        ];
    }

    for (const file of filesToCopy) {
        const srcPath = path.join(__dirname, "Releases", file.src);
        const destPath = path.join(distDir, file.dest);
        if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied: ${file.dest}`);
        }
    }
}

process.exit(r.status ?? 1);
