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
  PipelineStep,
  RateCategoryConfig,
  RateMasterItem,
} from "../../pricing/rate-master/rateMasterTypes";
import { resolveSize, composeSize, nearestRung, type SizeMatchSpec, type ComposeSpec } from "./ladderResolution";
import { noSkuSentence, type PlainFact } from "../../pricing/rate-master/plainEnglish";

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
  /**
   * SLICE 12e-2 (owner Q14, 2026-10-10): "for inch to mm conversion we should try the conversion using 1 inch
   * = 2.5 mm also in addition to 1 inch = 2.54 mm" -- a SECOND millimetres-per-inch figure (25) carried as an
   * ALTERNATIVE read beside the exact one (x 25.4). The ladder tries the exact read at every rounding depth
   * first, then the alternative (4 inch: 101.6 lands on no MS rung, 100 does). Needs `inches: true`.
   * ABSENT => one conversion, every other reader byte-identical.
   */
  inch_mm_alt?: number;
  /**
   * SLICE 12e-2 (owner P2): a value the PRICER types on this axis must be ONE size -- a number in mm (an NB
   * number is mm; a trailing "mm" / "NB" accepted) or an inch form (5/8", 1-1/4", 1 1/4", 1¼", 2", 2 inch).
   * "40/50" and "two inch" refuse with `ONE_SIZE_MESSAGE`. TYPED cells only; a model cell is read as
   * before. ABSENT => the reader is byte-identical. SLICE 12e-6c (owner U1): the key no longer turns the field's
   * line into the full read ("You typed 5/8\" -> 15.875 mm -> ..."); Piping's line comes from its other keys.
   */
  typed_entry?: "one_size";
  /**
   * SLICE 12e-4b (owner F-1, 2026-10-13: "insulation should get the original pipe size read by BoQ and then will
   * match/ ladder independently based on insulation logic" + "option B"): on THIS axis the nearest stocked size
   * within this distance of the stated value counts as the stated size (a 22.3 pipe is the sheet's 22.23) -- the
   * rule `size_match.near` declares for a whole category (Q14a), declared for ONE axis so the category's other
   * ladders are untouched. The working carries "... is <rung> on the sheet (within <near> <unit>)". ABSENT =>
   * the axis resolves exactly as before, byte-identical.
   */
  near?: number;
  /**
   * ADP-1 (owner H3, 2026-10-19: "when priced in numbers, we match with SKU (based on slots and damper) and arive at
   * the per nos rate usingthe lentgh of the piece. so we need to caputre the length"). A TYPED-ONLY number: `from[0]`
   * names a box the PRICER types into and no model attribute -- it is not a list_spec definition, so the model is
   * never asked it and the extraction request is byte-identical. It is read only where the family's rule for the
   * row's unit NEEDS it, so no other family reads it, shows it, or carries a line about it. ABSENT => as before.
   */
  typed_only?: boolean;
  /** ADP-1 (owner H3): with nothing typed, the number is read from this model text attribute -- the size as written --
   * by `readPieceLength` (the side written as the length, else the longest side of "a x b"). Needs `typed_only`. */
  length_from?: string;
  /** ADP-2 (owner H7 / Q2, 2026-10-20: "Ok" -- fill Length / Width / Height from the size as written in the order
   * L x W x H, height last, a written label winning). With `length_from`, the typed box is filled from ONE SIDE of the
   * box the size states (`readBoxSides`), not from the W / H / D axes of a face size. Display and fill only: the
   * plenum formula reads all three sides and is symmetric, so no figure depends on which side is which. ABSENT =>
   * `length_from` reads a piece length (unit "m", ADP-1) or, for any other unit, the attribute as one number. */
  box_side?: "length" | "width" | "height";
  /** ADP-3b (owner B1; D1 / D2, 2026-10-20 22:25). With `length_from`, the typed box is filled from ONE SIDE of the
   * FACE the size states (`readFaceSides`: W x H, the first two parts, a label deciding between them) -- not the L x W
   * x H of a box (`box_side`). ABSENT => `length_from` reads as before. */
  face_side?: "width" | "height";
  /** ADP-1: the panel label of a `typed_only` box ("Piece length (m)"); a list_spec definition has its own. */
  label?: string;
  /** ADP-1 (owner H3 (c), 2026-10-19: 1- and 4-slot rows "refuse"): where the family's rule for the row's unit NEEDS
   * this number and none of its SKUs in that unit carries the value read, the item refuses with this sentence
   * (`{value}` = the number). ABSENT => the generic "No SKU for ..." sentence, as before. */
  not_stocked?: string;
  /**
   * ADP-1 (owner F1, 2026-10-19: "agree on all F1 to F4"): on an axis that reads inches (the F-3 rule), a BARE number
   * below the smallest stocked size whose inch readings (x 25.4 and x the axis's second factor) are ALL ABOVE the
   * largest also refuses with the F-3 sentence -- nobody can tell "4" from 4 mm or 4 inches (Nitrile "4"). Declared per
   * axis, so Piping's pipe size is untouched. ABSENT => such a number takes the smallest size, as before.
   */
  bare_above_largest?: "refuse";
}

/**
 * SLICE 12e-2 (owner Q16 / Q15 / Q18, 2026-10-10) -- HOW A FAMILY ANSWER WRITTEN AS THE BoQ WRITES IT IS READ.
 *
 * The calculator's Pipe type "Other..." box (and, in 12e-4, the model's answer) may carry a spelling that is
 * not a stocked family: GI prices as MS, uPVC and HDPE as PVC, each with the `line` said under the field; SS
 * refuses with its own sentence; anything else refuses by name (the R18 sentence). ONE reader,
 * `readFamilyText`, serves both paths. `from_row` (optional): when the answer is absent / "None", the family
 * and map words found in the row's own text decide -- all on one family prices as it (marked as assumed),
 * two different ones refuse with `refuse` ({types} = the names found).
 */
export interface FamilyTextSpec {
  map: Array<{ from: string; to: string; rule: string }>;
  refuse?: Array<{ from: string; refuse: string; rule: string }>;
  /** "BoQ says {from} -> priced as {to} (owner rule)" */
  line: string;
  from_row?: { rule: string; refuse: string };
  /**
   * SLICE 12e-4b (owner D-3, 2026-10-13): the TEXT item attribute that carries the family AS THE BoQ WRITES IT
   * ("Pipe type as written": GI, uPVC, SS ...). Read only when the family answer itself is absent and the row's
   * own words (`from_row`) named none, through the SAME reader a typed family goes through (`readFamilyWord`).
   * The key name is the one `unstocked_materials.from_attr` uses. ABSENT => nothing is read.
   */
  from_attr?: string;
}

export interface ConversionOption {
  to: string;
  needs: string[];
  rule: string;
  pipelines: Record<string, Pipeline>;
  /** ADP-1 (owner H4 / U4): every geometry step of this option (a `scale` reading a `_from_attr`) also writes its
   * arithmetic WITH THE NUMBERS into the working ("supply: 1230 x 2 x (450 x 450 + ...) / 10^6 + 150 = 1423.05").
   * ABSENT => the working is byte-identical. */
  show_numbers?: boolean;
  /** ADP-1 (owner H4: "a missing dimension REFUSES and names the missing one"): when no option can be chosen, this
   * option's part of the refusal names only the facts NOT stated. ABSENT => it names all of its needs, as before. */
  name_missing?: boolean;
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
  /** ADP-5a (owner 2026-10-20 12:51, AC2): the line a family of `by_family` says instead of `rule` -- the one family
   * whose value differs from the others' ("curved grille = with"). ABSENT => every family says `rule`, as before. */
  rule_by_family?: Record<string, string>;
  /** SLICE 6 (owner S6, UL ONLY by config): an ABSENT answer is read as NOT MENTIONED, so this default fires
   * on it too. Absent / false => an absent answer stays "could not tell" and refuses (R2). */
  absent_as_none?: boolean;
}

/**
 * ADP-5a (owner 2026-10-22 10:45 / 10:48 / 10:49; SCOPE-5a-1) -- TWO FAMILIES THAT ARE ONE ITEM.
 *
 * "the model correctly returned spigot and butterfly damper...so these cases should be matched with spigot with
 * butterfly damper"; "Spigot Smaper is spigot with butterfly damper"; "only the dia of the spigot matters". An item of
 * `family` prices as ONE item of `into` when the row also carries an item of a family in `absorbs` (that item is the
 * same thing and is dropped -- its own answers, its size included, are not read) or when the row's text, a heading or
 * a heading's note names one of `words` at a word start. `at` is the number both families read and the one kept (the
 * spigot's diameter, then the standard ladder). `line` is said on the item, with the size where `at` resolved one.
 * Applied by `applyFamilyMerge` BEFORE anything prices or shows, so the panel and the calculator see one item.
 */
export interface FamilyMerge {
  family: string;
  into: string;
  absorbs?: string[];
  words?: string[];
  at?: string;
  line: string;
  rule: string;
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
  /** ADP-5a (SCOPE-5a-1): items of one family that price as ONE item of another. ABSENT => every item prices as its
   * own family, exactly as before. See `FamilyMerge` / `applyFamilyMerge`. */
  family_merge?: FamilyMerge[];
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
  /** SLICE 12e-2b (owner D1 (a) / D3): each CHOICE definition's label and closed list, carried in from
   * `list_spec.attribute_definitions` (the `family_label` precedent) so the module can (i) tell a TWO-WAY
   * field -- one whose list for the family has exactly two values -- and (ii) name a fact by its label in
   * the unstocked-combination refusal. Not a config key: `itemListPricingSpec` derives it. */
  choice_defs?: Record<string, { label: string; values: string[]; values_by_family?: Record<string, string[]> }>;
  /** ADP-3a (U2 / U3): EVERY list_spec definition's label by id, carried in the same way (`choice_defs`
   * precedent), so a refusal names the BOX a person types in ("Size", "Area band") rather than a reader's internal
   * name -- the either-or group on the field and the sentence below it are worded by one helper. Not a config key. */
  field_labels?: Record<string, string>;
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
  /** SLICE 12e-5b (owner R2): a CHOICE the BoQ names in a word the catalogue does not stock ("26 G GI cladding"),
   * copied by the model into `from_attr` as written, priced as the stocked option the entry names -- read only
   * where the choice itself was not answered. ABSENT => nothing is mapped. See `choiceTextFor`. */
  choice_text?: ChoiceText[];
  /** SLICE 12e-5b (owner R5): a MATERIAL the model answered as a no-SKU family whose as-written text names a
   * material the catalogue prices as one of its families ("closed cell polyethylene" -> thermal nitrile).
   * ABSENT => the no-SKU refusal stands. See `materialTextFor`. */
  material_text?: MaterialText;
  /** SLICE 12d-4a (owner D9b): a value not offered on rows of a unit class refuses with the ruled sentence.
   * ABSENT => such a row refuses, where it does, with the generic "no SKU for this combination". */
  refuse_on_unit_class?: RefuseOnUnitClass[];
  /** SLICE 12d-4a (owner D8): a working line generated from a copied text. ABSENT => no line. */
  read_notes?: ReadNote[];
  /** SLICE 12e-2 (owner Q19 / C2): the sentence a unit outside the category's classes refuses with --
   * "unit '{unit}' is not a length unit". ABSENT => the R12 sentence, byte-identical for every other category. */
  unit_refusal?: string;
  /** SLICE 12e-2 (owner Q16 / Q15 / Q18): how a family answer written as the BoQ writes it is read (the map,
   * the refusals, the line, the row-text rule). ABSENT => a family answer is read exactly as before. */
  family_text?: FamilyTextSpec;
  /** SLICE 12e-2 (owner Q10): text item definitions the panel shows as an OPTIONAL typed box that no pricing
   * rule reads (a class / wall thickness); a `read_notes` line may quote it. ABSENT => no box. */
  panel_optional?: string[];
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
    /**
     * SLICE 12e-5b (owner R7, 2026-10-15: "the dia is 50+2*32=114 mm") -- THE CLADDING IS ONE WRAP OVER THE
     * OUTER SURFACE. On the OUTER layer of a composition ONLY, the pricer hands the pipelines (never the SKU
     * match) the outer diameter under `attr` -- the pipe size AS READ + 2 x the TOTAL thickness of all the layers
     * (the matched pipe size where none was read) -- and runs them with `girth_step` in place of the step that
     * produces the same `result`. The formula is the config's own. Every other item, and every catalogue-row path
     * (Derivation, impact panel, cladding cost), runs the config's pipelines unchanged. ABSENT => byte-identical.
     */
    outer_surface?: { attr: string; pipe: string; thickness: string; girth_step: PipelineStep };
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
  /** SLICE 12e-3a (owner D1): `list_spec.sections`, carried in by `itemListPricingSpec` (it sits beside
   * `pricing` in the config, as `family_attribute_id` does). ABSENT on every config that declares none. */
  sections?: ListSection[];
}

/**
 * SLICE 12e-3a (owner D1 / D1a / D3 / 13:40 / 13:42, 2026-10-11) -- ONE DECLARED SECTION OF A ROW.
 *
 * A row of a config declaring `list_spec.sections` is made of sections. The ONE entry without a
 * `category_id` is the config's own items (a Piping row's pipes); every other entry DELEGATES: the panel
 * helper prices it through the delegated category's OWN config, catalogue and Pricing Inputs -- the same
 * function and the same config object that category's calculator uses, no copy of any rule -- and it
 * behaves as that category does except for the two things declared here:
 *   `include_when`  a per-item Yes / No attribute of THIS config that opens the section under its item
 *                   (the key name Electrical's `popup_boxes.has_modules` gate uses); `absent` is the value
 *                   and the line shown when nothing was read;
 *   `mirror`        one number of the item (`from`, a `numbers` key here) pre-fills a number reader of the
 *                   delegated category (`to`) until the pricer edits it there.
 * The shape is validated by `config_validation._validate_list_sections`, the cross-category half by
 * `validate_delegated_sections` (import and editor save).
 */
export interface ListSection {
  id: string;
  label: string;
  add_label: string;
  category_id?: string;
  unit_class?: string;
  families?: string[];
  include_when?: { attr: string; equals: string };
  absent?: { value: string; line: string };
  mirror?: { from: string; to: string; tag: string; line: string };
}

