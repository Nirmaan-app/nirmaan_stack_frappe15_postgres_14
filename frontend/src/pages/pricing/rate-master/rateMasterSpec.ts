// SLICE 1c -- the SPEC READER's frontend half: pure helpers + the wording, in one place, so the Data
// Viewer, the upload preview and their tests share one definition.
//
// Owner rulings (quoted in services/boq_rate_master/spec_reader.py): item name + item detail are the
// source of truth for an opted-in category's attributes; the derived attributes are shown READ-ONLY,
// greyed, labelled "read from spec"; a spec the reader could not understand is marked "won't price:
// spec not understood" with its reason; the manual add/edit form sends the TEXT only and the server
// runs the same reader -- there is no client-side reading and no back door.
//
// ⚠️ NOTHING HERE DECIDES AN ATTRIBUTE. The server owns the reader; this module only recognises the
// opt-in key, splits the definitions into text vs derived for rendering, and reads the two reserved
// flag keys the server stores on a not-understood item.

import { formatDate } from "@/utils/FormatDate";
import type {
  AttributeDefinition, DerivedRateTerm, RateCategoryConfig, RateComposition, RateMasterItem,
} from "./rateMasterTypes";
import type { TwinDecision, UploadPlan, UploadSpec, UploadTwin } from "./rateMasterUpload";

/** The config key that opts a category in. Read as `=== true`, exactly as the server reads it. */
export const SPEC_CONFIG_KEY = "attributes_from_spec";
/** The two text attributes, in display order. */
export const SPEC_TEXT_ATTRS = ["item_name", "item_detail"] as const;
/** The two reserved flag keys the server stores on a not-understood item. Never columns, never editable. */
export const SPEC_STATUS_ATTR = "spec_status";
export const SPEC_NOTE_ATTR = "spec_note";
export const SPEC_NOT_UNDERSTOOD = "not_understood";

export const SPEC_COPY = {
  readFromSpec: "read from spec",
  wontPrice: "won't price: spec not understood",
  itemLabel: "Item",
  detailLabel: "Item detail",
  specColumn: "spec",
  /** The one rule a user needs on this screen, said once beside the table. */
  hint: "Item and Item detail are the source of truth: the greyed attributes are read from them and cannot be edited.",
  addHint: "Enter the item as the spec writes it. Its attributes are read on save.",
  /** The preview's per-row line. */
  previewRead: "Read from spec:",
  previewNone: "Read from spec: family only",
  /** SLICE 1d: the preview's line for a row the user accepted. */
  confirmedPreview: "Confirmed (best match):",
} as const;

/** Does this category take its attributes from the spec? `true` ONLY; a string does not opt in. */
export function isSpecDrivenConfig(config: Pick<RateCategoryConfig, "attributes_from_spec"> | null | undefined): boolean {
  return !!config && config.attributes_from_spec === true;
}

export function isSpecTextAttr(id: string): boolean {
  return (SPEC_TEXT_ATTRS as readonly string[]).includes(id);
}

/**
 * The definitions split for rendering: the TEXT columns (item_name, item_detail, in that fixed
 * order, whatever order the config lists them) and the DERIVED columns (everything else except
 * brand, in config order). PURE.
 */
export function splitSpecColumns(defs: AttributeDefinition[]): {
  text: AttributeDefinition[];
  derived: AttributeDefinition[];
} {
  const byId = new Map(defs.map((d) => [d.id, d] as const));
  const text: AttributeDefinition[] = [];
  for (const id of SPEC_TEXT_ATTRS) {
    const d = byId.get(id);
    if (d) text.push(d);
  }
  const derived = defs.filter((d) => d.id !== "brand" && !isSpecTextAttr(d.id));
  return { text, derived };
}

