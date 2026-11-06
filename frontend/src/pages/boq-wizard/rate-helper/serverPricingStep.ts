/**
 * DEV2-B2 (owner G2 option A) -- THE SERVER PRICING STEP'S ENTRY. NO PRICING LOGIC LIVES HERE.
 *
 * Historical matching (services/boq_rate_match/) needs, for a pool row or a target row, the pricing rules' output:
 * the row's priced SIGNATURE (which SKU lines the pricer chose, with their quantities) and its VALUES AFTER THE
 * RULES. Owner G2 option A: that output is computed on the server by THE SAME functions, from THE SAME source files
 * the browser uses -- no copy, no port, no committed snapshot. So this file only
 *   1. re-exports the existing pricing functions the step calls, and
 *   2. adds ONE thin function, `priceRowsForMatching`, that runs each row through the panel's own entry point
 *      (`makePricingSheetHelper(...).compute`, called exactly as the BoQ page and the tracked replay call it) and
 *      returns per row exactly what DEV2-S3's scratch instrument `s3_sig.ts` computed: the signature record and the
 *      replay's own record for the row.
 *
 * WHAT THE PRICER CHOSE is read from the calls the pricer itself makes to `runPipeline` and `priceItemList`. Those
 * calls are RECORDED, never changed: `frontend/scripts/build_pricing_step.mjs` renames the two function definitions in
 * the built bundle and appends wrappers that return the same object and push it to `globalThis.__pl` / `__il`
 * (DEV2-S3's `sig_bundle.sh` method); the parity vitest records the same calls at the module boundary. Without a
 * recorder the function REFUSES (it would otherwise return signatures with no SKU lines).
 *
 * The bundle is built from source on every deploy (the frontend `build` script runs the build script), runs under
 * `node` as a child process of `services/boq_rate_match/pricing_step.py`, and is proved equal to the source by
 * `serverPricingStep.parity.test.ts` (Parity 1). Every existing pricing file stays unchanged.
 *
 * A SECOND EXPORT, `measureDrivingFields` (owner answer 3 to DEV2-B2 Q4, option A): which of a category's fields DRIVE the
 * price, measured BY THE PRICER on the pool's own stored rows at every pool build -- DEV2-R2's h2_fields2.ts pass 1: blank
 * one read field (and, for fields never needed alone, pairs) and re-price, on EVERY stored row (no sample). THE RULE
 * (owner 2026-11-03 01:56 / 10:59, DEV2-B3 F2b rule (iii)): a field drives the price when blanking it CHANGES THE PRICE
 * (withheld, or priced at other values) on at least 10 % of the rows it was tested on AND on at least 5 rows -- or when
 * blanking it with another field withholds the price on as many. Matching's W1 compares the pricer's values for those
 * fields (match_index.readings_view). It is statistics ABOUT the pricer, computed through `compute`; no pricing logic and
 * no stored list.
 *
 * TYPES: the pricer's intermediate objects are read through the small `*Seen` shapes below -- only the fields this
 * function reads, each optional, values `unknown` where they are only copied out.
 */
import { makePricingSheetHelper, nonBcsPipelines } from "./pricingSheetHelper";
import { mergeItemsByName, RATE_MASTER_ITEM_DISCIPLINES } from "./rateHelperPlumbing";
import { rowHeadingNotes, rowOwnNotes } from "./rateSuggestionModel";
import { priceItemList } from "./itemListPricing";
import { runPipeline } from "@/pages/pricing/rate-master/ratePipelineInterpreter";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { PricedRow } from "../boqTypes";

export { makePricingSheetHelper, nonBcsPipelines, mergeItemsByName, RATE_MASTER_ITEM_DISCIPLINES, rowHeadingNotes, rowOwnNotes, priceItemList, runPipeline };