/** SLICE 12e-3a: the delegated sections a spec declares (those naming a category), in order. PURE. */
export function delegatedSections(spec: ItemListPricingSpec): Array<ListSection & { category_id: string }> {
  return (spec.sections ?? []).filter((s): s is ListSection & { category_id: string } => typeof s.category_id === "string" && s.category_id !== "");
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
 * ADP-3a (B6 #1). PURE. The note for a SIZE box of which this row's rule reads only SOME parts -- a per-metre
 * grille prices on the height alone, so "1200x150" must say which number is used. Built from the readers that
 * share the box (`from[0]`) and their `component` positions; `undefined` when the row reads every part (the
 * config's own note then stands) or the box holds one number.
 */
export function partOfSizeNote(spec: ItemListPricingSpec, modelId: string, axes: readonly string[]): string | undefined {
  const all = Object.entries(spec.numbers ?? {}).filter(([, r]) => r.from[0] === modelId && !r.typed_only && typeof r.component === "number");
  if (all.length < 2 || !axes.length || axes.length >= all.length) return undefined;
  const ORD = ["", "first", "second", "third", "fourth"];
  const used = all.filter(([k]) => axes.includes(k));
  const sides = all.slice().sort((a, b) => Number(a[1].component) - Number(b[1].component)).map(([, r]) => r.name).filter((n) => n !== "depth");
  const names = used.map(([, r]) => r.name);
  const which = used.length === 1 ? ` - the ${ORD[Number(used[0][1].component)] ?? ""} number is the ${used[0][1].name}` : "";
  return `Only the ${names.join(" and ")} ${used.length === 1 ? "is" : "are"} read on this row: type the size in mm as ${sides.join(" x ")}${which}.`;
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
  const sections = (config as { list_spec?: { sections?: unknown } } | null | undefined)?.list_spec?.sections;
  // SLICE 12e-2b (owner D1 (a) / D3): the choice definitions' labels and lists ride in the same way
  const choiceDefs: NonNullable<ItemListPricingSpec["choice_defs"]> = {};
  // ADP-3a (U2 / U3): every definition's label, so a refusal can name the box
  const fieldLabels: Record<string, string> = {};
  for (const d of (Array.isArray(defs) ? defs : []) as Array<{ id?: unknown; label?: unknown }>) {
    if (d && typeof d.id === "string" && typeof d.label === "string" && d.label.trim()) fieldLabels[d.id] = d.label.trim();
  }
  for (const d of (Array.isArray(defs) ? defs : []) as Array<{ id?: unknown; label?: unknown; type?: unknown; values?: unknown; values_by_family?: unknown }>) {
    if (!d || typeof d.id !== "string" || d.type !== "choice") continue;
    choiceDefs[d.id] = {
      label: typeof d.label === "string" && d.label.trim() ? d.label.trim() : d.id,
      values: Array.isArray(d.values) ? (d.values as unknown[]).map(String) : [],
      ...(d.values_by_family && typeof d.values_by_family === "object" ? { values_by_family: d.values_by_family as Record<string, string[]> } : {}),
    };
  }
  return {
    ...(spec as ItemListPricingSpec),
    default_pipelines: pipelines,
    ...(typeof qtyAttr === "string" && qtyAttr ? { qty_attribute_id: qtyAttr } : {}),
    ...(typeof famAttr === "string" && famAttr ? { family_attribute_id: famAttr } : {}),
    ...(famLabel ? { family_label: famLabel } : {}),
    ...(Object.keys(choiceDefs).length ? { choice_defs: choiceDefs } : {}),
    ...(Object.keys(fieldLabels).length ? { field_labels: fieldLabels } : {}),
    // SLICE 12e-3a (owner D1): the declared sections ride in from `list_spec` the same way
    ...(Array.isArray(sections) && sections.length ? { sections: sections as ListSection[] } : {}),
  };
}

/**
 * SLICE 12e-2b (owner D1 (a), 2026-10-10): "two-way = any choice field whose list FOR THIS FAMILY has exactly
 * two values - worked out from the list, no config key, no category or attribute named in code". The two values
 * in the definition's order, or null when the field is not two-way for this family. PURE. It is the ONE test:
 * `itemFieldDefs` (the dropdown offers both and is not narrowed), the helper's option-matching and unshowable
 * checks, and the refusal sentence (two-way facts first) all read it.
 */
export function twoWayValues(spec: ItemListPricingSpec, attr: string, family: string | null | undefined): string[] | null {
  const d = spec.choice_defs?.[attr];
  if (!d) return null;
  const values = (family && d.values_by_family?.[family]) || d.values;
  return values.length === 2 ? [...values] : null;
}

/** SLICE 12e-2b (owner D3): one fact of an item as the plain-English sentence builder takes it -- a choice by
 * its definition's label, a number by its reader's name (the names the old bracket already used). PURE. */
export function plainFactOf(spec: ItemListPricingSpec, attr: string, value: string | number, family: string | null | undefined): PlainFact {
  return {
    label: spec.choice_defs?.[attr]?.label ?? spec.numbers[attr]?.name ?? attr,
    value,
    twoWay: twoWayValues(spec, attr, family) !== null,
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
    typed?: boolean;
    /** SLICE 12d-8 (owner R1, 2026-10-09): the SYSTEM cleared this value -- a pick the block's other answers
     * no longer stock (12c-S E2E-1). It is NOT "not mentioned": no default may fill it, the row refuses
     * until the pricer chooses again. Set by the panel helper only; the pure pricer never writes it. */
    cleared?: boolean;
    /** ADP-1: a section's size MIRRORED from the item above it -- the size that item READ, in mm (12e-3a D3b), entered
     * as a typed cell. It carries no unit of its own, and is not a bare number the BoQ wrote: F1 never reads it so. */
    mirrored?: boolean }>;
  /** SLICE 6 (T4, the owner's unit-rate ruling): how many of this item ONE row unit pays for. Absent => 1.
   * Blank / non-numeric / non-positive => the item refuses ("quantity per row unit is blank"). */
  qtyPerRowUnit?: number | string | null;
  /** SLICE 12e-4b (owner D-2): the DELEGATED SECTION this item belongs to (`list_spec.sections[].id`), as the
   * run stores it for an item the model answered from that section's own questions. ABSENT on every item of
   * the config's own kind, which is every stored item of every config without a delegated section. */
  section?: string;
  /** ADP-5a (SCOPE-5a-1): `applyFamilyMerge` priced this item as another family -- the family it was answered as, the
   * line to say and the number it is priced at. Set by that function only; absent on every other item. */
  merged?: { from: string; line: string; at?: string };
}

export interface DefaultedAttr {
  attr: string;
  value: string;
  rule: string;
  /** ADP-2 (owner H5): the stated fact a `derive_when_none` default was decided by ("air" = "supply"), so its line
   * names it: "supply air, damper not mentioned -> with damper". Absent on every ruled default. */
  when?: { attr: string; equals: string };
}

export interface LadderHop {
  attr: string;
  name: string;
  requested: number;
  fitted: number;
  exact: boolean;
  /**
   * SLICE 12e-2 (owner Q14 / Q14a / Q17 / Q11): HOW the stated value landed on `fitted`, set on an axis that
   * declares `inch_mm_alt` / `size_match.near` / `size_match.below_smallest` (12e-6c: no longer `typed_entry`) -- the field's line
   * names it ("the sheet's own spelling of this size", "the smallest size", "next size up"). ABSENT on every
   * other axis, so every existing hop is byte-identical.
   *   exact      the stated value is a rung
   *   precision  resolved by a rounding depth (15.875 -> 15.9)
   *   alt        the SECOND inch conversion resolved it (4 inch: 101.6 no, 100 yes)
   *   near       the nearest rung within `size_match.near` (31.75 -> 31.7)
   *   smallest   below the smallest rung -> the smallest (owner Q17)
   *   up         between two rungs -> the next size up (owner Q11)
   */
  how?: "exact" | "precision" | "alt" | "near" | "smallest" | "up";
  /** the text as entered, when the reader read it from an inch form (for the line "You typed 5/8\" -> 15.875 mm") */
  raw?: string;
  /** the second conversion's value, when one was carried (101.6 mm / 100 mm) */
  alt?: number;
  /** SLICE 12e-3b: the stated text was two or more sizes -- the sizes as the line names them and the one taken */
  several?: { sizes: string[]; chosen: string };
  /** SLICE 12e-4d (owner, 2026-10-14: "fix"; AC3): on an axis WITHOUT `how`, the stated value was below the
   * smallest stocked size and took it -- so the field's line says "(the smallest size)", as the working does.
   * Present ONLY then; an axis with `how` says so through `how: "smallest"`. */
  belowSmallest?: true;
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
    /** SLICE 12e-5b (owner R7): the pipe size AS READ (before any ladder), for the outer layer's one wrap of
     * cladding. Present only where the config declares `compose.outer_surface` and the size was read. */
    pipeAsRead?: number;
    /** SLICE 12e-6 (owner R7, 2026-10-16: "mm = NB and NB = mm"; was 12e-5b2 Q1 (b)'s NB flag): the size as read is
     * NOT an outside diameter -- a size in mm, an NB number, "mm dia" -- so the wrap stays on the matched size. */
    pipeMatched?: true;
  };
  /** The family the model returned (may be an alias or "none of these"). */
  familyRaw: string | null;
  /** The family that priced (after R3's alias). */
  family: string | null;
  /** SLICE 12d-1a (owner R2): the family came from `family_when_none` -- the row named no material
   * and the row kind decided. Present ONLY on such an item (the amber mechanism, like `defaulted`). */
  familyDefaulted?: { value: string; rule: string };
  /** SLICE 12e-2 (owner Q16 / Q15): the line said under the family when `family_text` read it as another
   * family ("BoQ says GI -> priced as MS ...") or read it off the row's own words. Present ONLY then. */
  familyLine?: string;
  /** SLICE 12e-6 (owner R2 / R3): the family the cheaper of two stocked alternatives settled on -- present ONLY then,
   * so a composition's layers price that family as answered. */
  alternativeChosen?: string;
  /** The SKU unit class the pipelines ran against (after any conversion). */
  skuUnitClass: string | null;
  state: "priced" | "blank";
  reason?: string;
  /** ADP-3a (U3): the SKU attributes a refusal found missing -- every one, not only the first -- so the panel
   * outlines each box that feeds one, keyed to the FIELD, never found by searching the sentence. */
  missing?: string[];
  /** ADP-3a (U4): the SKU attribute a value-refusal is about (an unstocked slot count; a size with no unit). */
  refusedFor?: string;
  /** SLICE 12e-4d (owner, 2026-10-14: "fix"; AC2): the NUMBER AXIS whose READING refused this item -- a stated
   * size that could not be read (several sizes, not one size, a reader's own refusal, a cleared pick) or a bare
   * number that could be inches ("size 1 has no unit"). A section that takes its size from this axis refuses
   * with the same sentence instead of pricing a number the item itself would not price. Present ONLY then. */
  sizeRefused?: string;
  /**
   * SLICE 12e-5 (owner, 2026-10-14: "the attribute values should be captured else the user will have to enter
   * everything from scratch"; AC1) -- THE DEFAULTS AN ITEM HAD READ WHEN IT REFUSED AT A NEED. A "None" answer is
   * read into its ruled default (cladding "None" -> "No") BEFORE the needs loop; a refusal there (a size never
   * stated, or one that could not be read) used to drop them, so the field showed the raw "None". They are HELD
   * here, never on `defaulted`, so no block shows them by itself: a delegated SECTION refusing on the size its
   * pipe gives it shows them, as its own category shows them on a priced row. Display only -- nothing here
   * reaches the matcher. `need` is the numbers axis the item refused at. Present ONLY on such a refusal with at
   * least one held default (a choice attribute's; a number's default is never held).
   */
  heldDefaults?: { need: string; defaulted: DefaultedAttr[] };
  /** SLICE 12e-5b (owner R2): choices priced from the BoQ's own words through `choice_text` -- the value priced and
   * the amber line the field shows ("BoQ says 26 G GI cladding -> priced as 26G Aluminium"). Present only then. */
  textMapped?: Array<{ attr: string; value: string; line: string }>;
  /** ADP-1 (owner H3): a `typed_only` number read from the size as written (`length_from`) -- the field shows the value
   * used and this line ("BoQ says 1000x150 -> 1 m (the longest side)"). Present only then. */
  lengthRead?: { attr: string; metres: number; line: string };
  /** ADP-2 (owner H7): typed-only numbers FILLED from the model's own reading (a plenum's sides from the size as
   * written, its area from the area band) -- the field shows the value used and this line. Present only then. */
  filledReads?: Record<string, { value: number; line: string }>;
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

/** SLICE 12e-2: `alt` is the SECOND inch conversion (x `inch_mm_alt`) carried beside the exact read, for the
 * ladder to try after the exact read lands on no stocked size; `raw` is the text as entered. Both are set ONLY
 * on a reader declaring `inch_mm_alt`, so every other reader's result is byte-identical. */
export type NumberRead = { value: number; note?: string; alt?: number; raw?: string } | { blank: string } | null;

/**
 * SLICE 12e-2 (owner P2): what a `typed_entry: "one_size"` axis accepts from a PRICER -- exactly ONE size:
 *   a number in mm, whole or decimal, optionally followed by "mm", "NB" or "dia" ("50", "15.9", "50 NB");
 *   an inch form: a fraction (5/8"), a mixed number with a space or a hyphen (1 1/4", 1-1/4"), a unicode vulgar
 *   fraction (1¼"), a whole or decimal number of inches (2", 1.5 inch, 2 in, 4 inch) -- the fraction's
 *   denominator must be a power of two up to 32 and its numerator smaller, so "40/50" is a LIST, not an inch.
 * Everything else -- "40/50", "two inch", "40-50", "as per spec" -- refuses with `ONE_SIZE_MESSAGE`.
 */
export const ONE_SIZE_MESSAGE = "Type one pipe size, in mm or inches";
const INCH_UNIT = String.raw`(?:"|”|''|\s*(?:in|inch|inches))`;
const ONE_SIZE_FORMS: RegExp[] = [
  /^\s*\d+(?:\.\d+)?\s*(?:mm|nb|dia|od|mm\s*dia|mm\s*od)?\s*$/i,
  new RegExp(String.raw`^\s*(?:(\d+)[\s-]+)?(\d+)\s*/\s*(\d+)\s*${INCH_UNIT}?\s*$`, "i"),
  new RegExp(String.raw`^\s*\d+(?:\.\d+)?\s*${INCH_UNIT}\s*$`, "i"),
];
/**
 * SLICE 12e-4b (owner F-2, 2026-10-13: "fix") -- A TRAILING FULL STOP NEVER STOPS A SIZE FROM READING. A BoQ ends
 * a size with punctuation as often as not ("19/25 mm.", "32/40mm.", "25 mm,"), and the three tests that decide
 * whether a text IS one size, a list of sizes or a single thickness all anchor on the END of the text -- so the
 * mark alone turned a size the ruling prices into "pick one". The mark is dropped before those tests look; the
 * text a pricer or the BoQ wrote is still what every line quotes. Only a full stop, comma, semicolon or colon
 * at the very end: an inch mark, a bracket and anything inside the text are untouched.
 */
export function withoutTrailingPunctuation(text: string): string {
  return text.replace(/[\s.,;:]+$/, "");
}

/** SLICE 12e-4b (owner F-3): a number written with nothing else -- no unit, no inch mark, no second number. */
export const BARE_NUMBER_RE = /^\s*\d+(?:\.\d+)?\s*$/;
/** SLICE 12e-4b (owner F-3): the ONE sentence a bare number that could be an inch size refuses with. */
export function noUnitMessage(size: string): string {
  return `size ${size} has no unit - price this row by hand`;
}
/** SLICE 12e-6c (owner U2): F-3's "x 25" where the axis declares no second conversion of its own (12e-4b's ruling). */
export const F3_INCH_ALT = 25;
/**
 * SLICE 12e-6c (owner U2, 2026-10-18). PURE. The second inch factor F-3 tests on this axis, or null where F-3 does not
 * apply. F-3 is the rule of EVERY axis that reads inches (`inches: true`): Piping's `size_mm` (at its own `inch_mm_alt`)
 * and Insulation's `pipe_size_mm` (at 25). Nothing else changes on the axis -- the ladder never converts at this factor.
 */
export function f3InchAlt(spec: ItemListPricingSpec, attr: string): number | null {
  const rd = spec.numbers[attr];
  if (!rd || rd.inches !== true) return null;
  return typeof rd.inch_mm_alt === "number" && rd.inch_mm_alt > 0 ? rd.inch_mm_alt : F3_INCH_ALT;
}

export function isOneSizeEntry(text: string | number | null | undefined): boolean {
  if (text === null || text === undefined) return false;
  const s = withoutTrailingPunctuation(unicodeFractions(String(text)).trim());
  if (s === "") return false;
  if (ONE_SIZE_FORMS[0].test(s) || ONE_SIZE_FORMS[2].test(s)) return true;
  const m = s.match(ONE_SIZE_FORMS[1]);
  if (!m) return false;
  return isInchFraction(Number(m[2]), Number(m[3]));
}

/**
 * SLICE 12e-2b (12e-2 cert finding 7; AC6): ON A `typed_entry: "one_size"` AXIS A SLASH IS AN INCH FRACTION
 * ONLY WHEN IT CAN BE ONE -- the denominator is 2, 4, 8, 16, 32 or 64 and the numerator is smaller than it,
 * with or without a leading whole number (7/8, 1-1/4, 1 1/4). Anything else written with a slash ("40/50",
 * "50/65") states SEVERAL SIZES and refuses, on the model path and the typed path alike -- a model-read
 * "40/50" used to read as 0.8 of an inch and price a 25 mm pipe. Returns the sizes as written, or null when
 * the text carries no slash or IS an inch fraction. PURE. Only a reader declaring the key reaches it, so
 * every other axis (Insulation's pipe size, which shares `readNumber`) is byte-identical.
 */
export const INCH_DENOMINATORS: readonly number[] = [2, 4, 8, 16, 32, 64];
/**
 * SLICE 12e-3b (owner 2026-10-11, "yes for both"): WHAT A SLASH PAIR MUST BE TO READ AS AN INCH FRACTION --
 * the top number is 16 or less AND the bottom is 2, 4, 8, 16, 32 or 64. Any other slash pair is two sizes
 * ("25/32": the top is above 16; "15/20": 20 is no inch denominator). REPLACES the 12e-2b test (top smaller
 * than bottom), under which "25/32" read as 25/32 of an inch.
 */
export const INCH_NUMERATOR_MAX = 16;
export function isInchFraction(num: number, den: number): boolean {
  return INCH_DENOMINATORS.includes(den) && num > 0 && num <= INCH_NUMERATOR_MAX;
}
const INCH_MARK_END = /(?:"|”|''|\b(?:in|inch|inches))\s*$/i;
export function slashSizes(text: string | number | null | undefined): string[] | null {
  if (text === null || text === undefined) return null;
  const s = unicodeFractions(String(text)).trim();
  if (!s.includes("/")) return null;
  const texts = s.split("/");
  const parts = texts.map((p) => (p.match(/\d+(?:\.\d+)?/g) ?? []));
  if (parts.length === 2 && parts[1].length >= 1 && parts[0].length >= 1) {
    const num = Number(parts[0][parts[0].length - 1]), den = Number(parts[1][0]);
    const wholeOk = parts[0].length <= 2 && parts[1].length === 1;
    // owner Q11: `1"/2"` is two inch sizes -- a top number carrying its own inch mark is a size, not a numerator
    if (wholeOk && !INCH_MARK_END.test(texts[0]) && isInchFraction(num, den)) return null;
  }
  const sizes = parts.flat();
  return sizes.length >= 2 ? sizes : null;
}
/**
 * SLICE 12e-5b (owner R6, 2026-10-15: "we need to fix") -- AN INCH SIZE WITH ITS MM IN BRACKETS IS ONE SIZE.
 * `1/2" (12.7mm)`, `1 1/8" (28.6mm)`, `1/4 " dia (6.4 MM)`: the bracket repeats the inch value in mm. Before,
 * the slash check counted every number in the text -- 1, 2 and 12.7 -- and refused "several sizes", while the
 * size box (whose reader drops brackets) showed 12.7. Now, where the head is an inch value and the bracketed mm
 * equals its conversion within `INCH_MM_ECHO_MM`, the bracket is dropped and the inch value is read exactly as
 * before; where they disagree by more, the size is refused with `sizeWrittenTwoWaysMessage`. Anything else --
 * no bracket, a bracket that is not "<n> mm", a head that is not an inch value -- returns null and nothing
 * changes. PURE.
 */
export const INCH_MM_ECHO_MM = 0.5;
export function sizeWrittenTwoWaysMessage(asInches: string, asMm: string): string {
  return `the size is written two different ways (${asInches} and ${asMm}) - price this row by hand`;
}
const INCH_HEAD = /("|”|″|''|\binch(?:es)?\b)|(?<![\d.])\d{1,2}\s*\/\s*(?:2|4|8|16|32|64)(?![\d.])/i;
export function inchWithMmEcho(text: string | number | null | undefined): { head: string } | { conflict: string } | null {
  if (text === null || text === undefined || typeof text === "number") return null;
  const m = String(text).match(/^(.*?)\(\s*(\d+(?:\.\d+)?)\s*mm\s*\)(.*)$/i);
  if (!m) return null;
  const head = `${m[1]} ${m[3]}`.replace(/\s+/g, " ").trim();
  if (head === "" || !INCH_HEAD.test(unicodeFractions(head))) return null;
  const read = readNumber(head, { from: [], name: "size", unit: "mm", inches: true });
  if (!read || !("value" in read)) return null;
  if (Math.abs(read.value - Number(m[2])) <= INCH_MM_ECHO_MM) return { head };
  return { conflict: sizeWrittenTwoWaysMessage(head, `${m[2]} mm`) };
}
export function severalSizesMessage(name: string, sizes: readonly string[]): string {
  return `${name} states ${sizes.length === 2 ? "two" : "several"} sizes (${sizes.join(" / ")}) - pick one`;
}

/**
 * SLICE 12e-3b (owner 2026-10-11: "its two sizes in such case if the model can determine the specific size for
 * the row use it else use the higher size. like what we did for insulation"; "Highest of any list") -- A SIZE
 * WRITTEN AS TWO OR MORE SIZES PRICES THE HIGHER / HIGHEST. REPLACES 12e-2b's "40/50 refuses".
 *
 * Each part of the slash list must be ONE size on its own -- a number in mm (a trailing mm / NB / dia / OD
 * accepted) or a whole or decimal number of inches. A unit written once at the end ("25/32 mm", `1/2/3"`
 * never reaches here) is the unit of every bare part before it. The parts are compared as the reader reads
 * them, so an inch size and an mm size compare in mm. `sizes` and `chosen` are the sizes as the line names
 * them; `token` is the chosen size as the reader is handed it.
 *
 * NOT RULED, SO NOT GUESSED (returns null and the caller keeps the "- pick one" refusal): a part that is not
 * one size ("25 x 3 / 32 x 3"), and a list of three or more parts in which two neighbours could be an inch
 * fraction (`3/4" / 1"` -- three quarters and one inch, or 3, 4 and 1 inch).
 */
const SIZE_PART = new RegExp(String.raw`^\s*(\d+(?:\.\d+)?)(?:\s*(mm\s*dia|mm\s*od|mm|nb|dia|od)|(${INCH_UNIT}))?\s*$`, "i");
export interface SeveralSizesPick {
  sizes: string[]; chosen: string; token: string;
  /** SLICE 12e-4b (owner F-3, ruled in the run): the size taken was written with NO unit -- no unit on it and
   * none written once at the end of the list -- so it is a bare number as far as the unit goes. */
  unitless: boolean;
}
export function severalSizesPick(text: string | number | null | undefined, reader: NumberReader): SeveralSizesPick | null {
  if (slashSizes(text) === null) return null;
  // SLICE 12e-4b (owner F-2): "19/25 mm." is the pair 19 / 25 mm -- the full stop is not part of the last size
  const texts = withoutTrailingPunctuation(unicodeFractions(String(text)).trim()).split("/");
  const parts: Array<{ n: string; unit: "mm" | "inch" | null }> = [];
  for (const t of texts) {
    const m = t.match(SIZE_PART);
    if (!m) return null;
    parts.push({ n: m[1], unit: m[3] !== undefined ? "inch" : (m[2] !== undefined ? "mm" : null) });
  }
  if (parts.length >= 3) {
    for (let i = 0; i < parts.length - 1; i++) {
      const a = parts[i], b = parts[i + 1];
      if (a.unit === null && b.unit === "inch" && /^\d+$/.test(a.n) && /^\d+$/.test(b.n) && isInchFraction(Number(a.n), Number(b.n))) return null;
    }
  }
  const last = parts[parts.length - 1];
  if (last.unit !== null && parts.slice(0, -1).every((p) => p.unit === null)) for (const p of parts) p.unit = last.unit;
  const shown = (p: { n: string; unit: "mm" | "inch" | null }) => (p.unit === "inch" ? `${p.n}"` : p.n);
  let best: { i: number; value: number } | null = null;
  for (let i = 0; i < parts.length; i++) {
    const r = readNumber(shown(parts[i]), reader);
    if (!r || !("value" in r)) return null;
    if (best === null || r.value > best.value) best = { i, value: r.value };
  }
  if (best === null) return null;
  return { sizes: parts.map(shown), chosen: shown(parts[best.i]), token: shown(parts[best.i]), unitless: parts[best.i].unit === null };
}
/** The line a taken size carries: "pipe size states two sizes (25 / 32) - the higher, 32, is taken". */
export function severalSizesTaken(sizes: readonly string[], chosen: string): string {
  return sizes.length === 2
    ? `states two sizes (${sizes.join(" / ")}) - the higher, ${chosen}, is taken`
    : `states several sizes (${sizes.join(" / ")}) - the highest, ${chosen}, is taken`;
}

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
  const tail = part.replace(/[\d.]+/g, " ").replace(/\b(?:mm|cm|m|mtr|mtrs|metre|meter|nos?|no)\b/gi, " ");
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
/**
 * SLICE 12d-6 (owner U4): what the thickness "Other..." box accepts from a PRICER -- a single number, whole or
 * decimal, with an optional trailing "mm" -- and the ONE message everything else refuses with. Exported so the
 * tests and the panel pin the same two values.
 */
export const TYPED_THICKNESS_RE = /^\s*\d+(?:\.\d+)?\s*(?:mm)?\s*$/i;
export const TYPED_THICKNESS_MESSAGE = "Type the thickness as a single number in mm";

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

/**
 * ADP-5a (owner 2026-10-22 10:45 / 10:48 / 10:49; SCOPE-5a-1). PURE. The row's items with each `family_merge` rule
 * applied: an item of the rule's `family` takes the family `into` (marked `merged`, its own answers kept -- the spigot's
 * diameter is the one priced) where the row also carries an item of a family in `absorbs` (each such item is DROPPED:
 * it is the same thing) or where `text` -- the row's description, its own notes, its headings and their notes -- names
 * one of `words` at a word start. `kept` is the index, in `items`, of every item returned. Null when no rule fires,
 * so a row without one is the very same list. No family or word is named here: both are the config's.
 */
export function applyFamilyMerge(
  spec: ItemListPricingSpec,
  items: readonly ExtractedListItem[],
  text: string,
): { items: ExtractedListItem[]; kept: number[] } | null {
  const rules = spec.family_merge ?? [];
  if (!rules.length || !items.length) return null;
  const fa = familyAttr(spec);
  const famOf = (it: ExtractedListItem): string | null => {
    const v = rawValue(it, fa);
    if (v === null || v === "None") return null;
    return spec.family_alias?.[String(v)] ?? String(v);
  };
  const fams = items.map(famOf);
  const flat = text.replace(/\s+/g, " ");
  const convert = new Map<number, FamilyMerge>();
  const absorb = new Set<number>();
  for (const r of rules) {
    const own = fams.flatMap((f, i) => (f === r.family && !convert.has(i) && !absorb.has(i) ? [i] : []));
    if (!own.length) continue;
    const others = fams.flatMap((f, i) => (f !== null && (r.absorbs ?? []).includes(f) && !convert.has(i) && !absorb.has(i) ? [i] : []));
    if (!others.length && wordStartHit(flat, r.words) === null) continue;
    for (const i of own) convert.set(i, r);
    for (const i of others) absorb.add(i);
  }
  if (!convert.size) return null;
  const kept = items.map((_, i) => i).filter((i) => !absorb.has(i));
  return {
    kept,
    items: kept.map((i) => {
      const r = convert.get(i);
      const it = items[i];
      if (!r) return it;
      return { ...it, attributes: { ...it.attributes, [fa]: { ...(it.attributes?.[fa] ?? {}), value: r.into } },
               merged: { from: r.family, line: r.line, ...(r.at !== undefined ? { at: r.at } : {}) } };
    }),
  };
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

/**
 * ADP-2 (owner H7 / Q2, 2026-10-20: "Ok") -- THE SIDES OF A BOX, AS WRITTEN. PURE.
 *
 * A plenum / mixing box's size is a box, and the stored BoQs write it LENGTH x WIDTH x HEIGHT with the height last
 * ("550 x 550 x 400 mm Ht", "525 x 525 x 450 mm High", "900x200x350mm Ht."). The owner's order: L x W x H, and a
 * written label wins -- L / long / length -> length; W / wide / width / B / breadth -> width; H / Ht / high / height /
 * D / deep / depth -> height. Unlabelled parts take the free sides in order. This is NOT `splitSizePhrase`, whose
 * axes are a FACE's (width, height, then depth) and which reads "Length" as the depth.
 *
 * Returns each side's part AS WRITTEN with how it landed there, or null when the text is not one to three x-joined
 * readable parts, or two parts name the same side. The caller reads the part with the reader's own rules.
 */
const _BOX_SIDE_PATTERNS: Array<{ re: RegExp; side: "length" | "width" | "height" }> = [
  { re: /(^|[^a-z])(?:l|long|length)([^a-z]|$)/i, side: "length" },
  { re: /(^|[^a-z])(?:w|wide|width|b|breadth)([^a-z]|$)/i, side: "width" },
  { re: /(^|[^a-z])(?:h|ht|hgt|high|height|d|deep|depth)([^a-z]|$)/i, side: "height" },
];
export const BOX_SIDE_ORDER = ["length", "width", "height"] as const;
export type BoxSide = (typeof BOX_SIDE_ORDER)[number];
export function readBoxSides(
  text: string | number | null | undefined,
): Partial<Record<BoxSide, { part: string; how: "as written" | "by position" }>> | null {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  if (raw === "" || raw === "None") return null;
  const parts = raw.split(/\s*[x×*]\s*/i).map((p) => p.trim()).filter((p) => p !== "");
  /**
   * ADP-5a (owner 2026-10-22 10:49, item 6: "1200x150-300 depth" / "600x600-300 depth" is read as three box sides): a
   * two-part size whose second part is "B-C" followed by a height label is A x B x C -- the C keeps the label, so it is
   * the height as written. Any other two-part size reads as before.
   */
  if (parts.length === 2) {
    const m = parts[1].match(/^(\d+(?:\.\d+)?)\s*(?:mm)?\s*-\s*(\d+(?:\.\d+)?\s*(?:mm)?\s*(?:h|ht|hgt|high|height|d|deep|depth)\.?)$/i);
    if (m) parts.splice(1, 1, m[1], m[2]);
  }
  if (parts.length < 1 || parts.length > 3) return null;
  for (const p of parts) if (!partIsReadable(p)) return null;
  const sideOf = (p: string): BoxSide | null => {
    const tail = p.replace(/[\d.]+/g, " ").replace(/\b(?:mm|cm|m|mtr|mtrs|metre|meter|nos?|no)\b/gi, " ");
    const hit = _BOX_SIDE_PATTERNS.filter((a) => a.re.test(tail));
    return hit.length === 1 ? hit[0].side : null;
  };
  const out: Partial<Record<BoxSide, { part: string; how: "as written" | "by position" }>> = {};
  const unlabelled: string[] = [];
  for (const p of parts) {
    const s = sideOf(p);
    if (s === null) { unlabelled.push(p); continue; }
    if (out[s]) return null;   // two parts name the same side: not one box
    out[s] = { part: p, how: "as written" };
  }
  for (const p of unlabelled) {
    const free = BOX_SIDE_ORDER.find((s) => !out[s]);
    if (!free) return null;
    out[free] = { part: p, how: "by position" };
  }
  return out;
}

/**
 * ADP-3b (owner B1; D1, 2026-10-20 22:25 "ok to all") -- THE TWO SIDES OF A FACE, AS WRITTEN. PURE.
 *
 * A grille's, damper's or diffuser's size is a FACE, width x height. The FIRST TWO parts are the face; a written label
 * decides only between those two (W / wide / width -> width; H / Ht / hgt / high / height -> height), unlabelled parts
 * take the free sides in order, and a THIRD part never displaces them ("300 x 300 x 450 mm Height": the face is
 * 300 x 300, the 450 is the plenum box behind it). A part labelled as a length or a depth ("600(L)") is NAMED and not
 * used. Each part not used is returned in `notUsed`, worded for the panel.
 *
 * Returns null when the text is not one to three x-joined readable parts, or two parts name the same side -- the
 * caller then reads the WHOLE text as the width, exactly as the width axis did before (a list keeps its named refusal).
 *
 * ADP-3c (owner 2026-10-21 01:31 / 01:55 "ok to both") -- `pair`: on an item that reads BOTH sides, a size of EXACTLY
 * TWO parts is the face whatever its parts are called. A width or height label decides that side and the other part
 * takes the other side ("600(L)X150mm width" -> width 150, height 600); with no width / height label, or both parts
 * naming the same side ("600 W x 300 W"), the first is the width and the second the height. One part, three parts
 * (D1), and the height-only grille (D2, not a pair) read exactly as above.
 */
const _FACE_LABELS: Array<{ re: RegExp; side: "width" | "height" | "length" | "depth" }> = [
  { re: /(^|[^a-z])(?:w|wide|width)([^a-z]|$)/i, side: "width" },
  { re: /(^|[^a-z])(?:h|ht|hgt|high|height)([^a-z]|$)/i, side: "height" },
  { re: /(^|[^a-z])(?:l|long|length)([^a-z]|$)/i, side: "length" },
  { re: /(^|[^a-z])(?:d|deep|depth)([^a-z]|$)/i, side: "depth" },
];
export type FaceSide = "width" | "height";
export interface FaceSides {
  width?: { part: string; how: "as written" | "by position"; line?: string };
  height?: { part: string; how: "as written" | "by position"; line?: string };
  /** the parts the face does not use, as the panel says them ("600(L) named as a length - not used") */
  notUsed: string[];
  /** how many parts the text has */
  parts: number;
}
export function readFaceSides(text: string | number | null | undefined, opts: { pair?: boolean } = {}): FaceSides | null {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  if (raw === "" || raw === "None") return null;
  const parts = raw.split(/\s*[x×*]\s*/i).map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length < 1 || parts.length > 3) return null;
  for (const p of parts) if (!partIsReadable(p)) return null;
  const labelOf = (p: string) => {
    const tail = p.replace(/[\d.]+/g, " ").replace(/\b(?:mm|cm|m|mtr|mtrs|metre|meter|nos?|no)\b/gi, " ");
    const hit = _FACE_LABELS.filter((a) => a.re.test(tail));
    return hit.length === 1 ? hit[0].side : null;
  };
  // ADP-3c: a two-part size on a W + H item -- the face whatever its parts are called
  if (opts.pair && parts.length === 2) {
    const [a, b] = parts;
    const la = labelOf(a), lb = labelOf(b);
    const face = (l: string | null): FaceSide | null => (l === "width" || l === "height" ? l : null);
    const fa = face(la), fb = face(lb);
    const flip = (s: FaceSide): FaceSide => (s === "width" ? "height" : "width");
    // a width / height label decides its side (the other part takes the other); else by position
    const [sa, sb]: [FaceSide, FaceSide] = fa && fa !== fb ? [fa, flip(fa)] : fb && fb !== fa ? [flip(fb), fb] : ["width", "height"];
    const decided = (fa && fa !== fb) || (fb && fb !== fa);
    // a part whose own label is not the side it takes (a length, a depth, a repeated side) says how it landed; a part
    // read exactly as today says nothing new
    const entry = (p: string, l: string | null, s: FaceSide, nth: string) => ({
      part: p, how: l === s ? "as written" as const : "by position" as const,
      ...(l !== null && l !== s ? { line: decided ? "the other part of a two-part size" : `the ${nth} part of a two-part size` } : {}),
    });
    return { [sa]: entry(a, la, sa, "first"), [sb]: entry(b, lb, sb, "second"), notUsed: [], parts: 2 };
  }
  const out: FaceSides = { notUsed: [], parts: parts.length };
  const free: string[] = [];
  for (const p of parts.slice(0, 2)) {
    const side = labelOf(p);
    if (side === "width" || side === "height") {
      if (out[side]) return null;   // two parts name the same side: not one face
      out[side] = { part: p, how: "as written" };
    } else if (side === "length" || side === "depth") {
      out.notUsed.push(`${p} named as a ${side} - not used`);
    } else {
      free.push(p);
    }
  }
  for (const p of free) {
    const side: FaceSide | undefined = !out.width ? "width" : !out.height ? "height" : undefined;
    if (!side) return null;
    out[side] = { part: p, how: "by position" };
  }
  for (const p of parts.slice(2)) out.notUsed.push(`${p} (the third part) - not used as the face`);
  return out;
}

/**
 * ADP-2 (owner H5 fix (a), 2026-10-20) -- THE AIR STREAMS A TEXT NAMES. PURE. A stream word counts only where it is
 * used FOR the air -- "supply air", "return air", or a list of them ending in "air" ("Supply / Return air", "supply &
 * return air", "supply and return air") -- so the BoQ's everyday "Supply and installation of ..." names no stream.
 * Returns the streams named, lower-cased.
 *
 * ADP-5a (owner 2026-10-22 10:49, item 3: the both-streams rule "also reads 'cum' and 'SA / RA'"): "supply cum return
 * air" joins the list ("cum" beside "/", "&", ",", "and", "or"), and "SA / RA" -- the BoQ's abbreviation, in capitals --
 * names supply and return. Spellings as the stored rows write them; no other word is read.
 */
export function airStreamsNamed(text: string, streams: readonly string[]): Set<string> {
  const out = new Set<string>();
  if (!text || !streams.length) return out;
  const alt = streams.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`\\b((?:(?:${alt})\\s*(?:\\/|&|,|\\band\\b|\\bor\\b|\\bcum\\b)\\s*)*(?:${alt}))\\s+air\\b`, "gi");
  const word = new RegExp(`\\b(?:${alt})\\b`, "gi");
  for (const m of text.matchAll(re)) for (const w of m[1].match(word) ?? []) out.add(w.toLowerCase());
  if (streams.includes("supply") && streams.includes("return") && /(^|[^A-Za-z])SA\s*\/\s*RA(?![A-Za-z])/.test(text)) {
    out.add("supply");
    out.add("return");
  }
  return out;
}

/** Read one number from as-written text under a reader's rules. PURE.
 *   null              -> not stated (blank / null / the "None" sentinel)
 *   { value, note? }  -> the number, with a note when a range was resolved to its top or a unit was scaled
 *   { blank: reason } -> stated but unusable, with the owner-language reason (never a guess) */
/** SLICE 12d-8 (owner U8): the unicode vulgar fractions a BoQ may carry, as ASCII fractions. A whole number
 * directly before one becomes a hyphenated mixed number (`1¼` -> `1-1/4`), the form the inch reader accepts. */
const VULGAR_FRACTIONS: Record<string, string> = {
  "¼": "1/4", "½": "1/2", "¾": "3/4",
  "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
  "⅓": "1/3", "⅔": "2/3",
};
export function unicodeFractions(text: string): string {
  return text
    .replace(/(\d)\s*([¼½¾⅛-⅞⅓⅔])/g, (_m, d: string, f: string) => `${d}-${VULGAR_FRACTIONS[f]}`)
    .replace(/[¼½¾⅛-⅞⅓⅔]/g, (f) => VULGAR_FRACTIONS[f]);
}

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
  // SLICE 12d-8 (owner U8): a UNICODE vulgar fraction reads as its ASCII fraction -- `1¼"` is `1-1/4"`,
  // `¾"` is `3/4"` -- so the existing inch reader (whole, mixed, hyphenated) lands it on its rung. A text
  // without such a character is byte-identical; the messages keep the BoQ's own `raw`.
  const s = unicodeFractions(raw).toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (s === "") return { blank: `no number in '${raw}' for ${reader.name}` };
  // SLICE 12e-4c (owner, 2026-10-13: "fix"; ruled in the run: "26G." refuses, like "26G"): a full stop kept
  // inside a token for the sake of a decimal ("0.8") is not part of a WORD -- "26g." is the gauge "26g" and
  // "g." is "g". Without this the mark alone hid the gauge and "26G." read as a 26 mm thickness.
  const tokens = s.split(/[^a-z0-9.]+/).map((tk) => tk.replace(/\.+$/, "")).filter(Boolean);
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
    // SLICE 12d-6 (owner, 2026-10-08): a mixed number is also written with a HYPHEN -- `1-1/4"` is one and a
    // quarter inch (31.75 mm), not 1" followed by noise. The whole and the fraction may be joined by spaces
    // or a hyphen; a range ("40-50 mm") carries no slash and never reaches this branch.
    const mixedForm = /^\s*\d+[\s-]+\d+\s*\/\s*\d+/.test(s);
    const frac = slashCount === 1 && (numberCount === 2 || (mixedForm && numberCount === 3)) ? s.match(/(\d+)\s*\/\s*(\d+)/) : null;
    if (statedInInches || (frac && Number(frac[2]) !== 0)) {
      const mixed = s.match(/(\d+)[\s-]+\d+\s*\/\s*\d+/);
      const part = frac ? Number(frac[1]) / Number(frac[2]) : Number((s.match(/[\d.]+/) ?? ["0"])[0]);
      const inches = (mixed ? Number(mixed[1]) : 0) + part;
      const value = inches * 25.4;
      if (!Number.isFinite(value) || value <= 0) return { blank: `no number in '${raw}' for ${reader.name}` };
      // SLICE 12e-2 (owner Q14): the second conversion rides beside the exact one, on this reader only
      if (typeof reader.inch_mm_alt === "number" && Number.isFinite(reader.inch_mm_alt) && reader.inch_mm_alt > 0) {
        return { value, alt: inches * reader.inch_mm_alt, raw };
      }
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
    // ADP-1 (owner H3): a reader in METRES (the piece length a pricer types) -- a bare number is metres; a number in
    // mm or cm is scaled to metres, with its line. No other reader declares "m", so every other reading is unchanged.
    if (reader.unit === "m") {
      if (/^\s*mm\b/.test(after)) return { value: f.n / 1000, note: `${f.n} mm read as ${f.n / 1000} m` };
      if (/^\s*cm\b/.test(after)) return { value: f.n / 100, note: `${f.n} cm read as ${f.n / 100} m` };
    }
    return { value: f.n };
  };
  const below = (v: { value: number; note?: string }): NumberRead =>
    typeof reader.reject_below === "number" && v.value < reader.reject_below
      ? { blank: `${reader.name} stated as '${raw}' -- below ${reader.reject_below} ${reader.unit ?? ""}, a sheet gauge, not a thickness`.replace(/\s+,/, ",") }
      : v;
  /**
   * SLICE 12e-5b2 (owner R4; Q4, 2026-10-15: "a thickness written as any list of values joined by 'or', '/' or
   * brackets takes the highest"). On a reader declaring `several: "highest"` (Insulation's thickness, also a Piping
   * section's): numbers outside brackets joined only by "/" or "or", plus every bracket holding ONE number (with
   * mm / thk at most) -- "6mm thk (9MM)", "6 or 9 mm", "13/19 or 25", "6 (9) (13)" -- take the highest. A bracket of
   * words ("(Class O)") is still a qualifier; a pure slash list keeps its own path below, byte-identical; a typed
   * thickness never reaches here as a list (12d-6: one number). ABSENT `several` => byte-identical.
   */
  if (reader.several === "highest") {
    const inBrackets = [...unicodeFractions(raw).toLowerCase().matchAll(/\(\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*(?:thk|thick|thickness)?\s*\)/g)]
      .map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
    const isOr = (g: string) => /^\s*(mm)?\s*or\s*$/.test(g);
    const between = found.slice(0, -1).map((f, i) => s.slice(f.end, found[i + 1].start));
    const joined = between.every((g) => isAltPair(g) || isOr(g));
    if (joined && (inBrackets.length > 0 || between.some(isOr))) {
      const all = [...found.map((f) => scale(f).value), ...inBrackets];
      if (new Set(all).size >= 2) {
        const hi = Math.max(...all);
        return below({ value: hi, note: all.length === 2
          ? `'${raw}' states two values -- the higher, ${hi}, is taken`
          : `'${raw}' states several values -- the highest, ${hi}, is taken` });
      }
    }
  }
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
    // SLICE 12e-6 (AC8, owner R10: a thickness range "-> the highest, like the or / slash / bracket rule"; U6): on a
    // reader declaring `several: "highest"` (the thickness readers) the range says so in that rule's words. The VALUE
    // was already the top one (R6); every other reader -- a pipe size included -- keeps its line byte-identical.
    if (reader.several === "highest") return below({ value: sc.value, note: `'${raw}' states a range - the higher, ${sc.value}, is taken` });
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
  return matchStatedToOptionDetailed(stated, options, reader)?.to ?? null;
}

/**
 * SLICE 12d-8 (owner R2, 2026-10-09): the SAME match, saying HOW it matched. A TEXT match is the same
 * answer spelled differently ("gi rectangular" -> "GI rectangular") and the pricer needs the option to
 * price at all. A NUMBER match ("13 / 19 / 25" -> 25, "20 cm" -> 200) is a value the pricer's own reader
 * already understands -- and that reader also says how it read it ("states several values -- the highest,
 * 25, is taken", "20 cm read as 200 mm", "range ... -> its top value"). 12d-7 (F-2) measured that rewriting
 * such a value BEFORE the pricer discarded that line and put "the sheet's own spelling of this value" in its
 * place. So the panel keeps the stated text for PRICING on a number match (same number, same figure) and
 * shows the option in the select; the `by` tells it which.
 */
export function matchStatedToOptionDetailed(
  stated: string,
  options: readonly string[],
  reader: NumberReader | undefined,
): { to: string; by: "text" | "number" } | null {
  if (options.length === 0) return null;
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const want = norm(stated);
  if (want === "") return null;
  for (const o of options) if (norm(o) === want) return { to: o, by: "text" };
  if (!reader) return null;
  const read = (text: string): number | null => {
    const r = readNumber(text, reader);
    return r && "value" in r && Number.isFinite(r.value) ? r.value : null;
  };
  const n = read(stated);
  if (n === null) return null;
  for (const o of options) if (read(o) === n) return { to: o, by: "number" };
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

/** ADP-3a (U2 / U3). PURE. The id of the BOX a need is typed in: a number reader's model attribute (several readers
 * may share one box -- width and height both read "Size"), else the need itself. */
export function boxOf(spec: ItemListPricingSpec, need: string): string {
  return spec.numbers[need]?.from[0] ?? need;
}

/**
 * ADP-4a (owner AC2 / D1-D5, 2026-10-21; scope ruled the same day: "Insulation and Piping PRICES, PANEL and CALCULATOR
 * text stay byte-identical") -- WHICH CATEGORY READS THE PLAIN ITEM WORDING. The category that prices its items through
 * the config's SHARED per-item pipelines (`config.pipelines`, carried here as `default_pipelines`): ADP today, and no
 * other category declares them. On it the working names the rate it builds, never a pipeline id, says the rounding
 * once in words, and the family's sentinel answers read as words. Every other category's text is untouched. PURE.
 */
export function plainItemListWording(spec: ItemListPricingSpec): boolean {
  return Object.keys(spec.default_pipelines ?? {}).length > 0;
}

/**
 * ADP-4a (owner AC2 / D4, 2026-10-21) -- THE WORKING IN WORDS, on the plain item wording. PURE, display only: the lines
 * arrive already through `plainPricerText` and leave with --
 *   - the rate each line builds named, never the pipeline that builds it ("item supply: supply: cost x ..." ->
 *     "supply: cost x ...");
 *   - the rounding said ONCE, in words, on the line it rounds: a "ROUNDUP(x, 0) = v" line folds into the line before it
 *     as "..., rounded up to the rupee" (": v" where it moved the figure);
 *   - a Pricing Input's kind tag dropped ("Mixing box supply adder (amount) = 150" -> "... = 150");
 *   - "sum components", "SQM row", "sheet formula:" and "10^6" in plain words.
 * Figures are never touched: every number on a line is the line's own. A line of any other shape is unchanged.
 */
/**
 * ADP-4b (owner AC6, 2026-10-21; the fields are Length / Width / Height, owner 2026-10-19 23:19): the box's surface
 * formula is written ONE way wherever a person reads it -- the config's rule says (L x B + B x H + L x H) and its
 * step (W x H + H x D + W x D); both are the same sum of the three face products. Wording only: the arithmetic is the
 * config's, untouched. PURE.
 */
export function plainBoxSurface(s: string): string {
  return s.replace(/\(L x B \+ B x H \+ L x H\)|\(W x H \+ H x D \+ W x D\)/g, "(L x W + W x H + L x H)");
}

export function plainWorking(lines: readonly string[]): string[] {
  const out: string[] = [];
  const roundedTo = (digits: number) => (digits === 0 ? "the rupee" : digits < 0 ? `the next ${10 ** -digits} rupees` : `${digits} decimal place${digits === 1 ? "" : "s"}`);
  for (const raw of lines) {
    let s = raw
      .replace(/^item (supply|install): /, "$1: ")
      .replace(/^([a-z]+): \1: /, "$1: ")
      .replace(/(pricing input: .+?) \((?:amount|factor|rate)\)(?= = )/, "$1")
      .replace(/\bsum components\b/, "the parts added together")
      .replace(/\bthe family's SQM row\b/, "the family's per-sq.m catalogue row")
      .replace(/\bSQM row\b/, "per-sq.m catalogue row")
      .replace(/^([a-z]+): sheet formula: /, "$1: ")
      .replace(/\/ 10\^6 sq\.m/g, "/ 1,000,000 (sq.mm to sq.m)")
      .replace(/10\^6/g, "1,000,000");
    s = plainBoxSurface(s);
    const ru = s.match(/^([a-z]+): ROUNDUP\([^,]*,\s*(-?\d+)\) = (.+)$/);
    if (ru) {
      const [, lead, digits, value] = ru;
      const at = out.map((l) => l.startsWith(`${lead}: `)).lastIndexOf(true);
      if (at >= 0 && / = [^=]+$/.test(out[at])) {
        const before = out[at].slice(out[at].lastIndexOf(" = ") + 3);
        out[at] = `${out[at]}, rounded up to ${roundedTo(Number(digits))}${before.trim() === value.trim() ? "" : `: ${value}`}`;
        continue;
      }
      s = `${lead}: rounded up to ${roundedTo(Number(digits))} = ${value}`;
    }
    out.push(s);
  }
  return out;
}

/** ADP-4a (owner AC2, display only): the model's two sentinel family answers as a pricer reads them. The VALUE is
 *  unchanged everywhere it is matched or stored; only a heading, a picker entry or a rule line shows these words. */
export const FAMILY_DISPLAY: Readonly<Record<string, string>> = {
  "none of these": "Not in the catalogue",
  "grille, type not stated": "Grille (type not stated)",
};
export function familyDisplayName(spec: ItemListPricingSpec, family: string): string {
  return plainItemListWording(spec) ? (FAMILY_DISPLAY[family] ?? family) : family;
}

/** ADP-3a (U2 / U3; B6 #7). PURE. A box's label as a person reads it, without the model's "(as written)" or a unit
 * in brackets ("Size (as written)" -> "Size", "Area (sq.m)" -> "Area"). `labelOf` lets a caller holding the rendered
 * field labels pass them in, so the field and the sentence can never word one box two ways. */
export function boxLabel(spec: ItemListPricingSpec, need: string, labelOf?: (box: string) => string | undefined): string {
  const box = boxOf(spec, need);
  const r = spec.numbers[need];
  const raw = labelOf?.(box) ?? spec.field_labels?.[box] ?? r?.label ?? spec.choice_defs?.[need]?.label ?? r?.name ?? reasonName(spec, need);
  return raw.replace(/\s*\([^)]*\)\s*$/, "");
}

const SIDE_LETTER: Record<string, string> = { width: "W", height: "H", depth: "D", length: "L" };
const HOW_MANY = ["", "", "both", "all three", "all four"];

/** ADP-3a (owner H2, U2). PURE. One WAY of pricing, named by the boxes it reads: one box feeding several sides is
 * "Size (W x H)"; several boxes are "all three of Length, Width, Height" (ADP-2's words, byte for byte); one box for
 * one fact is its own label. */
export function wayLabel(spec: ItemListPricingSpec, needs: readonly string[], labelOf?: (box: string) => string | undefined): string {
  const boxes = [...new Set(needs.map((n) => boxOf(spec, n)))];
  if (boxes.length === 1) {
    const label = boxLabel(spec, needs[0], labelOf);
    return needs.length > 1
      ? `${label} (${needs.map((n) => SIDE_LETTER[spec.numbers[n]?.name ?? ""] ?? reasonName(spec, n)).join(" x ")})`
      : label;
  }
  const labels = boxes.map((b) => boxLabel(spec, needs.find((n) => boxOf(spec, n) === b)!, labelOf));
  // ADP-3b (owner B1, U1): two boxes are one face -- "Width + Height" (three keep ADP-2's "all three of ...")
  if (labels.length === 2) return labels.join(" + ");
  return `${HOW_MANY[labels.length] ?? `all ${labels.length}`} of ${labels.join(", ")}`;
}

/** ADP-3a (owner H2, U2). PURE. Several ways, as one either-or label: "Size (W x H), or Area band". */
export function waysLabel(spec: ItemListPricingSpec, ways: ReadonlyArray<readonly string[]>, labelOf?: (box: string) => string | undefined): string {
  return [...new Set(ways.map((w) => wayLabel(spec, w, labelOf)))].join(", or ");
}

/** ADP-3a (owner 2026-10-20 13:35, U5). PURE. The units a family is stocked in -- its own unit blocks and the units
 * a conversion prices it in -- worded "per number" / "per number or per metre". Empty when it is stocked in none. */
export function stockedUnitsWords(spec: ItemListPricingSpec, family: string): string {
  const fam = spec.families[family];
  if (!fam) return "";
  // ADP-4b (owner AC5): a unit the family is not offered in is not a unit it is stocked in
  const hidden = new Set(fam.units_not_offered ?? []);
  const classes = Object.keys(spec.unit_classes).filter((c) => !hidden.has(c) && (!!fam.units[c] || (fam.convert?.[c] ?? []).length > 0));
  return classes.map((c) => `per ${unitWord(spec, c)}`).join(" or ");
}

function rawValue(item: ExtractedListItem, id: string): string | number | null {
  const cell = item.attributes?.[id];
  if (!cell) return null;
  const v = cell.value;
  return v === undefined || v === null || v === "" ? null : v;
}

/** The owner-language reason behind a pipeline that did not price. PURE. */
function reasonFromPipeline(spec: ItemListPricingSpec, family: string, sel: Record<string, string | number>, r: PipelineResult,
                            familyRows?: readonly RateMasterItem[]): string {
  const last = r.steps[r.steps.length - 1];
  const label = last?.label ?? "";
  const cond = last?.matchedCondition ?? "";
  if (last?.step === "match_master_row" && r.status === "no_match") {
    // ADP-3a (owner B6, 2026-10-20 13:32): the sentence lists ONLY the facts the family's SKUs VARY on -- a width
    // and height a per-sq.m SKU does not carry, or a value every SKU shares WITH the row, cannot be why none matched.
    // A value every SKU shares that the ROW contradicts ("without damper" where all are "with") IS the reason: kept.
    const varies = (k: string): boolean => {
      if (!familyRows || !familyRows.length) return true;
      const vals = new Set(familyRows.filter((it) => k in it.attributes).map((it) => String(it.attributes[k])));
      return vals.size > 1 || (vals.size === 1 && !vals.has(String(sel[k])));
    };
    const keys = Object.keys(sel).filter((k) => k !== familyAttr(spec) && k !== spec.unit_class_attr && varies(k));
    // SLICE 12e-2b (owner D3 / Decision 2): the colon form, through the ONE plain-English builder
    return noSkuSentence(family, keys.map((k) => plainFactOf(spec, k, sel[k], family)));
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
 * SLICE 12e-2 (owner Q16 / Q18, 2026-10-10). PURE. THE ONE READER of a family answer written as the BoQ writes
 * it, shared by the calculator's "Other..." pipe-type box today and the 12e-4 model path tomorrow. The spelling
 * is compared trimmed, whitespace-collapsed and case-insensitively against, in order:
 *   a stocked family           -> that family (no line);
 *   a `family_text.map` entry  -> its `to`, with the `line` ("BoQ says GI -> priced as MS ...");
 *   a `family_text.refuse` one -> its sentence (SS: "No SKU in the catalogue for SS pipe - price this row by hand");
 *   anything else              -> null: the caller refuses BY NAME with the R18 sentence (owner Q18).
 * A blank answer is null too. A config without `family_text` resolves only a stocked spelling, exactly as before.
 */
export function readFamilyText(
  spec: ItemListPricingSpec,
  text: string | number | null | undefined,
): { family: string; line?: string; rule?: string } | { refuse: string; rule: string } | null {
  if (text === null || text === undefined) return null;
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const want = norm(String(text));
  if (want === "" || want === "none") return null;
  for (const fam of Object.keys(spec.families)) if (norm(fam) === want) return { family: fam };
  const ft = spec.family_text;
  if (!ft) return null;
  for (const m of ft.map ?? []) {
    if (norm(m.from) === want) {
      return { family: m.to, line: ft.line.replace("{from}", m.from).replace("{to}", m.to), rule: m.rule };
    }
  }
  for (const r of ft.refuse ?? []) if (norm(r.from) === want) return { refuse: r.refuse, rule: r.rule };
  return null;
}

/**
 * SLICE 12e-2 (owner Q15, clarified 2026-10-09). PURE. The family a row with NO family answer prices as, read
 * off the ROW'S OWN TEXT through `family_text.from_row`: every stocked family name and every `map` spelling
 * found at a word start (the ONE word test) is resolved through the map; names that all land on ONE family
 * ("MS / GI") price as it, marked as assumed; two different ones refuse with the configured sentence naming
 * them; none found -> null (the ordinary "no <family> could be told" refusal stands). A config without
 * `from_row` reads nothing here.
 */
export function familyFromRowText(
  spec: ItemListPricingSpec,
  rowText: string,
): { family: string; rule: string; named: string[] } | { refuse: string; rule: string } | null {
  const fr = spec.family_text?.from_row;
  if (!fr || !rowText.trim()) return null;
  const words: Array<{ word: string; family: string }> = [];
  for (const fam of Object.keys(spec.families)) words.push({ word: fam, family: fam });
  for (const m of spec.family_text?.map ?? []) words.push({ word: m.from, family: m.to });
  const found: Array<{ word: string; family: string }> = [];
  for (const w of words) {
    if (wordStartHit(rowText, [w.word]) !== null && !found.some((f) => f.word === w.word)) found.push(w);
  }
  if (!found.length) return null;
  const families = [...new Set(found.map((f) => f.family))];
  if (families.length === 1) return { family: families[0], rule: fr.rule, named: found.map((f) => f.word) };
  return { refuse: fr.refuse.replace("{types}", found.map((f) => f.word).join(", ")), rule: fr.rule };
}

/**
 * SLICE 12e-4b (owner D-3, 2026-10-13; decisions 3 / 4) -- ONE READER FOR A FAMILY WORD, WHOEVER WROTE IT. The
 * word is what the pricer typed in the family's "Other..." box, or what the model copied into the attribute
 * `family_text.from_attr` names ("Pipe type as written"). Both go through this, so the two paths cannot differ.
 * In order:
 *   1. the exact spelling of a stocked family, a mapped one or a refused one -- `readFamilyText`, unchanged
 *      ("uPVC" -> PVC with its line; "SS" -> its sentence);
 *   2. a word holding SEVERAL names, through the row-text rule (`familyFromRowText`, where the config declares
 *      `from_row`): names that all land on one family price as it ("MS / GI" -> MS, "BoQ names MS / GI ->
 *      priced as MS"); two different ones refuse naming them ("uPVC/ CPVC");
 *   3. a refused word inside a longer text ("SS 304", "stainless steel pipe") -> that word's own sentence;
 *   4. anything else -> null: the caller refuses BY NAME (the R18 sentence).
 * A config without `family_text` never reaches it. PURE.
 */
/** SLICE 12e-4c (owner, 2026-10-13): the family line of a word the PRICER typed -- the config's line ("BoQ says
 * uPVC -> priced as PVC ...") and the several-names line ("BoQ names MS / GI -> ...") open "You typed". PURE. */
export function typedFamilyLine(line: string): string {
  // SLICE 12e-6: "BoQ allows" (R2) reads "You typed" too where the pricer typed the two types
  return line.replace(/^BoQ (?:says|names|allows) /, "You typed ");
}

export function readFamilyWord(
  spec: ItemListPricingSpec,
  text: string | number | null | undefined,
): { family: string; line?: string; rule?: string } | { refuse: string; rule: string } | null {
  const exact = readFamilyText(spec, text);
  if (exact !== null) return exact;
  if (text === null || text === undefined) return null;
  const word = String(text).trim();
  if (word === "" || word.toLowerCase() === "none") return null;
  const several = familyFromRowText(spec, word);
  if (several && "refuse" in several) return several;
  if (several) return { family: several.family, line: `BoQ names ${several.named.join(" / ")} -> priced as ${several.family}`, rule: several.rule };
  for (const r of spec.family_text?.refuse ?? []) {
    if (wordStartHit(word, [r.from]) !== null) return { refuse: r.refuse, rule: r.rule };
  }
  return null;
}

/**
 * SLICE 12d-4a (owner D7 + D11). PURE. The NAMED-MATERIAL refusal for one item, or null: the family is a
 * `no_sku_families` value (T5, 12d-1b), or an `unstocked_materials` word sits in the row's own text or in the
 * text the model copied as the material (D7) -- whatever family the model picked. ONE definition, read by
 * `priceOneItem` and by `priceItemList`'s no-unit branch (D11: on a row with no unit this message shows
 * FIRST, because "no unit" is not the useful fact about a row the catalogue cannot price at all).
 */
/** SLICE 12e-5b: config shapes for `choice_text` (R2) and `material_text` (R5). */
export interface ChoiceText {
  /** The choice attribute the entry fills ("cladding"). */
  attr: string;
  /** The text attribute the model copies the BoQ's own words into ("cladding_as_written"). */
  from_attr: string;
  /** Whole words, any one of which makes the entry apply ("gi", "galvanised"). */
  words: string[];
  /** A pattern whose first group is the gauge as written ("26" from "26 G"); absent or no match -> `default_to`. */
  gauge_pattern?: string;
  /** Gauge as written -> the stocked option. A gauge the table does not list maps to nothing (the row refuses). */
  to_by_gauge?: Record<string, string>;
  /** The stocked option where no gauge is written. */
  default_to: string;
  /** The amber line: "{from}" = the words as written, "{to}" = the option priced. */
  line: string;
  /** The refusal where a gauge IS written but the table does not list it ("{from}" = the words as written) --
   * never the choice's default, which would price the row without the cladding the BoQ asked for. */
  unlisted_line: string;
  rule: string;
}
export interface MaterialText {
  /** The text attribute holding the material as written ("material_as_written"). */
  from_attr: string;
  /** The family answers the map may replace ("none of these"). */
  when_family: string[];
  map: Array<{
    /** Every group must have at least one whole-word hit in the as-written text. */
    all_of: string[][];
    /** The family priced, by the row's unit class. */
    to_by_unit_class: Record<string, string>;
    /** The amber family line: "{to}" = the family priced. */
    line: string;
    rule: string;
  }>;
}
/** A whole-word, case-insensitive hit of any of `words` in `text` (a word may hold spaces or a hyphen). PURE. */
function wholeWordHit(text: string, words: readonly string[]): boolean {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9.-]+/g, " ")} `;
  return words.some((w) => {
    const ww = w.toLowerCase().replace(/[^a-z0-9.-]+/g, " ").trim();
    return ww !== "" && t.includes(` ${ww} `);
  });
}
/**
 * SLICE 12e-5b (owner R2, 2026-10-15: "should read as 26G GI cladding and mapped to aluminium as we dont have gi
 * cladding. if in future we have GI cladding sku, it should map to it"). PURE. For an UNANSWERED choice (absent or
 * "None"): the text the model copied as written, when it holds one of the entry's words, prices as the option its
 * gauge maps to (no gauge -> `default_to`; a gauge the table does not list -> the entry's `unlisted_line` refusal,
 * never the choice's default). The map is config: a GI cladding SKU later is a config / catalogue change, no code.
 * SLICE 12e-6c (owner O3, 2026-10-18: "fix it"; 12e-6 AC4 "fixings are not cladding"): the FIXING and DUCT words are
 * masked before the words are looked for (`withoutFixingWords`), so "GI strip at 1 m grid" names no cladding; "26 G
 * GI cladding" still maps to 26G Aluminium (12e-5b R2), and the line still quotes the words as written.
 */
export function choiceTextFor(spec: ItemListPricingSpec, attr: string, item: ExtractedListItem): { to: string; line: string; rule: string } | { refuse: string } | null {
  for (const e of spec.choice_text ?? []) {
    if (e.attr !== attr) continue;
    const raw = rawValue(item, e.from_attr);
    const said = raw !== null && raw !== "None" ? String(raw).trim() : "";
    if (said === "" || !wholeWordHit(withoutFixingWords(said), e.words)) continue;
    let to: string | undefined = e.default_to;
    if (e.gauge_pattern) {
      let m: RegExpMatchArray | null = null;
      try { m = said.match(new RegExp(e.gauge_pattern, "i")); } catch { m = null; }
      if (m && m[1] !== undefined) to = e.to_by_gauge?.[m[1]];
    }
    if (!to) return { refuse: e.unlisted_line.replace("{from}", said) };
    return { to, line: e.line.replace("{from}", said).replace("{to}", to), rule: e.rule };
  }
  return null;
}
/**
 * SLICE 12e-5b (owner R5, 2026-10-15: "this also prices thermal nitrile"; scope "option a": ONLY when "closed
 * cell" is written). PURE. A family answered as one of `when_family` whose as-written material hits EVERY group of
 * a map entry prices as that entry's family for the row's unit class, with its line. Plain polyethylene, PE foam
 * and XLPE hit no entry and keep refusing by name. `rowUnitClass` null (no unit) asks only whether ANY class maps.
 */
export function materialTextFor(
  spec: ItemListPricingSpec, familyRaw: string | null, item: ExtractedListItem, rowUnitClass: string | null,
): { family: string; line: string; rule: string } | null {
  const mt = spec.material_text;
  if (!mt || familyRaw === null || !mt.when_family.includes(familyRaw)) return null;
  const raw = rawValue(item, mt.from_attr);
  const said = raw !== null && raw !== "None" ? String(raw) : "";
  if (said.trim() === "") return null;
  for (const e of mt.map) {
    if (!e.all_of.every((group) => wholeWordHit(said, group))) continue;
    const to = rowUnitClass === null ? Object.values(e.to_by_unit_class)[0] : e.to_by_unit_class[rowUnitClass];
    if (!to) return null;
    return { family: to, line: e.line.replace("{to}", to), rule: e.rule };
  }
  return null;
}

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
    // SLICE 12e-6 (owner R1): an unstocked word offered as an ALTERNATIVE to a stocked one ("nitrile rubber/XLPE")
    // is not a refusal -- the stocked one prices (`alternativeMaterials`); only the text outside such a clause counts
    const hit = wordStartHit(`${withoutStockedAlternatives(ownText, um.words)} | ${withoutStockedAlternatives(copiedText, um.words)}`, um.words);
    if (hit !== null) return `No SKU in the catalogue for ${namedText ?? hit.toUpperCase()} - price this row by hand`;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 12e-6 (owner rulings 2026-10-16) -- THE MATERIAL, CLADDING AND SIZE WORDS OF THE STAGE B REVIEW. PURE.
// Every rule here reads text the row or the model wrote; none reads a config key the v42 asset does not have, so
// the asset keeps its keys (v43 changes notes only) and every category without the Insulation / Piping shape never
// reaches them (each is gated on the attribute ids the config itself names).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

/** R1 / R3: the STOCKED insulation materials a BoQ may name, by kind. A part naming one is a stocked alternative. */
const STOCKED_MATERIAL_WORDS: Record<"nitrile" | "acoustic" | "fiberglass" | "puf", readonly string[]> = {
  nitrile: ["nitrile", "nitril", "nbr", "elastomeric", "elastometric"],
  acoustic: ["open cell", "open-cell", "acoustic foam"],
  fiberglass: ["glass wool", "glasswool", "fibre glass", "fiber glass", "fibreglass", "fiberglass", "glass fibre", "glass fiber", "resin bonded"],
  puf: ["puf", "polyurethane"],
};
/** R8 / R5: words that ARE XLPE -- refused by name before the closed-cell-polyethylene map can read them as nitrile. */
const XLPE_RE = /(^|[^a-z0-9])(?:fr-?xpe|xpe|cross[\s-]?linked|crosslinked|co[\s-]?extruded)(?![a-z0-9])/i;
/** R4: a coating or paint ... */
const COATING_RE = /(^|[^a-z0-9])(?:coat|coats|coating|coatings|polyshield|paint|painted|painting|mastic|lacquer)(?![a-z0-9])/i;
/** ... and the words that make it more than a coating: a cloth (R6: a fibre cloth fabric is glass cloth), a sheet, a foil. */
const NOT_ONLY_COATING_RE = /(^|[^a-z0-9])(?:cloth|fabric|fibre\s*glass\s*tape|alumin(?:i)?um|alu|foil|sheet|gi|g\.i|gss|perforated|jacket|canvas|tissue|frp|cladding)(?![a-z0-9])/i;

/** The clauses of a text that hold ALTERNATIVES: a clause (split at ; | , . and line ends) whose parts are joined by
 * "/" or "or". Each part is returned as written. PURE. */
function alternativeClauses(text: string): Array<{ clause: string; parts: string[] }> {
  const out: Array<{ clause: string; parts: string[] }> = [];
  for (const clause of text.split(/[;|\n]|,\s|\.\s/)) {
    const parts = clause.split(/\s*\/\s*|\s+or\s+/i).map((p) => p.trim()).filter((p) => p !== "");
    if (parts.length >= 2) out.push({ clause: clause.trim(), parts });
  }
  return out;
}
function stockedKindOf(part: string): keyof typeof STOCKED_MATERIAL_WORDS | null {
  for (const k of Object.keys(STOCKED_MATERIAL_WORDS) as Array<keyof typeof STOCKED_MATERIAL_WORDS>) {
    if (wordStartHit(part, STOCKED_MATERIAL_WORDS[k]) !== null) return k;
  }
  return null;
}
function namesUnstocked(part: string, unstocked: readonly string[]): boolean {
  return wordStartHit(part, unstocked) !== null || XLPE_RE.test(part);
}
/** R1: the text with every clause removed that offers an unstocked material beside a stocked one. PURE. */
export function withoutStockedAlternatives(text: string, unstocked: readonly string[]): string {
  let t = text;
  for (const { clause, parts } of alternativeClauses(text)) {
    const stocked = parts.some((p) => stockedKindOf(p) !== null && !namesUnstocked(p, unstocked));
    const other = parts.some((p) => namesUnstocked(p, unstocked));
    if (stocked && other) t = t.replace(clause, " ");
  }
  return t;
}

/**
 * R1 / R3 (owner 2026-10-16: "yes agree"; Q7 "ok"). The material AS WRITTEN offered as alternatives. PURE.
 *   one stocked + one unstocked ("nitrile rubber/XLPE", "rockwool/glasswool")  -> { kind: "one", family }
 *   two stocked of DIFFERENT families ("open-cell acoustic foam / 32 kg fiberglass board") -> { kind: "both", families }
 * The family of a stocked part is the config's own: nitrile and open cell by the row kind (`family_when_none`), glass
 * wool the fibre-glass board, PUF the tubular PUF -- each only where the family is declared. Null otherwise.
 */
export function alternativeMaterials(
  spec: ItemListPricingSpec, text: string, rowUnitClass: string | null,
): { kind: "one"; family: string; clause: string } | { kind: "both"; families: string[]; clause: string } | null {
  const unstocked = spec.unstocked_materials?.words ?? [];
  const famOf = (kind: keyof typeof STOCKED_MATERIAL_WORDS, part: string): string | null => {
    const fams = Object.keys(spec.families);
    if (kind === "fiberglass") return fams.find((f) => /fib(?:re|er)\s*glass/i.test(f)) ?? null;
    if (kind === "puf") return fams.find((f) => /\bpuf\b/i.test(f)) ?? null;
    if (rowUnitClass === null) return null;
    // nitrile / open cell: the row kind decides, and "acoustic" / "open cell" in the PART picks the acoustic family
    const byKind = familyWhenNone(spec, rowUnitClass, kind === "acoustic" ? `${part} acoustic` : part);
    return byKind ? byKind.value : null;
  };
  for (const { clause, parts } of alternativeClauses(text)) {
    const stocked: string[] = [];
    let unstockedPart = false;
    for (const p of parts) {
      if (namesUnstocked(p, unstocked)) { unstockedPart = true; continue; }
      const k = stockedKindOf(p);
      const fam = k ? famOf(k, p) : null;
      if (fam && spec.families[fam] && (rowUnitClass === null || spec.families[fam].units[rowUnitClass]) && !stocked.includes(fam)) stocked.push(fam);
    }
    if (stocked.length >= 2) return { kind: "both", families: stocked, clause };
    if (stocked.length === 1 && unstockedPart) return { kind: "one", family: stocked[0], clause };
  }
  return null;
}

/** R8 / R5 (owner "correct" / "this is XLPE"): an XLPE alias in the row's own text or a copied value -> its refusal. PURE. */
export function xlpeAliasRefusal(spec: ItemListPricingSpec, item: ExtractedListItem, ownText: string): string | null {
  if (!spec.unstocked_materials) return null;
  const unstocked = spec.unstocked_materials.words;
  const copiedAttrs = [spec.no_sku_named_by, ...(spec.choice_text ?? []).map((c) => c.from_attr)].filter((a): a is string => !!a);
  for (const a of copiedAttrs) {
    const v = rawValue(item, a);
    const said = v !== null && v !== "None" ? String(v).trim() : "";
    if (said !== "" && XLPE_RE.test(withoutStockedAlternatives(said, unstocked))) {
      return `No SKU in the catalogue for ${said}${/xlpe/i.test(said) ? "" : " (XLPE)"} - price this row by hand`;
    }
  }
  const m = withoutStockedAlternatives(ownText, unstocked).match(XLPE_RE);
  return m ? `No SKU in the catalogue for ${m[0].replace(/^[^a-z0-9]/i, "").trim()} (XLPE) - price this row by hand` : null;
}

/** R4 (owner "ok"): the cladding AS WRITTEN is a coating with no glass cloth, sheet or foil -> its refusal by name,
 * or null. Read only where the cladding was NOT answered as a stocked cladding (the caller's test). PURE. */
export function coatingOnlyRefusal(said: string): string | null {
  const s = said.trim();
  if (s === "" || s === "None" || !COATING_RE.test(s) || NOT_ONLY_COATING_RE.test(s)) return null;
  return `No SKU in the catalogue for ${s} - price this row by hand`;
}

/** SLICE 12e-6c (owner O4): a glass or fibre CLOTH named in a copied cladding -- the 12e-6 R6 words ("factory laminated
 * fire resistant fibre cloth fabric", "reinforced glass cloth"). A bare "fabric" or "laminated" names no cloth. */
const CLOTH_FACING_RE = /(^|[^a-z0-9])(?:(?:glass|fib(?:re|er)|fib(?:re|er)\s*glass|glass\s*fib(?:re|er))\s*(?:cloth|fabric)|fr\s+fabric|cloth\s+fabric)(?![a-z0-9])/i;
/** ... and aluminium named beside it: then the cloth is on aluminium sheet, by its gauge. */
const ALUMINIUM_RE = /(^|[^a-z0-9])(?:alumin(?:i)?um|alu|al\.?)(?![a-z0-9])/i;
const GAUGE_RE = /(\d{2})\s*(?:g|swg|gauge)(?![a-z0-9])/i;
/** The cladding options the backstop prices, by the catalogue's own spelling. */
const CLOTH_CLADDING = "Glass Cloth with paint";
const CLOTH_ON_ALUMINIUM: Record<string, string> = { "24": "24G Aluminium with Glass Cloth", "26": "26G Aluminium with Glass Cloth" };

/**
 * SLICE 12e-6c (owner O4, 2026-10-18: "ok" -- "aluminium + cloth with no gauge -> 26G Aluminium with Glass Cloth;
 * cloth alone -> the glass-cloth cladding; an answered cladding is never overridden"). PURE. The code backstop of the
 * 12e-6 R6 note (HVAC v43: "a factory-laminated or reinforced glass / fibre cloth facing IS the glass cloth cladding"):
 * where the model left the cladding UNANSWERED but copied a cloth facing as written, it prices as the cladding the note
 * tells the model to choose -- "Glass Cloth with paint", or "<gauge> Aluminium with Glass Cloth" where aluminium is
 * named too (no gauge: 26G; a gauge the catalogue has no cloth-on-aluminium option for refuses, as R2's unlisted gauge
 * does, with that entry's own sentence). Read only for the attribute a `choice_text` entry names, from that entry's
 * as-written attribute, and the line is the entry's own ("BoQ says {from} -> priced as {to}"); the caller asks only for
 * an unanswered choice the R2 map did not take.
 */
export function clothFacingCladding(
  spec: ItemListPricingSpec, attr: string, item: ExtractedListItem,
): { to: string; line: string } | { refuse: string } | null {
  for (const e of spec.choice_text ?? []) {
    if (e.attr !== attr) continue;
    const raw = rawValue(item, e.from_attr);
    const said = raw !== null && raw !== "None" ? String(raw).trim() : "";
    if (said === "" || !CLOTH_FACING_RE.test(said)) continue;
    let to: string | undefined = CLOTH_CLADDING;
    if (ALUMINIUM_RE.test(said)) {
      const g = said.match(GAUGE_RE);
      to = CLOTH_ON_ALUMINIUM[g ? g[1] : "26"];
      if (!to) return { refuse: e.unlisted_line.replace("{from}", said) };
    }
    // a family that stocks no such cladding refuses at the SKU match, naming it, exactly as a picked one would
    return { to, line: e.line.replace("{from}", said).replace("{to}", to) };
  }
  return null;
}

/**
 * ADP-1 (owner F3, 2026-10-19: "GI frame / framework" + "perforated Al sheet", cladding unanswered -> the stocked "GI
 * Framework with perforated Al sheet"). The 12e-6c fixing mask (O3) reads "GI frame" as a FIXING, which is right for a
 * frame alone and wrong for this cladding, so the cladding is told FIRST, on the raw words: a GI word, a frame word,
 * "perforated" and an aluminium word, all present.
 */
export const GI_FRAMEWORK_CLADDING = "GI Framework with perforated Al sheet";
const GI_WORD_RE = /(^|[^a-z0-9])(?:gi|g\.i\.?|galvani[sz]ed)(?![a-z0-9])/i;
const FRAME_WORD_RE = /(^|[^a-z0-9])frame(?:s|work|works)?(?![a-z0-9])/i;
const PERFORATED_RE = /(^|[^a-z0-9])perforated(?![a-z0-9])/i;
/** PURE. Does the text name the GI framework with perforated aluminium sheet? Returns the words as written, or null. */
export function namesGiFramework(text: string): string | null {
  const t = String(text ?? "");
  const gi = t.match(GI_WORD_RE), fr = t.match(FRAME_WORD_RE), pf = t.match(PERFORATED_RE);
  if (!gi || !fr || !pf || !ALUMINIUM_RE.test(t.slice(pf.index ?? 0))) return null;
  // the phrase as written: from the first of the GI / frame words to the aluminium word after "perforated" (and a
  // following "sheet"), so a heading is quoted by its own words, not whole
  const start = Math.min(gi.index! + gi[1].length, fr.index! + fr[1].length);
  const afterPf = t.slice(pf.index!);
  const al = afterPf.match(/(^|[^a-z0-9])(?:alumin(?:i)?um|alu|al\.?)(?![a-z0-9])(?:\s+sheets?(?![a-z0-9]))?/i);
  if (!al) return null;
  const end = pf.index! + al.index! + al[0].length;
  return start < end ? t.slice(start, end).replace(/\s+/g, " ").trim() : null;
}
/**
 * ADP-1 (owner F3). PURE. For the cladding a `choice_text` entry names, left UNANSWERED: the GI framework cladding where
 * the cladding as written -- else the row's own text or its headings -- names it, with the entry's line ("BoQ says
 * <words> -> priced as GI Framework with perforated Al sheet"). Only where the category's own cladding definition lists
 * that option, so no other category reaches it. A family that stocks no such cladding refuses at the SKU match.
 */
export function giFrameworkCladding(
  spec: ItemListPricingSpec, attr: string, item: ExtractedListItem, rowText: string,
): { to: string; line: string } | null {
  const values = spec.choice_defs?.[attr]?.values ?? [];
  if (!values.includes(GI_FRAMEWORK_CLADDING)) return null;
  for (const e of spec.choice_text ?? []) {
    if (e.attr !== attr) continue;
    const raw = rawValue(item, e.from_attr);
    const said = raw !== null && raw !== "None" ? String(raw).trim() : "";
    const words = (said !== "" ? namesGiFramework(said) : null) ?? namesGiFramework(rowText);
    if (words === null) continue;
    return { to: GI_FRAMEWORK_CLADDING, line: e.line.replace("{from}", words).replace("{to}", GI_FRAMEWORK_CLADDING) };
  }
  return null;
}

/** SLICE 12e-6c (owner R): RPUF -- rigid polyurethane foam -- as the BoQ writes it. The corpus writes "RPUF" only. */
const RPUF_RE = /(^|[^a-z0-9])(r\.?\s?p\.?\s?u\.?\s?f\.?|rigid\s+(?:puf|pu\s+foam|polyurethane(?:\s+foam)?))(?![a-z0-9])/i;
/**
 * SLICE 12e-6c (owner R, 2026-10-18: "ok"; ruled 2026-10-15 14:24 "accept": RPUF -> Tubular PUF, priced at the next
 * stocked thickness up; 30 mm on a small pipe still refuses). PURE. With NO material answered -- nothing, "not
 * mentioned", or a no-SKU answer -- RPUF in the row's own text or in the material as written prices as the
 * category's PUF family for the row's unit, with the line "BoQ says RPUF -> priced as <family>"; the ladders then fit
 * the thickness exactly as for a picked Tubular PUF. A family the row's unit has no PUF rule for maps to nothing (the
 * row is read as before). The caller never asks for an answered material, so an answered item is never overridden.
 */
export function rpufFamily(
  spec: ItemListPricingSpec, item: ExtractedListItem, ownText: string, rowUnitClass: string | null,
): { family: string; line: string } | null {
  const named = spec.no_sku_named_by ? rawValue(item, spec.no_sku_named_by) : null;
  const copied = named !== null && named !== "None" ? String(named) : "";
  const m = `${copied} | ${ownText}`.match(RPUF_RE);
  if (!m) return null;
  const fam = Object.keys(spec.families).find((f) => /(^|[^a-z0-9])puf(?![a-z0-9])/i.test(f));
  if (!fam || rowUnitClass === null || !spec.families[fam].units[rowUnitClass]) return null;
  return { family: fam, line: `BoQ says ${m[2].trim()} -> priced as ${fam.trim()}` };
}
/**
 * ADP-1 (owner F4, 2026-10-19: "RPUF on a per-sq.m row refuses by name unless a PUF sheet is stocked"). PURE. Asked
 * where `rpufFamily` found RPUF but no PUF rule for the row's unit: the refusal by name, or null. A category with no
 * PUF family (ADP: "RPUF injected panel" on a double-skin plenum) never reaches it, and a unit the PUF family DOES
 * price returns null (that is `rpufFamily`'s case).
 */
export function rpufSheetRefusal(
  spec: ItemListPricingSpec, item: ExtractedListItem, ownText: string, rowUnitClass: string | null,
): string | null {
  const named = spec.no_sku_named_by ? rawValue(item, spec.no_sku_named_by) : null;
  const copied = named !== null && named !== "None" ? String(named) : "";
  const m = `${copied} | ${ownText}`.match(RPUF_RE);
  if (!m) return null;
  const fam = Object.keys(spec.families).find((f) => /(^|[^a-z0-9])puf(?![a-z0-9])/i.test(f));
  if (!fam || rowUnitClass === null || spec.families[fam].units[rowUnitClass]) return null;
  return `No SKU in the catalogue for ${m[2].trim()} - price this row by hand`;
}

/**
 * ADP-1 (owner H3, 2026-10-19: per number, "arive at the per nos rate usingthe lentgh of the piece"). PURE. The piece
 * LENGTH a size as written states, in metres, or null where it states none:
 *   - a part written as the length ("1500 mm long", "2200 mm Length", "1500 L") -- that part;
 *   - else a size written "a x b" or "a x b x c" -- its LONGEST side ("1000x150" -> 1 m) (owner, 2026-10-19: confirmed);
 *   - else a single number with NO label at all, when it is `PIECE_LENGTH_MIN_MM` (300 mm) or more ("1000 mm" -> 1 m);
 *     below that it is a slot width ("75mm") and is not read (owner ruling on H3, 2026-10-19);
 *   - nothing else: a single number with any other word ("20mm slot", "110 mm wide"), a list, a range or anything the
 *     size splitter does not read is not a length.
 * Each part is read in mm by the ordinary reader (a part in m or cm is scaled), so "1.5 m long" is 1.5 m.
 */
const LENGTH_LABEL_RE = /(^|[^a-z])(?:l|lg|long|length)([^a-z]|$)/i;
/** Owner ruling on H3 (2026-10-19): a lone unlabelled number this long or longer (mm) is the piece length; below it, a slot width. */
export const PIECE_LENGTH_MIN_MM = 300;
export function readPieceLength(text: string | number | null | undefined): { metres: number; how: "the length as written" | "the longest side" | "a single size of 300 mm or more" } | null {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  if (raw === "" || raw === "None") return null;
  const parts = raw.split(/\s*[x×*]\s*/i).map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length < 1 || parts.length > 3 || !parts.every(partIsReadable)) return null;
  const mm = (p: string): number | null => {
    const r = readNumber(p, { from: [], name: "piece length", unit: "mm" });
    return r && "value" in r && Number.isFinite(r.value) && r.value > 0 ? r.value : null;
  };
  const tail = (p: string) => p.replace(/[\d.]+/g, " ").replace(/\b(?:mm|cm|m|mtr|mtrs|metre|meter|nos?|no)\b/gi, " ");
  const named = parts.filter((p) => LENGTH_LABEL_RE.test(tail(p)));
  if (named.length > 1) return null;
  if (named.length === 1) {
    const v = mm(named[0]);
    return v === null ? null : { metres: v / 1000, how: "the length as written" };
  }
  if (parts.length < 2) {
    // a single number with no word beside it at all
    if (/[a-z]/i.test(tail(parts[0]))) return null;
    const v = mm(parts[0]);
    return v !== null && v >= PIECE_LENGTH_MIN_MM ? { metres: v / 1000, how: "a single size of 300 mm or more" } : null;
  }
  const sides = parts.map(mm);
  if (sides.some((v) => v === null)) return null;
  return { metres: Math.max(...(sides as number[])) / 1000, how: "the longest side" };
}

/**
 * SLICE 12e-6 (AC4): the words of a row that name a FIXING or a DUCT, not a cladding -- "GI strip", "GI grid", "C shape
 * GI frame", "GI bolt", "aluminium and GI duct" -- are masked before the "cladding named in this row but not read" test,
 * so only a word that names a cladding (aluminium sheet, foil, glass cloth, perforated sheet, a frame WITH a sheet --
 * whose sheet word still hits -- "cladding" ...) can fire it. PURE.
 */
export function withoutFixingWords(text: string): string {
  const metal = String.raw`(?:gi|g\.i\.?|ms|m\.s\.?|galvani[sz]ed(?:\s+iron)?|alumin(?:i)?um|al\.?|steel)`;
  const fixing = String.raw`(?:strips?|grids?|frames?|channels?|angles?|bolts?|nuts?|clamps?|clips?|supports?|hangers?|rods?|ducts?|ducting|ductwork|duct\s+work)`;
  return text
    .replace(new RegExp(String.raw`(^|[^a-z0-9])${metal}(?:\s*(?:and|&|\/|or)\s*${metal})?\s*${fixing}(?![a-z0-9])`, "gi"), "$1 ")
    .replace(/(^|[^a-z0-9])['"‘’]?c['"‘’]?\s*-?\s*shape(?![a-z0-9])/gi, "$1 ");
}

/** AC1 (owner R7): a pipe size written as an OUTSIDE DIAMETER -- "OD", "O.D.", "outer / outside dia(meter)" -- or as an
 * inch size. Everything else (mm, NB, "mm dia", "mm NB") is the SAME size as its NB and is measured on the match. PURE. */
export function sizeIsOutsideDiameter(text: string | number | null | undefined): boolean {
  if (text === null || text === undefined || typeof text === "number") return false;
  const s = unicodeFractions(String(text));
  return /(^|[^a-z])o\.?\s*d\b\.?|out(?:er|side)\s*dia/i.test(s) || INCH_HEAD.test(s) || /\d\s*in\b/i.test(s);
}
/** AC1: copper is sized by its outside diameter -- a copper, refrigerant, VRF or VRV row (VRF / refrigerant = Copper). */
export const COPPER_WORDS: readonly string[] = ["copper", "refrigerant", "vrf", "vrv"];

/** SLICE 12e-6b (owner R1): the words that make a pipe a drain, in the row or a heading. */
const DRAIN_RE = /(^|[^a-z0-9])(?:drain(?:s|age)?|condensate)(?![a-z0-9])/i;
/** SLICE 12e-6b (owner R1): pipe materials beyond the config's own family / map / refuse words (whole words). */
export const DRAIN_MATERIAL_WORDS: readonly string[] = [
  "m.s", "g.i", "mild steel", "galvanised", "galvanized", "stainless", "p v c", "p.v.c", "u.p.v.c", "c.p.v.c",
  "ppr", "pprc", "pp-r", "pp-rc", "polypropylene", "polyethylene", "cast iron", "ductile",
];
/** SLICE 12e-6b (owner R1): an as-written word that is only the drain's service ("DRAIN", "drain pipe", "condensate
 * drain line") names no pipe material. PURE. */
function namesNoPipeMaterial(word: string): boolean {
  return word.toLowerCase().replace(/\b(?:drain(?:s|age)?|condensate|condensed|water|pipes?|piping|lines?|a\.?c|for|of|the|and)\b|[^a-z0-9]+/g, "") === "";
}

/**
 * SLICE 12e-6b (owner R1, 2026-10-16 23:43 IST: "for drain pipes consider CPVC if no material is mentioned"). PURE.
 * A pipe whose type was not told, whose row or heading calls it a drain (drain, drains, drainage, condensate) and
 * whose text names NO pipe material -- no stocked family, no `family_text` map / refuse word, no
 * `DRAIN_MATERIAL_WORDS` word, each as a whole word -- prices as CPVC, with the amber line. A material the BoQ names
 * keeps today's rules (uPVC -> PVC, GI -> MS, CPVC with uPVC -> CPVC). Only a config that reads the family as
 * written (`family_text.from_attr`) and stocks CPVC: Piping. The calculator has no row text, so it never fires there.
 */
export function drainPipeDefault(
  spec: ItemListPricingSpec,
  rowText: string,
  ownText: string,
): { family: string; line: string } | null {
  if (!spec.family_text?.from_attr || !spec.families[CPVC]) return null;
  const text = [rowText, ownText].join(" | ");
  if (!DRAIN_RE.test(text)) return null;
  const t = text.toLowerCase();
  const words = [...Object.keys(spec.families), ...(spec.family_text.map ?? []).map((m) => m.from),
    ...(spec.family_text.refuse ?? []).map((r) => r.from), ...DRAIN_MATERIAL_WORDS];
  for (const word of words) {
    const w = word.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (w && new RegExp(`(^|[^a-z0-9])${w}(?![a-z0-9])`).test(t)) return null;
  }
  return { family: CPVC, line: `drain pipe, no material stated -> priced as ${CPVC}` };
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
  /** SLICE 12e-5b (owner R7): the OUTER layer of a composition -- the TOTAL thickness of all its layers and the
   * pipe size AS READ (absent where it was not read). Absent on every other item. */
  outerWrap?: { total: number; pipeAsRead?: number; pipeMatched?: true },
  /** SLICE 12e-6 (AC1, owner R7): what the section pass knows of the PIPE above this item -- true when it is Copper or
   * its size is written as an outside diameter / inch size, false for any other pipe. Undefined (an Insulation row of
   * its own) -> the row's own words decide (`COPPER_WORDS`). */
  odHint?: boolean,
  /** ADP-5a (HN-2, owner 2026-10-22): the NOTES of the row's headings, read ONLY by the both-streams check. Absent (the
   * calculator, a section) => that check reads the headings' descriptions alone, as before. */
  headingNoteText: string = "",
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
  // SLICE 12e-4d (AC1): the MODEL answered the family itself -- not the pricer, not a default, not the row's words
  const modelAnswered = out.familyRaw !== null && out.familyRaw !== "None" && item.attributes?.[familyAttr(spec)]?.typed !== true;
  /**
   * SLICE 12e-6 (AC2; the 12d-1a default, "material not named -> Nitrile ... amber"). A MODEL answer of a no-SKU family
   * ("none of these") where the BoQ names NO material -- nothing copied as the material as written, no unstocked word in
   * the row or its headings -- is the row saying nothing: it takes the row-kind default exactly as an absent answer
   * does. "none of these" stays a refusal by name wherever a material IS named (rockwool, XLPE, EPDM ...). A pricer's
   * own pick is never touched.
   */
  if (modelAnswered && (spec.no_sku_families ?? []).includes(out.familyRaw!)) {
    const named = spec.no_sku_named_by ? rawValue(item, spec.no_sku_named_by) : null;
    const namedText = named !== null && named !== "None" ? String(named).trim() : "";
    // an unstocked material the config lists, or XLPE / an XLPE alias whatever the config lists (R8 / R5)
    const unstockedNamed = (spec.unstocked_materials && wordStartHit(rowText, spec.unstocked_materials.words) !== null)
      || /(^|[^a-z0-9])xlpe(?![a-z0-9])/i.test(rowText) || XLPE_RE.test(rowText);
    if (namedText === "" && !unstockedNamed && familyWhenNone(spec, rowUnitClass, rowText)) out.familyRaw = "None";
  }
  // SLICE 12e-6c (owner R, 2026-10-18 "ok"): NO material answered -- nothing, "not mentioned", or a no-SKU answer by
  // the MODEL -- and RPUF in the row's own text or as written: Tubular PUF, with its line, BEFORE the row-kind default
  // could read the row as naming no material. A material the model or the pricer answered is never touched.
  const unanswered = out.familyRaw === null || out.familyRaw === "None"
    || (modelAnswered && (spec.no_sku_families ?? []).includes(out.familyRaw!));
  if (unanswered) {
    const rpuf = rpufFamily(spec, item, ownText, rowUnitClass);
    if (rpuf) {
      out.familyRaw = rpuf.family;
      out.familyLine = rpuf.line;
      out.working.push(rpuf.line);
    } else {
      // ADP-1 (owner F4): RPUF on a row whose unit no PUF item is stocked in (a sheet) refuses by name, before the
      // row-kind default could price it as Thermal Nitrile
      const sheet = rpufSheetRefusal(spec, item, ownText, rowUnitClass);
      if (sheet !== null) return blank(sheet);
    }
  }
  // SLICE 12d-1a (owner R2): a row that names NO material prices as the family its ROW KIND implies --
  // declared in config, marked as a default. ONLY over an absent / "None" answer; a stated family,
  // "none of these" included, is never touched.
  const ruled = out.familyRaw === null || out.familyRaw === "None"
    ? familyWhenNone(spec, rowUnitClass, rowText) : null;
  if (ruled) {
    out.familyDefaulted = ruled;
    out.familyRaw = ruled.value;
  }
  // SLICE 12e-2 (owner Q15): with NO family answer, a config declaring `family_text.from_row` reads the row's
  // OWN text -- names that all land on one family price as it (a line says which words were read), two
  // different ones refuse naming them. The calculator has no row text, so nothing fires there.
  if ((out.familyRaw === null || out.familyRaw === "None") && spec.family_text?.from_row) {
    const fromRow = familyFromRowText(spec, ownText);
    if (fromRow && "refuse" in fromRow) return blank(fromRow.refuse);
    if (fromRow) {
      out.familyRaw = fromRow.family;
      out.familyLine = `BoQ names ${fromRow.named.join(" / ")} -> priced as ${fromRow.family}`;
      out.working.push(out.familyLine);
    }
  }
  // SLICE 12e-4b (owner D-3; decision 3): still no family -- neither answered nor named in the row's own words --
  // and the config names the attribute that carries the family AS WRITTEN ("Pipe type as written"). That word
  // becomes the family answer and is read below by the ONE reader a typed word goes through, so "uPVC" prices
  // as PVC with its line and "SS" refuses with its sentence exactly as the same word typed would. An ANSWERED
  // family is never touched: the dropdown answer wins over a disagreeing word (the word is still shown).
  // SLICE 12e-4c: the family answer is the pricer's own TYPED word (read before the as-written word can stand in)
  const familyTyped = item.attributes?.[familyAttr(spec)]?.typed === true && out.familyRaw !== null && out.familyRaw !== "None";
  const asWrittenAttr = spec.family_text?.from_attr;
  let fromAsWritten = false;
  if ((out.familyRaw === null || out.familyRaw === "None") && asWrittenAttr) {
    const w = rawValue(item, asWrittenAttr);
    const word = w !== null && w !== "None" ? String(w).trim() : "";
    if (word !== "") { out.familyRaw = word; fromAsWritten = true; }
  }
  // SLICE 12e-6b (owner R1): still no type told -- nothing answered, or only the drain's service copied as written
  // ("DRAIN") -- on a drain whose text names no pipe material: CPVC, amber with the line. An answered, typed or picked
  // type is never touched; the person switches it with the family control.
  if (!familyTyped && (out.familyRaw === null || out.familyRaw === "None" || (fromAsWritten && namesNoPipeMaterial(out.familyRaw)))) {
    const drain = drainPipeDefault(spec, rowText, ownText);
    if (drain) {
      out.familyRaw = drain.family;
      out.familyLine = drain.line;
      out.working.push(drain.line);
    }
  }
  // SLICE 12d-1a (owner R6): category-NEUTRAL -- the sentence names the family in the config's own label
  // ("no item family could be told", "no insulation material could be told"); it used to say "ADP kind".
  if (out.familyRaw === null || out.familyRaw === "None") return blank(`no ${(spec.family_label ?? "item family").toLowerCase()} could be told for this item`);
  let family = spec.family_alias?.[out.familyRaw] ?? out.familyRaw;
  // SLICE 12e-2 (owner Q16 / Q18): a config declaring `family_text` reads the answer through the ONE reader --
  // a stocked spelling (any case), a mapped one (GI -> MS, with its line), a refused one (SS, with its own
  // sentence); anything else stays as written and refuses BY NAME below (the R18 sentence). A config without
  // the key never reaches this and is byte-identical.
  // SLICE 12e-4b (owner D-3): `readFamilyWord` is `readFamilyText` first (every exact spelling reads as it
  // always did), then a word holding several names and a refused word inside a longer text.
  if (spec.family_text) {
    const read = readFamilyWord(spec, out.familyRaw);
    if (read && "refuse" in read) return blank(read.refuse);
    if (read) {
      family = read.family;
      if (read.line) {
        // SLICE 12e-4c (owner, 2026-10-13; the G1 principle: "BoQ says" only where a BoQ said it): a word the
        // PRICER typed in the family's "Other..." box reads "You typed uPVC -> priced as PVC". A word the model
        // read -- the family answer or the as-written attribute -- keeps the config's own "BoQ says ..." line.
        const line = familyTyped ? typedFamilyLine(read.line) : read.line;
        out.familyLine = line;
        out.working.push(line);
      } else if (modelAnswered && asWrittenAttr) {
        // SLICE 12e-4d (owner, 2026-10-14: "fix"; AC1): the MODEL answered the family itself AND copied a
        // different word as written ("PVC" answered, "uPVC" written). Where that word reads as the SAME family
        // (uPVC -> PVC, GI -> MS, "MS / GI" -> MS), its line shows exactly as it does when the word decides. A
        // word that reads as another family, refuses or reads as nothing is NOT acted on here (the conflict
        // case, left for the owner); the answered family prices as before. Display only: no figure moves.
        const w = rawValue(item, asWrittenAttr);
        const word = w !== null && w !== "None" ? String(w).trim() : "";
        const said = word !== "" && word.replace(/\s+/g, " ").toLowerCase() !== family.toLowerCase() ? readFamilyWord(spec, word) : null;
        if (said && !("refuse" in said) && said.family === family && said.line) {
          out.familyLine = said.line;
          out.working.push(said.line);
        }
      }
    }
  }
  // SLICE 12e-6 (owner R8 / R5, 2026-10-16): "cross linked" / "XPE" / "FR-XPE" and a "co-extruded" jacket or covering
  // ARE XLPE -- refused by name, BEFORE the closed-cell-polyethylene map below could read them as nitrile
  const xlpe = xlpeAliasRefusal(spec, item, ownText);
  if (xlpe !== null) return blank(xlpe);
  // SLICE 12e-6 (owner R1, "yes agree"): the material as written offers a stocked material beside an unstocked one
  // ("nitrile rubber/XLPE") -> the stocked one prices, with the line. A model answer that is itself a stocked family
  // is kept (it may know the row kind better); a no-SKU answer takes the stocked alternative. Both-stocked (R3) is
  // decided by cost in `priceItemList` before this item is priced, which hands the family in as answered.
  if (spec.no_sku_named_by && !familyTyped) {
    const w = rawValue(item, spec.no_sku_named_by);
    const alt = w !== null && w !== "None" ? alternativeMaterials(spec, String(w), rowUnitClass) : null;
    if (alt && alt.kind === "one") {
      if (!spec.families[family] || (spec.no_sku_families ?? []).includes(family)) { family = alt.family; out.familyRaw = alt.family; }
      out.familyLine = `BoQ says ${alt.clause} -> priced as ${family.trim()}`;
      out.working.push(out.familyLine);
    }
  }
  // SLICE 12e-5b (owner R5): a no-SKU answer whose material AS WRITTEN the catalogue prices as one of its families
  // ("closed cell polyethylene" -> Nitrile Rubber on a pipe, Thermal Nitrile on a sheet), with its amber line
  const materialMapped = materialTextFor(spec, out.familyRaw, item, rowUnitClass);
  if (materialMapped) {
    family = materialMapped.family;
    out.familyLine = materialMapped.line;
    out.working.push(materialMapped.line);
  }
  out.family = family;
  if (spec.family_alias?.[out.familyRaw]) out.working.push(`'${out.familyRaw}' prices as ${family} (R3)`);
  // SLICE 12d-4a: the named-material refusal is ONE function (`namedMaterialRefusal`) -- the T5 no-SKU
  // family (12d-1b) and the D7 unstocked-material words share it, and `priceItemList`'s no-unit branch
  // reads the same one (D11). It runs BEFORE the family is checked against the priceable set, so an EPDM row
  // the model priced as Nitrile Rubber refuses by name whatever family was picked.
  const material = materialMapped ? null : namedMaterialRefusal(spec, { ...item, attributes: { ...item.attributes, [familyAttr(spec)]: { value: out.familyRaw } } }, ownText);
  if (material !== null) return blank(material);
  if (!spec.families[family]) {
    return blank(`no SKU in the catalogue for '${out.familyRaw}' -- the user decides (R18)`);
  }
  /**
   * SLICE 12e-6 (AC5, owner U4): a ROW-KIND family on the other row kind -- "Nitrile Rubber Insulation" (the pipe
   * family) on a per-sq.m row, or "Thermal Nitrile Insulation" (the sheet family) on a per-metre one -- prices as the
   * family the config's own row-kind default names for THIS row's unit (`family_when_none.by_unit_class`), with the
   * line, as closed cell polyethylene already does. Only where the family sells nothing in the row's unit and declares
   * no conversion for it; a family outside the row-kind default (Acoustic, Fiberglass, PUF) is never touched.
   */
  {
    const byKind = spec.family_when_none?.by_unit_class;
    const to = byKind?.[rowUnitClass];
    if (byKind && to && to !== family && spec.families[to] && Object.values(byKind).includes(family)
        && !spec.families[family].units[rowUnitClass] && !(spec.families[family].convert?.[rowUnitClass] ?? []).length) {
      family = to;
      out.family = to;
      out.familyLine = `priced as ${to.trim()} (row is per ${unitWord(spec, rowUnitClass)})`;
      out.working.push(out.familyLine);
    }
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
    // SLICE 12e-2: `{family}` names the family the line is drawn for (one entry may serve several families)
    out.working.push(rn.line.replace("{match}", m[0].trim()).replace("{family}", family));
  }

  // (2) the facts: stated -> as stated; "None" -> the ruled default (marked); absent -> omitted. Read over every
  //     match attribute; only the family's NEEDS reach the matcher (below), so a stated fact the SKUs are not
  //     keyed on -- a diffuser's OUTER size beside its neck (R6) -- can never refuse a row.
  const read: Record<string, string | number> = {};
  const readDefaulted: DefaultedAttr[] = [];
  // SLICE 12e-5b (owner R7): the pipe size AS READ, carried on a composition for its outer layer's one wrap
  /**
   * SLICE 12e-6 (AC1; owner R7, 2026-10-16, STANDING: "for pricing purpose we are assuming mm = NB and NB = mm"; it
   * widens 12e-5b2 Q1 (b), which gave this only to a size written "NB"). A size in mm and the same number in NB are
   * the SAME size -- "50 mm dia", "50 NB", "50 mm NB" -- so the cladding is measured on the MATCHED insulation size.
   * Only a size AS READ that is an OUTSIDE DIAMETER keeps the size as read (12e-5b2 R6): written with "OD" / "O.D." /
   * "outer dia", an inch size, or a COPPER pipe (copper is sized by its outside diameter). Copper is told by the
   * section pass (`odHint`, the pipe above) or, on an Insulation row of its own, by the row's words (copper,
   * refrigerant, VRF, VRV -- VRF / refrigerant = Copper).
   */
  const pipeSizeIsOd = (): boolean => {
    const os = spec.compose?.outer_surface;
    if (!os) return false;
    if (odHint !== undefined) {
      if (odHint) return true;
    } else if (wordStartHit(rowText, COPPER_WORDS) !== null) {
      return true;
    }
    return (spec.numbers[os.pipe]?.from ?? [os.pipe]).some((src) => sizeIsOutsideDiameter(rawValue(item, src)));
  };
  const pipeAsReadOf = (): { pipeAsRead?: number; pipeMatched?: true } => {
    const os = spec.compose?.outer_surface;
    if (!os) return {};
    if (!pipeSizeIsOd()) return { pipeMatched: true };
    const v = read[os.pipe];
    return typeof v === "number" && Number.isFinite(v) ? { pipeAsRead: v } : {};
  };
  const unreadable: Record<string, string> = {};
  const noneSaid = new Set<string>();
  // SLICE 12e-2 (owner Q14): the SECOND inch conversion carried beside a read, per axis, for the ladder
  const altReads: Record<string, { alt: number; raw: string }> = {};
  // SLICE 12e-3b: an axis whose stated text was two or more sizes -- the sizes as named and the one taken
  const severalReads: Record<string, { sizes: string[]; chosen: string }> = {};
  // SLICE 12e-4b (owner F-3): an axis whose taken size came from a list written with no unit at all
  const unitlessLists = new Set<string>();
  let layersFrom: { attr: string; raw: string; layers: number[] } | null = null;
  const notes: string[] = [];
  // ADP-3b (U3): the parts of a size the face does not use, said ONCE, on the first face box the size fills
  let faceUnusedSaid = false;
  // ADP-1 (owner H3): what this family's rule for the row's unit READS -- its needs, its unit block's, else its
  // conversions'. A `typed_only` number is read only here, so no other family or unit reads, shows or mentions it.
  const readsHere = new Set<string>([...fam.needs, ...(fam.units[rowUnitClass]?.needs ?? []),
    ...(fam.units[rowUnitClass] ? [] : (fam.convert?.[rowUnitClass] ?? []).flatMap((o) => o.needs))]);
  // ADP-3b (owner D3): a `second_key` family reads its outer size beside its primary (the square diffuser's neck), so
  // the outer size's typed face boxes are read wherever the primary is
  for (const k of spec.second_key ?? []) if (k.families.includes(String(family)) && readsHere.has(k.primary)) for (const a of k.key) readsHere.add(a);
  for (const attr of spec.match_attrs) {
    const reader = spec.numbers[attr];
    if (reader?.typed_only && !readsHere.has(attr)) continue;
    /**
     * SLICE 12d-8 (owner R1, 2026-10-09): A VALUE THE SYSTEM CLEARED STAYS BLANK AND THE ROW REFUSES.
     *
     * 12c-S clears a pick the block's other answers no longer stock, and until this slice the panel
     * DELETED the attribute -- so the pricer read it as "not mentioned" and the T1 thickness default (9 mm,
     * then the ladder) or an `absent_as_none` default (ADP's UL) filled it and PRICED the row, beside a
     * field note saying "choose again" (12d-7 F-1: Nitrile 6.35 + a cleared 25 priced 191 / 14 where the
     * pure pricer composes 382 / 28; a cleared UL yes priced the non-UL damper). The owner's ruling:
     * defaults fill only what the BoQ or the user never gave -- never a pick that was cleared. A cleared
     * cell is therefore read as UNREADABLE here, which the needs loop below turns into the refusal BEFORE
     * any default is consulted (the same order T1 fixed for a stated-but-unreadable value).
     */
    const clearedSrc = (reader ? reader.from : [attr]).find((src) => item.attributes?.[src]?.cleared === true);
    if (clearedSrc !== undefined) {
      unreadable[attr] = `choose again: ${reasonName(spec, attr)} -- the value picked is not stocked with the other answers on this item`;
      continue;
    }
    if (reader) {
      // SLICE 12d-4c (owner C3, F4): on the COMPOSE axis the layers reader runs FIRST, over the MODEL's cells
      // only (T6: a pricer's typed entry is never parsed as layers). It used to run only when the single-number
      // read came back BLANK -- and "Double layer of 19mm thick" is not blank to that reader, it is a 19, so
      // every such row priced ONE layer. A cell the layers reader does not accept is read exactly as before.
      if (spec.compose && attr === spec.compose.attr && layersFrom === null) {
        for (const src of reader.from) {
          const cell = item.attributes?.[src];
          if (!cell || cell.typed === true) continue;
          const layers = readLayers(cell.value);
          if (layers && layers.length >= 2) { layersFrom = { attr, raw: String(cell.value), layers }; break; }
        }
        if (layersFrom) continue;
      }
      let got: NumberRead = null;
      // SLICE 12d-6 (owner U4, 2026-10-09: "when we select other we should only be applied to type numbers for
      // thickness, not anything else"). The thickness "Other..." box -- on the calculator AND on a typed panel
      // edit -- accepts a SINGLE NUMBER only (whole or decimal, a trailing "mm" accepted). T6 keeps a pricer's
      // typed entry out of the layers reader, and the single-number reader would read a typed "Double layer of
      // 19 mm thick" as a 19 and price ONE layer silently; so anything that is not a single number refuses with
      // ONE message. TYPED thickness only: a MODEL-read cell is untouched (it composes), and the pipe-size box is
      // not on this axis (it must keep accepting 5/8", 1-1/4" ...). The axis is named by the CONFIG's own reader
      // (`numbers.<attr>.name === "thickness"`): ADP's compose axis is a SIZE and keeps composing a typed 749.
      if (spec.compose && attr === spec.compose.attr && reader.name === "thickness") {
        for (const src of reader.from) {
          const cell = item.attributes?.[src];
          // SLICE 12e-4b (owner F-2): a trailing full stop is not part of the number ("19 mm." is 19)
          if (cell && cell.typed === true && !TYPED_THICKNESS_RE.test(withoutTrailingPunctuation(String(cell.value ?? "")))) {
            got = { blank: TYPED_THICKNESS_MESSAGE };
            break;
          }
        }
      }
      // SLICE 12e-2 (owner P2): on a `typed_entry: "one_size"` axis a PRICER's entry must be ONE size -- a
      // number in mm or an inch form; "40/50" and "two inch" refuse with the one message. TYPED cells only, so
      // a model cell is read exactly as before; a reader without the key never reaches this.
      // SLICE 12e-2b (AC6): on the same axis a slash that cannot be an inch fraction states several sizes and
      // refuses -- a MODEL cell and a TYPED one alike, before either reader sees it.
      // SLICE 12e-3b (owner 2026-10-11): ... and now PRICES THE HIGHER / HIGHEST of them, with its line, on both
      // paths. Only a form the ruling does not cover keeps the "- pick one" refusal (`severalSizesPick`).
      // SLICE 12e-4c (owner, 2026-10-13: "fix" -- "its two sizes in such case if the model can determine the
      // specific size for the row use it else use the higher size"): the SAME rule on every axis that reads a
      // bare fraction as INCHES (`inches: true`) -- Insulation's pipe size -- because that is exactly where a
      // slash is ambiguous: "19/25" read as 19/25 of an inch (19.3 mm) and priced a size the row never named.
      // A real inch fraction ("3/4", "1-1/4") is not two sizes (`slashSizes`) and reads as inches as before.
      if (got === null && (reader.typed_entry === "one_size" || reader.inches === true)) {
        for (const src of reader.from) {
          // SLICE 12e-5b (owner R6): `1/2" (12.7mm)` is ONE size -- the bracketed mm echo is dropped before the
          // slash check counts its numbers; an echo that disagrees with the inch value refuses by name
          const echo = inchWithMmEcho(rawValue(item, src));
          if (echo && "conflict" in echo) { got = { blank: echo.conflict }; break; }
          const stated = echo ? echo.head : rawValue(item, src);
          const sizes = slashSizes(stated);
          if (!sizes) continue;
          const pick = severalSizesPick(stated, reader);
          const taken = pick ? readNumber(pick.token, reader) : null;
          if (pick && taken && "value" in taken) {
            got = taken;
            severalReads[attr] = { sizes: pick.sizes, chosen: pick.chosen };
            if (pick.unitless) unitlessLists.add(attr);
            notes.push(`${reader.name} ${severalSizesTaken(pick.sizes, pick.chosen)}`);
          } else {
            got = { blank: severalSizesMessage(reader.name, sizes) };
          }
          break;
        }
      }
      if (got === null && reader.typed_entry === "one_size") {
        for (const src of reader.from) {
          const cell = item.attributes?.[src];
          // SLICE 12e-5b (owner R6): a typed `1/2" (12.7mm)` is one size too -- its agreeing bracket is dropped
          const typedEcho = cell ? inchWithMmEcho(cell.value) : null;
          const typedText = typedEcho && "head" in typedEcho ? typedEcho.head : cell?.value;
          if (cell && cell.typed === true && cell.value !== null && cell.value !== "" && !isOneSizeEntry(typedText)) {
            got = { blank: ONE_SIZE_MESSAGE };
            break;
          }
        }
      }
      if (got === null) {
        for (const src of reader.from) {
          got = readNumber(rawValue(item, src), reader);
          if (got !== null) break;
        }
      }
      // ADP-2 (owner H7 / Q2 / Q3): nothing typed -- a BOX SIDE read from the size as written (L x W x H, a label
      // winning), or any other unit's number read from the attribute as one number (the area band, its largest value);
      // the field shows the value used with its line. A part stated but unreadable refuses with its own reason.
      if (got === null && reader.length_from && (reader.box_side || reader.face_side || reader.unit !== "m")) {
        const said = rawValue(item, reader.length_from);
        const { typed_only: _t, length_from: _l, box_side: _b, face_side: _f, label: _lb, ...plain } = reader;
        let part: string | number | null = null;
        let how = "";
        let faceUnused: string[] = [];
        if (reader.box_side) {
          const side = readBoxSides(said)?.[reader.box_side];
          if (side) {
            part = side.part;
            how = side.how === "as written" ? `the ${reader.box_side} as written` : `the ${["first", "second", "third"][BOX_SIDE_ORDER.indexOf(reader.box_side)]} of length x width x height`;
          }
        } else if (reader.face_side) {
          // ADP-3b (owner B1, D1): one side of the FACE the size states; a part the face does not use is said once
          const readsSide = (s: FaceSide) => [...readsHere].some((a) => spec.numbers[a]?.face_side === s && spec.numbers[a]?.length_from === reader.length_from);
          const widthRead = readsSide("width");
          // ADP-3c: an item that reads BOTH sides of the face is a W + H pair -- a two-part size is its face whatever
          // its parts are called
          const face = readFaceSides(said, { pair: widthRead && readsSide("height") });
          if (face) {
            faceUnused = face.notUsed;
            let side = face[reader.face_side];
            // ADP-3b (owner D2): a family that reads the HEIGHT alone (a per-metre grille), sized by ONE dimension the
            // BoQ writes as a width ("150mm width"), takes it as the height -- the grille's narrow dimension
            if (!side && reader.face_side === "height" && !widthRead && face.parts === 1 && face.width?.how === "as written") {
              side = face.width;
              how = `the ${String(family ?? "").split(" ").pop()}'s narrow dimension`;
            }
            if (side) part = side.part;
            if (side?.line) how = side.line;
          } else if (reader.face_side === "width") {
            // not a face this reader can split: the WHOLE text is the width, exactly as the width axis read it before
            // (a lone range takes its top; a list or an inch size keeps its named refusal)
            part = said;
          }
        } else {
          part = said;
        }
        if (part !== null && part !== undefined) {
          const r = readNumber(part, plain);
          if (r && "value" in r) {
            const several = reader.range === "max" && ((String(said).match(/\d+(?:\.\d+)?/g) ?? []).length > 1 || /\bup\s*to\b/i.test(String(said)));
            const u = reader.unit === "sqm" ? "sq.m" : (reader.unit ?? "");
            const line = reader.box_side
              ? `BoQ says ${String(said).trim()} -> ${fmt(r.value)} ${u} (${how})`
              : reader.face_side
                ? `BoQ says ${String(said).trim()} -> ${reader.face_side} ${fmt(r.value)} ${u}${how ? ` (${how})` : ""}${faceUnused.length && !faceUnusedSaid ? `; ${faceUnused.join("; ")}` : ""}`
                : several ? `BoQ says ${String(said).trim()} -> priced at ${fmt(r.value)} ${u} (the largest value)` : `BoQ says ${String(said).trim()} -> ${fmt(r.value)} ${u}`;
            got = { value: r.value };
            if (reader.face_side && faceUnused.length) faceUnusedSaid = true;
            (out.filledReads ??= {})[attr] = { value: r.value, line };
            notes.push(`${reader.name}: ${line}`);
          } else if (r) {
            got = r;
          }
        }
      }
      // ADP-1 (owner H3): nothing typed -- the length the size as written states (`readPieceLength`), with its line
      if (got === null && reader.length_from && !reader.box_side && reader.unit === "m") {
        const said = rawValue(item, reader.length_from);
        const pl = readPieceLength(said);
        if (pl) {
          got = { value: pl.metres };
          out.lengthRead = { attr, metres: pl.metres, line: `BoQ says ${String(said).trim()} -> ${fmt(pl.metres)} ${reader.unit ?? "m"} (${pl.how})` };
          notes.push(`${reader.name}: ${out.lengthRead.line}`);
        }
      }
      if (got === null) continue;
      if ("value" in got && typeof got.alt === "number") altReads[attr] = { alt: got.alt, raw: got.raw ?? "" };
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
    // SLICE 12e-5b (owner R2): an UNANSWERED choice the BoQ named in a word the catalogue does not stock ("26 G GI
    // cladding", copied as written) prices as the stocked option the config maps it to, with its amber line
    if (v === null || v === "None") {
      // SLICE 12e-6c (owner O4): ... and, where R2's map takes nothing, a copied glass / fibre cloth facing
      // ADP-1 (owner F3): ... and FIRST, the GI framework with perforated aluminium sheet, in the copy or the row's text
      const ct = giFrameworkCladding(spec, attr, item, rowText) ?? choiceTextFor(spec, attr, item) ?? clothFacingCladding(spec, attr, item);
      if (ct && "refuse" in ct) { unreadable[attr] = ct.refuse; continue; }
      if (ct) {
        read[attr] = ct.to;
        out.textMapped = [...(out.textMapped ?? []), { attr, value: ct.to, line: ct.line }];
        out.working.push(ct.line);
        continue;
      }
    }
    // SLICE 6 (S6): a default declaring `absent_as_none` reads an ABSENT answer as "None" -- UL only, by config.
    if (v === null && spec.defaults?.[attr]?.absent_as_none === true) v = "None";
    if (v === null) continue;
    if (v === "None") {
      noneSaid.add(attr);
      const d = spec.defaults?.[attr];
      const dv = ruledDefaultValue(spec, attr, family);
      if (dv !== undefined) {
        read[attr] = dv;
        readDefaulted.push({ attr, value: dv, rule: d!.rule_by_family?.[family] ?? d!.rule });
      }
      continue;
    }
    read[attr] = v;
  }
  // R13: a derived default ("supply air" -> with damper on the linear / plain grille), ONLY over a "None"
  for (const rule of spec.derive_when_none ?? []) {
    if (!rule.families.includes(family) || !noneSaid.has(rule.attr)) continue;
    if (String(rawValue(item, rule.when.attr) ?? "") !== rule.when.equals) continue;
    /**
     * ADP-2 (owner H5 fix (a), 2026-10-20; H5 14:34: "if supply is mentioned along with return and we are not able to
     * determine whether it is a supply or return grill/diffuser ... then we price with or without damper as per the
     * actual model value"). Where the condition is an AIR STREAM (its values hold both supply and return): the row's OWN
     * text naming exactly one stream decides, as built; a row naming BOTH supply and return, or naming none under a
     * heading that names both, does NOT let the stream decide -- the attribute stays as read (not mentioned -> its ruled
     * default), with a line saying so. The calculator has no row text, so it is unchanged.
     */
    const streams = spec.choice_defs?.[rule.when.attr]?.values ?? [];
    if (streams.includes("supply") && streams.includes("return")) {
      const own = airStreamsNamed(ownText, streams);
      const both = (x: Set<string>) => x.has("supply") && x.has("return");
      // ADP-5a (HN-2, owner 2026-10-22): a heading's NOTE counts as the heading does -- read here and nowhere else
      const headingsText = headingNoteText ? `${rowText} | ${headingNoteText}` : rowText;
      if (own.size !== 1 && (both(own) || (own.size === 0 && both(airStreamsNamed(headingsText, streams))))) {
        const line = `BoQ names supply and return air -> ${rule.attr} as read (not mentioned -> ${String(read[rule.attr] ?? "None")})`;
        if (!notes.includes(line)) notes.push(line);
        continue;
      }
    }
    read[rule.attr] = rule.then;
    const i = readDefaulted.findIndex((d) => d.attr === rule.attr);
    if (i >= 0) readDefaulted.splice(i, 1);
    // ADP-2 (owner H5): the stated fact that decided it rides on the record, so the line can name it
    readDefaulted.push({ attr: rule.attr, value: rule.then, rule: rule.rule, when: { ...rule.when } });
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
    // ADP-3a (U4): the refusal is about this field -- the panel outlines it
    if (rule.refuse) return { ...blank(rule.refuse), selection: { [familyAttr(spec)]: family }, refusedFor: rule.attr };
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
    // ADP-1 (owner H3 (b)): a ruled default that IS the refused value (a slot diffuser's damper not mentioned -> without,
    // per sq.m) stays on the field, amber, exactly as the SKU-match refusal showed it before; a word-triggered refusal
    // carries none (the default it would show is not what refused)
    if (byValue || byWord) return { ...blank(rule.refuse), selection: { [familyAttr(spec)]: family }, refusedFor: rule.attr,
      ...(byValue ? { defaulted: readDefaulted.filter((d) => d.attr === rule.attr) } : {}) };
  }
  /**
   * SLICE 12e-6 (owner R4, 2026-10-16: "ok"): a cladding AS WRITTEN that is a COATING with no glass cloth ("polyshield
   * coating", "fire retardant coating", "protective coating") refuses BY NAME -- where the cladding was NOT answered
   * ("not mentioned", or nothing). A cladding the model DID answer stands: the
   * model saw the whole payload, the pricer only the copy, and a copy may be the shortest piece of a coating that IS
   * sandwiched with glass cloth (measured: 21 stored rows of BOQ-26-00086 / High side, "two coats of ... Flame
   * Retardant coating", whose payload goes on "sandwiched with 10 Mil Class E Glass Cloth"). It runs before D3, so the
   * person is told the outcome rather than asked to set a cladding.
   */
  for (const ct of spec.choice_text ?? []) {
    const now = read[ct.attr];
    // "not mentioned" or nothing at all -- never a stated "No", which is also what `outer_only` gives a composition's
    // inner layers (their cladding is the outer layer's, whatever was written)
    if (now !== undefined && !noneSaid.has(ct.attr)) continue;
    const w = rawValue(item, ct.from_attr);
    const coating = w !== null && w !== "None" ? coatingOnlyRefusal(String(w)) : null;
    if (coating !== null) return { ...blank(coating), selection: { [familyAttr(spec)]: family }, refusedFor: ct.attr };
  }
  // SLICE 12d-4a (owner D3): a value NAMED IN THE ROW'S OWN TEXT but answered "not mentioned" never falls
  // to the default -- the row refuses for a person. Headings never trigger it (`ownText` carries none).
  // SLICE 12e-6 (AC4): the row's FIXINGS and DUCT MATERIAL are masked first ("GI strip", "C shape GI frame",
  // "aluminium and GI duct") -- they name no cladding (`withoutFixingWords`).
  for (const rule of spec.named_in_row ?? []) {
    if (!noneSaid.has(rule.attr)) continue;
    // ADP-3a (U4): "set the cladding" -- the Cladding box is the one outlined
    if (wordStartHit(withoutFixingWords(ownText), rule.words) !== null) return { ...blank(rule.refuse), selection: { [familyAttr(spec)]: family }, refusedFor: rule.attr };
  }
  // SLICE 12d-1b (owner T4): STATED LAYERS go through the EXISTING composition path -- each layer its own item
  // at the row's pipe size, `outer_only` stripping the cladding from every inner layer. Nothing new is priced
  // here; `priceItemList` expands it exactly as it expands a composition built above a top rung.
  if (layersFrom) {
    const total = layersFrom.layers.reduce((a, b) => a + b, 0);
    return { ...out, selection: { [familyAttr(spec)]: family },
      composeInto: { attr: layersFrom.attr, stated: total, layers: layersFrom.layers, delta: 0, top: Number.NaN, explicit: { raw: layersFrom.raw }, ...pipeAsReadOf() } };
  }
  const sel: Record<string, string | number> = { [familyAttr(spec)]: family };

  // (3) the SKU unit class: the family's own rows for the row's unit, else a declared conversion (R4 / R11 / R16),
  //     else no SKU per that unit
  let unit: UnitPricing | undefined = fam.units[rowUnitClass];
  let target = rowUnitClass;
  let showNumbers = false;
  // ADP-3a (U6): the needs of the conversion chosen, so the working can say which numbers it read
  let conversionNeeds: string[] = [];
  let needs = [...fam.needs];
  if (unit) {
    needs.push(...(unit.needs ?? []));
    // SLICE 6 (T7): a block without pipelines of its own runs the config's shared per-item default
    if (!unit.pipelines) unit = { ...unit, pipelines: spec.default_pipelines };
  } else {
    // ADP-4b (owner fix (b), 2026-10-21; AC5 "same rule everywhere"): a unit the family declares `units_not_offered`
    // is neither priced nor stocked -- its conversions do not run, so the row refuses below naming the stocked units
    // (the double-skin plenum per number, as its Derivation line says; 0 stored rows)
    const options = (fam.units_not_offered ?? []).includes(rowUnitClass) ? [] : (fam.convert?.[rowUnitClass] ?? []);
    // ADP-1 (owner H3 (d)): a need the config gives a ruled number default for THIS family (the 1 m piece length) does
    // not stop its option being chosen -- the needs loop below fills it, marked. A need read but unreadable still does
    // (its refusal names it). No shipped option before ADP-1 needs such a number, so every other choice is unchanged.
    const ruledNumber = (n: string): boolean => {
      const nd = spec.number_defaults?.[n];
      return !!nd && Number.isFinite(nd.value) && !(n in unreadable) && (!nd.families || nd.families.includes(family));
    };
    const chosen = options.find((o) => o.needs.every((n) => n in read || ruledNumber(n)));
    if (chosen) {
      unit = { pipelines: chosen.pipelines };
      target = chosen.to;
      needs.push(...chosen.needs);
      conversionNeeds = chosen.needs;
      out.conversion = { rule: chosen.rule, to: chosen.to };
      out.working.push(chosen.rule);
      if (chosen.show_numbers) showNumbers = true;
    } else if (options.length) {
      // ADP-1 (owner H4): an option declaring `name_missing` names only the facts the row did not state
      const wanted = options.map((o) => (o.name_missing ? o.needs.filter((n) => !(n in read) && !ruledNumber(n)) : o.needs)
        .map((n) => reasonName(spec, n)).join(" and ")).join(", or ");
      const bad = options.flatMap((o) => o.needs).map((n) => unreadable[n]).find(Boolean);
      // ADP-2 (owner H7 (c), 2026-10-19 23:13: "if nboth are not there the it should refuse"): where SEVERAL
      // conversions each name what is missing (a plenum's area, or its length + width + height), the refusal offers
      // every way to price the row and names what the nearest one lacks -- the option with the most facts stated,
      // the later one on a tie. A family with one such option keeps ADP-1's sentence byte for byte.
      if (!bad && options.length > 1 && options.every((o) => o.name_missing)) {
        const missingOf = (o: ConversionOption) => o.needs.filter((n) => !(n in read) && !ruledNumber(n));
        const nearest = options.reduce((best, o) => (o.needs.length - missingOf(o).length >= best.needs.length - missingOf(best).length ? o : best));
        const ways = options.map((o) => o.needs.length === 1
          ? `${/^[aeiou]/i.test(reasonName(spec, o.needs[0])) ? "an" : "a"} ${reasonName(spec, o.needs[0])}`
          : o.needs.map((n) => reasonName(spec, n)).join(" + ")).join(", or ");
        // ADP-3b (owner 2026-10-20 21:57, fix (2)): with NOTHING stated for any way, the row names neither and every
        // box of every way is outlined (the area too); with something stated, the nearest way's gaps as before
        const noneStated = options.every((o) => missingOf(o).length === o.needs.length);
        if (noneStated) {
          return { ...blank(`${family} needs ${ways} - ${options.length === 2 ? "neither" : "none"} stated - price this row by hand`),
                   missing: [...new Set(options.flatMap((o) => o.needs))], defaulted: readDefaulted.filter((d) => fam.needs.includes(d.attr)) };
        }
        return { ...blank(`${family} needs ${ways} - ${missingOf(nearest).map((n) => reasonName(spec, n)).join(" and ")} not stated - price this row by hand`),
                 missing: missingOf(nearest), defaulted: readDefaulted.filter((d) => fam.needs.includes(d.attr)) };
      }
      /**
       * ADP-3a (owner H2, U2 / U3; B6 #3): SEVERAL WAYS that do not each declare `name_missing` -- the per-number
       * "Size (W x H), or Area band" of eleven ADP families -- refuse naming the GROUP the person sees, and outline
       * every box in it (neither way was stated). A size box that WAS stated but gave one length ("1500 mm long",
       * read onto the depth axis) says so, rather than "no width and height" beside a box that visibly holds a value.
       */
      if (!bad && options.length > 1) {
        const ways = waysLabel(spec, options.map((o) => o.needs));
        const missingOf = (o: ConversionOption) => o.needs.filter((n) => !(n in read) && !ruledNumber(n));
        const anyStated = options.some((o) => missingOf(o).length < o.needs.length);
        const nearest = options.reduce((best, o) => (o.needs.length - missingOf(o).length >= best.needs.length - missingOf(best).length ? o : best));
        const boxesMissing = [...new Set(missingOf(nearest).map((n) => boxOf(spec, n)))];
        // a box the row DID fill, whose reading gave none of the sides this way needs (a length on the depth axis)
        const lengthOnly = options.flatMap((o) => o.needs).map((n) => boxOf(spec, n)).find((box) => {
          const raw = rawValue(item, box);
          return raw !== null && raw !== "None" && options.every((o) => o.needs.filter((n) => boxOf(spec, n) === box).every((n) => !(n in read)));
        });
        // ADP-3b (owner B1): the face boxes are filled from the size AS WRITTEN; a size that gave none of their sides (a
        // length, a depth) is named by that size, as before -- never "neither stated" beside a size the BoQ wrote
        const faceNeeds = options.flatMap((o) => o.needs).filter((n) => !!spec.numbers[n]?.face_side && !!spec.numbers[n]?.length_from);
        const faceFrom = faceNeeds.length ? spec.numbers[faceNeeds[0]]!.length_from! : undefined;
        const faceSaid = faceFrom ? rawValue(item, faceFrom) : null;
        const faceGaveNone = faceSaid !== null && faceSaid !== "None" && faceNeeds.every((n) => !(n in read)) && !anyStated;
        const what = lengthOnly === undefined && faceGaveNone
          ? `${boxLabel(spec, faceFrom!)} '${String(faceSaid)}' gives no ${faceNeeds.map((n) => reasonName(spec, n)).join(" or ")}${(() => { const u = readFaceSides(faceSaid)?.notUsed ?? []; return u.length ? ` (${u.join("; ")})` : ""; })()}`
          : lengthOnly !== undefined
          ? `${boxLabel(spec, options.flatMap((o) => o.needs).find((n) => boxOf(spec, n) === lengthOnly)!)} '${String(rawValue(item, lengthOnly))}' gives one length, not ${options.flatMap((o) => o.needs).filter((n) => boxOf(spec, n) === lengthOnly).map((n) => reasonName(spec, n)).join(" x ")}`
          : anyStated
            ? `${boxesMissing.map((b) => boxLabel(spec, missingOf(nearest).find((n) => boxOf(spec, n) === b)!)).join(" and ")} not stated`
            : `${options.length === 2 ? "neither" : "none"} stated`;
        return { ...blank(`${family} needs ${ways} - ${what} - price this row by hand`),
                 missing: anyStated && lengthOnly === undefined ? missingOf(nearest) : options.flatMap((o) => o.needs),
                 defaulted: readDefaulted.filter((d) => fam.needs.includes(d.attr)) };
      }
      // SLICE 12e-3b (AC5, owner Q12 "option a"): the row waits for the fact that picks its conversion (a size),
      // but the kind's OWN facts do not depend on which conversion that will be -- their ruled defaults are
      // carried on the refusal, so the fields show them (amber, with their rule) exactly as the same kind shows
      // them on a row priced in its own unit, instead of "- select -" until a size is typed.
      return { ...blank(bad ?? `per-${unitWord(spec, rowUnitClass)} row: no ${wanted} stated to convert the per-${unitWord(spec, options[0].to)} rate`),
               missing: options.flatMap((o) => o.needs).filter((n) => !(n in read) && !ruledNumber(n)),
               defaulted: readDefaulted.filter((d) => fam.needs.includes(d.attr)) };
    } else {
      // ADP-3a (owner 2026-10-20 13:35, U5): the row's unit is one this family is not stocked in -- name it and the
      // unit(s) it IS stocked in, so the person knows what to change (the fields stay: they price it in those units)
      const stocked = stockedUnitsWords(spec, family);
      return blank(stocked
        ? `${family} is not stocked per ${unitWord(spec, rowUnitClass)} (stocked ${stocked}) - price this row by hand`
        : `no SKU per ${unitWord(spec, rowUnitClass)} for ${family}`);
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
  // ADP-4b (owner AC7, 2026-10-21: "Both quote the read sides"): the outer size's sides as READ, kept when the pair is
  // set aside, so the refusal below quotes them -- the same words whether the sides came from the BoQ's size or from
  // the typed boxes (the calculator has no size as written, so quoting the BoQ's words made the two disagree)
  let outerSetAside: number[] | null = null;
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
      outerSetAside = stated;
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
  // SLICE 12e-5 (AC1): the "None" answers already read into their ruled defaults, held on a refusal below
  const held = (n: string): Pick<ItemPriceResult, "heldDefaults"> => {
    const d = readDefaulted.filter((x) => needs.includes(x.attr) && !(x.attr in spec.numbers));
    return d.length ? { heldDefaults: { need: n, defaulted: d } } : {};
  };
  // (4) the needs (R7-R10, R2): only the needed facts reach the matcher.
  // ADP-3a (U3): EVERY missing need is named, not only the first ("no width and height stated"), each one's box
  // outlined. An unreadable need still refuses by its own sentence where nothing before it was missing -- exactly the
  // old order -- and, where something was, the refusal names the missing ones it had reached.
  const absent: string[] = [];
  const absentRefusal = (): ItemPriceResult => {
    // ADP-3a (owner H2, U2 / U3; B6 #5): a `second_key` family missing its primary (the neck) is missing ONE OF its
    // two ways -- the refusal names the group the person sees ("Neck size, or Outer size") and outlines both boxes;
    // an outer size that WAS stated but matched no SKU is said so
    if (skRule && absent.length === 1 && absent[0] === skRule.primary) {
      const outerLabel = skRule.name.charAt(0).toUpperCase() + skRule.name.slice(1);
      // ADP-3b (owner D3): a typed outer box left empty is filled from the size as written -- that is what was stated
      const k0 = spec.numbers[skRule.key[0]];
      const outerRaw = rawValue(item, boxOf(spec, skRule.key[0])) ?? (k0?.length_from ? rawValue(item, k0.length_from) : null);
      // ADP-4b (owner AC7): sides that were read are quoted as read ("outer size 450 x 450"); a size that gave no sides
      // keeps its words as written
      const what = outerSetAside
        ? `${skRule.name} ${outerSetAside.map(fmt).join(" x ")} could not be used and no ${reasonName(spec, skRule.primary)} stated`
        : outerRaw !== null && outerRaw !== "None"
        ? `${skRule.name} '${String(outerRaw)}' could not be used and no ${reasonName(spec, skRule.primary)} stated`
        : "neither stated";
      return { ...blank(`${family} needs ${boxLabel(spec, skRule.primary)}, or ${outerLabel} - ${what} - price this row by hand`),
               selection: sel, missing: [skRule.primary, ...skRule.key], ...held(absent[0]) };
    }
    const choices = absent.filter((n) => spec.choice_attrs.includes(n));
    const numbers = absent.filter((n) => !spec.choice_attrs.includes(n));
    const parts = [
      ...(choices.length ? [`could not tell ${choices.map((n) => reasonName(spec, n)).join(" and ")}`] : []),
      ...(numbers.length ? [`no ${numbers.map((n) => reasonName(spec, n)).join(" and ")} stated`] : []),
    ];
    return { ...blank(parts.join("; ")), selection: sel, missing: [...absent], ...held(absent[0]) };
  };
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
    // SLICE 12e-4d (AC2): a NUMBER axis that refused on its reading is named, for a section that takes its size from it
    if (unreadable[n]) {
      if (absent.length) return absentRefusal();
      return { ...blank(unreadable[n]), selection: sel, missing: [n], ...(n in spec.numbers ? { sizeRefused: n } : {}), ...held(n) };
    }
    const ndef = spec.number_defaults?.[n];
    if (ndef && Number.isFinite(ndef.value)
        && (!ndef.families || (out.family !== null && ndef.families.includes(out.family)))) {
      sel[n] = ndef.value;
      read[n] = ndef.value;
      // `DefaultedAttr.value` is the DISPLAY string every other default already uses
      readDefaulted.push({ attr: n, value: fmt(ndef.value), rule: ndef.rule });
      continue;
    }
    absent.push(n);
  }
  if (absent.length) return absentRefusal();
  out.defaulted = readDefaulted.filter((d) => needs.includes(d.attr));
  /**
   * ADP-3a (U6): a conversion that READ its sides off one size box says which numbers it used and, for an area, the
   * area they make -- the rule line ("per-sq.m rate x W x H") and the cost line never stated either. Only a box
   * shared by several readers (a size phrase) is described; a `show_numbers` option writes its own arithmetic.
   */
  if (out.conversion && !showNumbers && conversionNeeds.length) {
    const box = boxOf(spec, conversionNeeds[0]);
    const sharedBox = conversionNeeds.every((n) => boxOf(spec, n) === box && typeof spec.numbers[n]?.component === "number");
    const vals = conversionNeeds.map((n) => Number(read[n]));
    if (sharedBox && vals.every((v) => Number.isFinite(v))) {
      const from = `from '${boxLabel(spec, conversionNeeds[0])}'`;
      const parts = conversionNeeds.map((n, i) => `${reasonName(spec, n)} ${fmt(vals[i])}`).join(" x ");
      out.working.push(vals.length === 2
        ? `area: ${parts} mm = ${fmt(Number((vals[0] * vals[1] / 1e6).toFixed(6)))} sq.m (${from})`
        : `${parts} mm = ${fmt(Number((vals[0] / 1000).toFixed(6)))} m (${from})`);
    }
  }
  // ADP-1 (owner H3 (c): a 1- or 4-slot row "refuse"): a NEEDED number declaring `not_stocked` whose value none of the
  // family's SKUs in the target unit carries refuses with that sentence, before the SKU match could name every fact
  for (const n of needs) {
    const rd = spec.numbers[n];
    if (!rd?.not_stocked || !(n in sel)) continue;
    const rows = projected.filter((it) => it.kind === spec.kind && it.attributes[familyAttr(spec)] === family && it.attributes[spec.unit_class_attr] === target && n in it.attributes);
    if (!rows.length || rows.some((it) => sameValue(it.attributes[n], sel[n]))) continue;
    // ADP-3a (U4, N-slot): the refusal is about THIS field -- the panel outlines it and names it under the box
    return { ...blank(rd.not_stocked.replace("{value}", fmt(Number(sel[n])))), selection: sel, defaulted: out.defaulted, refusedFor: n };
  }

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
      const facts = Object.entries(where).filter(([k]) => k !== familyAttr(spec) && k !== spec.unit_class_attr).map(([k, v]) => plainFactOf(spec, k, v, family));
      return { ...blank(noSkuSentence(family, facts)), selection: sel };
    }
    // SLICE 12c: a stated value and a rung that are the SAME size written to different precision are
    // not a miss. Resolving FIRST matters: without it, 22.2 would ladder UP to 28.58 and buy a size the
    // row never asked for. ABSENT `size_match` => `matched` is null and the ladder decides, as before.
    const sizes = rungs.map((r) => r.size);
    let matched = resolveSize(want, sizes, spec.size_match);
    /**
     * SLICE 12e-2 (owner Q14 / Q14a, 2026-10-10) -- THE LADDER'S TWO EXTRA RUNGS, each by key presence.
     *   `inch_mm_alt`     the SECOND inch conversion is tried at the same rounding depths after the exact one
     *                     lands on no rung (4 inch: 101.6 is nothing, 100 is MS 100);
     *   `size_match.near` after both, the NEAREST rung within `near` of the stated value counts as it
     *                     (1-1/4" = 31.75 -> the sheet's own 31.7).
     * Both are confined to the config that declares them: ADP and Insulation carry neither key, and `how`
     * is written only when a declaring key took part, so every existing hop and line is byte-identical.
     */
    const altRead = altReads[attr];
    let how: LadderHop["how"] | undefined;
    if (matched) how = matched.exact ? "exact" : "precision";
    if (!matched && altRead) {
      const viaAlt = resolveSize(altRead.alt, sizes, spec.size_match);
      if (viaAlt) { matched = { ...viaAlt, exact: false }; how = "alt"; }
    }
    /**
     * SLICE 12e-4b (owner F-1, 2026-10-13, "option B"): the SAME nearest-rung rule, declared for ONE axis
     * (`numbers.<axis>.near`) where a category wants it on that axis alone -- Insulation's pipe size, so a pipe
     * read as 22.3 is the sheet's 22.23 and no longer buys the next size up, while its thickness ladder is
     * untouched. The axis key wins over the category one; where it is the one that matched, the working line
     * says how close the rule allows ("... on the sheet (within 0.1 mm)").
     */
    const axisNear = spec.numbers[attr]?.near;
    const near = typeof axisNear === "number" ? axisNear : spec.size_match?.near;
    let nearOnAxis = false;
    if (!matched && typeof near === "number" && near > 0) {
      for (const cand of [want, ...(altRead ? [altRead.alt] : [])]) {
        const r = nearestRung(cand, sizes, near);
        if (r !== null) { matched = { rung: r, dp: -1, exact: r === cand }; how = "near"; nearOnAxis = typeof axisNear === "number"; break; }
      }
    }
    if (matched && !matched.exact) {
      // ⚠️ THE SELECTION MUST TAKE THE RUNG, NOT THE STATED VALUE. The ladder only rewrites `sel` when it
      // moves a value UP, so a resolved value would otherwise stay as written -- and `sel` is what the SKU
      // match is built from, so the row would look resolved on screen and match nothing underneath.
      sel[attr] = matched.rung;
      out.working.push(how === "alt" && altRead
        ? `${name} ${fmt(want)} (${altRead.raw}) is ${fmt(matched.rung)} on the sheet at ${fmt(spec.numbers[attr]?.inch_mm_alt ?? 25)} mm to the inch`
        : `${name} ${fmt(want)} is ${fmt(matched.rung)} on the sheet${nearOnAxis ? ` (within ${fmt(near as number)} ${spec.numbers[attr]?.unit ?? "mm"})` : ""}`);
    }
    /**
     * SLICE 12e-4b (owner F-3, 2026-10-13: "this should refuse pricing if we cant determine the size/ unit
     * correctly"; ruled in the run: "could be inches" = the number x 25.4 OR x 25 lands within the type's stocked
     * range, smallest to largest). A BARE number -- no unit written with it -- that is BELOW the smallest stocked
     * size and COULD BE AN INCH SIZE is not priced as the smallest size: nobody can tell whether "1" is one
     * millimetre or one inch. It refuses with one sentence. The same number with its unit ("1 inch", "1 mm"),
     * a number at or above the smallest size, and a small number whose inch reading falls outside the stocked
     * range (MS 15: 381 mm) all price exactly as before. The rule rides on keys the axis already declares --
     * it reads inches two ways (`inch_mm_alt`) and rules below-the-smallest (`size_match.below_smallest`) -- so
     * no other category reaches it; the test is the text the pricer or the model wrote, never the row around it.
     * SLICE 12e-6c (owner U2, 2026-10-18: "apply F-3 ... to every axis with inches: true, testing x25.4 / x25 as
     * ruled. No config key, no wording change, no second conversion"): the rule is the AXIS's -- any axis that reads
     * inches (`f3Axis`) -- so Insulation's pipe size refuses a bare "1" exactly as Piping's does. The x25 test is the
     * ruling's own (`F3_INCH_ALT` where the axis declares no `inch_mm_alt`); it is a test, never a ladder conversion.
     */
    const inchAlt = f3InchAlt(spec, attr);
    if (!matched && inchAlt !== null && want < rungs[0].size) {
      const written = (spec.numbers[attr]?.from ?? []).map((src) => rawValue(item, src)).find((v) => v !== null);
      // ... or the size TAKEN from a pair / list that carried no unit ("8/7"): the same question, the same answer
      // (owner, in the run: "the size taken from a pair or list goes through the same F-3 check as a bare number")
      const bare = unitlessLists.has(attr)
        || (written !== undefined && written !== null && BARE_NUMBER_RE.test(withoutTrailingPunctuation(String(written))));
      const lo = rungs[0].size, hi = rungs[rungs.length - 1].size;
      const couldBeInches = [want * 25.4, want * inchAlt].some((mm) => mm >= lo && mm <= hi);
      // ADP-1 (owner F1): on an axis declaring it, a bare number whose every inch reading is ABOVE the largest refuses too
      // ... and never on a size MIRRORED from the pipe above, which is that pipe's reading in mm (its unit was read there)
      const mirroredCell = (spec.numbers[attr]?.from ?? []).some((src) => item.attributes?.[src]?.mirrored === true);
      const aboveAsInches = spec.numbers[attr]?.bare_above_largest === "refuse" && !mirroredCell && [want * 25.4, want * inchAlt].every((mm) => mm > hi);
      if (bare && (couldBeInches || aboveAsInches)) return { ...blank(noUnitMessage(fmt(want))), selection: sel, sizeRefused: attr };
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
        return { ...out, selection: { ...sel }, composeInto: { attr, stated: want, layers: [...comp.layers].sort((a, b) => a - b), delta: comp.delta, top: top.size, ...pipeAsReadOf() } };
      }
      // SLICE 12e-6 (AC9 b): the axis is named, so a section taking its size from it repeats this sentence (12e-4d AC2)
      return { ...blank(`${name} ${fmt(want)} is above the largest size on the sheet (${fmt(top.size)})`), selection: sel, sizeRefused: attr };
    }
    resolvedLadders.add(attr);
    // SLICE 12e-2: `how` is written ONLY where a declaring key is present (owner Q17 / Q11 / Q14 / Q14a)
    // SLICE 12e-6c (owner U1, 2026-10-18: "make typed_entry control only the typed one-size rule, not the 12e-2
    // wording"): `typed_entry` no longer declares. Piping keeps its wording through its other keys; Insulation's pipe
    // size gains the typed rule with every line it had.
    const declares = !!(spec.numbers[attr]?.inch_mm_alt
      || spec.size_match?.near !== undefined || spec.size_match?.below_smallest !== undefined);
    if (declares && how === undefined) how = fit.exact ? "exact" : (want < rungs[0].size ? "smallest" : "up");
    // SLICE 12e-4d (owner, 2026-10-14: "fix"; AC3): ONE wording for the size step on the field's line and the
    // working line -- below the smallest stocked size both say "(the smallest size)", between two stocked sizes
    // both say "(next size up)". Wording only: the rung bought is the same.
    const belowSmallest = !fit.exact && want < rungs[0].size;
    out.ladderHops.push({ attr, name, requested: want, fitted: fit.modules, exact: fit.exact,
      ...(declares ? { how, ...(altRead ? { raw: altRead.raw, alt: altRead.alt } : {}) } : {}),
      ...(severalReads[attr] ? { several: severalReads[attr] } : {}),
      ...(!declares && belowSmallest ? { belowSmallest: true as const } : {}) });
    if (!fit.exact) {
      out.working.push(`${name} ${fmt(want)} is not on the sheet -> ${fmt(fit.modules)} (${belowSmallest ? "the smallest size" : "next size up"}, R6)`);
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
  // ADP-2 (owner H5, U3): a default a stated fact decided names that fact first -- "supply air, damper not mentioned
  // -> with damper" -- and every ruled default reads exactly as before
  for (const d of out.defaulted) out.working.push(`${d.when ? `${d.when.equals} ${d.when.attr}, ` : ""}${d.attr} not mentioned -> ${d.value} (${d.rule})`);

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
  // SLICE 12e-5b (owner R7): the outer layer of a composition -- ONE cladding wrap over the whole stack. A copy of
  // the selection carries the outer diameter, so the SKU match and `out.selection` never see it, and the config's
  // `girth_step` replaces the step producing the same result for this run only.
  const os = spec.compose?.outer_surface;
  let runSel = sel;
  let wrapStep: PipelineStep | null = null;
  if (os && outerWrap && sel[os.pipe] !== undefined && sel[os.thickness] !== undefined) {
    const ps = Number(sel[os.pipe]);
    if (Number.isFinite(ps)) {
      const asRead = typeof outerWrap.pipeAsRead === "number" && Number.isFinite(outerWrap.pipeAsRead);
      const pipe = asRead ? (outerWrap.pipeAsRead as number) : ps;
      const od = pipe + 2 * outerWrap.total;
      runSel = { ...sel, [os.attr]: od };
      wrapStep = os.girth_step;
      // SLICE 12e-6 (AC1, owner R7): every size that is not an outside diameter is "as matched" -- mm = NB
      const how = asRead ? "as read" : outerWrap.pipeMatched ? "as matched (mm = NB, not an outside diameter)" : "as matched (the size as read is not available)";
      out.working.push(`cladding: ONE wrap over the outer surface -- pipe size ${how} ${fmt(pipe)} + 2 x ${fmt(outerWrap.total)} (the total thickness) = ${fmt(od)} mm`);
    }
  } else if (os && !outerWrap && sel[os.pipe] !== undefined && sel[os.thickness] !== undefined) {
    /**
     * SLICE 12e-5b2 (owner R6: "use the original size everywhere"): a SINGLE layer's cladding is measured on the
     * pipe size AS READ too, not on the size it was matched to -- the same `girth_step` over the same outer
     * diameter, with the one layer's thickness. Only where a cladding is on the item (not the `outer_only`
     * value) and the size as read differs from the matched one by more than the 0.1 mm match; everything else
     * keeps the step it always ran, so an exact or spelling-only match is byte-identical. A catalogue row (the
     * Derivation tab, the impact panel) carries no size as read and never reaches this branch.
     */
    const ps = Number(sel[os.pipe]);
    const t = Number(sel[os.thickness]);
    const where = pipeAsReadOf();
    const asRead = where.pipeAsRead;
    const oo = spec.compose?.outer_only;
    const clad = !oo || (sel[oo.attr] !== undefined && sel[oo.attr] !== oo.value);
    const stated = read[os.pipe];
    if (clad && Number.isFinite(ps) && Number.isFinite(t) && typeof asRead === "number" && Math.abs(asRead - ps) > 0.1) {
      const od = asRead + 2 * t;
      runSel = { ...sel, [os.attr]: od };
      wrapStep = os.girth_step;
      out.working.push(`cladding: measured on the pipe size as read ${fmt(asRead)} (not the ${fmt(ps)} it was priced at) + 2 x ${fmt(t)} (the thickness) = ${fmt(od)} mm`);
    } else if (clad && Number.isFinite(ps) && where.pipeMatched && typeof stated === "number" && Math.abs(stated - ps) > 0.1) {
      // SLICE 12e-6 (AC1, owner R7 / U1): the config's own girth step, on the matched size -- the line says so
      out.working.push(`cladding: measured on the matched size ${fmt(ps)} (mm = NB: the size as read, ${fmt(stated)}, is not an outside diameter)`);
    } else if (clad && Number.isFinite(ps) && asRead === undefined && !where.pipeMatched) {
      out.working.push(`cladding: measured on the pipe size as matched ${fmt(ps)} (the size as read is not available)`);
    }
  }
  const wrapped = (pl: Pipeline): Pipeline => {
    if (!wrapStep) return pl;
    const ws = wrapStep as PipelineStep & { result?: string };
    return { ...pl, steps: pl.steps.map((st) => ((st as { step?: string; result?: string }).step === ws.step && (st as { result?: string }).result === ws.result ? ws : st)) };
  };
  for (const [id, pl] of Object.entries(pipelines)) {
    const r = runPipeline(id, wrapped(pl), candidates, runSel);
    results.push(r);
    if (r.status !== "ok") {
      return { ...blank(reasonFromPipeline(spec, family, sel, r, familyRows)), selection: out.selection, ladderHops: out.ladderHops, working: out.working, pipelineResults: results, conversion: out.conversion, defaulted: out.defaulted, sku: r.matchedItem ? skuOf(r.matchedItem) : null };
    }
    for (const o of pl.output) {
      const v = r.finals[o];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        return { ...blank(reasonFromPipeline(spec, family, sel, r, familyRows)), selection: out.selection, ladderHops: out.ladderHops, working: out.working, pipelineResults: results, conversion: out.conversion, defaulted: out.defaulted, sku: r.matchedItem ? skuOf(r.matchedItem) : null };
      }
      finals[o] = v;
    }
    if (!out.sku && r.matchedItem) out.sku = skuOf(r.matchedItem);
    // ADP-1 (owner H4 / U4): a geometry step of a `show_numbers` option also writes its arithmetic with the numbers
    const scaleDefs = showNumbers ? pl.steps.filter((s) => (s as { step?: string }).step === "scale") : [];
    let scaleAt = 0;
    let before: Record<string, unknown> = {};
    for (const st of r.steps) {
      if (st.produced) out.working.push(`${id}: ${claddingLabel(st)} = ${fmt(st.produced.value)}`);
      if (showNumbers && st.step === "scale") {
        const def = scaleDefs[scaleAt++] as { target?: string; formula?: string; params?: Record<string, unknown> } | undefined;
        const line = def && st.produced ? numbersLine(def, before, runSel) : null;
        if (line !== null) out.working.push(`${id}: ${line} = ${fmt(st.produced!.value)}`);
      }
      before = (st as { runningValues?: Record<string, unknown> }).runningValues ?? before;
    }
  }
  // (6b) SLICE 11 (owner ruling, 2026-09-25) -- THE ROW UNIT'S CONVERSION FACTOR. The catalogue quotes this
  // class's rate in the class's own unit; the row is billed in a DIFFERENT unit of the same class. THE RATE IS
  // CONVERTED, NEVER THE QUANTITY: the class's rate x the factor, then today's rounding (the same ROUNDUP the
  // pipeline's last step applies), supply and install alike. It runs AFTER the pipeline so a declared family
  // `convert` option (R4 / R11 / R16) has already done its work and this composes on top of it.
  if (unitFactor) {
    // ADP-3a (U6): the rate BEFORE and AFTER the factor, per kind -- the line said only what was done
    const beforeFactor = { ...finals };
    for (const k of Object.keys(finals)) finals[k] = Math.ceil(finals[k] * unitFactor.factor);
    const each = Object.keys(finals).map((k) => `${k} ${fmt(beforeFactor[k])} -> ${fmt(finals[k])}`).join("; ");
    out.working.push(`per ${unitFactor.word}: ${unitWord(spec, unitFactor.class)} rate x ${unitFactor.factor}${each ? ` (${each})` : ""}`);
  }
  const figures: Record<string, number> = {};
  for (const [k, v] of Object.entries(finals)) figures[k] = v * qty;
  if (qty !== 1) out.working.push(`x ${fmt(qty)} per row unit`);
  return { ...out, state: "priced", finals, figures, pipelineResults: results };
}

