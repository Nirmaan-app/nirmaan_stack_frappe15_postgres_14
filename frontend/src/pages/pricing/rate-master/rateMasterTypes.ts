// Rate Master (RM-2) shared types.
//
// Mirrors the RM-1 backend shapes returned by the two read endpoints
// (nirmaan_stack.api.boq.rate_master.get_rate_master_items /
// get_rate_category_config). The stored config's pipeline `steps` are the
// vocabulary the pure interpreter (ratePipelineInterpreter.ts) executes.

/** An attribute definition from the stored config (a pickable dimension). */
export interface AttributeDefinition {
  id: string;
  label: string;
  /**
   * The input affordance AND the match-key type, in one field:
   *   "choice"        -> a DROPDOWN, coerced to a STRING.
   *   "number"        -> a FREE numeric input, coerced to a NUMBER.
   *   "number_choice" -> a DROPDOWN, coerced to a NUMBER (CP2).
   *
   * CP2, owner-locked: the third type exists because item matching is STRICT IDENTITY
   * (`matchMasterRow`: `it.attributes[k] === selected[k]`), so a dropdown over a NUMERIC catalog
   * column (cable cores, thickness in sqmm) must produce a number -- a plain `choice` yields the
   * string "3", which never equals the stored 3 and silently matches nothing. The alternative,
   * making the matcher numeric-aware, was REJECTED: it changes how every category matches every
   * attribute, and its failure mode is a WRONG match -- a price that looks right and is not. This
   * type is contained by construction; absence means unchanged.
   */
  type: "choice" | "number" | "number_choice";
  values?: (string | number)[];
  /** brand carries selector:false -- shown but not selectable. Absent => selectable. */
  selector?: boolean;
  note?: string;
  // EA-4a: a choice whose allowed values are RESOLVED FROM the live master (distinct `attr` values of the
  // `kind` rows matching `where`), exactly like the item-identity catalogs. The BACKEND resolves these at
  // extraction-prompt injection; the Derivation resolves them for the select options (see values_from
  // resolution in RateMasterDerivation). When present the config carries no static `values`.
  values_from?: { kind: string; attr: string; where?: Record<string, string | number> };
  // EA-4a: the extraction default for this attribute (used server-side to fill a value the row text does
  // not positively identify; a result attribute so filled carries `defaulted: true`).
  //
  // U3/U4 CORRECTION -- this was previously commented "Display-only here", which read as harmless and
  // is NOT accurate. It IS read server-side: `extraction.build_attribute_defs` copies it into the
  // per-attribute definitions sent to the model, so setting it CHANGES THE AI PROMPT (measured: exactly
  // one added key). It also seeds the Derivation screen (RateMasterDerivation's second-tier fallback,
  // ahead of goldens[0]). Treat adding one as a real behavioural change, not a cosmetic default.
  //
  // NOTE it is DISTINCT from the top-level `extraction_defaults` map, which is what raises the prompt's
  // DEFAULTS section and the `defaulted: true` result flag. A category can carry either or both.
  default?: string | number;
  // EA-4a-r: this component may be POSITIVELY ABSENT (the "None" sentinel -- distinct from blank/unknown).
  // allow_none -> the select offers a "None" option; disables_when_none lists the dependent attr ids that
  // are greyed + cleared when this def is set to "None" (e.g. plate_item -> [plate_qty, back_box]).
  allow_none?: boolean;
  disables_when_none?: string[];
}

/** One master item row (attributes/rates are parsed objects from the endpoint). */
export interface RateMasterItem {
  name?: string;
  discipline: string;
  kind: string;
  brand?: string;
  unit?: string;
  attributes: Record<string, string | number>;
  rates: Record<string, number>;
  source_sheet?: string;
  source_row?: number;
  import_batch?: string;
}

// ---- Pipeline step vocabulary (discriminated by `step`) ----

