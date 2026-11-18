// The two ways oxlint and the residence check are started (ADR-0049): `yarn lint` from package.json, which a
// teammate runs on Windows (cmd.exe), and the commit hooks' .githooks/checks.sh.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  // A made-up repo with one staged frontend file, an oxlint that logs what it was given (and exits FAKE_RC), and,
  // when asked, a docker whose `exec` runs the command here: the container sees the repo at the same path.
  //
  // `fail` makes one stage of the staged copy fail: "ls-files" (lists nothing), "checkout-index" (copies, then fails)
  // or "tar" (the host's tar packs only the frontend folder's own entry, then fails).
  function stagedRepo({ nativeRuns, docker, fail, containerLacksOxlint }) {
    const root = mkdtempSync(join(tmpdir(), "checks-"));
    dirs.push(root);
    const log = join(root, "oxlint.log");
    const script = (path, body) => {
      writeFileSync(path, `#!/bin/sh\n${body}`);
      chmodSync(path, 0o755);
    };
    mkdirSync(join(root, "frontend", "src"), { recursive: true });
    mkdirSync(join(root, "frontend", "node_modules", ".bin"), { recursive: true });
    script(
      join(root, "frontend", "node_modules", ".bin", "oxlint"),
      `[ "$1" = --version ] && exit ${nativeRuns ? 0 : 1}\n` +
        `{ echo "args: $*"; echo "cwd: $PWD"; echo "staged: $(cat src/a.ts)"; } >> "${log}"\nexit "\${FAKE_RC:-0}"\n`,
    );
    const bin = join(root, "bin");
    mkdirSync(bin);
    if (docker) {
      script(
        join(bin, "docker"),
        `echo "docker $1" >> "${log}"\n` +
          `case "$1" in\n` +
          `  inspect) case "$*" in *Running*) echo true ;; *) printf '/elsewhere|/x\\n${root}|${root}\\n' ;; esac ;;\n` +
          `  exec) shift; dir=.; while :; do case "$1" in -i) shift ;; -w) dir="$2"; shift 2 ;; *) break ;; esac; done\n` +
          `        shift; ${containerLacksOxlint ? '[ "$1" = test ] && exit 1; ' : ""}cd "$dir" && exec "$@" ;;\n` +
          `esac\n`,
      );
    }
    const real = (tool) => spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    if (fail === "ls-files" || fail === "checkout-index") {
      script(join(bin, "git"), `[ "$1" = ${fail} ] || exec "${real("git")}" "$@"\n` +
        (fail === "checkout-index" ? `"${real("git")}" "$@"\n` : "") + "exit 1\n");
    }
    if (fail === "tar") {
      script(join(bin, "tar"), `case " $* " in *" -x"*) exec "${real("tar")}" "$@" ;; esac\n` +
        `"${real("tar")}" --no-recursion "$@"\nexit 1\n`);
    }
    writeFileSync(join(root, "frontend", "src", "a.ts"), "export const staged = 1;\n");
    const git = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("add", "frontend/src/a.ts");
    writeFileSync(join(root, "frontend", "src", "a.ts"), "export const notStaged = 1;\n");
    const run = (env = {}) => {
      const result = spawnSync("/bin/sh", [CHECKS, "pre-commit"], {
        cwd: root,
        env: { PATH: `${bin}:${process.env.PATH}`, NIRMAAN_LINT_CONTAINER: "nirmaan-test-no-such-container", ...env },
        encoding: "utf8",
      });
      let logged = "";
      try {
        logged = readFileSync(log, "utf8");
      } catch {
        // oxlint never ran
      }
      return { ...result, logged };
    };
    return { run };
  }

  it("lints the staged copy with the local oxlint where its native binary runs", () => {
    const { run } = stagedRepo({ nativeRuns: true });
    const pass = run();
    expect(pass.status, pass.stderr).toBe(0);
    expect(pass.logged).toMatch(/args: --type-aware src\/a\.ts/);
    expect(pass.logged).toMatch(/staged: export const staged = 1;/);
    expect(pass.logged).not.toMatch(/docker/);
    const fail = run({ FAKE_RC: "1" });
    expect(fail.status).toBe(1);
    expect(fail.stderr).toMatch(/oxlint .* failed on the staged files/);
  });

  it("lints the staged copy inside the dev container where the local binary does not load", () => {
    const { run } = stagedRepo({ nativeRuns: false, docker: true });
    const pass = run({ NIRMAAN_LINT_CONTAINER: "test-container" });
    expect(pass.status, pass.stderr).toBe(0);
    expect(pass.logged).toMatch(/docker exec/);
    expect(pass.logged).toMatch(/args: --type-aware src\/a\.ts/);
    expect(pass.logged).toMatch(/staged: export const staged = 1;/);
    const fail = run({ NIRMAAN_LINT_CONTAINER: "test-container", FAKE_RC: "1" });
    expect(fail.status).toBe(1);
    expect(fail.stderr).toMatch(/failed on the staged files/);
  });

  it("refuses, saying so, when git cannot list the staged files", () => {
    const { run } = stagedRepo({ nativeRuns: true, fail: "ls-files" });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/git ls-files could not list/);
    expect(result.logged).not.toMatch(/args:/);
  });

  it("refuses, saying so, when git cannot copy the staged files", () => {
    const { run } = stagedRepo({ nativeRuns: true, fail: "checkout-index" });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/git checkout-index could not copy/);
    expect(result.logged).not.toMatch(/args:/);
  });

  it("refuses, saying so, when the host's tar fails part-way into the container copy", () => {
    const { run } = stagedRepo({ nativeRuns: false, docker: true, fail: "tar" });
    const result = run({ NIRMAAN_LINT_CONTAINER: "test-container" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/could not be packed/);
    expect(result.logged).not.toMatch(/args:/);
  });

  it("skips oxlint with a warning, not a refusal, where the container has no oxlint installed", () => {
    const { run } = stagedRepo({ nativeRuns: false, docker: true, containerLacksOxlint: true });
    const result = run({ NIRMAAN_LINT_CONTAINER: "nirmaan-test" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/oxlint was skipped/);
    expect(result.stderr).toMatch(/has no oxlint installed/);
    expect(result.logged).not.toMatch(/args:/);
  });

  it("skips oxlint with a warning where neither the local binary nor the container runs", () => {
    const { run } = stagedRepo({ nativeRuns: false });
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/⚠ pre-commit: oxlint does not run here[\s\S]*oxlint was skipped/);
    expect(result.logged).not.toMatch(/args:/);
  });
});