/**
 * SLICE 12e-6 (AC9 c, owner U7). The cladding component's working line names ONLY the parts priced. The config's one
 * label -- "cladding: (aluminium sheet x overlap + glass cloth) x girth" -- serves every cladding of the per-metre
 * families, and the condition that fired zeroes the parts this cladding does not have: Glass Cloth with paint carries
 * no sheet ("cladding: glass cloth x girth"), a bare aluminium sheet no cloth ("cladding: aluminium sheet x overlap x
 * girth"). Both parts, or neither (no cladding), keep the config's label. Every other step's label is untouched. PURE.
 */
/**
 * ADP-1 (owner H4 / U4: "working lines show the area formula with the numbers and the + 150 on supply"). PURE. A
 * `scale` step's formula written with its numbers -- `base` is the step's target before it ran, `<x>_from_attr` the
 * selection's value, `<x>_from_ctx` the running value (a Pricing Input), a number param itself -- in the working's
 * words ("x", "/ 10^6"). Null where the step reads no geometry (`_from_attr`), so a markup step adds no line, or where
 * a number is missing.
 */
export function numbersLine(
  def: { target?: string; formula?: string; params?: Record<string, unknown> },
  before: Record<string, unknown>,
  sel: Record<string, string | number>,
): string | null {
  const params = def.params ?? {};
  if (!Object.keys(params).some((k) => k.endsWith("_from_attr"))) return null;
  const env: Record<string, number> = {};
  const base = before[String(def.target)];
  if (typeof base !== "number" || !Number.isFinite(base)) return null;
  env.base = base;
  for (const [k, v] of Object.entries(params)) {
    if (k.endsWith("_from_attr")) {
      const x = Number(sel[String(v)]);
      if (!Number.isFinite(x)) return null;
      env[k.slice(0, -"_from_attr".length)] = x;
    } else if (k.endsWith("_from_ctx")) {
      const x = before[String(v)];
      if (typeof x !== "number" || !Number.isFinite(x)) return null;
      env[k.slice(0, -"_from_ctx".length)] = x;
    } else if (typeof v === "number") {
      env[k] = v;
    }
  }
  return String(def.formula ?? "")
    .replace(/\/\s*1000000(?![0-9])/g, " / 10^6")
    .replace(/[A-Za-z_][A-Za-z0-9_]*/g, (id) => (id in env ? fmt(env[id]) : id))
    .replace(/\s*\*\s*/g, " x ").replace(/\s*\+\s*/g, " + ").replace(/\s*-\s*/g, " - ")
    .replace(/\(\s*/g, "(").replace(/\s*\)/g, ")").replace(/\s+/g, " ").trim();
}

