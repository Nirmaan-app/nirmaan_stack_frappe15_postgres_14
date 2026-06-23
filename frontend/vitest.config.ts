/// <reference types="vitest/config" />
//
// Vitest config -- the repo's first frontend unit-test harness (BoQ Phase 5 Slice 2).
//
// Kept SEPARATE from vite.config.ts (the production build) so the build config stays
// decoupled from the test runner. We re-declare the React plugin (for the automatic
// JSX runtime -- the wizard components do not `import React`) and the "@" -> src alias
// so imports resolve identically to the app build.
//
// environment: 'node' -- the extracted render helpers (computeDepths,
// resolveDescriptorValue, renderDescriptorCell) are plain in/out functions that need
// no DOM. ClassificationPill returns JSX and is covered by manual live-cert, not here
// (we deliberately did NOT add jsdom / @testing-library).
import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
