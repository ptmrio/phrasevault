const fs = require('fs');
const { exec } = require('child_process');
const packageJson = require('./package.json');

// Get the new version and commit message from command line arguments
const newVersion = process.argv[2];
const commitMessage = process.argv[3];

if (!newVersion) {
    console.error('Please provide a version number.');
    process.exit(1);
}

if (!commitMessage) {
    console.error('Please provide a commit message.');
    process.exit(1);
}

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
