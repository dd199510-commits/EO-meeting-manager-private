import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@seedData': fileURLToPath(new URL(
        process.env.VITE_PUBLIC_EMPTY_DATA === 'true'
          ? './src/data/emptySeedData.js'
          : './src/data/seedData.js',
        import.meta.url,
      )),
    },
  },
})
