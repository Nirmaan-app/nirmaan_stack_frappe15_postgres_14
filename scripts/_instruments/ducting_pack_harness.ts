// DU-3 (R1 the 90% rule + R9): the panel's sheet-level notes (`sheetHeadingNotes`: the insulation note, the valve-rows note) are exported
// with every row, and each Ducting row carries the sheet's insulation summary (counted rows + sq.m, insulated duct sq.m, excluded rows and
// why) for the AllRows "Insulation 90%" tab; "dropped" is read off R1's covered sentence; no "left for a person" outcome remains.
//
// DU-2 PACK1 THE DUCTING THREE-LAYER PACK HARNESS = valve_pack_harness.ts (VP-4) + ONE feed step for Ducting's SHEET-LEVEL insulation rule
// (DR7 / G-3, `sheet_insulation`): the calculator has no sheet ("Never in the calculator", boq-rate-master.md Ducting), so where the
// PANEL dropped a duct's Insulation line because the sheet quotes duct insulation on its own rows, the calculator is fed what the panel
// priced -- the duct with Insulated "No" and no insulation section; where the panel LEFT the insulation for a person (G-3 between the
// limits / quantities missing on a doubtful sheet) the row is classed "SHEET RULE" (no calculator can take that decision), never a
// figure difference. Everything else is the valve harness byte for byte.
//
// VP-4 PACK1 THE THREE-LAYER PACK HARNESS (panel + calculator + diff) for a list of valve rows. Read-only: it reads a page fetch
// ($VPK_DIR, written by the read-only fetch in valve_library.py rebuild-pack) and the assets, and writes one jsonl. No model call.
//
//   PANEL       the page's own context, built EXACTLY as SheetPricingPage builds the open panel's context
//               ({ ...buildRowContext(row, rateKinds, cats.get(er), rows, cats), unit: row.unit ?? "" }), then the panel's helper
//               makePricingSheetHelper({ configsByCategory, items, extractionByRow: buildExtractionByRow(run.results) }).compute(ctx).
//   CALCULATOR  PricingCalculator's own pricing path: makePricingSheetHelper over calculatorConfigMap(configs, "HVAC") with an EMPTY
//               extraction map, compute(calculatorCtx("HVAC", category), overrides). The overrides are the SAME resolved fields the panel
//               shows (family, item, size, choice attributes, scope, unit, qty per row unit), built by the product's parity feed
//               `feedFromPanel` (calculatorPanelParity.harness.ts, mode "full"), compared by its strict `compareResults`.
//
// Env: VPK_DIR (sheets.json + <n>.json), VPK_KEYS (one "BOQ|sheet|row" per line), VPK_ASSET (asset paths, comma), VPK_OUT (jsonl path).
import { readFileSync, writeFileSync } from "node:fs";
import { makePricingSheetHelper, buildExtractionByRow, sheetInsulationOf as sheetInsulationSummary } from "../../frontend/src/pages/boq-wizard/rate-helper/pricingSheetHelper";
import { itemListPricingSpec } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
import { buildRowContext, rateKindsOf } from "../../frontend/src/pages/boq-wizard/rate-helper/rateSuggestionModel";
import { isRateDescriptor } from "../../frontend/src/pages/boq-wizard/PricingGrid";
import { resolvedToSheetCategoryRow } from "../../frontend/src/pages/boq-wizard/sheetCategoryResolve";
import { mergeItemsByName } from "../../frontend/src/pages/boq-wizard/rate-helper/rateHelperPlumbing";
import { calculatorConfigMap, calculatorCtx } from "../../frontend/src/pages/pricing/PricingCalculator";
import { compareResults, feedFromPanel, itemFieldNotes } from "../../frontend/src/pages/pricing/calculatorPanelParity.harness";

const D = process.env.VPK_DIR!;
const keys = new Set(readFileSync(process.env.VPK_KEYS!, "utf8").split("\n").map((s) => s.replace(/\r$/, "")).filter(Boolean));
const configsByCategory = new Map<string, any>();
let allItems: object[] = [];
for (const p of (process.env.VPK_ASSET ?? "").split(",").filter(Boolean)) {
  const A = JSON.parse(readFileSync(p, "utf8"));
  for (const c of A.category_configs) configsByCategory.set(c.category_id, { ...c, discipline: A.discipline });
  allItems = allItems.concat(A.items.map((it: object) => ({ ...it, discipline: A.discipline })));
}
const items = mergeItemsByName(allItems as never);
const calc = makePricingSheetHelper({ configsByCategory: calculatorConfigMap(configsByCategory, "HVAC"), items, extractionByRow: new Map() } as never);

