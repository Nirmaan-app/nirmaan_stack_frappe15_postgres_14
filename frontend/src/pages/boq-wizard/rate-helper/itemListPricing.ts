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
}

export interface ConversionOption {
  to: string;
  needs: string[];
  rule: string;
  pipelines: Record<string, Pipeline>;
}

export interface UnitPricing {
  needs?: string[];
  pipelines: Record<string, Pipeline>;
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
}

export interface DeriveWhenNone {
  attr: string;
  families: string[];
  when: { attr: string; equals: string };
  then: string;
  rule: string;
}

export interface ItemListPricingSpec {
  kind: string;
  unit_class_attr: string;
  unit_classes: Record<string, string[]>;
  unit_words?: Record<string, string>;
  family_alias?: Record<string, string>;
  no_sku_families?: string[];
  defaults?: Record<string, DefaultSpec>;
  derive_when_none?: DeriveWhenNone[];
  numbers: Record<string, NumberReader>;
  ladders: string[];
  match_attrs: string[];
  choice_attrs: string[];
  reason_names?: Record<string, string>;
  families: Record<string, FamilySpec>;
}

/** Read the block off a config; null when the config does not declare it. PURE. */
export function itemListPricingSpec(config: RateCategoryConfig | null | undefined): ItemListPricingSpec | null {
  const spec = (config as { list_spec?: { pricing?: unknown } } | null | undefined)?.list_spec?.pricing;
  if (!spec || typeof spec !== "object") return null;
  const p = spec as Partial<ItemListPricingSpec>;
  if (typeof p.kind !== "string" || !p.unit_classes || !p.families || !p.numbers) return null;
  return spec as ItemListPricingSpec;
}

// ---------------------------------------------------------------------------------------------------------
// inputs / outputs
// ---------------------------------------------------------------------------------------------------------

/** One extracted item as the run stores it: `items[i].attributes[attr] = {value, confidence}`. */
export interface ExtractedListItem {
  attributes: Record<string, { value: string | number | null; confidence?: number }>;
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
  /** The conversion the row's unit needed (R4 / R11 / R16), or null. */
  conversion: { rule: string; to: string } | null;
  sku: { item_uid?: string; item_name?: string; item_detail?: string; unit?: string } | null;
  finals: Record<string, number>;
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

/** The unit class of a unit string against the config table, or null when unknown; "" is its own case. PURE. */
export function unitClassOf(spec: ItemListPricingSpec, unit: string | null | undefined): string | null {
  if (unit === null || unit === undefined || unit.trim() === "") return null;
  const u = normUnit(unit);
  for (const [cls, spellings] of Object.entries(spec.unit_classes)) {
    if (spellings.some((s) => normUnit(s) === u)) return cls;
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

/** Read one number from as-written text under a reader's rules. PURE.
 *   null              -> not stated (blank / null / the "None" sentinel)
 *   { value, note? }  -> the number, with a note when a range was resolved to its top or a unit was scaled
 *   { blank: reason } -> stated but unusable, with the owner-language reason (never a guess) */
export function readNumber(text: string | number | null | undefined, reader: NumberReader): NumberRead {
  if (text === null || text === undefined) return null;
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
): ItemPriceResult {
  const out: ItemPriceResult = {
    index, familyRaw: null, family: null, skuUnitClass: null, state: "blank", selection: {}, defaulted: [],
    ladderHops: [], conversion: null, sku: null, finals: {}, working: [], pipelineResults: [],
  };
  const blank = (reason: string): ItemPriceResult => ({ ...out, state: "blank", reason });

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
    const v = rawValue(item, attr);
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
  const sel: Record<string, string | number> = { family };

  // (3) the SKU unit class: the family's own rows for the row's unit, else a declared conversion (R4 / R11 / R16),
  //     else no SKU per that unit
  let unit: UnitPricing | undefined = fam.units[rowUnitClass];
  let target = rowUnitClass;
  let needs = [...fam.needs];
  if (unit) {
    needs.push(...(unit.needs ?? []));
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
  for (const d of out.defaulted) out.working.push(`${d.attr} not mentioned -> ${d.value} (${d.rule})`);

  // (6) the arithmetic: the interpreter, unchanged, over the declared pipelines
  const results: PipelineResult[] = [];
  const finals: Record<string, number> = {};
  for (const [id, pl] of Object.entries(unit.pipelines)) {
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
  return { ...out, state: "priced", finals, pipelineResults: results };
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
  const priced = extracted.map((it, i) => priceOneItem(spec, projected, cls, it, i));
  const firstBlank = priced.find((p) => p.state === "blank");
  if (firstBlank) {
    // R21: all or nothing -- the row shows no price; every item keeps its own state above
    const who = priced.length > 1 ? `item ${firstBlank.index + 1}${firstBlank.family ? ` (${firstBlank.family})` : ""}: ` : "";
    return { unit, unitClass: cls, priced: false, reason: `${who}${firstBlank.reason}`, items: priced };
  }
  const sum = (k: string) => priced.reduce((a, p) => a + (p.finals[k] ?? 0), 0);
  return { unit, unitClass: cls, priced: true, supply: sum("supply"), install: sum("install"), items: priced };
}