export interface MatchMasterRowStep {
  step: "match_master_row";
  params: { kind: string };
  explain?: string;
}
export interface ApplyEffectiveMultiplierStep {
  step: "apply_effective_multiplier";
  target: string;
  result: string;
  conditions: { when: Record<string, string | number>; params: Record<string, number> }[];
  formula: string;
  explain?: string;
}
export interface ScaleStep {
  step: "scale";
  target: string;
  result: string;
  // EA-1: a param key ending in `_from_attr` carries an ATTRIBUTE ID (string) whose selected value is
  // bound into the formula under the key's base name (e.g. `kva_from_attr: "kva"` -> bind `kva`).
  // Plain numeric params are bound by their exact name.
  params: Record<string, number | string>;
  formula: string;
  explain?: string;
}
export interface RoundupStep {
  step: "roundup";
  target: string;
  params: { digits: number };
  explain?: string;
}
export interface ComponentStep {
  step: "component";
  name: string;
  /** Absent for a conditional / param-only component (e.g. the earthing chamber adder). */
  target?: string;
  params?: Record<string, number>;
  formula: string;
  // EA-1: a component may resolve its params via attribute conditions, matched on the SELECTED
  // attributes (like apply_effective_multiplier) -- e.g. the earthing chamber adder keyed on
  // with_chamber. An unmatched condition is an HONEST no-compute (never a zero default).
  conditions?: { when: Record<string, string | number>; params: Record<string, number> }[];
  explain?: string;
}
// EA-2c: a component whose `base` comes from a SEPARATELY-REFERENCED master row (matched by kind AND
// optional qualifying attributes), NOT the selection-matched row. Resolution must be UNIQUE within the
// discipline: zero OR multiple matches is an HONEST no-compute (never zero-by-default, never
// pick-first). The referenced row's `target` rate binds as `base`; conditions/params/formula per the
// component contract. This is the ASSEMBLY PRIMITIVE's simplest form (EA-4's BOM steps extend it:
// referenced item x quantity) AND makes "shared items stored once" kinetic -- e.g. the Bus bar row
// prices both AS a selectable earthing item AND as the adder inside any other earthing selection.
// EA-4a: the assembly-engine extensions to component_ref (the ASSEMBLY PRIMITIVE, EA-2c, extended to
// "referenced item x quantity"). A rate stage multiplies the running rate and OPTIONALLY rounds AFTER that
// stage -- `up0` = Excel ROUNDUP to units, `up-1` = to tens; a stage without `round` leaves the rate
// unrounded (this per-stage rounding is what makes the sheet's "round the supply rate, then x0.2 unrounded"
// faithful -- the switch-install 155 x 0.2 = 31 case). ONE new step (circuit_fit) sizes the conduit + counts
// circuits; component_ref gains @attr / @fitted_size ref bindings + rate_stages + qty.
export interface RateStage {
  mult: number;
  /** point_wiring RUNS: an OPTIONAL attribute-bound factor folded in BEFORE this stage's rounding, so
   * `x runs then round`. ABSENT (or missing / non-numeric on the selection) MEANS 1 -- so every shipped
   * stage without this key is byte-identical. Distinct from `scale`'s `<ident>_from_attr`, which
   * hard-fails to an honest no-compute; see absentMeansOne() for why the two deliberately differ. */
  mult_from_attr?: string;
  round?: "up0" | "up-1";
}
/** The quantity multiplier for an assembly component_ref: a literal, a selected attribute, a circuit_fit
 * binding, or a boolean-attribute switch. A missing from_attr/from_fit source is an HONEST no-compute. */
export type QtySpec =
  | number
  | { from_attr: string }
  | { from_fit: string }
  | { if_attr: Record<string, string | number>; then: number; else: number };

