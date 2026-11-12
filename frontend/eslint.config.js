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

const SDK_MESSAGE =
  "Import SDK hooks and types from '@/lib/frappe': its hooks return `unknown` unless you pass a type (ADR-0049).";
const JSON_MESSAGE =
  "Use parseJson() from '@/lib/parseJson' (it returns `unknown`); for a fetch response, parseJson(await response.text()) (ADR-0049).";

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
      // The SDK's hooks return `any` unless typed; src/lib/frappe.ts re-declares them to return `unknown`.
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "frappe-react-sdk", message: SDK_MESSAGE }],
          patterns: [{ group: ["frappe-react-sdk/*"], message: SDK_MESSAGE }],
        },
      ],
      // JSON.parse and Response.json() return `any`; parseJson() returns `unknown`.
      "no-restricted-properties": ["error", { object: "JSON", property: "parse", message: JSON_MESSAGE }],
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='json']", message: JSON_MESSAGE },
      ],
    },
  },
  {
    // The two homes the bans above point to, and the test that checks the SDK module against the SDK itself.
    files: ["src/lib/frappe.ts", "src/lib/frappe.test.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["src/lib/parseJson.ts"],
    rules: { "no-restricted-properties": "off", "no-restricted-syntax": "off" },
  },
]);
