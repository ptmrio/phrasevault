const path = require("path");
const fs = require("fs-extra");

// Determine which velopack native modules to exclude based on target platform
const isBuiltForMac = process.argv.includes("--platform=darwin") || (process.platform === "darwin" && !process.argv.includes("--platform=win32"));
const velopackExcludes = isBuiltForMac
    ? [/^\/node_modules\/velopack\/lib\/native\/velopack_nodeffi_linux/, /^\/node_modules\/velopack\/lib\/native\/velopack_nodeffi_win/]
    : [/^\/node_modules\/velopack\/lib\/native\/velopack_nodeffi_linux/, /^\/node_modules\/velopack\/lib\/native\/velopack_nodeffi_osx/];

// Exclude robotjs prebuilds for other platforms
const robotjsExcludes = isBuiltForMac
    ? [/^\/node_modules\/@hurdlegroup\/robotjs\/prebuilds\/(win32|linux)-/]
    : [/^\/node_modules\/@hurdlegroup\/robotjs\/prebuilds\/(darwin|linux)-/];

module.exports = {
    packagerConfig: {
        osxSign: {
            identity: "Developer ID Application: Gerhard Petermeir (HCJ7D67RFZ)",
            optionsForFile: () => ({
                entitlements: "./entitlements.entitlements",
                hardenedRuntime: true,
            }),
        },
        osxNotarize: {
            keychainProfile: "PhraseVault-notarize",
        },
        windowsSign: {
            certificateSubjectName: "Gerhard Petermeir",
            timestampServer: "http://timestamp.digicert.com",
            signWithParams: "/a",
        },
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
            /^\/node_modules\/.*\/(test|tests|__tests__|docs|documentation|examples|\.github)/,
            /^\/node_modules\/.*\/(\.yml|\.yaml)$/i,
            ...robotjsExcludes,
            ...velopackExcludes,
            /^\/\.git/,
            /^\/dist/,
            /^\/out/,
            /^\/Releases/,
            /^\/\.vscode/,
            /^\/screenshots/,
            /\.map$/,
        ],
    },
    makers: [],
    plugins: [
        {
            name: "@electron-forge/plugin-auto-unpack-natives",
            config: {},
        },
    ],
};
