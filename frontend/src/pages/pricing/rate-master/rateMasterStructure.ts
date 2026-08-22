// RM-4b: pure helpers for the STRUCTURE editor (the Pipelines tab).
// No React, no I/O -- unit-tested. The interpreter (ratePipelineInterpreter.ts) is reused UNCHANGED:
// the preview gate runs the SAME pure interpreter over a DRAFT config + the live master items and
// compares against the config's stored goldens. This module owns the goldens-as-config-data shape, the
// step vocabulary + blank-step factory, and the client mirror of the server reference guard.

import type {
  AttributeDefinition,
  Pipeline,
  PipelineStatus,
  PipelineStep,
  RateCategoryConfig,
  RateMasterItem,
} from "./rateMasterTypes";
import { NONE_SENTINEL, runPipeline } from "./ratePipelineInterpreter";

/**
 * CP2: the two axes of an attribute type, each with ONE definition.
 *
 * `number_choice` is the DROPDOWN affordance of `choice` with the NUMERIC coercion of `number`, so
 * every consumer asks one of these two questions rather than testing the type string itself. An
 * unknown / future type answers NO to both -- it renders as a plain input and coerces to String,
 * exactly as before this type existed.
 */
export function isNumericAttributeType(type: AttributeDefinition["type"] | string | undefined): boolean {
  return type === "number" || type === "number_choice";
}
export function isDropdownAttributeType(type: AttributeDefinition["type"] | string | undefined): boolean {
  return type === "choice" || type === "number_choice";
}

/**
 * Coerce a stringy attribute value to what the interpreter matches on (number for number attrs).
 *
 * THE SINGLE POINT where an attribute value becomes a MATCH KEY. Item matching is strict identity
 * (`matchMasterRow`: `it.attributes[k] === selected[k]`), so a value coerced to the wrong JS type
 * silently fails to match a catalog row that carries it -- a no-match, never a wrong price, but
 * equally never a price. It lived buried in `pricingSheetHelper.ts` until CP2 moved it here beside
 * the other attribute-definition helpers (`blankAttributeDefinition`, `referencedAttrIds`,
 * `distinctNumberValues`), so both the pricing-editor helper and any future consumer share ONE
 * definition. PURE.
 */
export function coerceForMatch(def: AttributeDefinition, raw: string | number | null): string | number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  // EA-4a-r: the "None" sentinel is POSITIVE ABSENCE -- preserve it verbatim for an allow_none def (even a
  // number one, where Number("None") would otherwise coerce it to null and lose the signal).
  if (def.allow_none && raw === NONE_SENTINEL) return NONE_SENTINEL;
  if (isNumericAttributeType(def.type)) {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return String(raw);
}

/** One standing golden stored in the config: attributes + expected finals per pipeline. */
export interface Golden {
  id?: string;
  attrs: Record<string, string | number>;
  expect: Record<string, Record<string, number>>;
}

/** One expected-vs-computed check for a single golden output key. */
export interface GoldenCheck {
  goldenIndex: number;
  goldenId?: string;
  attrs: Record<string, string | number>;
  pipelineId: string;
  key: string;
  expected: number;
  /** The value the (draft) config computed, or null when the pipeline did not produce it. */
  got: number | null;
  status: PipelineStatus | "missing_pipeline";
  pass: boolean;
}

