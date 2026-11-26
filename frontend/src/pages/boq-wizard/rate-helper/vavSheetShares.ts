/**
 * VAV-2b1 -- THE SHARED ITEMS OF A VAV SHEET (owner 2026-11-20 14:18 - 18:44; `VAV_Rulings_Capture_2026-11-18.md`).
 *
 * R1 (14:18 / 14:22 / 14:23 / 14:25): when the payload of ANY VAV row of the sheet mentions BACnet and the sheet has no separate
 *    controller row -> controllers = all VAVs on the sheet / 32 rounded up; total = controllers x the "BACnet over IP controller" SKU;
 *    the share = total / all VAVs, rounded to the rupee, on EVERY VAV box of the sheet; quantities blank or 0 -> nothing + a note.
 * R3 (14:30 - 15:23): a DDC controller / panel part of the VAV box or its controller, no separate DDC row -> panels = VAVs / 200 up;
 *    BCS supply = BACnet supply x controllers + Duct Static Pressure Sensor supply x sensors + DDC panel supply x panels; BCS install =
 *    DDC panel install x panels; the DDC panel SKU's markups; then NO separate BACnet or DP share. Without "inclusive": + the note.
 * R5 (15:16 / 15:19): a plain controller for the VAVs (not by others) -> the BACnet share + the "check" note (only when no row of the
 *    sheet says BACnet); by the BMS vendor / by others -> nothing, with a note.
 * R7 (15:20): first match per sheet -- DDC, else BACnet, else a plain controller, else nothing; a separate row -> nothing + a note naming
 *    it, presence decides (00:37 "one controller for many VAVs").
 * R8 (14:35 / 14:37 / 14:39): every DP mention -> sensors = VAVs / 30 up x the Sensors "Duct Static Pressure Sensor", shared over every
 *    box; never together with a DDC share.
 * R10 (15:02 / 15:05 / 18:39 / 18:41 / 18:44; screen 7): each share is its own block the user can add, remove and edit -- the number of
 *    VAVs (pre-filled from the sheet on a BoQ row, EMPTY in the Calculator), the VAVs per item, the count, or the final amount -- each
 *    box with its revert; a count changed by hand is kept and marked; a typed amount replaces the sum line.
 *
 * PURE. Every figure is read live: the counts from the Pricing Inputs, the rates from the SKUs. The Calculator and a BoQ row price a
 * share through the SAME function (`sheetSharesView`). Only a config declaring `pricing.sheet_shares` runs any of it.
 */
