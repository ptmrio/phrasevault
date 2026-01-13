# PhraseVault - Copilot Instructions

## Project Overview
PhraseVault is a desktop text expander/snippet manager built with Electron for Windows and macOS. Users store phrases and insert them into any application via global keyboard shortcut.

## Tech Stack
- **Runtime**: Electron 38+ (Node.js main process + Chromium renderer)
- **Build**: Electron Forge + Velopack for packaging/updates
- **Database**: SQLite3 (local, no cloud)
- **Styling**: SCSS (compiled to CSS)
- **i18n**: i18next with JSON locale files
- **Native modules**: robotjs (keyboard simulation), node-window-manager (window focus)

## Project Structure
```
src/
├── main.js          # Electron main process entry
├── preload.js       # Context bridge for IPC
├── renderer.js      # UI logic (runs in browser context)
├── database.js      # SQLite operations
├── window.js        # Window/tray management
├── state.js         # Shared state
└── i18n.js          # Internationalization setup
templates/           # HTML templates
assets/scss/         # SCSS stylesheets
locales/             # Translation files (en.js, de.js, etc.)
```

## Code Style
- Use vanilla JavaScript (ES6+), no TypeScript
- CommonJS modules (`require`/`module.exports`)
- Prefer native Electron/Node APIs over external packages
- Keep functions small and focused
- Comment only when logic is non-obvious

## Architecture Patterns
- **IPC communication**: Main ↔ Renderer via `ipcMain`/`ipcRenderer` with preload bridge
- **Database**: All SQLite calls in `database.js`, async with callbacks/promises
- **State**: Minimal global state in `state.js`
- **Events**: Use Node's EventEmitter for database change notifications

## Naming Conventions
- camelCase for variables and functions
- PascalCase for classes
- kebab-case for CSS classes and file names
- Descriptive names over abbreviations

## UI Guidelines
- Single HTML file (`templates/index.html`) with modular JS
- SCSS partials prefixed with underscore (`_modal.scss`)
- Use `data-i18n` attributes for translatable text
- Support both light and dark themes via CSS variables

## Development Commands
```bash
npm start          # Run in development mode
npm run watch      # Run with hot reload (electronmon)
npm run make       # Build production installer (Windows)
npm run make:mac   # Build production installer (macOS)
```

## Restrictions
- Never add cloud/telemetry features (privacy-first)
- Keep dependencies minimal
- Test on both Windows and macOS when touching native modules
- Maintain backward compatibility with existing user databases
