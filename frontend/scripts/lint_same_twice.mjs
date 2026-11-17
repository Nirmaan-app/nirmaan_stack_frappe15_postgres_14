// Does the type-aware lint give one answer every run (ADR-0049, #1699)? oxlint's type-aware rules once gave a
// different result in about 1 run of 4, where a call's inferred type depended on the checker's order. A count
// ratchet would then fail at random, so CI runs this and fails when two runs differ.
//
//   node scripts/lint_same_twice.mjs                         2 runs of .oxlintrc.json (CI)
//   node scripts/lint_same_twice.mjs --runs 10 --whole-tree  10 runs, every no-unsafe-* rule on all of src/
//
// From frontend/. Each run lints src/ from the repo root, where no oxlint-suppressions.json is, so every finding is
// compared, the frozen ones too. Exit 0: one result; 1: the runs differ (the files are named); 2: oxlint failed.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const FRONTEND = join(import.meta.dirname, "..");
const CONFIG = join(FRONTEND, ".oxlintrc.json");
const OXLINT = join(FRONTEND, "node_modules", "oxlint", "bin", "oxlint");
const TSGOLINT = join(FRONTEND, "node_modules", ".bin", process.platform === "win32" ? "tsgolint.cmd" : "tsgolint");

/** A finding as one comparable string: its rule and place. */
const key = (d) => `${d.code}@${d.labels?.[0]?.span?.offset ?? -1}`;

/** The files whose findings differ between two runs' oxlint `-f json` diagnostics, sorted. */
export function changedFiles(runA, runB) {
  const byFile = (run) => {
    const files = new Map();
    for (const d of run) files.set(d.filename, [...(files.get(d.filename) ?? []), key(d)]);
    for (const keys of files.values()) keys.sort();
    return files;
  };
  const a = byFile(runA);
  const b = byFile(runB);
  const names = new Set([...a.keys(), ...b.keys()]);
  return [...names].filter((f) => (a.get(f) ?? []).join("\n") !== (b.get(f) ?? []).join("\n")).sort();
}

/** The `no-unsafe-*` rules of .oxlintrc.json's typed-folder block (the config is JSON with `//` comments). */
function unsafeRules() {
  // Drop each `//` comment, leaving strings (which may hold `//`) as they are.
  const text = readFileSync(CONFIG, "utf8").replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*/g, (m, str) => str ?? "");
  const config = JSON.parse(text);
  const rules = config.overrides.flatMap((o) => Object.keys(o.rules ?? {}));
  return [...new Set(rules.filter((r) => r.startsWith("typescript/no-unsafe-")))];
}

/** One run's diagnostics; exits 2 when oxlint did not produce its JSON. */
function lintOnce(extra) {
  const args = [OXLINT, "-c", CONFIG, "--type-aware", "-f", "json", ...extra, "frontend/src"];
  // oxlint looks for tsgolint under the folder it runs in; from the repo root it must be told where it is.
  const env = { ...process.env, OXLINT_TSGOLINT_PATH: TSGOLINT };
  const run = spawnSync(process.execPath, args, { cwd: join(FRONTEND, ".."), env, encoding: "utf8", maxBuffer: 1 << 30 });
  try {
    return JSON.parse(run.stdout).diagnostics;
  } catch {
    console.error(`✘ oxlint failed (exit ${run.status}):\n${run.stderr || run.stdout}`.slice(0, 4000));
    process.exit(2);
  }
}

function main() {
  const { values } = parseArgs({ options: { runs: { type: "string", default: "2" }, "whole-tree": { type: "boolean" } } });
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 2) {
    console.error("--runs takes a whole number, 2 or more");
    process.exit(2);
  }
  const extra = values["whole-tree"] ? unsafeRules().flatMap((r) => ["-D", r]) : [];
  const first = lintOnce(extra);
  console.log(`run 1: ${first.length} findings`);
  let differs = false;
  for (let n = 2; n <= runs; n++) {
    const next = lintOnce(extra);
    const files = changedFiles(first, next);
    console.log(`run ${n}: ${next.length} findings${files.length ? `, ${files.length} files differ from run 1` : ""}`);
    if (files.length) {
      differs = true;
      for (const f of files) console.log(`    ${f}`);
    }
  }
  if (differs) {
    console.error("✘ The type-aware lint gave different results on the same tree (ADR-0049). A file above holds a");
    console.error("  finding whose type depends on the checker's order: give the call its type argument.");
    process.exit(1);
  }
  console.log(`✓ ${runs} runs, one result`);
}

if (process.argv[1] === import.meta.filename) main();
