// SLICE 5 (2026-09-24, owner rulings R1-R21) -- ITEM-LIST PRICING, the PURE module.
//
// A row of a `matching_mode: "item_list"` category carries a LIST of items (slice 4); this module prices
// each item on its own from the config's `list_spec.pricing` block and sums the row. It is PURE: no React,
// no I/O, no AI. The MODEL contributes nothing but the facts it returned; every default, ladder,
// conversion and piece of arithmetic is CODE driven by CONFIG (owner W-c / P1):
//
//   * THE THREE STATES (R2, P4). A STATED value is used as stated. The string "None" means NOT MENTIONED and
//     triggers the config's ruled default, marked `defaulted` (the amber mechanism, slice 6 renders it).
//     An ABSENT / null value means COULD NOT TELL: no default, no price, a named reason.
//   * LADDERS (R6) use the interpreter's exported `buildModuleLadder` / `fitModuleLadder` -- exact, else the
//     NEXT SIZE UP; above the largest = refuse, naming the largest. A range in the text takes its TOP value;
//     several values = blank. Diffusers ladder on NECK, never the outer size (the config keys them so).
//   * ARITHMETIC is the interpreter's own `runPipeline` over EXISTING steps (match_master_row,
//     component_ref, sum_components, scale, roundup) declared per family x unit class in config; the markup
//     rule is R15 (ROUNDUP(cost x (1 + markup), 0), supply and install separately, per-SKU markups) and the
//     derived rows (R20) read their base per-sq.m SKU LIVE through `component_ref`, so a CSV edit to the base
//     row flows through.
//   * UNIT CLASSES. The catalogue's `unit` is projected in memory into each item's attributes under
//     `unit_class_attr` (READ-TIME projection, the brand-column precedent; NOTHING is written back) so
//     `match_master_row` can tell a family's SQM row from its Nos rows. A row's unit class comes from the
//     same table; no unit = refuse (R12). A per-number row against a per-sq.m SKU converts by W x H (R11)
//     or an area band's MAXIMUM (R16); a per-metre GRILLE by height (R4) -- each a config `convert` option.
//   * ALL OR NOTHING (R21): one unpriceable item means the ROW has no price, but every item still reports
//     its own state and reason for the panel (slice 6) and the review pack.
//
// NOT ELIGIBLE YET (P8): nothing here is wired into `pricingSheetHelper`; `isEligibleConfig` still reads
// `pipelines`, which the ADP config keeps empty. Slice 6 wires the panel.
import {
  buildModuleLadder,
  fitModuleLadder,
  runPipeline,
} from "../../pricing/rate-master/ratePipelineInterpreter";
import type {
  Pipeline,
  PipelineResult,
  RateCategoryConfig,
  RateMasterItem,
} from "../../pricing/rate-master/rateMasterTypes";

// ---------------------------------------------------------------------------------------------------------
// the config block (list_spec.pricing) -- mirrors the backend validator `_validate_list_pricing`
// ---------------------------------------------------------------------------------------------------------

export interface NumberReader {
  /** The model's as-written text attribute(s) this SKU attribute is read from; first non-blank wins. */
  from: string[];
  /** The owner-language name used in reasons ("no torque stated"). */
  name: string;
  /** "mm" | "nm" | "sqm" -- decides which unit words are recognised; a number followed by "m" is x1000 into mm. */
  unit?: string;
  /** "300x300" is ONE square size (the number); an unequal pair is not a single size. */
  square?: boolean;
  /** "1:6" -> 6; a bare count ("maximum 6 outgoing feeders") is the number (R17). */
  ratio?: boolean;
  /** A stated token that means the text is NOT this quantity (a sheet GAUGE is not a plenum thickness). */
  reject_tokens?: string[];
  /** A stated number BELOW this is not this quantity either (a 0.8 mm sheet gauge is not a plenum thickness). */
  reject_below?: number;
  /** "max": a range takes its top value (R6 / R16) -- the default for every reader. */
  range?: "max";
  /** SLICE 9 (owner A-1): this SKU attribute is ONE AXIS of a size the row writes as a single phrase --
   * 1 = width, 2 = height, 3 = depth. The model copies "525 x 525 x 450 mm" into one text attribute and
   * CODE splits it (`splitSizePhrase`); an axis the phrase does not state reads as NOT STATED, and a form
   * the splitter cannot read falls through to the ordinary reader, which refuses it BY NAME. ABSENT =>
   * the reader behaves exactly as it did before this slice. */
  component?: number;
}

export interface ConversionOption {
  to: string;
  needs: string[];
  rule: string;
  pipelines: Record<string, Pipeline>;
}

export interface UnitPricing {
  needs?: string[];
  /** SLICE 6 (T7): OPTIONAL -- a block that declares none runs the config's own `pipelines` (the shared
   * per-item default, `default_pipelines` below). A conversion option and a derived family keep their own. */
  pipelines?: Record<string, Pipeline>;
}

export interface FamilySpec {
  needs: string[];
  units: Record<string, UnitPricing>;
  convert?: Record<string, ConversionOption[]>;
}

export interface DefaultSpec {
  value?: string;
  by_family?: Record<string, string>;
  rule: string;
  /** SLICE 6 (owner S6, UL ONLY by config): an ABSENT answer is read as NOT MENTIONED, so this default fires
   * on it too. Absent / false => an absent answer stays "could not tell" and refuses (R2). */
  absent_as_none?: boolean;
}

export interface DeriveWhenNone {
  attr: string;
  families: string[];
  when: { attr: string; equals: string };
  then: string;
  rule: string;
}

/** SLICE 8 (owner M-b): a stated fact that DECIDES the pick, whatever else the row said. Same shape as
 * `derive_when_none` and deliberately so -- the difference is WHEN it fires: that one only fills a value the
 * row left unsaid ("None"), this one REPLACES a value the row DID state. UL is the ruled case: a row that
 * mentions UL takes the UL SKU whether it also says motorised, with sleeve or without. */
export interface OverrideWhen {
  attr: string;
  families: string[];
  when: { attr: string; equals: string };
  then: string;
  rule: string;
  /** SLICE 9 (owner A-6): what the PANEL shows for the overridden field -- the catalogue's own word for the
   * thing the row now prices as. Declared in CONFIG; absent => the field shows the value itself, as before. */
  display?: string;
}

/** SLICE 9 (owner A-4): a SECOND match key beside a family's primary one -- a diffuser's OUTER size beside
 * its neck. It is a key, NEVER a replacement: the primary alone behaves exactly as before, the two together
 * narrow, the second alone stands in for the primary, and a second key matching no SKU is SET ASIDE with a
 * visible note rather than refusing the row. Declared per family in config; a discipline that declares none
 * is byte-identical. */
export interface SecondKey {
  families: string[];
  /** The family's own key (`neck_mm`) -- what the ladder runs on when it is stated. */
  primary: string;
  /** The second key's SKU attributes, in order ("face_w_mm", "face_h_mm"). */
  key: string[];
  /** OPTIONAL catalogue attributes holding the ALTERNATIVE wording of the same size (A-5). Same length and
   * order as `key`. The catalogue carries them; the model never sees them. */
  alt_key?: string[];
  /** The owner-language name of the second key ("outer size"). */
  name: string;
  /** How the primary is chosen when only the second key is stated and several SKUs carry it. "largest" is
   * the owner's ruling; the key is closed so a typo cannot ship a silent default. */
  primary_pick: "largest";
}

/** SLICE 11: one unit of a class quoted in a different unit of it. `class` is the class it belongs to,
 * `factor` multiplies that class's rate to reach this unit, `word` is how the note names it. */
export interface UnitFactor {
  class: string;
  factor: number;
  word: string;
}

