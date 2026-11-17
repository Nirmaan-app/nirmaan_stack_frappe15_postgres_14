// The `.json()` ban of ADR-0049 in a form oxlint can enforce (ticket #1699). ESLint enforces it with
// `no-restricted-syntax`, which oxlint does not have; scripts/oxlint/nirmaan_plugin.mjs is the replacement, loaded by
// the trial config scripts/oxlint/oxlintrc.json.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const FRONTEND = join(import.meta.dirname, "..", "..");
const CONFIG = join(import.meta.dirname, "oxlintrc.json");
const OXLINT = join(FRONTEND, "node_modules", ".bin", "oxlint");

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Lint one made-up source file with the trial config; return the rule names it reports, one per finding. */
function lint(source) {
  const dir = mkdtempSync(join(tmpdir(), "oxlint-json-"));
  dirs.push(dir);
  const file = join(dir, "sample.ts");
  writeFileSync(file, source);
  const run = spawnSync(OXLINT, ["-c", CONFIG, "--format", "json", file], { encoding: "utf8" });
  expect(run.error).toBeUndefined();
  const report = JSON.parse(run.stdout);
  return report.diagnostics.map((d) => d.code);
}

describe("the .json() ban under oxlint", () => {
  it("refuses response.json()", () => {
    const codes = lint("export async function load(response: Response) {\n  return await response.json();\n}\n");
    expect(codes).toEqual(["nirmaan(no-json-call)"]);
  });

  it("allows parseJson(...) on the response text", () => {
    const codes = lint(
      'import { parseJson } from "@/lib/parseJson";\n' +
        "export async function load(response: Response) {\n  return parseJson(await response.text());\n}\n",
    );
    expect(codes).toEqual([]);
  });

  it("allows reading a field called json, as ESLint's rule does (it bans only the call)", () => {
    const codes = lint("export function name(row: { json: string }) {\n  return row.json;\n}\n");
    expect(codes).toEqual([]);
  });
});