/** The reason the server stored on a not-understood item, or null when the item was understood. */
export function specNotUnderstoodReason(item: Pick<RateMasterItem, "attributes"> | null | undefined): string | null {
  const a = item?.attributes;
  if (!a || a[SPEC_STATUS_ATTR] !== SPEC_NOT_UNDERSTOOD) return null;
  const note = a[SPEC_NOTE_ATTR];
  return typeof note === "string" && note.trim() ? note : "(no reason recorded)";
}

/** The upload preview's one line per new / changed row: what was read, or why nothing could be. */
export function specLine(spec: UploadSpec): string {
  if (spec.status === "confirmed") {
    const parts = Object.entries(spec.read ?? {}).map(([k, v]) => `${k} = ${String(v)}`);
    return `${SPEC_COPY.confirmedPreview} ${parts.join(", ")}`;
  }
  if (spec.status === "not_understood") {
    return `${SPEC_COPY.wontPrice} — ${spec.reason ?? "(no reason recorded)"}`;
  }
  const parts = Object.entries(spec.read ?? {}).map(([k, v]) => `${k} = ${String(v)}`);
  return parts.length ? `${SPEC_COPY.previewRead} ${parts.join(", ")}` : SPEC_COPY.previewNone;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 1d -- SUGGEST THE BEST MATCH, THE USER CONFIRMS (owner T-a / T-b).
// ══════════════════════════════════════════════════════════════════════════════════════════════
// The SERVER suggests (deterministic rules in spec_reader.suggest_spec) and the server stores; this
// half only asks the question, carries the answer back, and renders the third status. A suggestion a
// user confirms is stored with spec_status "confirmed" plus WHO and WHEN; an unconfirmed suggestion is
// never stored (a rejected or undecided row stays "won't price: spec not understood").

export const SPEC_CONFIRMED = "confirmed";
export const SPEC_CONFIRMED_BY_ATTR = "spec_confirmed_by";
export const SPEC_CONFIRMED_AT_ATTR = "spec_confirmed_at";

export type SpecDecision = "accept" | "reject";

/** The server's suggestion for a row / a form entry the exact read refused. */
export interface SpecSuggestion {
  attributes: Record<string, string | number>;
  label: string;
  notes: string[];
  /** What the apply re-verifies: the server refuses an accept whose re-derived suggestion differs. */
  fingerprint: string;
}

/**
 * What create_rate_master_item / update_rate_master_item return for an opted-in kind when the exact
 * read refused and a suggestion exists but no decision was sent: NOTHING was written, the form must ask.
 */
export interface SpecConfirmationReply {
  ok: boolean;
  needs_confirmation?: boolean;
  question?: string;
  suggestion?: SpecSuggestion | null;
  no_suggestion_reason?: string | null;
  item?: unknown;
  /**
   * SLICE 1f: the entry MEANS THE SAME as an existing active item (owner Y-a / Y-e): NOTHING was written,
   * the form must ask Confirm / Decline. Confirm re-sends with `twin_decision` + `twin_fingerprint` and the
   * EXISTING item takes the rates; Decline sends nothing (no change at all).
   */
  needs_twin_confirmation?: boolean;
  twin?: UploadTwin;
}

export const SPEC_CONFIRM_COPY = {
  accept: "Accept",
  reject: "Reject",
  acceptAll: "Accept all shown",
  acceptAllHint: "Accepts every row above that has a best match. Rows without one stay flagged.",
  confirmedPrefix: "confirmed by",
  noMatch: "No reasonable match:",
  /** The question, exactly as the owner approved it. */
  question: (text: string, label: string) => `Couldn't read '${text}' exactly. Best match: ${label}. Accept?`,
  decided: (d: SpecDecision) => (d === "accept" ? "Will be stored as confirmed." : "Rejected: stays flagged."),
} as const;

/** "read" (no status), "confirmed", or "not_understood" -- the three states the screen renders. */
export function specVerdict(item: Pick<RateMasterItem, "attributes"> | null | undefined): "read" | "confirmed" | "not_understood" {
  const s = item?.attributes?.[SPEC_STATUS_ATTR];
  if (s === SPEC_CONFIRMED) return "confirmed";
  if (s === SPEC_NOT_UNDERSTOOD) return "not_understood";
  return "read";
}

/** Who confirmed and when, for a confirmed item; null otherwise. */
export function specConfirmedInfo(item: Pick<RateMasterItem, "attributes"> | null | undefined): { by: string; at: string } | null {
  if (specVerdict(item) !== "confirmed") return null;
  const a = item?.attributes ?? {};
  return { by: String(a[SPEC_CONFIRMED_BY_ATTR] ?? "(unknown)"), at: String(a[SPEC_CONFIRMED_AT_ATTR] ?? "") };
}

/** The amber tag's text: "confirmed by <user>, <dd-MMM-yyyy>". A blank / unparseable date is shown raw. */
export function confirmedTag(by: string, at: string): string {
  let when = at;
  try {
    if (at && !Number.isNaN(new Date(at).getTime())) when = formatDate(at);
  } catch {
    /* keep the raw value */
  }
  return `${SPEC_CONFIRM_COPY.confirmedPrefix} ${by}${when ? `, ${when}` : ""}`;
}

/** The question for one row / one form entry. */
export function specQuestion(itemName: string, itemDetail: string, suggestion: SpecSuggestion): string {
  const text = [itemName, itemDetail].filter((t) => t && t.trim()).join(" / ");
  return SPEC_CONFIRM_COPY.question(text, suggestion.label);
}

/** The preview rows that HAVE a suggestion (the ones "Accept all shown" accepts). PURE. */
export function rowsWithSuggestion(plan: Pick<UploadPlan, "changes"> | null | undefined): number[] {
  return (plan?.changes ?? []).filter((c) => !!c.spec?.suggestion).map((c) => c.row);
}

/** The fingerprints the apply must send for every ACCEPTED row. PURE. */
export function acceptedFingerprints(
  plan: Pick<UploadPlan, "changes"> | null | undefined,
  decisions: Record<number, SpecDecision>,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of plan?.changes ?? []) {
    if (decisions[c.row] === "accept" && c.spec?.suggestion) out[c.row] = c.spec.suggestion.fingerprint;
  }
  return out;
}