/** The step types the pure interpreter executes (the ONLY types the validator/editor allow). */
export const STEP_VOCABULARY = [
  "match_master_row",
  "apply_effective_multiplier",
  "scale",
  "roundup",
  "component",
  "component_ref",
  "component_band",
  "sum_components",
  "install_as_ratio",
  // EA-4a: the assembly engine's conduit-sizing step (component_ref is extended in place, so it stays one
  // vocabulary entry; only circuit_fit is new).
  "circuit_fit",
  // EA-4c: the DB build-up install -- the sheet's exact IFERROR three-way (shell absent -> ratio; shell
  // in the install table -> table x mult; else fallback ratio).
  "lookup_or_ratio",
  // SLICE 2: computes a module count from a PARAMETERISED weighted sum over stated quantities and
  // resolves it against ladders derived FROM THE CATALOG (exact, else the next higher size).
  "module_fit",
  // SLICE 2b: resolves ONE string attribute -- stated wins, else a config conversion table, else a
  // default. A CONVERSION is deterministic code, never a prompt sentence (the owner's standing
  // principle); this is also F-10's SWG -> mm shape.
  "map_attribute",
  // SLICE 2b: fits a stated NUMBER onto a ladder derived FROM THE CATALOG and binds the chosen row's
  // label -- module_fit's ladder half, generalised (size from a numeric attribute, "@"-refs and value
  // lists in `where`, explicit direction) so slice 3's tray width rides the same step.
  "catalog_fit",
  // CIRCUIT LENGTH part 1: computes an ATTRIBUTE value (formula + source attrs + target attr all from
  // config) into the SELECTION, where circuit_fit's length and a component's {from_attr} qty read --
  // ctx, where every other step writes, is invisible to both. A stated value always wins.
  "derive_attribute",
] as const;

export type StepType = (typeof STEP_VOCABULARY)[number];

/** Deep clone a config for a draft edit session (JSON round-trip -- config is plain JSON). */
export function cloneConfig(config: RateCategoryConfig): RateCategoryConfig {
  return JSON.parse(JSON.stringify(config)) as RateCategoryConfig;
}

/** Run every stored golden through the given config's pipelines + items, one check per output key. */
export function evaluateGoldens(config: RateCategoryConfig, items: RateMasterItem[]): GoldenCheck[] {
  const goldens = (config.goldens as Golden[] | undefined) ?? [];
  const checks: GoldenCheck[] = [];
  goldens.forEach((g, gi) => {
    for (const [pid, emap] of Object.entries(g.expect ?? {})) {
      const pl = config.pipelines?.[pid] as Pipeline | undefined;
      let finals: Record<string, number> = {};
      let status: GoldenCheck["status"] = "missing_pipeline";
      if (pl) {
        // A DRAFT can be transiently invalid mid-edit (e.g. a param renamed before its formula
        // catches up -> evalFormula throws). The preview must survive that: a throw becomes "not
        // produced" (a delta), never a crash. This wraps the interpreter; it does NOT change it.
        try {
          const r = runPipeline(pid, pl, items, g.attrs);
          finals = r.finals;
          status = r.status;
        } catch {
          finals = {};
          status = "no_match";
        }
      }
      for (const [key, expected] of Object.entries(emap)) {
        const produced = status === "ok" && Number.isFinite(finals[key]) ? finals[key] : null;
        checks.push({
          goldenIndex: gi,
          goldenId: g.id,
          attrs: g.attrs,
          pipelineId: pid,
          key,
          expected,
          got: produced,
          status,
          pass: produced === expected,
        });
      }
    }
  });
  return checks;
}

/** The subset of golden checks that FAIL (expected !== computed) -- the preview gate's deltas. */
export function goldenDeltas(config: RateCategoryConfig, items: RateMasterItem[]): GoldenCheck[] {
  return evaluateGoldens(config, items).filter((c) => !c.pass);
}

/** A minimal VALID skeleton for a new step of the given type (the editor appends this, then the admin
 * fills the blanks). Mirrors the server validator's per-type required keys. */
