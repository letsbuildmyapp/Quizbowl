import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../functions/shared', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': shared }
  },
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks so app updates don't re-download the SDKs.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/database'],
          react: ['react', 'react-dom', 'react-router-dom']
        }
      }
    },
    chunkSizeWarningLimit: 950
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] }
  }
});
