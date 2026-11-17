// The two ways ESLint and the residence check are started (ADR-0049): `yarn lint` from package.json, which a
// teammate runs on Windows (cmd.exe), and the commit hooks' .githooks/checks.sh.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const FRONTEND = join(import.meta.dirname, "..");
const CHECKS = join(FRONTEND, "..", ".githooks", "checks.sh");

describe("yarn lint", () => {
  const lint = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")).scripts.lint;

  it("sets no environment variable by shell syntax, which cmd.exe cannot read", () => {
    expect(lint).not.toMatch(/^\s*\w+=/);
  });

  it("starts ESLint through node with a 4 GB heap, at a file that exists", () => {
    const m = lint.match(/^node --max-old-space-size=4096 (\S+) src$/);
    expect(m, lint).not.toBeNull();
    expect(existsSync(join(FRONTEND, m[1])), m[1]).toBe(true);
  });
});

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

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