export function blankStep(type: StepType): PipelineStep {
  switch (type) {
    case "match_master_row":
      return { step: "match_master_row", params: { kind: "cable" } };
    case "apply_effective_multiplier":
      return {
        step: "apply_effective_multiplier",
        target: "",
        result: "",
        formula: "(1-discount)*(1+markup)",
        conditions: [],
      };
    case "scale":
      return { step: "scale", target: "", result: "", formula: "base*(1+markup)", params: {} };
    case "roundup":
      return { step: "roundup", target: "", params: { digits: 0 } };
    case "component":
      return { step: "component", name: "", target: "", formula: "", params: {} };
    case "component_ref":
      return { step: "component_ref", name: "", ref: { kind: "", attributes: {} }, target: "", formula: "base", params: {} };
    case "component_band":
      return { step: "component_band", name: "", band_on: "", bands: [], params: {} };
    case "sum_components":
      return { step: "sum_components", result: "" };
    case "install_as_ratio":
      return { step: "install_as_ratio", result: "", params: { ratio: 0.25 } };
    case "circuit_fit":
      return {
        step: "circuit_fit",
        params: { sizes: [], usable: {}, wire_specs: [], length_attr: "", conduit_type_attr: "" },
        binds: ["fitted_size", "circuits", "conduit_qty"],
      };
    case "module_fit":
      return {
        step: "module_fit",
        params: { terms: [], ladders: [] },
      };
    case "derive_attribute":
      return {
        step: "derive_attribute",
        params: { result_attr: "", terms: [], constants: {}, formula: "" },
      };
    default:
      return { step: type };
  }
}

/** Client mirror of the server reference guard: the attribute ids a pipeline references (every
 * apply_effective_multiplier condition `when` key, every component_band `band_on`, and every
 * attribute a module_fit names). Removing a definition still in this set is rejected server-side;
 * the editor uses it to warn pre-save. */
export function referencedAttrIds(config: RateCategoryConfig): Set<string> {
  const out = new Set<string>();
  for (const pl of Object.values(config.pipelines ?? {})) {
    for (const raw of pl.steps ?? []) {
      const s = raw as {
        step: string;
        conditions?: { when?: Record<string, unknown> }[];
        band_on?: string;
        params?: {
          terms?: { attr?: string; none_when?: string; ident?: string }[];
          ladders?: { floor_from?: string }[];
          blanks?: { stated_attr?: string };
          result_attr?: string;
        };
      };
      if (s.step === "apply_effective_multiplier") {
        for (const c of s.conditions ?? []) {
          for (const k of Object.keys(c.when ?? {})) out.add(k);
        }
      } else if (s.step === "component_band" && typeof s.band_on === "string" && s.band_on) {
        out.add(s.band_on);
      } else if (s.step === "module_fit") {
        // SLICE 2: every attribute id a module_fit names must be guarded, so a typo fails LOUDLY at
        // save instead of silently no-computing every row of the category at runtime.
        for (const t of s.params?.terms ?? []) {
          if (typeof t?.attr === "string" && t.attr) out.add(t.attr);
          if (typeof t?.none_when === "string" && t.none_when) out.add(t.none_when);
          // SLICE 5: `weight_from.from_attr` names an attribute too -- the slot whose SKU supplies
          // this term's width. Guarded for the reason the slice-2 comment above gives: a typo here
          // resolves no catalogue row, and the width lookup refuses EVERY row of the category. That
          // must fail at save, not at runtime.
          const wf = (t as { weight_from?: { from_attr?: unknown } })?.weight_from;
          if (typeof wf?.from_attr === "string" && wf.from_attr) out.add(wf.from_attr);
        }
        const sa = s.params?.blanks?.stated_attr;
        if (typeof sa === "string" && sa) out.add(sa);
        // SLICE 2 part 2: a ladder's floor_from names an attribute too.
        for (const L of s.params?.ladders ?? []) {
          if (typeof L?.floor_from === "string" && L.floor_from) out.add(L.floor_from);
        }
      } else if (s.step === "derive_attribute") {
        // CIRCUIT LENGTH part 1: the step names its SOURCE attributes AND its TARGET attribute, and
        // all of them are guarded -- a typo in either would silently no-compute (or silently never
        // find a stated value to defer to) rather than failing at save.
        for (const t of s.params?.terms ?? []) {
          if (typeof t?.attr === "string" && t.attr) out.add(t.attr);
        }
        const ra = s.params?.result_attr;
        if (typeof ra === "string" && ra) out.add(ra);
      }
    }
  }
  return out;
}

/**
 * EA-1c: the master-item kinds belonging to a category, used to SCOPE the Data tab to just this
 * category's items/columns. Fallback order: the config's declared `item_kinds` if present; else derive
 * from the pipelines' `match_master_row` `params.kind` (the legacy wiring config predates item_kinds --
 * its pipelines match `cable` + `termination`). Returns [] only for a config with neither (an
 * empty-pipelines config that also declares no item_kinds -- the caller then shows nothing to scope).
 */