export interface ComponentRefStep {
  step: "component_ref";
  name: string;
  // EA-2c legacy: ref = {kind, attributes:{...}} matched exact + priced by `formula` over `base`.
  // EA-4a assembly: ref = {kind, <attr>:<value>...} inline, where a value may be a literal, "@<attr>"
  // (bound from the selection) or "@fitted_size" (from circuit_fit); priced by rate_stages x qty (no
  // `formula`). The interpreter branches on the PRESENCE of rate_stages/qty.
  ref: { kind: string; attributes?: Record<string, string | number>; [attr: string]: unknown };
  target: string;
  params?: Record<string, number>;
  /** EA-2c legacy pricing. Absent on the EA-4a assembly shape (rate_stages x qty priced instead). */
  formula?: string;
  conditions?: { when: Record<string, string | number>; params: Record<string, number> }[];
  // EA-4a assembly pricing:
  rate_stages?: RateStage[];
  qty?: QtySpec;
  // EA-4a-r: when set, a ref @attr resolving to the "None" sentinel makes this component an EXPLICIT ZERO
  // (positive absence), not a no-compute. (back_box binds @plate_item, so plate=None zeroes it too.)
  none_skips?: boolean;
  explain?: string;
}
// EA-4a: sizes the conduit for a point-wiring circuit and counts how many circuits fit. overall_dia =
// Sum over wire_specs of sqrt(sqmm/pi)*2*core; fitted_size = the smallest `sizes` whose usable dia
// (size * usable[conduit_type][i]) >= overall_dia (largest if none fit); circuits = ROUNDDOWN(usable/dia);
// conduit_qty = ROUNDUP(length/circuits). BINDS its results (by `binds` = [fitted_size, circuits,
// conduit_qty]) into the run scope for later @fitted_size / from_fit reads. Any missing/zero input attr,
// unknown conduit_type, or circuits <= 0 is an HONEST missing-attr no-compute (never a guess).
export interface CircuitFitStep {
  step: "circuit_fit";
  params: {
    sizes: number[];
    usable: Record<string, number[]>;
    /** [core_attr, thickness_attr] or, since the point_wiring RUNS slice, an OPTIONAL third element
     * [core_attr, thickness_attr, runs_attr] naming a parallel-runs attribute. The dia sum becomes
     * cores x runs; ABSENT (the shape every pre-existing config uses) MEANS 1. */
    wire_specs: ([string, string] | [string, string, string])[];
    length_attr: string;
    conduit_type_attr: string;
    // EA-4a-r: the thickness attr of an OPTIONAL wire; when it resolves to the "None" sentinel that wire
    // is omitted from the overall_dia sum (a single-wire point fits on wire1 alone).
    optional_wire_when_none?: string;
  };
  binds: string[];
  explain?: string;
}
export interface ComponentBandStep {
  step: "component_band";
  name: string;
  band_on: string;
  bands: { when: string; target: string }[];
  params: Record<string, number>;
  formula: string;
  explain?: string;
}
export interface SumComponentsStep {
  step: "sum_components";
  result: string;
  explain?: string;
}
export interface InstallAsRatioStep {
  step: "install_as_ratio";
  params: { ratio: number };
  result: string;
  explain?: string;
}
// EA-4c: the DB build-up install -- the sheet's EXACT IFERROR three-way. In order:
//  (a) when_shell_absent.attr's selected value == equals ("None") -> ROUNDUP(ratio.of * ratio.mult);
//  (b) else attempt the lookup (unique master row of `lookup.kind` whose `item` attr == the resolved
//      "@<attr>") -> if it resolves, ROUNDUP(matched[lookup.target] * lookup.mult);
//  (c) if the lookup MISSES -> ROUNDUP(ratio.of * ratio.mult) [the IFERROR fallback].
// A ratio branch with a missing ratio.of source is an HONEST no-compute; never throws (Option C).
export interface LookupOrRatioStep {
  step: "lookup_or_ratio";
  result: string;
  lookup: { kind: string; item: string; target: string; mult: number };
  ratio: { of: string; mult: number };
  when_shell_absent: { attr: string; equals: string; use: "ratio" };
  // EA-4d: the table-hit branch and the ratio branches round SEPARATELY (the sheet's IFERROR three-way:
  // the install-table hit is UNROUNDED `VLOOKUP*1.5`, while the shell-absent + fallback ratio branches are
  // ROUNDUP tens). `round_lookup: null` => no roundup on the table-hit; `round_ratio: -1` => tens.
  // Backwards-compat: the legacy single `round` still applies to both when the split fields are absent.
  round_lookup?: number | null;
  round_ratio?: number | null;
  round?: number;
  explain?: string;
}

