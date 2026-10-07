// SLICE 12d-3 -- THE INSULATION AUDIT, STAGE 4-5: every audited row priced through BOTH REAL PATHS.
//
// Reads the rows `audit12d3_build_rows.py` captured (payload, the model's stored items, unit, headings) and
// runs each through the 12c-P parity driver (`runParity`): the PANEL path (`makePricingSheetHelper` over the
// stored extraction row -- the branch `SheetPricingPage` reaches) and the CALCULATOR path (`PricingCalculator`'s
// construction fed what the panel shows). Records, per row and per path: priced / refused + reason, the figures,
// every block (family, defaulted family, each field's value / typed / defaulted / rule / note / blank, the SKU
// line, the working lines, the figures), the divergences and their classified cause. No AI call, no DB write.
//
// Usage: node <bundle> <audit_rows.json> <asset.json> <out.json>
// Bundle (container, from frontend/): node_modules/.bin/esbuild ../scripts/_instruments/audit12d3_pricing.ts
//   --bundle --platform=node --format=cjs --jsx=automatic --alias:@=./src --loader:.css=empty --outfile=/tmp/a12d3/audit_pricing.cjs
import * as fs from "fs";
import type { RateCategoryConfig, RateMasterItem } from "../../frontend/src/pages/pricing/rate-master/rateMasterTypes";
import { isSuggestion } from "../../frontend/src/pages/boq-wizard/rate-helper/rateHelperTypes";
import type { ItemListSuggestion, ItemListView } from "../../frontend/src/pages/boq-wizard/rate-helper/pricingSheetHelper";
import { classifyDivergence, runParity, type ParityCase, type ParityRun } from "../../frontend/src/pages/pricing/calculatorPanelParity.harness";

const [rowsPath, assetPath, outPath] = process.argv.slice(2);
const ROWS = JSON.parse(fs.readFileSync(rowsPath, "utf-8")) as any[];
const ASSET = JSON.parse(fs.readFileSync(assetPath, "utf-8")) as { discipline: string; items: any[]; category_configs: RateCategoryConfig[] };
const CAT = "hvac_insulation";
const CFG = ASSET.category_configs.find((c) => c.category_id === CAT)!;
const CONFIGS = new Map([[CAT, CFG]]);
// the served-items shape (`get_rate_master_items`): discipline on every item; stored rates byte-for-byte
const ITEMS: RateMasterItem[] = ASSET.items.map((it: any) => ({
  item_uid: it.item_uid, discipline: ASSET.discipline, kind: it.kind, brand: it.brand ?? undefined, unit: it.unit,
  attributes: { ...it.attributes }, rates: { ...it.rates },
}));

function caseOf(r: any): ParityCase {
  return {
    cat: CAT, unit: r.unit ?? "", desc: r.description, attrs: {}, headings: r.headings ?? [],
    items: (r.answer?.items ?? []).map((it: any) => Object.fromEntries(Object.entries(it.attributes ?? {}).map(([k, v]: any) => [k, v?.value ?? null]))),
  };
}
function viewOf(res: any): ItemListView | null {
  if (!isSuggestion(res)) return null;
  return (res as ItemListSuggestion).itemList ?? null;
}
function pathRecord(res: any) {
  const v = viewOf(res);
  if (!v) return { declined: true, reason: (res as any)?.reason ?? JSON.stringify(res).slice(0, 300) };
  return {
    declined: false, rowPriced: v.rowPriced, reason: v.reason ?? null, unit: v.unit, unitClass: v.unitClass, unitNote: v.unitNote ?? null, rateUnit: v.rateUnit ?? null,
    totals: v.totals ?? null, modelCount: v.modelCount,
    items: v.items.map((b) => ({
      index: b.index, source: b.source, family: b.family, familyRaw: b.familyRaw, familyDefaulted: b.familyDefaulted ?? null,
      state: b.state, reason: b.reason ?? null, skuLine: b.skuLine ?? null, working: b.working, figures: b.figures, qty: b.qty, qtyDefaulted: b.qtyDefaulted,
      readOnly: b.readOnly,
      fields: b.fields.map((f) => ({ id: f.id, label: (f as any).label, value: f.value, typedValue: f.typedValue, defaulted: f.defaulted, rule: f.rule ?? null, note: f.note ?? null, blank: f.blank, otherMode: f.otherMode })),
    })),
  };
}

const out: any[] = [];
let errors = 0;
for (const r of ROWS) {
  if (!r.answer) { out.push({ id: r.id, skipped: "no stored items (row not answered / run failed)" }); continue; }
  try {
    const c = caseOf(r);
    const run: ParityRun = runParity(CONFIGS, ITEMS, c, "full");
    out.push({
      id: r.id, boq: r.boq, sheet: r.sheet, excel_row: r.excel_row, unit: c.unit,
      panel: pathRecord(run.panel), calculator: pathRecord(run.calculator),
      divergences: run.divergences, divergence_cause: run.divergences.length ? classifyDivergence(run, c) : null,
      feed_overrides: Object.keys(run.feed.overrides ?? {}).length,
    });
  } catch (e: any) {
    errors += 1;
    out.push({ id: r.id, error: String(e?.stack ?? e).slice(0, 800) });
  }
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
const priced = out.filter((o) => o.panel && !o.panel.declined && o.panel.rowPriced).length;
const diverged = out.filter((o) => o.divergences && o.divergences.length).length;
console.log("rows " + out.length + "; panel priced " + priced + "; refused " + (out.length - priced - errors) + "; rows with a divergence " + diverged + "; errors " + errors);
