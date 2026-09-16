const path = require("path");
const fs = require("fs-extra");
const { VitePlugin } = require("@electron-forge/plugin-vite");

// Determine which platform we're building for
const isBuiltForMac = process.argv.includes("--platform=darwin") ||
    (process.platform === "darwin" && !process.argv.includes("--platform=win32"));

// Azure Trusted Signing paths (Windows only, used during 'pnpm make')
// __dirname may be the app dir or .package-stage, so check both locations
const metadataPath = [
    path.resolve(__dirname, '../../metadata.json'),
    path.resolve(__dirname, '../../../metadata.json'),
].find(p => fs.existsSync(p)) || path.resolve(__dirname, '../../metadata.json')
const dlibPath = process.env.AZURE_CODE_SIGNING_DLIB ||
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'MicrosoftArtifactSigningClientTools', 'Azure.CodeSigning.Dlib.dll')

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
            signWithParams: `/v /dlib ${dlibPath} /dmdf ${metadataPath}`,
            timestampServer: 'http://timestamp.acs.microsoft.com',
            hashes: ['sha256'],
        },
        name: "PhraseVault",
        executableName: "PhraseVault",
        // 2.5.0 shipped as com.electron.phrasevault. This id is the reverse-DNS
        // of phrasevault.app. First build with it resets Accessibility TCC and
        // Open at Login for existing Mac users — call that out in release notes.
        appBundleId: "app.phrasevault",
        appCategoryType: "public.app-category.productivity",
        extendInfo: {
            LSMinimumSystemVersion: "13.0",
        },
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
        // Use function-based ignore to avoid VitePlugin warning about array-based ignore
        ignore: (filePath) => {
            if (!filePath) return false;

            // Exclude test/docs folders within node_modules
            if (/^\/node_modules\/.*\/(test|tests|__tests__|docs|documentation|examples|\.github)(\/|$)/.test(filePath)) return true;
            if (/^\/node_modules\/.*\.(yml|yaml)$/i.test(filePath)) return true;

            // Exclude platform-specific native binaries for OTHER platforms
            if (isBuiltForMac) {
                if (/velopack_nodeffi_(linux|win)/.test(filePath)) return true;
                if (/@hurdlegroup\/robotjs\/prebuilds\/(win32|linux)-/.test(filePath)) return true;
            } else {
                if (/velopack_nodeffi_(linux|osx)/.test(filePath)) return true;
                if (/@hurdlegroup\/robotjs\/prebuilds\/(darwin|linux)-/.test(filePath)) return true;
            }

            // Exclude dev/build folders
            if (/^\/\.git/.test(filePath)) return true;
            if (/^\/out(\/|$)/.test(filePath)) return true;
            if (/^\/Releases(\/|$)/.test(filePath)) return true;
            if (/^\/\.vscode(\/|$)/.test(filePath)) return true;
            if (/^\/screenshots(\/|$)/.test(filePath)) return true;
            if (/\.map$/.test(filePath)) return true;

            return false;
        },
    },
    makers: [],
    plugins: [
        {
            name: "@electron-forge/plugin-auto-unpack-natives",
            config: {},
        },
        new VitePlugin({
            // Build configuration for main process and preload scripts
            build: [
                {
                    entry: "src/main.ts",
                    config: "vite.main.config.ts",
                },
                {
                    entry: "src/preload.ts",
                    config: "vite.preload.config.ts",
                },
            ],
            // No renderer bundling - using vanilla JS loaded directly in HTML
            renderer: [],
        }),
    ],
};

// Public source builds are unsigned and require no publisher credentials.
delete module.exports.packagerConfig.windowsSign
delete module.exports.packagerConfig.osxSign
delete module.exports.packagerConfig.osxNotarize
