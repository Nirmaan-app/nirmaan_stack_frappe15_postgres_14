#!/usr/bin/env node
// Type-checks the frontend and reports only the errors that are NEW against tsc-baseline.json.
//
//   node scripts/typecheck.mjs                    exit 0: no new errors; 1: new errors; 2: tsc itself failed
//   node scripts/typecheck.mjs --update-baseline  rewrite tsc-baseline.json from the current errors
//
// Run from frontend/. An error's key is its file, its code and its message, never its line or column, so moving
// code does not make an old error look new. The baseline counts each key, because one file can raise the same
// error several times; an error is new when its key's count goes above the baseline's.
//
// Re-baseline only after fixing old errors (the run lists them as "fixed:"), never to hide a new one.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASELINE = "tsc-baseline.json";
const TSC = join("node_modules", ".bin", "tsc");
const TSC_ARGS = [
  "-p", "tsconfig.json", "--noEmit",
  "--incremental", "--tsBuildInfoFile", ".tsbuildinfo",
  "--pretty", "false",
];

// `src/a.ts(12,5): error TS2322: Type ...`, or `error TS5023: ...` for an error with no file.
const ERROR_LINE = /^(?:(.+?)\((\d+),(\d+)\): )?error (TS\d+): (.*)$/;

const FRONTEND_DIRS = [...new Set([process.cwd(), realpathSync(process.cwd())])].map((d) => d.replace(/\\/g, "/") + "/");

/**
 * Makes a path or message the same in every checkout and on CI: this folder's absolute path is dropped, and a
 * path into node_modules (this checkout's own or a linked one elsewhere) becomes `node_modules/...`.
 */
function portable(text) {
  let out = text.replace(/\\/g, "/");
  for (const dir of FRONTEND_DIRS) out = out.split(dir).join("");
  return out.replace(/(^|["'(\s])[^"'(\s]*?node_modules\//g, "$1node_modules/");
}

/** Parses tsc's `--pretty false` output; indented lines continue the error above them. */
function parseTscOutput(output) {
  const errors = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const match = ERROR_LINE.exec(line);
    if (match) {
      const [, path = "", ln = "0", col = "0", code, message] = match;
      errors.push({ path: portable(path), line: Number(ln), col: Number(col), code, message: portable(message) });
    } else if (/^\s/.test(line) && errors.length) {
      errors[errors.length - 1].message += "\n" + portable(line);
    }
  }
  return errors;
}

const keyOf = (e) => JSON.stringify([e.path, e.code, e.message]);

function countByKey(errors) {
  const counts = new Map();
  for (const e of errors) counts.set(keyOf(e), (counts.get(keyOf(e)) ?? 0) + 1);
  return counts;
}

function readBaseline() {
  if (!existsSync(BASELINE)) return null;
  const counts = new Map();
  for (const [path, code, message, count] of JSON.parse(readFileSync(BASELINE, "utf8")).errors) {
    counts.set(JSON.stringify([path, code, message]), count);
  }
  return counts;
}

/** Sorted, one entry per line, so a re-baseline diff shows exactly which errors came or went. */
function writeBaseline(counts) {
  const entries = [...counts]
    .map(([key, count]) => [...JSON.parse(key), count])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
  const body = entries.map((e) => "    " + JSON.stringify(e)).join(",\n");
  writeFileSync(
    BASELINE,
    "{\n" +
      '  "regenerate": "node scripts/typecheck.mjs --update-baseline (only after fixing old errors)",\n' +
      '  "entry": ["file", "code", "message", "count"],\n' +
      '  "errors": [\n' + body + "\n  ]\n}\n",
  );
}

const total = (counts) => [...counts.values()].reduce((a, b) => a + b, 0);
const firstLine = (message) => message.split("\n")[0];

function runTsc() {
  const started = Date.now();
  const result = spawnSync(TSC, TSC_ARGS, { encoding: "utf8", maxBuffer: 1 << 29 });
  return { ...result, seconds: ((Date.now() - started) / 1000).toFixed(1) };
}

function main() {
  const update = process.argv.includes("--update-baseline");
  const tsc = runTsc();
  const errors = parseTscOutput(tsc.stdout ?? "");

  if (tsc.error || tsc.signal || (tsc.status !== 0 && errors.length === 0)) {
    const why = tsc.error ? tsc.error.message : tsc.signal ? `killed by ${tsc.signal}` : `exit ${tsc.status}`;
    console.log(`typecheck: tsc failed without reporting type errors (${why}); nothing was compared.`);
    const tail = `${tsc.stdout ?? ""}\n${tsc.stderr ?? ""}`.trim().split("\n").slice(-15).join("\n");
    if (tail) console.log(tail);
    console.log("If it ran out of memory, raise it: NODE_OPTIONS=--max-old-space-size=3072");
    return 2;
  }

  const current = countByKey(errors);
  if (update) {
    writeBaseline(current);
    console.log(`typecheck: baseline rewritten with ${total(current)} errors in ${current.size} keys (tsc ${tsc.seconds}s)`);
    return 0;
  }

  const baseline = readBaseline();
  if (!baseline) console.log(`typecheck: no ${BASELINE}; every error counts as new. Create it with --update-baseline.`);
  const base = baseline ?? new Map();

  let newCount = 0;
  const report = [];
  const byKey = new Map();
  for (const e of errors) {
    if (!byKey.has(keyOf(e))) byKey.set(keyOf(e), []);
    byKey.get(keyOf(e)).push(e);
  }
  for (const [key, list] of byKey) {
    const was = base.get(key) ?? 0;
    if (list.length <= was) continue;
    newCount += list.length - was;
    // Line numbers are not in the baseline, so when a key only grew, every occurrence is listed.
    const note = was ? `  [${list.length} now, ${was} in baseline: ${list.length - was} of these is new]` : "";
    for (const e of list) {
      report.push(`${e.path || "(no file)"}:${e.line}:${e.col} ${e.code} ${e.message.replace(/\n/g, "\n    ")}${note}`);
    }
  }
  const fixed = [];
  for (const [key, was] of base) {
    const now = current.get(key) ?? 0;
    if (now >= was) continue;
    const [path, code, message] = JSON.parse(key);
    fixed.push(`fixed: ${path || "(no file)"} ${code} ${firstLine(message)}${was > 1 ? `  [${was} -> ${now}]` : ""}`);
  }

  console.log(`typecheck: ${newCount} new errors (baseline ${total(base)}, total ${errors.length})`);
  for (const line of report) console.log(line);
  for (const line of fixed.sort()) console.log(line);
  if (fixed.length) console.log(`(${fixed.length} baseline entries fixed: run with --update-baseline to lock them in)`);
  console.log(`tsc took ${tsc.seconds}s`);
  return newCount ? 1 : 0;
}

process.exitCode = main();