// ── the request payloads the page sends (owner ruling: byte-identical to before when nothing optional
// is present -- these builders are what the test pins) ────────────────────────────────────────────

export function applyCsvPayload(
  discipline: string,
  contentBase64: string,
  expectedDigest: string,
  decisions?: Record<number, SpecDecision>,
  fingerprints?: Record<number, string>,
  // SLICE 1f: the per-row Confirm / Decline answers to the duplicate warning and the confirmed targets'
  // fingerprints -- both optional; absent (or empty), the payload is byte-identical to before.
  twinDecisions?: Record<number, TwinDecision>,
  twinFingerprints?: Record<number, string>,
): Record<string, string> {
  const out: Record<string, string> = { discipline, content_base64: contentBase64, expected_digest: expectedDigest };
  if (decisions && Object.keys(decisions).length) out.decisions = JSON.stringify(decisions);
  if (fingerprints && Object.keys(fingerprints).length) out.accepted_fingerprints = JSON.stringify(fingerprints);
  if (twinDecisions && Object.keys(twinDecisions).length) out.twin_decisions = JSON.stringify(twinDecisions);
  if (twinFingerprints && Object.keys(twinFingerprints).length) out.twin_fingerprints = JSON.stringify(twinFingerprints);
  return out;
}

export interface CreateItemPayload {
  kind: string;
  brand?: string;
  unit?: string;
  attributes: Record<string, string | number>;
  rates: Record<string, number | null>;
  spec_decision?: SpecDecision;
  spec_fingerprint?: string;
  /** SLICE 1f: the answer to the duplicate warning (only "confirm" ever travels; a decline sends nothing). */
  twin_decision?: TwinDecision;
  twin_fingerprint?: string;
}