// SLICE 2: one ladder a computed module count is resolved against. The rungs are derived FROM THE
// CATALOG (the active master rows of `kind` matching every `where`), NEVER from a params array -- a
// literal size list in config would drift silently the moment a plate size is added or retired.
export interface ModuleLadderSpec {
  /** The master-item kind holding the ladder rows (e.g. "switch_socket_item"). */
  kind: string;
  /** Exact-match attribute filters selecting the ladder's family, e.g. {family: "Back Box"}. */
  where?: Record<string, string | number>;
  /** The attribute carrying each rung's size LABEL. Default "item" (the catalog's own column). */
  label_attr?: string;
  /** The key the fitted rung's LABEL ("12M") binds to, readable by a later component_ref as
   * "@<bind>" -- exactly how circuit_fit binds fitted_size for "@fitted_size". */
  bind: string;
  /** Optional: the key the fitted rung's MODULE NUMBER (a number) binds to, readable by a
   * component_ref qty {from_fit}. */
  bind_modules?: string;
  // SLICE 2 part 2 -- TAKE-THE-LARGER (owner-locked). Names the attribute whose stated module count
  // acts as a FLOOR on this ladder's fit. The count fitted is `max(stated, computed)`:
  //   computed >  stated -> the COMPUTED count. A stated plate too small for its contents is
  //     UPGRADED, never refused -- and the trace says so explicitly (see below).
  //   computed <= stated -> the STATED count. A bigger plate than needed was asked for, and that is
  //     what gets bought. THE STATED PLATE IS A FLOOR, NEVER A CEILING.
  //   blank / absent     -> the COMPUTED count alone.
  //   the "None" sentinel -> per `on_none`.
  // The resolved count is then RE-FIT on THIS ladder. On the plate ladder that is usually the
  // identity; on the SHORTER back-box ladder it is the hop (a selected 9M plate -> count 9 -> a 12M
  // box). **NEVER copy the label across ladders** -- the box carries no 9M and no 16M, so copying
  // makes such a row unpriceable, which was a LIVE defect before this slice.
  //
  // ⚠️ AN UPGRADE IS ALWAYS VISIBLE. A stated 6M silently becoming 8M would mean the BoQ said one
  // thing and we priced another; that is the right call but it must never be silent, so the step's
  // trace names the stated size, its capacity, the contents, and the word UPGRADED.
  //
  // ABSENT => the computed count always, byte-identical to slice 2 part 1.
  // (Named `floor_from` and not `defer_to`: the stated value is a floor, not a veto.)
  floor_from?: string;
  /** What a `floor_from` of "None" means for THIS ladder. "none" (the default, and part 1's
   * behaviour) = this ladder is POSITIVELY ABSENT: it binds nothing, and a `blanks` block keyed to
   * it is absent too rather than failing (positive absence propagates). "computed" = fall back to
   * the computed count -- the back box's rule, since a back box can exist with no face plate.
   * UNAFFECTED by the take-the-larger ruling. */
  on_none?: "computed" | "none";
}

