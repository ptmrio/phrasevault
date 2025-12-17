const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const noSign = process.env.npm_config_nosign === "true" || process.argv.includes("--nosign");
const version = process.env.npm_package_version;

const args = ["-y", "pack", "--packId", "PhraseVault", "--packVersion", version, "--packTitle", "PhraseVault", "--packAuthors", "SPQRK Web Solutions", "--packDir", "./out/PhraseVault-win32-x64", "--mainExe", "PhraseVault.exe", "--icon", "./assets/img/icon.ico", "--splashImage", "./assets/img/splash.png"];

if (!noSign) {
    args.push("--signParams", '/n "Gerhard Petermeir" /a /tr http://timestamp.digicert.com /td SHA256 /fd SHA256');
}

const r = spawnSync("vpk", args, { stdio: "inherit" });

if (r.status === 0) {
    // Copy versioned files to dist folder
    const distDir = path.join(__dirname, "dist");
    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }

    const filesToCopy = [
        { src: "PhraseVault-win-Setup.exe", dest: `PhraseVault-Setup-${version}.exe` },
        { src: "PhraseVault-win-Portable.zip", dest: `PhraseVault-Portable-${version}.zip` },
    ];

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