export function createItemPayload(discipline: string, p: CreateItemPayload): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {
    discipline, kind: p.kind, brand: p.brand, unit: p.unit,
    attributes: JSON.stringify(p.attributes), rates: JSON.stringify(p.rates),
  };
  if (p.spec_decision) out.spec_decision = p.spec_decision;
  if (p.spec_fingerprint) out.spec_fingerprint = p.spec_fingerprint;
  if (p.twin_decision) out.twin_decision = p.twin_decision;
  if (p.twin_fingerprint) out.twin_fingerprint = p.twin_fingerprint;
  return out;
}

export interface SaveItemPatch {
  rates_patch?: Record<string, number | null>;
  attributes_patch?: Record<string, string | number>;
  spec_decision?: SpecDecision;
  spec_fingerprint?: string;
  /** SLICE 1f: the answer to the duplicate warning on an edit (Y-e); only "confirm" ever travels. */
  twin_decision?: TwinDecision;
  twin_fingerprint?: string;
}

export function saveItemPayload(name: string, patch: SaveItemPatch): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {
    name,
    rates_patch: patch.rates_patch ? JSON.stringify(patch.rates_patch) : undefined,
    attributes_patch: patch.attributes_patch ? JSON.stringify(patch.attributes_patch) : undefined,
  };
  if (patch.spec_decision) out.spec_decision = patch.spec_decision;
  if (patch.spec_fingerprint) out.spec_fingerprint = patch.spec_fingerprint;
  if (patch.twin_decision) out.twin_decision = patch.twin_decision;
  if (patch.twin_fingerprint) out.twin_fingerprint = patch.twin_fingerprint;
  return out;
}

// ── SLICE 12a: DERIVED COSTS + THE FORMULA EXPLANATIONS ────────────────────────────────────────────
//
// Owner I-2: "those formula should be preserved even in our system so that if we make change to the
// base row the change gets reflected on all other rows. any tab which has this prpety must ensure it."
// Owner I-3: "marked and refused but if its has some part which is from the same row atleast those
// parts need to be editables and accept."
//
// ⚠️ A DELIBERATE CROSS-LANGUAGE DUPLICATION, exactly like `isRowQtyBearing` / `node_is_qty_bearing`
// and `isNumericAttributeType` / `_NUMERIC_ATTR_TYPES`. The rate FILE is built server-side
// (`services/boq_rate_master/csv_exporter.py`) and the SCREEN cannot call an exporter for one cell, so
// the same text is rendered on both sides. THE TWO ARE PINNED TO BYTE-IDENTICAL OUTPUT on a shared
// fixture -- `rateMasterSpec.test.ts`'s FORMULA_FIXTURE and `test_rate_master`'s copy of it. A change
// to one that is not made to the other turns that pin red, which is the whole point of it.
//
// NOTHING HERE DECIDES A PRICE. The declaration is DESCRIPTIVE: the price comes from the pipeline, as
// it always did. These helpers only say which cell is derived, from where, and how a cost is built.

/** The literal a plainly typed cost shows. Mirrors `csv_exporter.FORMULA_TYPED`. */
export const FORMULA_TYPED = "typed";
/** The two read-only formula columns, in order. Mirrors `csv_exporter.FORMULA_COLUMNS`. */
export const FORMULA_COLUMNS = ["supply_formula", "install_formula"] as const;
/** The BoQ-rate rule the file cannot otherwise show (owner I-7a). Mirrors `csv_exporter.BOQ_RATE_NOTE`. */
export const BOQ_RATE_NOTE = "BoQ rate = cost x (1 + markup), rounded up.";
/** Owner, 2026-09-27 ("trim electrical"): a column note carries the PLAIN-ENGLISH explanation only.
 * Mirrors `csv_exporter._NOTE_MAX_CHARS` / `_NOTE_FALLBACK`. */
