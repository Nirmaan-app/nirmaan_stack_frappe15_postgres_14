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
import { runPipeline } from "./ratePipelineInterpreter";

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
  "component_band",
  "sum_components",
  "install_as_ratio",
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
    case "component_band":
      return { step: "component_band", name: "", band_on: "", bands: [], params: {} };
    case "sum_components":
      return { step: "sum_components", result: "" };
    case "install_as_ratio":
      return { step: "install_as_ratio", result: "", params: { ratio: 0.25 } };
    default:
      return { step: type };
  }
}

/** Client mirror of the server reference guard: the attribute ids a pipeline references (every
 * apply_effective_multiplier condition `when` key + every component_band `band_on`). Removing a
 * definition still in this set is rejected server-side; the editor uses it to warn pre-save. */
export function referencedAttrIds(config: RateCategoryConfig): Set<string> {
  const out = new Set<string>();
  for (const pl of Object.values(config.pipelines ?? {})) {
    for (const raw of pl.steps ?? []) {
      const s = raw as { step: string; conditions?: { when?: Record<string, unknown> }[]; band_on?: string };
      if (s.step === "apply_effective_multiplier") {
        for (const c of s.conditions ?? []) {
          for (const k of Object.keys(c.when ?? {})) out.add(k);
        }
      } else if (s.step === "component_band" && typeof s.band_on === "string" && s.band_on) {
        out.add(s.band_on);
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
