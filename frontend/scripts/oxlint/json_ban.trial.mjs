// The `.json()` ban of ADR-0049 in a form oxlint can enforce (ticket #1699). Run by scripts/oxlint/vitest.config.mjs,
// not by `yarn test`. ESLint enforces it with
// `no-restricted-syntax`, which oxlint does not have; scripts/oxlint/nirmaan_plugin.mjs is the replacement, loaded by
// the trial config scripts/oxlint/oxlintrc.json.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const FRONTEND = join(import.meta.dirname, "..", "..");
const LINT = join(import.meta.dirname, "lint.mjs");

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Run the trial (lint.mjs) from the frontend folder; return the rule names it reports, one per finding. */
function lintPaths(...args) {
  const run = spawnSync("node", [LINT, "--format", "json", ...args], { cwd: FRONTEND, encoding: "utf8" });
  expect(run.error).toBeUndefined();
  return JSON.parse(run.stdout).diagnostics.map((d) => d.code);
}

/** Lint one made-up source file with the trial config. */
function lintSource(source) {
  const dir = mkdtempSync(join(tmpdir(), "oxlint-json-"));
  dirs.push(dir);
  const file = join(dir, "sample.ts");
  writeFileSync(file, source);
  return lintPaths(file);
}

describe("the .json() ban under oxlint", () => {
  it("refuses response.json()", () => {
    const codes = lintSource("export async function load(response: Response) {\n  return await response.json();\n}\n");
    expect(codes).toEqual(["nirmaan(no-json-call)"]);
  });

  it("allows parseJson(...) on the response text", () => {
    const codes = lintSource(
      'import { parseJson } from "@/lib/parseJson";\n' +
        "export async function load(response: Response) {\n  return parseJson(await response.text());\n}\n",
    );
    expect(codes).toEqual([]);
  });

  it("allows reading a field called json, as ESLint's rule does (it bans only the call)", () => {
    const codes = lintSource("export function name(row: { json: string }) {\n  return row.json;\n}\n");
    expect(codes).toEqual([]);
  });
});

describe("the trial config", () => {
  it("exempts parseJson's own home from the JSON bans, as eslint.config.js does", () => {
    expect(lintPaths("src/lib/parseJson.ts")).toEqual([]);
  });

  it("skips the generated shadcn/ui primitives, as eslint.config.js does", () => {
    // simple-table.tsx alone holds 10 findings when linted; parseJson.ts is there so oxlint has a file to lint.
    expect(lintPaths("src/components/ui/simple-table.tsx", "src/lib/parseJson.ts")).toEqual([]);
  });

  it("runs the type-aware rules: tsconfig.json holds nothing typescript-go refuses", () => {
    // With `baseUrl` set, tsgolint reports one typescript(tsconfig-error) and every type-aware rule finds nothing.
    expect(lintPaths("--type-aware", "src/lib/parseJson.ts")).toEqual([]);
  });
});
