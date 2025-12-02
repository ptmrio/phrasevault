const path = require("path");
const fs = require("fs-extra");

module.exports = {
    packagerConfig: {
        name: "PhraseVault",
        executableName: "PhraseVault",
        icon: "assets/img/icon",
        extraResource: ["assets/img", "LICENSE.md", "THIRD_PARTY_NOTICES.md"],
        asar: true, // Let auto-unpack-natives handle .node files automatically
        afterCopy: [
            (buildPath, electronVersion, platform, arch, callback) => {
                // Ensure node-window-manager/dist is copied
                const nwmSource = path.join(buildPath, "node_modules", "node-window-manager");
                const distSource = path.join(nwmSource, "dist");

                if (fs.existsSync(distSource)) {
                    console.log("✓ node-window-manager/dist exists in build");
                } else {
                    console.log("✗ node-window-manager/dist MISSING - copying from project");
                    const projectDist = path.join(process.cwd(), "node_modules", "node-window-manager", "dist");
                    fs.copySync(projectDist, distSource);
                }

                callback();
            },
        ],
        ignore: [
            // Ignore unnecessary files to reduce package size
            /^\/node_modules\/.*\/(test|tests|__tests__|docs|documentation|examples|\.github)/,
            /^\/node_modules\/.*\/(\.yml|\.yaml)$/i,
            /^\/node_modules\/@hurdlegroup\/robotjs\/prebuilds\/(darwin|linux)-/,
            /^\/\.git/,
            /^\/dist/,
            /^\/out/,
            /^\/\.vscode/,
            /^\/screenshots/,
            /\.map$/,
        ],
    },
    makers: [
        {
            name: "@electron-forge/maker-squirrel",
            config: {
                name: "PhraseVault",
                authors: "SPQRK Web Solutions",
                exe: "PhraseVault.exe",
                setupExe: "PhraseVault-Setup-${version}.exe",
                description: "A phrase management tool",
                setupIcon: "./assets/img/icon.ico",
                icon: "./assets/img/icon.ico",
                iconUrl: "https://phrasevault.app/forge-app-icon.ico",
            },
        },
    ],
    plugins: [
        {
            name: "@electron-forge/plugin-auto-unpack-natives",
            config: {},
        },
    ],
};
