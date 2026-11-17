// The two ways oxlint and the residence check are started (ADR-0049): `yarn lint` from package.json, which a
// teammate runs on Windows (cmd.exe), and the commit hooks' .githooks/checks.sh.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const FRONTEND = join(import.meta.dirname, "..");
const CHECKS = join(FRONTEND, "..", ".githooks", "checks.sh");

const pkg = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8"));
const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("yarn lint", () => {
  const lint = pkg.scripts.lint;

  it("sets no environment variable by shell syntax, which cmd.exe cannot read", () => {
    expect(lint).not.toMatch(/^\s*\w+=/);
  });

  it("runs oxlint's type-aware lint on src, with nothing a shell must expand", () => {
    expect(lint).toBe("oxlint --type-aware src");
  });

  it("pins oxlint and oxlint-tsgolint to exact versions, and keeps no ESLint package", () => {
    const dev = pkg.devDependencies;
    expect(dev.oxlint).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dev["oxlint-tsgolint"]).toMatch(/^\d+\.\d+\.\d+$/);
    const all = Object.keys({ ...pkg.dependencies, ...dev });
    expect(all.filter((name) => /eslint/.test(name))).toEqual([]);
  });

  /** `yarn lint`'s command, run in a made-up frontend folder holding this repo's lint config and one source file. */
  function lintSample(source, suppressions, tsconfig = { compilerOptions: { strict: true } }) {
    const root = mkdtempSync(join(tmpdir(), "lint-"));
    dirs.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "sample.ts"), source);
    writeFileSync(join(root, ".oxlintrc.json"), readFileSync(join(FRONTEND, ".oxlintrc.json")));
    // "repo": this repo's own tsconfig.json and the tsconfig.node.json it references.
    const own = tsconfig === "repo" ? ["tsconfig.json", "tsconfig.node.json"] : [];
    for (const name of own) writeFileSync(join(root, name), readFileSync(join(FRONTEND, name)));
    if (!own.length) writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ ...tsconfig, include: ["src"] }));
    if (suppressions) writeFileSync(join(root, "oxlint-suppressions.json"), JSON.stringify(suppressions));
    symlinkSync(join(FRONTEND, "node_modules"), join(root, "node_modules"));
    const [bin, ...args] = lint.split(" ");
    return spawnSync(join(root, "node_modules", ".bin", bin), args, { cwd: root, encoding: "utf8" });
  }
  const frozen = (count) => ({ "src/sample.ts": { "typescript/no-explicit-any": { count } } });
  const twoAnys = "export const a: any = 1;\nexport const b: any = 2;\n";

  it("passes on violations frozen in oxlint-suppressions.json", () => {
    expect(lintSample(twoAnys, frozen(2)).status).toBe(0);
  });

  it("fails on a violation the suppressions file does not freeze", () => {
    const run = lintSample(twoAnys, frozen(1));
    expect(run.status, run.stdout).toBe(1);
  });

  it("fails on a suppression no longer needed", () => {
    const run = lintSample("export const a: any = 1;\n", frozen(2));
    expect(run.status, run.stdout).toBe(1);
    expect(run.stdout).toMatch(/prune-suppressions/);
  });

  // tsgolint builds programs with typescript-go, which refuses some options TypeScript 5 takes (`baseUrl`); with one
  // set, every type-aware rule would go quiet. The lint must fail instead.
  it("fails, rather than skipping the type-aware rules, on a tsconfig option typescript-go refuses", () => {
    const run = lintSample("export const a = 1;\n", null, { compilerOptions: { strict: true, baseUrl: "." } });
    expect(run.status, run.stdout).toBe(1);
    expect(run.stdout).toMatch(/tsconfig/);
  });

  it("runs on this repo's tsconfig.json, which holds no such option", () => {
    const run = lintSample("export const a = 1;\n", null, "repo");
    expect(run.status, run.stdout).toBe(0);
  });
});

describe(".githooks/checks.sh", () => {
  it("says python3 is missing, not that a count rose, where there is no python3", () => {
    const root = mkdtempSync(join(tmpdir(), "checks-"));
    dirs.push(root);
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts", "residence_check.py"), "");
    spawnSync("git", ["init", "-q", root]);
    // A PATH holding the tools the script needs, and no python3.
    const bin = join(root, "bin");
    mkdirSync(bin);
    for (const tool of ["git", "grep", "tr", "wc", "xargs", "cat"]) {
      const found = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
      if (found) symlinkSync(found, join(bin, tool));
    }
    const run = spawnSync("/bin/sh", [CHECKS, "pre-commit"], { cwd: root, env: { PATH: bin }, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/python3 was not found/);
    expect(run.stderr).not.toMatch(/counts a new violation/);
  });
});