type Dict = Record<string, unknown>;
/** One row as the caller sends it: the replay dump's row record (the stored helper-1 readings in `attributes` / `items`). */
export interface PricingStepRow {
  boq: string; sheet_name: string; excel_row: number; description?: string; unit?: string | null; headings?: string[];
  discipline?: string | null; resolved_category?: string | null; category_id?: string | null;
  attributes?: Dict; items?: Array<{ attributes?: Dict }> | null;
}
export interface PricingStepInput {
  configs?: Record<string, RateCategoryConfig>;
  itemsByDiscipline?: Record<string, RateMasterItem[]>;
  itemSets?: RateMasterItem[][];
  pageRows?: Record<string, PricedRow[]>;
  rows?: PricingStepRow[];
  full?: boolean;
}
export interface PricingStepResult { key: string; rec: Dict; ac7: Dict }
interface ItemSeen { name?: string; item_uid?: string; kind?: string; unit?: string | null; attributes?: Dict }
interface PipelineSeen { pipelineId: string; status?: string; matchedItem?: ItemSeen | null; steps?: Array<{ refItem?: string; produced?: unknown; qty?: number }> }
interface ListItemSeen {
  family?: string | null; familyRaw?: string | null; state?: string; qty?: number; qtyDefaulted?: boolean;
  sku?: { item_uid?: string; item_name?: string; item_detail?: string; unit?: string } | null;
  defaulted?: Array<{ attr?: string; id?: string }>; ladderHops?: Array<{ attr?: string; axis?: string }>;
  overrides?: Array<{ attr: string }>; textMapped?: Array<{ attr: string }>;
  readValues?: Dict; selection?: Dict; lengthRead?: { attr?: string } | null; filledReads?: Dict;
  familyDefaulted?: unknown; familyLine?: unknown; conversion?: { to?: unknown } | null; missing?: string[];
}
interface BlockFieldSeen { id: string; value?: unknown; typedValue?: unknown; otherMode?: unknown; note?: unknown; options?: unknown; optionLabels?: unknown; defaulted?: unknown }
interface BlockSeen { family?: unknown; state?: string; reason?: unknown; figures?: unknown; fields: BlockFieldSeen[]; working?: unknown; qty?: unknown; qtyDefaulted?: unknown; skuLine?: unknown }
interface ListViewSeen { rowPriced?: unknown; reason?: unknown; totals?: Dict | null; unitChoices?: unknown; unitNote?: unknown; unit?: unknown; items?: BlockSeen[] }
interface WorkingAttrSeen { id: string; value?: unknown; disabled?: boolean; defaulted?: boolean; substituted?: boolean; notes?: Array<{ kind?: string }> }
interface ResultSeen {
  kind?: string; reason?: unknown; error?: string; values?: Dict | null; basis?: unknown; derivation?: unknown;
  itemList?: ListViewSeen; workingsAttrs?: Array<{ id: string; value?: unknown; computed?: unknown; note?: unknown }>;
  workings?: { attributes?: WorkingAttrSeen[]; derivation?: string[]; matchedRows?: unknown; sections?: Array<{ label?: unknown; derivation?: unknown; figures?: unknown; matchedRows?: unknown }> };
}
interface RecorderGlobal { __pricingStepRecording?: boolean; __pl?: PipelineSeen[]; __il?: Array<{ items?: ListItemSeen[] }> }
interface AliasSeen { alias_of?: { category_id: string }; alias?: { category_id: string }; category_id?: string }

/**
 * Price rows for matching. `input`:
 *   configs            {category_id: config}, the active configs as `get_rate_category_config` serves them
 *   itemsByDiscipline  {discipline: items}, each as `get_rate_master_items` serves it; merged in the PAGE's order
 *                      (SheetPricingPage: Electrical first, then RATE_MASTER_ITEM_DISCIPLINES), or
 *   itemSets           explicit ordered item sets (the replay dump's grouping, used only to reproduce DEV2-S3)
 *   pageRows           {"<boq>|<sheet>": the sheet's committed rows as get_committed_rows serves them}
 *   rows               one record per row (PricingStepRow)
 *   full               also return the workings detail (DEV2-S3's FULL=1)
 * Returns {rows: [{key, rec, ac7}]} in input order. A row that throws is returned with kind "error", never dropped.
 */