export function categoryItemKinds(config: RateCategoryConfig): string[] {
  const declared = config.item_kinds;
  if (Array.isArray(declared) && declared.length) {
    return declared.filter((k): k is string => typeof k === "string" && k.length > 0);
  }
  const kinds: string[] = [];
  for (const pl of Object.values(config.pipelines ?? {})) {
    for (const raw of pl.steps ?? []) {
      const s = raw as { step: string; params?: { kind?: string } };
      if (s.step === "match_master_row" && s.params?.kind && !kinds.includes(s.params.kind)) {
        kinds.push(s.params.kind);
      }
    }
  }
  return kinds;
}

/**
 * EA-DIFF (owner-observed D5 defect): the SENTINEL for a category that owns NO data rows of its own --
 * its resolved kind set is EMPTY (declared `item_kinds:[]` AND no pipeline-derivable `match_master_row`
 * kind). point_wiring is the first such category (a composite whose pricing derives from OTHER
 * categories' items). The Data tab MUST render an honest empty state for these, NEVER the
 * discipline-wide all-items list. A category with any resolved kind (incl. LMS -> `["lms_item"]`,
 * empty pipelines but declared kinds) is NOT empty-scope. PURE.
 */
export function isCategoryDataScopeEmpty(config: RateCategoryConfig): boolean {
  return categoryItemKinds(config).length === 0;
}

/** A blank attribute definition (choice with one empty value slot, or a number). */
export function blankAttributeDefinition(type: "choice" | "number"): AttributeDefinition {
  return type === "choice"
    ? { id: "", label: "", type: "choice", values: [] }
    : { id: "", label: "", type: "number" };
}

/**
 * EA-2 (rider 1): a validator-MINIMAL pipeline for the Add-pipeline affordance. The server
 * `_validate_config` requires `output` (a list of strings) + a NON-empty `steps` list whose every
 * step is a known type; a single `match_master_row` (the natural first step -- it selects the item to
 * price) is the one blankStep the server accepts UNEDITED (its params.kind is a non-empty string).
 * The author then adds the real computation steps via the existing AddStep machinery. This is what
 * makes authoring a pipeline into an EMPTY-pipelines config (the LMS path) possible.
 */
export function blankPipeline(outputKeys: string[], kind?: string): Pipeline {
  const first = blankStep("match_master_row") as PipelineStep & { params: { kind: string } };
  first.params = { kind: kind && kind.trim() ? kind.trim() : "item" };
  return { output: outputKeys.filter((k) => k.trim().length > 0), steps: [first] };
}

/**
 * EA-2 (rider 2): the distinct numeric values present in the loaded items for a NUMBER attribute,
 * ascending -- the datalist suggestions behind the Derivation tab's free numeric input (so a defined
 * number attribute with no data, e.g. module_count, still accepts a typed value instead of an empty
 * Select). PURE.
 */
export function distinctNumberValues(items: RateMasterItem[], attrId: string): number[] {
  const set = new Set<number>();
  for (const it of items) {
    const v = it.attributes?.[attrId];
    if (typeof v === "number" && Number.isFinite(v)) set.add(v);
  }
  return Array.from(set).sort((a, b) => a - b);
}

// ── SLICE 2d: THE DERIVED-BINDS PREDICATES LIVE HERE ────────────────────────────────────────────
// RELOCATED from `RateMasterDerivation.tsx` (derivedQtyAttrs) and `pricingSheetHelper.ts`
// (derivedAttrIds) by the import-direction law -- the same ruling that moved the BCS readiness
// predicate down to `services/`. BOTH sides now need them: the pricing panel has always read them,
// and slice 2d's Q4(i) ruling makes the Rate Master Derivation screen a pure calculator, which means
// IT must know which attributes are derived too.
//
// ⚠️ THERE WAS NO LEGAL PLACE FOR THIS IN EITHER CALLER. `pricingSheetHelper.ts` already imports FROM
// `RateMasterDerivation.tsx`, so having the Derivation screen import `derivedAttrIds` back out of the
// helper is a CYCLE. `rateMasterStructure.ts` imports only the interpreter, so it is the leaf both
// sides may import -- api->service, one legal direction.
//
// ⚠️ AND NEVER A SECOND COPY. Two predicates on either side of this boundary could disagree about
// whether a field is an input, and the disagreement would surface as a control that is editable on
// one screen and absent on the other for the same attribute -- with a price that follows only one of
// them.

