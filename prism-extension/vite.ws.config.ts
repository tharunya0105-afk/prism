import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@prism-sdk": resolve(__dirname, "../prism-sdk/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        wsBridge: resolve(__dirname, "src/ws-bridge.ts"),
      },
      output: {
        format: "iife",
        entryFileNames: "ws-bridge.js",
        inlineDynamicImports: true,
      },
    },
  },
});