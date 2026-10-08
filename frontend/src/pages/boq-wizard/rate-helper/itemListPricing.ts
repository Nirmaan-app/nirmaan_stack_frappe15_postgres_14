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
import { resolveSize, composeSize, type SizeMatchSpec, type ComposeSpec } from "./ladderResolution";

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
  /** OWNER FA8(d): an inch value on this axis converts to mm (x25.4) instead of being refused, and a
   * bare fraction is read as inches. Only for an axis whose catalogue sizes are inch-derived. */
  inches?: boolean;
  /** "max": a range takes its top value (R6 / R16) -- the default for every reader. */
  range?: "max";
  /** SLICE 9 (owner A-1): this SKU attribute is ONE AXIS of a size the row writes as a single phrase --
   * 1 = width, 2 = height, 3 = depth. The model copies "525 x 525 x 450 mm" into one text attribute and
   * CODE splits it (`splitSizePhrase`); an axis the phrase does not state reads as NOT STATED, and a form
   * the splitter cannot read falls through to the ordinary reader, which refuses it BY NAME. ABSENT =>
   * the reader behaves exactly as it did before this slice. */
  component?: number;
  /** SLICE 12d-1b (owner T2): a BARE slash list of ANY length ("19/ 25 / 32 mm") reads as its HIGHEST.
   * ABSENT => exactly two still take the higher (slice 11) and three or more refuse, so ADP is byte-identical. */
  several?: "highest";
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
  /**
   * SLICE 12c-S (OWNER RULING S10, 2026-10-06) -- unit classes the PICKER must not offer for this
   * family, although the family can price them.
   *
   * ⚠️ IT CHANGES NO PRICE, AND THAT IS THE POINT. A BoQ row that ARRIVES in a hidden unit prices
   * exactly as it always did; this key is read at ONE site, by the unit picker, which is a control
   * only the calculator and a unit-less row ever show.
   *
   * It exists because nothing else can express it. `double-skin plenum` and `VCD` are identical on
   * every axis a generic rule could key on -- `area` SKUs, an `area` pipeline, a `count` conversion --
   * so any rule giving the first "sq.m only" gives the second the same, and a VCD block at `area`
   * renders neither of its size fields. The difference between them is knowledge about the product
   * ("a double skin plenum is always priced in sqm"), so it is DECLARED, per family, in config.
   * No family is named in code.
   */
  units_not_offered?: string[];
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

/**
 * SLICE 12d-1a (owner R2, 2026-10-07) -- THE FAMILY WHEN THE ROW NAMES NO MATERIAL.
 *
 * "Material not mentioned -> Nitrile, by row kind": the material named in the payload decides (the
 * model's family answer, which implies pipe or sheet); otherwise the UNIT decides -- per metre is a
 * pipe, per sq.m is a sheet -- and a sheet row is ACOUSTIC only where "acoustic" or "lining" appears
 * in the row or its headings. Every word of that is CONFIG: the unit classes, the families they
 * imply, the words and the family the words imply. No family, class or word is named in code.
 *
 * It is consumed ONLY when the family answer is ABSENT or "None" (a stated family -- including
 * "none of these" -- is never overridden), and the family it supplies is MARKED as a default (the
 * amber mechanism), so a pricer can see the row did not say it.
 *
 * ⚠️ THE WORDS ARE READ OFF THE ROW'S OWN TEXT AND ITS HEADINGS, which the PANEL supplies (the row
 * context's `headings`, built from the priced rows' parent chain). The calculator has no row text
 * and never needs this: a pricer picks the family there.
 */
/**
 * SLICE 12d-1a (owner R4, 2026-10-07) -- A STATED VALUE THAT PRICES AS ANOTHER, OR REFUSES.
 *
 * "Foil: on a pipe -> 26G cladding; on an acoustic row -> refuse." The row DID state the value, so
 * neither `defaults` (fires over "None") nor `override_when` (cannot be conditioned on the attribute
 * it sets) can express it. A rule names the attribute, the families it applies to and the stated
 * value; it carries EITHER `to` (the value that prices, recorded as an override so the panel shows the
 * catalogue's word) OR `refuse` (the item refuses with that sentence). It runs AFTER the defaults and
 * the overrides, so a ruled "No" never reads as foil, and it fires ONLY on its `from`.
 */
export interface ValueMapRule {
  attr: string;
  families: string[];
  from: string;
  to?: string;
  refuse?: string;
  rule: string;
  display?: string;
}

export interface FamilyWhenNone {
  /** unit class -> the family a silent row of that class prices as. */
  by_unit_class: Record<string, string>;
  /** Word rules, in order; the FIRST whose unit class matches and whose words appear wins. */
  when_words?: Array<{ unit_class: string; words: string[]; family: string }>;
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

/**
 * SLICE 12d-4a (owner D3, 2026-10-11) -- A VALUE NAMED IN THE ROW'S OWN TEXT NEVER FALLS TO A DEFAULT.
 * The model answers an `allow_none` attribute `"None"` ("not mentioned") and the R1 default then prices
 * the row without it -- but the row's OWN text names one (a glass cloth, an IC cladding, a GI strip, an
 * FRP wrap). The audit found 10 priced rows in that state. Such a row REFUSES for a person instead.
 * The WORDS live in config (no category named in code); they are tested at a WORD START, case-insensitively,
 * against the row's OWN text only -- its description and its own notes, NEVER a heading (the audit: 7 of 9
 * heading cases were right to stay silent). Fires ONLY over a `"None"` answer; a stated value is never touched.
 */
export interface NamedInRowRule {
  attr: string;
  words: string[];
  refuse: string;
  rule: string;
}

/**
 * SLICE 12d-4a (owner D7): a MATERIAL the catalogue does not stock, named in the row's own text or in the
 * `from_attr` text the model copied -- EPDM, XLPE, rockwool -- REFUSES BY NAME even when the model picked a
 * stocked family for it. The sentence is the T5 one ("No SKU in the catalogue for <material> - price this row
 * by hand"), naming `from_attr`'s text where the model answered it, else the matched word in capitals.
 */
export interface UnstockedMaterials {
  words: string[];
  from_attr?: string;
  rule: string;
}

/**
 * SLICE 12d-4a (owner D9b): a value that is NOT OFFERED on rows of one UNIT CLASS -- glass cloth on sheet
 * (per-sq.m) insulation -- refuses with the ruled sentence. It fires on the value the pricing READS (after
 * defaults and the value map) when it contains `value_contains`, or, where the model answered `"None"`, on a
 * declared word in the row's own text -- so a sheet row ASKING for glass cloth refuses whether or not the
 * model read it. It runs BEFORE the D3 rule, so the person is told the outcome, not asked to set a cladding
 * that would then refuse.
 */
export interface RefuseOnUnitClass {
  unit_class: string;
  /** 12d-4aF (owner): the FAMILIES the refusal applies to -- declared in config, never named in code. A rule
   *  with no list fires on NO family (fail-closed; the validator requires the list). The 12d-4a form without it
   *  refused Cladding Only per sq.m with glass cloth, against the standing 12c F2 ruling (294 / 70). */
  families?: string[];
  attr: string;
  value_contains: string;
  words?: string[];
  refuse: string;
  rule: string;
}

/**
 * SLICE 12d-4a (owner D8): a WORKING LINE generated from a text the model copied -- "BoQ says 32 kg/m3 ->
 * priced as the 48 kg/m3 board". `pattern` is matched (case-insensitive) against `from_attr`'s text for the
 * named families; `unless` is the value of the first capture group that needs no line (the stocked one); `line`
 * carries `{match}` for the matched text. Display only -- nothing here reaches the matcher.
 */
export interface ReadNote {
  families: string[];
  from_attr: string;
  pattern: string;
  unless?: string;
  line: string;
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
  /** SLICE 12d-1b (owner T5): the TEXT item attribute that names the material AS WRITTEN; a `no_sku_families`
   * refusal names it ("No SKU in the catalogue for XLPE - price this row by hand"). ABSENT => the R18 sentence. */
  no_sku_named_by?: string;
  defaults?: Record<string, DefaultSpec>;
  derive_when_none?: DeriveWhenNone[];
  /** SLICE 12d-1a (owner R2): the family a row with NO material answer prices as, by row kind.
   * ABSENT => a missing family still refuses, exactly as before this slice. */
  family_when_none?: FamilyWhenNone;
  /** SLICE 12d-1a (owner R4): a stated value that prices as another value of its attribute, or
   * refuses, per family. ABSENT => nothing maps and every row is byte-identical to before. */
  value_map?: ValueMapRule[];
  /** SLICE 12d-1a (owner R7): item attributes the panel shows READ-ONLY -- recorded by the model, never
   * a field, never matched (a brand). ABSENT => nothing is shown and every block is byte-identical. */
  panel_readonly?: string[];
  /** SLICE 12d-1a (owner R6): the family definition's LABEL ("Item family", "Insulation material"),
   * filled by `itemListPricingSpec` from `list_spec.attribute_definitions`, so a missing family
   * refuses in the category's own words and no category is named in code. */
  family_label?: string;
  /** SLICE 8 (owner M-b): the overrides, applied AFTER the defaults and `derive_when_none` so they win over
   * both. ABSENT => nothing overrides and every row is byte-identical to before this slice. */
  override_when?: OverrideWhen[];
  /** SLICE 9 (owner A-4): the second-key rules. ABSENT => nothing resolves and every row is unchanged. */
  second_key?: SecondKey[];
  /** SLICE 12d-4a (owner D3): a value named in the row's OWN text but answered "not mentioned" refuses.
   * ABSENT => the default fires as before, and every row is byte-identical. */
  named_in_row?: NamedInRowRule[];
  /** SLICE 12d-4a (owner D7): unstocked materials refuse by name whatever family the model picked.
   * ABSENT => only `no_sku_families` refuses, as before. */
  unstocked_materials?: UnstockedMaterials;
  /** SLICE 12d-4a (owner D9b): a value not offered on rows of a unit class refuses with the ruled sentence.
   * ABSENT => such a row refuses, where it does, with the generic "no SKU for this combination". */
  refuse_on_unit_class?: RefuseOnUnitClass[];
  /** SLICE 12d-4a (owner D8): a working line generated from a copied text. ABSENT => no line. */
  read_notes?: ReadNote[];
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
  /** SLICE 12c (owner O3-a): `list_spec.family_attribute_id`, filled by `itemListPricingSpec` from the
   * config (the `qty_attribute_id` precedent -- it lives on `list_spec`, not in the pricing block).
   * ABSENT => "family", which is what ADP declares, so ADP is byte-identical. */
  family_attribute_id?: string;
  /** SLICE 12c: which SKU attribute labels a ladder rung. ABSENT => `item_detail` (what ADP carries).
   * A row MISSING this attribute is not a rung at all, so pointing it at an attribute the SKUs do not
   * have empties the ladder and refuses every row -- it is a correctness key, not a display one. */
  label_attr?: string;
  /** SLICE 12c: a stated size and a catalogue rung that are the SAME size written to different
   * precision (22.2 and 22.23; 7/8" and 22.23) resolve to the rung instead of laddering past it.
   * ABSENT => nothing resolves and every category is byte-identical to before this slice. */
  size_match?: SizeMatchSpec;
  /** SLICE 12c FINISH (owner F1: "missing thickness -> 9 mm default"). A NUMBER the row never stated
   * takes a ruled value, optionally only for named families. `defaults` cannot express this -- it is
   * for a CHOICE attribute whose model answer was "None". ABSENT => nothing is defaulted. */
  number_defaults?: Record<string, { value: number; families?: string[]; rule: string }>;
  /** SLICE 12c (owner Q8): what to do when a stated value is ABOVE the top rung of one named ladder
   * -- build it out of two or more rungs instead of refusing. ABSENT => it still refuses, exactly as
   * before. The tolerance and the layer ceiling are config, never code. */
  compose?: ComposeSpec & {
    /** WHICH ladder composes. A value here is a ladder attribute id; no other axis composes. */
    attr: string;
    /** The attribute only the OUTERMOST layer keeps -- every inner layer takes `value` instead.
     * Insulation's cladding wraps the outside of the stack, so the inner layers are bare. */
    outer_only?: { attr: string; value: string | number };
  };
  /** SLICE 6 (T7): the config's OWN `pipelines` -- the shared per-item default every unit block without
   * pipelines of its own runs. Filled by `itemListPricingSpec` from the config; never stored in the block. */
  default_pipelines?: Record<string, Pipeline>;
  /** SLICE 6b (owner V1, V4, V5): the panel's control PER SKU ATTRIBUTE -- "dropdown" (options built from the
   * ACTIVE SKUs of the block's family, or from the definition's closed vocabulary where no SKU carries it) or
   * "text" (a BoQ measurement the sheet does not stock as a pick). Declared in CONFIG, never in code; absent =
   * today's controls (a choice def a select, a number a text input). This block never reaches the model. */
  panel_controls?: Record<string, PanelControl>;
  /** OWNER FA8: one plain-English line per TYPED field saying what to enter. Declared in config, never
   * in code, so no category or attribute wording lives in the frontend.
   *
   * SLICE 12c-S (owner S4 / F1, F16): a note may instead be a LIST OF CLAUSES, each optionally
   * conditioned on what the pricing ACTUALLY DOES for the block it is being drawn for. A plain string
   * is still a note and behaves exactly as it always did. See `NoteClause` and `typedFieldNote`. */
  panel_notes?: Record<string, string | NoteClause[]>;
}

/**
 * SLICE 12c-S (owner S4 on F1, S5 on F16) -- ONE CLAUSE OF A TYPED FIELD'S NOTE, WITH THE CONDITION
 * UNDER WHICH IT IS TRUE.
 *
 * ⚠️ A NOTE IS GENERATED FROM WHAT THE PRICING READS, NOT WRITTEN PER FAMILY. The ADP size note
 * promised "plus depth where the BoQ gives one" on every family, including `double-skin plenum`,
 * whose pricing reads W and H and discards the depth -- the row priced, and the screen had invited
 * the value it threw away. The Insulation thickness note promised automatic layering to
 * `Cladding Only`, which stocks no sizes and layers nothing.
 *
 * The WORDING stays in config (no attribute English in the frontend); only the CONDITION is code, and
 * each condition is a question about the pricing of the block the note is being drawn for:
 *
 *   `when_reads`   -- include only where that SKU attribute is among the family's needs for this unit
 *                     class, i.e. the pricing genuinely reads it.
 *   `when_stocked` -- include only where the catalogue offers at least one rung for this field, i.e.
 *                     there is something to ladder or layer between.
 *
 * A clause with no condition is unconditional. The clauses that survive are joined with a space, in
 * declaration order, so the sentence a pricer reads is the config's own prose.
 */
export interface NoteClause {
  text: string;
  /** A SKU attribute; the clause survives only when the family's pricing reads it on this row's unit. */
  when_reads?: string;
  /** The clause survives only when this field has at least one stocked option. */
  when_stocked?: boolean;
}

/**
 * PURE. The note for one typed field, assembled for the family and unit class the block is showing.
 *
 * `reads` is the set of SKU attributes the family's pricing needs on this row (the same list
 * `itemFieldDefs` walks to decide which fields to render); `stocked` is the field's live option list.
 * A plain-string note is returned unchanged, so every config that has not declared clauses is
 * byte-identical. An empty result (every clause conditioned out) yields `undefined` -- no note rather
 * than an empty paragraph.
 */
export function typedFieldNote(
  spec: ItemListPricingSpec,
  attr: string,
  reads: ReadonlySet<string>,
  stocked: readonly string[],
): string | undefined {
  const raw = spec.panel_notes?.[attr];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "string") return raw.trim() === "" ? undefined : raw;
  const kept = raw
    .filter((c) => c && typeof c.text === "string" && c.text.trim() !== "")
    .filter((c) => (c.when_reads === undefined || reads.has(c.when_reads)))
    .filter((c) => (c.when_stocked !== true || stocked.length > 0))
    .map((c) => c.text.trim());
  return kept.length ? kept.join(" ") : undefined;
}

