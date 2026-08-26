import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  base: "./",
  root: ".",
  plugins: [react()],
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
  },
  server: {
    strictPort: true,
  },
  run: {
    tasks: {
      build: {
        command: "vp build && vp pack",
        cache: false,
      },
    },
  },
  pack: [
    {
      format: "cjs",
      outDir: "dist-electron",
      outExtensions: () => ({ js: ".cjs" }),
      sourcemap: true,
      entry: ["src/main.ts"],
      clean: true,
      deps: { neverBundle: ["electron"] },
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      outExtensions: () => ({ js: ".cjs" }),
      sourcemap: true,
      entry: ["src/preload.ts"],
      deps: { neverBundle: ["electron"] },
    },
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
