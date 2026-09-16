/**
 * Build script for PhraseVault that handles pnpm monorepo packaging.
 *
 * Problem: electron-forge's flora-colossus module walker can't find dependencies
 * in a pnpm monorepo because they're hoisted to the workspace root, not the app's
 * node_modules.
 *
 * Solution: Use `pnpm deploy` to create a standalone copy of the app with its own
 * node_modules, then run electron-forge from there.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs-extra");

const APP_DIR = __dirname;
const WORKSPACE_ROOT = path.resolve(APP_DIR, "../..");
const DEPLOY_DIR = path.resolve(APP_DIR, ".package-stage");

function run(cmd, cwd = APP_DIR) {
    console.log(`\n> ${cmd}`);
    execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

async function main() {
    const startTime = Date.now();
    const forwardArgs = process.argv.slice(2);
    const forwardArgString = forwardArgs.length > 0 ? ` -- ${forwardArgs.join(" ")}` : "";

    console.log("=== PhraseVault Package Build ===\n");

    // Step 1: Build assets in workspace (CSS, renderer)
    console.log("Step 1: Building assets...");
    run("pnpm run build:css");
    run("pnpm run build:renderer");

    // Step 2: Clean previous staging directory
    console.log("\nStep 2: Preparing staging directory...");
    if (await fs.pathExists(DEPLOY_DIR)) {
        await fs.remove(DEPLOY_DIR);
    }

    // Step 3: Deploy app with isolated node_modules using pnpm deploy
    console.log("\nStep 3: Creating standalone package with pnpm deploy...");
    // Note: Using --legacy because inject-workspace-packages may not be enabled
    run(`pnpm --filter phrasevault deploy "${DEPLOY_DIR}" --legacy`, WORKSPACE_ROOT);

    // Step 4: Generate third-party licenses from staged node_modules (complete dep tree)
    console.log("\nStep 4: Generating third-party licenses...");
    const thirdpartyScript = path.join(WORKSPACE_ROOT, "packages", "shared", "bin", "generate-thirdparty.js");
    run("npx license-checker-rseidelsohn --json --production > licenses.json", DEPLOY_DIR);
    run(`node "${thirdpartyScript}" --skip-package phrasevault`, DEPLOY_DIR);
    // Copy LICENSE.md from app dir (not in deploy)
    await fs.copy(
        path.join(APP_DIR, "LICENSE.md"),
        path.join(DEPLOY_DIR, "templates", "markdown", "license.md")
    );
    await fs.copy(
        path.join(DEPLOY_DIR, "THIRD_PARTY_NOTICES.md"),
        path.join(DEPLOY_DIR, "templates", "markdown", "thirdparty.md")
    );
    // Clean up temp file
    await fs.remove(path.join(DEPLOY_DIR, "licenses.json"));
    console.log("  Generated THIRD_PARTY_NOTICES.md from staged dependencies");

    // Step 5: Copy built assets and config files that aren't in the deploy
    console.log("\nStep 5: Copying built artifacts to staging...");

    // Copy generated CSS
    const cssSrc = path.join(APP_DIR, "assets", "css", "output.css");
    const cssDest = path.join(DEPLOY_DIR, "assets", "css", "output.css");
    if (await fs.pathExists(cssSrc)) {
        await fs.copy(cssSrc, cssDest);
        console.log("  Copied assets/css/output.css");
    }

    // Copy tsconfig.base.json from workspace root (referenced by tsconfig.json)
    const tsconfigBaseSrc = path.join(WORKSPACE_ROOT, "tsconfig.base.json");
    const tsconfigBaseDest = path.join(DEPLOY_DIR, "tsconfig.base.json");
    if (await fs.pathExists(tsconfigBaseSrc)) {
        await fs.copy(tsconfigBaseSrc, tsconfigBaseDest);
        console.log("  Copied tsconfig.base.json");
    }

    // Update tsconfig.json to reference local tsconfig.base.json instead of ../../
    const tsconfigPath = path.join(DEPLOY_DIR, "tsconfig.json");
    if (await fs.pathExists(tsconfigPath)) {
        let tsconfig = await fs.readFile(tsconfigPath, "utf8");
        tsconfig = tsconfig.replace('"../../tsconfig.base.json"', '"./tsconfig.base.json"');
        await fs.writeFile(tsconfigPath, tsconfig);
        console.log("  Updated tsconfig.json extends path");
    }

    // No staging package.json rewrite needed once main points to .vite/build.


    // Step 6: Rebuild native modules in the staging directory
    console.log("\nStep 6: Rebuilding native modules in staging...");
    run("npx electron-rebuild --force", DEPLOY_DIR);

    // Step 7: Run electron-forge package from staging directory
    console.log("\nStep 7: Packaging application...");
    run("npx cross-env NODE_ENV=production electron-forge package", DEPLOY_DIR);

    // Step 8: Move output back to main app directory
    console.log("\nStep 8: Moving package output...");
    const outSrc = path.join(DEPLOY_DIR, "out");
    const outDest = path.join(APP_DIR, "out");
    if (await fs.pathExists(outDest)) {
        await fs.remove(outDest);
    }
    if (await fs.pathExists(outSrc)) {
        await fs.move(outSrc, outDest);
        console.log("  Moved out/ to app directory");
    }

    // Step 9: Run velopack from main directory (it expects out/ to exist)
    console.log("\nStep 9: Creating installer with Velopack...");
    run(`pnpm run velopack${forwardArgString}`);

    // Step 9b: Wrap the notarized portable app in a drag-to-Applications DMG
    if (process.platform === "darwin") {
        console.log("\nStep 9b: Creating DMG...");
        run(`pnpm run dmg${forwardArgString}`);
    }

    // Step 10: Cleanup staging directory
    console.log("\nStep 10: Cleaning up staging directory...");
    await fs.remove(DEPLOY_DIR);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n=== Build complete in ${elapsed}s ===`);
}

main().catch((err) => {
    console.error("\nBuild failed:", err.message);
    process.exit(1);
});
