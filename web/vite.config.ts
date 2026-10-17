import { cp, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

function publishedAssets(): Plugin {
  let publicDir: string;
  let outDir: string;
  return {
    name: "published-assets",
    apply: "build",
    configResolved(config) {
      publicDir = config.publicDir;
      outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle(options) {
      await cp(publicDir, options.dir ?? outDir, {
        recursive: true,
        async filter(source) {
          const parts = relative(publicDir, source).split(sep);
          if (parts[0] === "clow-summoning") return false;
          if (parts[0] === "clow-scene" && parts[1] === "illuminated-frame.svg") return false;
          if (parts[0] === "brand" && parts[1] === "layered-pages.svg") return false;
          // Original card files live at the root; subfolders are historical proofs.
          if (parts[0] === "clow-deck" && parts.length === 2 && (await stat(source)).isDirectory()) return false;
          return true;
        },
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), publishedAssets()],
  server: { proxy: { "/api": "http://localhost:8000" } },
  build: { outDir: "dist", copyPublicDir: false },
});
