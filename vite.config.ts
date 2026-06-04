import react from '@vitejs/plugin-react'
import { builtinModules } from 'module'
import path from 'path'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/main.ts',
              // NOTE: the plugin's default ("es", from package.json type:module)
              // gets CONCATENATED with this by vite mergeConfig, so both formats
              // build. Electron 26 requires CJS, so route the es build to .mjs
              // to keep it from clobbering main.cjs (which package.json "main"
              // points at).
              formats: ['cjs'],
              fileName: (format) => (format === 'es' ? 'main.mjs' : 'main.cjs'),
            },
            rollupOptions: {
              external: ['electron', ...builtinModules],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs'],
              fileName: () => 'preload.cjs',
            },
            rollupOptions: {
              external: ['electron', ...builtinModules],
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
