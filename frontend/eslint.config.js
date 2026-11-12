// ESLint is the frontend's type ratchet (ADR-0049). Every rule here is an error; the violations that existed when a
// rule was switched on are frozen per file and per rule in eslint-suppressions.json, so a new one fails `yarn lint`.
//
//   yarn lint                                  exit 1 on a new violation, or on a suppression no longer needed
//   yarn lint --prune-suppressions             after fixing old violations: lower their counts, then commit the file
//
// A rule joins one per change, frozen with `yarn eslint --suppress-rule <rule>`.
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig([
  // shadcn/ui primitives are generated (root CODING_STANDARDS.md § Don't touch). src/types/doctypes/ is generated
  // too, but by our own script, so it is linted: its output must hold the same rules.
  globalIgnores(["src/components/ui/"]),
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    // The code carries disable comments for rules not switched on yet (react-hooks/exhaustive-deps, ...).
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": reactHooks },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
]);