// SLICE 2: compute a module count, then resolve it against catalog ladders.
//
// WHY THIS IS A PIPELINE STEP AND NOT A RULE: a model-selected plate leaves NO trace. The module
// count is arithmetic over stated quantities, and this system's ethos is that a price shows its
// working -- so the count is computed HERE and the trace carries both the arithmetic and the ladder
// hop. See the trace's matchedCondition.
//
// The weighted sum is PARAMETERISED, never hardcoded: switches_sockets has TWO socket slots
// (socket1_qty + socket2_qty) and point_wiring has one, so a fixed two-attribute formula would not be
// portable between them. Weights AND attribute ids are config.
export interface ModuleFitStep {
  step: "module_fit";
  params: {
    /** modules = SUM(weight x selected[attr]) over these terms. The owner's rule is
     * 2 x (sockets) + 1 x (switches), expressed as one term per slot. */
    terms: {
      attr: string;
      weight: number;
      /** OPTIONAL: the controlling item attribute. When IT is the "None" sentinel this term
       * contributes 0 regardless of the quantity -- positive absence, mirroring component_ref's
       * none_skips (which zeroes back_box off @plate_item). Absent => the strict rule below. */
      none_when?: string;
    }[];
    /** One entry per ladder resolved from the SAME computed count. The plate ladder and the back-box
     * ladder are DIFFERENT LENGTHS (the box has no 9M and no 16M), so each derives from its own
     * catalog family and each takes the next higher size independently. */
    ladders: ModuleLadderSpec[];
    /** OPTIONAL filler ("blanker") count, bound as a NUMBER: the modules the plate carries minus the
     * modules its contents occupy. The only blanker in the catalog is `1M Blanker` at one module, so
     * the blank count IS a module count. */
    blanks?: {
      /** The key the blank count binds to (a component_ref qty {from_fit} reads it). */
      bind: string;
      /** The ladder (by its `bind` key) whose fitted module number is the base -- so the blanks and
       * the plate can never use different numbers and contradict each other. */
      from_ladder: string;
      /** OPTIONAL: the attribute holding the plate the ROW STATES. When it is present and carries a
       * real size, the blanks are computed against IT -- because that is the plate that gets priced.
       * A stated plate SMALLER than its contents is a contradiction in the source data and yields an
       * HONEST NO-COMPUTE, never a clamped zero and never a negative quantity. */
      stated_attr?: string;
    };
  };
  explain?: string;
}

// CIRCUIT LENGTH part 1 -- COMPUTE AN ATTRIBUTE VALUE INTO THE SELECTION.
//
// THE WALL this crosses: every other step writes its result into `ctx`, but the two readers that
// consume a quantity read the SELECTION and never consult `ctx` --
//     circuit_fit  -> Number(selected[params.length_attr])
//     resolveQty   -> Number(selected[qty.from_attr])
// -- and nothing writes into the selection. So a value computed by `scale` (a RATE scaler: it needs an
// existing finite ctx rate as its target and writes ctx[result]) can never reach either one. This step
// is the crossing: its result lands on an ATTRIBUTE, in a selection overlay LOCAL to the pipeline run,
// where both readers already look. The shared readers are UNTOUCHED -- widening them to fall back to
// `ctx` would change how every category resolves every quantity, and a ctx key colliding with an
// attribute id would silently re-price a shipped row.
//
// PARAMETERISED FROM CONFIG, never hardcoded (the `module_fit` terms precedent): the formula, the
// source attributes AND the target attribute are all config. `15 + (n - 1) * 5` is one category's rule.
//
// STATED WINS, with NO FLOOR and NO WARNING (owner-locked, and DELIBERATELY unlike the plate's
// take-the-larger): the computation runs ONLY when the row states nothing. A pricer typing 60 for a
// long run is simply right, so a stated value is adopted verbatim and is never second-guessed.
export interface DeriveAttributeStep {
  step: "derive_attribute";
  params: {
    /** The ATTRIBUTE ID the computed value lands on -- in the selection overlay, NOT in ctx. */
    result_attr: string;
    /** Formula identifier -> the attribute id supplying its value. One entry per input the rule reads. */
    terms: { ident: string; attr: string }[];
    /** Named numeric constants bound into the same formula env (the rule's fixed numbers). */
    constants?: Record<string, number>;
    /** The arithmetic, READ FROM CONFIG. Identifiers are the terms' idents + the constants' keys. */
    formula: string;
    /** Display-only unit for the trace line ("m"). */
    unit?: string;
  };
  explain?: string;
}

export type PipelineStep =
  | MatchMasterRowStep
  | ApplyEffectiveMultiplierStep
  | ScaleStep
  | DeriveAttributeStep
  | RoundupStep
  | ComponentStep
  | ComponentRefStep
  | ComponentBandStep
  | SumComponentsStep
  | InstallAsRatioStep
  | LookupOrRatioStep
  | CircuitFitStep
  | ModuleFitStep
  // forward-compat: an unknown future step type still parses as an object with a `step` string.
  | { step: string; [k: string]: unknown };

