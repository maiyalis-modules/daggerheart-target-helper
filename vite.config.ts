import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Vite build for the Maiyalis: Target Helper FoundryVTT module.
 *
 * The whole project folder *is* the module: `module.json`, `lang/`, `styles/`,
 * and `templates/` are served from the repository root, and Vite compiles the
 * TypeScript entry point in `src/` down to a single ES module at `dist/module.js`
 * (referenced by `module.json` -> `esmodules`).
 *
 * To develop against a live Foundry instance, symlink (or junction) this folder
 * into `{userData}/Data/modules/daggerheart-target-helper` and run `npm run watch`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // Foundry loads modules as native ES modules in the browser, so keep the
    // output as a single un-split ESM file with no external runtime deps.
    lib: {
      entry: resolve(__dirname, "src/module.ts"),
      formats: ["es"],
      fileName: () => "module.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "module.[ext]",
      },
    },
    minify: false,
    target: "es2022",
  },
});
