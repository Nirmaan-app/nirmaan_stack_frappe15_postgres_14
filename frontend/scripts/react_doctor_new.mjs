// Does a change bring a new error-level React Doctor finding (#1698)? CI runs this on every pull request.
//
//   node scripts/react_doctor_new.mjs --base <ref>   exit 1 on an error-level finding new against <ref>
//   node scripts/react_doctor_new.mjs --twice        exit 1 when two full scans of this tree differ
//
// From frontend/. Both build React Doctor's argv with `yarn doctor`'s doctorArgv, so the privacy flags are the same everywhere.
// `--base` uses React Doctor's own `--scope changed`: per file and rule, a count may fall but not rise, and a new file
// or rule is new, so an old finding in a touched file passes. Warnings never fail. React Doctor needs the merge base
// of <ref> and HEAD in the clone; without one it would quietly report every finding in the changed files instead,
// so a report that is not a baseline comparison fails (exit 2). Exit 2 also when React Doctor gave no report.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { doctorArgv } from "./react_doctor.mjs";

const FRONTEND = join(import.meta.dirname, "..");
const BIN = join(FRONTEND, "node_modules", "react-doctor", "bin", "react-doctor.js");


/** One scan's JSON report; exits 2 when React Doctor wrote none. */
function scan(extra) {
  const dir = mkdtempSync(join(tmpdir(), "react-doctor-"));
  const out = join(dir, "report.json");
  try {
    const run = spawnSync(process.execPath, [BIN, ...doctorArgv(["--no-color", ...extra, "--json", "--json-out", out, "."])], {
      encoding: "utf8",
      maxBuffer: 1 << 30,
    });
    try {
      return JSON.parse(readFileSync(out, "utf8"));
    } catch {
      console.error(`✘ React Doctor gave no report (exit ${run.status}):\n${run.stderr || run.stdout}`.slice(0, 4000));
      process.exit(2);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The error-level findings of a `--scope changed` report, one line each: `file:line plugin/rule  title`. */
export function newErrors(report) {
  if (!report.ok || report.mode !== "baseline") {
    const why = report.error == null ? "no merge base?" : typeof report.error === "string" ? report.error : JSON.stringify(report.error);
    throw new Error(`React Doctor did not compare with the base (mode "${report.mode}", ok ${report.ok}): ${why}`);
  }
  return report.diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => `${d.filePath}:${d.line} ${d.plugin}/${d.rule}  ${d.title}`)
    .sort();
}

/** The files whose findings differ between two scans' diagnostics, sorted. */
export function changedFiles(scanA, scanB) {
  const byFile = (diagnostics) => {
    const files = new Map();
    for (const d of diagnostics) {
      files.set(d.filePath, [...(files.get(d.filePath) ?? []), `${d.plugin}/${d.rule}@${d.line}:${d.column}:${d.severity}`]);
    }
    for (const keys of files.values()) keys.sort();
    return files;
  };
  const a = byFile(scanA);
  const b = byFile(scanB);
  const names = new Set([...a.keys(), ...b.keys()]);
  return [...names].filter((f) => (a.get(f) ?? []).join("\n") !== (b.get(f) ?? []).join("\n")).sort();
}

/** Two full scans with no cache must agree, or the per-file counts `--base` compares would fail at random. */
function twice() {
  const [first, second] = [scan(["--no-cache"]).diagnostics, scan(["--no-cache"]).diagnostics];
  const files = changedFiles(first, second);
  console.log(`scan 1: ${first.length} findings; scan 2: ${second.length} findings`);
  if (files.length) {
    for (const f of files) console.log(`    ${f}`);
    console.error(`✘ React Doctor gave different results on the same tree in ${files.length} file(s), named above.`);
    process.exit(1);
  }
  console.log("✓ 2 scans, one result");
}

function main() {
  const { values } = parseArgs({ options: { base: { type: "string" }, twice: { type: "boolean" } } });
  if (values.twice) return twice();
  if (!values.base) {
    console.error("usage: node scripts/react_doctor_new.mjs --base <ref> | --twice");
    process.exit(2);
  }
  let lines;
  try {
    lines = newErrors(scan(["--scope", "changed", "--base", values.base]));
  } catch (e) {
    console.error(`✘ ${e.message}`);
    process.exit(2);
  }
  for (const line of lines) console.log(line);
  if (lines.length) {
    console.error(`✘ ${lines.length} new error-level React Doctor finding(s) against ${values.base}. Fix each; \`yarn doctor why`);
    console.error("  <file>:<line>` explains one (through `yarn doctor`, so it keeps the privacy flags).");
    process.exit(1);
  }
  console.log(`✓ no new error-level React Doctor finding against ${values.base}`);
}

// Real paths: started through a symlink, argv[1] is the link's spelling and import.meta.filename the target's.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) main();
