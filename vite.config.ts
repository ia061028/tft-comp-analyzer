import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// 構成一覧（index.html）・統計（stats.html）・特性ラダー（ladder.html）の3ページ。どれも同じ public/data を読む。
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        stats: resolve(import.meta.dirname, 'stats.html'),
        ladder: resolve(import.meta.dirname, 'ladder.html'),
      },
    },
  },
})