export function priceRowsForMatching(input: PricingStepInput): { rows: PricingStepResult[] } {
  const g = globalThis as unknown as RecorderGlobal;
  if (!g.__pricingStepRecording) {
    throw new Error("priceRowsForMatching: no recorder on runPipeline / priceItemList (run the built bundle, or record them as the parity test does)");
  }
  const configsByCategory = new Map<string, RateCategoryConfig>(Object.entries(input.configs ?? {}));
  const byDisc = input.itemsByDiscipline ?? {};
  const sets: RateMasterItem[][] = input.itemSets ?? [byDisc["Electrical"] ?? [], ...RATE_MASTER_ITEM_DISCIPLINES.map((d) => byDisc[d] ?? [])];
  const items = mergeItemsByName(...sets);
  const byName = new Map<string | undefined, ItemSeen>(items.map((i) => [i.name, i as ItemSeen]));
  const PAGE_ROWS = input.pageRows ?? {};
  const FULL = !!input.full;
  const KINDS = ["supply_rate", "install_rate", "combined_rate"];
  const scopeOf = (v: Dict | null | undefined) => KINDS.filter((k) => typeof v?.[k] === "number");
  const NOTE_RULE = new Set(["size_up", "upgrade", "assumed", "rating_up", "plate_floor"]);
  // the SKU's name: the catalogue row's kind and its identifying attributes, as stored
  const itemLabel = (it: ItemSeen | undefined) => {
    const a = it?.attributes ?? {};
    const words = Object.entries(a).filter(([k, v]) => v !== null && v !== "" && k !== "remarks" && k !== "location").map(([, v]) => String(v)).join(" ");
    return `${it?.kind ?? ""}: ${words}`.slice(0, 160);
  };
  // on the attribute path the quantity per row unit lives in these fields (a run count, an item quantity), not on a SKU line
  const isQtyField = (id: string) => /(^|_)qty$/.test(id) || id === "runs";
  const out: PricingStepResult[] = [];
  for (const r of input.rows ?? []) {
    const cat = r.resolved_category || r.category_id;
    const pageRows = PAGE_ROWS[`${r.boq}|${r.sheet_name}`] ?? [];
    const pr = pageRows.find((x) => x.source_row_number === r.excel_row);
    const ext: Dict = { excelRow: r.excel_row, description: r.description, attributes: r.attributes ?? {} };
    if (Array.isArray(r.items)) ext.items = r.items;
    const helper = makePricingSheetHelper({ configsByCategory, items: items as never, extractionByRow: new Map([[r.excel_row, ext]]) } as never);
    g.__pl = []; g.__il = [];
    let res: ResultSeen;
    try {
      res = helper.compute({ excelRow: r.excel_row, description: r.description, nodeType: "Line Item", category: cat, discipline: r.discipline, rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: r.headings ?? [], ownNotes: pr ? rowOwnNotes(pr, pageRows) : [], headingNotes: pr ? rowHeadingNotes(pr, pageRows) : [], unit: r.unit ?? "" } as never, {}) as unknown as ResultSeen;
    } catch (e: unknown) {
      res = { kind: "error", error: String((e as { message?: unknown } | null)?.message ?? e) };
    }
    const il = res.itemList;
    const key = `${r.boq}|${r.sheet_name}|${r.excel_row}`;
    // THE REPLAY'S OWN RECORD, as ac7_harness.ts builds it
    const ac7: Dict = {
      key, cat, disc: r.discipline, kind: res.kind, reason: res.reason ?? null,
      values: res.values ?? null,
      list: il ? { rowPriced: il.rowPriced, reason: il.reason ?? null, totals: il.totals ?? null, unitChoices: il.unitChoices ?? null, unitNote: il.unitNote ?? null,
        items: (il.items ?? []).map((b) => ({ family: b.family, state: b.state, reason: b.reason ?? null, figures: b.figures,
          fields: b.fields.map((f) => ({ id: f.id, value: f.value, typed: f.typedValue, other: f.otherMode, note: f.note ?? null, options: f.options ?? null, labels: f.optionLabels ?? null, defaulted: !!f.defaulted })),
          working: b.working })) } : null,
      attrs: res.workingsAttrs ? res.workingsAttrs.map((a) => ({ id: a.id, value: a.value, computed: a.computed ?? null, note: a.note ?? null })) : null,
      derivation: res.derivation ?? null,
    };
    // THE SIGNATURE
    const rec: Dict = { key, cat, disc: r.discipline, kind: res.kind, reason: res.reason ?? null, values: res.values ?? null, unit: r.unit ?? "" };
    const skuLines: Array<{ line: unknown; uid: unknown; name: unknown; qty: unknown; unit?: unknown }> = [];
    const finals: Dict[] = [];   // every final field value, with the rule that set it
    const blanks: string[] = [];
    const raw: string[] = [];   // DEV2-R2's T1 spelling, kept as s3_sig.ts kept it
    if (il) {
      rec.mode = "list";
      rec.priced = !!il.rowPriced;
      rec.scope = scopeOf(il.totals ?? res.values);
      if (!rec.priced) {
        rec.reason = rec.reason ?? il.reason ?? null;
        for (const b of il.items ?? []) if (b.state !== "priced" && b.reason) blanks.push(`${b.family ?? "?"}: ${b.reason}`);
      }
      for (const call of g.__il ?? []) {
        for (const it of call.items ?? []) {
          const fam = it.family ?? it.familyRaw ?? null;
          if (it.state === "priced" && it.sku) {
            skuLines.push({ line: fam, uid: it.sku.item_uid ?? `${it.sku.item_name ?? ""}/${it.sku.item_detail ?? ""}/${it.sku.unit ?? ""}/${fam ?? ""}`, name: `${it.sku.item_name ?? fam ?? ""} / ${it.sku.item_detail ?? ""} (${it.sku.unit ?? ""})`, qty: it.qty ?? 1 });
          }
          const defaulted = new Map<string | undefined, unknown>((it.defaulted ?? []).map((d) => [d.attr ?? d.id, d]));
          const hops = new Map<string | undefined, unknown>((it.ladderHops ?? []).map((h) => [h.attr ?? h.axis, h]));
          const over = new Map<string, unknown>((it.overrides ?? []).map((o) => [o.attr, o]));
          const tm = new Map<string, unknown>((it.textMapped ?? []).map((o) => [o.attr, o]));
          for (const [id, v] of Object.entries({ ...(it.readValues ?? {}), ...(it.selection ?? {}) })) {
            const rule = defaulted.has(id) ? "default" : hops.has(id) ? "ladder" : over.has(id) ? "override" : tm.has(id) ? "text_mapped" : (it.lengthRead?.attr === id || it.filledReads?.[id]) ? "filled_read" : "read";
            finals.push({ item: fam, id, value: v, rule, read: it.readValues?.[id] ?? null, detail: defaulted.get(id) ?? hops.get(id) ?? over.get(id) ?? tm.get(id) ?? null });
          }
          finals.push({ item: fam, id: "__family__", value: it.family ?? null, rule: it.familyDefaulted ? "family_default" : it.familyRaw !== it.family ? "family_alias" : "read", read: it.familyRaw ?? null, detail: it.familyDefaulted ?? it.familyLine ?? null });
          finals.push({ item: fam, id: "__qty__", value: it.qty ?? 1, rule: it.qtyDefaulted ? "default" : "read", read: null, detail: null });
          if (it.conversion) finals.push({ item: fam, id: "__unit__", value: it.conversion.to, rule: "conversion", read: r.unit ?? "", detail: it.conversion });
          if (it.state !== "priced") for (const m of it.missing ?? []) blanks.push(`${fam ?? "?"}.${m}`);
        }
      }
      if (!rec.priced && !blanks.length && (il.reason || res.reason)) blanks.push(String(il.reason ?? res.reason));
    } else {
      rec.mode = "attr";
      rec.priced = res.kind === "suggestion" && Object.keys(res.values ?? {}).length > 0;
      rec.scope = scopeOf(res.values);
      const cfg0 = cat ? configsByCategory.get(cat) : undefined;
      const al = (cfg0 as AliasSeen | undefined)?.alias_of ?? (cfg0 as AliasSeen | undefined)?.alias;
      const cfg = al ? configsByCategory.get(al.category_id) : cfg0;   // an alias category prices with its target's pipelines, as resolveAliasConfig does
      const calls = g.__pl ?? [];
      const last = new Map<string, PipelineSeen>();
      for (const p of calls) last.set(p.pipelineId, p);
      let ids: string[] = cfg ? nonBcsPipelines(cfg).map(([id]) => id) : [];
      if (cfg?.category_id === "wiring_cabling") {
        // computeWiring runs the PRIMARY pipeline first, then the paired one: the primary alone prices the row (values), so a cable row and a termination row never share a signature (R-H2O)
        const ix = (id: string) => calls.map((p) => p.pipelineId).lastIndexOf(id);
        ids = ix("cable_boq") >= 0 && (ix("termination_boq") < 0 || ix("cable_boq") < ix("termination_boq")) ? ["cable_boq"] : ix("termination_boq") >= 0 ? ["termination_boq"] : [];
        rec.primary = ids[0] ?? null;
      }
      for (const id of ids) {
        const p = last.get(id);
        if (!p || p.status !== "ok") continue;
        if (p.matchedItem) raw.push(`${p.matchedItem.name}|qty=1`);
        for (const st of p.steps ?? []) if (st.refItem && st.produced) raw.push(`ref:${st.refItem}|qty=${st.qty ?? 1}`);
        if (p.matchedItem) skuLines.push({ line: id, uid: p.matchedItem.item_uid ?? p.matchedItem.name, name: itemLabel(p.matchedItem) || p.matchedItem.name, qty: 1, unit: p.matchedItem.unit ?? null });
        else skuLines.push({ line: id, uid: `(pipeline ${id})`, name: `(pipeline ${id}, no matched row)`, qty: 1 });
        for (const st of p.steps ?? []) {
          if (st.refItem && st.produced) { const ref = byName.get(st.refItem); skuLines.push({ line: id, uid: ref?.item_uid ?? `ref:${st.refItem}`, name: ref ? itemLabel(ref) || st.refItem : st.refItem, qty: st.qty ?? 1 }); }
        }
      }
      for (const a of res.workings?.attributes ?? []) {
        if (a.disabled) continue;
        const notes = (a.notes ?? []).map((n) => n.kind);
        const rule = a.defaulted ? "default" : a.substituted ? "substituted" : notes.find((k) => k !== undefined && NOTE_RULE.has(k)) ?? ((a.value ?? "") === "" ? "blank" : "read");
        const rawRead = (r.attributes ?? {})[a.id];
        finals.push({ item: null, id: a.id, value: a.value ?? null, rule, read: rawRead && typeof rawRead === "object" ? (rawRead as { value?: unknown }).value ?? null : rawRead ?? null, detail: (a.notes ?? []).length ? a.notes : null });
      }
      if (!rec.priced) {
        for (const d of res.workings?.derivation ?? []) { const m = /^(?:Missing to price|Fill to price): (.*?)(?: -- fill.*)?\.?$/.exec(d); if (m) blanks.push(m[1]); }
        if (!blanks.length) blanks.push(String(res.reason ?? (res.workings?.derivation ?? [])[0] ?? res.basis ?? res.kind));
      }
    }
    // a line with a quantity of 0 buys nothing, so it is not a priced item. One line per distinct [line, uid, name, qty]
    // (keyed by its JSON text, sorted by it; an absent part reads as null, as JSON writes it).
    const lines = new Map<string, unknown[]>();
    for (const l of skuLines) {
      if (l.qty === 0) continue;
      const t = [l.line ?? null, l.uid ?? null, l.name ?? null, l.qty ?? null];
      lines.set(JSON.stringify(t), t);
    }
    rec.lines = [...lines.keys()].sort().map((k) => lines.get(k));
    rec.raw = raw;
    rec.wderivation = res.workings?.derivation ?? null;
    const qtyFields = rec.mode === "attr" ? Object.fromEntries(finals.filter((f) => isQtyField(String(f.id))).map((f) => [f.id, String(f.value ?? "")]).sort()) : {};
    rec.signature = rec.priced ? JSON.stringify({ scope: rec.scope, lines: rec.lines, qty_fields: qtyFields, ...((rec.lines as unknown[]).length ? {} : { no_sku_figures: res.values }) }) : null;
    rec.finals = finals;
    rec.blanks = blanks;
    if (FULL) {
      const w = res.workings ?? {};
      rec.full = {
        basis: res.basis ?? null, derivation: w.derivation ?? [], matchedRows: w.matchedRows ?? [],
        sections: (w.sections ?? []).map((s) => ({ label: s.label, derivation: s.derivation, figures: s.figures, matchedRows: s.matchedRows ?? [] })),
        list: il ? { rowPriced: il.rowPriced, totals: il.totals ?? null, reason: il.reason ?? null, unit: il.unit ?? null, unitNote: il.unitNote ?? null,
          items: (il.items ?? []).map((b) => ({ family: b.family, state: b.state, reason: b.reason ?? null, qty: b.qty, qtyDefaulted: !!b.qtyDefaulted, skuLine: b.skuLine ?? null, figures: b.figures, working: b.working,
            fields: (b.fields ?? []).map((f) => ({ id: f.id, value: f.value ?? f.typedValue ?? null, defaulted: !!f.defaulted, note: f.note ?? null })) })) } : null,
      };
    }
    out.push({ key, rec, ac7 });
  }
  return { rows: out };
}

