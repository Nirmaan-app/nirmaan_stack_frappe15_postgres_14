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
  type: "choice" | "number";
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
  // not positively identify; a result attribute so filled carries `defaulted: true`). Display-only here.
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
    wire_specs: [string, string][];
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

export type PipelineStep =
  | MatchMasterRowStep
  | ApplyEffectiveMultiplierStep
  | ScaleStep
  | RoundupStep
  | ComponentStep
  | ComponentRefStep
  | ComponentBandStep
  | SumComponentsStep
  | InstallAsRatioStep
  | CircuitFitStep
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
  [k: string]: unknown;
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