import { parseJson } from "@/lib/parseJson";
import type { RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { countWords, fill, notAddedLines, rowsNamed, type NotAddedBy, type SeparateRowBy } from "./vavNotAdded";
import { shareSkuOf, shareSum, skuUnitFigures, up } from "./vavShareSums";
export { countWords, notAddedLines, shareSkuOf, skuUnitFigures, type NotAddedBy, type SeparateRowBy };

/** A SKU a share reads live: the catalogue item of `kind` whose attribute `attr` is `value`. */
export interface ShareSku { kind: string; attr: string; value: string }

/** One counted part of a share: the count = VAVs / `per_input` rounded up, priced at `sku`. */
export interface SharePart {
  id: string;
  /** "Controllers" / "Sensors" / "Panels" */
  label: string;
  /** "VAVs per controller" */
  per_label: string;
  per_input: string;
  sku: ShareSku;
}

export interface SheetShareDef {
  id: string;
  /** "BACnet controller share" */
  label: string;
  /** "Shared item - BACnet controller share" */
  heading: string;
  /** "Add BACnet controller share" */
  add_label: string;
  /** what its own row prices, for the quantity-0 note ("controller", "DDC panel", "DP sensor") */
  item: string;
  parts: SharePart[];
  /** a DDC panel: the BCS supply of every part, then THIS part's SKU markups (supply and install); its install = this part's install */
  bcs_of?: string;
  /** the shares this one replaces on the row (DDC: BACnet and DP), with the line it shows */
  replaces?: string[];
  replaces_line?: string;
}

/** VAV-2b1 v80: one full-rate (whole, per unit) entry of a share. */
export interface ShareWholeDef {
  /** its key in the edit state ("bacnet_whole") */
  key: string;
  /** the share whose parts and sums it uses */
  share: string;
  /** the item-list entry ("BACnet over IP controller (full rate)") */
  label: string;
  heading: string;
  /** one unit of the row ("controller", "panel") -- the pre-fill line */
  unit_word: string;
  /** parts whose count is fixed, not worked out from the VAVs (DDC: the panel inside is always 1, owner 01:22) */
  fixed?: Record<string, number>;
  /** VAV-2c3 FIX-2 (B2-2, owner 2026-11-24 20:00): on a BoQ row whose own words match `words` ("controller for BACnet integration above VAV
   *  Boxes") and where NO VAV count is known (none on the sheet, none typed), these parts are FIXED too (one controller per unit of the row)
   *  and `line` shows under the block; with a VAV count the controller formula decides as before. ABSENT => as before. */
  fixed_when?: { words: string; fixed: Record<string, number>; line?: string };
  /** the count of each worked-out part while no VAV count is known (BACnet: 1, owner 01:36 "A" -- the user types it) */
  count_without_vavs?: number;
  /** on a BoQ row with a quantity above 1: "{V} VAVs on the sheet / {q} {unit}s on this row = {n} per {unit}" */
  prefill_line: string;
  /** under this block when the share of the same item is also on the entry */
  line?: string;
  /** " per unit" */
  per_unit: string;
  /** VAV-2b2 (R7, owner 2026-11-21 10:25 "1b"): the last working line when the fixed part's count is NOT 1 ("for {n} {unit}s" -> "for 2
   *  panels", the number typed). ABSENT => "per {unit}" always */
  for_count?: string;
}

/** The separate-row tests, one list per share kind (the `OwnRowExtra` shape, run by the product's `vavSeparateRow`). */
export interface ShareSeparateRows {
  extras: Array<{ share: string; label: string; words: string; needs_vav?: boolean; not_words?: string; near_words?: string;
    near_chars?: number; not_near_words?: string; not_near_chars?: number; item_first?: boolean;
    /** QR-D2 (owner 19:46 / 19:50 "a"): a row that is ALSO an integrator / router row (own_row_check's integrator test) is not this item's
     *  row -- unless its own description matches `controls_vav_words` (owner 20:20 "option b": a controller FOR THE VAVs, even if also
     *  called a router) */
    not_integrator_rows?: boolean; controls_vav_words?: string }>;
  /** artefact words for these tests where they differ from own_row_check's (absent = own_row_check's) */
  artefact_words?: Record<string, string>;
}

export interface SheetSharesSpec {
  /** the row's reading, attributes on its box item (the model answers them in VAV-2b2; the stub / fixtures here) */
  reading: { controller_attr: string; by_others_attr: string; dp_attr: string;
    values: { ddc_inclusive: string; ddc: string; bacnet: string; controller: string }; yes: string };
  /** which rows are the sheet's VAVs: a VAV-filed row whose box item is one of `box_families` (not installation-only, not existing
   *  work); `blank`: "skip" = a blank / 0 quantity counts 0 (nothing added only when EVERY counted row is blank / 0); "sheet_off" = any
   *  blank / 0 counted row -> nothing added on the sheet */
  count: { box_families: string[]; blank: "skip" | "sheet_off" };
  shares: SheetShareDef[];
  separate: ShareSeparateRows;
  labels: { vavs: string; count_suffix: string; typed: string; typed_supply: string; typed_install: string; amount_typed: string;
    tag_helper: string; tag_user: string; from_sheet: string; typed_by_you: string; changed_by_you: string; from_input: string;
    worked_out: string; need_vavs: string; no_sku: string; per_box: string;
    /** VAV-2c1 (R2, owner 2026-11-22 10:48 "correct the msg and note which call its a share"): a FULL-RATE block's line. ABSENT => need_vavs */
    need_vavs_whole?: string;
    /** VAV-2c1 (R4, owner 2026-11-22 10:51 "all a", 4.3): the VAVs box on a separate controller / DDC panel ROW. ABSENT => `vavs` */
    vavs_per_unit?: string;
    /** VAV-2b2 (R15, owner 2026-11-21 12:36 "a"): the word in place of "BCS" in the DDC share's working lines ("cost"). ABSENT => "BCS" */
    cost_word?: string;
    /** VAV-2b2 (R15): the VAVs box's label IN THE CALCULATOR ("Number of VAVs"; on a BoQ row it IS the sheet's count). ABSENT => `vavs` */
    vavs_calculator?: string;
    /** VAV-2c2 (R3 h): `need_vavs` / `need_vavs_whole` IN THE CALCULATOR, where there is no sheet ("Type the number of VAVs to price this
     *  item."). ABSENT => the BoQ-row wording */
    need_vavs_calculator?: string; need_vavs_whole_calculator?: string };
  /** VAV-2b2 (R10): the "Possible double counting" block. ABSENT => none (the small lines stay as they are) */
  /** VAV-2b2 (owner 2026-11-21 15:56 "2a"): the 'not added' sentence by the separate-row test that caught the row (else lines.not_added) */
  not_added_by?: NotAddedBy[];
  double_count?: { heading: string; ddc: string[]; with: Array<{ blocks: string[]; families: string[]; part: string; line: string;
    /** VAV-2b2 (A-4): the share this entry checks against, in place of `ddc` (a BACnet / DP share and its own full-rate item) */ anchor?: string[] }> };
  /** VAV-2b1 v80 (owner 2026-11-21 01:07 / 01:21 / 01:31 / 01:32 "A"): the FULL-RATE, per-unit mode of a share -- the same parts and sums, NOT
   *  divided over the boxes; added by the USER from the item list (never by the helper). ABSENT => no full-rate entries. */
  whole?: ShareWholeDef[];
  lines: { not_added: string; check: string; ddc_not_inclusive: string; by_others: string; rate_only: string; blank_rows: string; zero_row: string;
    /** VAV-2b1 v80 (owner 01:16 + his "b" 01:21): under a share the USER adds on a BoQ row that is not a counted VAV box row. ABSENT => none */
    not_box_row?: string };
}

/** The pricer's edits to ONE share block (the panel keeps them under `SHARES_OVERRIDE_KEY`, row-scoped). */
export interface ShareEdit {
  added?: boolean;
  removed?: boolean;
  /** "vavs", "<part>_per", "<part>_count" -> the typed text */
  set?: Record<string, string>;
  amount?: { supply?: string; install?: string };
}
export type SharesEditState = Record<string, ShareEdit>;

/** The override key the panel writes the shares' session edits under (a JSON `SharesEditState`). */
export const SHARES_OVERRIDE_KEY = "__shares__";

export type ShareEditOp =
  | { op: "add"; share: string }
  | { op: "remove"; share: string }
  | { op: "set"; share: string; field: string; value: string }
  | { op: "revert"; share: string; field: string }
  | { op: "amount"; share: string; kind: "supply" | "install"; value: string }
  | { op: "revert_amount"; share: string };

/** PURE. The edit state from the override text (anything unreadable = no edits). */
export function decodeShareEdits(text: unknown): SharesEditState {
  if (typeof text !== "string" || !text.trim()) return {};
  try {
    const o = parseJson(text);
    return o && typeof o === "object" && !Array.isArray(o) ? (o as SharesEditState) : {};
  } catch {
    return {};
  }
}

/** PURE. One edit applied (a revert deletes the field, so the helper's value stands again). */
export function applyShareEdit(state: SharesEditState | undefined, op: ShareEditOp): SharesEditState {
  const s: SharesEditState = { ...(state ?? {}) };
  const cur: ShareEdit = { ...(s[op.share] ?? {}) };
  if (op.op === "add") { s[op.share] = { added: true }; return s; }
  if (op.op === "remove") { s[op.share] = { removed: true }; return s; }
  if (op.op === "set") cur.set = { ...(cur.set ?? {}), [op.field]: op.value };
  if (op.op === "revert") { const { [op.field]: _x, ...rest } = cur.set ?? {}; cur.set = rest; }
  if (op.op === "amount") cur.amount = { ...(cur.amount ?? {}), [op.kind]: op.value };
  if (op.op === "revert_amount") delete cur.amount;
  s[op.share] = cur;
  return s;
}

/** One VAV row of the sheet as the decision reads it. `counted` = a box for new supply; `reading` null = no reading for the row. */
export interface SheetVavRow {
  row: number;
  counted: boolean;
  qty: number | null;
  reading: { controller: string; byOthers: boolean; dp: boolean } | null;
}

/** What the sheet rules decided (a BoQ row only): the shares the helper adds, the sheet's VAVs, and every note. */
export interface SheetShareDecision {
  add: string[];
  /** the sheet's VAVs (the counted quantities); null when every counted row is blank / 0 (or `sheet_off` and any is) */
  vavs: number | null;
  boxRows: number;
  blankRows: number;
  /** the notes shown in the share's own block, by share id */
  shareNotes: Record<string, string[]>;
  /** the notes shown with the row (nothing added: a separate row, by others, quantities missing) */
  rowNotes: string[];
}


/** A share's separate rows on the sheet: those with a quantity above 0 (charged separately) and those with quantity 0 / blank. */
export type SeparateRows = Readonly<Record<string, { charged: readonly number[]; zero: readonly number[]; by?: Readonly<Record<number, SeparateRowBy>> } | readonly number[]>>;

/** VAV-2b1 v80. PURE. The sheet's VAVs as the decision counts them (counted rows' quantities; null = none counted, or every counted row
 *  blank / 0, or "sheet_off" with a blank one) -- also the full-rate blocks' pre-fill on a row that is not itself a counted box. */
export function sheetVavsOf(spec: SheetSharesSpec, rows: readonly SheetVavRow[]): number | null {
  const boxes = rows.filter((r) => r.counted);
  const blank = boxes.filter((r) => !(typeof r.qty === "number" && r.qty > 0));
  const sum = boxes.reduce((a, r) => a + (typeof r.qty === "number" && r.qty > 0 ? r.qty : 0), 0);
  const off = boxes.length > 0 && (blank.length === boxes.length || (spec.count.blank === "sheet_off" && blank.length > 0));
  return boxes.length && !off ? sum : null;
}

/**
 * VAV-2b1 (B1 / B2). PURE. The sheet's decision: the VAVs, then the first match (DDC, else BACnet, else a plain controller, else by
 * others / nothing), each against its separate rows (`separate[share]`: presence decides for a row with a quantity above 0; a row with
 * quantity 0 / blank, on a sheet whose VAV rows carry a quantity, does NOT count as charged separately -- owner 2026-11-20 21:05 "a, yes"
 * -- the share is added with the note naming it), then the DP sensor share (never with DDC). A plain list = rows charged separately.
 */
export function decideSheetShares(spec: SheetSharesSpec, rows: readonly SheetVavRow[], separate: SeparateRows): SheetShareDecision {
  const v = spec.reading.values;
  const boxes = rows.filter((r) => r.counted);
  const blank = boxes.filter((r) => !(typeof r.qty === "number" && r.qty > 0));
  const sum = boxes.reduce((a, r) => a + (typeof r.qty === "number" && r.qty > 0 ? r.qty : 0), 0);
  const off = boxes.length > 0 && (blank.length === boxes.length || (spec.count.blank === "sheet_off" && blank.length > 0));
  const vavs = boxes.length && !off ? sum : null;
  const read = rows.map((r) => r.reading).filter((x): x is NonNullable<SheetVavRow["reading"]> => !!x);
  const counts = (c: string) => read.some((x) => x.controller === c && !x.byOthers);
  const ddcInc = counts(v.ddc_inclusive), ddc = ddcInc || counts(v.ddc), bacnet = counts(v.bacnet), plain = counts(v.controller);
  const byOthers = read.some((x) => x.byOthers);
  const label = (id: string) => spec.shares.find((s) => s.id === id)?.label ?? id;
  const out: SheetShareDecision = { add: [], vavs, boxRows: boxes.length, blankRows: blank.length, shareNotes: {}, rowNotes: [] };
  const offer = (id: string, notes: string[]) => {
    const raw = separate[id];
    const sep = Array.isArray(raw) ? { charged: raw as readonly number[], zero: [] as readonly number[] }
      : (raw as { charged: readonly number[]; zero: readonly number[]; by?: Readonly<Record<number, SeparateRowBy>> } | undefined) ?? { charged: [], zero: [] };
    if (sep.charged.length) { out.rowNotes.push(...notAddedLines(spec.not_added_by, spec.lines.not_added, id, label(id), sep)); return; }
    if (vavs === null) { out.rowNotes.push(fill(spec.lines.rate_only, { share: label(id) })); return; }
    out.add.push(id);
    const item = spec.shares.find((s) => s.id === id)?.item ?? id;
    const zero = sep.zero.length ? [fill(spec.lines.zero_row, { Item: item.charAt(0).toUpperCase() + item.slice(1), item, share: label(id),
      rows: rowsNamed(sep.zero), has: new Set(sep.zero).size > 1 ? "have" : "has" })] : [];
    const more = blank.length ? [fill(spec.lines.blank_rows, { n: blank.length })] : [];
    out.shareNotes[id] = [...zero, ...notes, ...more];
  };
  if (ddc) offer("ddc", ddcInc ? [] : [spec.lines.ddc_not_inclusive]);
  else if (bacnet) offer("bacnet", []);
  else if (plain) offer("bacnet", [spec.lines.check]);
  else if (byOthers) out.rowNotes.push(spec.lines.by_others);
  if (!ddc && read.some((x) => x.dp)) offer("dp", []);
  return out;
}

/** One box of a share block, with how its value landed (rule d). */
export interface ShareFieldView {
  id: string;
  label: string;
  /** the value used ("" = none yet) */
  value: string;
  source: "sheet" | "typed" | "changed" | "input" | "worked_out" | "none";
  sourceLabel: string;
  /** the pricer typed it: the revert icon shows */
  edited: boolean;
}

export interface SharedItemView {
  id: string;
  heading: string;
  label: string;
  origin: "helper" | "user";
  tag: string;
  fields: ShareFieldView[];
  /** the working lines (the sum), or the "Amount typed by you" line */
  sumLines: string[];
  /** VAV-2c1 (R5): the same working for ONE side, for a row whose scope leaves the other out (`scopeLines.ts`) */
  sideLines?: { supply: string[]; install: string[] };
  /** VAV-2c1 (R5): the side the row's scope leaves out ("Supply 0 - not in scope"); set by `scopeLines.ts` */
  notInScope?: { kind: "supply_rate" | "install_rate"; word: string };
  /** per box; null = not priced yet (`reason` says why) */
  figures: { supply_rate: number; install_rate: number } | null;
  reason?: string;
  amountTyped: boolean;
  amount: { supply: string; install: string };
  notes: string[];
  replacesLine?: string;
  /** VAV-2b1 K2b (the cert's finding): a full-rate block says "per unit" where a share says "per box" -- its figure line's suffix and its
   *  typed-amount label (ABSENT on a share = the labels' per_box / typed) */
  perLabel?: string;
  typedLabel?: string;
}

export interface SharesView {
  blocks: SharedItemView[];
  adds: Array<{ id: string; label: string }>;
  /** VAV-2b1 v80: the full-rate entries the item list offers (each inserts its whole block) */
  wholeAdds: Array<{ id: string; label: string }>;
  editState: SharesEditState;
  /** the priced blocks' per-box figures added up */
  totals: { supply_rate: number; install_rate: number };
  priced: number;
  /** the row's notes from the sheet decision (nothing added and why) */
  rowNotes: string[];
  labels: SheetSharesSpec["labels"];
}

const num = (t: string | undefined): number | null => {
  if (t === undefined) return null;
  const s = String(t).replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * VAV-2b1 (B3 / B5). PURE. The share blocks of ONE row -- a BoQ row (the sheet's `decision`) or the Calculator (`decision` null: only
 * the shares the pricer adds, the number of VAVs empty until typed) -- priced through the same sums. `inputOf` reads a Pricing Input
 * (live). A share whose number of VAVs is unknown prices nothing (the row total does not wait for it).
 */
export function sheetSharesView(spec: SheetSharesSpec, decision: SheetShareDecision | null, edits: SharesEditState,
  items: readonly RateMasterItem[], inputOf: (id: string) => number | null,
  /** VAV-2b1 v80: on a BoQ row, the sheet's counted VAVs and the row's own quantity (the full-rate blocks' pre-fill); VAV-2b2 (R3 / R16):
   *  `helperWhole` -- the full-rate block the HELPER adds on a separate controller / DDC panel row (the user can remove it) */
  row?: { sheetVavs: number | null; qty: number | null; helperWhole?: string }): SharesView {
  const L = spec.labels;
  const helperIds = new Set(decision?.add ?? []);
  let active = spec.shares.filter((s) => (helperIds.has(s.id) && !edits[s.id]?.removed) || (edits[s.id]?.added && !edits[s.id]?.removed));
  const replaced = new Set(active.flatMap((s) => s.replaces ?? []));
  active = active.filter((s) => !replaced.has(s.id));
  const blocks = active.map((s) => priceShare(spec, s, helperIds.has(s.id) && !edits[s.id]?.added ? "helper" : "user",
    decision?.vavs ?? null, decision?.shareNotes?.[s.id] ?? [], edits[s.id] ?? {}, items, inputOf, undefined, row === undefined));
  // VAV-2b1 v80: the full-rate (whole, per unit) blocks the user added, after the shares
  const shareIds = new Set(active.map((s) => s.id));
  for (const w of spec.whole ?? []) {
    const e = edits[w.key];
    const s = spec.shares.find((x) => x.id === w.share);
    const byHelper = row?.helperWhole === w.key;
    if (!s || !(e?.added || byHelper) || e?.removed) continue;
    blocks.push(priceShare(spec, s, byHelper && !e?.added ? "helper" : "user", null, [], e ?? {}, items, inputOf, { w, row: row ?? null, shareOn: shareIds.has(s.id) }, row === undefined));
  }
  const priced = blocks.filter((b) => b.figures);
  const activeIds = new Set(active.map((s) => s.id));
  return {
    blocks,
    // the add buttons in screen 7's order (owner 2026-11-20 18:42; ANSWER 26 / 28): a share that REPLACES others (DDC) is listed after the
    // ones it replaces -- a display order only, read from the config's own `replaces`; the first match (DDC, BACnet, plain) is untouched
    adds: spec.shares.filter((s) => !activeIds.has(s.id) && !replaced.has(s.id))
      .sort((a, b) => Number((a.replaces?.length ?? 0) > 0) - Number((b.replaces?.length ?? 0) > 0))
      .map((s) => ({ id: s.id, label: s.add_label })),
    wholeAdds: (spec.whole ?? []).filter((w) => !((edits[w.key]?.added || row?.helperWhole === w.key) && !edits[w.key]?.removed)).map((w) => ({ id: w.key, label: w.label })),
    editState: edits,
    totals: { supply_rate: priced.reduce((a, b) => a + b.figures!.supply_rate, 0), install_rate: priced.reduce((a, b) => a + b.figures!.install_rate, 0) },
    priced: priced.length,
    rowNotes: decision?.rowNotes ?? [],
    labels: L,
  };
}

type WholeMode = { w: ShareWholeDef; row: { sheetVavs: number | null; qty: number | null; helperWhole?: string; text?: string } | null; shareOn: boolean };

function priceShare(spec: SheetSharesSpec, s: SheetShareDef, origin: "helper" | "user", sheetVavs0: number | null, notes0: string[],
  e: ShareEdit, items: readonly RateMasterItem[], inputOf: (id: string) => number | null, whole?: WholeMode,
  /** VAV-2b2 (R15): priced in the Calculator (no BoQ row) */ onCalculator = false): SharedItemView {
  const L = spec.labels;
  const set = e.set ?? {};
  const typedV = num(set.vavs);
  // VAV-2b1 v80 (owner 01:31 "yes"): a full-rate block on a BoQ row pre-fills its VAVs = the sheet's VAVs / the row's quantity, rounded up
  // (quantity blank / 0 / 1 -> the sheet's); the Calculator starts empty
  const notes = [...notes0];
  let sheetVavs = sheetVavs0;
  let prefillLine: string | null = null;
  if (whole) {
    const sv = whole.row?.sheetVavs ?? null, q = whole.row?.qty ?? null;
    sheetVavs = sv !== null && sv > 0 ? (q !== null && q > 1 ? up(sv / q) : sv) : null;
    if (sheetVavs !== null && q !== null && q > 1 && typedV === null) {
      prefillLine = fill(whole.w.prefill_line, { V: sv as number, q, n: sheetVavs, unit: whole.w.unit_word });
    }
    if (whole.shareOn && whole.w.line) notes.push(whole.w.line);
  }
  // VAV-2c3 FIX-2 (B2-2): the row's own words fix more parts -- ONLY while no VAV count is known (none on the sheet, none typed): the
  // controller formula (the sheet's VAVs / VAVs per controller) still decides wherever it can (a BoQ row only; the Calculator has no row text)
  const fw = whole?.w.fixed_when;
  const fwHit = !!fw && !!whole?.row?.text && sheetVavs === null && typedV === null
    && (() => { try { return new RegExp(fw.words, "i").test(whole.row!.text!); } catch { return false; } })();
  const fixedMap: Record<string, number> | undefined = fwHit ? { ...(whole?.w.fixed ?? {}), ...fw!.fixed } : whole?.w.fixed;
  if (fwHit && fw!.line) notes.push(fw!.line);
  const vavs = typedV ?? sheetVavs;
  const fields: ShareFieldView[] = [];
  const srcLabel = (src: ShareFieldView["source"]) => ({ sheet: L.from_sheet, typed: L.typed_by_you, changed: L.changed_by_you,
    input: L.from_input, worked_out: L.worked_out, none: "" })[src];
  const field = (id: string, label: string, value: number | null, src: ShareFieldView["source"], edited: boolean) =>
    fields.push({ id, label, value: value === null ? "" : String(value), source: src, sourceLabel: srcLabel(src), edited });
  const ownRow = !!whole && whole.row?.helperWhole === whole.w.key;
  field("vavs", ownRow && L.vavs_per_unit ? L.vavs_per_unit : onCalculator && L.vavs_calculator ? L.vavs_calculator : L.vavs, vavs, typedV !== null ? (sheetVavs !== null ? "changed" : "typed") : vavs !== null ? "sheet" : "none", set.vavs !== undefined);
  const parts = s.parts.map((p) => {
    const typedPer = num(set[`${p.id}_per`]);
    const inputPer = inputOf(p.per_input);
    const per = typedPer ?? inputPer;
    // VAV-2b1 K2b: a part whose count a full-rate block fixes (the DDC panel inside, always 1) shows no "VAVs per" box -- it plays no part
    if (fixedMap?.[p.id] === undefined) {
      field(`${p.id}_per`, p.per_label, per, typedPer !== null ? "changed" : per !== null ? "input" : "none", set[`${p.id}_per`] !== undefined);
    }
    const typedCount = num(set[`${p.id}_count`]);
    const fixed = fixedMap?.[p.id];
    const count = typedCount ?? (fixed !== undefined ? fixed : vavs !== null && vavs > 0 && per !== null && per > 0 ? up(vavs / per)
      : whole && whole.w.count_without_vavs !== undefined ? whole.w.count_without_vavs : null);
    field(`${p.id}_count`, `${p.label}${L.count_suffix}`, count, typedCount !== null ? "changed" : count !== null ? "worked_out" : "none", set[`${p.id}_count`] !== undefined);
    return { p, count, sku: shareSkuOf(items, p.sku), per, typed: typedCount !== null, fixed: fixed !== undefined };
  });
  const amount = { supply: e.amount?.supply ?? "", install: e.amount?.install ?? "" };
  const base = whole
    ? { id: whole.w.key, heading: whole.w.heading, label: whole.w.label, origin, tag: origin === "helper" ? L.tag_helper : L.tag_user, fields, notes, amount,
      perLabel: whole.w.per_unit, typedLabel: `${L.typed.replace(/\s*\([^)]*\)\s*$/, "")} (${whole.w.per_unit.trim()})` }
    : { id: s.id, heading: s.heading, label: s.label, origin, tag: origin === "helper" ? L.tag_helper : L.tag_user, fields, notes,
      amount, ...(s.replaces_line ? { replacesLine: s.replaces_line } : {}) };
  // VAV-2c2 (R3 h): the Calculator has no sheet -- its "type the number of VAVs" line does not say "on the sheet"
  const Lsum = onCalculator ? { ...L, need_vavs: L.need_vavs_calculator ?? L.need_vavs, need_vavs_whole: L.need_vavs_whole_calculator ?? L.need_vavs_whole } : L;
  const calc = shareSum(s, parts, vavs, Lsum, whole ? { w: whole.w, prefillLine } : undefined);
  // a typed final amount (per box) replaces the sum line (18:44 "yes to all"); a side left blank keeps the worked-out figure
  const ts = num(e.amount?.supply), ti = num(e.amount?.install);
  if (ts !== null || ti !== null) {
    return { ...base, amountTyped: true, sumLines: [L.amount_typed],
      figures: { supply_rate: Math.round(ts ?? calc.figures?.supply_rate ?? 0), install_rate: Math.round(ti ?? calc.figures?.install_rate ?? 0) } };
  }
  return { ...base, amountTyped: false, ...calc };
}
