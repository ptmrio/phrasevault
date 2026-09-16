import { defineConfig } from 'vite'
import { builtinModules } from 'module'

// Common externals shared across all apps
// WebSocket native deps (bufferutil, utf-8-validate) used by socket.io/ws
const COMMON_EXTERNALS = [
  'electron',
  'bufferutil',
  'utf-8-validate',
  'velopack',
]

// App-specific native modules
const appExternals = [
  'sqlite3',
  '@hurdlegroup/robotjs',
  'node-window-manager',
]

export default defineConfig({
  build: {
    // Output as CommonJS for Electron main process
    lib: {
      entry: 'src/main.ts',
      formats: ['cjs'],
      fileName: () => 'main.cjs',
    },
    rollupOptions: {
      external: [
        ...COMMON_EXTERNALS,
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        ...appExternals,
      ],
      output: {
        // Ensure all chunks use .cjs extension for CommonJS compatibility
        entryFileNames: '[name].cjs',
        chunkFileNames: '[name]-[hash].cjs',
      },
    },
    // Don't minify main process for easier debugging
    minify: false,
    // Source maps for debugging
    sourcemap: true,
    // Don't clear outDir to preserve preload.js
    emptyOutDir: false,
  },
  resolve: {
    // Prefer .ts files over .js when both exist
    extensions: ['.ts', '.mts', '.mjs', '.js', '.json'],
  },
})