/**
 * OWNER FA8 (2026-10-04). `dropdown_or_other` is a live dropdown of the values the CATALOGUE stocks
 * PLUS an "other" entry for the value the BoQ actually states -- a size needs both, because the
 * ladder, the rounding and the composition rules exist precisely to resolve an UNSTOCKED size, and a
 * plain dropdown would remove the only way to say what the document says.
 */
export type PanelControl = "dropdown" | "text" | "dropdown_or_other";

/** The controls a person can TYPE into; each one declares what to type (`panel_notes`). */
export const TYPED_CONTROLS: ReadonlySet<PanelControl> = new Set(["text", "dropdown_or_other"]);

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
  const famAttr = (config as { list_spec?: { family_attribute_id?: unknown } } | null | undefined)?.list_spec?.family_attribute_id;
  // SLICE 12d-1a (owner R6): the family def's LABEL rides in, so the "could not be told" sentence speaks
  // the category's own words ("item family", "insulation material") -- no category named in code.
  const defs = (config as { list_spec?: { attribute_definitions?: Array<{ id?: unknown; label?: unknown }> } } | null | undefined)?.list_spec?.attribute_definitions;
  const famDef = Array.isArray(defs) ? defs.find((d) => d && d.id === (typeof famAttr === "string" && famAttr ? famAttr : "family")) : undefined;
  const famLabel = typeof famDef?.label === "string" && famDef.label.trim() ? famDef.label.trim() : undefined;
  return {
    ...(spec as ItemListPricingSpec),
    default_pipelines: pipelines,
    ...(typeof qtyAttr === "string" && qtyAttr ? { qty_attribute_id: qtyAttr } : {}),
    ...(typeof famAttr === "string" && famAttr ? { family_attribute_id: famAttr } : {}),
    ...(famLabel ? { family_label: famLabel } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------
// inputs / outputs
// ---------------------------------------------------------------------------------------------------------

/** One extracted item as the run stores it: `items[i].attributes[attr] = {value, confidence}`. */
export interface ExtractedListItem {
  attributes: Record<string, { value: string | number | null; confidence?: number;
    /** SLICE 12d-1b (owner T6): the PRICER typed this value (a calculator / panel entry). A typed value is
     * never parsed as layers -- the single-number entry stays as it is; only a MODEL answer may be layers. */
    typed?: boolean }>;
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
  /** SLICE 12c: set INSTEAD of pricing when the stated value is above the top rung and the category
   * declares `compose`. The item is not a refusal and not a price -- it is a request to `priceItemList`
   * to re-price it as several layered items. Carried on the result rather than handled here because
   * ONE item cannot return several prices, and the rungs are derived here and must not be derived
   * twice. */
  composeInto?: {
    attr: string;
    /** The stated value AS THE NUMBER READER READ IT. ⚠️ Carried rather than re-read from the extracted
     * item, because the model's answer is TEXT in the row's own words ("749 x 749") and `Number()` of it
     * is NaN -- the disclosure would name the size as NaN while every figure underneath was right. */
    stated: number;
    layers: number[];
    delta: number;
    top: number;
    /** SLICE 12d-1b (owner T4): the layers were STATED by the row ("65 mm + 32 mm", "19 x 2", "2 layers of
     * 19 mm"), not built above a top rung -- the expansion line names the BoQ's words instead. */
    explicit?: { raw: string };
  };
  /** The family the model returned (may be an alias or "none of these"). */
  familyRaw: string | null;
  /** The family that priced (after R3's alias). */
  family: string | null;
  /** SLICE 12d-1a (owner R2): the family came from `family_when_none` -- the row named no material
   * and the row kind decided. Present ONLY on such an item (the amber mechanism, like `defaulted`). */
  familyDefaulted?: { value: string; rule: string };
  /** The SKU unit class the pipelines ran against (after any conversion). */
  skuUnitClass: string | null;
  state: "priced" | "blank";
  reason?: string;
  /**
   * SLICE 12c-S. EVERY FACT THIS BLOCK RESOLVED, whether or not the row got far enough to use it.
   *
   * ⚠️ `selection` IS NOT A SUBSTITUTE, and that is why this exists. `selection` is filled one need at
   * a time and the loop RETURNS at the first missing one -- so on a row refusing for a missing
   * thickness, the pipe size the pricer HAS answered is absent from it. The dropdowns narrow on the
   * answers already given, and narrowing on `selection` meant a half-finished block narrowed nothing:
   * Tubular PUF offered every thickness at every pipe size, which is the defect this slice is for.
   *
   * DISPLAY AND OPTIONS ONLY. Nothing here reaches `match_master_row`; `selection` remains the one
   * thing the matcher is built from, so the prices are untouched.
   */
  readValues: Record<string, string | number>;
  /** What reached the interpreter, after defaults, parsing and ladder fits. */
  /** The index of the USER block this priced item came from. A composition yields several items
   *  sharing one `sourceIndex`; everything else is one-to-one. */
  sourceIndex?: number;
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
  /** SLICE 12c-U: how a row that stated NO unit (or "rate only") came to be priced in the unit it
   *  was -- present ONLY on such a row, so every other row's result is byte-identical.
   *  SLICE 12d-2 (owner S6): the sentence says "priced per <unit>" ONLY when the row actually
   *  priced; while it still refuses it says "unit taken as <unit>", because a figure that does not
   *  exist cannot have been priced in anything. */
  unitNote?: string;
  /** SLICE 12d-2 (owner S6): the unit the figures are a RATE IN, as the catalogue's word -- present
   *  ONLY when the row's own unit was resolved (no unit / rate-only), so the panel's "per ..." label
   *  reads "per number", never "per R/O". Every other row carries nothing and keeps its own spelling. */
  rateUnit?: string;
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
/**
 * SLICE 12c-U (owner U3). PURE. Does this unit cell mean "rate only" -- a rate asked for with no
 * quantity, and therefore with no unit?
 *
 * ⚠️ THE SPELLINGS ARE ONE THING, NOT FOUR. The owner named "R/O, RO, R.O., Rate Only" and ruled
 * them alike, so the comparison drops every non-alphanumeric character and the case: `R/O`, `RO`,
 * `R.O.`, `R O` and `Rate Only` all normalise to the same key. That is also why this cannot be a
 * list of literal spellings -- a BoQ writes punctuation however it likes.
 *
 * ⚠️ IT CANNOT SHADOW A REAL UNIT, AND THAT WAS MEASURED, NOT ASSUMED. `unitClassOf` is consulted
 * FIRST at the one call site, so a spelling that IS a unit can never reach this; and over both
 * shipped item-list categories every one of these spellings resolves to `null` through
 * `unitClassOf` (checked against the live `unit_classes` and `unit_factors` of `hvac_adp` and
 * `hvac_insulation` -- 70 spellings). A category that one day declares a unit called "ro" would
 * keep it, because the unit lookup wins.
 */
// SLICE 12d-4a (owner D10): "QRO" -- quoted rate only -- joins the rate-only keys; it appears both alone and
// as a PREFIX before a unit ("QRO - Sqm."), which `splitRateOnlyUnit` takes apart.
const RATE_ONLY_KEYS: ReadonlySet<string> = new Set(["ro", "rateonly", "qro", "quotedrateonly"]);

export function isRateOnlyUnit(unit: string | null | undefined): boolean {
  const key = String(unit ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return key !== "" && RATE_ONLY_KEYS.has(key);
}

/**
 * SLICE 12d-4a (owner D10). PURE. A unit spelt as a RATE-ONLY MARKER FOLLOWED BY A UNIT ("QRO - Sqm.",
 * "R/O Rmt") -> the unit part, or null when the spelling does not start with a rate-only key. The caller
 * resolves the remainder through `unitClassOf` exactly as it would any unit, so no second unit vocabulary
 * exists here; a remainder that is no unit leaves the row on the unchanged refusal.
 */
export function splitRateOnlyUnit(unit: string | null | undefined): string | null {
  const s = String(unit ?? "").trim();
  const m = s.match(/^([A-Za-z./]+)\s*[-:/]?\s+(.+)$/);
  if (!m) return null;
  const head = m[1].toLowerCase().replace(/[^a-z0-9]+/g, "");
  return RATE_ONLY_KEYS.has(head) ? m[2].trim() : null;
}

/**
 * SLICE 12c-U (owner U2 / U3 / U4). PURE. The unit CLASSES this ROW could be priced in.
 *
 * ⚠️ IT IS THE INTERSECTION ACROSS THE ROW'S ITEMS, AND IT HAS TO BE. A row prices in ONE class --
 * `priceOneItem` is handed a single `rowUnitClass` -- so a class only counts if EVERY item on the
 * row can be priced in it. On the one-item rows this rule actually fires on, the intersection is
 * simply that item's own set, which is exactly what the calculator's picker offers for it.
 *
 * ⚠️ THE SOURCE IS `familyUnitClasses`, THE SAME FUNCTION `unitChoicesOf` READS. That is the whole
 * point of resolving it here rather than writing a second list: `familyUnitClasses` already folds in
 * the family's own pipelines, its declared `convert` conversions (12c-F) and its `units_not_offered`
 * (12c-S), so this rule inherits every one of those rulings and cannot drift from the picker.
 * (`unitChoicesOf` takes the UNION, because a picker offers what ANY block could use; a ROW must be
 * priceable in the class it picks, hence the intersection. One source, two questions.)
 *
 * An item whose family is unknown, aliased to nothing, or carries no SKUs contributes NOTHING and
 * therefore empties the set -- such a row cannot be priced in any unit, and it refuses as it always
 * did rather than being guessed into one.
 */
export function rowUnitClasses(
  spec: ItemListPricingSpec,
  extracted: readonly ExtractedListItem[] | null | undefined,
): string[] {
  if (!extracted || !extracted.length) return [];
  let acc: string[] | null = null;
  for (const item of extracted) {
    const raw = rawValue(item, familyAttr(spec));
    const rawStr = raw === null ? null : String(raw);
    const family = rawStr === null || rawStr === "None" ? null : (spec.family_alias?.[rawStr] ?? rawStr);
    const classes = family ? familyUnitClasses(spec, family) : [];
    acc = acc === null ? classes.slice() : acc.filter((c) => classes.includes(c));
    if (acc.length === 0) return [];
  }
  return acc ?? [];
}

/** SLICE 12c-U. The unit a row priced in, named as the pricer's BoQ would name it. PURE. */
export function unitWordOf(spec: ItemListPricingSpec, cls: string): string {
  return unitWord(spec, cls);
}

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
/**
 * SLICE 12d-1b (owner T4, 2026-10-07) -- TWO (OR MORE) LAYERS WRITTEN AS ONE TEXT. Exactly three shapes, the
 * owner's: "a + b" (any count of "+"-joined numbers), "a x N" / "N x a", and "N layers of a" (N as a digit, or
 * the words "two" / "double"). Returns the layer thicknesses ASCENDING (the composition's own order, so the
 * largest is the OUTER layer), or null for anything else -- a single number, a slash list, a range, a size
 * phrase, a tolerance, "1 layer", "0 x". It reads the MODEL'S text; a pricer's typed entry never reaches it.
 */
export function readLayers(text: string | number | null | undefined): number[] | null {
  if (text === null || text === undefined) return null;
  const s = String(text).toLowerCase().replace(/\s+/g, " ").trim();
  if (s === "" || s === "none") return null;
  const num = "(\\d+(?:\\.\\d+)?)\\s*(?:mm)?";
  // "a + b [+ c]"
  const plus = s.match(new RegExp(`^${num}(?:\\s*\\+\\s*${num})+(?:\\s*(?:mm|thk|thick|thickness))?\\b.*$`));
  if (plus && !/[+]\s*$/.test(s)) {
    const parts = s.split("+").map((p) => p.match(/\d+(?:\.\d+)?/)).filter((m): m is RegExpMatchArray => !!m);
    if (parts.length >= 2 && parts.length === s.split("+").length) {
      return parts.map((m) => Number(m[0])).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    }
  }
  const count = (w: string): number | null => (w === "two" || w === "double" ? 2 : /^\d+$/.test(w) ? Number(w) : null);
  // "a x N" / "N x a"
  const byX = s.match(/^(\d+(?:\.\d+)?|two|double)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?|two|double)\s*(?:mm)?(?:\s*(?:thk|thick|thickness|layers?))?$/);
  if (byX) {
    // ONE side is a small COUNT (2..4), the other a THICKNESS above that band -- "19 x 2", "2 x 19". A size
    // ("600 x 600"), two counts ("2 x 3") or two thicknesses ("19 x 25") are not layers.
    const isCount = (w: string) => { const n = count(w); return n !== null && n >= 2 && n <= 4 ? n : null; };
    const isThick = (w: string) => (/^\d+(?:\.\d+)?$/.test(w) && Number(w) > 4 ? Number(w) : null);
    const n = isCount(byX[2]) !== null && isThick(byX[1]) !== null ? isCount(byX[2]) : isCount(byX[1]) !== null && isThick(byX[2]) !== null ? isCount(byX[1]) : null;
    const t = isThick(byX[1]) ?? isThick(byX[2]);
    if (n !== null && t !== null) return Array<number>(n).fill(t);
    return null;
  }
  // "N layers of a" / "double layer of a"
  const layersOf = s.match(/^(\d+|two|double)\s*layers?\s*(?:of)?\s*(\d+(?:\.\d+)?)\s*(?:mm)?(?:\s*(?:thk|thick|thickness))?$/);
  if (layersOf) {
    const n = count(layersOf[1]); const t = Number(layersOf[2]);
    if (n !== null && n >= 2 && t > 0) return Array<number>(n).fill(t);
  }
  // SLICE 12d-4a (owner D4): the SUFFIX form -- "25 mm thick - 2 Layers", "25 mm - two layers", "25 mm thick
  // double layer" (and "x 2" after the number, which `byX` above already takes). The count follows the
  // thickness, after an optional "thick" and an optional dash / colon; trailing words ("insulation") are
  // allowed. A count of 1, or a count the band does not admit (2..4), is not layers.
  const suffix = s.match(/^(\d+(?:\.\d+)?)\s*(?:mm)?\s*(?:thk|thick|thickness)?\s*[-–:,]?\s*(\d+|two|double)\s*layers?(?:\b.*)?$/);
  if (suffix) {
    const n = count(suffix[2]); const t = Number(suffix[1]);
    if (n !== null && n >= 2 && n <= 4 && t > 0) return Array<number>(n).fill(t);
  }
  return null;
}

/**
 * SLICE 12d-4a. PURE. Does `text` carry any of `words` at a WORD START, case-insensitively? The ONE word
 * test every text rule shares -- `family_when_none` (12d-1a), `named_in_row` (D3), `unstocked_materials`
 * (D7) and `refuse_on_unit_class` (D9b) -- so "acoustic" matches "acoustics" and never "subacoustic", on
 * every rule alike. Returns the first word that hit, or null.
 */
export function wordStartHit(text: string, words: readonly string[] | undefined): string | null {
  const t = text.toLowerCase();
  for (const word of words ?? []) {
    const w = word.toLowerCase().trim();
    if (!w) continue;
    if (new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t)) return word;
  }
  return null;
}

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
  const statedInInches = /\b(inch|inches)\b|"|\b\d+(\.\d+)?\s*in\b/.test(s);
  /**
   * OWNER FA8(d), 2026-10-04: "Type the pipe size the BoQ states, in mm (e.g. 22.2) or inches
   * (e.g. 7/8")." A reader DECLARING `inches: true` converts an inch value to mm; every other reader
   * keeps refusing them exactly as before, which is what leaves ADP and Electrical untouched.
   *
   * ⚠️ THE ARITHMETIC IS RIGHT HERE AND WRONG ELSEWHERE. The standing rule is that a unit conversion
   * belongs in the vocabulary the catalogue speaks (conduit's `inch_trade_mm` table), never as x25.4
   * -- because a conduit's TRADE sizes are not its inches. Copper tube is the opposite case: this
   * catalogue's own pipe sizes ARE inch-derived (6.35 = 1/4", 9.52 = 3/8", 22.23 = 7/8"), so x25.4
   * lands on a real rung and the 2-decimal `size_match` closes the gap -- 7/8" is 22.225 and the
   * stocked rung is 22.23. That epsilon is the one `roundHalfUp` was built for.
   *
   * ⚠️ AND ON SUCH A READER A BARE FRACTION MEANS INCHES. Before this, `7/8` parsed as 0.875 and
   * priced silently as a 9.52 mm pipe -- a plausible wrong size with nothing on screen to catch it.
   */
  if (reader.inches) {
    // SLICE 12d-1b (recon hazard pin, item 6): a bare FRACTION is ONE slash between TWO numbers (or a mixed
    // number: a whole, a space, a fraction). A slash LIST ("19/ 25 / 32 mm") is not an inch and must never
    // read as 19/25 of an inch -- it falls through to the several-values rules below.
    const slashCount = (s.match(/\//g) ?? []).length;
    const numberCount = numbersIn(s).length;
    const mixedForm = /^\s*\d+\s+\d+\s*\/\s*\d+/.test(s);
    const frac = slashCount === 1 && (numberCount === 2 || (mixedForm && numberCount === 3)) ? s.match(/(\d+)\s*\/\s*(\d+)/) : null;
    if (statedInInches || (frac && Number(frac[2]) !== 0)) {
      const mixed = s.match(/(\d+)\s+\d+\s*\/\s*\d+/);
      const part = frac ? Number(frac[1]) / Number(frac[2]) : Number((s.match(/[\d.]+/) ?? ["0"])[0]);
      const value = ((mixed ? Number(mixed[1]) : 0) + part) * 25.4;
      if (!Number.isFinite(value) || value <= 0) return { blank: `no number in '${raw}' for ${reader.name}` };
      return { value };
    }
  } else if (statedInInches) {
    return { blank: `${reader.name} stated in inches ('${raw}')` };
  }
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
  // SLICE 12d-1b (owner T2, 2026-10-07): a reader declaring `several: "highest"` takes the HIGHEST of a bare
  // slash list of ANY length ("19/ 25 / 32 mm" -> 32) -- "if the exact thickness cannot be determined, use the
  // highest value". ONLY a bare slash list: a comma list, a '+' pair (two LAYERS, T4) and a signed tolerance
  // keep refusing by name. ABSENT => the refusal below, byte-identical for every other category.
  if (reader.several === "highest" && found.length >= 3 && gaps.every(isAltPair)) {
    const hi = found.reduce((a, b) => (b.n > a.n ? b : a));
    const sc = scale(hi);
    return below({ value: sc.value, note: `'${raw}' states several values -- the highest, ${sc.value}, is taken` });
  }
  return { blank: `several values stated for ${reader.name} ('${raw}')` };
}

/**
 * SLICE 12c-F, FIX B (owner R-B, 2026-10-06) -- A MODEL-READ VALUE IS MATCHED TO THE DROPDOWN OPTION
 * IT MEANS, AND A ROW NEVER PRICES FROM A VALUE ITS FIELD CANNOT SHOW.
 *
 * The 12c-P parity cert found this on screen: the extraction read `"2 slot"`, the Slots dropdown
 * offers `2` and `3`, and `"2 slot"` is neither -- so the controlled select fell back to its
 * placeholder and the field read `- select -` while the row happily priced 1160 / 352 / 1512 from the
 * raw string. The figure was right; the screen could not show where it came from, and a pricer
 * reproducing the row in the calculator could only pick `2` and had no way to know that was the same
 * thing.
 *
 * THE RULE, STATED EXACTLY, in the order it is applied:
 *   1. No options at all -> no match. (A family whose SKUs stock no sizes has nothing to match
 *      against; such a field is an input to a formula, not a pick, and keeps its own wording.)
 *   2. SAME TEXT: trim, collapse internal whitespace, compare case-insensitively. `"3 Slot"` matches
 *      an option `"3 slot"`; `" 300 "` matches `"300"`.
 *   3. SAME NUMBER: read a number out of the stated text AND out of each option with the SAME reader
 *      the pricing uses, and match on numeric equality. This is what takes `"3 Slot"` to `3`,
 *      `"200 Dia"` to `200`, `"6mm"` to `6` and `"100 mm dia"` to `100`.
 *   4. Otherwise no match.
 *
 * ⚠️ IT REUSES `readNumber` AND DEFINES NO SECOND PARSER. `readNumber` is already how the PRICING
 * understood `"2 slot"` -- which is exactly why the row priced correctly while the field sat blank. A
 * private parser here could read a value the pricing does not, and then the field would show a number
 * the rate was not computed from: the defect inverted.
 *
 * ⚠️ IT IS GENERIC. No category, family or attribute is named: it takes a stated string, an option
 * list and a reader, and every dropdown in every category goes through it on the same terms.
 *
 * ⚠️ IT NEVER INVENTS A VALUE. A size the catalogue does not stock (a neck of 225 against options
 * 300 / 375 / 450) matches NOTHING here and is left exactly as it was, so the ladder still resolves it
 * to the next size up and the field still shows the rung that was bought. Matching and laddering are
 * different questions and this answers only the first.
 */
export function matchStatedToOption(
  stated: string,
  options: readonly string[],
  reader: NumberReader | undefined,
): string | null {
  if (options.length === 0) return null;
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const want = norm(stated);
  if (want === "") return null;
  for (const o of options) if (norm(o) === want) return o;
  if (!reader) return null;
  const read = (text: string): number | null => {
    const r = readNumber(text, reader);
    return r && "value" in r && Number.isFinite(r.value) ? r.value : null;
  };
  const n = read(stated);
  if (n === null) return null;
  for (const o of options) if (read(o) === n) return o;
  return null;
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

/**
 * SLICE 12c (owner O3-a, "4 ok"): the attribute that says WHICH family an item is -- the catalogue's
 * key and the model's answer are the same id, and `list_spec.family_attribute_id` is where a config
 * declares it. It was written as the literal "family" at eight sites, which is only right for a
 * category whose attribute happens to be called that. ABSENT => "family", so ADP is byte-identical.
 */
export function familyAttr(spec: ItemListPricingSpec): string {
  return spec.family_attribute_id ?? "family";
}

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
    const keys = Object.keys(sel).filter((k) => k !== familyAttr(spec) && k !== spec.unit_class_attr);
    const desc = keys.map((k) => `${shortName(spec, k)} ${String(sel[k])}`).join(", ");
    return `no SKU for this combination (${family}${desc ? ": " + desc : ""})`;
  }
  const m = label.match(/^attribute '([^']+)' missing or non-numeric/);
  if (m) return `no ${reasonName(spec, m[1])} stated`;
  // SLICE 12c-S (owner S6 on F9): plain English. The old wording -- "no base per-sq.m SKU for X to
  // derive from" -- told a pricer about the catalogue's internals and nothing about what to do. The
  // fact is simply that the sheet does not sell this combination in this unit.
  if (/matching row\(s\) -- not computed/.test(cond)) {
    return `the sheet does not price ${family} per ${unitWord(spec, sel[spec.unit_class_attr] as string)} with this choice`;
  }
  if (/not available on this row/.test(label)) return `the SKU carries no ${label.split(" ")[0].replace("cost_", "")} cost`;
  if (/not on the referenced row/.test(cond)) return `the base SKU carries no ${cond.split(" ")[0].replace("cost_", "")} cost`;
  return `could not compute (${cond || label})`;
}

/**
 * SLICE 12d-1a (owner R2). The family a row with NO material answer prices as, from the config's
 * `family_when_none`, or null when the config declares none or the unit class is not one it names.
 * PURE. The unit class picks the base family; then the FIRST word rule declared for that unit class
 * whose words appear in the row text (its own description and its headings, case-insensitive, whole
 * words) replaces it. The words are tested against the text the PANEL hands over; with no text only
 * the unit class decides.
 */
export function familyWhenNone(
  spec: ItemListPricingSpec,
  rowUnitClass: string,
  rowText: string,
): { value: string; rule: string } | null {
  const fwn = spec.family_when_none;
  if (!fwn) return null;
  let family = fwn.by_unit_class[rowUnitClass];
  if (!family) return null;
  for (const w of fwn.when_words ?? []) {
    if (w.unit_class !== rowUnitClass) continue;
    // a WORD START: "acoustic" matches "acoustics" and "acoustical", never "subacoustic" (the shared test)
    if (wordStartHit(rowText, w.words) !== null) { family = w.family; break; }
  }
  return { value: family, rule: fwn.rule };
}

/**
 * SLICE 12d-4a (owner D7 + D11). PURE. The NAMED-MATERIAL refusal for one item, or null: the family is a
 * `no_sku_families` value (T5, 12d-1b), or an `unstocked_materials` word sits in the row's own text or in the
 * text the model copied as the material (D7) -- whatever family the model picked. ONE definition, read by
 * `priceOneItem` and by `priceItemList`'s no-unit branch (D11: on a row with no unit this message shows
 * FIRST, because "no unit" is not the useful fact about a row the catalogue cannot price at all).
 */
export function namedMaterialRefusal(spec: ItemListPricingSpec, item: ExtractedListItem, ownText: string): string | null {
  const famRaw = rawValue(item, familyAttr(spec));
  const named = spec.no_sku_named_by ? rawValue(item, spec.no_sku_named_by) : null;
  const namedText = named !== null && named !== "None" && String(named).trim() !== "" ? String(named).trim() : null;
  if (famRaw !== null && (spec.no_sku_families ?? []).includes(String(famRaw))) {
    // SLICE 12d-1b (owner T5): where the config names the attribute that carries the material AS WRITTEN and
    // the model answered it, the refusal names that material; otherwise the sentence is the one it always was.
    return namedText !== null
      ? `No SKU in the catalogue for ${namedText} - price this row by hand`
      : `no SKU in the catalogue for '${String(famRaw)}' -- the user decides (R18)`;
  }
  const um = spec.unstocked_materials;
  if (um) {
    const copied = um.from_attr ? rawValue(item, um.from_attr) : null;
    const copiedText = copied !== null && copied !== "None" ? String(copied) : "";
    const hit = wordStartHit(`${ownText} | ${copiedText}`, um.words);
    if (hit !== null) return `No SKU in the catalogue for ${namedText ?? hit.toUpperCase()} - price this row by hand`;
  }
  return null;
}

function priceOneItem(
  spec: ItemListPricingSpec,
  projected: RateMasterItem[],
  rowUnitClass: string,
  item: ExtractedListItem,
  index: number,
  /** SLICE 11: the row unit's declared conversion, or null when it is a plain spelling of its class. */
  unitFactor: UnitFactor | null = null,
  /** SLICE 12d-1a (owner R2): the row's own text and its headings, for `family_when_none`'s words.
   * Absent (the calculator) => only the unit class can decide a silent row's family. */
  rowText: string = "",
  /** SLICE 12d-4a (owner D3 / D7 / D9b): the row's OWN text -- its description and its own notes, NEVER a
   * heading -- for the named-cladding, unstocked-material and sheet-glass-cloth word rules. Absent (the
   * calculator) => no word can match and only the model's values decide. */
  ownText: string = "",
): ItemPriceResult {
  const out: ItemPriceResult = {
    index, familyRaw: null, family: null, skuUnitClass: null, state: "blank", selection: {}, readValues: {}, defaulted: [],
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
  const famRaw = rawValue(item, familyAttr(spec));
  out.familyRaw = famRaw === null ? null : String(famRaw);
  // SLICE 12d-1a (owner R2): a row that names NO material prices as the family its ROW KIND implies --
  // declared in config, marked as a default. ONLY over an absent / "None" answer; a stated family,
  // "none of these" included, is never touched.
  const ruled = out.familyRaw === null || out.familyRaw === "None"
    ? familyWhenNone(spec, rowUnitClass, rowText) : null;
  if (ruled) {
    out.familyDefaulted = ruled;
    out.familyRaw = ruled.value;
  }
  // SLICE 12d-1a (owner R6): category-NEUTRAL -- the sentence names the family in the config's own label
  // ("no item family could be told", "no insulation material could be told"); it used to say "ADP kind".
  if (out.familyRaw === null || out.familyRaw === "None") return blank(`no ${(spec.family_label ?? "item family").toLowerCase()} could be told for this item`);
  const family = spec.family_alias?.[out.familyRaw] ?? out.familyRaw;
  out.family = family;
  if (spec.family_alias?.[out.familyRaw]) out.working.push(`'${out.familyRaw}' prices as ${family} (R3)`);
  // SLICE 12d-4a: the named-material refusal is ONE function (`namedMaterialRefusal`) -- the T5 no-SKU
  // family (12d-1b) and the D7 unstocked-material words share it, and `priceItemList`'s no-unit branch
  // reads the same one (D11). It runs BEFORE the family is checked against the priceable set, so an EPDM row
  // the model priced as Nitrile Rubber refuses by name whatever family was picked.
  const material = namedMaterialRefusal(spec, { ...item, attributes: { ...item.attributes, [familyAttr(spec)]: { value: out.familyRaw } } }, ownText);
  if (material !== null) return blank(material);
  if (!spec.families[family]) {
    return blank(`no SKU in the catalogue for '${out.familyRaw}' -- the user decides (R18)`);
  }
  const fam = spec.families[family];
  // SLICE 12d-4a (owner D8): a line generated from a text the model copied ("BoQ says 32 kg/m3 -> priced as
  // the 48 kg/m3 board"). Display only; `unless` is the stocked value that needs no line.
  for (const rn of spec.read_notes ?? []) {
    if (!rn.families.includes(family)) continue;
    const src = rawValue(item, rn.from_attr);
    if (src === null || src === "None") continue;
    let m: RegExpMatchArray | null = null;
    try { m = String(src).match(new RegExp(rn.pattern, "i")); } catch { m = null; }
    if (!m) continue;
    if (rn.unless !== undefined && (m[1] ?? m[0]).trim() === rn.unless) continue;
    out.working.push(rn.line.replace("{match}", m[0].trim()));
  }

  // (2) the facts: stated -> as stated; "None" -> the ruled default (marked); absent -> omitted. Read over every
  //     match attribute; only the family's NEEDS reach the matcher (below), so a stated fact the SKUs are not
  //     keyed on -- a diffuser's OUTER size beside its neck (R6) -- can never refuse a row.
  const read: Record<string, string | number> = {};
  const readDefaulted: DefaultedAttr[] = [];
  const unreadable: Record<string, string> = {};
  const noneSaid = new Set<string>();
  let layersFrom: { attr: string; raw: string; layers: number[] } | null = null;
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
      if ("blank" in got) {
        // SLICE 12d-1b (owner T4): the compose axis may be STATED AS LAYERS ("65 mm + 32 mm"). A model answer
        // that reads so is carried to the composition path below; a pricer's TYPED entry is not (T6).
        if (spec.compose && attr === spec.compose.attr && layersFrom === null) {
          for (const src of reader.from) {
            const cell = item.attributes?.[src];
            if (!cell || cell.typed === true) continue;
            const layers = readLayers(cell.value);
            if (layers && layers.length >= 2) { layersFrom = { attr, raw: String(cell.value), layers }; break; }
          }
        }
        unreadable[attr] = got.blank; continue;
      }
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
      const dv = ruledDefaultValue(spec, attr, family);
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
  // SLICE 12d-1a (owner R4): the VALUE MAP -- a stated value that prices as another, or refuses. It runs
  // LAST, over what the pricing now believes (defaults and overrides applied), so a ruled "No" can never
  // read as foil; it fires ONLY on its `from`, so a row already on the mapped value is byte-identical.
  for (const rule of spec.value_map ?? []) {
    if (!rule.families.includes(family)) continue;
    if (String(read[rule.attr] ?? "") !== rule.from) continue;
    if (rule.refuse) return { ...blank(rule.refuse), selection: { [familyAttr(spec)]: family } };
    if (rule.to === undefined) continue;
    read[rule.attr] = rule.to;
    const i = readDefaulted.findIndex((d) => d.attr === rule.attr);
    if (i >= 0) readDefaulted.splice(i, 1);
    overridden.push(rule.rule);
    out.overrides.push({ attr: rule.attr, value: rule.to, display: rule.display ?? rule.to, rule: rule.rule });
  }
  // SLICE 12d-4a (owner D9b): a value NOT OFFERED on this row's unit class -- glass cloth on sheet insulation
  // -- refuses with the ruled sentence: on the value the pricing now READS (a stated glass cloth, whatever
  // family), or, where the model said "None", on a glass-cloth word in the row's OWN text (the row ASKED for
  // it and the model missed it). It runs BEFORE D3 so the person is told the outcome, not asked to set a
  // cladding the sheet would then refuse. The unit class is the ROW's: the family's own class where it has
  // one, else the row's (a convert option would re-point it later, which does not change what the row asked).
  for (const rule of spec.refuse_on_unit_class ?? []) {
    if (rule.unit_class !== rowUnitClass) continue;
    if (!(rule.families ?? []).includes(family)) continue;   // 12d-4aF: the SHEET families only; Cladding Only is untouched
    const v = read[rule.attr];
    const byValue = v !== undefined && String(v).toLowerCase().includes(rule.value_contains.toLowerCase());
    const byWord = noneSaid.has(rule.attr) && wordStartHit(ownText, rule.words) !== null;
    if (byValue || byWord) return { ...blank(rule.refuse), selection: { [familyAttr(spec)]: family } };
  }
  // SLICE 12d-4a (owner D3): a value NAMED IN THE ROW'S OWN TEXT but answered "not mentioned" never falls
  // to the default -- the row refuses for a person. Headings never trigger it (`ownText` carries none).
  for (const rule of spec.named_in_row ?? []) {
    if (!noneSaid.has(rule.attr)) continue;
    if (wordStartHit(ownText, rule.words) !== null) return { ...blank(rule.refuse), selection: { [familyAttr(spec)]: family } };
  }
  // SLICE 12d-1b (owner T4): STATED LAYERS go through the EXISTING composition path -- each layer its own item
  // at the row's pipe size, `outer_only` stripping the cladding from every inner layer. Nothing new is priced
  // here; `priceItemList` expands it exactly as it expands a composition built above a top rung.
  if (layersFrom) {
    const total = layersFrom.layers.reduce((a, b) => a + b, 0);
    return { ...out, selection: { [familyAttr(spec)]: family },
      composeInto: { attr: layersFrom.attr, stated: total, layers: layersFrom.layers, delta: 0, top: Number.NaN, explicit: { raw: layersFrom.raw } } };
  }
  const sel: Record<string, string | number> = { [familyAttr(spec)]: family };

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
      (it) => it.kind === spec.kind && it.attributes[familyAttr(spec)] === family && it.attributes[spec.unit_class_attr] === target,
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

  // SLICE 12c-S: publish every resolved fact NOW, before the needs loop can return on the first
  // missing one -- the dropdowns narrow on these, and a block that refuses must still narrow.
  out.readValues = { ...read };
  // (4) the needs (R7-R10, R2): the first missing one names the blank; only the needed facts reach the matcher
  for (const n of needs) {
    if (n in read) { sel[n] = read[n]; continue; }
    /**
     * SLICE 12c FINISH (owner F1). A NUMBER the row never stated takes its ruled value rather than
     * refusing -- a cladding-only row that says no thickness is priced at 9 mm.
     *
     * ⚠️ IT MUST FIRE BEFORE THE REFUSAL BELOW, and it is MARKED like every other assumed value, so
     * the panel shows it as a default rather than as something the row said. A number the row DID
     * state is untouched: this branch is only reached when the key is absent from `read`.
     */
    /**
     * SLICE 12d-1b (owner T1, 2026-10-07): A STATED VALUE IS READ BEFORE ANY DEFAULT. A number the row
     * DID state but code cannot read ("as per specification", a list it does not take, "13+13" typed)
     * REFUSES by name here, BEFORE the default below is consulted. The default is for a value NOBODY
     * mentioned -- and with the thickness default widened to every family, this order is what stops
     * a mentioned thickness pricing silently at 9 mm (the recon's measured defect, Q8).
     */
    if (unreadable[n]) return { ...blank(unreadable[n]), selection: sel };
    const ndef = spec.number_defaults?.[n];
    if (ndef && Number.isFinite(ndef.value)
        && (!ndef.families || (out.family !== null && ndef.families.includes(out.family)))) {
      sel[n] = ndef.value;
      read[n] = ndef.value;
      // `DefaultedAttr.value` is the DISPLAY string every other default already uses
      readDefaulted.push({ attr: n, value: fmt(ndef.value), rule: ndef.rule });
      continue;
    }
    return { ...blank(spec.choice_attrs.includes(n) ? `could not tell ${reasonName(spec, n)}` : `no ${reasonName(spec, n)} stated`), selection: sel };
  }
  out.defaulted = readDefaulted.filter((d) => needs.includes(d.attr));

  // (5) the ladders (R6): the family's rows of the target class that carry the attribute, narrowed by the
  //     other stated keys those rows carry; exact else next up; above the largest = refuse
  const familyRows = projected.filter(
    (it) => it.kind === spec.kind && it.attributes[familyAttr(spec)] === family && it.attributes[spec.unit_class_attr] === target,
  );
  const keysCarried = new Set<string>();
  for (const it of familyRows) for (const k of Object.keys(it.attributes)) keysCarried.add(k);
  let candidates = projected;
  /**
   * ⚠️ OWNER C-R2 (2026-10-04): "we cannot combine 2 diffrent sized pipe SKus". A ladder -- and so the
   * COMPOSITION built from its rungs -- must be drawn from the rows of ONE pipe size, not from the
   * family as a whole.
   *
   * The clause below used to skip EVERY other ladder attribute when narrowing, which is why it did
   * not: at pipe 6.35 Nitrile stocks 13 and 19, but the thickness ladder was built across every pipe
   * and so offered 25 as well. Measured consequences, all one defect: a stated 25 at pipe 6.35 was
   * taken as an exact rung and then matched nothing; PUF 25 at pipe 50 refused instead of taking the
   * 50 that pipe stocks; and 44 at pipe 6.35 composed 19 + 25, where the 25 exists only at pipe 19.05.
   *
   * ⚠️ IT NARROWS ON A RESOLVED AXIS ONLY. A ladder attribute's STATED value may still need resolving
   * (22.2 is the stocked 22.23), so narrowing on a raw one would find no rows at all -- which is the
   * hazard the blanket skip was avoiding. `sel` is rewritten to the RUNG as each ladder resolves, so
   * an axis this loop has already passed is safe to narrow on, and one it has not is still skipped.
   * That makes the ORDER of `spec.ladders` load-bearing: the axis that selects the SKU set comes first.
   */
  const resolvedLadders = new Set<string>();
  for (const attr of spec.ladders) {
    if (!(attr in sel) || !needs.includes(attr)) continue;
    const where: Record<string, string | number> = { [familyAttr(spec)]: family, [spec.unit_class_attr]: target };
    for (const k of Object.keys(sel)) {
      if (k === attr || k === familyAttr(spec) || k === spec.unit_class_attr) continue;
      if (spec.ladders.includes(k) && !resolvedLadders.has(k)) continue;
      if (keysCarried.has(k)) where[k] = sel[k];
    }
    // SLICE 12c: the rung's LABEL attribute is config-declared, defaulting to ADP's `item_detail`.
    // ⚠️ IT IS NOT COSMETIC. `buildModuleLadder` SKIPS any row whose label attribute is missing, so a
    // category whose SKUs carry no `item_detail` builds an EMPTY ladder and every row reports
    // "no SKU for this combination" -- which is exactly what Insulation did, with nothing on screen
    // hinting that a display field was the cause. ABSENT => "item_detail", so ADP is byte-identical.
    const rungs = buildModuleLadder(familyRows, { kind: spec.kind, where, size_from: { attr }, label_attr: spec.label_attr ?? "item_detail" });
    const name = reasonName(spec, attr);
    const want = Number(sel[attr]);
    /**
     * ⚠️ A FAMILY WHOSE ROWS CARRY THIS ATTRIBUTE AT ALL IS LADDERING ON IT; ONE WHOSE ROWS CARRY IT
     * NOWHERE IS NOT. For the second, the stated value is an INPUT TO A FORMULA, not a choice between
     * rungs -- a cladding-only row has no pipe size of its own, and its cost is a continuous function
     * of the pipe size the ROW states. Without this the ladder found no rungs and refused every such
     * row with "no SKU for this combination", naming a size when nothing was wrong with the size.
     *
     * The test is the FAMILY'S OWN ROWS, so it cannot change a family that does ladder: every shipped
     * family's ladder attributes are carried by its rows (measured), which is why this is a no-op for
     * them and the refusal below still fires when some rows carry the attribute and none match.
     */
    if (!familyRows.some((it) => attr in (it.attributes ?? {}))) continue;
    if (!rungs.length) {
      const desc = Object.entries(where).filter(([k]) => k !== familyAttr(spec) && k !== spec.unit_class_attr).map(([k, v]) => `${shortName(spec, k)} ${String(v)}`).join(", ");
      return { ...blank(`no SKU for this combination (${family}${desc ? ": " + desc : ""})`), selection: sel };
    }
    // SLICE 12c: a stated value and a rung that are the SAME size written to different precision are
    // not a miss. Resolving FIRST matters: without it, 22.2 would ladder UP to 28.58 and buy a size the
    // row never asked for. ABSENT `size_match` => `matched` is null and the ladder decides, as before.
    const sizes = rungs.map((r) => r.size);
    const matched = resolveSize(want, sizes, spec.size_match);
    if (matched && !matched.exact) {
      // ⚠️ THE SELECTION MUST TAKE THE RUNG, NOT THE STATED VALUE. The ladder only rewrites `sel` when it
      // moves a value UP, so a resolved value would otherwise stay as written -- and `sel` is what the SKU
      // match is built from, so the row would look resolved on screen and match nothing underneath.
      sel[attr] = matched.rung;
      out.working.push(`${name} ${fmt(want)} is ${fmt(matched.rung)} on the sheet`);
    }
    const fit = fitModuleLadder(rungs, matched ? matched.rung : want, "up");
    if (!fit) {
      const top = rungs[rungs.length - 1];
      // SLICE 12c (owner Q8): above the top rung, build it out of rungs rather than refuse -- but only
      // on the ONE ladder the config names, and only as two or more layers (see `composeSize`).
      /**
       * OWNER C-R1: the LAST tie-break is the summed material cost of the layers, read from the rows
       * this very ladder was built from -- so the costs compared are the costs of the SKUs that would
       * actually be bought, at this pipe size, not a family-wide average. A rung with no cost on its
       * row yields null and the candidate falls through to the deterministic fallback.
       *
       * The rate key is CONFIG-DECLARED (`compose.cost_key`); absent, no cost is read and the
       * composition is chosen exactly as it was before this key existed.
       */
      const costKey = spec.compose?.cost_key;
      const costOf = costKey
        ? (rung: number): number | null => {
            for (const it of familyRows) {
              if (Number(it.attributes[attr]) !== rung) continue;
              if (!Object.entries(where).every(([k, v]) => k === attr || it.attributes[k] === v)) continue;
              const c = (it.rates ?? {})[costKey];
              if (typeof c === "number" && Number.isFinite(c)) return c;
            }
            return null;
          }
        : undefined;
      const comp = spec.compose && spec.compose.attr === attr ? composeSize(want, sizes, spec.compose, costOf) : null;
      if (comp) {
        return { ...out, selection: { ...sel }, composeInto: { attr, stated: want, layers: [...comp.layers].sort((a, b) => a - b), delta: comp.delta, top: top.size } };
      }
      return { ...blank(`${name} ${fmt(want)} is above the largest size on the sheet (${fmt(top.size)})`), selection: sel };
    }
    resolvedLadders.add(attr);
    out.ladderHops.push({ attr, name, requested: want, fitted: fit.modules, exact: fit.exact });
    if (!fit.exact) {
      out.working.push(`${name} ${fmt(want)} is not on the sheet -> ${fmt(fit.modules)} (next size up, R6)`);
      sel[attr] = fit.modules;
    }
    // a SKU without the ladder attribute is not on the ladder and must not match a laddered selection
    candidates = candidates.filter(
      (it) => !(it.kind === spec.kind && it.attributes[familyAttr(spec)] === family && it.attributes[spec.unit_class_attr] === target && !(attr in it.attributes)),
    );
  }
  out.selection = { ...sel };
  // the ladders rewrote `sel` to the RUNG; those resolved values are the ones to narrow on
  out.readValues = { ...out.readValues, ...sel };
  out.working.push(...notes);
  // SLICE 8 (M-b): the override is shown as its own working line, in the config's words, so a pricer can see
  // that the variant the row stated was set aside and why.
  out.working.push(...overridden);
  // SLICE 12d-1a (owner R2): the family default is a working line like every other default, named by
  // the family attribute, so a pricer reads WHY the row prices as this family beside the figure.
  if (out.familyDefaulted) out.working.push(`${familyAttr(spec)} not mentioned -> ${out.familyDefaulted.value} (${out.familyDefaulted.rule})`);
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
  /** SLICE 12d-1a (owner R2): the row's own text and its headings, joined -- read ONLY by
   * `family_when_none`'s word rules. Absent => only the unit class can decide a silent family. */
  rowText: string = "",
  /** SLICE 12d-4a (owner D3 / D7 / D9b): the row's OWN text (description + own notes, never a heading).
   * Absent (the calculator) => the word rules never match. */
  ownText: string = "",
): RowPriceResult {
  const unit = rowUnit ?? "";
  let cls = unitClassOf(spec, unit);
  /**
   * SLICE 12d-4a (owner D10): "QRO - Sqm." is a RATE-ONLY MARKER WITH A UNIT -- quoted rate only, per
   * sq.m. Where the whole spelling is no unit, the rate-only prefix is split off and the remainder is read
   * as the unit (through the same `unitClassOf`); the row then prices in THAT class with the rate-only
   * note. A spelling whose remainder is no unit either falls through to the unchanged refusal.
   */
  let rateOnlyWithUnit: string | null = null;
  if (cls === null && unit.trim() !== "") {
    const split = splitRateOnlyUnit(unit);
    if (split !== null) {
      const c2 = unitClassOf(spec, split);
      if (c2 !== null) { cls = c2; rateOnlyWithUnit = unitWord(spec, c2); }
    }
  }
  /**
   * SLICE 12d-2 (owner S6, "yes"): the 12c-U sentence is composed where the OUTCOME is known. The lead
   * ("No unit on the BoQ row" / "BoQ says R/O (rate only)") and the catalogue word are fixed here; the
   * verb is chosen at each return -- "priced per <unit>" on a priced row, "unit taken as <unit>" on a
   * row that still refuses -- so a refusal never claims a price was produced. `rateUnit` rides beside
   * it so the figures' "per ..." label names the unit the rate is in.
   */
  let resolvedUnit: { lead: string; word: string } | undefined;
  if (rateOnlyWithUnit !== null) resolvedUnit = { lead: `BoQ says ${unit.trim()} (rate only)`, word: rateOnlyWithUnit };
  const unitResolved = (priced: boolean): { unitNote: string; rateUnit: string } | Record<string, never> =>
    resolvedUnit
      ? {
          unitNote: `${resolvedUnit.lead} -> ${priced ? "priced per" : "unit taken as"} ${resolvedUnit.word}, the catalogue's unit for this item`,
          rateUnit: resolvedUnit.word,
        }
      : {};
  /**
   * SLICE 12c-U (owner U2 / U3 / U4, 2026-10-07) -- A ROW THAT STATES NO UNIT IS PRICED IN THE
   * CATALOGUE'S UNIT FOR ITS ITEM, OR REFUSES NAMING THE CHOICE. It is never guessed.
   *
   * Owner U2: "no unit at all should be priced in the default unit of the SKU with proper comment".
   * Owner U3: "R/O is rate only. tthese should also be priced in the default SKU unit with
   * appropriate comment". Owner U4 ("agreed"): where the item can be priced in MORE THAN ONE unit
   * -- Cladding Only per metre or per sq.m, VCD per sq.m or by number -- it REFUSES and names them,
   * because there is no default to fall back on and a guess would be a silent wrong price.
   *
   * ⚠️ THIS SUPERSEDES R12's "no unit -> refuse" FOR A MISSING OR RATE-ONLY UNIT ONLY. A unit that
   * is PRESENT and is a real unit the item cannot be priced in -- a spigot row written per metre, an
   * actuator row per sq.m -- still refuses exactly as before (owner U1: "all theseshould refuse
   * pricing"), because the BoQ said something and it was wrong, which is a different fact from the
   * BoQ saying nothing.
   *
   * ⚠️ `unitClassOf` IS CONSULTED FIRST, so a real unit can never be read as "rate only", and a
   * category that declared a unit spelled like one would keep it.
   */
  if (cls === null && (unit.trim() === "" || isRateOnlyUnit(unit))) {
    const rateOnly = isRateOnlyUnit(unit);
    const lead = rateOnly
      ? `BoQ says ${unit.trim()} (rate only)`
      : "No unit on the BoQ row";
    const classes = rowUnitClasses(spec, extracted);
    if (classes.length === 1) {
      cls = classes[0];
      resolvedUnit = { lead, word: unitWord(spec, cls) };
    } else if (classes.length > 1) {
      const named = classes.map((c) => `per ${unitWord(spec, c)}`).join(" or ");
      return {
        unit,
        unitClass: null,
        priced: false,
        reason: `${lead} - this item is priced ${named}; set the unit`,
        items: [],
      };
    }
    // classes.length === 0: nothing to price in at all -- fall through to the unchanged refusal
  }
  if (cls === null) {
    // SLICE 12d-4a (owner D11): on a row the catalogue cannot price AT ALL (an unstocked material), that is
    // the useful message and it shows FIRST -- "no unit" is true but not what the person needs to know.
    const material = extracted && extracted.length ? namedMaterialRefusal(spec, extracted[0], ownText) : null;
    if (material !== null) return { unit, unitClass: null, priced: false, reason: material, items: [] };
    const reason = unit.trim() === "" ? "no unit on this row (R12)" : `unit '${unit.trim()}' is not a count, area or length unit (R12)`;
    return { unit, unitClass: null, priced: false, reason, items: [] };
  }
  if (!extracted || !extracted.length) {
    return { unit, unitClass: cls, priced: false, reason: "no items were read on this row", items: [], ...unitResolved(false) };
  }
  const projected = projectUnitClass(spec, items);
  // SLICE 11: computed ONCE from the row's unit TEXT (the class alone cannot say which unit of it this is).
  const unitFactor = unitFactorOf(spec, unit);
  let priced = extracted.map((it, i) => priceOneItem(spec, projected, cls, it, i, unitFactor, rowText, ownText));
  // SLICE 12c (owner Q8/Q9): an item whose stated size is above the top rung may be BUILT out of two or
  // more rungs. `priceOneItem` cannot do it alone -- one item cannot return several prices -- so it hands
  // back the layers it found and the expansion happens here, where a row has always been able to hold a
  // LIST of items. Each layer then prices through the SAME unchanged path; only the search is new.
  if (priced.some((p) => p.composeInto)) {
    const expanded: ItemPriceResult[] = [];
    priced.forEach((p, i) => {
      const c = p.composeInto;
      // SLICE 12c (cert-found 2026-10-04): which USER block each priced layer came from. A composition
      // turns ONE block into several layers, so without this the panel can only find the FIRST and shows
      // one layer's figures beside a row total that counts them all.
      if (!c) { expanded.push({ ...p, index: expanded.length, sourceIndex: i }); return; }
      const oo = spec.compose?.outer_only;
      const src = extracted[i];
      // INNERMOST first, so the LAST item is the outer one -- which is the layer that keeps the cladding.
      c.layers.forEach((layer, li) => {
        const outer = li === c.layers.length - 1;
        const attrs: ExtractedListItem["attributes"] = { ...src.attributes, [c.attr]: { value: layer } };
        if (oo && !outer) attrs[oo.attr] = { value: oo.value };
        const one = priceOneItem(spec, projected, cls, { ...src, attributes: attrs }, expanded.length, unitFactor, rowText, ownText);
        if (li === 0) {
          const total = c.layers.reduce((a, b) => a + b, 0);
          const sign = c.delta >= 0 ? "+" : "";
          // OWNER FA8(c): the line the panel shows after a composition, in the owner's own phrasing --
          // "You typed 30 mm -> priced as 13 + 19 mm (32 mm)". The unit comes from the axis's own
          // reader, so no unit is written here, and the stocked top it could not reach is kept so the
          // reader can see WHY it was composed at all.
          const unit = spec.numbers[c.attr]?.unit;
          const u = unit ? ` ${unit}` : "";
          // SLICE 12d-1b (owner T4): layers the ROW stated are named in the BoQ's own words, not as a
          // size built above a top rung.
          const words: Record<number, string> = { 2: "two", 3: "three", 4: "four" };
          // SLICE 12d-2 (owner S5 / F17): "You typed" ONLY for what a person typed. The composition line
          // used to say it for every model-read size too; the 12d-1b `typed` marker (set by
          // `assembleItems` on a pricer's entries alone) is what decides, read off the cell(s) the axis's
          // reader takes its value from.
          const typedByPricer = (spec.numbers[c.attr]?.from ?? [c.attr]).some((k) => src.attributes?.[k]?.typed === true);
          const said = typedByPricer ? "You typed" : "BoQ says";
          one.working.unshift(c.explicit
            ? `BoQ says ${c.explicit.raw} -> priced as ${words[c.layers.length] ?? c.layers.length} layers, ${c.layers.map(fmt).join(" + ")}${u} (${fmt(total)}${u}); cladding on the outer layer only`
            : `${said} ${fmt(c.stated)}${u} -> priced as ${c.layers.map(fmt).join(" + ")}${u}` +
              ` (${fmt(total)}${u}, ${sign}${fmt(c.delta)}) -- above the largest stocked size (${fmt(c.top)}${u})`,
          );
        }
        expanded.push({ ...one, sourceIndex: i });
      });
    });
    priced = expanded;
  }
  const firstBlank = priced.find((p) => p.state === "blank");
  if (firstBlank) {
    // R21: all or nothing -- the row shows no price; every item keeps its own state above
    const who = priced.length > 1 ? `item ${firstBlank.index + 1}${firstBlank.family ? ` (${firstBlank.family})` : ""}: ` : "";
    return { unit, unitClass: cls, priced: false, reason: `${who}${firstBlank.reason}`, items: priced, ...unitResolved(false) };
  }
  const sum = (k: string) => priced.reduce((a, p) => a + (p.figures[k] ?? 0), 0);
  return { unit, unitClass: cls, priced: true, supply: sum("supply"), install: sum("install"), items: priced, ...unitResolved(true) };
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

/**
 * SLICE 12c-S (owner S2 / S10). PURE. The unit classes this family may be OFFERED in: the classes it
 * prices natively (`units`) plus the classes it can convert into (`convert`), less any the family
 * declares `units_not_offered`. An unknown family offers nothing.
 *
 * ⚠️ `convert` BELONGS IN THE UNION. Twelve ADP families are quoted per sq.m and priced on a
 * per-number row by converting a stated W x H (or an area band) -- that conversion is the ONLY path on
 * which their Size and Area band fields render at all. Leaving it out would take the per-number unit
 * off thirteen families and, with it, every size field the pricer types into.
 */
export function familyUnitClasses(spec: ItemListPricingSpec, family: string): string[] {
  const fam = spec.families[family];
  if (!fam) return [];
  const hidden = new Set(fam.units_not_offered ?? []);
  const out: string[] = [];
  for (const cls of [...Object.keys(fam.units), ...Object.keys(fam.convert ?? {})]) {
    if (hidden.has(cls) || out.includes(cls)) continue;
    out.push(cls);
  }
  return out;
}

/**
 * SLICE 12d-2 (owner S4) -- THE ONE reader of a ruled default: the catalogue value a `"None"` (not
 * mentioned) answer becomes for this attribute on this family -- `defaults[attr].by_family[family]`
 * where the default is per family, else `defaults[attr].value`; `undefined` where no ruled default
 * applies. It is read by the pricing (`priceOneItem`, over a "None" answer) AND by `itemFieldDefs`
 * (to decide whether "None" is offered at all), so the two can never disagree about which sentinel
 * maps to a catalogue value. `derive_when_none` is CONDITIONAL and deliberately not a ruled default
 * here. PURE; no category or attribute is named.
 */
export function ruledDefaultValue(spec: ItemListPricingSpec, attr: string, family: string): string | undefined {
  const d = spec.defaults?.[attr];
  if (!d) return undefined;
  return d.by_family ? d.by_family[family] : d.value;
}

/** One field of an item block: the id the VALUE is read / written under (the model's attribute id -- a
 * number reader's first `from`), the label, the options of a choice (with "None" first when allow_none
 * AND no ruled default maps it -- owner S4, 12d-2), and which SKU attribute it serves. */
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
  /** OWNER FA8: this field offers its stocked options AND lets a person type an unstocked value. */
  allowOther?: boolean;
  /** OWNER FA8: what to type here, in plain English -- shown under every field a person can type in. */
  typedNote?: string;
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
    (it) => it.kind === spec.kind && it.attributes[familyAttr(spec)] === family && (classes.size === 0 || classes.has(String(it.attributes[spec.unit_class_attr]))),
  );
  const carrying = famRows.filter((it) => attr in it.attributes);
  /**
   * SLICE 12c-S (owner S1, F2) -- THE OPTIONS ARE NARROWED BY THE ANSWERS ALREADY GIVEN.
   *
   * ⚠️ THE OLD TEST WAS `=== "dropdown"`, WHICH EXCLUDES `dropdown_or_other` -- and `dropdown_or_other`
   * is the control every SIZE field uses. So an answered pipe size narrowed nothing: Tubular PUF offered
   * 25 / 50 / 65 / 80 at every pipe size while each pipe stocks exactly ONE thickness, and pipe 100 with
   * thickness 25 priced as 65 -- 2.6x the thickness picked, with nothing on screen saying so.
   *
   * Every answer narrows now, whatever control carries it. Three properties keep that safe:
   *   - the answers are `res.selection`, i.e. the values AS THE MATCHER RESOLVED THEM, never raw text;
   *   - an attribute no row of this family carries cannot narrow (it is not a key of these SKUs);
   *   - an answer that would empty the set is SKIPPED rather than applied, so a single unmatchable
   *     value can never blank a dropdown. That is strictly more narrowing than before and can never
   *     turn a non-empty list into an empty one.
   */
  let rows = carrying;
  for (const [k, v] of Object.entries(answers)) {
    if (k === attr || v === "" || v === "None" || v === null || v === undefined) continue;
    if (!carrying.some((it) => k in it.attributes)) continue;
    const narrowed = rows.filter((it) => sameValue(it.attributes[k], v));
    if (narrowed.length) rows = narrowed;
  }
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
  // SLICE 12c-S: WHAT THIS FAMILY'S PRICING READS on a row of this unit class -- the same list the loop
  // below walks to decide which fields to render. A note clause conditioned on `when_reads` is kept only
  // when the attribute it names is in here, which is what stops the ADP size note inviting a depth that
  // `double-skin plenum` discards.
  const reads = new Set<string>(ids);
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
      if ((control === "dropdown" || control === "dropdown_or_other") && skus) {
        // a STOCKED size: the options are the sheet's sizes for this family, narrowed by the block's other answers.
        // OWNER FA8: `dropdown_or_other` offers those SAME live options and still lets a person type the size the
        // BoQ states -- the ladder then resolves it and says which stocked size it used.
        const options = fieldOptionsFromSkus(spec, skus.items, family, rowUnitClass, attr, skus.answers ?? {});
        const typedNote = typedFieldNote(spec, attr, reads, options);
        out.push({ id: modelId, label: d?.label ?? reader.name, allowNone: false, skuAttr: attr, control, options,
                   optionSource: "catalogue",
                   ...(control === "dropdown_or_other" ? { allowOther: true, typedNote } : {}) });
      } else {
        const typedNote = typedFieldNote(spec, attr, reads, []);
        out.push({ id: modelId, label: d?.label ?? reader.name, allowNone: false, skuAttr: attr, control,
                   ...(TYPED_CONTROLS.has(control) ? { typedNote } : {}) });
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
    if (control !== "dropdown" && control !== "dropdown_or_other") {
      const typedNoteC = typedFieldNote(spec, attr, reads, []);
      out.push({ id: attr, label: d.label, allowNone: d.allow_none === true, skuAttr: attr, control,
                 ...(TYPED_CONTROLS.has(control) ? { typedNote: typedNoteC } : {}) });
      continue;
    }
    // a choice: from the SKUs where the family's rows carry the attribute (V1), else the definition's vocabulary
    let fromSkus = skus ? fieldOptionsFromSkus(spec, skus.items, family, rowUnitClass, attr, skus.answers ?? {}, values) : [];
    /**
     * SLICE 12c-S (owner S6, F8/F9) -- A FAMILY THAT PRICES A UNIT CLASS ITS OWN SKUs DO NOT CARRY.
     *
     * Cladding Only is quoted per METRE and also declares a per-SQ.M pipeline that derives from those
     * same metre rows. At sq.m the unit-class filter therefore found NO rows, and the fallback below
     * handed the pricer the DEFINITION's whole vocabulary -- 9 claddings, 4 of which cannot price,
     * three of them other families' values.
     *
     * Dropping the unit class (passing it as null) reads the family's OWN rows whatever unit they are
     * quoted in. Measured on the live catalogue: that yields exactly the 5 claddings that price at
     * sq.m, and excludes exactly the 3 that refuse. The definition's vocabulary stays as the last
     * resort, for a family whose SKUs carry the attribute nowhere at all.
     */
    if (!fromSkus.length && skus) {
      fromSkus = fieldOptionsFromSkus(spec, skus.items, family, null, attr, skus.answers ?? {}, values);
    }
    const optionSource: "catalogue" | "definition" = fromSkus.length ? "catalogue" : "definition";
    const base = fromSkus.length ? fromSkus : [...values];
    /**
     * SLICE 12d-2 (owner S4, "agree"): "None" is the MODEL's word for "not mentioned". Where a ruled
     * default turns it into a catalogue value (cladding not mentioned -> No; damper not mentioned ->
     * without) it is not a choice a person can make -- picking it would only land on the default --
     * so it is NOT offered; the field shows the catalogue value the default became, amber, with the
     * default's line beneath it (the existing `defaulted` rendering). Where NO ruled default maps it
     * (an air stream, an Electrical "MCB 2: None" on the row-level surface, which never reaches this
     * function) the sentinel stays a real choice and is offered exactly as before.
     */
    const noneMapsToCatalogue = ruledDefaultValue(spec, attr, family) !== undefined;
    out.push({
      id: attr,
      label: d.label,
      options: d.allow_none && !noneMapsToCatalogue ? ["None", ...base] : base,
      allowNone: d.allow_none === true,
      skuAttr: attr,
      control,
      ...(control === "dropdown_or_other"
        ? { allowOther: true, typedNote: typedFieldNote(spec, attr, reads, base) }
        : {}),
      optionSource,
    });
  }
  return out;
}


/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * OWNER FA8 (2026-10-04) -- WHAT TO TYPE IN A SIZE FIELD, AND HOW IT WILL BE MATCHED
 *
 * The owner approved the wording; this generates the SIZES in it LIVE from the catalogue, because a
 * worked example naming a size that is no longer stocked teaches the reader something false. Every
 * number below is read from the active SKUs of the block's family, or computed by the SAME
 * `resolveSize` / `composeSize` the pricer uses -- so the explanation cannot drift from the matching.
 *
 * It is generated from the SPEC's own declared rules (`size_match.dp`, `compose`), never from a list
 * of categories: a category that declares no composition simply gets no composition line.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/** What a size field tells the pricer: the one-line note, and the rules behind "Other...". */
export interface SizeFieldHelp {
  /** the one-line note under the box -- what to type */
  note: string;
  /** the "How is this matched?" rules, each a complete sentence with its own live example */
  lines: string[];
}

/** PURE. `12` not `12.0`, and `22.23` kept -- a size reads as the catalogue writes it. */
function sizeText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

/**
 * PURE. The help for ONE size field, or null when the attribute is not a size this spec ladders on.
 *
 * `stocked` is the live option list (the same `fieldOptionsFromSkus` the dropdown is built from), so
 * adding a catalogue row changes the examples with no code change.
 */
export function sizeFieldHelp(
  spec: ItemListPricingSpec,
  attr: string,
  stocked: readonly string[],
): SizeFieldHelp | null {
  const reader = spec.numbers[attr];
  if (!reader) return null;
  const nums = stocked.map((s) => Number(s)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const name = reader.name ?? attr;
  const unit = reader.unit ? ` ${reader.unit}` : "";
  const lines: string[] = [];
  if (!nums.length) {
    return { note: `Type the ${name} the BoQ states${unit ? `, in ${reader.unit}` : ""}.`, lines };
  }

  const smallest = nums[0];
  const largest = nums[nums.length - 1];
  const composes = spec.compose?.attr === attr;

  // (1) EXACT -- a stocked size is used as it stands
  lines.push(`A size the sheet stocks is used as it stands (${sizeText(smallest)}${unit}).`);

  // (2) PRECISION -- the same size written to a different number of decimals (`size_match.dp`)
  const dps = (spec.size_match?.dp ?? []).filter((d) => Number.isFinite(d));
  const fractional = nums.find((n) => !Number.isInteger(n));
  if (dps.length && fractional !== undefined) {
    for (const dp of dps) {
      const written: number = Number(fractional.toFixed(dp));
      if (written === fractional) continue;
      lines.push(
        `The same size written to ${dp} decimal${dp === 1 ? "" : "s"} is the same size: `
        + `${sizeText(written)} is matched to ${sizeText(fractional)}${unit}.`,
      );
    }
  }

  // (2b) INCHES, where the axis declares them -- with a worked example CHOSEN from the stocked sizes
  if (reader.inches) {
    const common: Array<[string, number]> = [["1/4", 1 / 4], ["3/8", 3 / 8], ["1/2", 1 / 2],
                                             ["5/8", 5 / 8], ["3/4", 3 / 4], ["7/8", 7 / 8], ["1", 1]];
    // the example is the first common fraction that lands on a size THIS catalogue stocks, so it can
    // never name an inch size the sheet has no rung for
    const hit = common.find(([, f]) => nums.some((n) => Math.abs(n - f * 25.4) < 0.02));
    if (hit) {
      const landed = nums.find((n) => Math.abs(n - hit[1] * 25.4) < 0.02)!;
      lines.push(`An inch size is converted to ${reader.unit ?? "mm"}: ${hit[0]}" is `
                 + `${sizeText(Number((hit[1] * 25.4).toFixed(3)))} and matches ${sizeText(landed)}${unit}.`);
    }
  }

  // (3) BETWEEN TWO STOCKED SIZES -- the next size up
  const gap = nums.find((n, i) => i > 0 && n - nums[i - 1] > 1);
  if (gap !== undefined) {
    const below = nums[nums.indexOf(gap) - 1];
    const between = Math.round((below + gap) / 2);
    if (between > below && between < gap) {
      lines.push(`A size between two stocked sizes takes the next size UP: `
                 + `${sizeText(between)} is priced as ${sizeText(gap)}${unit}.`);
    }
  }

  // (4) ABOVE THE LARGEST -- layers, or a refusal
  if (composes && spec.compose) {
    const c = spec.compose;
    const target = largest + Math.max(2, Math.round(smallest / 2));
    const comp = composeSize(target, nums, c);
    const built = comp?.layers ?? [];
    if (built.length > 1) {
      const sum = built.reduce((a, b) => a + b, 0);
      lines.push(
        `Thicker than the largest stocked size is built from ${built.length} layers within `
        + `${sizeText(c.tolerance ?? 0)}${unit}, fewest layers first: ${sizeText(target)} is priced as `
        + `${built.map(sizeText).join(" + ")} = ${sizeText(sum)}${unit}, shown as separate items.`,
      );
      /**
       * ⚠️ CERT-FOUND, 2026-10-04. This line used to read "Layers written out (19+13) each price as
       * their own item at the same size" -- and the reader REFUSES "19+13" ("several values stated").
       * The same false promise lived in the config note and was corrected there at v25; it SURVIVED
       * HERE, in generated help, and only a runtime read of the screen found it. A note and the help
       * beneath it are two sentences about one behaviour and must be changed together.
       *
       * The refusal is correct and stays: hand-written layers would bypass the C-R1 ordering
       * (fewest layers, then closest, then cheapest) entirely. So the help says what to type.
       */
      lines.push(`Type one number -- layers written out (${built.map(sizeText).join("+")}) are not `
                 + `accepted. Where nothing fits, the row is not priced and the reason is shown.`);
    } else {
      lines.push(`Larger than the largest stocked size (${sizeText(largest)}${unit}) is not priced, `
                 + `and the reason is shown.`);
    }
  } else {
    lines.push(`Larger than the largest stocked size (${sizeText(largest)}${unit}) is not priced, `
               + `and the reason is shown.`);
  }

  const egs = nums.slice(0, 2).map(sizeText).join(", ");
  const note = composes
    ? `Type the ${name} in ${reader.unit ?? "mm"} as the BoQ states it, e.g. ${egs}, `
      + `or ${sizeText(smallest)}+${sizeText(smallest)} for two layers.`
    : `Type the ${name} the BoQ states, in ${reader.unit ?? "mm"} (e.g. ${egs}).`;
  return { note, lines };
}
