import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: { entry: 'electron/main.ts', formats: ['cjs'] },
            rollupOptions: {
              external: ['sql.js', 'path', 'fs', 'os', 'electron', 'ws', 'url'],
              output: { format: 'cjs', entryFileNames: '[name].js' },
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: { entry: 'electron/preload.ts', formats: ['cjs'] },
            rollupOptions: {
              external: ['electron'],
              output: { format: 'cjs', entryFileNames: '[name].js' },
            },
          },
        },
      },
      {
        // Session preload for the streaming <webview>: installs the playback controller.
        entry: 'electron/stream-preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: { entry: 'electron/stream-preload.ts', formats: ['cjs'] },
            rollupOptions: {
              external: ['electron'],
              output: { format: 'cjs', entryFileNames: '[name].js' },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
