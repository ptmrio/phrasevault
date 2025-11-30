const fs = require("fs");
const path = require("path");

const licenses = JSON.parse(fs.readFileSync("licenses.json", "utf8"));

let output = "# Third Party Licenses\n\n";

for (const [pkg, info] of Object.entries(licenses)) {
    // Skip your own package
    if (pkg.startsWith("phrasevault@")) continue;

    output += `## ${pkg}\n\n`;
    output += `- **License:** ${info.licenses || "Unknown"}\n`;
    if (info.repository) output += `- **Repository:** ${info.repository}\n`;
    if (info.publisher) output += `- **Publisher:** ${info.publisher}\n`;
    output += "\n";

    if (info.licenseFile && fs.existsSync(info.licenseFile)) {
        let text = fs.readFileSync(info.licenseFile, "utf8");

        // Clean up README noise
        text = text
            .replace(/!\[.*?\]\(.*?\)/g, "") // images
            .replace(/```[\s\S]*?```/g, "") // code blocks
            .replace(/<img[^>]*>/gi, "") // img tags
            .replace(/^#{1,3}\s*(install|installation|usage|example|api|getting started|contributing|changelog|documentation|features|todo|test).*$/gim, "")
            .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, "") // badge links
            .replace(/^\s*[-*]\s+\[.*?\]\(#.*?\)\s*$/gm, "") // TOC links
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        output += `### License Text\n${text}\n`;
    }

    output += "---\n\n";
}

// Append manual licenses from assets/licenses/
const manualLicensesDir = path.join(__dirname, "assets", "licenses");
if (fs.existsSync(manualLicensesDir)) {
    const manualFiles = fs.readdirSync(manualLicensesDir).filter((f) => f.endsWith(".md"));
    if (manualFiles.length > 0) {
        for (const file of manualFiles) {
            const filePath = path.join(manualLicensesDir, file);
            const content = fs.readFileSync(filePath, "utf8").trim();
            const name = path.basename(file, ".md");
            output += `## ${name}\n\n${content}\n\n---\n\n`;
        }
        console.log(`Added ${manualFiles.length} manual license(s) from assets/licenses/`);
    }
}

fs.writeFileSync("THIRD_PARTY_NOTICES.md", output);
console.log("Generated THIRD_PARTY_NOTICES.md");