export interface Pipeline {
  output: string[];
  steps: PipelineStep[];
  note?: string;
}

export interface RateCategoryConfig {
  discipline: string;
  category_id: string;
  category_display?: string;
  attribute_definitions: AttributeDefinition[];
  pipelines: Record<string, Pipeline>;
  normalization_rule?: string;
  /** EA-1c: the master-item kinds belonging to this category (used to scope the Data tab). Absent on the
   * legacy wiring config -- there the kinds are derived from the pipelines' match_master_row params. */
  item_kinds?: string[];
  /** EA-2: display labels for the pricing-helper's pipeline groups -- CONFIG DATA, not code (the helper
   * reads pipeline_labels?.[id] ?? a prettified id). Wiring carries {cable_boq, termination_boq}. */
  pipeline_labels?: Record<string, string>;
  /** EA-2: "item_identity" switches server extraction to catalog matching (the identity attribute's
   * values ARE the item catalog). Absent / anything else => the attribute-extraction mode. */
  matching_mode?: string;
  identity_attribute_id?: string | null;
  notes?: string;
  /** EA-4 ext-a: owner-authored estimator rules. Injected VERBATIM into the extraction prompt for
   * EVERY category (never composite-gated) and rendered read-only on the Derivation tab. The index
   * signature below already round-tripped this key; the explicit field is for type safety only. */
  rules?: RateCategoryRule[];
  [k: string]: unknown;
}

/** EA-4 ext-a: one estimator rule. Authored by the estimator and passed through unchanged -- the
 * guidance text is the contract, so nothing in the app rewords or interprets it. */
export interface RateCategoryRule {
  id: string;
  label: string;
  /** The attribute id (or slot family) the rule governs, e.g. "db_shell_item" / "mcb_slots". */
  applies_to?: string;
  guidance: string;
}

// ---- Endpoint response envelopes (frappe-react-sdk unwraps `message`) ----

export interface GetItemsResponse {
  discipline: string;
  kind: string | null;
  count: number;
  items: RateMasterItem[];
}
export interface GetConfigResponse {
  name?: string;
  discipline: string;
  category_id: string;
  config: RateCategoryConfig | null;
  source_workbook?: string;
  import_batch?: string;
}

// ---- Interpreter trace shapes ----

export type PipelineStatus = "ok" | "no_match" | "unsupported";

/**
 * DERIVED DISPLAY -- one ladder's OUTCOME from a `module_fit` step, as STRUCTURED DATA.
 *
 * ⚠️ WHY THIS EXISTS AT ALL. `module_fit` already recorded every one of these facts, but ONLY inside
 * its prose `matchedCondition` line, and `StepTrace.runningValues` is `Record<string, number>` so a
 * fitted catalog LABEL ("3M") could not live there. A consumer wanting the fitted plate therefore had
 * exactly two bad options: REGEX THE PROSE (which turns a human-readable trace line into a parsing
 * contract -- reword the trace and the panel silently stops finding the plate), or RE-DERIVE the fit
 * (a FIFTH copy of the module rule, which is precisely the drift #179 is about -- the module rule is
 * catalog-resolved, take-the-larger, per-ladder, and a second copy would agree until it did not).
 * So the step publishes what it decided, and the prose line stays prose.
 *
 * ADDITIVE AND OPTIONAL: absent on every step that is not a `module_fit`, and absent even on a
 * `module_fit` that BAILED (nothing was fitted, so there is nothing to publish). No existing consumer
 * reads it, so every pre-existing pipeline, trace and golden is byte-unaffected.
 */
