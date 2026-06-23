import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
// base は GitHub Pages の project サイト（/<repo>/）配信用。
export default defineConfig({
  base: '/tft-comp-analyzer/',
  plugins: [react(), tailwindcss(), cloudflare()],
})