import { defineConfig } from 'vite'
import { builtinModules } from 'module'

export default defineConfig({
  build: {
    // Output as CommonJS for Electron preload
    lib: {
      entry: 'src/preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    rollupOptions: {
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
    // Don't minify preload for easier debugging
    minify: false,
    sourcemap: true,
    // Don't clear outDir to preserve main.js
    emptyOutDir: false,
  },
  resolve: {
    extensions: ['.ts', '.mts', '.mjs', '.js', '.json'],
  },
})