const NOTE_MAX_CHARS = 300;
const NOTE_FALLBACK = "computed by this category's pricing rules";

export const DERIVED_COPY = {
  /** The cell's own mark. */
  cellTag: "derived",
  /** The one rule a user needs beside the table. */
  hint:
    "A cell marked “derived” takes its value from another catalogue row: edit that row and this " +
    "one follows. Every other cell on the row, including its own cost parts and its markups, is editable.",
  columnHeaderSupply: "Supply formula",
  columnHeaderInstall: "Install formula",
  formulaRowLabel: "formula",
  formulaRowHint:
    "What each computed rate column is, and how to update it. This row is an explanation: it is ignored on upload.",
} as const;

/** A number as the formula text writes it. Mirrors `csv_exporter._fmt_num` character for character. */
export function formatNum(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  let txt = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (txt.endsWith("0")) txt = txt.slice(0, -1);
  return txt;
}

/** {`${item_uid}\u0000${rate_key}`: terms} for a config. Empty for every config that declares nothing. */
export function derivedCells(
  config: Pick<RateCategoryConfig, "derived_rates"> | null | undefined,
): Map<string, DerivedRateTerm[]> {
  const out = new Map<string, DerivedRateTerm[]>();
  const dr = config?.derived_rates;
  if (!dr || typeof dr !== "object") return out;
  for (const [uid, keys] of Object.entries(dr)) {
    if (!keys || typeof keys !== "object") continue;
    for (const [rateKey, terms] of Object.entries(keys)) {
      if (Array.isArray(terms) && terms.length) out.set(`${uid}\u0000${rateKey}`, terms);
    }
  }
  return out;
}

/** Is this (item, rate key) DECLARED derived? The ONE predicate the marking and the read-only cell use. */
export function isDerivedCell(
  config: Pick<RateCategoryConfig, "derived_rates"> | null | undefined,
  itemUid: string | undefined,
  rateKey: string,
): boolean {
  if (!itemUid) return false;
  return derivedCells(config).has(`${itemUid}\u0000${rateKey}`);
}

/** The attribute ids that NAME a row, in display order. Mirrors `csv_exporter._wording_attr_ids`. */
function wordingAttrIds(config: RateCategoryConfig): string[] {
  const defs = (config.attribute_definitions || []).filter((d) => d && d.id);
  if (config.attributes_from_spec === true) {
    const have = new Set(defs.map((d) => d.id));
    return (SPEC_TEXT_ATTRS as readonly string[]).filter((a) => have.has(a));
  }
  return defs.filter((d) => d.id !== "brand").map((d) => d.id);
}

/**
 * A base row AS WORDING, with its id at the end (owner I-5, "your way"): brand, the attributes that
 * name it, the unit -- then `[item_uid]`. Only the uid is stored, so a catalogue WORDING change cannot
 * invalidate a declaration. Mirrors `csv_exporter.base_wording`.
 */
export function baseWording(config: RateCategoryConfig, item: RateMasterItem | undefined): string {
  if (!item) return "";
  const bits: string[] = [];
  if (item.brand) bits.push(String(item.brand));
  const attrs = item.attributes || {};
  for (const aid of wordingAttrIds(config)) {
    const v = attrs[aid];
    if (v === null || v === undefined || v === "") continue;
    bits.push(typeof v === "number" ? formatNum(v) : String(v));
  }
  if (item.unit) bits.push(String(item.unit));
  return `${bits.join(", ")} [${item.item_uid ?? ""}]`;
}

/** Which formula column a rate key is talked about in. Mirrors `csv_exporter._side_of`. */
export function sideOfRateKey(rateKey: string): "supply" | "install" {
  return (rateKey || "").toLowerCase().includes("install") ? "install" : "supply";
}

/** Excel ROUNDUP away from zero. Mirrors `csv_exporter._roundup`. */
function roundUp(value: number, digits = 0): number {
  const f = 10 ** digits;
  const s = value * f;
  return s >= 0 ? Math.ceil(s - 1e-9) / f : -Math.ceil(-s - 1e-9) / f;
}

