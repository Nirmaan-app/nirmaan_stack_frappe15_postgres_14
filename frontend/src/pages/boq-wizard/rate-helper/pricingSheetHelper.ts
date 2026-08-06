/**
 * RM-3 REAL "Pricing sheet" helper (replaces the U1 stub) -- EA-2 N-category.
 *
 * The server EXTRACTS attributes (per row, persisted in a run); this helper COMPUTES the rate
 * CLIENT-SIDE from the CURRENT master/config via the RM-2 interpreter -- the SINGLE compute source,
 * imported UNCHANGED from pages/pricing/rate-master. So a rate/param change flows in live without
 * re-running the AI (values always recompute; only the extracted attributes persist).
 *
 * It is a CLOSURE over the page's data (the category configs + master items + the run's
 * extraction-by-row), built once per page and passed as the helper list to buildSuggestions / the
 * panel. Nothing here persists.
 *
 * EA-2: the helper is N-CATEGORY. The config used for a row is resolved FROM THE ROW'S CATEGORY
 * (`configsByCategory`, the registry's eleven). A row computes iff that category has an ELIGIBLE
 * config (non-empty pipelines AND definitions) and the run carries the row. Groups render ONE per
 * NON-BCS pipeline (pipeline ids containing "bcs" are never surfaced -- owner deferral), labelled
 * from `config.pipeline_labels?.[id] ?? prettify(id)`. Honest states: blank-fill for an in-category
 * row outside the run; "coming soon" ONLY for a category with no eligible config (LMS empty
 * pipelines, point_wiring, panels, light_fixtures, or none).
 *
 * WIRING SPECIAL CASE (owner Decision 2, TEMPORARY -- EA-4 designs the generic pairing/assembly
 * mechanism and wiring migrates onto it then): the `wiring_cabling` category keeps its paired
 * Cable + Termination side-by-side display and its cable-vs-termination "primary pipeline" choice.
 * Its group LABELS come from `pipeline_labels` (config data), so only the pairing BEHAVIOUR is
 * special-cased, not the strings. Every OTHER category goes through the generic path.
 */
import { NONE_SENTINEL, runPipeline } from "@/pages/pricing/rate-master/ratePipelineInterpreter";
// CP2: `coerceForMatch` moved to the shared rate-master module (the single point where an attribute
// value becomes a match key); this file imports it and no longer defines it.
import { coerceForMatch, isDropdownAttributeType } from "@/pages/pricing/rate-master/rateMasterStructure";
import type {
  AttributeDefinition,
  Pipeline,
  RateCategoryConfig,
  RateMasterItem,
} from "@/pages/pricing/rate-master/rateMasterTypes";
import type {
  ExtractionRow,
  HelperResult,
  RateHelper,
  RateHelperRowContext,
  WorkingsAttribute,
  WorkingsGroup,
} from "./rateHelperTypes";

export const PRICING_SHEET_HELPER_ID = "pricing_sheet";
const WIRING_CATEGORY_ID = "wiring_cabling";

/** The rate-kinds the pricing-sheet helper can price. Declared on every in-run suggestion so a
 * PARTIAL row (an attribute the AI could not read) still badges -- the pricer opens the panel to
 * complete it. */
const PRODUCIBLE_KINDS = ["supply_rate", "install_rate", "combined_rate"];

/** VERSION KEYING (owner ruling): a stored run only shows when its committed_version equals the
 * sheet's CURRENT committed version -- never suggest against rows that may have changed. PURE. */
export function isRunForVersion(
  runCommittedVersion: number | null | undefined,
  currentCommittedVersion: number | null | undefined,
): boolean {
  return (
    runCommittedVersion != null &&
    currentCommittedVersion != null &&
    runCommittedVersion === currentCommittedVersion
  );
}

/** Build the excel_row -> ExtractionRow map from a run's `results` payload. PURE. */
export function buildExtractionByRow(
  results: Array<{
    excel_row: number;
    description?: string;
    attributes: Record<string, { value: string | number | null; confidence: number; corroborated?: boolean }>;
  }>,
): Map<number, ExtractionRow> {
  const m = new Map<number, ExtractionRow>();
  for (const r of results ?? []) {
    m.set(r.excel_row, { excelRow: r.excel_row, description: r.description, attributes: r.attributes });
  }
  return m;
}

