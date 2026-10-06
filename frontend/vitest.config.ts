/// <reference types="vitest/config" />
//
// Vitest config -- the repo's first frontend unit-test harness (BoQ Phase 5 Slice 2).
//
// Kept SEPARATE from vite.config.ts (the production build) so the build config stays
// decoupled from the test runner. We re-declare the React plugin (for the automatic
// JSX runtime -- the wizard components do not `import React`) and the "@" -> src alias
// so imports resolve identically to the app build.
//
// TWO PROJECTS, AND THE SPLIT IS THE WHOLE POINT.
//
// `unit` is every suite this repo has ever had: environment "node", the same include glob, the same
// pool, the same timeouts. It is BYTE-IDENTICAL in behaviour to the single-project config that came
// before -- it merely EXCLUDES the DOM files, of which there were none until now.
//
// `dom` exists because a DOM test cannot share a pool with them. jsdom's environment bootstrap
// measures ~36s on this container, and vitest's worker-start limit is a HARDCODED 60s
// (`START_TIMEOUT` in its dist -- not a config option, not a CLI flag). Run alongside the other
// suites the jsdom worker loses that race and vitest drops the file with
// "Failed to start forks worker", reporting it as an unhandled error RATHER than a failed file --
// so the counts look untouched while the test never ran. `singleFork` + `maxWorkers: 1` give the
// DOM files a pool of their own, so nothing competes with that bootstrap.
//
// ⚠️ NOTHING HERE REACHES THE `unit` PROJECT. Opt-in is by FILENAME (`*.dom.test.tsx`), and each
// DOM file ALSO carries `// @vitest-environment jsdom` so the opt-in is legible in the file itself.
import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const DOM_GLOB = "src/**/*.dom.test.{ts,tsx}";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias: { "@": path.resolve(__dirname, "src") } },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "**/dist/**", DOM_GLOB],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: { "@": path.resolve(__dirname, "src") } },
        test: {
          name: "dom",
          environment: "jsdom",
          include: [DOM_GLOB],
          maxWorkers: 1,
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
