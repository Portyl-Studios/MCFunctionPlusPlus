import { defineConfig } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
  root: './src/renderer', // React renderer entry point
  base: './', // Base path for the application
  build: {
    outDir: path.resolve(__dirname, 'out/renderer'),
    emptyOutDir: true, // Automatically cleans the output directory
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
    },
  },
  plugins: [
    react(), // Vite plugin for React
  ],
  css: {
    postcss: {
      plugins: [
        tailwindcss(), // Tailwind CSS
        autoprefixer(), // Autoprefixer
      ],
    },
  },
});