export interface ModuleFitLadderOutcome {
  /** The ladder's `bind` key -- which IS the attribute id the fitted rung binds to. */
  bind: string;
  /** The attribute whose STATED value acted as this ladder's floor (config `floor_from`), if any. */
  floorFrom?: string;
  /** The fitted catalog label ("3M", "1M & 2M"). null when the ladder is POSITIVELY ABSENT. */
  label: string | null;
  /** The module count the fitted rung holds. null when positively absent. */
  modules: number | null;
  /** POSITIVELY ABSENT: a "None" floor, or a zero module count (nothing to fit on any ladder). */
  absent: boolean;
  /** Set ONLY when TAKE-THE-LARGER upgraded a stated rung too small for the row's contents. The
   * upgrade is the one outcome that must never be silent -- the BoQ said one size and we price
   * another -- so the numbers travel as data and any surface can say so in its own words. */
  upgraded?: { stated: string; statedHolds: number; occupied: number };
}

/**
 * DERIVED DISPLAY -- the outcome of one `derive_attribute` step, published as STRUCTURED DATA on the
 * trace exactly as `module_fit` publishes `moduleFit`. A consumer READS THIS; it must never parse the
 * prose line (a human sentence that gets reworded, so parsing it fails silently) and must never
 * re-derive the arithmetic (that is the drift #179 exists to prevent).
 *
 * ADDITIVE AND OPTIONAL: absent on every step that is not a `derive_attribute`. No pre-existing
 * consumer reads it, so every existing pipeline, trace and golden is byte-unaffected.
 */
export interface DerivedAttrOutcome {
  /** The attribute id the value applies to. */
  attr: string;
  /** The computed value. NULL when the row STATED one -- nothing was computed, by design. */
  value: number | null;
  /** The row stated a value, so the computation did not run and the stated value is what prices. */
  stated: boolean;
  /** The value the row stated, when `stated` -- carried verbatim (it may be the "None" sentinel). */
  statedValue?: string | number;
  /** Display-only unit from config. */
  unit?: string;
}

/** DERIVED DISPLAY -- the whole outcome of one `module_fit` step. */
export interface ModuleFitOutcome {
  /** The weighted module count the row's contents occupy (the step's own arithmetic). */
  occupied: number;
  /** One entry per configured ladder, in config order. */
  ladders: ModuleFitLadderOutcome[];
}

export interface StepTrace {
  /** The step type token from config. */
  step: string;
  /** Human label: the step's explain text if present, else a derived label. */
  label: string;
  /** Params in force at this step (e.g. discount/markup/digits/ratio). */
  params?: Record<string, string | number>;
  /**
   * For apply_effective_multiplier: the matched condition rendered readably,
   * e.g. "insulation = ARMOURED -> discount 0.75, markup 0.35".
   */
  matchedCondition?: string;
  /** For component_band: the band chosen, e.g. "thickness_sqmm 50 >= 35 -> gland_band2_list". */
  bandChosen?: string;
  /** For component_ref: the NAME of the referenced master row resolved at runtime (e.g. "Bus bar"),
   * so the trace shows WHICH row supplied the base. */
  refItem?: string;
  /** The named value produced/changed by this step (key -> value). */
  produced?: { key: string; value: number };
  /** For module_fit: the STRUCTURED outcome (see ModuleFitOutcome). Present only on a module_fit
   * step that actually fitted -- so a consumer never has to read the prose line to learn the
   * fitted plate, and never has to re-derive it. */
  moduleFit?: ModuleFitOutcome;
  /** For derive_attribute: the STRUCTURED outcome (see DerivedAttrOutcome). Present on every
   * derive_attribute step that reached a verdict -- computed OR stated-wins -- so a surface can show
   * the value, and say whose it is, without reading the prose. */
  derivedAttr?: DerivedAttrOutcome;
  /** Snapshot of every named value after this step (for the running-value column). */
  runningValues: Record<string, number>;
  /** Set when the step type is not recognized (forward-compat honesty). */
  unsupported?: boolean;
}

export interface PipelineResult {
  pipelineId: string;
  outputs: string[];
  status: PipelineStatus;
  steps: StepTrace[];
  /** output key -> value; empty unless status === "ok". */
  finals: Record<string, number>;
  /** The matched master item (present when status !== "no_match" and a match ran). */
  matchedItem?: RateMasterItem;
  note?: string;
}
