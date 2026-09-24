import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Studio is served from the same site as the public assessments, under /studio
  base: '/studio/',
  envDir: '../..',
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
});
