import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        modal: path.resolve(__dirname, 'src/modal.ts'),
        renderer: path.resolve(__dirname, 'src/renderer.ts'),
      },
      output: {
        // ESM format for browser
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        // Place output in src/ to match current HTML script paths
        dir: 'src',
      },
    },
    // Don't minify for easier debugging
    minify: false,
    // Source maps for debugging
    sourcemap: true,
    // Don't clear outDir
    emptyOutDir: false,
  },
  resolve: {
    extensions: ['.ts', '.mts', '.mjs', '.js', '.json'],
  },
})
