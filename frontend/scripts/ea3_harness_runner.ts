/**
 * EA-3 Leg 1 -- the truthfulness harness runner (breadth, zero tolerance).
 *
 * A one-off, REUSABLE (EA-4) cert runner. It imports the REAL, UNMODIFIED
 * `ratePipelineInterpreter` from source and runs every harness case over the
 * category configs + master items DUMPED FROM THE LIVE DB, diffing each expected
 * output:
 *   - numeric expect  -> equal within EPSILON (1e-9): FLOAT-REPRESENTATION-TIGHT,
 *     the rupee is exact. Precedent: EA-3 case m10 misc_bcs = 234 * 0.8, which has
 *     no exact IEEE-754 double (JS and Python both yield 187.20000000000002 for the
 *     decimal-exact 187.2; abs-diff 2.84e-14). Owner ruling 2026-07-30 (Option A):
 *     the interpreter and config are correct; the comparison is 1e-9, documented.
 *     Future harnesses inherit this comparison + this line.
 *   - null expect (pipeline-level) -> that pipeline MUST honestly no-compute;
 *   - null expect (output-level)   -> that output MUST be absent (honest-partial);
 *   - a pipeline named in expect but missing from the config (or vice-versa) -> mismatch.
 * A case whose expect carries only `_note` (the wiring w1-w10 -- covered by the
 * dual-render leg + the standing goldens) is recorded as note-only, not compared.
 *
 * This script does NOT ship in the app bundle and is NOT a vitest test file
 * (it lives outside `src/**`, so the default `vitest run` never discovers it).
 * Run it with node's type-stripping (the interpreter has only a type import):
 *
 *   node --experimental-strip-types frontend/scripts/ea3_harness_runner.ts \
 *        <db_dump.json> <harness_expected.json>
 *
 * Paths default to `ea3_db_dump.json` / `ea3_harness_expected.json` beside this
 * script. Exit code 1 (+ printed deltas) on ANY mismatch; 0 when every compared
 * case passes.
 */
import { runPipeline } from "../src/pages/pricing/rate-master/ratePipelineInterpreter.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dumpPath = process.argv[2] ?? join(here, "ea3_db_dump.json");
const harnessPath = process.argv[3] ?? join(here, "ea3_harness_expected.json");

const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as {
  configs: Record<string, any>;
  items: any[];
};
const harness = JSON.parse(readFileSync(harnessPath, "utf8")) as {
  tolerance: number;
  cases: Record<string, Array<{ id: string; attrs: Record<string, string | number>; expect: any }>>;
};

const { configs, items } = dump;
// EPSILON: float-representation-tight comparison. The rupee is exact; this only absorbs IEEE-754 dust
// (e.g. 234 * 0.8 = 187.20000000000002). Owner ruling EA-3 2026-07-30 (Option A). NOT a business tolerance.
const EPSILON = 1e-9;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const absent = (v: unknown) => v === undefined || v === null || (typeof v === "number" && !Number.isFinite(v));

type Mismatch = {
  category: string; id: string; pipeline?: string; key?: string;
  expected: unknown; got: unknown; absDiff?: number; reason?: string;
};
const mismatches: Mismatch[] = [];
const perCat: Record<string, { total: number; compared: number; pass: number; noteOnly: number }> = {};
let comparedTotal = 0, passTotal = 0, casesTotal = 0;

for (const [category, list] of Object.entries(harness.cases)) {
  const config = configs[category];
  const stat = { total: list.length, compared: 0, pass: 0, noteOnly: 0 };
  for (const c of list) {
    casesTotal++;
    const expect = c.expect ?? {};
    const pipelineKeys = Object.keys(expect).filter((k) => k !== "_note");
    if (pipelineKeys.length === 0) { stat.noteOnly++; continue; } // wiring note-only
    stat.compared++; comparedTotal++;
    let ok = true;
    const fail = (m: Omit<Mismatch, "category" | "id">) => { mismatches.push({ category, id: c.id, ...m }); ok = false; };

    if (!config) { fail({ expected: "config present", got: "missing", reason: "no active config for category" }); }
    else {
      for (const pid of pipelineKeys) {
        const exp = expect[pid];
        const pipeline = config.pipelines?.[pid];
        if (!pipeline) { fail({ pipeline: pid, expected: "pipeline in config", got: "missing", reason: "expect names a pipeline the config lacks" }); continue; }
        const res = runPipeline(pid, pipeline, items as any, c.attrs);
        if (exp === null) {
          const computed = res.status === "ok" && Object.values(res.finals).some(isNum);
          if (computed) fail({ pipeline: pid, expected: "no-compute", got: JSON.stringify(res.finals) });
        } else {
          for (const [k, ev] of Object.entries(exp as Record<string, number | null>)) {
            const gv = res.finals?.[k];
            if (ev === null) {
              if (isNum(gv)) fail({ pipeline: pid, key: k, expected: "absent", got: gv });
            } else if (absent(gv)) {
              fail({ pipeline: pid, key: k, expected: ev, got: gv });
            } else if (Math.abs((gv as number) - ev) >= EPSILON) {
              fail({ pipeline: pid, key: k, expected: ev, got: gv, absDiff: Math.abs((gv as number) - ev) });
            }
          }
        }
      }
    }
    if (ok) { stat.pass++; passTotal++; }
  }
  perCat[category] = stat;
}

console.log("========== EA-3 LEG 1 -- HARNESS (float-representation-tight, eps 1e-9) ==========");
console.log(`compare=abs-diff<${EPSILON} (the rupee is exact; absorbs IEEE-754 dust only -- owner ruling 2026-07-30)`);
console.log(`dump=${dumpPath.split(/[/\\]/).pop()}  configs=${Object.keys(configs).length}  items=${items.length}`);
console.log("per-category (pass/compared, note-only):");
for (const [cat, r] of Object.entries(perCat)) {
  const flag = r.pass === r.compared ? "PASS" : "FAIL";
  console.log(`  ${flag}  ${cat.padEnd(22)} ${r.pass}/${r.compared}   (note-only ${r.noteOnly}, total ${r.total})`);
}
console.log(`TOTAL compared: ${passTotal}/${comparedTotal} pass   (all cases ${casesTotal})`);
if (mismatches.length) {
  console.log(`\nMISMATCHES (${mismatches.length}) -- LEG 1 FAILS:`);
  for (const m of mismatches) console.log("  " + JSON.stringify(m));
  process.exitCode = 1;
} else {
  console.log("\nRESULT: ALL COMPARED CASES PASS -- zero mismatches. LEG 1 GREEN.");
}
