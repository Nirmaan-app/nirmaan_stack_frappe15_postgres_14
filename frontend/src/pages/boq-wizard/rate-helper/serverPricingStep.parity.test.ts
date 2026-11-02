/**
 * DEV2-B2 PARITY 1 (owner G2 option A) -- THE SERVER PRICING STEP = THE BROWSER'S PRICING SOURCE. THE STANDING CHECK.
 *
 * Owner G2: the pricing rules' output used by historical matching is computed on the server by the SAME functions from the
 * SAME source files the browser uses, built from source on every deploy, and "ONE automatic parity check (browser path vs
 * server step identical) runs in every slice touching a pricing file". This is that check. It runs:
 *   - the SOURCE: `priceRowsForMatching` imported from source, with `runPipeline` / `priceItemList` recorded at the module
 *     boundary (the calls `compute` makes go through those imports), and
 *   - the BUILT bundle: `scripts/build_pricing_step.mjs` builds it into a temp folder (exactly the deploy's build), and it
 *     runs under `node` as a child process, rows in on stdin, results out on stdout -- as `pricing_step.py` runs it,
 * on the same rows and the same catalogue, and asserts IDENTICAL output for every row: the signature record (SKU lines,
 * values after the rules, every final field value with its rule, blanks) and the replay's own record.
 *
 * ROWS: every distinct input class of the committed calculator=panel corpus (`pricing/__fixtures__/parityCorpus.json`,
 * 96 stored runs, 15 categories) plus one all-blank refusal row for every category the latest assets configure, so every
 * helper-1 category is present. CATALOGUE: the LATEST Electrical and HVAC assets on disk (`latestAsset`, as
 * servedVsStoredPricing.test.ts reads them), so the check moves with every mint -- it is in the asset-pin search's list.
 * Coverage is ASSERTED, not described: a default, a ladder-up and a substitution must each occur in the rows.
 *
 * VACUITY: point PRICING_STEP_BUNDLE at a copy of the built bundle with one line broken and this file goes red.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { priceRowsForMatching } from "./serverPricingStep";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";

vi.mock("@/pages/pricing/rate-master/ratePipelineInterpreter", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/pages/pricing/rate-master/ratePipelineInterpreter")>();
  const runPipeline = (...a: Parameters<typeof m.runPipeline>) => {
    const r = m.runPipeline(...a);
    const g = globalThis as unknown as { __pl?: unknown[]; __il?: unknown[] };
    if (g.__pl) g.__pl.push(r);
    return r;
  };
  return { ...m, runPipeline };
});
vi.mock("./itemListPricing", async (importOriginal) => {
  const m = await importOriginal<typeof import("./itemListPricing")>();
  const priceItemList = (...a: Parameters<typeof m.priceItemList>) => {
    const r = m.priceItemList(...a);
    const g = globalThis as unknown as { __pl?: unknown[]; __il?: unknown[] };
    if (g.__il) g.__il.push(r);
    return r;
  };
  return { ...m, priceItemList };
});

const FRONTEND = fileURLToPath(new URL("../../../../", import.meta.url));
const DATA_DIR = fileURLToPath(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../../pricing/__fixtures__/", import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
function latestAsset(prefix: string): Json {
  const files = readdirSync(DATA_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
  const n = (f: string) => Number(f.slice(prefix.length, -".json".length));
  const name = files.sort((a, b) => n(a) - n(b))[files.length - 1];
  return readJsonFixture<Json>(pathToFileURL(join(DATA_DIR, name)));
}
const ELEC = latestAsset("rate_master_electrical_all_v");
const HVAC = latestAsset("rate_master_hvac_all_v");
const configs: Record<string, Json> = {};
const discOf: Record<string, string> = {};
for (const a of [ELEC, HVAC]) for (const c of a.category_configs) { configs[c.category_id] = c; discOf[c.category_id] = a.discipline; }
const itemsByDiscipline: Record<string, Json[]> = {};
for (const a of [ELEC, HVAC]) itemsByDiscipline[a.discipline] = a.items.map((it: Json) => ({ ...it, discipline: a.discipline }));

const corpus = readJsonFixture<Json>(pathToFileURL(join(FIXTURES, "parityCorpus.json")));
const toCells = (attrs: Record<string, unknown>) => Object.fromEntries(Object.entries(attrs ?? {}).map(([k, v]) => [k, { value: v, confidence: 1 }]));
const rows: Json[] = [];
corpus.classes.forEach((cl: Json, i: number) => {
  const c = cl.case;
  rows.push({ boq: "PARITY", sheet_name: "corpus", excel_row: i + 1, description: c.desc, unit: c.unit, headings: c.headings ?? [], discipline: discOf[c.cat] ?? null,
    resolved_category: c.cat, category_id: c.cat, attributes: toCells(c.attrs), items: c.items ? c.items.map((a: Json) => ({ attributes: toCells(a) })) : undefined });
});
Object.keys(configs).sort().forEach((cat, i) => {
  rows.push({ boq: "PARITY", sheet_name: "blank", excel_row: i + 1, description: "", unit: "", headings: [], discipline: discOf[cat], resolved_category: cat, category_id: cat, attributes: {} });
});
const input = { configs, itemsByDiscipline, pageRows: {}, rows, full: true };

function runSource(): Json[] {
  const g = globalThis as unknown as { __pricingStepRecording?: boolean; __pl?: unknown[]; __il?: unknown[] };
  g.__pricingStepRecording = true;
  try {
    return priceRowsForMatching(input).rows;
  } finally {
    delete g.__pricingStepRecording; delete g.__pl; delete g.__il;
  }
}

function runBundle(): Json[] {
  let bundle = process.env.PRICING_STEP_BUNDLE;
  if (!bundle) {
    const out = mkdtempSync(join(tmpdir(), "pricing-step-"));
    const b = spawnSync(process.execPath, ["scripts/build_pricing_step.mjs", "--out", out], { cwd: FRONTEND, encoding: "utf-8" });
    expect(b.status, `the build failed: ${b.stderr}`).toBe(0);
    bundle = join(out, "pricing_step.mjs");
  }
  const p = spawnSync(process.execPath, [bundle], { input: JSON.stringify(input), maxBuffer: 1 << 30 });
  // the bundle's stdout is read back through the corpus's own JSON reader (a file, like every other fixture here)
  const file = join(mkdtempSync(join(tmpdir(), "pricing-step-out-")), "out.json");
  writeFileSync(file, p.stdout.length ? p.stdout : "null");
  const out = readJsonFixture<Json>(pathToFileURL(file));
  expect(out?.ok, `the bundle failed: ${out?.error ?? p.stderr.toString("utf-8").slice(-500)}`).toBe(true);
  expect(p.status).toBe(0);
  return out.rows;
}

describe("DEV2-B2 Parity 1: the built server pricing step = the browser's pricing source", () => {
  it("prices every corpus class and every configured category identically on both paths", () => {
    const src = runSource();
    const built = runBundle();
    expect(src.length).toBe(rows.length);
    expect(built.length).toBe(rows.length);
    const differ = src.filter((r, i) => JSON.stringify(r) !== JSON.stringify(built[i])).map((r) => r.key);
    expect(differ).toEqual([]);
    // the coverage the check claims, asserted
    const cats = new Set(src.map((r) => r.rec.cat));
    expect([...Object.keys(configs)].filter((c) => !cats.has(c))).toEqual([]);
    const rules = new Set(src.flatMap((r) => (r.rec.finals ?? []).map((f: Json) => f.rule)));
    expect(rules.has("default")).toBe(true);
    expect(rules.has("ladder") || rules.has("size_up") || rules.has("rating_up")).toBe(true);
    expect(rules.has("substituted")).toBe(true);
    expect(src.filter((r) => r.rec.priced).length).toBeGreaterThan(1000);
  }, 600_000);

  it("refuses to run without a recorder (a signature with no SKU lines is never returned)", () => {
    expect(() => priceRowsForMatching(input)).toThrow(/no recorder/);
  });
});