const fig = (f: any) => (f ? { supply: f.supply_rate ?? null, install: f.install_rate ?? null, total: f.combined_rate ?? null } : null);
const block = (b: any, section: string | null) => ({ section, family: b.family, familyRaw: b.familyRaw, state: b.state, reason: b.reason ?? null,
  sku: b.skuLine ?? null, qty: b.qty, figures: fig(b.figures), working: b.working ?? [],
  fields: (b.fields ?? []).map((f: any) => `${f.id}=${f.otherMode ? f.typedValue : f.value}`) });
function side(res: any) {
  const il = res?.itemList;
  return {
    kind: res?.kind ?? null, reason: res?.reason ?? il?.reason ?? null, rowPriced: il?.rowPriced ?? null, unit: il?.unit ?? null,
    unitClass: il?.unitClass ?? null, rateUnit: il?.rateUnit ?? null, unitNote: il?.unitNote ?? null, totals: fig(il?.totals ?? res?.values),
    values: res?.values ?? null, split: il?.split?.note ?? null, scope: il?.scope?.value ?? null,
    // VP-5: the scope answer's own note (E11 / QR-2 / VR9 wording) is what the panel shows under Scope -- the pack must show it too
    scopeNote: il?.scope?.note ?? null,
    items: [
      // DU-2: each item followed by the sections ATTACHED to it (a duct's Insulation line) -- reported, as the panel draws them
      ...(il?.items ?? []).flatMap((b: any) => [block(b, null), ...((b.sections ?? []) as any[]).flatMap((sv: any) => (sv.view?.items ?? []).map((x: any) => block(x, sv.sectionId)))]),
      // the sections that belong to no item (the Misc section: gauges, thermometers, test plugs, bellows) -- the panel draws them after
      // the items, with their own SKU, figures and lines
      ...((il?.sections?.independent ?? []) as any[]).flatMap((sv: any) => (sv.view?.items ?? []).map((b: any) => block(b, sv.sectionId))),
    ],
    notes: res && res.kind === "suggestion" ? itemFieldNotes(res) : [],
    // DU-3 R9: the sheet-level notes the panel draws in its amber box (the 90% insulation note, the valve-rows note)
    sheetNotes: il?.sheetHeadingNotes ?? [],
    workingLines: (res?.workings?.lines ?? res?.workings?.notes ?? []),
  };
}
/** The parity feed with every "Other..." field of every block replaced by the value the panel RESOLVED (f.value), the field taken
 *  out of the block's "other" list. Only fields in Other mode change; everything else is the product feed byte for byte. */
function resolvedFeed(panel: any, ov: Record<string, string>): { overrides: Record<string, string>; changed: string[] } {
  const raw = ov["__items__"];
  const view = panel?.itemList;
  if (!raw || !view) return { overrides: ov, changed: [] };
  const st = JSON.parse(raw);
  const changed: string[] = [];
  (st.items ?? []).forEach((e: any, i: number) => {
    const b = view.items?.[i];
    if (!b || !Array.isArray(e.other)) return;
    for (const f of b.fields ?? []) {
      if (!f.otherMode || !e.other.includes(f.id) || f.value === "") continue;
      changed.push(`item ${i + 1} ${f.id}: "${f.typedValue}" -> "${f.value}"`);
      e.attrs = { ...(e.attrs ?? {}), [f.id]: f.value };
      e.other = e.other.filter((x: string) => x !== f.id);
    }
    if (!e.other.length) delete e.other;
  });
  // DU-3: the same for each item's ATTACHED sections (a duct's insulation thickness typed "9 mm thick" -> the 9 the panel resolved) --
  // the pricer reads the resolved size off the panel and types it; before, only the item's own fields were resolved (DU-2 "harness feed")
  (st.items ?? []).forEach((e: any, i: number) => {
    const b = view.items?.[i];
    for (const [sid, se] of Object.entries<any>(e.sections ?? {})) {
      const sv = (b?.sections ?? []).find((x: any) => x.sectionId === sid);
      const sb = sv?.view?.items?.[0];
      if (!sb || !Array.isArray(se?.other)) continue;
      for (const f of sb.fields ?? []) {
        if (!f.otherMode || !se.other.includes(f.id) || f.value === "") continue;
        changed.push(`item ${i + 1} ${sid} ${f.id}: "${f.typedValue}" -> "${f.value}"`);
        se.attrs = { ...(se.attrs ?? {}), [f.id]: f.value };
        se.other = se.other.filter((x: string) => x !== f.id);
      }
      if (!se.other.length) delete se.other;
    }
  });
  return { overrides: { ...ov, ["__items__"]: JSON.stringify(st) }, changed };
}
/** DU-2: which sheet-level insulation decision (DR7 / G-3) the panel's view shows: "dropped" (not priced in this row), "person" (left for a
 *  person), or null. Read off the panel's own sentences (the config's `sheet_insulation.lines`). */