export interface DrivingFieldStat { id: string; withValue: number; withhold: number; changes: number; pairWithhold: number;
  withholdShare: number; pairShare: number; changesShare: number; cls: "needed" | "either-or" | "not needed"; movesPrice: boolean }
export interface DrivingCategory { rows: number; pricedRows: number; sampled: number; fields: DrivingFieldStat[]; driving: string[] }

/** THE PRICE-DRIVING RULE (owner 2026-11-03 10:59 "ok": DEV2-B3 F2b rule (iii)). */
export const DRIVING_MIN_SHARE = 0.10;
export const DRIVING_MIN_ROWS = 5;

/** PURE. Does a count of rows meet the rule for a field tested on `tested` rows? (>= 10 % of them AND >= 5 rows) */
export function meetsDrivingRule(count: number, tested: number): boolean {
  return tested > 0 && count >= DRIVING_MIN_SHARE * tested && count >= DRIVING_MIN_ROWS;
}

/**
 * Measure each category's price-driving fields on `input.rows` (the stored helper-1 rows, as for `priceRowsForMatching`),
 * on EVERY priced row of a category (`input.sample`, when given, caps it, evenly spread in row order -- tests only).
 * Per row, every read field is blanked alone (value -> null, the "asked and blank" state) and re-priced: withheld, or
 * priced at other values -> it CHANGES THE PRICE on this row; else not here. The first 14 fields that do not withhold
 * alone are blanked in pairs: a pair that withholds marks both. A field is "needed" when its changed-price count
 * (withheld + changed values) meets the rule (meetsDrivingRule: >= 10 % of its tested rows AND >= 5 rows), else
 * "either-or" when its pair-withheld count does, else "not needed". `driving` = the fields not "not needed", in id order.
 * (DEV2-R2 h2_fields2.ts pass 1; the rule and the all-rows scope are DEV2-B4's.)
 * A row's notes: its own `ownNotes` / `headingNotes` when sent, else the page's (rowOwnNotes / rowHeadingNotes).
 */