/** A part's human word. Mirrors `csv_exporter._part_label`. */
function partLabel(rateKey: string): string {
  const key = rateKey.startsWith("cost_") ? rateKey.slice(5) : rateKey;
  return key.replace(/_/g, " ");
}

function compositionRole(
  config: RateCategoryConfig,
  rateKey: string,
): ["part" | "wastage" | "markup" | null, string | null, RateComposition | null] {
  const comp: Partial<Record<"supply" | "install", RateComposition | undefined>> =
    config.rate_composition || {};
  for (const side of Object.keys(comp) as Array<"supply" | "install">) {
    const spec = comp[side];
    if (!spec) continue;
    if ((spec.parts || []).includes(rateKey)) return ["part", side, spec];
    if (rateKey === spec.wastage_key) return ["wastage", side, spec];
    if (rateKey === spec.markup_key) return ["markup", side, spec];
  }
  return [null, null, null];
}

/** A step, read LOOSELY: the union `PipelineStep` does not give every member a `target` / `formula` /
 * `explain`, and this module only ever READS those three optional fields. */
interface LooseStep {
  step?: string;
  target?: string;
  formula?: string;
  explain?: string;
  [k: string]: unknown;
}

/** Past the cap, keep whole leading SENTENCES and end with an ellipsis. Mirrors `_capped`. */
function capNote(text: string, limit = NOTE_MAX_CHARS): string {
  if (text.length <= limit) return text;
  let kept = "";
  for (const piece of text.split(/(?<=[.!?])\s+/)) {
    if (kept && kept.length + 1 + piece.length > limit) break;
    kept = kept ? `${kept} ${piece}`.trim() : piece;
  }
  if (!kept) kept = text.slice(0, limit).replace(/\s\S*$/, "");
  return `${kept.replace(/\s+$/, "")} ...`;
}

/** What a step DOES, for a step carrying neither a formula nor an explain of its own. Mirrors
 * `csv_exporter._STEP_PROSE` -- the two must stay identical or the cross-language pin goes red. */
const STEP_PROSE: Record<string, string> = {
  component_ref: "read off ANOTHER catalogue row, as one component of an assembly total",
  component: "read off THIS row, as one component of an assembly total",
  component_band: "read off THIS row, banded by the selected value",
  scale: "scaled",
  roundup: "rounded up",
  apply_effective_multiplier: "the supplier discount and the company markup applied",
  install_as_ratio: "taken as a ratio of the supply figure",
};

/** Every pipeline a config carries. Mirrors `config_validation._pipeline_scopes`. */
function pipelineScopes(config: RateCategoryConfig): Array<{ label: string; steps: LooseStep[] }> {
  const out: Array<{ label: string; steps: LooseStep[] }> = [];
  const top = (config.pipelines || {}) as Record<string, { steps?: LooseStep[] }>;
  for (const [name, p] of Object.entries(top)) {
    if (p && typeof p === "object") out.push({ label: `pipelines.${name}`, steps: p.steps || [] });
  }
  const pricing = ((config.list_spec as Record<string, unknown> | undefined)?.pricing ||
    {}) as Record<string, unknown>;
  const families = (pricing.families || {}) as Record<string, Record<string, unknown>>;
  for (const [fam, fv] of Object.entries(families)) {
    if (!fv || typeof fv !== "object") continue;
    const units = (fv.units || {}) as Record<string, { pipelines?: Record<string, { steps?: LooseStep[] }> }>;
    for (const [uc, ub] of Object.entries(units)) {
      for (const [pname, p] of Object.entries(ub?.pipelines || {})) {
        out.push({ label: `${fam}/${uc}/${pname}`, steps: p?.steps || [] });
      }
    }
    const convert = (fv.convert || {}) as Record<string, unknown>;
    for (const [fromUc, optsRaw] of Object.entries(convert)) {
      const opts = Array.isArray(optsRaw) ? optsRaw : [optsRaw];
      for (const opt of opts as Array<{ to?: string; pipelines?: Record<string, { steps?: LooseStep[] }> }>) {
        if (!opt || typeof opt !== "object") continue;
        for (const [pname, p] of Object.entries(opt.pipelines || {})) {
          out.push({ label: `${fam}/${fromUc}->${opt.to}/${pname}`, steps: p?.steps || [] });
        }
      }
    }
  }
  return out;
}