/** A pipeline id is surfaced in the helper iff it is NOT a BCS pipeline (owner deferral). PURE. */
export function isBcsPipelineId(id: string): boolean {
  return id.toLowerCase().includes("bcs");
}

/** Group label for a pipeline: the config's `pipeline_labels` when present (config data), else a
 * prettified id. PURE. */
export function prettifyPipelineId(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
export function pipelineLabel(config: RateCategoryConfig, id: string): string {
  return config.pipeline_labels?.[id] ?? prettifyPipelineId(id);
}

/** The non-BCS pipelines of a config, in declaration order. PURE. */
export function nonBcsPipelines(config: RateCategoryConfig): Array<[string, Pipeline]> {
  return Object.entries(config.pipelines ?? {}).filter(([id]) => !isBcsPipelineId(id));
}

/** A category participates in the helper iff its config has BOTH non-empty pipelines AND non-empty
 * attribute definitions (an empty-pipelines DATA-ONLY config -- e.g. lighting_mgmt_system -- is not
 * eligible; it shows "coming soon"). PURE. */
export function isEligibleConfig(config: RateCategoryConfig | null | undefined): boolean {
  return (
    !!config &&
    Object.keys(config.pipelines ?? {}).length > 0 &&
    (config.attribute_definitions ?? []).length > 0
  );
}

interface Deps {
  /** Legacy single-category form (RM-3 tests): the ONE config this helper serves. */
  config?: RateCategoryConfig;
  /** EA-2 N-category form (the page): resolve the config FROM the row's category. */
  configsByCategory?: Map<string, RateCategoryConfig>;
  items: RateMasterItem[];
  /** excel_row -> the run's extraction for that row. */
  extractionByRow: Map<number, ExtractionRow>;
}

/** cable vs termination from the row text (a termination line prices the gland/lug set). */
function isTerminationRow(description: string): boolean {
  return /\b(termination|gland|glanding|lug)s?\b/i.test(description);
}

/** Selectable attribute defs (exclude brand -- fixed, not a pipeline-match dimension). */
function selectableDefs(config: RateCategoryConfig): AttributeDefinition[] {
  return (config.attribute_definitions ?? []).filter((d) => d.selector !== false);
}

/** EA-4a: the panel options for a choice def. A def may resolve its allowed values FROM the live
 * master (`values_from`) rather than a static `values` list -- point_wiring's switch/socket/plate
 * selects, keyed by family. Resolve them here from `items` (the discipline set the page passes),
 * the SAME live read the backend injects into the extraction prompt AND the RateMaster Derivation
 * screen uses -- so an AI-extracted item that is NOT in `values` (there is none) still has a matching
 * option and DISPLAYS, and a partial row can be completed from the catalog. PURE. */
export function attributeOptions(def: AttributeDefinition, items: RateMasterItem[]): string[] {
  const vf = def.values_from;
  const base: string[] = [];
  if (!vf) {
    base.push(...(def.values ?? []).map((v) => String(v)));
  } else {
    const seen = new Set<string>();
    for (const it of items) {
      if (it.kind !== vf.kind) continue;
      const a = it.attributes ?? {};
      if (!Object.entries(vf.where ?? {}).every(([k, v]) => a[k] === v)) continue;
      const raw = a[vf.attr];
      const val = typeof raw === "string" ? raw.trim() : raw;
      if (val !== undefined && val !== null && val !== "" && !seen.has(String(val))) {
        seen.add(String(val));
        base.push(String(val));
      }
    }
  }
  // EA-4a-r: an allow_none def offers the "None" sentinel (positive absence) at the TOP of the list.
  return def.allow_none ? [NONE_SENTINEL, ...base] : base;
}

/** Map a pipeline output key -> the sheet rate-kind it fills. EA-4a: the assembly categories name their
 * outputs `supply` / `install` (no per-unit suffix), so match those EXACTLY as well as the legacy
 * `supply_*` / `install_*` (conduit/wiring per-mtr, switches per-set). */
function kindForOutput(output: string): string | null {
  if (output === "supply" || output.startsWith("supply_")) return "supply_rate";
  if (output === "install" || output.startsWith("install_")) return "install_rate";
  return null;
}

export function makePricingSheetHelper(deps: Deps): RateHelper {
  const { config, configsByCategory, items, extractionByRow } = deps;

  /** Resolve the config for a row's category. N-category: look it up in the map. Legacy single-config:
   * serve it ONLY for its own category (a different / null category -> none -> coming soon). */
  function resolveConfig(category: string | null): RateCategoryConfig | null {
    if (configsByCategory) return (category && configsByCategory.get(category)) || null;
    if (config && category && config.category_id === category) return config;
    return null;
  }

  function compute(ctx: RateHelperRowContext, overrides?: Record<string, string>): HelperResult {
    const ext = extractionByRow.get(ctx.excelRow);
    const inRun = !!ext;

    // CATEGORY-SCOPED (owner): the fields shown are the row's CATEGORY's attributes. A row whose
    // category has no ELIGIBLE config (unknown category, or a DATA-ONLY empty-pipelines config such
    // as lighting_mgmt_system) shows a "coming soon" note rather than the wrong fields. An in-run row
    // always resolves to its own eligible category by construction.
    const cfg = resolveConfig(ctx.category);
    if (!isEligibleConfig(cfg)) {
      return {
        kind: "none",
        reason: "Rate attributes for this category haven't been defined yet — coming soon.",
      };
    }
    const category = cfg!;
    const defs = selectableDefs(category);

    // EA-4a-r: which defs are DISABLED because an allow_none controller is set to "None" (positive
    // absence) -- e.g. plate_item="None" disables plate_qty AND back_box. A controller can disable a def
    // that appears BEFORE it in the list (wire2_thickness_sqmm controls wire2_core), so resolve in a
    // pre-pass. A disabled target is greyed + cleared and is NOT treated as an unknown (never blocks).
    const valueOfDef = (d: AttributeDefinition): string | number | null => {
      const ov = overrides?.[d.id];
      const raw = ov !== undefined ? ov : ext?.attributes[d.id]?.value ?? null;
      return coerceForMatch(d, raw as string | number | null);
    };
    const disabledByNone = new Set<string>();
    for (const d of defs) {
      if (d.allow_none && d.disables_when_none && valueOfDef(d) === NONE_SENTINEL) {
        for (const t of d.disables_when_none) disabledByNone.add(t);
      }
    }

    // Build the workings attributes (pre-filled from extraction, overridable) + the selected map.
    const workingsAttrs: WorkingsAttribute[] = [];
    const selected: Record<string, string | number> = {};
    const defaulted: string[] = []; // EA-4a: attrs the extraction filled from a config default
    let missing = false;
    for (const d of defs) {
      const cell = ext?.attributes[d.id];
      const overridden = overrides?.[d.id];
      const disabled = disabledByNone.has(d.id);
      const rawValue = disabled ? null : overridden !== undefined ? overridden : cell?.value ?? null;
      const coerced = coerceForMatch(d, rawValue as string | number | null);
      // A disabled target is POSITIVELY absent (its controller is None) -- clear it, do NOT flag missing.
      if (coerced === null) { if (!disabled) missing = true; }
      else selected[d.id] = coerced;
      // A defaulted attribute is one the model filled from the config default (no positive text
      // identification); the pricer should see WHICH values came from a default, not read (EA-4a). An
      // override (the pricer typed it) clears the defaulted mark.
      // U2: `defaulted` is now DECLARED on ExtractedAttr, so the undeclared cast is gone. The SAME
      // condition drives both surfaces -- the prose trace line below AND the per-attribute flag the
      // panel tints -- so the two can never disagree about which values came from a default.
      const isDefaulted =
        !disabled && overridden === undefined && coerced !== null && cell?.defaulted === true;
      if (isDefaulted) {
        defaulted.push(`${d.label}=${coerced}`);
      }
      workingsAttrs.push({
        id: d.id,
        label: d.label,
        // CP2: a `number_choice` renders the SAME dropdown as a `choice` (one predicate, shared with
        // the Derivation screen) -- only the coercion above differs, and that is the whole point.
        options: isDropdownAttributeType(d.type) ? attributeOptions(d, items) : undefined,
        value: coerced === null ? "" : String(coerced),
        confidence: disabled ? undefined : cell?.confidence,
        corroborated: disabled ? undefined : cell?.corroborated,
        disabled: disabled || undefined,
        allowNone: d.allow_none || undefined,
        defaulted: isDefaulted || undefined,
      });
    }

    // Honest partial: an attribute the AI could not read (in-run) OR a manual row (not in the run)
    // -> keep attributes editable, no value. An IN-RUN partial still BADGES (producibleKinds) so the
    // pricer can open it; a MANUAL row must NOT badge (omit producibleKinds) -- it is reached only
    // through the always-on opener and stays badge-less until a value is used.
    if (missing) {
      return {
        kind: "suggestion",
        values: {},
        ...(inRun ? { producibleKinds: PRODUCIBLE_KINDS } : {}),
        basis: inRun
          ? "Complete the missing attributes to price"
          : "Fill the attributes to price this row",
        workings: {
          attributes: workingsAttrs,
          matchedRows: [],
          derivation: [
            inRun
              ? "Some attributes are missing -- fill them to compute a rate."
              : "Not in the suggestion run -- fill the attributes to compute a rate.",
          ],
          finalValues: {},
        },
      };
    }

    const attrLine = workingsAttrs
      .filter((a) => a.value !== "")
      .map((a) => `${a.label} = ${a.value}`)
      .join(", ");

    // WIRING SPECIAL CASE (owner Decision 2, temporary): paired Cable + Termination display and the
    // cable-vs-termination primary choice. Group labels come from config.pipeline_labels.
    if (category.category_id === WIRING_CATEGORY_ID) {
      return computeWiring(category, items, selected, ctx, workingsAttrs, attrLine);
    }

    // GENERIC PATH: run every NON-BCS pipeline; each is one group (labelled from config data / a
    // prettified id). Values (the appliable supply/install/combined) come from the FIRST non-BCS
    // pipeline (the category's primary), so a single-pipeline category prices exactly that pipeline.
    const surfaced = nonBcsPipelines(category);
    if (surfaced.length === 0) {
      return { kind: "none", reason: `No priceable pipeline in the ${category.category_id} config` };
    }
    const values: Record<string, number> = {};
    const sections: WorkingsGroup[] = [];
    const flatDerivation: string[] = [];
    const flatMatched: string[] = [];
    surfaced.forEach(([pid, pl], idx) => {
      const res = runPipeline(pid, pl as Pipeline, items, selected);
      const finals: Record<string, number> = {};
      const derivation: string[] = [];
      const matchedRows: string[] = [];
      if (res.status === "ok") {
        for (const o of res.outputs) {
          finals[o] = res.finals[o];
          derivation.push(`${o} = ${res.finals[o]}`);
          // EA-4a: a category may split supply + install across SEPARATE pipelines (point_wiring's
          // pw_boq_supply / pw_boq_install, cabletray). Take each rate-kind from the FIRST pipeline
          // that produces it -- a single combined pipeline (conduit) still fills both from its one pass.
          const kind = kindForOutput(o);
          if (kind && values[kind] === undefined) values[kind] = res.finals[o];
        }
        // EA-4a: the assembly categories expose their per-component build-up as the step traces; surface
        // each component line (name = value) in the group so the pricer sees the bill, not just the total.
        for (const st of res.steps) {
          if (st.produced && st.refItem) matchedRows.push(`${st.produced.key}: ${st.refItem} = ${st.produced.value}`);
        }
        flatMatched.push(`Matched ${pid} for ${attrLine}.`);
      } else if (res.status === "no_match") {
        derivation.push(`No ${pid} rate row matches ${attrLine}.`);
      } else {
        derivation.push(`Pipeline '${pid}' has an unsupported step.`);
      }
      if (idx === 0) flatDerivation.push(...derivation);
      sections.push({ label: pipelineLabel(category, pid), derivation, finals, ...(matchedRows.length ? { matchedRows } : {}) });
    });
    // Combine AFTER scanning every pipeline -- supply + install may come from different pipelines
    // (point_wiring / cabletray). A single combined pipeline (conduit) also lands here; the combined
    // line is added to its one group so its in-group display is unchanged.
    if (typeof values.supply_rate === "number" && typeof values.install_rate === "number") {
      values.combined_rate = values.supply_rate + values.install_rate;
      const combinedLine = `combined_rate = supply + install = ${values.combined_rate}`;
      flatDerivation.push(combinedLine);
      if (sections.length === 1) sections[0].derivation.push(combinedLine);
    }
    // EA-4a: surface the attributes that came from a config default (not positively read from the text)
    // so the pricer sees, and can correct, every defaulted value before using the rate.
    if (defaulted.length) {
      flatDerivation.push(`(defaulted -- no positive text identification): ${defaulted.join(", ")}`);
    }

    return {
      kind: "suggestion",
      values,
      producibleKinds: PRODUCIBLE_KINDS,
      basis: Object.keys(values).length
        ? `Rate master: ${category.category_id} @ ${attrLine}`
        : "no match for these attributes",
      workings: {
        attributes: workingsAttrs,
        matchedRows: flatMatched,
        derivation: flatDerivation,
        finalValues: { ...values },
        sections,
      },
    };
  }

  return { id: PRICING_SHEET_HELPER_ID, label: "Pricing sheet", compute };
}

/** The wiring paired Cable + Termination computation (owner Decision 2, temporary). Extracted so the
 * generic path stays clean. Group labels come from the config's pipeline_labels. */
function computeWiring(
  config: RateCategoryConfig,
  items: RateMasterItem[],
  selected: Record<string, string | number>,
  ctx: RateHelperRowContext,
  workingsAttrs: WorkingsAttribute[],
  attrLine: string,
): HelperResult {
  const pipelines = config.pipelines ?? {};
  const termination = isTerminationRow(ctx.description);

  const primaryId = termination ? "termination_boq" : "cable_boq";
  const primary = pipelines[primaryId] as Pipeline | undefined;
  if (!primary) {
    return { kind: "none", reason: `No ${primaryId} pipeline in the config` };
  }
  const result = runPipeline(primaryId, primary, items, selected);
  const values: Record<string, number> = {};
  const derivation: string[] = [];
  const matchedRows: string[] = [];

  if (result.status === "ok") {
    for (const o of result.outputs) {
      const kind = kindForOutput(o);
      if (kind) values[kind] = result.finals[o];
      derivation.push(`${o} = ${result.finals[o]}`);
    }
    if (typeof values.supply_rate === "number" && typeof values.install_rate === "number") {
      values.combined_rate = values.supply_rate + values.install_rate;
      derivation.push(`combined_rate = supply + install = ${values.combined_rate}`);
    }
    matchedRows.push(`Matched ${termination ? "termination" : "cable"} rate row for ${attrLine}.`);
  } else if (result.status === "no_match") {
    derivation.push(`No ${termination ? "termination" : "cable"} rate row matches ${attrLine}.`);
  } else {
    derivation.push(`Pipeline '${primaryId}' has an unsupported step.`);
  }

  // A CABLE row shows the Cable pipeline AND the paired Termination as TWO labelled blocks; a
  // TERMINATION row keeps a SINGLE flat block (no `sections`, backward-shaped). Labels are config data.
  let sections: WorkingsGroup[] | undefined;
  if (!termination) {
    const cableFinals: Record<string, number> = {};
    if (result.status === "ok") {
      for (const o of result.outputs) cableFinals[o] = result.finals[o];
      if (typeof values.combined_rate === "number") cableFinals.combined_per_mtr = values.combined_rate;
    }
    const cableGroup: WorkingsGroup = {
      label: pipelineLabel(config, "cable_boq"),
      derivation: [...derivation],
      finals: cableFinals,
      matchedRows: [...matchedRows],
    };
    const termGroup: WorkingsGroup = {
      label: pipelineLabel(config, "termination_boq"),
      derivation: [],
      finals: {},
    };
    const term = pipelines["termination_boq"] as Pipeline | undefined;
    if (term) {
      const tr = runPipeline("termination_boq", term, items, selected);
      if (tr.status === "ok") {
        for (const o of tr.outputs) {
          termGroup.finals[o] = tr.finals[o];
          termGroup.derivation.push(`${o} = ${tr.finals[o]}`);
        }
      } else {
        termGroup.derivation.push("No matching termination rate row.");
      }
    } else {
      termGroup.derivation.push("No termination pipeline in the config.");
    }
    sections = [cableGroup, termGroup];
  }

  return {
    kind: "suggestion",
    values,
    producibleKinds: PRODUCIBLE_KINDS,
    basis:
      result.status === "ok"
        ? `Rate master: ${config.category_id} @ ${attrLine}`
        : "no match for these attributes",
    workings: {
      attributes: workingsAttrs,
      matchedRows,
      derivation,
      finalValues: { ...values },
      ...(sections ? { sections } : {}),
    },
  };
}