// ---- BLANKER SLICE: DERIVED, READ-ONLY attribute displays ----
//
// THE DEFECT: `blank_qty` sat inert at 0 in the form while the blank line priced at 1, because slice
// 2 part 2 moved that line onto the COMPUTED count (`qty: {from_fit: "blank_count"}`) and stopped
// reading the attribute. The form said one thing and the price said another.
//
// ⚠️ THE DERIVED-NESS IS READ FROM THE CONFIG THAT ALREADY EXISTS -- no new config key, and nothing
// hardcoded by attribute id. An attribute is DERIVED exactly when a component takes its quantity
// from a computed binding INSTEAD of from that attribute, which the stored `qty` already declares:
//   {from_fit: "blank_count"}  -> the attribute is superseded  -> derived, read-only
//   {from_attr: "blank_qty"}   -> the attribute IS the input   -> stays editable
// The rule is READ PER CONFIG, so each category answers for itself and no asset mint is needed:
// switches_sockets and point_wiring carry the from_fit form and their `blank_qty` is derived, while a
// config that still declares {from_attr: "blank_qty"} OPTS OUT AUTOMATICALLY and keeps that field
// editable. ⚠️ Hardcoding `d.id === "blank_qty"` would freeze the field for EVERY config, including one
// that genuinely reads it -- which is why the shape, not the id, is what decides. (The from_attr case
// was live on `switches_point` until that category was retired in 2026-08; the RULE does not depend on
// an example existing, and must keep working the moment another config declares that shape.)
//
// The `_qty` suffix ties a component to its attribute (`blank` -> `blank_qty`), the SAME convention
// every shipped config already uses (switch/switch_qty, socket1/socket1_qty, plate/plate_qty). The
// second guard makes it airtight: an attribute ANY step still reads via from_attr is never derived,
// so a config that both computes and reads a value keeps the user in control.

/** One derived attribute: the def it covers, and the pipeline ctx key holding its computed value. */
export interface DerivedQtyBinding {
  attrId: string;
  ctxKey: string;
}

/**
 * PURE. The attributes this config DERIVES rather than accepts as input, keyed by attribute id.
 * Empty for every config whose components read their quantities from attributes (the pre-slice
 * shape), so a category that was never migrated is byte-unaffected.
 */
export function derivedQtyAttrs(config: RateCategoryConfig): Map<string, DerivedQtyBinding> {
  const defIds = new Set((config.attribute_definitions ?? []).map((d) => d.id));
  const readAsInput = new Set<string>();
  const candidates = new Map<string, string>();
  for (const pl of Object.values(config.pipelines ?? {})) {
    for (const raw of pl.steps ?? []) {
      const s = raw as { name?: string; qty?: unknown };
      const qty = s.qty as { from_attr?: string; from_fit?: string } | undefined;
      if (!qty || typeof qty !== "object") continue;
      if (typeof qty.from_attr === "string") readAsInput.add(qty.from_attr);
      if (typeof qty.from_fit === "string" && typeof s.name === "string" && s.name) {
        const attrId = `${s.name}_qty`;
        if (defIds.has(attrId)) candidates.set(attrId, qty.from_fit);
      }
    }
  }
  const out = new Map<string, DerivedQtyBinding>();
  for (const [attrId, ctxKey] of candidates) {
    // an attribute ANY step still reads as an input stays the user's to set
    if (readAsInput.has(attrId)) continue;
    out.set(attrId, { attrId, ctxKey });
  }
  return out;
}