/**
 * The FORMULA ROW's cell for one rate column (owner I-7 / I-7a). PURE. Mirrors
 * `csv_exporter.column_note`.
 *
 * Grouped by WHAT THE STEP DOES, not by which pipeline does it: ADP's `cost_supply` is read by 62
 * pipelines that between them do four different things, and one line per pipeline made the cell
 * unreadable -- an unreadable explanation is the same as none.
 */
export function columnNote(
  config: RateCategoryConfig | null | undefined,
  rateKey: string,
  derivedCount = 0,
): string {
  const lines: string[] = [];
  if (derivedCount > 0) {
    lines.push(
      `DERIVED on ${derivedCount} row(s): the value comes from another catalogue row -- see that row's ` +
        "supply_formula / install_formula.",
    );
  }
  const cfg = config || ({ attribute_definitions: [], pipelines: {} } as unknown as RateCategoryConfig);
  const [role, side, spec] = compositionRole(cfg, rateKey);
  if (role === "part" && spec) {
    const parts = (spec.parts || []).join(" + ");
    const tail = spec.wastage_key ? ` x (1 + ${spec.wastage_key})` : "";
    lines.push(`a PART of the ${side} cost: (${parts})${tail}, rounded up.`);
  } else if (role === "wastage" && spec) {
    lines.push(`the ${side} wastage fraction: (${(spec.parts || []).join(" + ")}) x (1 + this), rounded up.`);
  } else if (role === "markup") {
    lines.push(`the ${side} markup fraction.`);
  }
  // THE EXPLANATION ONLY, deduplicated, in first-seen order. Mirrors `csv_exporter.column_note`.
  for (const { label, steps } of pipelineScopes(cfg)) {
    void label;
    for (const s of steps) {
      if (!s) continue;
      const explain = (s.explain || "").trim();
      let hit = s.target === rateKey;
      let said = explain;
      if (!hit) {
        // A `component_band` names its targets inside `bands[*].target`, NOT in `step.target`.
        for (const band of (s.bands as Array<Record<string, unknown>> | undefined) || []) {
          if (band && band.target === rateKey) {
            const when = String(band.when ?? "").trim();
            said = explain
              || (when ? `used when ${String(s.band_on ?? "the banded value")} ${when}` : "");
            hit = true;
            break;
          }
        }
      }
      if (!hit) continue;
      const line = said || STEP_PROSE[s.step || ""] || NOTE_FALLBACK;
      if (!lines.includes(line)) lines.push(line);
    }
  }
  if ((rateKey || "").toLowerCase().includes("markup")) lines.push(BOQ_RATE_NOTE);
  if (!lines.length) lines.push("a TYPED rate. No pipeline reads it yet.");
  // THE CAP IS PER LINE, NOT PER NOTE -- a whole-note cap kept only the first line and dropped the
  // rest (ADP's `cost_supply` carries eight short explanations). Mirrors `csv_exporter.column_note`.
  return lines.map((l) => capNote(l)).join("\n");
}

/**
 * The ROW-LEVEL formula cell for one item and one side (owner I-6). PURE. Mirrors
 * `csv_exporter.row_formula`: a category declaring `rate_composition` shows each step's own result; a
 * derived cost with no composition names its base row; anything else reads `typed`.
 */
