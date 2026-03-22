import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

function getStableAssetName(names: readonly string[] | undefined): string | null {
  if (!names) {
    return null;
  }

  if (names.some((name) => name.endsWith("markdown-style.css"))) {
    return "assets/markdown-page.css";
  }

  return null;
}

export default defineConfig({
  plugins: [...cloudflare(), react(), tailwindcss()],
  build: {
    emptyOutDir: true,
    outDir: "dist/client",
    rollupOptions: {
      input: {
        "markdown-page": resolve(__dirname, "src/client/markdown-page.tsx"),
        "markdown-style": resolve(__dirname, "src/styles/markdown-page.css")
      },
      output: {
        assetFileNames: (assetInfo) =>
          getStableAssetName(assetInfo.names) ?? "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "markdown-page" ? "assets/markdown-page.js" : "assets/[name].js"
      }
    },
    target: "es2022"
  },
  server: {
    host: "127.0.0.1",
    port: 8787
  }
});