/**
 * The attribute ids this config COMPUTES rather than accepts as user input.
 *
 * ⚠️ A DERIVED ATTRIBUTE IS NEVER "MISSING INPUT". Leaving one blank means the pricer did not state
 * it, not that the row is incomplete -- the pipeline derives it. Counting one as missing refuses a
 * row the pipeline can price perfectly well, which is exactly what happened: `module_fit`'s ladders
 * BIND `plate_item`, the helper counted it as required, and 26 rows across switches_sockets and
 * point_wiring showed "Complete the missing attributes to price" while the pipeline computed
 * 380/80, 500/100, 290/60 and 1238/667.4 for them.
 *
 * TWO derivation mechanisms, ONE definition of each -- this composes, it does NOT re-implement:
 *   1. `derivedQtyAttrs` (the blanker slice) -- a component taking `qty: {from_fit}` supersedes its
 *      `<name>_qty` attribute. REUSED verbatim; the risk of two copies drifting (#179, three
 *      coercion sites that agreed until they did not) is why this imports rather than repeats it.
 *   2. `module_fit` LADDER BINDS -- `ladders[].bind` names the attribute the fitted rung binds to.
 *      This half is new and lives here only.
 *
 * ⚠️ `bind` IS NOT `floor_from`, and one attribute is BOTH. `plate_item` is its own ladder's
 * `floor_from` (a STATED plate is a floor -- the take-the-larger rule) AND its `bind` (the fitted
 * rung). **Being a bind WINS**: the pipeline can always compute the value, so a blank one is "no
 * floor stated", never "input missing". A `floor_from` attribute that is NOT also a bind stays a
 * genuine input and still blocks when blank.
 *
 * ⚠️ READ FROM CONFIG, never hardcoded by id. `plate_item` / `box_item` are today's binds; a future
 * ladder may bind anything, and a category with no `module_fit` is byte-unaffected. PURE.
 */
/**
 * PURE. The attribute a `module_fit` `blanks` block ARBITRATES on -- the blanker quantity the row
 * states, which the step weighs against the plate's spare capacity.
 *
 * ⚠️ THIS IS WHY THAT FIELD IS NOT READ-ONLY DESPITE LOOKING SUPERSEDED. Its component still takes
 * `qty: {from_fit}`, so `derivedQtyAttrs` -- which keys purely on that shape -- reports it as fully
 * superseded, and branch 1 of `applyDerivedDisplay` would lock it. But `module_fit` now READS the
 * attribute, so it IS an input: the pipeline arbitrates between it and the computed spare, and an
 * edit genuinely reaches the price. A locked field would be the lie the read-only contract exists to
 * prevent, only pointing the other way.
 *
 * ⚠️ READ FROM CONFIG, never by attribute id. A config with no `qty_attr` is byte-unaffected and its
 * quantity stays read-only exactly as before. PURE.
 */
export function blanksQtyAttr(config: RateCategoryConfig): string | undefined {
  for (const pl of Object.values(config.pipelines ?? {})) {
    for (const raw of pl.steps ?? []) {
      const s = raw as { step?: string; params?: { blanks?: { qty_attr?: unknown } } };
      const qa = s.params?.blanks?.qty_attr;
      if (s.step === "module_fit" && typeof qa === "string" && qa) return qa;
    }
  }
  return undefined;
}

