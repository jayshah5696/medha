/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          codemirror: [
            "codemirror",
            "@codemirror/view",
            "@codemirror/state",
            "@codemirror/lang-sql",
          ],
          markdown: ["react-markdown", "remark-gfm"],
          tanstack: ["@tanstack/react-table", "@tanstack/react-virtual"],
          icons: ["lucide-react"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:18900",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:18900",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