export interface ItemListPricingSpec {
  kind: string;
  unit_class_attr: string;
  unit_classes: Record<string, string[]>;
  unit_words?: Record<string, string>;
  /** SLICE 11 (owner ruling, 2026-09-25): a unit that BELONGS to a class and is still a DIFFERENT unit of it
   * -- a square foot is an area, but the catalogue quotes per square metre. A `unit_classes` spelling is a
   * SYNONYM (nothing is scaled); one of these carries a CONVERSION FACTOR to the class's own unit, applied to
   * the RATE and never to the BoQ's quantity. ABSENT => every row is byte-identical to before this slice. */
  unit_factors?: Record<string, UnitFactor>;
  family_alias?: Record<string, string>;
  no_sku_families?: string[];
  defaults?: Record<string, DefaultSpec>;
  derive_when_none?: DeriveWhenNone[];
  /** SLICE 8 (owner M-b): the overrides, applied AFTER the defaults and `derive_when_none` so they win over
   * both. ABSENT => nothing overrides and every row is byte-identical to before this slice. */
  override_when?: OverrideWhen[];
  /** SLICE 9 (owner A-4): the second-key rules. ABSENT => nothing resolves and every row is unchanged. */
  second_key?: SecondKey[];
  numbers: Record<string, NumberReader>;
  ladders: string[];
  match_attrs: string[];
  choice_attrs: string[];
  reason_names?: Record<string, string>;
  families: Record<string, FamilySpec>;
  /** SLICE 6d (owner ruling "yes ask the question"): the per-item attribute the MODEL answers with how many of
   * this item make ONE unit of the row -- `list_spec.qty_attribute_id`, filled by `itemListPricingSpec` from the
   * config (the pricing block never names it: a count is not a SKU attribute and must never be a dropdown).
   * ABSENT => nothing is read and every item keeps code's 1, exactly as before this slice. */
  qty_attribute_id?: string;
  /** SLICE 6 (T7): the config's OWN `pipelines` -- the shared per-item default every unit block without
   * pipelines of its own runs. Filled by `itemListPricingSpec` from the config; never stored in the block. */
  default_pipelines?: Record<string, Pipeline>;
  /** SLICE 6b (owner V1, V4, V5): the panel's control PER SKU ATTRIBUTE -- "dropdown" (options built from the
   * ACTIVE SKUs of the block's family, or from the definition's closed vocabulary where no SKU carries it) or
   * "text" (a BoQ measurement the sheet does not stock as a pick). Declared in CONFIG, never in code; absent =
   * today's controls (a choice def a select, a number a text input). This block never reaches the model. */
  panel_controls?: Record<string, PanelControl>;
}

export type PanelControl = "dropdown" | "text";

