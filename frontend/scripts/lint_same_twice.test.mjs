// lint_same_twice.mjs: does the type-aware lint give one answer every run (ADR-0049, #1699)?
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedFiles, unsafeRules } from "./lint_same_twice.mjs";

/** One oxlint `-f json` diagnostic, as much of it as the comparison reads. */
const finding = (filename, code, offset) => ({ filename, code, labels: [{ span: { offset, length: 3 } }] });

describe("changedFiles", () => {
  it("names nothing when two runs report the same findings in another order", () => {
    const a = [finding("src/a.ts", "typescript(no-unsafe-call)", 10), finding("src/b.ts", "typescript(no-explicit-any)", 4)];
    expect(changedFiles(a, [...a].reverse())).toEqual([]);
  });

  it("names the file whose finding appears in one run only", () => {
    const a = [finding("src/a.ts", "typescript(no-unsafe-call)", 10)];
    const b = [...a, finding("src/table.tsx", "typescript(no-unsafe-return)", 215)];
    expect(changedFiles(a, b)).toEqual(["src/table.tsx"]);
  });

  it("names a file whose finding moved to another place, and one reported a second time", () => {
    const a = [finding("src/a.ts", "typescript(no-unsafe-call)", 10), finding("src/b.ts", "typescript(no-explicit-any)", 4)];
    const b = [
      finding("src/a.ts", "typescript(no-unsafe-call)", 11),
      finding("src/b.ts", "typescript(no-explicit-any)", 4),
      finding("src/b.ts", "typescript(no-explicit-any)", 4),
    ];
    expect(changedFiles(a, b)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("names a file whose finding changed rule at the same place", () => {
    const a = [finding("src/a.ts", "typescript(no-unsafe-call)", 10)];
    const b = [finding("src/a.ts", "typescript(no-unsafe-member-access)", 10)];
    expect(changedFiles(a, b)).toEqual(["src/a.ts"]);
  });
});

describe("unsafeRules", () => {
  it("reads the typed-folder rules from a config with block comments and trailing commas", () => {
    const config = `{
      /* a block comment, holding "quotes" and // slashes */
      "rules": { "typescript/no-explicit-any": "error", },
      "overrides": [
        { "files": ["src/a/**"], "rules": { "typescript/no-unsafe-call": "error", /* x */ "typescript/no-unsafe-return": "error", }, },
        { "files": ["src/b/**"], "rules": { "typescript/no-unsafe-call": "off" } }, // trailing
      ],
    }`;
    expect(unsafeRules(config)).toEqual(["typescript/no-unsafe-call", "typescript/no-unsafe-return"]);
  });
});

describe("started through a symlinked path", () => {
  it("lints, rather than exiting 0 with no output", () => {
    const dir = mkdtempSync(join(tmpdir(), "lint-same-twice-"));
    try {
      symlinkSync(join(import.meta.dirname, ".."), join(dir, "frontend"));
      const run = spawnSync(process.execPath, [join(dir, "frontend", "scripts", "lint_same_twice.mjs")], { encoding: "utf8" });
      expect(run.stdout).toMatch(/run 1: \d+ findings/);
      expect(run.status, run.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("CI", () => {
  const workflow = readFileSync(join(import.meta.dirname, "..", "..", ".github", "workflows", "frontend.yml"), "utf8");

  it("runs yarn lint, then the type-aware lint twice and compares the two", () => {
    const lint = workflow.indexOf("run: yarn lint\n");
    const twice = workflow.indexOf("run: node scripts/lint_same_twice.mjs\n");
    expect(lint).toBeGreaterThan(0);
    expect(twice).toBeGreaterThan(lint);
  });
});
