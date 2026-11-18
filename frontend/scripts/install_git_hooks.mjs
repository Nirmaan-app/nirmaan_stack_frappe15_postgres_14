#!/usr/bin/env node
// The `prepare` script: `yarn install` in frontend/ switches the repo's git hooks on (ADR-0049) by setting
// core.hooksPath to .githooks, so pre-commit and pre-merge-commit run for everyone who installs the frontend.
//
// A relative hooksPath is read from the root of whichever working tree runs the hook, so every worktree uses its
// own .githooks. A core.hooksPath that is already set (by hand, or to another tool's hooks) is left alone.
// It never fails an install: outside a git checkout (a tarball or docker build) or without git, it says so and
// exits 0.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const HOOKS_DIR = ".githooks";

function git(...args) {
  const run = spawnSync("git", args, { encoding: "utf8" });
  return { ok: run.status === 0, out: (run.stdout ?? "").trim() };
}

function main() {
  const top = git("rev-parse", "--show-toplevel");
  if (!top.ok) return "not a git checkout (or no git): hooks not switched on";
  if (!existsSync(join(top.out, HOOKS_DIR))) return `no ${HOOKS_DIR}/ at ${top.out}: hooks not switched on`;
  const current = git("config", "--get", "core.hooksPath");
  if (current.ok && current.out) {
    return current.out === HOOKS_DIR ? "" : `core.hooksPath is already ${current.out}; left as it is`;
  }
  if (!git("config", "core.hooksPath", HOOKS_DIR).ok) return "could not set core.hooksPath; hooks not switched on";
  return `core.hooksPath set to ${HOOKS_DIR}: pre-commit and pre-merge-commit now run the checks`;
}

try {
  const note = main();
  if (note) console.log(`git hooks: ${note}`);
} catch (e) {
  console.log(`git hooks: skipped (${e instanceof Error ? e.message : String(e)})`);
}
