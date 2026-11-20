// react_doctor_new.mjs: does a change bring a new error-level React Doctor finding (#1698)?
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changedFiles } from "./react_doctor_new.mjs";

const FRONTEND = join(import.meta.dirname, "..");
const SCRIPT = join(FRONTEND, "scripts", "react_doctor_new.mjs");

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const LIST_WITHOUT_KEYS = "export function Names({ names }: { names: string[] }) {\n  return <ul>{names.map((n) => <li>{n}</li>)}</ul>;\n}\n";
const LIST_WITH_KEYS = "export function Tags({ tags }: { tags: string[] }) {\n  return <ul>{tags.map((t) => <li key={t}>{t}</li>)}</ul>;\n}\n";

/** A made-up frontend in its own git repo: `base` is committed, then `head` on top; returns the base commit. */
function sampleRepo(base, head) {
  const root = mkdtempSync(join(tmpdir(), "doctor-"));
  dirs.push(root);
  const fe = join(root, "frontend");
  mkdirSync(join(fe, "src"), { recursive: true });
  writeFileSync(join(fe, "package.json"), JSON.stringify({ name: "sample", private: true, dependencies: { react: "^18.2.0" } }));
  writeFileSync(join(fe, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true }, include: ["src"] }));
  writeFileSync(join(root, ".gitignore"), "node_modules\n");
  symlinkSync(join(FRONTEND, "node_modules"), join(fe, "node_modules"));
  const git = (...args) => spawnSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" });
  const commit = (files, message) => {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(fe, "src", name), text);
    git("add", "-A");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD").stdout.trim();
  };
  git("init", "-q");
  const baseSha = commit(base, "base");
  commit(head, "head");
  return { fe, baseSha };
}

function check(fe, args) {
  const { GITHUB_ACTIONS, ...env } = process.env;
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: fe, env, encoding: "utf8" });
}

describe("react_doctor_new.mjs --base", () => {
  it("fails on a new error-level finding, naming its file and rule", () => {
    const { fe, baseSha } = sampleRepo({ "tags.tsx": LIST_WITH_KEYS }, { "names.tsx": LIST_WITHOUT_KEYS });
    const run = check(fe, ["--base", baseSha]);
    expect(run.status, run.stdout + run.stderr).toBe(1);
    expect(run.stdout).toMatch(/src\/names\.tsx:2 .*jsx-key/);
  }, 60_000);

  it("passes a change that touches a file keeping its old error, and adds only a warning", () => {
    const opener = 'export function Open() {\n  return <button onClick={() => window.open("https://example.com")}>open</button>;\n}\n';
    const { fe, baseSha } = sampleRepo(
      { "names.tsx": LIST_WITHOUT_KEYS },
      { "names.tsx": `// touched\n${LIST_WITHOUT_KEYS}`, "open.tsx": opener },
    );
    const run = check(fe, ["--base", baseSha]);
    expect(run.status, run.stdout + run.stderr).toBe(0);
  }, 60_000);

  it("fails on one more finding of an old rule in a file that already has one", () => {
    const twoLists = `${LIST_WITHOUT_KEYS}export function More({ names }: { names: string[] }) {\n  return <ol>{names.map((n) => <li>{n}</li>)}</ol>;\n}\n`;
    const { fe, baseSha } = sampleRepo({ "names.tsx": LIST_WITHOUT_KEYS }, { "names.tsx": twoLists });
    const run = check(fe, ["--base", baseSha]);
    expect(run.status, run.stdout + run.stderr).toBe(1);
    expect(run.stdout).toMatch(/src\/names\.tsx:\d+ .*jsx-key/);
  }, 60_000);

  it("passes a change that touches no source file", () => {
    const { fe, baseSha } = sampleRepo({ "names.tsx": LIST_WITHOUT_KEYS }, { "notes.md": "# notes\n" });
    const run = check(fe, ["--base", baseSha]);
    expect(run.status, run.stdout + run.stderr).toBe(0);
  }, 60_000);

  // React Doctor needs the merge base; in a clone without it, it reports every finding of the changed files.
  it("fails as a tool error, not a pass or a finding, when the base is not in the clone", () => {
    const { fe } = sampleRepo({ "tags.tsx": LIST_WITH_KEYS }, { "names.tsx": LIST_WITHOUT_KEYS });
    const run = check(fe, ["--base", "0123456789abcdef0123456789abcdef01234567"]);
    expect(run.status, run.stdout + run.stderr).toBe(2);
    expect(run.stderr).toMatch(/did not compare with the base/);
  }, 60_000);
});

/** One React Doctor JSON diagnostic, as much of it as the comparison reads. */
const finding = (filePath, rule, line, severity = "error") => ({ filePath, plugin: "react-doctor", rule, line, column: 3, severity });

describe("changedFiles (--twice)", () => {
  it("names nothing when two scans report the same findings in another order", () => {
    const a = [finding("src/a.tsx", "jsx-key", 4), finding("src/b.tsx", "rules-of-hooks", 9, "warning")];
    expect(changedFiles(a, [...a].reverse())).toEqual([]);
  });

  it("names a file whose finding moved, changed severity, or appears in one scan only", () => {
    const a = [finding("src/a.tsx", "jsx-key", 4), finding("src/b.tsx", "jsx-key", 4), finding("src/c.tsx", "jsx-key", 4)];
    const b = [finding("src/a.tsx", "jsx-key", 5), finding("src/b.tsx", "jsx-key", 4, "warning"), ...a.slice(2), finding("src/d.tsx", "alt-text", 1)];
    expect(changedFiles(a, b)).toEqual(["src/a.tsx", "src/b.tsx", "src/d.tsx"]);
  });
});

describe("react_doctor_new.mjs --twice", () => {
  it("passes when two full scans of a tree agree", () => {
    const { fe } = sampleRepo({ "names.tsx": LIST_WITHOUT_KEYS }, { "tags.tsx": LIST_WITH_KEYS });
    const run = check(fe, ["--twice"]);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toMatch(/2 scans, one result/);
  }, 60_000);
});

describe("doctor.config.jsonc", () => {
  // The two refusal messages in creditCardImport.ts name a password; they are error-message text, not a secret.
  it("drops the no-secrets-in-client-code findings in creditCardImport.ts, and only there", () => {
    const file = "src/pages/outflow-import/creditCardImport.ts";
    const run = spawnSync(process.execPath, [join(FRONTEND, "node_modules", "react-doctor", "bin", "react-doctor.js"),
      "--no-telemetry", "--no-score", "--no-supply-chain", "--yes", "--no-color", "--verbose", file], { cwd: FRONTEND, encoding: "utf8" });
    expect(run.stdout + run.stderr).not.toMatch(/no-secrets-in-client-code/);
    const { fe } = sampleRepo({ "keys.ts": 'export const apiKey = "sk_live_51HxTrAbCdEfGhIjKlMnOpQrStUvWxYz0123456789";\n' }, {});
    copyFileSync(join(FRONTEND, "doctor.config.jsonc"), join(fe, "doctor.config.jsonc"));
    const sample = spawnSync(process.execPath, [join(FRONTEND, "node_modules", "react-doctor", "bin", "react-doctor.js"),
      "--no-telemetry", "--no-score", "--no-supply-chain", "--yes", "--no-color", "--verbose", "."], { cwd: fe, encoding: "utf8" });
    expect(sample.stdout + sample.stderr).toMatch(/no-secrets-in-client-code/);
  }, 60_000);
});
