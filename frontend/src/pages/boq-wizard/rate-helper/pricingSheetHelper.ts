/**
 * RM-3 REAL "Pricing sheet" helper (replaces the U1 stub).
 *
 * The server EXTRACTS attributes (per row, persisted in a run); this helper COMPUTES the rate
 * CLIENT-SIDE from the CURRENT master/config via the RM-2 interpreter -- the SINGLE compute source,
 * imported UNCHANGED from pages/pricing/rate-master. So a rate/param change flows in live without
 * re-running the AI (values always recompute; only the extracted attributes persist).
 *
 * It is a CLOSURE over the page's data (config + master items + the run's extraction-by-row), built
 * once per page and passed as the helper list to buildSuggestions / the panel. Nothing here persists.
 *
 * Owner option (b): a CABLE row shows the cable pipelines AND the PAIRED termination side by side (a
 * display-only reference line); a TERMINATION row shows termination alone. BCS pipelines are NOT
 * surfaced in the helper (owner deferral). Attributes the AI could not read render EMPTY for the
 * pricer to complete -- completing them re-runs the interpreter live (honest partial).
 */
import { runPipeline } from "@/pages/pricing/rate-master/ratePipelineInterpreter";
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
} from "./rateHelperTypes";

export const PRICING_SHEET_HELPER_ID = "pricing_sheet";

/** The rate-kinds the pricing-sheet helper can price for a wiring row (supply/install separately,
 * or a single combined column). Declared on every suggestion so a PARTIAL row (an attribute the AI
 * could not read) still badges -- the pricer opens the panel to complete it. */
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

interface Deps {
  config: RateCategoryConfig;
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

/** Coerce a stringy attribute value to what the interpreter matches on (number for number attrs). */
function coerceForMatch(def: AttributeDefinition, raw: string | number | null): string | number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (def.type === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return String(raw);
}

/** Map a pipeline output key -> the sheet rate-kind it fills. */
function kindForOutput(output: string): string | null {
  if (output.startsWith("supply_")) return "supply_rate";
  if (output.startsWith("install_")) return "install_rate";
  return null;
}

export function makePricingSheetHelper(deps: Deps): RateHelper {
  const { config, items, extractionByRow } = deps;
  const defs = selectableDefs(config);
  const pipelines = config.pipelines ?? {};

  function compute(ctx: RateHelperRowContext, overrides?: Record<string, string>): HelperResult {
    const ext = extractionByRow.get(ctx.excelRow);
    const inRun = !!ext;

    // CATEGORY-SCOPED attributes (owner): the fields shown are the row's CATEGORY's attributes, not
    // a fixed set. This helper defines exactly ONE category (config.category_id); a row of any other
    // category -- or none yet -- has no attribute set defined, so we show a "coming soon" note rather
    // than the wrong (wiring) fields. An in-run row is always this category by construction, so the
    // gate only guards the manual (not-in-run) path. A second category = a second config, later.
    if (!inRun && ctx.category !== config.category_id) {
      return {
        kind: "none",
        reason: "Rate attributes for this category haven't been defined yet — coming soon.",
      };
    }

    // MANUAL FILL (owner request): a row of THIS category that is NOT in the run is still priceable
    // by hand. We proceed with an EMPTY extraction so the panel shows blank, editable attribute
    // fields; filling them re-runs the SAME interpreter live. Such a row NEVER mints a badge
    // (producibleKinds omitted below) -- it is reached only via the always-on cell opener, so it
    // stays "badge-less" until used.

    // Build the workings attributes (pre-filled from extraction, overridable) + the selected map.
    const workingsAttrs: WorkingsAttribute[] = [];
    const selected: Record<string, string | number> = {};
    let missing = false;
    for (const d of defs) {
      const cell = ext?.attributes[d.id];
      const overridden = overrides?.[d.id];
      const rawValue = overridden !== undefined ? overridden : cell?.value ?? null;
      const coerced = coerceForMatch(d, rawValue as string | number | null);
      if (coerced === null) missing = true;
      else selected[d.id] = coerced;
      workingsAttrs.push({
        id: d.id,
        label: d.label,
        options: d.type === "choice" ? (d.values ?? []).map(String) : undefined,
        value: coerced === null ? "" : String(coerced),
        confidence: cell?.confidence,
        corroborated: cell?.corroborated,
      });
    }

    const termination = isTerminationRow(ctx.description);
    const attrLine = workingsAttrs
      .filter((a) => a.value !== "")
      .map((a) => `${a.label} = ${a.value}`)
      .join(", ");

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
          : "Fill the cable attributes to price this row",
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

    // Primary pipeline for this row (BCS deferred -- never surfaced).
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
      // A sheet may carry a single COMBINED rate column instead of separate supply/install. The
      // combined rate = supply + install (the total per-unit rate), so it always has a value when
      // both are present.
      if (typeof values.supply_rate === "number" && typeof values.install_rate === "number") {
        values.combined_rate = values.supply_rate + values.install_rate;
        derivation.push(`combined_rate = supply + install = ${values.combined_rate}`);
      }
      matchedRows.push(
        `Matched ${termination ? "termination" : "cable"} rate row for ${attrLine}.`,
      );
    } else if (result.status === "no_match") {
      derivation.push(`No ${termination ? "termination" : "cable"} rate row matches ${attrLine}.`);
    } else {
      derivation.push(`Pipeline '${primaryId}' has an unsupported step.`);
    }

    // Owner option (b): on a CABLE row, ALSO show the paired termination as a reference line.
    if (!termination) {
      const term = pipelines["termination_boq"] as Pipeline | undefined;
      if (term) {
        const tr = runPipeline("termination_boq", term, items, selected);
        if (tr.status === "ok") {
          const parts = tr.outputs.map((o) => `${o} ${tr.finals[o]}`).join(", ");
          derivation.push(`Paired termination: ${parts}`);
        } else {
          derivation.push("Paired termination: no matching rate row.");
        }
      }
    }

    return {
      kind: "suggestion",
      values,
      producibleKinds: PRODUCIBLE_KINDS,
      basis:
        result.status === "ok"
          ? `Rate master: wiring_cabling @ ${attrLine}`
          : "no match for these attributes",
      workings: {
        attributes: workingsAttrs,
        matchedRows,
        derivation,
        finalValues: { ...values },
      },
    };
  }

  return { id: PRICING_SHEET_HELPER_ID, label: "Pricing sheet", compute };
}