export function rowFormula(
  config: RateCategoryConfig,
  item: RateMasterItem,
  side: "supply" | "install",
  baseLookup: (uid: string | undefined) => RateMasterItem | undefined,
): string {
  const rates = (item.rates || {}) as Record<string, number | null | undefined>;
  const cells = derivedCells(config);
  const uid = item.item_uid;

  const derivedNote = (rateKey: string): string | null => {
    const terms = uid ? cells.get(`${uid}\u0000${rateKey}`) : undefined;
    if (!terms) return null;
    const bits = terms.map((t) => {
      const src = t.from || ({} as { item_uid?: string; rate_key?: string });
      const word = baseWording(config, baseLookup(src.item_uid)) || String(src.item_uid ?? "");
      let bit = `${src.rate_key} of ${word}`;
      const mult = t.multiplier ?? 1;
      const constant = t.constant ?? 0;
      if (mult !== 1) bit += ` x ${formatNum(mult)}`;
      if (constant) bit += ` + ${formatNum(constant)}`;
      return bit;
    });
    return bits.join(" plus ");
  };

  const comp = config.rate_composition?.[side];
  if (comp) {
    const lines: string[] = [];
    let total = 0;
    let known = true;
    (comp.parts || []).forEach((part, i) => {
      const v = rates[part];
      const note = derivedNote(part);
      let txt: string;
      if (v === null || v === undefined) {
        known = false;
        txt = "(not set)";
      } else {
        total += Number(v);
        txt = formatNum(Number(v));
      }
      let line = `${i === 0 ? "" : "+ "}${partLabel(part)} ${txt}`;
      if (note) line += `  <- derived from ${note}`;
      lines.push(line);
    });
    if (!known) return lines.length ? lines.join("\n") : FORMULA_TYPED;
    lines.push(`= ${formatNum(total)}`);
    let running = total;
    const wkey = comp.wastage_key;
    if (wkey && rates[wkey] !== null && rates[wkey] !== undefined) {
      running = running * (1 + Number(rates[wkey]));
      lines.push(`x (1 + ${partLabel(wkey)} ${formatNum(Number(rates[wkey]))}) = ${formatNum(running)}`);
    }
    const digits = comp.roundup ?? 0;
    running = roundUp(running, digits);
    lines.push(`ROUNDUP -> ${formatNum(running)}   (total BCS ${side})`);
    const mkey = comp.markup_key;
    if (mkey && rates[mkey] !== null && rates[mkey] !== undefined) {
      running = running * (1 + Number(rates[mkey]));
      lines.push(`x (1 + ${partLabel(mkey)} ${formatNum(Number(rates[mkey]))}) = ${formatNum(running)}`);
      running = roundUp(running, digits);
      lines.push(`ROUNDUP -> ${formatNum(running)}   (BoQ ${side})`);
    }
    return lines.join("\n");
  }

  const extra = Array.from(cells.keys())
    .filter((k) => k.startsWith(`${uid}\u0000`))
    .map((k) => k.split("\u0000")[1])
    .filter((k) => !(k in rates))
    .sort();
  const notes: string[] = [];
  for (const rateKey of [...Object.keys(rates).sort(), ...extra]) {
    if (sideOfRateKey(rateKey) !== side) continue;
    const note = derivedNote(rateKey);
    if (note) notes.push(`${rateKey} <- derived from ${note}`);
  }
  return notes.length ? notes.join("\n") : FORMULA_TYPED;
}

/** {rate_key: how many of these items declare it derived} -- what the formula row's count names. */
export function derivedCountsByKey(
  config: RateCategoryConfig | null | undefined,
  items: RateMasterItem[],
): Record<string, number> {
  const cells = derivedCells(config);
  const present = new Set(items.map((it) => it.item_uid));
  const out: Record<string, number> = {};
  for (const k of cells.keys()) {
    const [uid, rateKey] = k.split("\u0000");
    if (present.has(uid)) out[rateKey] = (out[rateKey] || 0) + 1;
  }
  return out;
}
