import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'
import proxyOptions from './proxyOptions';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // injectRegister: 'auto',
      workbox: {
        // 	sourcemap: true
        maximumFileSizeToCacheInBytes: 5000000, // 5MB
      },
    }),
  ],
  // optimizeDeps: {
  //   include: ["@radix-ui/react-radio-group"],
  //   exclude: [
  //     "chunk-OZV37PLF.js?v=193dfd67",
  //     "chunk-JEJO5SLT.js?v=161aa362",
  //     "chunk-RSVB25KO.js?v=161aa362",
  //     "chunk-VWGPU4LS.js?v=161aa362",
  //   ],
  // },
  // A dev env's worktree links the master checkout's node_modules, so the default cache
  // (node_modules/.vite) would be shared with the main vite on :8080. Two vites optimising into
  // one folder load two copies of React. devenv.sh `serve` sets VITE_CACHE_DIR per env.
  cacheDir: process.env.VITE_CACHE_DIR || "node_modules/.vite",
  server: {
    port: 8080,
    proxy: proxyOptions,
    // host: '0.0.0.0'
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "../nirmaan_stack/public/frontend",
    emptyOutDir: true,
    target: "es2015",
    // sourcemap: true,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
          return;
        }
        warn(warning);
      },
    },
  },
});