/**
 * PURE. The DECLARED attribute on which a `module_fit` `blanks` block's computed item is DISPLAYED.
 * The twin of `blanksQtyAttr`, and read for the same reason: the panel must SHOW what the pipeline
 * decided, and which field it shows on is CONFIG, never an attribute name hardcoded here.
 *
 * ⚠️ `display_attr` IS NOT `bind_item`, AND KEEPING THEM APART IS THE WHOLE POINT.
 * `bind_item` names the key the fitted blanker is published into for the component ref to read
 * (`@blank_fit_item`), and it is DELIBERATELY NOT a declared attribute: because no such attribute
 * exists, the ref is STRUCTURALLY incapable of resolving to the row's own extracted value. That is a
 * property of the id space, not of resolution order, and it is what four pins in
 * `test_rate_master.py` guard.
 *
 * Pointing `bind_item` at the declared `blank_item` instead -- so the computed bind could shadow it
 * -- was tried and REJECTED: it reverses a deliberate earlier decision (the pin at
 * `test_rate_master.py` ~3055 records the ref being moved OFF `@blank_item` when the blanker stopped
 * being selected by extraction) and it downgrades that structural guarantee to a behavioural one
 * resting on `resolveAtRef` checking `fitLabels` before `selected`. This key gives the panel its
 * display target while leaving the bind, and the guarantee, exactly where they were.
 *
 * A config with no `blanks.display_attr` is byte-unaffected.
 */
export function blanksBindItemAttr(config: RateCategoryConfig): string | undefined {
  for (const pl of Object.values(config.pipelines ?? {})) {
    for (const raw of pl.steps ?? []) {
      const s = raw as { step?: string; params?: { blanks?: { display_attr?: unknown } } };
      const da = s.params?.blanks?.display_attr;
      if (s.step === "module_fit" && typeof da === "string" && da) return da;
    }
  }
  return undefined;
}

export function derivedAttrIds(config: RateCategoryConfig): Set<string> {
  const out = new Set<string>(derivedQtyAttrs(config).keys());
  for (const pl of Object.values(config.pipelines ?? {})) {
    for (const raw of pl.steps ?? []) {
      const s = raw as {
        step?: string;
        params?: { ladders?: Array<{ bind?: unknown }>; result_attr?: unknown; bind?: unknown };
      };
      if (s.step === "module_fit") {
        for (const ladder of s.params?.ladders ?? []) {
          if (typeof ladder.bind === "string" && ladder.bind) out.add(ladder.bind);
        }
        // THE SIXTH MECHANISM (slice 5, B1). A `blanks` block may name the DECLARED attribute its
        // computed blanker is displayed on (`display_attr`). The pipeline decides that value from the
        // effective count, so a blank one means "the row did not state it", never "the row is
        // incomplete".
        //
        // ⚠️ THIS IS WHAT UN-GATES `blank_item`. The blanker is inferred from the effective count --
        // owner-locked, "whatever the model returned for blank_item" -- so the field was a required
        // input that nothing read: three live rows showed "Complete the missing attributes to price"
        // for a value the pipeline was already deciding on its own. Exactly the defect the ladder-bind
        // branch above was written for, one block down.
        //
        // ⚠️ `display_attr`, NEVER `bind_item`. `bind_item` is deliberately NOT a declared attribute
        // (see `blanksBindItemAttr`), so adding it here would put an id in this set that no consumer
        // iterates -- harmless but meaningless -- while leaving the real field still gated.
        const da = (s.params as { blanks?: { display_attr?: unknown } } | undefined)?.blanks?.display_attr;
        if (typeof da === "string" && da) out.add(da);
      } else if (s.step === "catalog_fit") {
        // THE FOURTH MECHANISM (slice 2b). A `catalog_fit` BINDS its target from the catalog, so a
        // blank one means "the row did not state an item", never "the row is incomplete".
        //
        // ⚠️ It behaves like a `module_fit` LADDER BIND, not like the read-only blanker quantity: the
        // step's `prefer_attr` reads the SAME attribute and a stated value WINS outright, so the
        // field stays EDITABLE and `readOnly` is never set. That is what keeps the pricer's override
        // surface -- the mechanism that corrected two live rows by hand in slice 2.
        if (typeof s.params?.bind === "string" && s.params.bind) out.add(s.params.bind);
      } else if (s.step === "map_attribute") {
        // THE FIFTH MECHANISM (slice 3b). A `map_attribute` RESOLVES its target -- a stated value,
        // else a config table, else a default -- so a blank one means "the row did not state it",
        // never "the row is incomplete". Without this branch a row stating a gauge but no
        // millimetre value is gated as incomplete BEFORE the pipeline that would fill it ever runs.
        //
        // ⚠️ INERT FOR EVERY SHIPPED CATEGORY EXCEPT CABLE TRAY, and that is not luck: the only
        // other `map_attribute` steps (industrial_sockets' `mcb_pole` / `mcb_curve`) resolve ids
        // that are NOT declared attributes, and every consumer of this set iterates
        // `attribute_definitions`. An id no consumer iterates cannot change anything.
        //
        // ⚠️ Unlike the four other mechanisms, membership here is NOT sufficient on its own: a
        // `map_attribute` can only fill its target when its SOURCE is present on the row, so the
        // missing-attribute gate narrows it PER ROW via `mapAttributeSources` below. This set stays
        // the CONFIG-level answer ("could this ever be derived?"); the row-level answer is the
        // caller's.
        if (typeof s.params?.result_attr === "string" && s.params.result_attr) {
          out.add(s.params.result_attr);
        }
      } else if (s.step === "derive_attribute") {
        // THE THIRD MECHANISM. A `derive_attribute` COMPUTES its target attribute from other
        // attributes, so a blank one means "the row did not state it", never "the row is incomplete".
        //
        // ⚠️ This is NOT cosmetic. point_wiring's `circuit_length_m` used to arrive pre-filled by an
        // `extraction_defaults` entry of 15; removing that default (which is what makes the derivation
        // reachable at all -- an injected value is a STATED value and would win forever) leaves the
        // field blank on every future row. Without this branch the missing-attribute gate below fires
        // and the row prices NOTHING while the pipeline can compute the length perfectly well.
        //
        // Same shape as the two mechanisms above, and the same lesson for the THIRD time: a no-op
        // measured before a dependency lands is not a no-op afterwards.
        if (typeof s.params?.result_attr === "string" && s.params.result_attr) {
          out.add(s.params.result_attr);
        }
      }
    }
  }
  return out;
}