const BOTH_PARTS_LABEL = "cladding: (aluminium sheet x overlap + glass cloth) x girth";
export function claddingLabel(st: { step: string; label: string; params?: Record<string, string | number> }): string {
  if (st.step !== "component" || !st.label.startsWith(BOTH_PARTS_LABEL) || !st.params) return st.label;
  const rest = st.label.slice(BOTH_PARTS_LABEL.length);
  const sheet = st.params.al !== 0 && "al_from_ctx" in st.params;
  const cloth = st.params.gc !== 0 && "gc_from_ctx" in st.params;
  if (sheet && !cloth) return `cladding: aluminium sheet x overlap x girth${rest}`;
  if (cloth && !sheet) return `cladding: glass cloth x girth${rest}`;
  return st.label;
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
 * SLICE 12e-6 (owner R2 / R3, 2026-10-16). PURE. The families ONE item may be priced as when the BoQ allows two STOCKED
 * ones, or null:
 *   R2 (a config reading pipe types, `family_text.from_row`): NO type answered, and the row's own words -- else the type
 *      as written -- name two different stocked types ("CPVC / UPVC" -> CPVC, PVC);
 *   R3 (a config naming the material as written, `no_sku_named_by`): the material as written offers two stocked
 *      families as alternatives ("open-cell acoustic foam / 32 kg fiberglass board").
 * A family the PRICER picked is never second-guessed (the caller's test).
 */
export function cheaperAlternatives(
  spec: ItemListPricingSpec, item: ExtractedListItem, ownText: string, rowUnitClass: string | null,
): { families: string[]; said: string; pipes?: true; fromAnswer?: true } | null {
  const fr = spec.family_text?.from_row;
  const answered = rawValue(item, familyAttr(spec));
  const refused = (text: string) => (spec.family_text?.refuse ?? []).some((r) => wordStartHit(text, [r.from]) !== null);
  // the answer ITSELF names two stocked types ("uPVC/ CPVC" in the type box, typed or read): the same rule as the
  // words as written, so a word typed and the same word read never price differently (12e-4b D-3's parity)
  if (fr && answered !== null && answered !== "None" && !spec.families[String(answered)]) {
    const t = String(answered);
    const words: Array<{ word: string; family: string }> = [
      ...Object.keys(spec.families).map((f) => ({ word: f, family: f })),
      ...(spec.family_text?.map ?? []).map((m) => ({ word: m.from, family: m.to })),
    ];
    const at = (w: string) => t.toLowerCase().indexOf(w.toLowerCase());
    const found = words.filter((w) => wordStartHit(t, [w.word]) !== null).sort((x, y) => at(x.word) - at(y.word));
    const families = [...new Set(found.map((f) => f.family))].filter((f) => !!spec.families[f]);
    if (families.length >= 2 && !refused(t)) return { families, said: found.map((f) => f.word).join(" or "), pipes: true, fromAnswer: true };
    return null;
  }
  if (fr && (answered === null || answered === "None")) {
    const several = (text: string): { families: string[]; named: string[] } | null => {
      if (!text.trim()) return null;
      const words: Array<{ word: string; family: string }> = [
        ...Object.keys(spec.families).map((f) => ({ word: f, family: f })),
        ...(spec.family_text?.map ?? []).map((m) => ({ word: m.from, family: m.to })),
      ];
      // in the order the BoQ writes them ("MS / Copper" -> "MS or Copper")
      const at = (w: string) => text.toLowerCase().indexOf(w.toLowerCase());
      const found = words.filter((w) => wordStartHit(text, [w.word]) !== null).sort((x, y) => at(x.word) - at(y.word));
      const families = [...new Set(found.map((f) => f.family))].filter((f) => !!spec.families[f]);
      return { families, named: found.map((f) => f.word) };
    };
    const own = several(ownText);
    if (own && own.families.length >= 2) return { families: own.families, said: own.named.join(" or "), pipes: true };
    if (own && own.families.length === 1) return null;
    const w = spec.family_text?.from_attr ? rawValue(item, spec.family_text.from_attr) : null;
    const word = w !== null && w !== "None" ? String(w) : "";
    const fromWord = several(word);
    if (fromWord && fromWord.families.length >= 2 && !refused(word)) {
      return { families: fromWord.families, said: fromWord.named.join(" or "), pipes: true };
    }
    return null;
  }
  if (spec.no_sku_named_by) {
    const w = rawValue(item, spec.no_sku_named_by);
    const alt = w !== null && w !== "None" ? alternativeMaterials(spec, String(w), rowUnitClass) : null;
    if (alt && alt.kind === "both") return { families: alt.families, said: alt.clause };
  }
  return null;
}

/**
 * SLICE 12e-6 (R2 / R3): price ONE item; where the BoQ allows two stocked families, price each as answered and keep
 * the CHEAPER for this row's size and thickness (supply + install, a composition's layers summed), with the amber line
 * "BoQ allows CPVC or uPVC -> priced as PVC, the lower cost". The person switches it with the family control (a pick
 * is the pricer's and is never second-guessed). None of them prices -> the item as it was (its own refusal stands).
 */
const CPVC = "CPVC";
const PVC = "PVC";
function priceOneItemOrCheaper(
  spec: ItemListPricingSpec, projected: RateMasterItem[], rowUnitClass: string, item: ExtractedListItem, index: number,
  unitFactor: UnitFactor | null, rowText: string, ownText: string, odHint: boolean | undefined, headingNoteText = "",
): ItemPriceResult {
  const fa = familyAttr(spec);
  const typed = item.attributes?.[fa]?.typed === true;
  const found = cheaperAlternatives(spec, item, ownText, rowUnitClass);
  // a PICK the pricer made is theirs; a word they TYPED naming two types reads exactly as the same word read off the BoQ
  const alts = found && (!typed || found.fromAnswer) ? found : null;
  if (!alts) return priceOneItem(spec, projected, rowUnitClass, item, index, unitFactor, rowText, ownText, undefined, odHint, headingNoteText);
  const said = (line: string) => (typed ? typedFamilyLine(line) : line);
  const as = (f: string): ExtractedListItem => ({ ...item, attributes: { ...item.attributes, [fa]: { value: f } } });
  const costOf = (r: ItemPriceResult, f: string): number | null => {
    if (r.composeInto) {
      const c = r.composeInto;
      const oo = spec.compose?.outer_only;
      let total = 0;
      for (let li = 0; li < c.layers.length; li++) {
        const attrs: ExtractedListItem["attributes"] = { ...as(f).attributes, [c.attr]: { value: c.layers[li] } };
        if (oo && li < c.layers.length - 1) attrs[oo.attr] = { value: oo.value };
        const layer = priceOneItem(spec, projected, rowUnitClass, { ...item, attributes: attrs }, index, unitFactor, rowText, ownText, undefined, odHint, headingNoteText);
        if (layer.state !== "priced") return null;
        total += (layer.figures.supply ?? 0) + (layer.figures.install ?? 0);
      }
      return total;
    }
    return r.state === "priced" ? (r.figures.supply ?? 0) + (r.figures.install ?? 0) : null;
  };
  /**
   * OWNER RULING 2026-10-16 14:22 IST (amends R2): "when both CPVC and PVC or uPVC pipes are mentioned together then we
   * should quote for CPVC. this overrides my earlier rule for lesser price item selection." CPVC named with PVC / uPVC
   * -> CPVC, whatever it costs; every other pair of stocked pipe types keeps the cheaper.
   */
  if (alts.pipes && alts.families.includes(CPVC) && alts.families.includes(PVC)) {
    const r = priceOneItem(spec, projected, rowUnitClass, as(CPVC), index, unitFactor, rowText, ownText, undefined, odHint, headingNoteText);
    const line = said(`BoQ allows ${alts.said} -> priced as ${CPVC}`);
    return { ...r, familyRaw: rawValue(item, fa) === null ? null : String(rawValue(item, fa)), familyLine: line, working: r.composeInto ? r.working : [line, ...r.working], alternativeChosen: CPVC };
  }
  let best: { f: string; r: ItemPriceResult; cost: number } | null = null;
  for (const f of alts.families) {
    const r = priceOneItem(spec, projected, rowUnitClass, as(f), index, unitFactor, rowText, ownText, undefined, odHint, headingNoteText);
    const cost = costOf(r, f);
    if (cost !== null && (best === null || cost < best.cost)) best = { f, r, cost };
  }
  if (!best) return priceOneItem(spec, projected, rowUnitClass, item, index, unitFactor, rowText, ownText, undefined, odHint, headingNoteText);
  const line = said(`BoQ allows ${alts.said} -> priced as ${best.f.trim()}, the lower cost`);
  const working = best.r.composeInto ? best.r.working : [line, ...best.r.working];
  return { ...best.r, familyRaw: rawValue(item, fa) === null ? null : String(rawValue(item, fa)), familyLine: line, working, alternativeChosen: best.f };
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
  /** SLICE 12d-1a (owner R2): the row's own text and its headings, joined -- read by `family_when_none`'s word
   * rules and (12e-6) by AC1's copper words and AC2's "is a material named". Absent => only the unit class can
   * decide a silent family. */
  rowText: string = "",
  /** SLICE 12d-4a (owner D3 / D7 / D9b): the row's OWN text (description + own notes, never a heading).
   * Absent (the calculator) => the word rules never match. */
  ownText: string = "",
  /** SLICE 12e-6 (AC1): the section pass's word on the pipe above (see `priceOneItem`'s `odHint`). */
  odHint?: boolean,
  /** ADP-5a (HN-2): the notes of the row's headings, for the both-streams check only (see `priceOneItem`). */
  headingNoteText: string = "",
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
    // SLICE 12e-5b (owner R5): a material the catalogue prices as one of its families is not "unstocked" here either
    const first = extracted && extracted.length ? extracted[0] : null;
    const firstFamily = first ? rawValue(first, familyAttr(spec)) : null;
    const mapped = first ? materialTextFor(spec, firstFamily === null ? null : String(firstFamily), first, null) : null;
    const material = first && !mapped ? namedMaterialRefusal(spec, first, ownText) : null;
    if (material !== null) return { unit, unitClass: null, priced: false, reason: material, items: [] };
    // SLICE 12e-2 (owner Q19 / C2): a config declaring `unit_refusal` names the unit in ITS sentence
    // ("unit 'nos' is not a length unit"); every other category keeps the R12 sentence byte-for-byte.
    // ADP-3a (owner 2026-10-20 13:35, U5): an unrecognised unit ("Lot", "Nos/Ro") refuses the same way a unit the
    // family is not stocked in does -- naming the unit and the unit(s) each item IS stocked in. Where no item names a
    // family the catalogue knows, the category's own sentence stands (`unit_refusal`, else R12).
    const stockedBy = [...new Set((extracted ?? []).map((it) => rawValue(it, familyAttr(spec))).filter((f): f is string => typeof f === "string" && !!spec.families[f]))]
      .map((f) => ({ f, words: stockedUnitsWords(spec, f) })).filter((x) => x.words);
    const reason = unit.trim() === ""
      ? "no unit on this row (R12)"
      : stockedBy.length
        ? `${stockedBy.map((x) => `${x.f} is not stocked per '${unit.trim()}' (stocked ${x.words})`).join("; ")} - price this row by hand`
        : spec.unit_refusal
          ? spec.unit_refusal.replace("{unit}", unit.trim())
          : `unit '${unit.trim()}' is not a count, area or length unit (R12)`;
    return { unit, unitClass: null, priced: false, reason, items: [] };
  }
  if (!extracted || !extracted.length) {
    return { unit, unitClass: cls, priced: false, reason: "no items were read on this row", items: [], ...unitResolved(false) };
  }
  const projected = projectUnitClass(spec, items);
  // SLICE 11: computed ONCE from the row's unit TEXT (the class alone cannot say which unit of it this is).
  const unitFactor = unitFactorOf(spec, unit);
  let priced = extracted.map((it, i) => priceOneItemOrCheaper(spec, projected, cls, it, i, unitFactor, rowText, ownText, odHint, headingNoteText));
  // ADP-5a (SCOPE-5a-1): an item `applyFamilyMerge` priced as another family says so on the item, with the size it is
  // priced at where `at` resolved one ("... priced as one Butterfly Damper With Spigot, 200 mm")
  priced = priced.map((p, i) => {
    const m = extracted[i].merged;
    if (!m) return p;
    const at = m.at !== undefined ? p.selection[m.at] : undefined;
    const u = m.at !== undefined ? spec.numbers[m.at]?.unit : undefined;
    const line = typeof at === "number" ? `${m.line}, ${fmt(at)}${u ? ` ${u}` : ""}` : m.line;
    return { ...p, familyRaw: m.from, familyLine: line, working: [line, ...p.working] };
  });
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
        // SLICE 12e-5b (owner R7): the OUTER layer's cladding wraps the whole stack -- the pipe as read + 2 x the total
        const wrap = outer && spec.compose?.outer_surface
          ? { total: c.layers.reduce((a, b) => a + b, 0), ...(c.pipeAsRead !== undefined ? { pipeAsRead: c.pipeAsRead } : {}), ...(c.pipeMatched ? { pipeMatched: true as const } : {}) }
          : undefined;
        // SLICE 12e-6 (R2 / R3): a layer prices the family the cheaper-alternative choice settled on, as answered
        const layerAttrs = p.alternativeChosen ? { ...attrs, [familyAttr(spec)]: { value: p.alternativeChosen } } : attrs;
        const one = priceOneItem(spec, projected, cls, { ...src, attributes: layerAttrs }, expanded.length, unitFactor, rowText, ownText, wrap, odHint, headingNoteText);
        if (p.alternativeChosen && p.familyLine) { one.familyLine = p.familyLine; if (li === 0) one.working.unshift(p.familyLine); }
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
  /** SLICE 12e-2 (owner Q10): a `panel_optional` text box -- shown, typeable, never mandatory, never matched;
   * a `read_notes` line may quote it. Absent on every field the pricing reads. */
  optional?: true;
  /** SLICE 12e-3a (owner 13:40): this field is a section's `include_when` toggle -- a Yes / No the pricing
   * never reads; `equals` is the value that opens section `section` under the item. Absent on every other field. */
  gate?: { section: string; equals: string };
  /** ADP-2 (owner H7, U1): the plain label of an EITHER-OR group of fields -- "Area, or all three of Length, Width,
   * Height" -- on every field of a family whose rule for the row's unit offers several ways to price it.
   * ADP-3a (owner H2, U2): every multi-way rule now carries one ("Size (W x H), or Area band"; "Neck size, or Outer
   * size"), and a field in a group carries no "*" -- the group label says one way is needed. Absent everywhere else. */
  group?: string;
  /** ADP-3a (owner H1, U1): the field is NEEDED TO PRICE this family on this row's unit -- a need with no ruled
   * default, outside any either-or group. Decided here, from the same needs `priceOneItem` reads, so the "*" and
   * the refusal can never disagree. Absent on an optional, defaulted, grouped or never-read field. */
  required?: true;
  /** ADP-3a (U3 / U4): every SKU attribute this ONE box feeds -- a size box feeds width AND height ("600x300"),
   * so a refusal naming either side outlines this box. Present on a number field only. */
  axes?: string[];
  /** ADP-3a (U2, B6 #5): this is the OUTER size of a `second_key` family (the square diffuser), shown beside the
   * neck it can stand in for. Absent on every other field. */
  secondKey?: true;
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
  /**
   * SLICE 12d-8 (owner R4 option (b), 2026-10-09): a value the config MAPS onto a stocked one is offered
   * too -- "Aluminium Foil" on Nitrile Rubber / Tubular PUF, which `value_map` prices as 26G Aluminium with
   * its own line. DERIVED from config, never a word written here: every `value_map` entry on this attribute
   * whose `to` is among the options this family's SKUs give, for a family the entry names. An entry that
   * REFUSES (foil on Acoustic Nitrile) has no `to` and adds nothing, and a family the entry does not name
   * (the sheet families, glass cloth) is untouched -- their lists stay exactly as the SKUs give them.
   */
  for (const rule of spec.value_map ?? []) {
    if (rule.attr !== attr || rule.to === undefined || !rule.families.includes(family)) continue;
    if (!seen.has(rule.to) || seen.has(rule.from)) continue;
    seen.add(rule.from); out.push(rule.from);
  }
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
  /**
   * ADP-4a (owner AC2, 2026-10-21; "display-side only"): A FIELD'S LABEL AS A PRICER READS IT. The definition's label
   * is also the MODEL's question (`extraction.build_items_spec` sends it), so it is never changed in the config; here
   * the model's " (as written)" is dropped, and a box whose reader takes SEVERAL model fields (ADP's plenum thickness
   * reads the insulation thickness first, then the sheet thickness) is named by the reader itself -- "Plenum thickness
   * (mm)", owner 2026-10-21 -- never by whichever model field happens to come first. Measured: no Insulation or Piping
   * label carries " (as written)" and no other reader reads two fields, so their labels are byte-identical.
   */
  const shownLabel = (label: string | undefined, reader?: NumberReader): string | undefined => {
    if (reader && reader.from.length > 1) {
      const n = reader.name.charAt(0).toUpperCase() + reader.name.slice(1);
      return reader.unit ? `${n} (${reader.unit})` : n;
    }
    return label === undefined ? undefined : label.replace(/\s*\(as written\)\s*$/i, "");
  };
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
      // ADP-1: a `typed_only` box has no list_spec definition -- its label is the reader's own
      const d = defById.get(modelId) ?? (reader.label ? { id: modelId, label: reader.label, type: "text" } as ListSpecDef : undefined);
      const control = controlOf(attr, "text");
      // ADP-3a (U3 / U4): every axis THIS box feeds on this row -- a refusal naming any of them is about this box
      const axes = [...new Set(ids.filter((x) => spec.numbers[x]?.from[0] === modelId))];
      if ((control === "dropdown" || control === "dropdown_or_other") && skus) {
        // a STOCKED size: the options are the sheet's sizes for this family, narrowed by the block's other answers.
        // OWNER FA8: `dropdown_or_other` offers those SAME live options and still lets a person type the size the
        // BoQ states -- the ladder then resolves it and says which stocked size it used.
        const options = fieldOptionsFromSkus(spec, skus.items, family, rowUnitClass, attr, skus.answers ?? {});
        const typedNote = typedFieldNote(spec, attr, reads, options);
        out.push({ id: modelId, label: shownLabel(d?.label, reader) ?? reader.name, allowNone: false, skuAttr: attr, control, options,
                   optionSource: "catalogue", axes,
                   ...(control === "dropdown_or_other" ? { allowOther: true, typedNote } : {}) });
      } else {
        // ADP-3a (B6 #1): a size box of which this row reads only SOME parts (a per-metre grille reads the height of
        // "W x H") says which part, where the config's note does not -- "1200x150" is otherwise a puzzle
        const typedNote = typedFieldNote(spec, attr, reads, []) ?? partOfSizeNote(spec, modelId, axes);
        out.push({ id: modelId, label: shownLabel(d?.label, reader) ?? reader.name, allowNone: false, skuAttr: attr, control, axes,
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
      out.push({ id: attr, label: shownLabel(d.label) ?? d.label, allowNone: d.allow_none === true, skuAttr: attr, control,
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
    /**
     * SLICE 12e-2b (owner, 2026-10-10: "for attributes whose options are yes/no, with/without type both
     * values must be shown in the dropdown else it becomes confusing ... valid for all disciplines all
     * categories all attributes"; D1 (a): worked out from the list). A TWO-WAY field -- its list for this
     * family has exactly two values -- offers BOTH, in the definition's order, and is NOT narrowed: not by
     * another pick, not by a ruled default acting as one, not by the row's unit class. A picked pair the
     * catalogue does not stock refuses by name in the pricing ("No SKU for slot diffuser: without damper -
     * price this row by hand"). Every other field keeps narrowing (owner S1). Because the stale-pick rule
     * (`pricingSheetHelper.unstockedPicks`) asks this same function, a picked two-way value is never cleared.
     */
    const twoWay = twoWayValues(spec, attr, family);
    const base = twoWay ?? (fromSkus.length ? fromSkus : [...values]);
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
    /**
     * ADP-4a (owner register B5, 2026-10-19 14:34 / 14:41: "the 'None' option is no longer shown"; U5). On the plain
     * item wording "None" is not OFFERED either where no default maps it (the air stream): it is the model's word for
     * "not mentioned", and the field's own placeholder already means that. A STORED "None" is not changed -- the view
     * shows it as "not stated" (`pricingSheetHelper.itemBlockView`); what the model answers is ADP-5's.
     */
    const offerNone = d.allow_none && !noneMapsToCatalogue && !plainItemListWording(spec);
    out.push({
      id: attr,
      label: shownLabel(d.label) ?? d.label,
      options: offerNone ? ["None", ...base] : base,
      allowNone: d.allow_none === true,
      skuAttr: attr,
      control,
      ...(control === "dropdown_or_other"
        ? { allowOther: true, typedNote: typedFieldNote(spec, attr, reads, base) }
        : {}),
      optionSource,
    });
  }
  // ADP-3a (owner H2, U2; B6 #5): the OUTER size of a `second_key` family stands in for its neck, so it is SHOWN
  // beside the neck (it was read, and priced, behind a field nobody could see). One box for both of its axes.
  const sk = (spec.second_key ?? []).find((r) => r.families.includes(family));
  const outerName = sk ? sk.name.charAt(0).toUpperCase() + sk.name.slice(1) : "";
  // ADP-3b (owner D3): where the outer size's axes are their OWN typed face boxes (v49), it is two boxes, "Outer width
  // (mm)" and "Outer height (mm)", each filled from the size as written like every face box
  const faceKey = !!sk && sk.key.every((k) => !!spec.numbers[k]?.face_side && spec.numbers[k]?.from[0] === k);
  if (sk && ids.includes(sk.primary) && faceKey) {
    const lead = sk.name.replace(/\s*size$/i, "");
    for (const k of sk.key) {
      if (seenIds.has(k)) continue;
      seenIds.add(k);
      const side = spec.numbers[k]!.face_side!;
      out.push({ id: k, label: `${lead.charAt(0).toUpperCase() + lead.slice(1)} ${side} (mm)`, allowNone: false, skuAttr: k, control: "text", axes: [k], secondKey: true,
                 typedNote: `Type the ${lead} ${side} the BoQ states, in mm.` });
    }
  } else if (sk && ids.includes(sk.primary)) {
    const modelId = spec.numbers[sk.key[0]]?.from[0];
    if (modelId && !seenIds.has(modelId)) {
      seenIds.add(modelId);
      const name = sk.name.charAt(0).toUpperCase() + sk.name.slice(1);
      out.push({ id: modelId, label: name, allowNone: false, skuAttr: sk.key[0], control: "text", axes: [...sk.key], secondKey: true,
                 typedNote: `Type the ${sk.name} the BoQ states, in mm: width x height.` });
    }
  }
  // ADP-2 (owner H7, U1) -> ADP-3a (owner H2, U2): SEVERAL WAYS TO PRICE ONE FAMILY ON ONE UNIT ARE ONE EITHER-OR
  // CHOICE, whatever the config says about naming them. The group label is generated from the FIELDS each way reads
  // (no config text): one box feeding several sides is "Size (W x H)", several boxes are "all three of Length, Width,
  // Height" (ADP-2's words, byte for byte), one box for one fact is its own label -- the SAME helper the refusal
  // uses (`waysLabel`), handed the labels these fields carry so the two can never word one box two ways.
  const labelOfBox = (box: string) => out.find((f) => f.id === box)?.label;
  const eitherOr = fam.units[cls] ? [] : (fam.convert?.[cls] ?? []);
  const ways: string[][] = eitherOr.length > 1 ? eitherOr.map((o) => o.needs) : [];
  let group: string | undefined = ways.length > 1 ? waysLabel(spec, ways, labelOfBox) : undefined;
  if (sk && ids.includes(sk.primary) && out.some((f) => f.secondKey)) {
    // the neck OR the outer size (owner's words: "Neck size, or Outer size")
    ways.push([sk.primary], [...sk.key]);
    // ADP-3b (owner D3): the group keeps its name -- "Neck size, or Outer size" -- over the two outer boxes
    group = `${boxLabel(spec, sk.primary, labelOfBox)}, or ${faceKey ? outerName : out.find((f) => f.secondKey)!.label}`;
  }
  if (group) {
    const inGroup = new Set(ways.flat());
    for (const f of out) if ((f.axes ?? [f.skuAttr]).some((a) => inGroup.has(a)) || inGroup.has(f.skuAttr)) f.group = group;
    // ONE group on screen: its fields sit together, where the first of them sits (the cert found the square diffuser's
    // Air stream between Neck size and Outer size, which drew the group's heading twice)
    const first = out.findIndex((f) => f.group === group);
    const rest = out.filter((f) => f.group !== group);
    rest.splice(first, 0, ...out.filter((f) => f.group === group));
    out.splice(0, out.length, ...rest);
  }
  // ADP-3a (owner H1, U1): THE "*" -- a field needed to price this family on this unit. The needs are exactly the ones
  // `priceOneItem` asks for (the family's, the unit block's, the ONE conversion's); a need with a ruled default that
  // fills a BLANK (`defaults` with `absent_as_none`, `number_defaults`) is filled, not asked for -- a default that
  // fires only on a "not mentioned" answer (Insulation's cladding) still refuses a blank, so its field is needed; a
  // field in an either-or group is asked for by its group.
  const needed = new Set<string>([...fam.needs, ...(fam.units[cls]?.needs ?? []), ...(eitherOr.length === 1 ? eitherOr[0].needs : [])]);
  /**
   * ADP-4b (owner fix (a), 2026-10-21): a ruled default that THIS unit refuses fills nothing -- a slot diffuser per sq.m
   * whose blank damper defaults to "without" refuses (only the with-damper SKU is stocked), so its Damper is needed
   * and carries the "*". Read from the same `refuse_on_unit_class` rule `priceOneItem` refuses by.
   */
  const refusedHere = (a: string, v: string): boolean => (spec.refuse_on_unit_class ?? []).some((r) =>
    r.unit_class === cls && (r.families ?? []).includes(family) && r.attr === a
    && v.toLowerCase().includes(String(r.value_contains ?? "").toLowerCase()) && String(r.value_contains ?? "") !== "");
  const ruled = (a: string): boolean => {
    const dv = ruledDefaultValue(spec, a, family);
    if (dv !== undefined && spec.defaults?.[a]?.absent_as_none) return !refusedHere(a, dv);
    const nd = spec.number_defaults?.[a];
    return !!nd && Number.isFinite(nd.value) && (!nd.families || nd.families.includes(family));
  };
  for (const f of out) {
    if (f.group || f.secondKey) continue;
    const reads = f.axes ?? [f.skuAttr];
    if (reads.some((a) => needed.has(a) && !ruled(a))) f.required = true;
  }
  /**
   * SLICE 12e-2 (owner Q10): the `panel_optional` boxes -- a class / wall thickness the row may state. Rendered
   * AFTER every field the pricing reads, as a plain text box that never refuses (the audit's three-condition
   * rule: typed and rendered but NOT mandatory, so no note is required). A config declaring none appends
   * nothing, which keeps every other category's field list byte-identical.
   */
  for (const id of spec.panel_optional ?? []) {
    if (seenIds.has(id)) continue;
    const d = defById.get(id);
    if (!d || d.type !== "text") continue;
    seenIds.add(id);
    out.push({ id, label: d.label, allowNone: false, skuAttr: id, control: "text", optional: true });
  }
  /**
   * SLICE 12e-3a (owner 13:40: "an attribute per pipe which says insulation yes / no"): a delegated section's
   * `include_when` toggle, LAST on the block. Its two values come from its own definition, both always offered
   * (the 12e-2b two-way rule, reached through `twoWayValues` by every site that asks); it is in no `needs`
   * list and no `match_attrs`, so the pricing never reads it and it can never refuse the item. A config that
   * declares no section appends nothing, which keeps every other category's field list byte-identical.
   */
  for (const s of delegatedSections(spec)) {
    const inc = s.include_when;
    if (!inc || seenIds.has(inc.attr)) continue;
    const d = defById.get(inc.attr);
    if (!d || d.type !== "choice") continue;
    seenIds.add(inc.attr);
    out.push({ id: inc.attr, label: d.label, options: [...(d.values ?? [])], allowNone: false, skuAttr: inc.attr,
               control: "dropdown", optionSource: "definition", gate: { section: s.id, equals: inc.equals } });
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

  // (2c) SLICE 12e-2 (owner Q14): the SECOND inch conversion, with an example chosen from the stocked sizes --
  // a whole number of inches that lands on a rung at the alternative and on none at 25.4
  if (reader.inches && typeof reader.inch_mm_alt === "number" && reader.inch_mm_alt > 0) {
    const alt = reader.inch_mm_alt;
    const n = [1, 2, 3, 4, 5, 6, 8, 10, 12].find((k) => nums.some((s) => Math.abs(s - k * alt) < 0.02) && !nums.some((s) => Math.abs(s - k * 25.4) < 0.02));
    const eg = n !== undefined
      ? `: ${n}" is ${sizeText(Number((n * 25.4).toFixed(3)))} / ${sizeText(n * alt)} and matches ${sizeText(nums.find((s) => Math.abs(s - n * alt) < 0.02)!)}${unit}`
      : "";
    lines.push(`An inch size that lands on no stocked size at 25.4 ${reader.unit ?? "mm"} to the inch is also tried at ${sizeText(alt)} ${reader.unit ?? "mm"} to the inch${eg}.`);
  }
  // (2d) SLICE 12e-2 (owner Q14a): the nearest stocked size within the declared distance
  if (typeof spec.size_match?.near === "number" && spec.size_match.near > 0) {
    const near = spec.size_match.near;
    const r = nums.find((s) => !nums.some((o) => o !== s && Math.abs(o - (s + near / 2)) <= near)) ?? nums[0];
    lines.push(`A size within ${sizeText(near)}${unit} of a stocked size is that size: ${sizeText(Number((r + near / 2).toFixed(4)))} is matched to ${sizeText(r)}${unit}.`);
  }
  // (2e) SLICE 12e-2 (owner Q17): below the smallest, where the config declares it
  if (spec.size_match?.below_smallest === "smallest") {
    lines.push(`A size below the smallest stocked size (${sizeText(smallest)}${unit}) is priced as the smallest.`);
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
