# PhraseVault

> **Save text once, insert anywhere.**

PhraseVault is an easy-to-use **text expander** and **snippet manager** for Windows that organizes and inserts frequently used phrases, email templates, AI prompts, as well as text and code snippets. Whether you're composing emails, writing code, or filling out forms, PhraseVault simplifies repetitive typing tasks and makes your workflow more efficient.

**Try it free for 14 days**, then unlock lifetime access with a small one-time payment.

![PhraseVault Demo Screenshot](https://github.com/ptmrio/phrasevault/blob/main/screenshots/phrasevault-github-screenshot.png)

### Works Great With

Microsoft Office (Word, Excel, Outlook) • Gmail • Chrome, Firefox, Edge • VS Code, Visual Studio • ChatGPT, MidJourney • and many more

## Use Cases

### Office Work

PhraseVault is an ideal companion for business professionals who deal with repetitive text tasks. Whether you're drafting emails, creating reports, or filling out forms, PhraseVault allows you to:

- Quickly search for and insert pre-defined email templates.
- Store and manage frequently used phrases and signatures.
- Ensure consistency and save time by avoiding retyping common text.

### Coding and Development

For developers, PhraseVault provides an efficient way to manage code snippets and reusable components. You can:

- Store and quickly access snippets of code.
- Maintain a library of reusable code blocks.
- Reduce errors and increase productivity by using pre-tested code.

### Working with AI Tools

PhraseVault is also excellent for storing and managing prompts for AI tools like **ChatGPT** and **MidJourney**. You can:

- Keep a library of effective prompts for various AI tools.
- Quickly insert prompts into your workflow.
- Experiment with and refine prompts for better AI interactions.

## Key Features

### ⚡ Quick Access

- **Global Keyboard Shortcut** (`Ctrl + .`): Instantly open PhraseVault from any application.
- **Fuzzy Search**: Find phrases quickly even with partial or misspelled queries.
- **Full Keyboard Navigation**: Navigate and insert phrases without touching the mouse.
- **Seamless Clipboard Integration**: Phrases are inserted directly into your active text field.

### 🔒 Privacy-First & Open Source

- **No Cloud Storage**: Your data stays on your device—nothing is sent to external servers.
- **No Tracking or Telemetry**: We don't collect usage data or analytics.
- **Source Code Transparency**: Full source code available on [GitHub](https://github.com/ptmrio/phrasevault) for review.

### 🎨 User-Friendly Interface

- **Clean Modern Design**: Intuitive interface with no learning curve.
- **Light & Dark Themes**: Choose the theme that suits your preference.
- **Markdown & HTML Support**: Format your phrases with rich text.
- **Flexible Organization**: Organize phrases your way.

### 🌍 Universal Compatibility

- **Works Everywhere**: Compatible with virtually any Windows application.
- **Multi-Language Support**: Available in English, German, Spanish, French, Italian, and Portuguese.
- **Flexible Database Location**: Store your database on a cloud drive (Google Drive, Dropbox, etc.) for sync across devices.

## License

This project is licensed under the **SPQRK SOFTWARE LICENSE v1.0**. For complete licensing terms, see the [LICENSE.md](LICENSE.md) file.

### License Summary

| ✅ What You Can Do                                              | ❌ What You Can't Do                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| Use free for 14 days (trial period per seat)                    | Use after trial ends without purchasing a license          |
| Purchase a lifetime license (one-time payment)                  | Redistribute, sell, sublicense, rent, or lend the software |
| Install on unlimited devices per licensed seat                  | Distribute modified or unmodified versions externally      |
| View and inspect the source code                                | Remove or alter proprietary notices or attribution         |
| Modify source code for your own internal use                    | Share a single seat among multiple people                  |
| Reassign a seat to a different person (e.g., employee transfer) | Develop a directly competing product                       |
| Run on company servers for licensed seats                       | Falsify proof of purchase or seat count                    |

### Important Notes

- **Per-Seat Licensing**: Each named person using PhraseVault requires their own seat.
- **Lifetime License**: Your license includes all future updates, except potential Major Version upgrades (e.g., v2.x to v3.0).
- **No DRM**: There are no license keys or online activation. Your proof of purchase is your license.
- **Source Available ≠ Open Source**: The code is available for transparency, but redistribution is not permitted.

## Our Philosophy

PhraseVault is built on transparency and trust. We believe you should be able to see exactly what software you're running—that's why our source code is publicly available. At the same time, we're a small team that relies on software sales to continue development. Our simple licensing model (14-day trial, then a one-time lifetime payment) keeps PhraseVault sustainable while giving you full ownership of your license forever.

## Table of Contents

- [Getting Started](#getting-started)
- [Usage](#usage)
- [Building from Source](#building-from-source)
- [Troubleshooting](#troubleshooting)
- [FAQs](#faqs)
- [Contact and Support](#contact-and-support)

## Getting Started

### Prerequisites

- Windows 10, Windows 11

### Installation Instructions

#### Method 1: Download from the Website (Recommended)

1. **Download the Installer**: Visit [phrasevault.app/download](https://phrasevault.app/download) and download the latest `.exe` installer.
2. **Run the Installer**: Double-click the downloaded file and follow the on-screen instructions.
3. **Launch the Application**: Open PhraseVault from the Start Menu or desktop shortcut.

#### Method 2: Install via Winget

```bash
# Install PhraseVault
winget install --id ptmrio.phrasevault -e

# Upgrade to latest version
winget upgrade --id ptmrio.phrasevault -e
```

#### Method 3: Microsoft Store

PhraseVault is also available on the [Microsoft Store](https://apps.microsoft.com/detail/9pc4803p8r9j).

### Quick Start

1. Open PhraseVault using `Ctrl + .`
2. Search for your desired phrase
3. Press `Enter` to insert it

## Usage

### Basic Usage Instructions

- **Open the App**: Use the shortcut `Ctrl + .` to open the PhraseVault window.
- **Search for a Phrase**: Start typing in the search bar to quickly find the phrase you need.
- **Select the Desired Phrase**: Press the arrow down key to navigate through the search results and select the desired phrase.
- **Insert the Phrase**: Press `Enter` to have PhraseVault paste the expanded phrase text into the active field.
- **Manage Phrases**:
    - **Add**: Click the "Add Phrase" button to open a modal for adding a new phrase.
    - **Edit**: Click the "Edit" button next to a phrase to modify it.
    - **Delete**: Click the "Delete" button next to a phrase to remove it from the database.
    - **Copy to Clipboard**: Click the "Copy" button to copy the phrase to the clipboard.
- **Minimize PhraseVault**: Press `Escape` to minimize the PhraseVault window. It will remain accessible from the system tray.
- **Theme Selection**: Choose between light and dark themes to match your preference.
- **Database Location**: You can freely choose the location of the database file, allowing it to be stored on a cloud drive (such as Google Drive, Dropbox, etc.) for easy access and synchronization across devices.

## Troubleshooting

- **Issue**: PhraseVault does not open with the shortcut.
    - **Solution**: Ensure that the application is running in the background. Restart the app if necessary.

## Building from Source

PhraseVault's source code is available for transparency and personal modification. You can build the application yourself, but please note the following:

> ⚠️ **License Reminder**: Building from source does not grant you a free license. The compiled application is still subject to the [SPQRK SOFTWARE LICENSE v1.0](LICENSE.md). You must purchase a license after the 14-day trial period. **Redistribution of compiled binaries is not permitted.**

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS version recommended)
- [Git](https://git-scm.com/)
- [.NET SDK](https://dotnet.microsoft.com/download/dotnet) (required for the `vpk` packaging tool)
- Windows 10 or 11

### Install Velopack CLI

The build process uses Velopack for packaging. Install the `vpk` CLI tool globally:

```bash
dotnet tool install -g vpk
```

### Build Steps

```bash
# Clone the repository
git clone https://github.com/ptmrio/phrasevault.git
cd phrasevault

# Install dependencies
npm install

# Run in development mode
npm start

# Build for production (creates installer in Releases folder)
npm run make --nosign
```

### Notes

- Use `--nosign` flag if you don't have a code signing certificate.
- The build process uses [Electron Forge](https://www.electronforge.io/) and [Velopack](https://velopack.io/) for packaging.
- Native modules (robotjs, node-window-manager) are rebuilt automatically during installation.

## FAQs

- **Is there a free trial?**
    - Yes! PhraseVault includes a **14-day free trial** with full functionality. No credit card required.

- **How do I purchase a license?**
    - Visit [phrasevault.app](https://phrasevault.app) and follow the purchase instructions. It's a one-time payment for lifetime access.

- **What happens after I purchase?**
    - You receive a proof of purchase (receipt/invoice). There are no license keys to enter—PhraseVault trusts you to comply with the license terms.

- **Can I use PhraseVault on multiple devices?**
    - Yes! A single seat license allows you to install PhraseVault on all devices you personally use.

- **How do I sync phrases across devices?**
    - Go to Settings and choose a database location on a cloud drive (Google Drive, Dropbox, OneDrive, etc.).

- **Is my data sent to the cloud?**
    - No. PhraseVault stores all data locally. We don't have servers that collect or store your phrases.

- **Can I build PhraseVault from source?**
    - Yes, the source code is available on GitHub. However, built binaries are still subject to the license terms (14-day trial, then purchase required). See [Building from Source](#building-from-source).

## Contact and Support

For support, please visit our [Contact page](https://phrasevault.app/imprint) or open an issue on [GitHub](https://github.com/ptmrio/phrasevault/issues).
