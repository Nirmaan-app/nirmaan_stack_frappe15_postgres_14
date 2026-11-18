// `yarn install` runs install_git_hooks.mjs (the `prepare` script) from frontend/. Each test builds a throwaway
// folder shaped like the repo (a .githooks/ beside frontend/) and runs the script there as yarn would.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "install_git_hooks.mjs");
// No user or system git config may leak in: a global core.hooksPath would change what the script sees.
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function repoShape({ git }) {
  const root = mkdtempSync(join(tmpdir(), "hooks-"));
  dirs.push(root);
  mkdirSync(join(root, ".githooks"));
  mkdirSync(join(root, "frontend"));
  if (git) spawnSync("git", ["init", "-q", root], { env: ENV });
  return root;
}

const prepare = (root) => spawnSync(process.execPath, [SCRIPT], { cwd: join(root, "frontend"), env: ENV, encoding: "utf8" });
const hooksPath = (root) =>
  spawnSync("git", ["-C", root, "config", "--get", "core.hooksPath"], { env: ENV, encoding: "utf8" }).stdout.trim();

describe("install_git_hooks (the prepare script)", () => {
  it("points core.hooksPath at the repo's .githooks in a fresh clone", () => {
    const root = repoShape({ git: true });
    expect(prepare(root).status).toBe(0);
    expect(hooksPath(root)).toBe(".githooks");
  });

  it("leaves a core.hooksPath someone already set alone", () => {
    const root = repoShape({ git: true });
    spawnSync("git", ["-C", root, "config", "core.hooksPath", "/elsewhere/hooks"], { env: ENV });
    expect(prepare(root).status).toBe(0);
    expect(hooksPath(root)).toBe("/elsewhere/hooks");
  });

  it("exits 0 and changes nothing where there is no git repo (a tarball or docker build)", () => {
    const root = repoShape({ git: false });
    const run = prepare(root);
    expect(run.status).toBe(0);
    expect(run.stdout + run.stderr).toMatch(/not a git checkout/);
  });
});
