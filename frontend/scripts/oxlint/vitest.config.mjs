// The oxlint trial's own tests (ticket #1699), kept out of `yarn test` and so out of CI: the trial is not wired in.
//   scripts/devenv/devenv.sh vitest --config scripts/oxlint/vitest.config.mjs      (or, in frontend/: yarn vitest run --config ...)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { root: import.meta.dirname, include: ["*.trial.mjs"], environment: "node" },
});