function sheetInsulationOf(panel: any): "dropped" | null {
  const t = JSON.stringify(panel?.itemList?.sheetHeadingNotes ?? []);
  // DU-3 R1: the covered sentence ("Insulation is priced separately in row(s) ... - not included in this row")
  if (/Insulation is priced separately in rows? [^"]*- not included in this row/.test(t)) return "dropped";
  return null;
}
/** DU-2: a value the panel holds in a `dropdown_or_other` box that its list does not offer (a 350 mm diameter beside 80-300) goes to the
 *  calculator the way a pricer enters it -- typed through "Other..." -- never as a pick the list cannot hold */
function typedOutsideList(panel: any, r: { overrides: Record<string, string>; changed: string[] }): { overrides: Record<string, string>; changed: string[] } {
  const raw = r.overrides["__items__"];
  const view = panel?.itemList;
  if (!raw || !view) return r;
  const st = JSON.parse(raw);
  const changed = [...r.changed];
  (st.items ?? []).forEach((e: any, i: number) => {
    const b = view.items?.[i];
    if (!b) return;
    for (const f of b.fields ?? []) {
      if (!f.allowOther || !Array.isArray(f.options) || !f.options.length) continue;
      const v = e.attrs?.[f.id];
      if (v === undefined || v === null || v === "" || f.options.includes(String(v))) continue;
      const other = Array.isArray(e.other) ? e.other : [];
      if (other.includes(f.id)) continue;
      e.other = [...other, f.id];
      changed.push(`item ${i + 1} ${f.id}: "${v}" typed through Other... (not in the box's list)`);
    }
  });
  return { overrides: { ...r.overrides, ["__items__"]: JSON.stringify(st) }, changed };
}
/** the feed with every duct item's Insulated set to "No" and its insulation section removed */
function withoutInsulation(ov: Record<string, string>): Record<string, string> {
  const raw = ov["__items__"];
  if (!raw) return ov;
  const st = JSON.parse(raw);
  for (const e of st.items ?? []) {
    e.attrs = { ...(e.attrs ?? {}), insulated: "No" };
    if (e.sections && e.sections.insulation) { const { insulation, ...rest } = e.sections; void insulation; e.sections = rest; }
  }
  return { ...ov, ["__items__"]: JSON.stringify(st) };
}
const FIGURE_WHAT = new Set(["values", "finalValues", "item totals", "blocks"]);
function diffClass(divs: any[], p: any, c: any): { cls: string; why: string } {
  if (!divs.length) return { cls: "EQUAL", why: "" };
  const kindOrPriced = divs.find((d) => d.what === "kind" || d.what === "item rowPriced");
  if (kindOrPriced) return { cls: "ONE-SIDED REFUSAL", why: `${kindOrPriced.what}: panel ${kindOrPriced.panel} / calculator ${kindOrPriced.calculator}` };
  // FIGURES only: the row totals and every PRICED block's family / figures / qty (a blank block drawn on one side only is wording)
  const figs = (x: any) => JSON.stringify([x.totals, x.items.filter((b: any) => b.state === "priced").map((b: any) => [b.family, b.figures, b.qty])]);
  const pf = figs(p), cf = figs(c);
  if (pf !== cf || divs.some((d) => FIGURE_WHAT.has(d.what) && d.what !== "blocks" && d.what !== "item blocks")) {
    return { cls: "FIGURE", why: divs.map((d) => d.what).join(", ") };
  }
  return { cls: "WORDING", why: divs.map((d) => d.what).join(", ") };
}

const idx = JSON.parse(readFileSync(`${D}/sheets.json`, "utf8"));
const out: string[] = [];
let n = 0;
for (const sh of idx) {
  if (sh.error) continue;
  const pg = JSON.parse(readFileSync(`${D}/${sh.n}.json`, "utf8"));
  const msg = pg.priced;
  const rows = msg.rows ?? [];
  const cats = new Map<number, ReturnType<typeof resolvedToSheetCategoryRow>>();
  for (const c of pg.cats?.categories ?? []) cats.set(c.excel_row, resolvedToSheetCategoryRow(c));
  const run = pg.run?.run ?? null;
  const adopted = !!run && String(run.committed_version) === String(msg.commit_version);
  const results = adopted ? (typeof run.results === "string" ? JSON.parse(run.results) : run.results ?? []) : [];
  const helper = makePricingSheetHelper({ configsByCategory, items, extractionByRow: buildExtractionByRow(results) } as never);
  const rateKinds = rateKindsOf((msg.column_descriptors ?? []).filter(isRateDescriptor));
  for (const row of rows) {
    const er = row.source_row_number;
    const key = `${sh.boq}|${sh.sheet}|${er}`;
    if (!keys.has(key)) continue;
    n++;
    const ctx: any = { ...buildRowContext(row, rateKinds, cats.get(er), rows, cats), unit: row.unit ?? "" };
    const ext = results.find((x: { excel_row: number }) => x.excel_row === er) ?? null;
    let panel: any, calcRes: any = null, typedRes: any = null, feed: any = null, resolved: any = null, divs: any[] = [], typedDivs: any[] = [], err: string | null = null;
    try { panel = helper.compute(ctx, {}); } catch (e) { panel = { kind: "error" }; err = "panel: " + String((e as Error)?.stack ?? e); }
    const cat = ctx.category ?? ext?.category_id ?? null;
    const caseLike = {
      cat, unit: ctx.unit, desc: ctx.description ?? "", attrs: {},
      items: (ext?.items ?? []).map((it: any) => Object.fromEntries(Object.entries(it.attributes ?? {}).map(([k, v]: [string, any]) => [k, v?.value ?? null]))),
      headings: ctx.headings, ownNotes: ctx.ownNotes, headingNotes: ctx.headingNotes, ancestorNotes: ctx.ancestorNotes,
      qty: typeof ctx.quantity === "number" ? ctx.quantity : (typeof row.qty_total === "number" ? row.qty_total : null),
    };
    if (!err && cat) {
      try {
        // AS TYPED: the product's parity feed (an "Other..." field carries what was ENTERED, e.g. the model's "32 mm NB")
        feed = feedFromPanel(panel, configsByCategory.get(cat) ?? null, caseLike as never, "full");
        typedRes = calc.compute(calculatorCtx("HVAC", cat) as never, feed.overrides);
        typedDivs = compareResults(panel, typedRes);
        // RESOLVED (the brief's PACK1 (v): "fed the SAME resolved fields the panel used"): every "Other..." field carries the value
        // the panel RESOLVED (f.value) and leaves the "Other..." box -- the size a pricer reads off the panel and types in
        resolved = resolvedFeed(panel, feed.overrides);
        // DU-2: the sheet-level insulation decision the panel took, fed to the calculator as the pricer would type it
        resolved = typedOutsideList(panel, resolved);
        const sheetIns = sheetInsulationOf(panel);
        if (sheetIns === "dropped") resolved = { ...resolved, overrides: withoutInsulation(resolved.overrides), changed: [...resolved.changed, "sheet rule DR7: insulation not priced in this row -> Insulated No"] };
        calcRes = calc.compute(calculatorCtx("HVAC", cat) as never, resolved.overrides);
        divs = compareResults(panel, calcRes);
      } catch (e) { err = "calculator: " + String((e as Error)?.stack ?? e); }
    }
    const p = side(panel), c = side(calcRes), t = side(typedRes);
    let dc = err ? { cls: "ERROR", why: err.slice(0, 300) } : diffClass(divs, p, c);
    // DU-3: the sheet's duct-insulation summary (R1 / R2) for a Ducting row whose config carries the R1 shape
    let sheetIns: any = null;
    try {
      const cfgD = configsByCategory.get(cat ?? "");
      const spD = cfgD ? itemListPricingSpec(cfgD as never) : null;
      const siD = spD?.sheet_insulation;
      if (siD && typeof siD.threshold_input === "string" && ctx.sheetLines) {
        sheetIns = sheetInsulationSummary(siD, spD!, ctx, undefined, buildExtractionByRow(results), cat);
      }
    } catch (e) { sheetIns = { error: String(e) }; }
    const dt = err ? { cls: "ERROR", why: "" } : diffClass(typedDivs, p, t);
    out.push(JSON.stringify({ key, boq: sh.boq, sheet: sh.sheet, excel_row: er, node_id: row.name, node_type: row.node_type,
      description: row.description ?? "", unit: row.unit ?? "", qty: row.qty_total ?? null, category: cat, run_id: adopted ? run.run_id : null,
      ext_items: ext?.items ?? null, panel: p, calculator: c, feed: feed ? { overrides: feed.overrides, hiddenFacts: feed.hiddenFacts, unitFeed: feed.unitFeed ?? null } : null,
      resolved_fields: resolved?.changed ?? [], divergences: divs, diff: dc.cls, diff_why: dc.why, sheet_insulation: sheetIns,
      calculator_as_typed: { result: t, diff: dt.cls, diff_why: dt.why, divergences: typedDivs }, error: err }));
  }
}
writeFileSync(process.env.VPK_OUT!, out.join("\n") + "\n");
console.log(`ducting pack harness: sheets ${idx.length}, rows ${n} of ${keys.size}`);