/** Read the block off a config; null when the config does not declare it. PURE. */
export function itemListPricingSpec(config: RateCategoryConfig | null | undefined): ItemListPricingSpec | null {
  const spec = (config as { list_spec?: { pricing?: unknown } } | null | undefined)?.list_spec?.pricing;
  if (!spec || typeof spec !== "object") return null;
  const p = spec as Partial<ItemListPricingSpec>;
  if (typeof p.kind !== "string" || !p.unit_classes || !p.families || !p.numbers) return null;
  // SLICE 6 (T7): the config's own pipelines ride along as the shared per-item default. A copy, so the
  // block object the config holds is never written into.
  const pipelines = (config as RateCategoryConfig).pipelines ?? {};
  // SLICE 6d: the count's attribute id lives on `list_spec` beside the family's, NOT in the pricing block --
  // carried in here so the module reads ONE object (the `default_pipelines` precedent).
  const qtyAttr = (config as { list_spec?: { qty_attribute_id?: unknown } } | null | undefined)?.list_spec?.qty_attribute_id;
  return {
    ...(spec as ItemListPricingSpec),
    default_pipelines: pipelines,
    ...(typeof qtyAttr === "string" && qtyAttr ? { qty_attribute_id: qtyAttr } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------
// inputs / outputs
// ---------------------------------------------------------------------------------------------------------

/** One extracted item as the run stores it: `items[i].attributes[attr] = {value, confidence}`. */
export interface ExtractedListItem {
  attributes: Record<string, { value: string | number | null; confidence?: number }>;
  /** SLICE 6 (T4, the owner's unit-rate ruling): how many of this item ONE row unit pays for. Absent => 1.
   * Blank / non-numeric / non-positive => the item refuses ("quantity per row unit is blank"). */
  qtyPerRowUnit?: number | string | null;
}

export interface DefaultedAttr {
  attr: string;
  value: string;
  rule: string;
}

export interface LadderHop {
  attr: string;
  name: string;
  requested: number;
  fitted: number;
  exact: boolean;
}

export interface ItemPriceResult {
  index: number;
  /** The family the model returned (may be an alias or "none of these"). */
  familyRaw: string | null;
  /** The family that priced (after R3's alias). */
  family: string | null;
  /** The SKU unit class the pipelines ran against (after any conversion). */
  skuUnitClass: string | null;
  state: "priced" | "blank";
  reason?: string;
  /** What reached the interpreter, after defaults, parsing and ladder fits. */
  selection: Record<string, string | number>;
  defaulted: DefaultedAttr[];
  ladderHops: LadderHop[];
  /** SLICE 9 (owner A-6): the overrides that FIRED on this item, with the word the panel shows for each. */
  overrides: Array<{ attr: string; value: string; display: string; rule: string }>;
  /** The conversion the row's unit needed (R4 / R11 / R16), or null. */
  conversion: { rule: string; to: string } | null;
  sku: { item_uid?: string; item_name?: string; item_detail?: string; unit?: string } | null;
  /** The per-UNIT figures the pipelines produced (before the quantity). */
  finals: Record<string, number>;
  /** SLICE 6 (T4): the quantity per row unit applied to `finals` to give `figures` (1 when absent). */
  qty: number;
  /** SLICE 6d: the quantity is CODE's default of 1 -- the row states none (the model answered "None" or was
   * never asked) and the pricer typed none. The panel marks such a field amber, like every other default. */
  qtyDefaulted: boolean;
  /** SLICE 6 (T4): `finals` x `qty` -- what this item contributes to the row. */
  figures: Record<string, number>;
  working: string[];
  pipelineResults: PipelineResult[];
}

export interface RowPriceResult {
  unit: string;
  unitClass: string | null;
  priced: boolean;
  reason?: string;
  supply?: number;
  install?: number;
  items: ItemPriceResult[];
}

// ---------------------------------------------------------------------------------------------------------
// units (R12)
// ---------------------------------------------------------------------------------------------------------

function normUnit(u: string): string {
  return u.trim().toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ");
}

/** The unit class of a unit string against the config table, or null when unknown; "" is its own case. PURE.
 * SLICE 11: a `unit_factors` spelling belongs to the class it declares, so it resolves here too -- the class
 * is what picks the SKUs; the factor (below) is what converts their rate. */
export function unitClassOf(spec: ItemListPricingSpec, unit: string | null | undefined): string | null {
  if (unit === null || unit === undefined || unit.trim() === "") return null;
  const u = normUnit(unit);
  for (const [cls, spellings] of Object.entries(spec.unit_classes)) {
    if (spellings.some((s) => normUnit(s) === u)) return cls;
  }
  const f = unitFactorOf(spec, unit);
  return f ? f.class : null;
}

/** SLICE 11: the declared conversion for a unit string, or null when it declares none (a synonym, or unknown).
 * A `unit_classes` spelling ALWAYS wins -- a unit is declared in one place only, and the validator refuses a
 * spelling that appears in both. PURE. */
export function unitFactorOf(spec: ItemListPricingSpec, unit: string | null | undefined): UnitFactor | null {
  if (unit === null || unit === undefined || unit.trim() === "") return null;
  const u = normUnit(unit);
  for (const spellings of Object.values(spec.unit_classes)) {
    if (spellings.some((s) => normUnit(s) === u)) return null;
  }
  for (const [spelling, d] of Object.entries(spec.unit_factors ?? {})) {
    if (normUnit(spelling) === u && d && typeof d.factor === "number" && d.factor > 0 && d.class in spec.unit_classes) {
      return d;
    }
  }
  return null;
}

function unitWord(spec: ItemListPricingSpec, cls: string): string {
  return spec.unit_words?.[cls] ?? cls;
}

// ---------------------------------------------------------------------------------------------------------
// the number readers (R6, R16, R17) -- the model copies text AS WRITTEN; code reads it
// ---------------------------------------------------------------------------------------------------------

export type NumberRead = { value: number; note?: string } | { blank: string } | null;

const NUM_RE = /\d+(?:\.\d+)?/g;

interface Found { n: number; start: number; end: number }

function numbersIn(s: string): Found[] {
  const out: Found[] = [];
  for (const m of s.matchAll(NUM_RE)) out.push({ n: Number(m[0]), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return out;
}

// SLICE 9 (owner A-1) -- ONE SIZE FIELD. A BoQ writes a size as a single phrase ("525 x 525 x 450 mm",
// "600X600", "1100(W) X 250(D) X 400(H)"), so the model is asked for it ONCE, as written, and CODE splits it
// into width / height / depth. The splitter is deliberately narrow: it recognises an x-joined phrase of two or
// three parts, each holding exactly one number, and NOTHING else. Anything it does not recognise is handed
// back to the ordinary reader, which refuses it BY NAME -- it never guesses, and it never invents an axis the
// phrase does not state.
//
// AXIS LABELS ARE LOAD-BEARING, and only when EVERY part carries one. Measured on rows that priced correctly
// before this slice: "1100(W) X 250(D) X 400(H)" is width 1100, height 400, depth 250 -- a positional split
// swaps the last two and prices plausibly WRONG. But "600X1200x 400 mm High" labels only its LAST part, where
// "High" means the third dimension and not "this is the height"; reading a lone label there would drop the
// 1200. So: all parts labelled and the labels a permutation of the axes -> order by label; otherwise -> order
// as written.
const _AXIS_PATTERNS: Array<{ re: RegExp; axis: number }> = [
  { re: /(^|[^a-z])(?:w|wide|width)([^a-z]|$)/i, axis: 0 },
  { re: /(^|[^a-z])(?:h|ht|hgt|high|height)([^a-z]|$)/i, axis: 1 },
  { re: /(^|[^a-z])(?:d|deep|depth|l|long|length)([^a-z]|$)/i, axis: 2 },
];

/** SLICE 11: the gap between two numbers that makes them an ALTERNATIVE PAIR -- a BARE slash, optionally
 * carrying the unit. Deliberately narrow: a sign beside it ("+/-") is a tolerance, not an alternative. */
function isAltPair(gap: string): boolean {
  return /^\s*(mm|nm|n-m|sqm|sq\.?m)?\s*\/\s*$/.test(gap);
}

/** SLICE 11: is this one part of an x-joined size phrase a single number, or an alternative pair code can
 * resolve? Two numbers joined by a bare slash are readable (the higher wins, in `readNumber`); anything else
 * with more than one number is a list this splitter does not read. PURE. */
function partIsReadable(part: string): boolean {
  const found = numbersIn(part.toLowerCase());
  if (found.length === 1) return true;
  if (found.length !== 2) return false;
  return isAltPair(part.toLowerCase().slice(found[0].end, found[1].start));
}

/** The axis a size part names, or null when it names none. A part is stripped of its number and unit first,
 * so "450 mm" names nothing while "400 mm High" names the depth slot and "250(D)" names it too. PURE. */
function axisOf(part: string): number | null {
  const tail = part.replace(/[\d.]+/g, " ").replace(/(?:mm|cm|m|mtr|mtrs|metre|meter|nos?|no)/gi, " ");
  const hit = _AXIS_PATTERNS.filter((a) => a.re.test(tail));
  return hit.length === 1 ? hit[0].axis : null;
}

/**
 * Split a size written as ONE phrase into its parts, ordered width, height, depth. PURE.
 * Returns null when the text is not a clean x-joined phrase of two or three single-number parts -- a list
 * ("100/150/200 mm"), a range, a bare number, or a labelled set that is not a permutation of the axes.
 */
export function splitSizePhrase(text: string | number | null | undefined): string[] | null {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  if (raw === "" || raw === "None") return null;
  const parts = raw.split(/\s*[x×*]\s*/i).map((p) => p.trim()).filter((p) => p !== "");
  // ONE part that NAMES ITS AXIS is not a width: a per-metre grille row saying only "250 mm high" states a
  // HEIGHT and nothing else, and reading it as a width both loses the height and invents a width. The earlier
  // slots come back EMPTY, which the reader reads as NOT STATED. A one-part size with NO label keeps the
  // owner's ruling: it is the width, and a family that also needs a height refuses.
  if (parts.length === 1) {
    if (!partIsReadable(parts[0])) return null;
    const axis = axisOf(parts[0]);
    if (axis === null || axis === 0) return null;
    const out = new Array(axis + 1).fill("");
    out[axis] = parts[0];
    return out;
  }
  if (parts.length < 2 || parts.length > 3) return null;
  // every part must be one number, or (SLICE 11) an ALTERNATIVE PAIR code resolves to its higher value:
  // "100/150/200 mm/600mm x 600mm" is a list, not a size, and still returns null here.
  for (const p of parts) if (!partIsReadable(p)) return null;
  const axes = parts.map(axisOf);
  if (axes.every((a) => a !== null)) {
    const want = parts.map((_, i) => i);
    const got = [...(axes as number[])].sort((a, b) => a - b);
    if (got.length === want.length && got.every((a, i) => a === want[i])) {
      const out: string[] = new Array(parts.length);
      parts.forEach((p, i) => { out[axes[i] as number] = p; });
      return out;
    }
    return null;   // labelled, but not the axes this phrase has slots for -- ambiguous, so not a phrase
  }
  return parts;
}

/** Read one number from as-written text under a reader's rules. PURE.
 *   null              -> not stated (blank / null / the "None" sentinel)
 *   { value, note? }  -> the number, with a note when a range was resolved to its top or a unit was scaled
 *   { blank: reason } -> stated but unusable, with the owner-language reason (never a guess) */
export function readNumber(text: string | number | null | undefined, reader: NumberReader): NumberRead {
  if (text === null || text === undefined) return null;
  // SLICE 9 (A-1): this reader is ONE AXIS of a one-phrase size. Split, then read that axis with the very
  // same rules as any other number, so ranges, units, rejections and their wordings are all unchanged.
  if (typeof reader.component === "number") {
    const { component, ...plain } = reader;
    const parts = splitSizePhrase(text);
    if (parts) return component - 1 < parts.length ? readNumber(parts[component - 1], plain) : null;
    // not a phrase this splitter reads: the FIRST axis is whatever the ordinary reader makes of the whole
    // text (a bare "600" is a width, "100/150" is its named refusal); the later axes are simply NOT STATED.
    return component === 1 ? readNumber(text, plain) : null;
  }
  if (typeof text === "number") return Number.isFinite(text) ? { value: text } : { blank: `${reader.name} is not a number` };
  const raw = String(text).trim();
  if (raw === "" || raw === "None") return null;
  // parenthesised qualifiers are dropped: "10NM (up to 1.6 sqm)" -> "10NM", "1100(W)" -> "1100"
  const s = raw.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (s === "") return { blank: `no number in '${raw}' for ${reader.name}` };
  const tokens = s.split(/[^a-z0-9.]+/).filter(Boolean);
  for (const t of reader.reject_tokens ?? []) {
    // a bare token ("g", "gi") or one glued to a number ("26g", "20gi")
    if (tokens.includes(t) || tokens.some((tk) => /^\d/.test(tk) && tk.replace(/^[\d.]+/, "") === t)) {
      return { blank: `${reader.name} stated as '${raw}' -- a gauge, not a thickness` };
    }
  }
  if (/\b(inch|inches)\b|"|\b\d+(\.\d+)?\s*in\b/.test(s)) return { blank: `${reader.name} stated in inches ('${raw}')` };
  if (reader.unit === "sqm" && /sq\.?\s?ft|sqft|square\s?feet/.test(s)) return { blank: `${reader.name} stated in square feet ('${raw}')` };

  // R17 / a ratio: "1:6" -> 6; anything else numeric beside it is a second value
  if (reader.ratio) {
    const ratios = [...s.matchAll(/1\s*:\s*(\d+(?:\.\d+)?)/g)];
    if (ratios.length > 1) return { blank: `several values stated for ${reader.name} ('${raw}')` };
    if (ratios.length === 1) {
      const rest = s.replace(ratios[0][0], " ");
      if (numbersIn(rest).length) return { blank: `several values stated for ${reader.name} ('${raw}')` };
      return { value: Number(ratios[0][1]) };
    }
  }

  const found = numbersIn(s);
  if (found.length === 0) return { blank: `no number in '${raw}' for ${reader.name}` };
  const scale = (f: Found): { value: number; note?: string } => {
    const after = s.slice(f.end);
    if (reader.unit === "mm") {
      if (/^\s*(m|mtr|mtrs|metre|meter)\b/.test(after) && !/^\s*mm/.test(after)) return { value: f.n * 1000, note: `${f.n} m read as ${f.n * 1000} mm` };
      if (/^\s*cm\b/.test(after)) return { value: f.n * 10, note: `${f.n} cm read as ${f.n * 10} mm` };
    }
    return { value: f.n };
  };
  const below = (v: { value: number; note?: string }): NumberRead =>
    typeof reader.reject_below === "number" && v.value < reader.reject_below
      ? { blank: `${reader.name} stated as '${raw}' -- below ${reader.reject_below} ${reader.unit ?? ""}, a sheet gauge, not a thickness`.replace(/\s+,/, ",") }
      : v;
  if (found.length === 1) return below(scale(found[0]));

  // more than one number: a DIMENSION pair ("300 x 300"), a RANGE ("10-12", "10 to 12"), or SEVERAL values
  // ("4, 8, 10", "9/10", "3.5, 7.9 & 15.9") -- "up to 1.6" is ONE number and never lands here
  const gaps: string[] = [];
  for (let i = 0; i < found.length - 1; i++) gaps.push(s.slice(found[i].end, found[i + 1].start));
  const isDim = (g: string) => /^\s*(mm)?\s*(x|\*|\u00d7)\s*$/.test(g);
  const isRange = (g: string) => /^\s*(mm|nm|n-m|sqm|sq\.?m)?\s*(-|\u2013|to)\s*$/.test(g);
  if (gaps.every(isDim)) {
    if (!reader.square) return { blank: `${reader.name} stated as a size '${raw}', not a single number` };
    if (found.length === 2 && found[0].n === found[1].n) return below(scale(found[1]));
    return { blank: `${reader.name} '${raw}' is not a single square size` };
  }
  if (found.length === 2 && isRange(gaps[0])) {
    const top = found[0].n >= found[1].n ? found[0] : found[1];
    const sc = scale(top);
    return below({ value: sc.value, note: `range '${raw}' -> its top value ${sc.value} (R6)` });
  }
  // SLICE 11 (owner ruling, 2026-09-25): an ALTERNATIVE written as a SLASH PAIR takes the HIGHER value,
  // consistent with the next-size-up ladder and the area band. EXACTLY TWO numbers joined by a BARE slash --
  // three values ("6/8 / 10 Port") and a comma list ("3.5, 7.9 & 15.9 Nm") are not a pair and keep refusing
  // by name, and a TOLERANCE ("25 +/- 2 mm") is not an alternative, which is why the gap must be a bare
  // slash and never one carrying a sign.
  if (found.length === 2 && isAltPair(gaps[0])) {
    const hi = found[0].n >= found[1].n ? found[0] : found[1];
    const sc = scale(hi);
    return below({ value: sc.value, note: `'${raw}' states two values -- the higher, ${sc.value}, is taken` });
  }
  return { blank: `several values stated for ${reader.name} ('${raw}')` };
}

// ---------------------------------------------------------------------------------------------------------
// the projection (read-time, in memory, never written back)
// ---------------------------------------------------------------------------------------------------------

/** Copy each item of the spec's kind with its unit CLASS projected into `attributes[unit_class_attr]`.
 * Items whose unit is not in the table are left without the key (they can never match a classed selection). PURE. */
export function projectUnitClass(spec: ItemListPricingSpec, items: RateMasterItem[]): RateMasterItem[] {
  return items.map((it) => {
    if (it.kind !== spec.kind) return it;
    const cls = unitClassOf(spec, it.unit);
    if (cls === null) return it;
    return { ...it, attributes: { ...it.attributes, [spec.unit_class_attr]: cls } };
  });
}

// ---------------------------------------------------------------------------------------------------------
// pricing
// ---------------------------------------------------------------------------------------------------------

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));

function reasonName(spec: ItemListPricingSpec, attr: string): string {
  return spec.reason_names?.[attr] ?? spec.numbers[attr]?.name ?? attr;
}

/** The short label for a key inside a "no SKU for this combination" description. */
function shortName(spec: ItemListPricingSpec, attr: string): string {
  return spec.numbers[attr]?.name ?? attr;
}

function rawValue(item: ExtractedListItem, id: string): string | number | null {
  const cell = item.attributes?.[id];
  if (!cell) return null;
  const v = cell.value;
  return v === undefined || v === null || v === "" ? null : v;
}

/** The owner-language reason behind a pipeline that did not price. PURE. */
function reasonFromPipeline(spec: ItemListPricingSpec, family: string, sel: Record<string, string | number>, r: PipelineResult): string {
  const last = r.steps[r.steps.length - 1];
  const label = last?.label ?? "";
  const cond = last?.matchedCondition ?? "";
  if (last?.step === "match_master_row" && r.status === "no_match") {
    const keys = Object.keys(sel).filter((k) => k !== "family" && k !== spec.unit_class_attr);
    const desc = keys.map((k) => `${shortName(spec, k)} ${String(sel[k])}`).join(", ");
    return `no SKU for this combination (${family}${desc ? ": " + desc : ""})`;
  }
  const m = label.match(/^attribute '([^']+)' missing or non-numeric/);
  if (m) return `no ${reasonName(spec, m[1])} stated`;
  if (/matching row\(s\) -- not computed/.test(cond)) return `no base per-sq.m SKU for ${family} to derive from`;
  if (/not available on this row/.test(label)) return `the SKU carries no ${label.split(" ")[0].replace("cost_", "")} cost`;
  if (/not on the referenced row/.test(cond)) return `the base SKU carries no ${cond.split(" ")[0].replace("cost_", "")} cost`;
  return `could not compute (${cond || label})`;
}

function priceOneItem(
  spec: ItemListPricingSpec,
  projected: RateMasterItem[],
  rowUnitClass: string,
  item: ExtractedListItem,
  index: number,
  /** SLICE 11: the row unit's declared conversion, or null when it is a plain spelling of its class. */
  unitFactor: UnitFactor | null = null,
): ItemPriceResult {
  const out: ItemPriceResult = {
    index, familyRaw: null, family: null, skuUnitClass: null, state: "blank", selection: {}, defaulted: [],
    ladderHops: [], overrides: [], conversion: null, sku: null, finals: {}, qty: 1, qtyDefaulted: true, figures: {},
    working: [], pipelineResults: [],
  };
  const blank = (reason: string): ItemPriceResult => ({ ...out, state: "blank", reason });

  // SLICE 6d (owner ruling "yes ask the question"): the count the MODEL read from the row. It is RESOLVED here
  // -- before anything can refuse -- so the figure and its marking are right even on an item that blanks for
  // another reason; the REFUSAL of a blank or non-positive TYPED value stays exactly where slice 6 put it, so
  // no blank reason changes order. "None" (the row says nothing), an unreadable answer and no answer at all all
  // leave CODE's default of 1 standing, MARKED -- the model reads facts, code applies defaults. Measured before
  // shipping: over 42 items of the live corpus, including every capacity, slot count and panel variant in it,
  // the model answered "None" every time and invented no count.
  const statedQty = spec.qty_attribute_id ? rawValue(item, spec.qty_attribute_id) : null;
  if (statedQty !== null && statedQty !== "None") {
    const n = typeof statedQty === "number" ? statedQty : Number(String(statedQty).trim());
    if (Number.isFinite(n) && n > 0) {
      out.qty = n;
      out.qtyDefaulted = false;
    }
  }

  // (1) the family: absent = no ADP kind (R8); an alias prices as its target (R3); no SKU = blank (R18)
  const famRaw = rawValue(item, "family");
  out.familyRaw = famRaw === null ? null : String(famRaw);
  if (out.familyRaw === null || out.familyRaw === "None") return blank("no ADP kind could be told for this item");
  const family = spec.family_alias?.[out.familyRaw] ?? out.familyRaw;
  out.family = family;
  if (spec.family_alias?.[out.familyRaw]) out.working.push(`'${out.familyRaw}' prices as ${family} (R3)`);
  if ((spec.no_sku_families ?? []).includes(out.familyRaw) || !spec.families[family]) {
    return blank(`no SKU in the catalogue for '${out.familyRaw}' -- the user decides (R18)`);
  }
  const fam = spec.families[family];

  // (2) the facts: stated -> as stated; "None" -> the ruled default (marked); absent -> omitted. Read over every
  //     match attribute; only the family's NEEDS reach the matcher (below), so a stated fact the SKUs are not
  //     keyed on -- a diffuser's OUTER size beside its neck (R6) -- can never refuse a row.
  const read: Record<string, string | number> = {};
  const readDefaulted: DefaultedAttr[] = [];
  const unreadable: Record<string, string> = {};
  const noneSaid = new Set<string>();
  const notes: string[] = [];
  for (const attr of spec.match_attrs) {
    const reader = spec.numbers[attr];
    if (reader) {
      let got: NumberRead = null;
      for (const src of reader.from) {
        got = readNumber(rawValue(item, src), reader);
        if (got !== null) break;
      }
      if (got === null) continue;
      if ("blank" in got) { unreadable[attr] = got.blank; continue; }
      read[attr] = got.value;
      if (got.note) notes.push(`${reader.name}: ${got.note}`);
      continue;
    }
    let v = rawValue(item, attr);
    // SLICE 6 (S6): a default declaring `absent_as_none` reads an ABSENT answer as "None" -- UL only, by config.
    if (v === null && spec.defaults?.[attr]?.absent_as_none === true) v = "None";
    if (v === null) continue;
    if (v === "None") {
      noneSaid.add(attr);
      const d = spec.defaults?.[attr];
      const dv = d ? (d.by_family ? d.by_family[family] : d.value) : undefined;
      if (dv !== undefined) {
        read[attr] = dv;
        readDefaulted.push({ attr, value: dv, rule: d!.rule });
      }
      continue;
    }
    read[attr] = v;
  }
  // R13: a derived default ("supply air" -> with damper on the linear / plain grille), ONLY over a "None"
  for (const rule of spec.derive_when_none ?? []) {
    if (!rule.families.includes(family) || !noneSaid.has(rule.attr)) continue;
    if (String(rawValue(item, rule.when.attr) ?? "") !== rule.when.equals) continue;
    read[rule.attr] = rule.then;
    const i = readDefaulted.findIndex((d) => d.attr === rule.attr);
    if (i >= 0) readDefaulted.splice(i, 1);
    readDefaulted.push({ attr: rule.attr, value: rule.then, rule: rule.rule });
  }
  // SLICE 8 (owner M-b): the OVERRIDES -- a stated fact that decides the pick whatever else the row said.
  // It runs LAST over the reads, so it wins over both a stated value and a ruled default (a fire damper row
  // that mentions UL takes the UL SKU even when it also says motorised / with sleeve / without sleeve).
  // It fires ONLY when it CHANGES something, so a row already on that value keeps its trace byte-identical;
  // and the DEFAULT record it supersedes is dropped, because the value is no longer the default's.
  const overridden: string[] = [];
  for (const rule of spec.override_when ?? []) {
    if (!rule.families.includes(family)) continue;
    // the CONDITION reads `read`, not the raw answer: what the pricing believes after the defaults is what
    // must decide, so a ruled default can never be overridden by a fact nobody stated (an absent UL reads as
    // the non-UL default under S6, and therefore does not fire).
    if (String(read[rule.when.attr] ?? "") !== rule.when.equals) continue;
    if (String(read[rule.attr] ?? "") === rule.then) continue;
    read[rule.attr] = rule.then;
    const i = readDefaulted.findIndex((d) => d.attr === rule.attr);
    if (i >= 0) readDefaulted.splice(i, 1);
    overridden.push(rule.rule);
    // SLICE 9 (A-6): recorded STRUCTURALLY as well as in the working, so the panel can show the catalogue's
    // own word for what the row now prices as instead of the variant the row happened to name.
    out.overrides.push({ attr: rule.attr, value: rule.then, display: rule.display ?? rule.then, rule: rule.rule });
  }
  const sel: Record<string, string | number> = { family };

  // (3) the SKU unit class: the family's own rows for the row's unit, else a declared conversion (R4 / R11 / R16),
  //     else no SKU per that unit
  let unit: UnitPricing | undefined = fam.units[rowUnitClass];
  let target = rowUnitClass;
  let needs = [...fam.needs];
  if (unit) {
    needs.push(...(unit.needs ?? []));
    // SLICE 6 (T7): a block without pipelines of its own runs the config's shared per-item default
    if (!unit.pipelines) unit = { ...unit, pipelines: spec.default_pipelines };
  } else {
    const options = fam.convert?.[rowUnitClass] ?? [];
    const chosen = options.find((o) => o.needs.every((n) => n in read));
    if (chosen) {
      unit = { pipelines: chosen.pipelines };
      target = chosen.to;
      needs.push(...chosen.needs);
      out.conversion = { rule: chosen.rule, to: chosen.to };
      out.working.push(chosen.rule);
    } else if (options.length) {
      const wanted = options.map((o) => o.needs.map((n) => reasonName(spec, n)).join(" and ")).join(", or ");
      const bad = options.flatMap((o) => o.needs).map((n) => unreadable[n]).find(Boolean);
      return blank(bad ?? `per-${unitWord(spec, rowUnitClass)} row: no ${wanted} stated to convert the per-${unitWord(spec, options[0].to)} rate`);
    } else {
      return blank(`no SKU per ${unitWord(spec, rowUnitClass)} for ${family}`);
    }
  }
  sel[spec.unit_class_attr] = target;
  out.skuUnitClass = target;
  needs = [...new Set(needs)];

  // (3b) SLICE 9 (owner A-4) -- THE SECOND KEY. A diffuser's OUTER size sits beside its neck: a key, never a
  //      replacement. The four cases are the owner's, in order:
  //        neck stated, outer not  -> nothing happens here; the ladder runs exactly as before;
  //        BOTH stated             -> the outer NARROWS the SKUs the neck then ladders over;
  //        outer stated, neck not  -> the outer stands in: the only SKU behind it is ADOPTED AS IT STANDS
  //                                   (its own damper included, named in the working), else the LARGEST neck;
  //        neither                 -> nothing happens; the row refuses for the neck, exactly as before.
  //      A stated pair matching NO SKU is SET ASIDE with a visible note and the neck prices the row -- a
  //      catalogue that does not stock an outer must never stop a row whose neck it does stock.
  //      The resolution CANONICALISES the stated pair onto the SKU's OWN stored values, which is what keeps
  //      every mechanism below it -- the ladder narrowing, `match_master_row`, the panel -- byte-unchanged.
  const skRule = (spec.second_key ?? []).find((r) => r.families.includes(family));
  if (skRule && skRule.key.every((k) => k in read)) {
    const famRows = projected.filter(
      (it) => it.kind === spec.kind && it.attributes.family === family && it.attributes[spec.unit_class_attr] === target,
    );
    const stated = skRule.key.map((k) => Number(read[k]));
    const statedText = stated.map(fmt).join("x");
    const on = (it: RateMasterItem, attrs: string[]) =>
      attrs.length === stated.length && attrs.every((a, i) => typeof it.attributes[a] === "number" && Number(it.attributes[a]) === stated[i]);
    const direct = famRows.filter((it) => on(it, skRule.key));
    // A-5: the catalogue's ALTERNATIVE wording of the same size. It is the SHEET that says the two names are
    // one product; nothing here says one number is near enough to another.
    const viaAlt = direct.length ? [] : famRows.filter((it) => skRule.alt_key !== undefined && on(it, skRule.alt_key));
    let matches = direct.length ? direct : viaAlt;
    if (!matches.length) {
      for (const k of skRule.key) delete read[k];
      out.working.push(`the ${skRule.name} ${statedText} did not match the catalogue -- matched on the ${reasonName(spec, skRule.primary)} instead (A-4)`);
    } else {
      const canon = skRule.key.map((k) => Number(matches[0].attributes[k]));
      matches = matches.filter((it) => skRule.key.every((k, i) => Number(it.attributes[k]) === canon[i]));
      skRule.key.forEach((k, i) => { read[k] = canon[i]; });
      needs.push(...skRule.key);
      const canonText = canon.map(fmt).join("x");
      if (!direct.length) out.working.push(`the ${skRule.name} ${statedText} is the sheet's ${canonText} (A-5)`);
      if (!(skRule.primary in read)) {
        // narrow by the other facts the row DID state, so a damper or a variant still counts
        let pool = matches;
        for (const n of needs) {
          if (n === skRule.primary || skRule.key.includes(n) || !(n in read)) continue;
          const narrowed = pool.filter((it) => !(n in it.attributes) || sameValue(it.attributes[n], read[n]));
          if (narrowed.length) pool = narrowed;
        }
        if (pool.length === 1) {
          // "use it since it is only one" (owner A-4, confirmed): ADOPT that SKU as it stands. A need the SKU
          // does not carry is dropped (the 1200x300 diffuser has no neck); a need it carries is taken FROM it,
          // and any value that changes is NAMED, so a pricer can see the fact came from the SKU and not the row.
          const sku = pool[0];
          const kept: string[] = [];
          const fromSku: string[] = [];
          for (const n of needs) {
            const v = sku.attributes[n];
            if (v === undefined || v === null) continue;
            if (!(n in read) || !sameValue(v, read[n])) {
              fromSku.push(`${reasonName(spec, n)} ${String(v)}`);
              const di = readDefaulted.findIndex((d) => d.attr === n);
              if (di >= 0) readDefaulted.splice(di, 1);
            }
            read[n] = v as string | number;
            kept.push(n);
          }
          needs = kept;
          out.working.push(
            `only one SKU carries the ${skRule.name} ${canonText} -- used it` +
            (fromSku.length ? ` (${fromSku.join(", ")} taken from that SKU)` : "") + " (A-4)",
          );
        } else {
          const withPrimary = pool.filter((it) => typeof it.attributes[skRule.primary] === "number");
          if (withPrimary.length) {
            const best = Math.max(...withPrimary.map((it) => Number(it.attributes[skRule.primary])));
            read[skRule.primary] = best;
            out.working.push(
              `matched on the ${skRule.name} ${canonText}; largest ${reasonName(spec, skRule.primary)} behind it is ${fmt(best)} (A-4)`,
            );
          }
        }
      }
    }
    needs = [...new Set(needs)];
  }

  // (4) the needs (R7-R10, R2): the first missing one names the blank; only the needed facts reach the matcher
  for (const n of needs) {
    if (n in read) { sel[n] = read[n]; continue; }
    if (unreadable[n]) return { ...blank(unreadable[n]), selection: sel };
    return { ...blank(spec.choice_attrs.includes(n) ? `could not tell ${reasonName(spec, n)}` : `no ${reasonName(spec, n)} stated`), selection: sel };
  }
  out.defaulted = readDefaulted.filter((d) => needs.includes(d.attr));

  // (5) the ladders (R6): the family's rows of the target class that carry the attribute, narrowed by the
  //     other stated keys those rows carry; exact else next up; above the largest = refuse
  const familyRows = projected.filter(
    (it) => it.kind === spec.kind && it.attributes.family === family && it.attributes[spec.unit_class_attr] === target,
  );
  const keysCarried = new Set<string>();
  for (const it of familyRows) for (const k of Object.keys(it.attributes)) keysCarried.add(k);
  let candidates = projected;
  for (const attr of spec.ladders) {
    if (!(attr in sel) || !needs.includes(attr)) continue;
    const where: Record<string, string | number> = { family, [spec.unit_class_attr]: target };
    for (const k of Object.keys(sel)) {
      if (k === attr || k === "family" || k === spec.unit_class_attr || spec.ladders.includes(k)) continue;
      if (keysCarried.has(k)) where[k] = sel[k];
    }
    const rungs = buildModuleLadder(familyRows, { kind: spec.kind, where, size_from: { attr }, label_attr: "item_detail" });
    const name = reasonName(spec, attr);
    const want = Number(sel[attr]);
    if (!rungs.length) {
      const desc = Object.entries(where).filter(([k]) => k !== "family" && k !== spec.unit_class_attr).map(([k, v]) => `${shortName(spec, k)} ${String(v)}`).join(", ");
      return { ...blank(`no SKU for this combination (${family}${desc ? ": " + desc : ""})`), selection: sel };
    }
    const fit = fitModuleLadder(rungs, want, "up");
    if (!fit) {
      const top = rungs[rungs.length - 1];
      return { ...blank(`${name} ${fmt(want)} is above the largest size on the sheet (${fmt(top.size)})`), selection: sel };
    }
    out.ladderHops.push({ attr, name, requested: want, fitted: fit.modules, exact: fit.exact });
    if (!fit.exact) {
      out.working.push(`${name} ${fmt(want)} is not on the sheet -> ${fmt(fit.modules)} (next size up, R6)`);
      sel[attr] = fit.modules;
    }
    // a SKU without the ladder attribute is not on the ladder and must not match a laddered selection
    candidates = candidates.filter(
      (it) => !(it.kind === spec.kind && it.attributes.family === family && it.attributes[spec.unit_class_attr] === target && !(attr in it.attributes)),
    );
  }
  out.selection = { ...sel };
  out.working.push(...notes);
  // SLICE 8 (M-b): the override is shown as its own working line, in the config's words, so a pricer can see
  // that the variant the row stated was set aside and why.
  out.working.push(...overridden);
  for (const d of out.defaulted) out.working.push(`${d.attr} not mentioned -> ${d.value} (${d.rule})`);

  // SLICE 6 (T4): the quantity per row unit -- the PRICER's typed value, which always wins over the count the
  // model read (SLICE 6d) and over code's default; stated but unreadable / non-positive = blank.
  const qtyRaw = item.qtyPerRowUnit;
  let qty = out.qty;
  if (qtyRaw !== undefined && qtyRaw !== null && String(qtyRaw).trim() !== "") {
    const q = Number(String(qtyRaw).trim());
    if (!Number.isFinite(q) || q <= 0) return { ...blank(`quantity per row unit '${String(qtyRaw)}' is not a positive number`), selection: out.selection, defaulted: out.defaulted };
    qty = q;
    out.qtyDefaulted = false;
  } else if (qtyRaw === "" || qtyRaw === null) {
    return { ...blank("quantity per row unit is blank"), selection: out.selection, defaulted: out.defaulted };
  }
  out.qty = qty;

  // (6) the arithmetic: the interpreter, unchanged, over the declared pipelines (or the config's default)
  const results: PipelineResult[] = [];
  const finals: Record<string, number> = {};
  const pipelines = unit.pipelines ?? {};
  if (!Object.keys(pipelines).length) {
    return { ...blank("no pricing pipelines declared for this family and unit"), selection: out.selection, defaulted: out.defaulted };
  }
  for (const [id, pl] of Object.entries(pipelines)) {
    const r = runPipeline(id, pl, candidates, sel);
    results.push(r);
    if (r.status !== "ok") {
      return { ...blank(reasonFromPipeline(spec, family, sel, r)), selection: out.selection, ladderHops: out.ladderHops, working: out.working, pipelineResults: results, conversion: out.conversion, defaulted: out.defaulted, sku: r.matchedItem ? skuOf(r.matchedItem) : null };
    }
    for (const o of pl.output) {
      const v = r.finals[o];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        return { ...blank(reasonFromPipeline(spec, family, sel, r)), selection: out.selection, ladderHops: out.ladderHops, working: out.working, pipelineResults: results, conversion: out.conversion, defaulted: out.defaulted, sku: r.matchedItem ? skuOf(r.matchedItem) : null };
      }
      finals[o] = v;
    }
    if (!out.sku && r.matchedItem) out.sku = skuOf(r.matchedItem);
    for (const st of r.steps) {
      if (st.produced) out.working.push(`${id}: ${st.label} = ${fmt(st.produced.value)}`);
    }
  }
  // (6b) SLICE 11 (owner ruling, 2026-09-25) -- THE ROW UNIT'S CONVERSION FACTOR. The catalogue quotes this
  // class's rate in the class's own unit; the row is billed in a DIFFERENT unit of the same class. THE RATE IS
  // CONVERTED, NEVER THE QUANTITY: the class's rate x the factor, then today's rounding (the same ROUNDUP the
  // pipeline's last step applies), supply and install alike. It runs AFTER the pipeline so a declared family
  // `convert` option (R4 / R11 / R16) has already done its work and this composes on top of it.
  if (unitFactor) {
    for (const k of Object.keys(finals)) finals[k] = Math.ceil(finals[k] * unitFactor.factor);
    out.working.push(`per ${unitFactor.word}: ${unitWord(spec, unitFactor.class)} rate x ${unitFactor.factor}`);
  }
  const figures: Record<string, number> = {};
  for (const [k, v] of Object.entries(finals)) figures[k] = v * qty;
  if (qty !== 1) out.working.push(`x ${fmt(qty)} per row unit`);
  return { ...out, state: "priced", finals, figures, pipelineResults: results };
}

function skuOf(it: RateMasterItem): ItemPriceResult["sku"] {
  return {
    item_uid: it.item_uid,
    item_name: typeof it.attributes.item_name === "string" ? it.attributes.item_name : undefined,
    item_detail: typeof it.attributes.item_detail === "string" ? it.attributes.item_detail : undefined,
    unit: it.unit,
  };
}

/**
 * Price a row's item list. `items` is the catalogue (any kinds; only the spec's kind is projected and read),
 * `rowUnit` the BoQ row's unit text, `extracted` the run's stored item list for the row. PURE.
 */
export function priceItemList(
  spec: ItemListPricingSpec,
  items: RateMasterItem[],
  rowUnit: string | null | undefined,
  extracted: ExtractedListItem[] | null | undefined,
): RowPriceResult {
  const unit = rowUnit ?? "";
  const cls = unitClassOf(spec, unit);
  if (cls === null) {
    const reason = unit.trim() === "" ? "no unit on this row (R12)" : `unit '${unit.trim()}' is not a count, area or length unit (R12)`;
    return { unit, unitClass: null, priced: false, reason, items: [] };
  }
  if (!extracted || !extracted.length) {
    return { unit, unitClass: cls, priced: false, reason: "no items were read on this row", items: [] };
  }
  const projected = projectUnitClass(spec, items);
  // SLICE 11: computed ONCE from the row's unit TEXT (the class alone cannot say which unit of it this is).
  const unitFactor = unitFactorOf(spec, unit);
  const priced = extracted.map((it, i) => priceOneItem(spec, projected, cls, it, i, unitFactor));
  const firstBlank = priced.find((p) => p.state === "blank");
  if (firstBlank) {
    // R21: all or nothing -- the row shows no price; every item keeps its own state above
    const who = priced.length > 1 ? `item ${firstBlank.index + 1}${firstBlank.family ? ` (${firstBlank.family})` : ""}: ` : "";
    return { unit, unitClass: cls, priced: false, reason: `${who}${firstBlank.reason}`, items: priced };
  }
  const sum = (k: string) => priced.reduce((a, p) => a + (p.figures[k] ?? 0), 0);
  return { unit, unitClass: cls, priced: true, supply: sum("supply"), install: sum("install"), items: priced };
}

// ---------------------------------------------------------------------------------------------------------
// SLICE 6 -- what the PANEL needs to draw one item block, read from the SAME config (never a hard-coded list)
// ---------------------------------------------------------------------------------------------------------

/** A per-item attribute definition as the list_spec declares it (the model's question). */
export interface ListSpecDef {
  id: string;
  label: string;
  type: "choice" | "number" | "text";
  values?: string[];
  allow_none?: boolean;
  values_by_family?: Record<string, string[]>;
}

/** The list_spec's per-item definitions off a config, or [] (never throws). PURE. */
export function listSpecDefs(config: RateCategoryConfig | null | undefined): ListSpecDef[] {
  const defs = (config as { list_spec?: { attribute_definitions?: unknown } } | null | undefined)?.list_spec?.attribute_definitions;
  return Array.isArray(defs) ? (defs as ListSpecDef[]) : [];
}

/** The families a pricer may pick for an item -- every priceable family the block declares, in the block's
 * own order, with the unit(s) its SKUs are sold per ("per sq.m"). Aliases and no-SKU families are NOT
 * offered: they exist for the model's answer, not for a pick. PURE. */
export function familyChoices(spec: ItemListPricingSpec): Array<{ family: string; units: string }> {
  return Object.entries(spec.families).map(([family, f]) => ({
    family,
    units: Object.keys(f.units).map((cls) => `per ${unitWord(spec, cls)}`).join(" / "),
  }));
}

/** One field of an item block: the id the VALUE is read / written under (the model's attribute id -- a
 * number reader's first `from`), the label, the options of a choice (with "None" first when allow_none,
 * the Electrical shape), and which SKU attribute it serves. */
export interface ItemFieldDef {
  id: string;
  label: string;
  options?: string[];
  allowNone: boolean;
  /** The SKU attribute this field feeds (a `numbers` key or the choice attribute itself). */
  skuAttr: string;
  /** SLICE 6b: the control the config declares for this attribute (V5); "text" when it declares none for a
   * number, "dropdown" when it declares none for a choice -- exactly today's controls. */
  control: PanelControl;
  /** SLICE 6b: where a dropdown's options came from -- the active SKUs (V1, V4) or the definition's closed
   * vocabulary (an attribute no SKU carries, e.g. the air stream). Absent on a text field. */
  optionSource?: "catalogue" | "definition";
}

/**
 * SLICE 6b (V1, V4) -- PURE. The options a dropdown field offers, built from the ACTIVE SKUs of the block's family:
 * the family's rows of the class the row prices in (or of every class a conversion can reach), that carry the
 * attribute, NARROWED by the block's other answered dropdown attributes those rows carry -- the same rule the
 * ladder uses to pick its rungs (`priceOneItem` step 5) -- so a fire damper's torques narrow under UL vs non-UL
 * exactly as its price does. A narrowing that leaves nothing falls back to the family's full list (never an empty
 * select the pricer cannot re-pick from). Numbers are formatted as the ladder formats them and sorted ascending;
 * choices keep the definition's order. Adding a SKU adds its value with no code change.
 */
export function fieldOptionsFromSkus(
  spec: ItemListPricingSpec,
  items: RateMasterItem[],
  family: string,
  rowUnitClass: string | null | undefined,
  attr: string,
  answers: Record<string, string | number> = {},
  defOrder?: string[],
): string[] {
  const fam = spec.families[family];
  if (!fam) return [];
  const projected = projectUnitClass(spec, items);
  const cls = rowUnitClass ?? "";
  const classes = new Set<string>(
    fam.units[cls] ? [cls] : (fam.convert?.[cls] ?? []).map((o) => o.to),
  );
  const famRows = projected.filter(
    (it) => it.kind === spec.kind && it.attributes.family === family && (classes.size === 0 || classes.has(String(it.attributes[spec.unit_class_attr]))),
  );
  const carrying = famRows.filter((it) => attr in it.attributes);
  const isDropdown = (k: string) => (spec.panel_controls?.[k] ?? (spec.choice_attrs.includes(k) ? "dropdown" : "text")) === "dropdown";
  let rows = carrying;
  for (const [k, v] of Object.entries(answers)) {
    if (k === attr || v === "" || v === "None" || v === null || v === undefined || !isDropdown(k)) continue;
    if (!carrying.some((it) => k in it.attributes)) continue;
    rows = rows.filter((it) => sameValue(it.attributes[k], v));
  }
  if (!rows.length) rows = carrying;
  const isNumber = attr in spec.numbers;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of rows) {
    const raw = it.attributes[attr];
    const text = isNumber && typeof raw === "number" ? fmt(raw) : isNumber && !Number.isNaN(Number(raw)) ? fmt(Number(raw)) : String(raw);
    if (!seen.has(text)) { seen.add(text); out.push(text); }
  }
  if (isNumber) return out.sort((a, b) => Number(a) - Number(b));
  if (defOrder) return [...defOrder.filter((o) => seen.has(o)), ...out.filter((o) => !defOrder.includes(o))];
  return out.sort();
}

function sameValue(a: unknown, b: string | number): boolean {
  if (typeof a === "number" || !Number.isNaN(Number(a)) && String(a).trim() !== "") {
    const n = Number(b);
    return !Number.isNaN(n) && Number(a) === n;
  }
  return String(a) === String(b);
}

/**
 * The fields ONE item block shows, for its family on a row of this unit class: the family's needs, the
 * block's (or, when the row converts, every conversion option's) needs, and the source attribute of any
 * `derive_when_none` rule that applies to the family -- in that order, deduplicated. A family the block
 * does not price, or no family, gives []. PURE.
 */
export function itemFieldDefs(
  spec: ItemListPricingSpec,
  defs: ListSpecDef[],
  family: string | null | undefined,
  rowUnitClass: string | null | undefined,
  skus?: { items: RateMasterItem[]; answers?: Record<string, string | number> },
): ItemFieldDef[] {
  if (!family || !spec.families[family]) return [];
  const controlOf = (skuAttr: string, fallback: PanelControl): PanelControl => spec.panel_controls?.[skuAttr] ?? fallback;
  const fam = spec.families[family];
  const ids: string[] = [...fam.needs];
  const cls = rowUnitClass ?? "";
  if (fam.units[cls]) ids.push(...(fam.units[cls].needs ?? []));
  else for (const o of fam.convert?.[cls] ?? []) ids.push(...o.needs);
  for (const rule of spec.derive_when_none ?? []) {
    if (rule.families.includes(family) && ids.includes(rule.attr)) ids.push(rule.when.attr);
  }
  const seen = new Set<string>();
  // SLICE 9 (A-1): several SKU attributes may read from ONE model attribute (width, height and depth are
  // three axes of one size phrase). The panel shows that field ONCE -- a second box writing the same id would
  // overwrite the first.
  const seenIds = new Set<string>();
  const out: ItemFieldDef[] = [];
  const defById = new Map(defs.map((d) => [d.id, d]));
  for (const attr of ids) {
    if (seen.has(attr)) continue;
    seen.add(attr);
    const reader = spec.numbers[attr];
    if (reader) {
      const modelId = reader.from[0];
      if (seenIds.has(modelId)) continue;
      seenIds.add(modelId);
      const d = defById.get(modelId);
      const control = controlOf(attr, "text");
      if (control === "dropdown" && skus) {
        // a STOCKED size: the options are the sheet's sizes for this family, narrowed by the block's other answers
        const options = fieldOptionsFromSkus(spec, skus.items, family, rowUnitClass, attr, skus.answers ?? {});
        out.push({ id: modelId, label: d?.label ?? reader.name, allowNone: false, skuAttr: attr, control, options, optionSource: "catalogue" });
      } else {
        out.push({ id: modelId, label: d?.label ?? reader.name, allowNone: false, skuAttr: attr, control });
      }
      continue;
    }
    const d = defById.get(attr);
    if (!d) continue;
    if (seenIds.has(attr)) continue;
    seenIds.add(attr);
    let values = d.values ?? [];
    if (d.values_by_family && d.values_by_family[family]) values = d.values_by_family[family];
    const control = controlOf(attr, d.type === "choice" ? "dropdown" : "text");
    if (control !== "dropdown") {
      out.push({ id: attr, label: d.label, allowNone: d.allow_none === true, skuAttr: attr, control });
      continue;
    }
    // a choice: from the SKUs where the family's rows carry the attribute (V1), else the definition's vocabulary
    const fromSkus = skus ? fieldOptionsFromSkus(spec, skus.items, family, rowUnitClass, attr, skus.answers ?? {}, values) : [];
    const optionSource: "catalogue" | "definition" = fromSkus.length ? "catalogue" : "definition";
    const base = fromSkus.length ? fromSkus : [...values];
    out.push({
      id: attr,
      label: d.label,
      options: d.allow_none ? ["None", ...base] : base,
      allowNone: d.allow_none === true,
      skuAttr: attr,
      control,
      optionSource,
    });
  }
  return out;
}

