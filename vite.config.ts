import { defineConfig } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

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
    electron([
      {
        entry: path.resolve(__dirname, 'src/main/main.ts'), // Main process entry point
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'out/main'),
            sourcemap: true,
          },
        },
      },
      {
        entry: path.resolve(__dirname, 'src/main/preload.ts'), // Preload script entry point
        onstart(options) {
          options.reload(); // Reload renderer on preload changes
        },
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'out/main'),
            sourcemap: true,
          },
        },
      },
    ]),
    renderer(), // Enable nodeIntegration if necessary
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