export function measureDrivingFields(input: PricingStepInput & { sample?: number }): { categories: Record<string, DrivingCategory> } {
  const SAMPLE = input.sample ?? Number.POSITIVE_INFINITY;
  const configsByCategory = new Map<string, RateCategoryConfig>(Object.entries(input.configs ?? {}));
  const byDisc = input.itemsByDiscipline ?? {};
  const sets: RateMasterItem[][] = input.itemSets ?? [byDisc["Electrical"] ?? [], ...RATE_MASTER_ITEM_DISCIPLINES.map((d) => byDisc[d] ?? [])];
  const items = mergeItemsByName(...sets);
  const PAGE_ROWS = input.pageRows ?? {};
  type Cell = { value?: unknown } & Dict;
  type Row = PricingStepRow & { ownNotes?: string[]; headingNotes?: string[] };
  const price = (r: Row, attrs: Dict, its: Array<{ attributes?: Dict }> | undefined) => {
    const cat = r.resolved_category || r.category_id;
    const ext: Dict = { excelRow: r.excel_row, description: r.description, attributes: attrs ?? {} };
    if (its) ext.items = its;
    const pageRows = PAGE_ROWS[`${r.boq}|${r.sheet_name}`] ?? [];
    const pr = pageRows.find((x) => x.source_row_number === r.excel_row);
    const ownNotes = r.ownNotes ?? (pr ? rowOwnNotes(pr, pageRows) : []);
    const headingNotes = r.headingNotes ?? (pr ? rowHeadingNotes(pr, pageRows) : []);
    const helper = makePricingSheetHelper({ configsByCategory, items: items as never, extractionByRow: new Map([[r.excel_row, ext]]) } as never);
    let res: ResultSeen;
    try {
      res = helper.compute({ excelRow: r.excel_row, description: r.description, nodeType: "Line Item", category: cat, discipline: r.discipline,
        rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: r.headings ?? [], ownNotes, headingNotes, unit: r.unit ?? "" } as never, {}) as unknown as ResultSeen;
    } catch {
      res = { kind: "error" };
    }
    const vals = res.values ?? {};
    const priced = res.kind === "suggestion" && Object.keys(vals).length > 0 && (res.itemList ? !!res.itemList.rowPriced : true);
    return { priced, key: JSON.stringify(vals) };
  };
  const nonNull = (c: unknown) => {
    const v = (c as Cell | null)?.value;
    return !!c && v !== null && v !== undefined && String(v).trim() !== "";
  };
  const blanked = (r: Row, ids: string[]) => {
    const attrs = structuredClone(r.attributes ?? {}) as Record<string, Cell>;
    for (const id of ids) if (attrs[id]) attrs[id] = { ...attrs[id], value: null };
    let its: Array<{ attributes?: Record<string, Cell> }> | undefined;
    if (Array.isArray(r.items)) {
      its = structuredClone(r.items) as Array<{ attributes?: Record<string, Cell> }>;
      for (const it of its) for (const id of ids) if (it.attributes?.[id]) it.attributes[id] = { ...it.attributes[id], value: null };
    }
    return { attrs, its };
  };
  const readIds = (r: Row): string[] => {
    const s = new Set<string>();
    for (const [id, c] of Object.entries(r.attributes ?? {})) if (nonNull(c)) s.add(id);
    for (const it of r.items ?? []) for (const [id, c] of Object.entries(it.attributes ?? {})) if (nonNull(c)) s.add(id);
    return [...s].sort();
  };
  const byCat = new Map<string, Row[]>();
  for (const r of (input.rows ?? []) as Row[]) {
    const c = (r.resolved_category || r.category_id) as string;
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(r);
  }
  const out: Record<string, DrivingCategory> = {};
  for (const [cat, list] of byCat) {
    const base = list.map((r) => ({ r, b: price(r, r.attributes ?? {}, r.items ?? undefined) })).filter((x) => x.b.priced);
    const step = Number.isFinite(SAMPLE) ? Math.max(1, Math.floor(base.length / SAMPLE)) : 1;
    const sample = Number.isFinite(SAMPLE) ? base.filter((_, i) => i % step === 0).slice(0, SAMPLE) : base;
    const f: Record<string, { withValue: number; withhold: number; changes: number; pairWithhold: number }> = {};
    const get = (id: string) => (f[id] ??= { withValue: 0, withhold: 0, changes: 0, pairWithhold: 0 });
    for (const { r, b } of sample) {
      const ids = readIds(r);
      const soft: string[] = [];
      for (const id of ids) {
        const st = get(id);
        st.withValue++;
        const { attrs, its } = blanked(r, [id]);
        const p = price(r, attrs, its);
        if (!p.priced) st.withhold++;
        else { if (p.key !== b.key) st.changes++; soft.push(id); }
      }
      const pairOf = soft.slice(0, 14);
      const hit = new Set<string>();
      for (let i = 0; i < pairOf.length; i++) for (let j = i + 1; j < pairOf.length; j++) {
        const { attrs, its } = blanked(r, [pairOf[i], pairOf[j]]);
        if (!price(r, attrs, its).priced) { hit.add(pairOf[i]); hit.add(pairOf[j]); }
      }
      for (const id of hit) get(id).pairWithhold++;
    }
    const fields: DrivingFieldStat[] = Object.entries(f).map(([id, st]) => {
      const w = st.withhold / st.withValue, pw = st.pairWithhold / st.withValue, ch = st.changes / st.withValue;
      const cls: DrivingFieldStat["cls"] = meetsDrivingRule(st.withhold + st.changes, st.withValue) ? "needed"
        : (meetsDrivingRule(st.pairWithhold, st.withValue) ? "either-or" : "not needed");
      return { id, ...st, withholdShare: +w.toFixed(3), pairShare: +pw.toFixed(3), changesShare: +ch.toFixed(3), cls, movesPrice: cls === "not needed" && ch >= 0.2 };
    }).sort((a, b) => a.id.localeCompare(b.id));
    out[cat] = { rows: list.length, pricedRows: base.length, sampled: sample.length, fields, driving: fields.filter((x) => x.cls !== "not needed").map((x) => x.id) };
  }
  return { categories: out };
}