/**
 * SLICE 3b -- the PURE half of the CONDITIONAL exemption (owner ruling R8).
 *
 * `derivedAttrIds` answers "could the pipeline ever fill this?" at CONFIG level. For the four
 * original mechanisms that is also the row-level answer: a ladder, a fit and a formula can always
 * run. A `map_attribute` is the first mechanism that CANNOT -- it fills its target from a SOURCE
 * attribute, and on a row where that source is blank it fills nothing.
 *
 * ⚠️ THIS IS WHY THE EXEMPTION HAD TO BE CONDITIONAL. Exempting a `map_attribute` target
 * wholesale would drop "Complete the missing attributes to price" on every row where nothing can
 * fill it -- 35 of 79 live cable-tray rows -- replacing an instruction the pricer can act on with
 * a refusal they cannot. The owner ruled the message is worth keeping.
 *
 * Returns result_attr -> what it needs. `hasDefault` means the step can always fill it (the
 * curve-else-C shape), so such a target is unconditionally derived and never narrowed.
 *
 * PURE, config-only. The per-row decision belongs to the caller, which is the only place row
 * values exist -- see `pricingSheetHelper`'s pre-pass.
 */
export function mapAttributeSources(
  config: RateCategoryConfig
): Map<string, { fromAttr?: string; hasDefault: boolean }> {
  const out = new Map<string, { fromAttr?: string; hasDefault: boolean }>();
  for (const pl of Object.values(config.pipelines ?? {})) {
    for (const raw of pl.steps ?? []) {
      const s = raw as {
        step?: string;
        params?: { result_attr?: unknown; from_attr?: unknown; default?: unknown };
      };
      if (s.step !== "map_attribute") continue;
      const resultAttr = s.params?.result_attr;
      if (typeof resultAttr !== "string" || !resultAttr) continue;
      const fromAttr = typeof s.params?.from_attr === "string" ? s.params.from_attr : undefined;
      const hasDefault = s.params?.default !== undefined;
      // FIRST WINS, matching every other reader over a set of steps: supply and install carry the
      // identical map steps, so the first occurrence answers for all of them.
      if (!out.has(resultAttr)) out.set(resultAttr, { fromAttr, hasDefault });
    }
  }
  return out;
}
