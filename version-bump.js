import fs from 'fs';
import { exec } from 'child_process';

// Read the package.json file
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Get the new version from command line arguments
const newVersion = process.argv[2];

if (!newVersion) {
    console.error('Please provide a version number.');
    process.exit(1);
}

// Generate the commit message
const commitMessage = `Release version ${newVersion}`;

// Update the package.json version
packageJson.version = newVersion;
fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2), 'utf8');

// Commit the changes and create a git tag
exec(`git add . && git commit -m "${commitMessage}" && git tag v${newVersion} && git push && git push --tags`, (err, stdout, stderr) => {
    if (err) {
        console.error(`Error executing git commands: ${err}`);
        console.error(stderr);
        process.exit(1);
    }
    console.log(`Version bumped to ${newVersion}, committed, and tagged.`);
    console.log(stdout);
});
