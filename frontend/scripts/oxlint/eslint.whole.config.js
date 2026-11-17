// Trial only (ticket #1699): eslint.config.js plus every no-unsafe-* rule ADR-0049 names, on the whole tree.
//   node --max-old-space-size=4096 node_modules/eslint/bin/eslint.js -c scripts/oxlint/eslint.whole.config.js src
import { defineConfig } from "eslint/config";
import base from "../../eslint.config.js";

const UNSAFE = [
  "no-unsafe-argument",
  "no-unsafe-assignment",
  "no-unsafe-call",
  "no-unsafe-declaration-merging",
  "no-unsafe-enum-assignment",
  "no-unsafe-enum-comparison",
  "no-unsafe-function-type",
  "no-unsafe-member-access",
  "no-unsafe-return",
  "no-unsafe-unary-minus",
];

export default defineConfig([
  ...base,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: Object.fromEntries(UNSAFE.map((rule) => [`@typescript-eslint/${rule}`, "error"])),
  },
]);
