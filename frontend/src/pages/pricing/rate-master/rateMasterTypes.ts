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
  | ComponentBandStep
  | SumComponentsStep
  | InstallAsRatioStep
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
