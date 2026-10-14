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
import {
  catalogFitOutcomes,
  derivedAttrOutcomes,
  mapAttributeOutcomes,
  moduleFitOutcome,
  NONE_SENTINEL,
  runPipeline,
} from "@/pages/pricing/rate-master/ratePipelineInterpreter";
import { labelAsWord, mirroredLead, plainFact, plainPricerText, TYPED_LEAD } from "@/pages/pricing/rate-master/plainEnglish";
// CP2: `coerceForMatch` moved to the shared rate-master module (the single point where an attribute
// value becomes a match key); this file imports it and no longer defines it.
import {
  blanksQtyAttr,
  blanksBindItemAttr,
  coerceForMatch,
  derivedAttrIds,
  derivedQtyAttrs,
  isDropdownAttributeType,
  mapAttributeSources,
} from "@/pages/pricing/rate-master/rateMasterStructure";
// DERIVED-ATTRIBUTE GATE: the `<name>_qty` half of derivation has ONE definition and this reuses
// it rather than repeating it (see derivedAttrIds below).
import { derivedQtyValue } from "@/pages/pricing/rate-master/RateMasterDerivation";
import type {
  AttributeDefinition,
  ModuleFitLadderOutcome,
  Pipeline,
  PipelineResult,
  RateCategoryConfig,
  RateMasterItem,
} from "@/pages/pricing/rate-master/rateMasterTypes";
import { POLE_WORDS, attrDisplayValue, sortAttrNotes } from "./rateHelperTypes";
// SLICE 6 (owner S1-S5, 2026-09-24): the item-list mode prices a LIST of items per row through the pure module;
// the helper only assembles the list (the model's items overlaid with the panel's session edits) and shapes the
// result for the panel. Every default, ladder and conversion stays in the module + config.
import {
  delegatedSections,
  familyAttr,
  familyChoices,
  familyUnitClasses,
  fieldOptionsFromSkus,
  inchWithMmEcho,
  itemFieldDefs,
  itemListPricingSpec,
  matchStatedToOption,
  matchStatedToOptionDetailed,
  plainFactOf,
  readLayers,
  readNumber,
  severalSizesTaken,
  listSpecDefs,
  priceItemList,
  sizeFieldHelp,
  twoWayValues,
  typedFieldNote,
  unitClassOf,
  type ExtractedListItem,
  type ItemFieldDef,
  type ItemListPricingSpec,
  type ItemPriceResult,
  type LadderHop,
} from "./itemListPricing";
import type {
  AttrNote,
  ExtractedAttr,
  ExtractionRow,
  HelperResult,
  RateHelper,
  RateHelperRowContext,
  RateKind,
  Suggestion,
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
    /** SLICE 6: an item-list row's stored items (slice 4's `results[i].items`); absent on every other row. */
    items?: ExtractedListItem[];
  }>,
): Map<number, ExtractionRow> {
  const m = new Map<number, ExtractionRow>();
  for (const r of results ?? []) {
    const row: ExtractionRowWithItems = { excelRow: r.excel_row, description: r.description, attributes: r.attributes };
    // carried ONLY when present, so a non-list row's map entry is byte-identical to before
    if (Array.isArray(r.items)) row.items = r.items;
    m.set(r.excel_row, row);
  }
  return m;
}

/** SLICE 6: an extraction row that may carry the run's ITEMS (an item-list category). The base type lives
 * outside this slice's scope, so the items ride as an optional extension read through this alias. */
export type ExtractionRowWithItems = ExtractionRow & { items?: ExtractedListItem[] };

/** SLICE 6: a row context that may carry the BoQ row's UNIT (the page attaches it; the calculator has no row,
 * so the unit is a pick held in the panel's session state instead). */
export type RowContextWithUnit = RateHelperRowContext & {
  unit?: string | null;
  /** SLICE 12e-3c: set by the section pass on the context it hands a DELEGATED category when the row is the
   * calculator's. A section is always handed the row's unit, so "no unit supplied" cannot tell it that there
   * is no row; this does. Absent everywhere else. */
  noRow?: boolean;
  /** SLICE 12e-5 (AC1): set by the section pass to the numbers axis its pipe's size reaches. An item of the
   * delegated category refusing AT THAT NEED shows the defaults it had read (`ItemPriceResult.heldDefaults`)
   * exactly as a priced item shows its own. Absent everywhere else, so no category's own row changes. */
  showHeldDefaultsOn?: string;
};

/** A pipeline id is surfaced in the helper iff it is NOT a BCS pipeline (owner deferral). PURE. */
export function isBcsPipelineId(id: string): boolean {
  return id.toLowerCase().includes("bcs");
}

/** Prettify a snake_case id ("conduit_boq" -> "Conduit Boq"). PURE. The LAST fallback only. */
export function prettifyPipelineId(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The category's human label: the config's `category_display` (config data), else a prettified
 * category id. PURE. The ONE place a category is named to the pricer in this helper. */
export function categoryLabel(config: RateCategoryConfig): string {
  const d = config.category_display;
  return typeof d === "string" && d.trim() !== "" ? d : prettifyPipelineId(config.category_id);
}

/** The pricer's word for a pipeline output: "Supply" / "Install" for an output that fills a rate
 * kind, else the output name itself. PURE. */
export function outputWord(output: string): string {
  const k = kindForOutput(output);
  return k === "supply_rate" ? "Supply" : k === "install_rate" ? "Install" : output;
}

/**
 * Group label for a pipeline: the config's `pipeline_labels` when present (config data), else the
 * CATEGORY's label, suffixed with the rate kind(s) the pipeline produces when the category surfaces
 * more than one pipeline. PURE.
 *
 * Calculator slice 1 (owner 2026-09-08, "ok. reword"): the fallback used to be a prettified
 * pipeline id ("Swsock Boq", "Pw Boq Supply") -- an internal name on the screen. It is now
 * "Switches and Sockets", "Point Wiring — Supply" / "Point Wiring — Install", which reads the same
 * on a BoQ row and on a no-row calculator. Config data still wins (wiring's two labels are untouched).
 */
export function pipelineLabel(config: RateCategoryConfig, id: string): string {
  const fromConfig = config.pipeline_labels?.[id];
  if (fromConfig) return fromConfig;
  const base = categoryLabel(config);
  const surfaced = nonBcsPipelines(config);
  if (surfaced.length <= 1) return base;
  const outputs = (config.pipelines?.[id] as Pipeline | undefined)?.output ?? [];
  const kinds = Array.from(new Set(outputs.map((o) => kindForOutput(o)).filter((k): k is string => k !== null)));
  const words = kinds.map((k) => (k === "supply_rate" ? "Supply" : "Install"));
  // Both kinds (or none) => the pipeline IS the category's rate; no suffix says anything.
  return words.length === 1 ? `${base} — ${words[0]}` : base;
}

/**
 * PURE. ONE group's three figures from ITS OWN `finals`: each rate kind from the first output that
 * fills it, and `combined_rate` = THIS group's supply + THIS group's install when both exist.
 *
 * ⚠️ THE NEVER-SUMMED INVARIANT LIVES IN THE SIGNATURE: the function sees ONE `finals` map, so it
 * cannot add two groups. Cable (per Mtr) and Termination (per Set) each get their own combined; no
 * code path folds them, and none may be added. Both wiring `headlines` entries and every section's
 * `figures` are produced here -- one definition, so a headline and its section can never disagree.
 * A `combined_*` output already present in `finals` (cable's `combined_per_mtr`) maps to no kind
 * and is ignored; combined is always re-derived from the two halves.
 */
export function groupFigures(finals: Record<string, number>): Partial<Record<RateKind, number>> {
  const out: Partial<Record<RateKind, number>> = {};
  for (const [o, v] of Object.entries(finals)) {
    const k = kindForOutput(o) as RateKind | null;
    if (k && out[k] === undefined) out[k] = v;
  }
  if (typeof out.supply_rate === "number" && typeof out.install_rate === "number") {
    out.combined_rate = out.supply_rate + out.install_rate;
  }
  return out;
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
    hasRunnablePricingRules(config) &&
    (config.attribute_definitions ?? []).length > 0
  );
}

/**
 * SLICE 12d-2 (owner S1, 2026-10-07) -- DOES THIS CONFIG CARRY PRICING RULES THAT RUN? Either
 * non-empty top-level `pipelines` (every row-level category; ADP's shared per-item default, which
 * really runs for 29 of its 30 unit blocks), OR an item-list pricing block (`list_spec.pricing`,
 * read through `itemListPricingSpec`) whose unit blocks carry their own pipelines (Insulation: 7 of 7).
 *
 * ⚠️ WHY THE SECOND ARM EXISTS, measured rather than assumed (the Python `test_fa7_09`): every
 * Insulation unit block has its own pipelines, so a top-level `pipelines` entry added merely to
 * satisfy the old `pipelines`-only test would be a key that VALIDATES AND NEVER EXECUTES -- the
 * defect class the owner locked out on 2026-09-10. The generic predicate therefore recognises the
 * place an item-list category keeps its rules, and Insulation's `pipelines` stays honestly empty.
 *
 * ⚠️ "RUN" IS THE WORD THAT CARRIES THE WEIGHT. Without a top-level default, an item-list block
 * runs only if EVERY unit block and every convert option carries pipelines of its own -- a block
 * without them would fall back to a default that does not exist and price nothing. So a pricing
 * block with un-piped blocks and no default (ADP as it stood at v7, before its default shipped)
 * reads NOT runnable, exactly as the slice-5 / slice-6 pins say.
 * This RETIRED the 12c FINISH / FA7 `calculator_only` admission (`isCalculatorOnlyConfig`,
 * `isCalculatorPriceableConfig`, the `admitCalculatorOnly` dep): the ONE predicate now admits the
 * category on every surface -- the BoQ panel, the calculator, the pre-run rules -- and the server's
 * `extraction.has_runnable_pricing_rules` is its mirror. No discipline or category named. PURE.
 */
export function hasRunnablePricingRules(config: RateCategoryConfig | null | undefined): boolean {
  if (!config) return false;
  if (Object.keys(config.pipelines ?? {}).length > 0) return true;
  const spec = itemListPricingSpec(config);
  if (!spec) return false;
  const fams = Object.values(spec.families ?? {});
  if (fams.length === 0) return false;
  const piped = (b: { pipelines?: Record<string, unknown> } | undefined) => Object.keys(b?.pipelines ?? {}).length > 0;
  return fams.every((fam) => {
    const units = Object.values(fam.units ?? {});
    if (units.length === 0) return false;
    if (!units.every((u) => piped(u))) return false;
    return Object.values(fam.convert ?? {}).every((opts) => (opts ?? []).every((o) => piped(o as { pipelines?: Record<string, unknown> })));
  });
}

/**
 * SLICE 3 (2026-09-22, owner Q-a / Q-b) -- THE ONE alias resolution on the frontend, used by the helper's
 * `resolveConfig` AND by the calculator's layout reads. A config carrying `alias_of` resolves ONE HOP to
 * the target config when that target is in the map; otherwise (missing target, or no alias) the config
 * itself comes back -- an alias holds no pipelines, so an unresolved alias, and a CHAIN (alias -> alias),
 * read as NOT eligible and show the coming-soon card, never an error. No discipline or category is
 * named here: the key is data (the HV-10 rule). PURE.
 */
export function resolveAliasConfig(
  configsByCategory: ReadonlyMap<string, RateCategoryConfig>,
  categoryId: string | null | undefined,
): RateCategoryConfig | null {
  const own = (categoryId && configsByCategory.get(categoryId)) || null;
  const target = own?.alias_of;
  if (!target || typeof target.category_id !== "string" || target.category_id.trim() === "") return own;
  return configsByCategory.get(target.category_id) ?? own;
}

/** SLICE 3: is this config an alias (carries a usable `alias_of`)? PURE. */
export function isAliasConfig(config: RateCategoryConfig | null | undefined): boolean {
  const a = config?.alias_of;
  return !!a && typeof a.category_id === "string" && a.category_id.trim() !== "";
}

/** The generic decline the helper has always given a category with no eligible config. */
export const COMING_SOON_REASON = "Rate attributes for this category haven't been defined yet — coming soon.";

/**
 * SLICE 2 (2026-09-22, owner P-a / P-b -- J4): the NoSuggestion reason for a category with NOTHING TO
 * PRICE. A config may declare its own message IN CONFIG (`helper_message`, e.g. "Take Vendor
 * Quotation" on a vendor-quote category -- never a category named in code, the HV-10 rule); a config
 * without it, and no config at all, get today's coming-soon text byte-for-byte. PURE.
 */
export function declineReasonFor(config: RateCategoryConfig | null | undefined): string {
  const m = config?.helper_message;
  return typeof m === "string" && m.trim() !== "" ? m : COMING_SOON_REASON;
}

/**
 * SLICE 2 (J5, owner P-d), RE-RULED AT SLICE 3 (owner, 2026-09-22): does a DISCIPLINE have nothing to
 * RUN -- at least one of its registry configs has arrived and NONE of them is an eligible config OF ITS
 * OWN? An ALIAS config does NOT count as the discipline's own, whatever its target. For such a
 * discipline the page shows the real pricing-sheet helper with an EMPTY extraction map BEFORE any run
 * (the calculator's construction): vendor-quote rows keep their `helper_message`, data-only rows keep
 * "coming soon", and an aliased row shows the helper card with the target's fields. A discipline with
 * an eligible config of its own (Electrical) is FALSE, so its before-run panel is exactly today's; an
 * unregistered or unresolved discipline is FALSE; a discipline none of whose configs has loaded yet is
 * FALSE (never decide on an empty map). No discipline or category is named here. PURE.
 */
export function disciplineHasNothingToRun(
  discipline: string | null | undefined,
  configsByCategory: ReadonlyMap<string, RateCategoryConfig>,
  targets: ReadonlyArray<{ discipline: string; categoryId: string }>,
): boolean {
  if (!discipline) return false;
  const ids = targets.filter((t) => t.discipline === discipline).map((t) => t.categoryId);
  if (!ids.some((id) => configsByCategory.has(id))) return false;
  return !ids.some((id) => {
    const cfg = configsByCategory.get(id);
    return !isAliasConfig(cfg) && isEligibleConfig(cfg);
  });
}

/**
 * SLICE 6 (owner U5 + U6, 2026-09-24) -- PURE. Does this DISCIPLINE declare before-run cards? True when at least one
 * fetched config of the discipline is an alias or is not eligible (a message-only vendor-quote config): those are
 * exactly the configs the pre-run helper renders as a card of their own before any run. A discipline whose every
 * fetched config is eligible declares none.
 */
export function disciplineDeclaresPreRunCards(
  discipline: string | null | undefined,
  configsByCategory: ReadonlyMap<string, RateCategoryConfig>,
  targets: ReadonlyArray<{ discipline: string; categoryId: string }>,
): boolean {
  if (!discipline) return false;
  return targets.some((t) => {
    if (t.discipline !== discipline) return false;
    const cfg = configsByCategory.get(t.categoryId);
    return !!cfg && (isAliasConfig(cfg) || !isEligibleConfig(cfg));
  });
}

/**
 * SLICE 6 (owner U5 + U6, 2026-09-24) -- PURE. Does THIS ROW use the pre-run helper (the real helper over an empty
 * extraction map) before a run? Two grounds, either suffices: the row's DISCIPLINE has nothing to run
 * (`disciplineHasNothingToRun`, the slice-3 rule, unchanged), OR the row ITSELF has nothing to run (no config, an
 * alias, a message-only / not-eligible config) AND its discipline declares before-run cards
 * (`disciplineDeclaresPreRunCards`). Until ADP went eligible the first ground covered every HVAC row; once a
 * discipline has an eligible config of its own, the second is what keeps every OTHER row on the card it had -- the
 * vendor-quote message, the aliased helper card, and the coming-soon card of a category with no config at all. An
 * Electrical row is unchanged on both grounds: its discipline has eligible configs and declares no before-run card,
 * so even a row whose category has no config keeps the before-run list it always had. The discipline-level opt-in
 * is what keeps BOTH histories intact without naming either discipline; a row with an eligible config of its own
 * never uses the pre-run helper. No discipline or category is named here.
 */
export function rowUsesPreRunHelper(
  discipline: string | null | undefined,
  categoryId: string | null | undefined,
  configsByCategory: ReadonlyMap<string, RateCategoryConfig>,
  targets: ReadonlyArray<{ discipline: string; categoryId: string }>,
): boolean {
  if (disciplineHasNothingToRun(discipline, configsByCategory, targets)) return true;
  const own = categoryId ? configsByCategory.get(categoryId) : undefined;
  if (own && !isAliasConfig(own) && isEligibleConfig(own)) return false;   // the row has something to run
  return disciplineDeclaresPreRunCards(discipline, configsByCategory, targets);
}

/**
 * SLICE 3 (owner ruling 2026-09-22, superseding slice 2's decline-only card): the BEFORE-A-RUN helper for
 * a discipline with nothing to run is the REAL pricing-sheet helper over an EMPTY extraction map -- the
 * calculator's exact construction. A not-eligible / absent config still declines (`declineReasonFor`),
 * so the vendor-quote and coming-soon cards are byte-identical to slice 2; an eligible (or aliased)
 * category shows its fields. The page hands it to the panel ONLY (never the badge list). The shared
 * empty map keeps the helper's identity stable across renders. PURE.
 */
export const EMPTY_EXTRACTION_MAP: ReadonlyMap<number, ExtractionRow> = new Map();
export function makePreRunHelper(
  configsByCategory: Map<string, RateCategoryConfig>,
  items: RateMasterItem[],
): RateHelper {
  return makePricingSheetHelper({ configsByCategory, items, extractionByRow: EMPTY_EXTRACTION_MAP as Map<number, ExtractionRow> });
}

interface Deps {
  /** Legacy single-category form (RM-3 tests): the ONE config this helper serves. */
  config?: RateCategoryConfig;
  /** EA-2 N-category form (the page): resolve the config FROM the row's category. */
  configsByCategory?: Map<string, RateCategoryConfig>;
  items: RateMasterItem[];
  /** excel_row -> the run's extraction for that row. */
  extractionByRow: Map<number, ExtractionRow>;
  // SLICE 12d-2: the FA7 `admitCalculatorOnly` dep is RETIRED -- `isEligibleConfig` admits an
  // item-list category on every surface, so the calculator and the BoQ panel build this helper identically.
}

/** Cable vs termination from the row text (a termination line prices the gland/lug set).
 *
 * ⚠️ SINCE THE 2026-08-22 RULING THIS NO LONGER DECIDES WHAT RUNS. Both pipelines are computed and
 * both blocks are shown on every wiring row; this predicate now selects only which of them is
 * PRIMARY -- i.e. whose finals become the appliable `values` (and the `basis` string, the
 * top-level `derivation`/`matchedRows`, and which group carries the combined figure). It is
 * therefore still live and must not be removed: delete it and `values` has no defined source.
 *
 * It stays a text heuristic and is still wrong on rows whose scope boilerplate merely MENTIONS a
 * termination. That is now a question of which number is offered first, not of which number
 * exists -- the cable rate is on screen either way. */
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
export function attributeOptions(
  def: AttributeDefinition,
  items: RateMasterItem[],
  /**
   * SLICE 12c-S (owner S1: "this will also be the wider case for other categories across electrical
   * and HVAC") -- THE ANSWERS ALREADY GIVEN ON THIS ROW, so a catalogue-backed dropdown offers only
   * values that still match at least one SKU.
   *
   * This is the SAME rule `fieldOptionsFromSkus` applies on the item-list side, over the other half of
   * the catalogue vocabulary: there a family's SKUs, here a `values_from` kind. Three properties keep
   * it safe and they are the same three:
   *   - a STATIC `values` list is untouched (it is not a catalogue read, so there is nothing to narrow);
   *   - an answer no row of this kind CARRIES cannot narrow;
   *   - an answer that would empty the list is SKIPPED, so one unmatchable value can never blank a
   *     dropdown -- this can only ever remove options that no SKU supports, never the last one.
   * ABSENT (every caller that passes nothing) is byte-identical to before.
   */
  answers: Record<string, string | number> = {},
): string[] {
  const vf = def.values_from;
  const base: string[] = [];
  if (!vf) {
    base.push(...(def.values ?? []).map((v) => String(v)));
  } else {
    const kindRows = items.filter((it) => {
      if (it.kind !== vf.kind) return false;
      const a = it.attributes ?? {};
      return Object.entries(vf.where ?? {}).every(([k, v]) => a[k] === v);
    });
    let rows = kindRows;
    for (const [k, v] of Object.entries(answers)) {
      if (k === def.id || k === vf.attr || v === "" || v === NONE_SENTINEL || v === null || v === undefined) continue;
      if (!kindRows.some((it) => k in (it.attributes ?? {}))) continue;
      const narrowed = rows.filter((it) => String((it.attributes ?? {})[k]) === String(v));
      if (narrowed.length) rows = narrowed;
    }
    const seen = new Set<string>();
    for (const it of rows) {
      const raw = (it.attributes ?? {})[vf.attr];
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

/**
 * DERIVED DISPLAY -- give every DERIVED attribute the value the pipeline actually computed.
 *
 * ⚠️ THE SCREEN IS THE AUTHORITY. The derived-attribute GATE (above) stopped these attributes
 * refusing a row, but the FIELD went on rendering a blank in a red border while the pipeline priced
 * a 3M plate behind it -- so the form still told the pricer the row was incomplete, and the blanker
 * quantity still showed the extraction's stated 1 where the bill charges 0. This function is the
 * other half: it does not change one number, it says which one was used.
 *
 * TWO derivation mechanisms, and they behave DIFFERENTLY on purpose -- both read from CONFIG:
 *
 *   1. FULLY SUPERSEDED (`derivedQtyAttrs`, the blanker quantity). The component takes
 *      `qty: {from_fit}`, so the pipeline NEVER reads the attribute. The computed value therefore
 *      ALWAYS wins and the field is READ-ONLY -- making it editable would be a new lie, since an
 *      edit could not reach the price. Its value is read with `derivedQtyValue`, the SAME reader the
 *      Rate Master Derivation screen uses, so the two screens can never show different blank counts.
 *
 *   2. A `module_fit` LADDER BIND (the face plate). A stated value IS read -- as the FLOOR of
 *      take-the-larger -- so the field stays EDITABLE and a stated value keeps the screen. The
 *      computed label fills it only when the row states nothing. When take-the-larger UPGRADED a
 *      too-small entry, the numbers ride along so the panel can warn instead of appearing to
 *      swallow the edit.
 *
 * ⚠️ NOTHING is written back into `selected` (it is not even in scope here) -- these fields are
 * DISPLAY, and `value` still means "what the row supplied". PURE: returns a new array.
 */export function applyDerivedDisplay(
  attrs: WorkingsAttribute[],
  config: RateCategoryConfig,
  results: PipelineResult[],
  /**
   * SLICE 3b (owner ruling R9) -- the row-level derived set, when the caller has one.
   *
   * The gate and this display must agree: if a blank attribute is being asked for, it has to LOOK
   * like it is being asked for. Without this the field would render as derived (no red border)
   * while the message still said "Complete the missing attributes to price" -- border and message
   * disagreeing about the same field.
   *
   * ⚠️ OPTIONAL BY DESIGN, and that is what protects slice 3a's width. Absent => the config-level
   * set, byte-identical to pre-3b: `computeWiring` passes nothing and is unaffected, and a
   * `catalog_fit` bind is unconditionally derived on every path, so width renders exactly as it did.
   * The narrowing can only ever REMOVE a `map_attribute` target on a row whose source is blank.
   */
  rowDerivedIds?: ReadonlySet<string>,
  /**
   * F-30 slice B -- the live catalogue, so a `catalog_fit` HOP can be worded as the same
   * `rating_up` note the board ladder produces (the pole / device / curve words are read from the
   * PRICED row, exactly as `ratingUpNote` reads them from `pole_ladder.to`). OPTIONAL: absent, no
   * hop note is produced and every caller that never passed it is byte-identical.
   */
  items?: RateMasterItem[],
  /**
   * TWO WAYS (2026-09-10) -- the row's SELECTION, so the `no_match` producer can name what the
   * document stated for a field the pipeline left blank (a gauge outside the table lives in the
   * hidden `thickness_swg`, not on the visible field). OPTIONAL: absent, no `no_match` note is
   * produced from a hidden source; every caller that never passed it is byte-identical otherwise.
   */
  selected?: Record<string, string | number>,
): WorkingsAttribute[] {
  // The ONE derived predicate (both mechanisms) -- reused, never re-implemented (#179).
  const derivedIds = rowDerivedIds ?? derivedAttrIds(config);
  const supersededQty = derivedQtyAttrs(config);
  const fit = moduleFitOutcome(results);
  const byBind = new Map((fit?.ladders ?? []).map((l) => [l.bind, l]));
  // The THIRD mechanism's values, read through the interpreter's ONE reader -- never by parsing the
  // trace prose and never by re-deriving the arithmetic (#179).
  const computedAttrs = derivedAttrOutcomes(results);

  const arbitratedQty = blanksQtyAttr(config);
  const blanksItemAttr = blanksBindItemAttr(config);

  const displayed = attrs.map((a) => {
    if (!derivedIds.has(a.id)) return a;

    // 0. THE ARBITRATED QUANTITY (the blanker count). Checked FIRST, because the superseded branch
    //    below would lock it -- and it is not superseded: `module_fit` reads it and weighs it against
    //    the plate's spare capacity, so an edit reaches the price. SEEDED-BUT-EDITABLE, the state the
    //    face plate already uses: `derived` + a `derivedValue`, and `readOnly` deliberately unset, so
    //    a stated value keeps the screen and a blank one shows what the pipeline computed.
    if (arbitratedQty && a.id === arbitratedQty) {
      const b = fit?.blanks;
      // Nothing was counted (a "None" plate, or nothing on the plate at all). An uncomputed count
      // renders EMPTY, never 0 -- "no plate to fill" is a different statement from "zero needed".
      if (!b) return { ...a, derived: true };
      const notes: AttrNote[] = [];
      if (b.stated !== undefined) {
        // CORRECTED vs HONOURED -- the two say opposite things and are mutually exclusive by
        // construction (a stated count is either above the spare or below it, never both).
        if (b.capped) notes.push({ kind: "capped", stated: b.stated, spare: b.spare });
        else if (b.uncovered > 0) {
          notes.push({ kind: "uncovered", stated: b.stated, spare: b.spare, uncovered: b.uncovered });
        }
      }
      return {
        ...a,
        derived: true,
        derivedValue: String(b.effective),
        ...(notes.length ? { notes: sortAttrNotes(notes) } : {}),
      };
    }

    // 0b. THE BLANKS BIND_ITEM (slice 5, B1). The blanker ITEM, shown exactly as the plate shows its
    //     fitted rung. Checked here -- after the arbitrated quantity, before the ladder lookup --
    //     because it is NOT a ladder bind: `byBind` is keyed on `ladders[].bind`, so this id would
    //     fall through to the derive/catalog/map branches, match none of them, and render EMPTY.
    //     That is exactly what a blank field beside a filled quantity looked like.
    //
    //     It stays EDITABLE, like the plate and unlike the superseded quantity: the pipeline decides
    //     the item from the effective count, but the pricer's authority over an attribute value is
    //     the standing rule, and `readOnly` here would promise an effect their edit cannot have.
    if (blanksItemAttr && a.id === blanksItemAttr) {
      const item = fit?.blanks?.item;
      // Nothing counted (a "None" plate, or nothing on the plate at all) publishes NO value -- an
      // empty field, never a fabricated blanker, matching the plate's positively-absent branch.
      if (item === undefined) return { ...a, derived: true };
      // ⚠️ THE COMPUTED ITEM OVERRIDES A STATED ONE, AND MUST BE MARKED WHEN IT DOES.
      // The blanker is inferred from the EFFECTIVE count and never selected by extraction
      // (owner-locked): a positive count prices `1M Blanker` whatever the model returned. Publishing
      // the computed value without `substituted` was not enough, because `attrDisplayValue` shows a
      // STATED value in preference to a derived one -- so a row whose extraction said "None" showed
      // "None" while the price it displayed included nine blankers. That is the exact defect this
      // whole branch exists to remove, arriving from the other side.
      //
      // THE PLATE IS THE PRECEDENT, VERBATIM: take-the-larger overwrites a stated rung on screen and
      // marks it "(computed)", because "the row says 1M, the pipeline buys 3M" is a substitution the
      // pricer must see. Same rule, same marker, same reason.
      //
      // It marks ONLY when the two actually differ -- a pricer who picked the value the pipeline
      // also computed has not been overridden, and tagging that would credit the pipeline with their
      // choice. R9 is untouched: `blank_qty` is what the pricer edits and what `module_fit` reads.
      const stated = a.value;
      const substituted = stated !== "" && stated !== undefined && String(stated) !== String(item);
      return { ...a, derived: true, derivedValue: item, ...(substituted ? { substituted: true } : {}) };
    }

    const superseded = supersededQty.get(a.id);
    if (superseded) {
      // An UNCOMPUTED value renders EMPTY, never 0: with a "None" plate there are no blanks at all,
      // and a 0 would claim "zero needed" instead of "not applicable" (owner-locked).
      const v = derivedQtyValue(results, superseded.ctxKey);
      return {
        ...a,
        derived: true,
        readOnly: true,
        ...(v === undefined ? {} : { derivedValue: String(v) }),
      };
    }

    const ladder = byBind.get(a.id);
    if (!ladder) {
      // 3. A `derive_attribute` TARGET (the circuit length). Like the ladder bind and UNLIKE the
      //    blanker quantity, a stated value IS read -- it wins outright, with no floor and no warning
      //    -- so the field stays EDITABLE and only fills in when the row states nothing. `readOnly`
      //    must never be set here: that would promise the pricer an effect their edit cannot have,
      //    when in fact their edit is the one thing that always wins.
      const computed = computedAttrs.get(a.id);
      if (computed) {
        // ⚠️ "STATED" HERE MEANS "A VALUE WAS ALREADY IN THE SELECTION", NOT "THE PRICER TYPED IT",
        // AND THE DIFFERENCE BECAME VISIBLE WHEN A MAP STARTED WRITING THIS TARGET. On a
        // point_wiring row naming only a Primary or Secondary point, the map substitutes 15 or 5
        // BEFORE this step; derive then sees a value, takes stated-wins, and publishes nothing --
        // so the field rendered BLANK while pricing used 15. The row had no entry of its own to
        // fall back on, because the number came from the pipeline.
        //
        // ⚠️ THE PRINCIPLE THIS BRANCH PROTECTS IS REAL AND IS KEPT: the pipeline must never take
        // credit for a number the PRICER entered. So the fallback consults the map's own verdict --
        // `stated: false` means the PIPELINE substituted it (show it, marked "(computed)"), while
        // `stated: true` means the map found the pricer's value and kept it (publish nothing, so
        // `attrDisplayValue` shows their entry, unmarked). Only the first case is filled in here.
        if (computed.value === null) {
          const mapped = mapAttributeOutcomes(results).get(a.id);
          if (mapped && mapped.stated === false && mapped.value !== null && mapped.value !== "") {
            return { ...a, derived: true, derivedValue: String(mapped.value), substituted: true };
          }
        }
        return {
          ...a,
          derived: true,
          // A STATED value publishes no display value -- `attrDisplayValue` shows the row's own entry,
          // which is what actually prices. Nothing was computed, and claiming otherwise would be a lie.
          ...(computed.value === null ? {} : { derivedValue: String(computed.value) }),
        };
      }
      // 4. SLICE 2c -- a `catalog_fit` LADDER BIND. The FOURTH mechanism reaching this display, read
      //    through the interpreter's own reader (`catalogFitOutcomes`) exactly as the three above are.
      //    Before this, `derivedAttrIds` already marked such an attribute `derived` -- so it was
      //    correctly exempt from the missing-input gate -- but nothing ever filled its `derivedValue`,
      //    and `attrDisplayValue` therefore rendered EMPTY. That is the whole reason row 98's paired
      //    MCB read "— select —" while the pipeline priced a 25A FP MCB C CURVE behind it.
      //
      //    It behaves like the ladder bind and the derive_attribute target, NOT like the blanker
      //    quantity: a stated value IS read and wins outright, so `readOnly` must never be set here.
      const cf = catalogFitOutcomes(results).get(a.id);
      if (cf) {
        // SLICE 2d, OPTION B -- ONE FIELD, FOUR HONEST STATES.
        //
        // (1) STATED: the row's own value prices. `a.value` is non-empty, so it renders plain with no
        //     marker; publishing a computed value here would credit the pipeline with the pricer's
        //     choice. Unchanged from 2c.
        if (cf.stated !== undefined) return { ...a, derived: true };

        // (2) CONCLUDED ABSENCE -> "None (computed)". ⚠️ THIS REVERSES 2c's REFUSAL, BY RULING, AND
        //     THE PREMISE IS WHAT CHANGED: 2c published nothing because "nothing was computed". But a
        //     step that fired `absent_when` DID conclude something -- that there is no such component
        //     -- and a concluded absence is a verdict, not the lack of one. Rendering it empty made
        //     the panel silent about the one thing the pricer most needs to see, now that the facts
        //     behind it have left the screen.
        if (cf.absent) return { ...a, derived: true, derivedValue: NONE_SENTINEL, substituted: true };

        // (3) NOTHING FITTED and no verdict -- render empty rather than invent.
        if (cf.fitted === null) return { ...a, derived: true };

        // (4) FITTED. Plain iff NOTHING was substituted anywhere behind it: the ladder hit exactly
        //     AND every fact its `where` rests on was STATED by the row. A fit can be exact and still
        //     rest on an inferred pole or a defaulted curve, which is why the step's own verdict is
        //     not enough on its own -- `whereRefs` is the join key into the map outcomes.
        const maps = mapAttributeOutcomes(results);
        const restsOnASubstitutedFact = cf.whereRefs.some((id) => maps.get(id)?.stated === false);
        // F-30 slice B (owner 2026-09-05, "implement same for sockets also"): a HOP is said in words,
        // in the note area, through the ONE producer and the ONE wording the board ladder uses. The
        // trace already carried "20 not carried -> 25 (next higher)"; a pricer may never open it.
        const hop = catalogFitRatingUpNote(cf, items);
        // WIDTH DROPDOWN (owner 2026-09-10) -- a plain SIZE hop on a dropdown field. The field can
        // only show a stocked size, so it shows the FITTED one (`derivedValue`, unchanged above) and
        // the row's own number would otherwise vanish from the screen; this note is where it
        // survives. Produced ONLY where: the ladder hopped UP, no device-shaped `rating_up` note
        // already says so, and the def is a dropdown (`a.options`) -- a free number input still
        // shows "(computed)" beside the fitted value exactly as before, byte-unchanged. A direct pick
        // hits its rung exactly and carries no note; above the top rung nothing fits and there is no
        // outcome here at all (owner: blank, refusing, no note).
        const sizeUp = catalogFitSizeUpNote(cf, !!a.options && !hop);
        return {
          ...a,
          derived: true,
          derivedValue: cf.fitted,
          substituted: cf.substituted || restsOnASubstitutedFact,
          ...(hop ? { notes: [hop] } : sizeUp ? { notes: [sizeUp] } : {}),
        };
      }
      // 5. SLICE 3b FINISH -- a `map_attribute` TARGET (the tray thickness). The FIFTH mechanism
      //    reaching this display, read through the interpreter's own reader (`mapAttributeOutcomes`)
      //    exactly as the four above are.
      //
      //    ⚠️ THIS BRANCH IS WHY THE FIELD WAS BLANK. `derivedAttrIds` marked the attribute derived
      //    -- correctly exempting it from the missing-input gate -- but with no branch here nothing
      //    filled its `derivedValue`, so a row that priced off a gauge-converted 1.6 mm rendered an
      //    empty "-- select --". It is the exact shape of the row-98 defect slice 2c fixed for
      //    `catalog_fit`, and the same rule: THE PANEL SHOWS WHAT PRICING USED.
      //
      //    OPTION B, and the two cases are opposite on purpose:
      //      * STATED -- the row supplied the millimetre value and the mapping never ran, so nothing
      //        was substituted. PLAIN, no marker. Tagging it would credit the pipeline with the
      //        pricer's own entry.
      //      * MAPPED (from the table, or from a default) -- an inference. Marked "(computed)".
      const mapOut = mapAttributeOutcomes(results).get(a.id);
      if (mapOut) {
        // A STATED value publishes no display value: `attrDisplayValue` shows the row's own entry,
        // which is what actually prices -- the same rule the `derive_attribute` branch above follows.
        if (mapOut.stated) return { ...a, derived: true };
        return { ...a, derived: true, derivedValue: String(mapOut.value), substituted: true };
      }
      return { ...a, derived: true }; // derived by config, but nothing fitted/computed this run
    }
    return {
      ...a,
      derived: true,
      // POSITIVELY ABSENT (a "None" plate, or nothing to fit at all) publishes NO display value --
      // the field renders empty rather than inventing a size for a plate that does not exist.
      ...(ladder.absent || ladder.label === null ? {} : { derivedValue: ladder.label }),
      // SLICE 2d, OPTION B + OWNER RULING (x) -- TAKE-THE-LARGER IS A SUBSTITUTION, so the field shows
      // WHAT WAS BOUGHT, marked "(computed)", with the upgrade note below explaining why.
      //
      // ⚠️ This is the one place 2d overwrites a stated value on screen, and it is deliberate: the row
      // says 1M, the pipeline buys 3M, and showing 1M named a size the row is not being charged for.
      // It is NOT a silent override -- the note still carries the stated capacity, the contents and
      // the size priced, which is what the "warns rather than being silently overridden" rule asked
      // for. The narrowed contract lives in `attrDisplayValue`: a stated value the pipeline USED is
      // still never overwritten; only a SUBSTITUTED one is.
      // F-25 slice 3: a PICK RAISED to the floor is the same kind of substitution -- the pricer
      // picked 3M, the pipeline buys 6M -- so it shows what was bought, marked, with its note. A pick
      // that was honoured is NOT marked: the value on screen is the pricer's own.
      // A pick whose bought rung DIFFERS from the picked label (raised, or moved up) is likewise marked.
      ...((ladder.upgraded || (ladder.pick && ladder.pick.label !== ladder.label)) && ladder.label ? { substituted: true } : {}),
      ...(ladderNotes(ladder)),
    };
  });
  return withNoMatchNotes(displayed, config, items, selected);
}

/**
 * TWO WAYS (owner 2026-09-10). PURE. THE PRODUCER OF THE `no_match` NOTE -- the first note on a BLANK
 * field. Where a stated value has no stocked match the pipeline prices nothing (it never snaps: a
 * non-stocked thickness makes `catalog_fit` find no rung, a gauge outside the table makes
 * `map_attribute` bail, a width above the top rung makes the ladder bail) and the dropdown, having
 * no option to show, renders its placeholder. Both were already true; what was missing was the
 * sentence saying WHY, which lived only in the trace. This adds it, config-driven, naming no category:
 *
 *   (a) a DROPDOWN def whose displayed value is not one of its options and which no ladder fitted
 *       (no `fit_up` / `rating_up` note) -- a stated 2.5 mm, a gauge-converted 4.1 mm;
 *   (b) a `map_attribute` TARGET whose SOURCE is stated but is not a key of the step's table -- a gauge
 *       the conversion table does not carry (the visible field is blank; the source is hidden);
 *   (c) a `catalog_fit` BIND whose stated value exceeds the largest rung the catalogue carries for
 *       that kind -- a width above 600. A value BELOW the top that simply has not been fitted yet
 *       (the row refuses on another attribute) gets NO note: it may fit once the row is complete.
 *
 * ⚠️ CONFINED BY KEY PRESENCE, never by a category name (the HV-10 lesson): only a def that carries
 * `extract_as: "number"` -- read FREELY from the document, so its stored value CAN legitimately be
 * off-list -- gets this note. A closed-list def never stores an off-list value (the coercer nulls it),
 * and the pre-existing off-list DISPLAY gaps on other fields (a conduit `size_mm` of 19.05, a plate
 * label "1M & 2M", a material spelled differently) are REGISTER items, not this note: measured on the
 * 42 active runs, an ungated producer would have added 70 notes on three fields outside #57.
 *
 * Reads config + items + the selection only; never the trace prose. The wording lives in
 * `attrNoteText` (one place). A field that already carries a note keeps it and gains nothing here.
 */
export function withNoMatchNotes(
  attrs: WorkingsAttribute[],
  config: RateCategoryConfig,
  items?: RateMasterItem[],
  selected?: Record<string, string | number>,
): WorkingsAttribute[] {
  const steps = Object.values(config.pipelines ?? {}).flatMap((p) => p.steps ?? []);
  const mapByTarget = new Map<string, { from_attr?: string; table?: Record<string, string | number> }>();
  const fitByBind = new Map<string, { kind: string; size_attr?: string }>();
  for (const st of steps as Array<{ step: string; params?: Record<string, unknown> }>) {
    const p = (st.params ?? {}) as Record<string, unknown>;
    if (st.step === "map_attribute" && typeof p.result_attr === "string" && !mapByTarget.has(p.result_attr)) {
      mapByTarget.set(p.result_attr, {
        from_attr: typeof p.from_attr === "string" ? p.from_attr : undefined,
        table: p.table && typeof p.table === "object" ? (p.table as Record<string, string | number>) : undefined,
      });
    }
    if (st.step === "catalog_fit" && typeof p.bind === "string" && typeof p.kind === "string" && !fitByBind.has(p.bind)) {
      const sf = p.size_from as { attr?: string } | undefined;
      fitByBind.set(p.bind, { kind: p.kind, size_attr: sf && typeof sf.attr === "string" ? sf.attr : undefined });
    }
  }
  // the stocked list in the sentence reads ASCENDING when every option is a number (the dropdown itself
  // keeps catalogue order -- a sort there would reorder every other dropdown, not this slice).
  const stocked = (a: WorkingsAttribute) => {
    const opts = (a.options ?? []).filter((o) => o !== NONE_SENTINEL);
    const nums = opts.map(Number);
    return (nums.every(Number.isFinite) ? [...opts].sort((x, y) => Number(x) - Number(y)) : opts).join(", ");
  };
  const isStated = (v: unknown): v is string | number => v !== undefined && v !== null && v !== "" && v !== NONE_SENTINEL;
  // `extract_as` is a config key the AttributeDefinition type does not declare (types out of scope).
  const freeRead = new Set(
    (config.attribute_definitions ?? [])
      .filter((d) => (d as { extract_as?: string }).extract_as === "number")
      .map((d) => d.id),
  );
  return attrs.map((a) => {
    if (!freeRead.has(a.id)) return a;
    if (!a.options || a.disabled || a.readOnly) return a;
    if (a.notes && a.notes.length) return a;
    const map = mapByTarget.get(a.id);
    const src = map?.from_attr && selected ? selected[map.from_attr] : undefined;
    // (b) the source of a conversion is stated but the table has no such key -> the field is blank
    if (map?.table && isStated(src) && !Object.prototype.hasOwnProperty.call(map.table, String(src))) {
      const keys = Object.keys(map.table).map(Number).filter(Number.isFinite);
      const range = keys.length ? `${Math.min(...keys)}-${Math.max(...keys)} SWG` : "the conversion table";
      return { ...a, notes: [{ kind: "no_match", stated: `${String(src)} SWG`, field: "gauge", stocked: range }] };
    }
    const shown = attrDisplayValue(a);
    if (shown === "" || a.options.includes(shown)) return a;
    // (c) a ladder bind: only ABOVE the top rung is a no-match; below it the ladder can still fit
    const fit = fitByBind.get(a.id);
    if (fit) {
      const want = Number(shown);
      const sizes = (items ?? [])
        .filter((it) => it.kind === fit.kind)
        .map((it) => Number(it.attributes?.[fit.size_attr ?? a.id]))
        .filter(Number.isFinite);
      if (!sizes.length || !Number.isFinite(want) || want <= Math.max(...sizes)) return a;
      return { ...a, notes: [{ kind: "no_match", stated: shown, field: a.label, stocked: stocked(a) }] };
    }
    // (a) any other dropdown: the displayed value is not stocked. Name a converted gauge as such.
    const viaTable = map?.table && isStated(src) ? map.table[String(src)] : undefined;
    const statedText = viaTable !== undefined && String(viaTable) === shown ? `${String(src)} SWG (${shown} mm)` : shown;
    return { ...a, notes: [{ kind: "no_match", stated: statedText, field: a.label, stocked: stocked(a) }] };
  });
}

/**
 * F-25 slice 2. PURE. Everything a `module_fit` ladder outcome must SAY on its field, as notes:
 *   - the take-the-larger `upgrade` (slice 2d, unchanged wording, unchanged condition);
 *   - on the ZERO-MODULE path of a ladder declaring `on_zero_from` (a bare box), `assumed` when
 *     nothing readable stated the size and the declared default was priced, and `size_up` when the
 *     fitted count had no exact rung and the next stocked size was priced. Both ride the general
 *     `notes` list through the ONE wording site (`attrNoteText`); the panel renders them unchanged.
 * Absent `zeroPath` (every non-zero path, and point_wiring's `on_zero_modules`-only shape) yields
 * exactly the pre-slice-2 result -- an `upgrade` note or nothing.
 */
function ladderNotes(ladder: ModuleFitLadderOutcome): { notes?: AttrNote[] } {
  const notes: AttrNote[] = [];
  if (ladder.upgraded && ladder.label) {
    notes.push({
      kind: "upgrade",
      stated: ladder.upgraded.stated,
      statedHolds: ladder.upgraded.statedHolds,
      occupied: ladder.upgraded.occupied,
      using: ladder.label,
    });
  }
  // F-25 slice 3 (owner 2026-09-08): a PICK raised to the ladder's floor says why, in the register
  // of the existing sentences. TWO reasons, TWO kinds, ONE wording site each:
  //   plate-driven  -> `plate_floor` ("3M is smaller than the 6M face plate — using 6M."), because
  //                    the contents-shaped `upgrade` sentence cannot explain a raise the contents
  //                    did not cause;
  //   contents-driven -> the EXISTING `upgrade`, verbatim ("1M holds 1 module; contents occupy 3 —
  //                    using 3M."): the pick is a stated rung too small for the contents, which is
  //                    exactly what that sentence was written for. No fork, no seventh wording.
  // A pick that was HONOURED says nothing -- the field shows the pricer's own value, plain.
  const pk = ladder.pick;
  if (pk && pk.raised && ladder.label) {
    if (pk.floorFrom === "plate" && pk.plate) {
      notes.push({ kind: "plate_floor", picked: pk.label, plate: pk.plate, using: ladder.label });
    } else {
      notes.push({ kind: "upgrade", stated: pk.label, statedHolds: pk.holds, occupied: pk.floor, using: ladder.label });
    }
  }
  // A pick the catalog does not stock, moved UP on the floor branch: the existing `size_up` sentence
  // (the zero branch says the same through `zeroPath.nextHigher` below -- never both).
  if (pk && !pk.raised && pk.nextHigher && ladder.label && !ladder.zeroPath) {
    notes.push({ kind: "size_up", asked: pk.holds, using: ladder.label });
  }
  const z = ladder.zeroPath;
  if (z && ladder.label) {
    if (z.assumed) notes.push({ kind: "assumed", assumed: z.fitted, using: ladder.label });
    if (z.nextHigher) notes.push({ kind: "size_up", asked: z.fitted, using: ladder.label });
  }
  return notes.length ? { notes: sortAttrNotes(notes) } : {};
}

/**
 * F-30 slice A. PURE. A `rating_up` note from the server ladder's `pole_ladder` marker, or undefined
 * when the marker is absent or carries no amp move (a plain swap, a rung-1 hit, a blank). The pole,
 * device and curve words are read from the PRICED catalogue row (`pole_ladder.to`) so the sentence can
 * never disagree with what was bought; a row the catalogue no longer carries still gets the numbers,
 * with neutral words, rather than no note at all.
 */
export function ratingUpNote(
  ladder: ExtractedAttr["pole_ladder"] | undefined,
  items: RateMasterItem[],
): AttrNote | undefined {
  const mv = ladder?.amp_moved_up;
  if (!mv || typeof mv.from !== "number" || typeof mv.to !== "number" || !(mv.to > mv.from)) return undefined;
  const priced = typeof ladder?.to === "string" ? items.find((it) => it.attributes?.item === ladder.to) : undefined;
  const pole = priced?.attributes?.pole;
  const device = priced?.attributes?.device;
  const curve = priced?.attributes?.curve;
  return {
    kind: "rating_up",
    askedAmp: mv.from,
    usedAmp: mv.to,
    poleWord: typeof pole === "string" ? POLE_WORDS[pole] ?? pole : "matching",
    device: typeof device === "string" ? device : "breaker",
    curve: typeof curve === "string" ? curve : "same",
  };
}

/**
 * F-30 slice B. PURE. The SECOND PRODUCER of the `rating_up` note -- a frontend `catalog_fit` HOP
 * (the socket path), where the server writes no marker because the fit happens here. It builds the
 * marker shape the board producer consumes and hands it to the SAME `ratingUpNote`, so the two paths
 * share one note builder and one sentence (`attrNoteText`); a fork would have to change both pins.
 *
 * Undefined when: nothing fitted, the fit was exact (no rating raised), the size did not move UP, the
 * catalogue was not supplied, or the fitted row carries no `device` -- a ladder over trays or
 * thicknesses is a hop too, but "No matching breaker at 300A" would be a fabricated fact.
 */
export function catalogFitRatingUpNote(
  cf: import("@/pages/pricing/rate-master/rateMasterTypes").CatalogFitOutcome | undefined,
  items: RateMasterItem[] | undefined,
): AttrNote | undefined {
  if (!cf || !items || cf.fitted === null || cf.exact) return undefined;
  if (typeof cf.requested !== "number" || typeof cf.size !== "number" || !(cf.size > cf.requested)) return undefined;
  const priced = items.find((it) => it.attributes?.item === cf.fitted);
  if (typeof priced?.attributes?.device !== "string") return undefined;
  return ratingUpNote({ to: cf.fitted, amp_moved_up: { from: cf.requested, to: cf.size } }, items);
}

/**
 * WIDTH DROPDOWN (owner 2026-09-10). PURE. The producer of the `fit_up` note -- a frontend
 * `catalog_fit` HOP on a plain catalogue size (the tray width), where the fitted row carries no
 * device word and `catalogFitRatingUpNote` therefore has nothing to say. The sentence lives in
 * `attrNoteText`, the one wording source; this only carries the two numbers it needs.
 *
 * Undefined when: `enabled` is false (the caller decides the field is not a dropdown, or a
 * rating_up note already covers the hop), nothing fitted, the fit was exact, or the size did not
 * move UP (a `direction: "down"` ladder is not "the next size stocked").
 */
export function catalogFitSizeUpNote(
  cf: import("@/pages/pricing/rate-master/rateMasterTypes").CatalogFitOutcome | undefined,
  enabled: boolean,
): AttrNote | undefined {
  if (!enabled || !cf || cf.fitted === null || cf.exact) return undefined;
  if (typeof cf.requested !== "number" || typeof cf.size !== "number" || !(cf.size > cf.requested)) return undefined;
  return { kind: "fit_up", stated: cf.requested, using: cf.fitted };
}

/** Map a pipeline output key -> the sheet rate-kind it fills. EA-4a: the assembly categories name their
 * outputs `supply` / `install` (no per-unit suffix), so match those EXACTLY as well as the legacy
 * `supply_*` / `install_*` (conduit/wiring per-mtr, switches per-set). */
function kindForOutput(output: string): string | null {
  if (output === "supply" || output.startsWith("supply_")) return "supply_rate";
  if (output === "install" || output.startsWith("install_")) return "install_rate";
  return null;
}

/**
 * F4b -- read an attribute definition's `group_label`, defensively.
 *
 * The key is CARRIED BY THE CONFIG but is not on the `AttributeDefinition` type, and attribute
 * definitions are documented in `api/boq/rate_master.py` as having NO backend key allowlist -- so it
 * arrives intact at runtime and is unvalidated. Anything that is not a non-empty string degrades to
 * "no group" rather than drawing a blank header, which is the `panel` precedent: a flag whose type
 * nothing checks must fail visibly-absent, never visibly-wrong.
 */
function readGroupLabel(d: unknown): string | undefined {
  const raw = (d as { group_label?: unknown } | null)?.group_label;
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
}

/**
 * NEVER-ASKED DEFAULTS (owner ruling 2026-09-08: "Treat a never-asked field as answered -- this is ok";
 * condition: ONLY a genuinely optional field, a field with no sensible default stays blank and keeps
 * refusing).
 *
 * THE DISTINCTION THIS WHOLE RULE RESTS ON -- ABSENT vs PRESENT-NULL -- and where it comes from:
 * the extractor writes a cell for EVERY attribute it asks, whether or not the model answered
 * (`extraction._extract_batch`: `for aid, defn in defs_by_id.items(): ... row_out[aid] =
 * {"value": value, "confidence": ...}`, value None when the model returned nothing; the blank-row and
 * `_row_result` fallbacks write `{d["id"]: {"value": None, ...}}` for every def as well). So on an
 * IN-RUN row:
 *   - KEY PRESENT, value null  -> the model WAS asked and came back blank. A real read failure.
 *                                 UNTOUCHED here; the gate keeps refusing.
 *   - KEY ABSENT               -> the attribute was not in the config when this row was extracted
 *                                 (a config gained it later), i.e. the model was NEVER asked.
 * The only other way a key is absent by design is `extract: false`, which is excluded explicitly.
 *
 * WHICH DEFAULT (the two sources the owner saw, nothing wider):
 *   1. the config's top-level `extraction_defaults[id]` -- a scalar, or `{default, requires_named}`
 *      (the paired-quantity shape: the default applies only when the named item is FILLED, mirroring
 *      `extraction.fill_paired_slot_defaults` case (a)). A `{default, text_overrides}` spec is NOT
 *      defaulted: reproducing the extractor's text rule here would be a second copy of it, so that
 *      field stays blank and keeps refusing (inert on the live corpus -- measured 2026-09-08).
 *   2. `allow_none` -> "None": the honest answer for a slot the model was never shown.
 * Anything else (no default, `panel: false`, a DERIVED attribute the pipeline computes -- a ladder
 * bind such as `plate_item` must never be seeded, it is the ladder's FLOOR) -> undefined -> untouched.
 *
 * ⚠️ THE HAZARD, stated plainly: a row that GENUINELY has a third socket now prices LOW, with nothing
 * downstream to catch it -- the same class as the LMS silent-wrong-pick limit. The `defaulted` badge
 * (reused, not a second mark) plus the "(never asked at extraction ...)" derivation line are the only
 * guard. A pricer's override still wins, exactly as over a model-claimed default.
 */
function readExtractionDefaults(config: RateCategoryConfig): Record<string, unknown> {
  // `extraction_defaults` is carried by the config but is not on the RateCategoryConfig type (out of
  // this slice's scope) -- read through `unknown`, the `readGroupLabel` precedent.
  const raw = (config as unknown as { extraction_defaults?: unknown }).extraction_defaults;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function neverAskedDefault(
  d: AttributeDefinition,
  defaults: Record<string, unknown>,
  valueOf: (id: string) => string | number | null,
): string | number | undefined {
  if (d.id in defaults) {
    const spec = defaults[d.id];
    if (spec !== null && typeof spec === "object") {
      const s = spec as { default?: unknown; requires_named?: unknown; text_overrides?: unknown };
      if (Array.isArray(s.text_overrides) && s.text_overrides.length) return undefined;
      if (typeof s.requires_named === "string") {
        const item = valueOf(s.requires_named);
        if (item === null || item === NONE_SENTINEL) return undefined;
      }
      return typeof s.default === "string" || typeof s.default === "number" ? s.default : undefined;
    }
    if (typeof spec === "string" || typeof spec === "number") return spec;
    return undefined;
  }
  if (d.allow_none) return NONE_SENTINEL;
  return undefined;
}

export function makePricingSheetHelper(deps: Deps): RateHelper {
  const { config, configsByCategory, items, extractionByRow } = deps;

  /** Resolve the config for a row's category. N-category: look it up in the map. Legacy single-config:
   * serve it ONLY for its own category (a different / null category -> none -> coming soon). */
  function resolveConfig(category: string | null): RateCategoryConfig | null {
    // SLICE 3: an alias category resolves ONE HOP to its target's config -- the row then uses the
    // target's pipelines, attributes and (for a wiring target) the Cable | Termination pairing, because
    // the resolved config's id IS the target's. The Use event still records the ROW's own category (the
    // page reads it from the row, never from this config).
    if (configsByCategory) return resolveAliasConfig(configsByCategory, category);
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
    // SLICE 12d-2: ONE predicate on every surface (the FA7 calculator admission is retired) -- the
    // BoQ decline cards, the pre-run rules and the server's extraction population all read the same test.
    if (!isEligibleConfig(cfg)) {
      // SLICE 2 (J4): a config may carry its own message (`helper_message`); otherwise coming soon.
      return { kind: "none", reason: declineReasonFor(cfg) };
    }
    const category = cfg!;
    // SLICE 6: an ITEM-LIST category prices a list of items per row -- its own path, before any row-level
    // attribute is read (the list mode has no row-level attributes: `defs` is `[]` for it).
    const listSpec = itemListPricingSpec(category);
    if (listSpec) {
      // SLICE 12e-3a: a delegated section resolves its category through the SAME config map this helper serves
      // every row from -- the object that category's own rows and its calculator tab are priced with
      const configOf = (id: string): RateCategoryConfig | null =>
        configsByCategory ? (configsByCategory.get(id) ?? null) : (config && config.category_id === id ? config : null);
      return computeItemList(category, listSpec, items, ctx as RowContextWithUnit, ext as ExtractionRowWithItems | undefined, inRun, overrides, configOf);
    }
    const defs = selectableDefs(category);
    // The attributes THIS config computes rather than accepts -- a blank one is not missing input.
    // (Hoisted above the never-asked pass, which must not seed a derived attribute.)
    const derived = derivedAttrIds(category);

    // NEVER-ASKED DEFAULTS (owner ruling 2026-09-08; the rule and its hazard are on
    // `neverAskedDefault` above). IN-RUN rows only: a manual row has no stored attributes at all and
    // keeps its "Fill the attributes to price this row" path untouched. A synthesized cell carries the
    // EXISTING `defaulted` flag, so the badge, the trace line and the override precedence are the
    // ones a model-claimed default already has. Two passes so a paired quantity (`requires_named`)
    // can see an item defaulted in the same walk regardless of definition order.
    const neverAsked = new Map<string, ExtractedAttr>();
    if (ext) {
      const defaults = readExtractionDefaults(category);
      const valueOfId = (id: string): string | number | null => {
        const dd = defs.find((x) => x.id === id);
        if (!dd) return null;
        const ov = overrides?.[id];
        const raw = ov !== undefined ? ov : (ext.attributes[id] ?? neverAsked.get(id))?.value ?? null;
        return coerceForMatch(dd, raw as string | number | null);
      };
      for (let pass = 0; pass < 2; pass++) {
        for (const d of defs) {
          if (neverAsked.has(d.id)) continue;
          if (Object.prototype.hasOwnProperty.call(ext.attributes, d.id)) continue; // ASKED -- untouched
          // `extract` is a config key the AttributeDefinition type does not declare (types out of scope).
          if ((d as { extract?: boolean }).extract === false || d.panel === false || derived.has(d.id)) continue;
          const v = neverAskedDefault(d, defaults, valueOfId);
          if (v !== undefined) neverAsked.set(d.id, { value: v, confidence: 0, defaulted: true });
        }
      }
    }
    /** The stored cell for a def, or the never-asked synthesized one. */
    const cellOf = (d: AttributeDefinition): ExtractedAttr | undefined =>
      ext?.attributes[d.id] ?? neverAsked.get(d.id);

    // EA-4a-r: which defs are DISABLED because an allow_none controller is set to "None" (positive
    // absence) -- e.g. plate_item="None" disables plate_qty AND back_box. A controller can disable a def
    // that appears BEFORE it in the list (wire2_thickness_sqmm controls wire2_core), so resolve in a
    // pre-pass. A disabled target is greyed + cleared and is NOT treated as an unknown (never blocks).
    const valueOfDef = (d: AttributeDefinition): string | number | null => {
      const ov = overrides?.[d.id];
      const raw = ov !== undefined ? ov : cellOf(d)?.value ?? null;
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
    const neverAskedTrace: string[] = []; // 2026-09-08: the subset of `defaulted` this helper synthesized
    // (`derived` is hoisted above the never-asked pass.)
    // SLICE 3b (owner ruling R8) -- THE CONDITIONAL EXEMPTION, resolved PER ROW.
    //
    // Four of the five derivation mechanisms can always run, so config membership IS the answer. A
    // `map_attribute` is the exception: it fills its target from a SOURCE attribute, and on a row
    // where that source is blank it fills nothing. Exempting such a target wholesale would replace
    // "Complete the missing attributes to price" -- an instruction the pricer can act on -- with a
    // refusal they cannot, on every row where nothing can fill it. The owner ruled the message is
    // worth keeping, so the exemption is narrowed to rows the pipeline can actually serve.
    //
    // ⚠️ PRE-PASS, in the `disabledByNone` idiom directly above, and for the SAME reason: the source
    // attribute may sit AFTER its target in the definition list, so this cannot be decided inside the
    // main loop. `valueOfDef` reads any def's row value independently of loop order.
    //
    // ⚠️ THE NARROWING TOUCHES ONLY THE `map_attribute` MECHANISM. A `catalog_fit` bind (slice 3a's
    // tray width), a `module_fit` ladder bind, a `derive_attribute` target and a superseded qty are
    // all left exactly as they were -- which is what keeps width, point_wiring, switches_sockets and
    // industrial_sockets byte-identical. A config with no `map_attribute` produces an EMPTY set here
    // and `fillableDerived` is `derived`.
    // ⚠️ A TARGET WITH A SECOND FILLER KEEPS ITS EXEMPTION, AND THE COMMENT ABOVE USED TO BE TRUE
    // ONLY BY ACCIDENT. It says a `derive_attribute` target is "left exactly as it was" -- which held
    // only while no attribute was BOTH a map target and a derive target. point_wiring's
    // `circuit_length_m` is now both: the map substitutes 15/5 from the point type, and
    // `derive_attribute` computes 15 + (points-1)*5 from the point count.
    //
    // THE NARROWING'S PREMISE IS THAT A MAP TARGET'S ONLY FILLER IS ITS MAP. For such an attribute
    // that premise is false: when the map's source is blank the DERIVE step still fills it, so the
    // row can be served and the exemption must stand. Without this, 166 rows that priced under v47
    // rendered "Complete the missing attributes to price" -- a regression the owner found on screen.
    //
    // ⚠️ SCOPED BY MEASUREMENT, NOT BY HOPE: across all 12 Electrical category_configs, the ONLY
    // attribute that is both a map target and a derive target is point_wiring's `circuit_length_m`.
    // No other category declares ANY `derive_attribute` target, so no other category can reach this
    // branch. Re-measure before assuming that is still true.
    const deriveTargets = new Set<string>();
    for (const pl of Object.values(category.pipelines ?? {})) {
      for (const raw of pl.steps ?? []) {
        const s = raw as { step?: string; params?: { result_attr?: unknown } };
        if (s.step === "derive_attribute" && typeof s.params?.result_attr === "string") {
          deriveTargets.add(s.params.result_attr);
        }
      }
    }
    const unfillableDerived = new Set<string>();
    for (const [resultAttr, src] of mapAttributeSources(category)) {
      if (src.hasDefault) continue; // the curve-else-C shape: always fillable, never narrowed
      // A SECOND FILLER: `derive_attribute` can compute this target whatever the map's source says.
      if (deriveTargets.has(resultAttr)) continue;
      const srcDef = src.fromAttr ? defs.find((d) => d.id === src.fromAttr) : undefined;
      // A source we cannot resolve is NOT evidence of absence -- leave the exemption alone rather
      // than narrow on a guess. Only a source we can read AND find empty narrows it.
      if (!srcDef) continue;
      const v = valueOfDef(srcDef);
      if (v === null || v === NONE_SENTINEL) unfillableDerived.add(resultAttr);
    }
    const fillableDerived =
      unfillableDerived.size === 0
        ? derived
        : new Set([...derived].filter((id) => !unfillableDerived.has(id)));
    let missing = false;
    for (const d of defs) {
      const cell = cellOf(d);
      const wasNeverAsked = neverAsked.has(d.id);
      const overridden = overrides?.[d.id];
      const disabled = disabledByNone.has(d.id);
      const rawValue = disabled ? null : overridden !== undefined ? overridden : cell?.value ?? null;
      const coerced = coerceForMatch(d, rawValue as string | number | null);
      // A disabled target is POSITIVELY absent (its controller is None) -- clear it, do NOT flag missing.
      // A DERIVED attribute (a module_fit ladder bind, or a superseded `<name>_qty`) is likewise not
      // missing input: blank means "not stated", and the pipeline computes it. A stated value is
      // still passed through in `selected`, where the ladder reads it as its FLOOR.
      // SLICE 2d -- a PANEL-HIDDEN attribute is exempt from the gate, for the same reason a derived
      // one is: A FIELD THE PRICER CANNOT SEE IS NOT MISSING USER INPUT. Without this, a blank
      // `mcb_present` would refuse the row with "Complete the missing attributes to price" and no
      // visible field to fill -- a dead end. Downstream stays honest: a blank fact leaves
      // `absent_when` unfired and `fit_from` unreadable, and `on_missing_fact: "none"` zeroes that
      // line rather than inventing one.
      if (coerced === null) {
        // SLICE 3b: `fillableDerived`, not `derived` -- see the pre-pass above. Identical to
        // `derived` for every config without a `map_attribute`.
        if (!disabled && !fillableDerived.has(d.id) && d.panel !== false) missing = true;
      }
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
        // The badge cannot tell a never-asked default from a model-claimed one; this trace line can.
        if (wasNeverAsked) neverAskedTrace.push(`${d.label}=${coerced}`);
      }
      // F-30 slice A (owner ruling 2, 2026-09-05) -- THE RATING-UP NOTE. The server-side ladder
      // stamps `pole_ladder.amp_moved_up` when it priced the next rating UP because the counted pole
      // (SPN -> 2 pole, TPN -> 4 pole) is not stocked at the stated amp on that curve. That is a
      // substitution the pricer must SEE on the form, in words -- the face-plate precedent: the
      // trace is a surface a pricer may never open. It rides the general `notes` list (the v6.00
      // generalisation), never a second channel. Same clearing rule as `defaulted`: a pricer's
      // override makes the field theirs again and the note goes. The words come from the PRICED
      // row's own catalogue attributes (pole / device / curve), read from `items` -- no second
      // vocabulary. Per-attribute, on the attribute: nothing whole-sheet is carried.
      const ratingUp = ratingUpNote(!disabled && overridden === undefined ? cell?.pole_ladder : undefined, items);
      // SLICE 2d -- THE ONE PLACE THE PANEL NARROWS. `selected` and `missing` above are computed from
      // the FULL walk and are deliberately untouched: `catalog_fit` reads `selected[mcb_present]` and
      // `selected[mcb_amp_a]`, and `map_attribute` reads the two stated-pole/curve attributes, so
      // filtering the walk instead would leave `absent_when` unfired and the ladder unrun -- every
      // socket row silently mispriced. The facts keep working; they just stop being asked about.
      if (d.panel === false) continue;
      workingsAttrs.push({
        id: d.id,
        label: d.label,
        // CP2: a `number_choice` renders the SAME dropdown as a `choice` (one predicate, shared with
        // the Derivation screen) -- only the coercion above differs, and that is the whole point.
        // SLICE 12c-S (owner S1): narrowed by the answers this row already carries, so the list cannot
        // offer a value that no SKU supports beside them.
        options: isDropdownAttributeType(d.type) ? attributeOptions(d, items, selected) : undefined,
        value: coerced === null ? "" : String(coerced),
        // A never-asked default has no model confidence to show -- omit it rather than render 0.
        confidence: disabled || (wasNeverAsked && overridden === undefined) ? undefined : cell?.confidence,
        corroborated: disabled ? undefined : cell?.corroborated,
        disabled: disabled || undefined,
        allowNone: d.allow_none || undefined,
        defaulted: isDefaulted || undefined,
        ...(ratingUp ? { notes: [ratingUp] } : {}),
        // F4b: carry the config's group label through untouched. A non-string (or empty) is dropped
        // rather than rendered -- attribute-definition keys carry no backend type guard, so a bad
        // value must degrade to "no group" here instead of drawing a blank header.
        // ⚠️ read through `unknown`: `group_label` is not on the AttributeDefinition type, which
        // lives outside this slice's scope. The config carries it and the backend validator applies
        // NO key allowlist to attribute definitions, so the key arrives intact at runtime.
        groupLabel: readGroupLabel(d),
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
        // Calculator slice 1 (owner 2026-09-08, "ok. reword"): the manual-row basis used to end "this
        // row". The same sentence now serves a surface with no row; "Fill the attributes to price" is
        // true on both -- a BoQ row outside the run still has every attribute to fill.
        basis: inRun
          ? "Complete the missing attributes to price"
          : "Fill the attributes to price",
        workings: {
          // DERIVED DISPLAY: no pipeline runs on this path, so there is no computed value to show --
          // but the derived attributes must still not be flagged as the thing that is missing. The
          // red borders that remain are the GENUINE missing inputs, which is exactly the narrowing
          // this slice is: fewer fields flagged, and every one that still is, really is.
          attributes: applyDerivedDisplay(workingsAttrs, category, [], fillableDerived, items, selected),
          matchedRows: [],
          derivation: [
            // Calculator slice 1: WAS "Not in the suggestion run -- fill the attributes to compute a
            // rate." -- there is no run on the calculator. "No extracted attributes" is what a manual
            // BoQ row and a calculator entry have in common, and it is true of both.
            inRun
              ? "Some attributes are missing -- fill them to compute a rate."
              : "No extracted attributes -- fill them to compute a rate.",
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
    // DERIVED DISPLAY: keep every result so the derived attributes can be filled from what the
    // pipelines actually computed (a category may split supply/install across pipelines).
    const pipelineResults: PipelineResult[] = [];
    surfaced.forEach(([pid, pl], idx) => {
      const res = runPipeline(pid, pl as Pipeline, items, selected);
      pipelineResults.push(res);
      const finals: Record<string, number> = {};
      const derivation: string[] = [];
      const matchedRows: string[] = [];
      const label = pipelineLabel(category, pid);
      if (res.status === "ok") {
        for (const o of res.outputs) {
          finals[o] = res.finals[o];
          // Calculator slice 1: the pricer's word ("Supply = 320"), not the output id ("supply = 320",
          // "supply_per_mtr = 1490"); an output that fills no kind keeps its own name.
          derivation.push(`${outputWord(o)} = ${res.finals[o]}`);
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
        flatMatched.push(`Matched ${label} for ${attrLine}.`);
      } else if (res.status === "no_match") {
        derivation.push(`No ${label} rate row matches ${attrLine}.`);
      } else {
        derivation.push(`${label} uses an unsupported step.`);
      }
      if (idx === 0) flatDerivation.push(...derivation);
      // Calculator slice 1: EVERY section carries its own three figures (`groupFigures` over THIS
      // section's finals -- never another's). `finals` itself is unchanged: the raw output map stays
      // the contract for tests and for anything that reads outputs by name.
      sections.push({
        label,
        derivation,
        finals,
        figures: groupFigures(finals),
        ...(matchedRows.length ? { matchedRows } : {}),
      });
    });
    // Combine AFTER scanning every pipeline -- supply + install may come from different pipelines
    // (point_wiring / cabletray). A single combined pipeline (conduit) also lands here; the combined
    // line is added to its one group so its in-group display is unchanged.
    if (typeof values.supply_rate === "number" && typeof values.install_rate === "number") {
      values.combined_rate = values.supply_rate + values.install_rate;
      const combinedLine = `Combined = supply + install = ${values.combined_rate}`;
      flatDerivation.push(combinedLine);
      if (sections.length === 1) sections[0].derivation.push(combinedLine);
    }
    // EA-4a: surface the attributes that came from a config default (not positively read from the text)
    // so the pricer sees, and can correct, every defaulted value before using the rate.
    if (defaulted.length) {
      flatDerivation.push(`(defaulted -- no positive text identification): ${defaulted.join(", ")}`);
    }
    // 2026-09-08: a never-asked default is ALSO in the line above (same badge, same mechanism); this
    // second line is what lets a future reader tell a defaulted third socket from a real one.
    // ⚠️ The panel renders `sections[i].derivation` and NOT the flat list whenever sections exist (every
    // module_fit category -- exactly the never-asked population), so the line is ALSO appended to every
    // section, the way the combined line is added to a single section above. Otherwise the badge would be
    // the only trace on screen and this sentence would exist only in tests.
    if (neverAskedTrace.length) {
      const neverAskedLine = `(never asked at extraction -- config default applied; re-run the sheet to read it): ${neverAskedTrace.join(", ")}`;
      flatDerivation.push(neverAskedLine);
      for (const s of sections) s.derivation.push(neverAskedLine);
    }

    return {
      kind: "suggestion",
      values,
      producibleKinds: PRODUCIBLE_KINDS,
      // Calculator slice 1: the category's LABEL ("Switches and Sockets"), not its id ("switches_sockets").
      basis: Object.keys(values).length
        ? `Rate master: ${categoryLabel(category)} @ ${attrLine}`
        : "no match for these attributes",
      workings: {
        attributes: applyDerivedDisplay(workingsAttrs, category, pipelineResults, fillableDerived, items, selected),
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
    return { kind: "none", reason: `No ${termination ? "termination" : "cable"} pipeline in the config` };
  }
  const result = runPipeline(primaryId, primary, items, selected);
  // DERIVED DISPLAY: wiring declares no derived attribute today (no module_fit, no {from_fit} qty),
  // so this is a no-op here -- but it is applied on BOTH paths so the rule lives in the contract and
  // not in which branch happened to be edited. `applyDerivedDisplay` reads the config, so a wiring
  // config that ever gained one would be covered with no further change.
  const pipelineResults: PipelineResult[] = [result];
  const values: Record<string, number> = {};
  const derivation: string[] = [];
  const matchedRows: string[] = [];

  if (result.status === "ok") {
    for (const o of result.outputs) {
      const kind = kindForOutput(o);
      if (kind) values[kind] = result.finals[o];
      derivation.push(`${outputWord(o)} = ${result.finals[o]}`);
    }
    if (typeof values.supply_rate === "number" && typeof values.install_rate === "number") {
      values.combined_rate = values.supply_rate + values.install_rate;
      derivation.push(`Combined = supply + install = ${values.combined_rate}`);
    }
    matchedRows.push(`Matched ${termination ? "termination" : "cable"} rate row for ${attrLine}.`);
  } else if (result.status === "no_match") {
    derivation.push(`No ${termination ? "termination" : "cable"} rate row matches ${attrLine}.`);
  } else {
    derivation.push(`${pipelineLabel(config, primaryId)} uses an unsupported step.`);
  }

  // BOTH BLOCKS, ON EVERY WIRING ROW (owner ruling 2026-08-22, verbatim: "we side step all this
  // judgement and just show both the wirirng and cable rates and the terminations rates for all
  // rows. both od these need the same attributes for pricing").
  //
  // The factual basis of that ruling is real and load-bearing: `cable_boq` and `termination_boq`
  // depend on the SAME operand set. Both resolve their row through `match_master_row` against
  // item kinds that carry an identical attribute key set (material, insulation, core,
  // thickness_sqmm), and both scale on `runs`. So once the shared whole-row `missing` gate above
  // has passed, BOTH pipelines can always run -- there is never a case where one has the inputs
  // and the other does not. The row TEXT now decides only which block is PRIMARY (whose finals
  // become the appliable `values`), never which block is COMPUTED.
  //
  // ⚠️ THE TWO GROUPS ARE DELIBERATELY NOT THE SAME SHAPE, and that asymmetry is exactly what
  // keeps owner Decision 2 (2026-07-28) byte-intact on a cable row: the PRIMARY group carries the
  // derivation, the matched-row line and the combined figure (all built from `result` above); the
  // SECONDARY group carries its own rates alone. On a cable row the primary IS cable, so every
  // rendered field is identical to before this slice.
  const secondaryId = termination ? "cable_boq" : "termination_boq";

  const primaryFinals: Record<string, number> = {};
  if (result.status === "ok") {
    for (const o of result.outputs) primaryFinals[o] = result.finals[o];
    // `combined_per_mtr` is a CABLE-column notion, so it is added only when cable is the primary --
    // exactly the pre-slice condition. A termination primary still shows its combined line in the
    // derivation below (pushed above, unchanged), so nothing is lost and no key is renamed.
    if (!termination && typeof values.combined_rate === "number") {
      primaryFinals.combined_per_mtr = values.combined_rate;
    }
  }
  const primaryGroup: WorkingsGroup = {
    label: pipelineLabel(config, primaryId),
    derivation: [...derivation],
    finals: primaryFinals,
    // Calculator slice 1: this group's OWN three figures, from ITS finals alone.
    figures: groupFigures(primaryFinals),
    matchedRows: [...matchedRows],
  };

  // The SECONDARY (paired) group -- the SAME construction the paired termination block has always
  // used, now reached on BOTH branches and pointed at whichever pipeline is not primary. An
  // unmatched secondary stays HONESTLY EMPTY: `finals` is left `{}` and only a message is pushed,
  // so it can never borrow or substitute the primary's numbers.
  const secondaryGroup: WorkingsGroup = {
    label: pipelineLabel(config, secondaryId),
    derivation: [],
    finals: {},
  };
  const secondary = pipelines[secondaryId] as Pipeline | undefined;
  if (secondary) {
    const sr = runPipeline(secondaryId, secondary, items, selected);
    pipelineResults.push(sr);
    if (sr.status === "ok") {
      for (const o of sr.outputs) {
        secondaryGroup.finals[o] = sr.finals[o];
        secondaryGroup.derivation.push(`${outputWord(o)} = ${sr.finals[o]}`);
      }
    } else {
      secondaryGroup.derivation.push(
        termination ? "No matching cable rate row." : "No matching termination rate row.",
      );
    }
  } else {
    secondaryGroup.derivation.push(
      termination ? "No cable pipeline in the config." : "No termination pipeline in the config.",
    );
  }

  // CABLE FIRST, ALWAYS. Decision 2's order on a cable row is [Cable, Termination] and this slice
  // must not disturb it; a termination row had NO sections at all before, so there is no prior
  // order to preserve there and the uniform order is the least surprising one.
  const sections: WorkingsGroup[] = termination
    ? [secondaryGroup, primaryGroup]
    : [primaryGroup, secondaryGroup];

  // THE TWO STACKED HEADLINES (owner Ruling A: "we need to show 2 values for the collpased pricing
  // helper"; Ruling C: "stacked...double height"). One entry per block, in the SAME order as
  // `sections` above, each labelled from the config's `pipeline_labels` VERBATIM.
  //
  // ⚠️ NEVER SUMMED ACROSS BLOCKS. `combined_rate` is computed only from a block's OWN supply and
  // install, so per-Mtr adds to per-Mtr and per-Set to per-Set. Adding a cable figure to a
  // termination figure would apply a per-SET rate across a metre quantity -- on BOQ-26-00201 row 194
  // that is a per-set rate over 2,900 metres. There is deliberately no code path that adds them.
  //
  // ⚠️ DISPLAY-ONLY. This does not touch `values`, so "Use this value" keeps applying the PRIMARY
  // pipeline's figure exactly as before (owner Ruling B). A kind a block did not produce is simply
  // ABSENT here, which the panel renders as its existing em dash -- never a zero, never the other
  // block's number.
  // Calculator slice 1: the per-block figures used to be computed here for the headlines ONLY; the
  // same function (`groupFigures`, one definition) now also fills each section's `figures`, so the
  // Termination block's combined -- which the header always carried but the section never showed --
  // appears in the section too. The secondary group's figures are filled here, after its finals are.
  secondaryGroup.figures = groupFigures(secondaryGroup.finals);
  const headlines = sections.map((g) => ({ label: g.label, values: groupFigures(g.finals) }));

  return {
    kind: "suggestion",
    values,
    producibleKinds: PRODUCIBLE_KINDS,
    headlines,
    basis:
      result.status === "ok"
        ? `Rate master: ${categoryLabel(config)} @ ${attrLine}`
        : "no match for these attributes",
    workings: {
      attributes: applyDerivedDisplay(workingsAttrs, config, pipelineResults, undefined, items, selected),
      matchedRows,
      derivation,
      finalValues: { ...values },
      // ALWAYS present now (both blocks, every wiring row). The flat fallback in the panel is
      // consequently unreachable from the wiring path -- it still serves every generic category.
      sections,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 6 (owner S1-S5, 2026-09-24) -- THE ITEM-LIST PATH. One block per item; change / add / remove; a quantity
// per row unit per item; all or nothing; edits session-only (they live in the panel's override map, encoded
// under ONE key, and are decoded here -- nothing is ever written to the row).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The ONE override key the panel writes an item-list row's session edits under (a JSON `ItemListEditState`). */
export const ITEM_LIST_OVERRIDE_KEY = "__items__";
/** The override key holding the ROW UNIT a pricer picked where no row supplies one (the calculator). */
export const ROW_UNIT_OVERRIDE_KEY = "__row_unit__";

/** One item as the panel edits it. `base` = the index of the MODEL's item it started from (null for an item
 * the pricer added or changed -- such an item starts BLANK, S1); `family` = a family the pricer picked (null =
 * the model's); `attrs` = the pricer's per-attribute edits, keyed by the MODEL'S attribute id; `qty` = the
 * quantity per row unit as typed ("1" by default). */
export interface ItemEdit {
  base: number | null;
  family: string | null;
  attrs: Record<string, string>;
  /** SLICE 6c (owner ruling, 2026-09-24): present ONLY when the PRICER typed a quantity -- exactly like
   * `attrs`. Absent means "not typed", so the assumed 1 stands and the panel marks it as a default. Nothing
   * reads a quantity from the row or the model: the quantity is the pricer's, and 1 is the assumption. */
  qty?: string;
  /**
   * SLICE 12c-S (owner S5 on F15) -- the fields the pricer explicitly switched to "Other...".
   *
   * ⚠️ IT HAD TO BE STATE, NOT A DERIVATION. "Other..." clears the field, so a field a pricer has just
   * opened and a field nobody has touched are both empty -- and `otherMode` keyed on emptiness, so
   * EVERY fresh item opened with its size fields already reading "Other..." and a typed box showing,
   * contradicting the page's own "every field starts blank" and hiding the live catalogue list behind
   * a box by default.
   *
   * Absent (and an empty list) means no field is in Other mode, which is what a fresh item has.
   */
  other?: string[];
  /**
   * SLICE 12e-3a (owner 13:40): the edits of the sections ATTACHED to this item, by section id -- a pipe's own
   * insulation. Kept ON the item so removing or changing the item takes its section with it. Absent on every
   * item of a config that declares no section. `base` inside is an index into that SECTION's model items.
   */
  sections?: Record<string, ItemEdit>;
}
export interface ItemListEditState {
  items: ItemEdit[];
  /** SLICE 12e-3a (owner 13:42): the INDEPENDENT sections, by section id -- insulation that belongs to no pipe. */
  sections?: Record<string, ItemEdit[]>;
}

/** PURE. The edit state that means "exactly what the model returned": one untouched entry per model item. */
export function initialItemEdits(modelCount: number): ItemListEditState {
  const items: ItemEdit[] = [];
  for (let i = 0; i < modelCount; i++) items.push({ base: i, family: null, attrs: {} });
  return { items };
}

/** PURE. Decode the panel's override into an edit state; anything unreadable => the initial state.
 * SLICE 12e-3a: `sectionCounts` = how many MODEL items each declared section has (a section edit's `base`
 * indexes those); a state written before sections existed simply carries none. */
export function decodeItemEdits(raw: string | undefined, modelCount: number, sectionCounts: Record<string, number> = {}): ItemListEditState {
  if (raw === undefined || raw === "") return initialItemEdits(modelCount);
  const one = (e: ItemEdit, count: number, nested: boolean): ItemEdit => {
    const secs: Record<string, ItemEdit> = {};
    if (nested && e.sections && typeof e.sections === "object") {
      for (const [sid, se] of Object.entries(e.sections)) {
        if (se && typeof se === "object") secs[sid] = one(se as ItemEdit, sectionCounts[sid] ?? 0, false);
      }
    }
    return {
      base: typeof e.base === "number" && e.base >= 0 && e.base < count ? e.base : null,
      family: typeof e.family === "string" && e.family !== "" ? e.family : null,
      attrs: e.attrs && typeof e.attrs === "object" ? { ...e.attrs } : {},
      ...(typeof e.qty === "string" ? { qty: e.qty } : {}),
      // SLICE 12c-S (F15): the fields explicitly switched to "Other...". A stored state written
      // before this key existed simply has none, which is the fresh-item reading and is correct.
      ...(Array.isArray(e.other) ? { other: e.other.filter((x) => typeof x === "string") } : {}),
      ...(Object.keys(secs).length ? { sections: secs } : {}),
    };
  };
  try {
    const parsed = JSON.parse(raw) as ItemListEditState;
    if (!parsed || !Array.isArray(parsed.items)) return initialItemEdits(modelCount);
    const independent: Record<string, ItemEdit[]> = {};
    if (parsed.sections && typeof parsed.sections === "object") {
      for (const [sid, list] of Object.entries(parsed.sections)) {
        if (Array.isArray(list)) independent[sid] = list.filter((e) => e && typeof e === "object").map((e) => one(e, sectionCounts[sid] ?? 0, false));
      }
    }
    return {
      items: parsed.items.map((e) => one(e, modelCount, true)),
      ...(Object.keys(independent).length ? { sections: independent } : {}),
    };
  } catch {
    return initialItemEdits(modelCount);
  }
}

/** PURE. The list the module prices: each edit overlaid on the model item it started from. A changed or added
 * item (no base) starts from ITS FAMILY ALONE -- every other attribute blank until the pricer fills it (S1). */
export function assembleItems(
  edits: ItemListEditState,
  modelItems: ExtractedListItem[],
  /**
   * ⚠️ THE ATTRIBUTE THE CATEGORY KEEPS ITS FAMILY IN -- `list_spec.pricing.family_attribute_id`.
   *
   * This was the literal "family" below, which is only right for a category whose attribute happens
   * to be called that. The pricer reads `familyAttr(spec)`, so on a category that calls it anything
   * else a CHANGED or ADDED item wrote a key nothing read, and the item refused with "no kind could
   * be told" however many fields the pricer filled in. Found in the FA7 browser cert on HVAC
   * Insulation, whose family attribute is `item` -- the ninth site of the eight this literal was
   * generalised out of, and the one that lives in a different file.
   *
   * ABSENT => "family", so ADP and every existing caller are byte-identical.
   */
  familyAttrId = "family",
): ExtractedListItem[] {
  return edits.items.map((e) => {
    const base = e.base !== null ? modelItems[e.base] : undefined;
    const attributes: ExtractedListItem["attributes"] = {};
    if (base && e.family === null) {
      for (const [k, cell] of Object.entries(base.attributes ?? {})) attributes[k] = { ...cell };
    } else if (e.family !== null) {
      attributes[familyAttrId] = { value: e.family };
    }
    // SLICE 12d-1b (owner T6): a value the PRICER typed is marked, so the pricer never parses it as layers.
    for (const [k, v] of Object.entries(e.attrs)) attributes[k] = { value: v === "" ? null : v, typed: true };
    // SLICE 12e-2 (owner P1): a family TYPED through the family field's "Other..." box (recorded in `other`
    // under the family attribute id, exactly as a size field records it) is marked typed too, so the
    // `family_text` reader can tell a pricer's spelling from a model's answer. A block that never opened the
    // box carries no such entry and is byte-identical.
    if (e.family !== null && (e.other ?? []).includes(familyAttrId)) attributes[familyAttrId] = { value: e.family === "" ? null : e.family, typed: true };
    // SLICE 6c: an untyped quantity is passed as ABSENT, which the module has always priced as 1 -- so the
    // marking changes no rate anywhere.
    return { attributes, ...(e.qty !== undefined ? { qtyPerRowUnit: e.qty } : {}) };
  });
}

/** One field of one block, as the panel renders it. */
/**
 * SLICE 12c-F, FIX B (owner R-B) -- PURE. CAN THIS FIELD SHOW THE VALUE THE ROW PRICED FROM?
 *
 * Owner: "A row must never price from a value its field cannot show." A dropdown can only display one
 * of its own options, so a priced row resting on anything else is a figure whose provenance the screen
 * cannot state -- which is exactly what the 12c-P cert photographed: a blank Slots select above a row
 * priced at 1160 / 352 / 1512.
 *
 * Three things answer the question before it is asked, and each is a mechanism that SUPPLIES the shown
 * value, so the field is honest without needing the stated text:
 *   `hopped`   a ladder resolved the size and the field shows the rung that was bought;
 *   `supplied` a ruled default or a config override decided it, and the field shows what it decided;
 *   no options the SKUs stock none to choose between, so the field is an input to a formula, not a pick.
 *
 * ⚠️ THE "None" SENTINEL IS NOT AN UNSHOWABLE VALUE, and the first draft of this refused four rows for
 * exactly that. "None" is POSITIVE ABSENCE -- the answer the ruled defaults consume ("damper not
 * mentioned = without") -- so the field shows `without` and nothing is hidden. It is handled by the
 * caller, which skips the sentinel before asking.
 */
export function fieldCannotShowValue(
  stated: string,
  options: readonly string[],
  mechanism: { hopped: boolean; supplied: boolean },
): boolean {
  if (stated.trim() === "") return false;
  if (mechanism.hopped || mechanism.supplied) return false;
  if (options.length === 0) return false;
  return !options.includes(stated);
}

/** PURE. A size as the catalogue writes it: `12`, not `12.0`; `22.23` kept. */
function fmtNum(n: number | string): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return String(n);
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));
}

export interface ItemFieldView extends ItemFieldDef {
  value: string;
  /**
   * OWNER FA8(b), CERT-FOUND 2026-10-04: WHAT THE PRICER ACTUALLY TYPED, before any resolution.
   *
   * ⚠️ `value` is the RESOLVED size -- the ladder result, or blank where nothing fits (rule X3: the
   * field shows the size that will be PRICED). That is right for the SELECT and fatal for the
   * "Other..." BOX, which was bound to the same field: every keystroke was rewritten to the rung it
   * resolved to, or erased, so a size could not be typed at all. The two readings are different
   * questions -- "what will be priced" and "what did you enter" -- and they need different fields.
   */
  typedValue: string;
  /** The value came from a ruled default over a "None" / an absent-as-none answer (amber + "default"). */
  defaulted: boolean;
  /** The rule behind the default, shown under the field. */
  rule?: string;
  /** The pricer edited this field this session (the undo arrow). */
  userEdited: boolean;
  /**
   * SLICE 12c-S (owner S5 on F15): the typed box is open on this field -- the pricer chose "Other...",
   * or the BoQ supplied a value the catalogue does not stock.
   *
   * ⚠️ DECIDED HERE, WHERE THE EDIT STATE IS. The panel used to derive it, and could only derive it
   * from the value being empty -- which is also true of a field nobody has touched, so every fresh
   * item opened already claiming a choice the pricer had not made.
   */
  otherMode: boolean;
  /** Something the pricing did to this field's value (a ladder hop), shown under it. */
  note?: string;
  /** A genuinely missing input the row needs (red border). */
  blank: boolean;
  /** OWNER FA8(c)/(d): the "How is this matched?" rules for a size field, each sentence carrying an
   * example GENERATED LIVE from the catalogue. Absent on every field that is not a typeable size. */
  matchHelp?: string[];
  /** SLICE 9 (owner A-6): what to DISPLAY for an option, where the catalogue's own word differs from the
   * value the pricing uses. The select keeps the real value (so it still matches an option and stays
   * editable -- see the controlled-select trap in frontend/CLAUDE.md); only the text changes. */
  optionLabels?: Record<string, string>;
  /** SLICE 12e-2 (owner Q10, "read-only text when present"): a `panel_optional` box whose value the MODEL
   * supplied and the pricer has not edited is shown as read-only text, not a box. Never set elsewhere. */
  readOnly?: true;
  /** SLICE 12e-3a (owner D3 / D3a): this field's value was MIRRORED from the item the section sits under
   * (the config's `mirror.tag`, "from pipe"). Set by the section pass only; gone once the pricer edits it. */
  mirrorTag?: string;
  /** SLICE 12e-3a (owner D3a): the pricer chose a value here that differs from the mirrored one --
   * "you chose 19.05 (pipe is 15.875)" (the config's `mirror.line`). */
  mirrorLine?: string;
}

/**
 * SLICE 12e-3a (owner D1 / D1a) -- ONE DELEGATED SECTION AS THE PANEL DRAWS IT. `view` is the DELEGATED
 * CATEGORY'S OWN item-list view of this one item -- what that category's calculator is handed for the same
 * answers -- so the section is drawn by the same component and behaves as that category does. `pipe` is the
 * index of the item it is attached to, or null for an independent section.
 */
export interface SectionBlockView {
  sectionId: string;
  heading: string;
  pipe: number | null;
  /** position in the section's independent list (0 for an attached section) */
  index: number;
  view: ItemListView;
}

/**
 * SLICE 12e-2 (owner P1 + amendment 2026-10-10 10:29): THE FAMILY FIELD AS A CONTROL -- a dropdown of the
 * stocked families plus "Other...", which opens a typed box ("Pipe type as the BoQ writes it"). Present ONLY
 * when the config declares the family attribute's `panel_controls` entry `dropdown_or_other`; Insulation and
 * ADP declare `dropdown`, keep their "Change item" picker and are byte-identical.
 */
export interface FamilyControlView {
  /** the family attribute id (`list_spec.family_attribute_id`) -- what the panel's two family ops carry */
  id: string;
  /** the family definition's label ("Pipe type") */
  label: string;
  /** the stocked families, in the config's order */
  options: string[];
  /** the "Other..." box is open: the pricer chose it, or typed a spelling that is not a stocked family */
  otherMode: boolean;
  /** what the pricer typed (the box is bound to this, never to the resolved family) */
  typedValue: string;
  /** the config's note for the box ("Pipe type as the BoQ writes it") */
  note?: string;
}

/** One item block, as the panel renders it. */
export interface ItemBlockView {
  index: number;
  source: "model" | "user";
  family: string | null;
  /** The family the model returned when it differs from the family that prices (the R3 alias note). */
  familyRaw: string | null;
  /** SLICE 12d-1a (owner R2): the family came from the config's `family_when_none` -- the row named
   * no material and its kind (unit, or a heading word) decided. Present ONLY on such a block, so every
   * other block is byte-identical; the panel shows it amber with the rule, like every other default. */
  familyDefaulted?: { value: string; rule: string };
  /** SLICE 12e-2 (owner Q16 / Q15): the line under the family when `family_text` read the answer as another
   * family ("BoQ says GI -> priced as MS") or off the row's own words. Present ONLY then; the panel shows it
   * amber in place of its built-in alias sentence. */
  familyLine?: string;
  /** SLICE 12e-2 (owner P1): the family as a dropdown + "Other..." control -- present ONLY on a config that
   * declares the family attribute `dropdown_or_other`. */
  familyControl?: FamilyControlView;
  fields: ItemFieldView[];
  /** SLICE 12d-1a (owner R7): the attributes the config declares READ-ONLY (`panel_readonly`) that the
   * model answered on this item -- shown under the def's label, never a field, never matched. Empty
   * where the config declares none or the model answered none. */
  readOnly: Array<{ id: string; label: string; value: string }>;
  qty: string;
  /** SLICE 6c: the quantity shown is the ASSUMED 1 -- the pricer typed nothing -- so the panel marks it amber
   * with the same "default" tag every other assumed value carries. It is the one field that never refuses, so
   * an unmarked 1 reads as a fact the row stated. */
  qtyDefaulted: boolean;
  /** SLICE 12e-3c (owner F10): the quantity shown is the quantity of the item this SECTION sits under -- it
   * follows that item until the pricer types their own here. The tag is the section's own ("from pipe").
   * Present ONLY on an attached section whose quantity the pricer has not typed. */
  qtyMirrorTag?: string;
  state: "priced" | "blank";
  reason?: string;
  skuLine?: string;
  working: string[];
  figures: Partial<Record<RateKind, number>>;
  /** SLICE 12e-3a (owner 13:40): the sections ATTACHED to this item, drawn directly under it. Absent on every
   * block of a config that declares no section, and on a block whose toggle is closed. */
  sections?: SectionBlockView[];
}

/** The whole item-list view a suggestion carries for the panel. */
export interface ItemListView {
  unit: string;
  unitClass: string | null;
  /** The pricer may pick the row unit ONLY where no row supplies one (the calculator). */
  unitPickable: boolean;
  unitChoices: string[];
  rowPriced: boolean;
  reason?: string;
  /** SLICE 12c-U (owner U2 / U3): how a row that stated NO unit -- or "rate only" -- came to be
   *  priced in the unit it was. Present ONLY on such a row; every other row carries nothing, so no
   *  existing panel changes. */
  unitNote?: string;
  /** SLICE 12d-2 (owner S6): the unit the figures are a RATE IN (the catalogue's word), present ONLY
   *  when the row's own unit was resolved -- the panel's "per ..." label reads it before `unit`. */
  rateUnit?: string;
  items: ItemBlockView[];
  families: Array<{ family: string; units: string }>;
  editState: ItemListEditState;
  modelCount: number;
  /**
   * SLICE 12e-3b (owner D1b, 2026-10-12 "option a"): a delegated section that is OPEN WITH NOTHING PICKED --
   * in the calculator the item / material choice always starts blank, however the section opened. The panel
   * draws the section's heading and its family list (`families`); `items` is empty and the section does not
   * price until one is picked. Present ONLY on such a section.
   */
  pickFamily?: true;
  /**
   * The ROW's own totals, as `priceItemList` returned them -- the same figures the headline shows.
   *
   * ⚠️ PRESENT ONLY ON A PRICED ROW, AND IT IS WHAT "Row total" MUST READ. Summing the item blocks
   * is NOT the same number: a composition expands one user block into several priced layers, so the
   * block sum reports the first layer alone (cert-found 2026-10-04 -- 219 shown where the row cost
   * 474, beside a headline that already said 474).
   */
  totals?: Partial<Record<RateKind, number>>;
  /**
   * SLICE 12e-3a (owner D5a / 13:42): present ONLY on a config that declares sections. `addLabel` names the
   * config's own items on the add button ("Add pipe"); `adds` is one button per delegated section ("Add
   * insulation") with the families it offers; `independent` the sections that belong to no item, drawn after
   * the items; `lines` / `bad` count every line of the row -- each item and each section -- for "n of m
   * items need a person".
   */
  sections?: {
    addLabel: string;
    adds: Array<{ id: string; addLabel: string; families: Array<{ family: string; units: string }> }>;
    independent: SectionBlockView[];
    lines: number;
    bad: number;
  };
}

/** A suggestion that carries the item-list view (an extension read by the panel through this alias). */
export type ItemListSuggestion = Suggestion & { itemList?: ItemListView };

/**
 * PURE. The unit choices offered where no row supplies one: the first spelling of each declared class.
 *
 * SLICE 12c-S (owner S2 / S10) -- NARROWED TO THE UNITS THE ITEMS ON THE ROW CAN ACTUALLY BE PRICED IN.
 * `families` is the families the row's blocks have chosen; the offer is the UNION of what each can be
 * priced in (`familyUnitClasses`, which reads the family's own pipelines, its declared conversions and
 * its `units_not_offered`). A row with no family chosen yet offers every declared class, exactly as
 * before -- there is nothing yet to narrow by, and a picker that offered nothing could not be used.
 *
 * ⚠️ THE ORDER AND THE SPELLING ARE UNCHANGED: this filters the same list it always returned, so a
 * class that survives is still named by its first declared spelling and still sits where it sat.
 */
export function unitChoicesOf(spec: ItemListPricingSpec, families: readonly (string | null)[] = []): string[] {
  const chosen = families.filter((f): f is string => typeof f === "string" && f !== "");
  const allowed = new Set<string>();
  for (const f of chosen) for (const cls of familyUnitClasses(spec, f)) allowed.add(cls);
  const offer = (cls: string) => allowed.size === 0 || allowed.has(cls);
  const out = Object.entries(spec.unit_classes)
    .filter(([cls]) => offer(cls))
    .map(([, spellings]) => spellings[0])
    .filter((u): u is string => typeof u === "string" && u !== "");
  /**
   * SLICE 12c-F, FIX C (owner R-C, 2026-10-06) -- THE PICKER ALSO OFFERS THE UNITS THE PRICING CAN
   * CONVERT INTO ONE THE ITEM IS SOLD IN.
   *
   * A `unit_factors` unit belongs to a class AND scales the rate (sq.ft -> sq.m x 0.0929). Before
   * this it was offered nowhere, so a BoQ row written in sq.ft could be priced on the panel and was
   * simply unreachable in the calculator -- cause C of the 12c-P parity list. Offering it costs no
   * new arithmetic: `unitFactorOf` already resolves the spelling and the conversion already runs.
   *
   * ⚠️ `units_not_offered` STILL WINS, because this is filtered through the SAME `allowed` set the
   * native classes are: a family that hides its area class hides sq.ft with it. Double-skin plenum
   * therefore stays sq.m only.
   *
   * ⚠️ ONE SPELLING PER UNIT, exactly as a class is named by its first declared spelling. ADP
   * declares four spellings of the same square foot (`sqft`, `sq ft`, `sq.ft`, `sft`); offering all
   * four would be four ways to say one thing. The first declaration wins, and a unit already named by
   * a class is never added twice.
   */
  const seen = new Set(out.map((u) => u.trim().toLowerCase()));
  for (const [spelling, d] of Object.entries(spec.unit_factors ?? {})) {
    if (!d || typeof d.factor !== "number" || !(d.class in spec.unit_classes)) continue;
    if (!offer(d.class)) continue;
    const word = (d.word ?? spelling).trim().toLowerCase();
    if (seen.has(spelling.trim().toLowerCase()) || seen.has(word)) continue;
    seen.add(spelling.trim().toLowerCase());
    seen.add(word);
    out.push(spelling);
  }
  return out;
}

/**
 * SLICE 12c-S (E2E-1). PURE. Per block, the picks whose value the block's OTHER answers no longer
 * stock: `model attribute id -> the value that is going`.
 *
 * It asks the question the dropdown itself asks -- `itemFieldDefs` over the block's own answers -- so
 * a value survives exactly when the list would still offer it. Only a pick the PRICER made from a
 * catalogue list is eligible: a typed "Other..." value and a value the model supplied are both left
 * alone, because neither is a choice between stocked options.
 *
 * ⚠️ IT MUST NOT CASCADE INTO SILENCE. Each field is tested against the options computed from the
 * answers as they stand, and `fieldOptionsFromSkus` skips the field under test, so one stale pick can
 * remove itself without dragging a second valid one out with it.
 */
/**
 * SLICE 12d-8 (owner R3): DID THE MODEL OPEN THIS FIELD'S "Other..." BOX? The one test, shared by the
 * stale-pick clearing (`unstockedPicks`: a value typed into such a box is typing, never a pick) and the
 * field view (`itemBlockView`: the box STAYS OPEN while the pricer types into it). The model's own cell
 * for the field holds a non-empty value that is neither an option nor matchable to one.
 *
 * ⚠️ CERT-FOUND 2026-10-09 (12d-8 C5): with the pricer's first keystroke `userEdited` became true and the
 * box's `otherMode` dropped -- the box UNMOUNTED after ONE character ("5" of "50"), the select jumped to
 * the rung that character laddered to (6.35), and every further keystroke was lost. R3 had kept the VALUE
 * (it was no longer cleared) while the box that receives it closed. Both halves read this one predicate.
 */
function modelOpenedField(
  spec: ItemListPricingSpec,
  modelItem: ExtractedListItem | undefined,
  f: { id: string; skuAttr: string; options?: string[] },
): boolean {
  const mv = modelItem?.attributes?.[f.id]?.value;
  if (typeof mv !== "string" || mv.trim() === "") return false;
  const opts = f.options ?? [];
  if (opts.includes(mv)) return false;
  return matchStatedToOption(mv, opts, spec.numbers[f.skuAttr]) === null;
}

function unstockedPicks(
  spec: ItemListPricingSpec,
  defs: ReturnType<typeof listSpecDefs>,
  items: RateMasterItem[],
  edits: ItemListEditState,
  assembled: ExtractedListItem[],
  unitClass: string | null,
  /** SLICE 12d-8 (owner R3): the model's items, to tell a box the MODEL opened from a pick. */
  modelItems: ExtractedListItem[] = [],
  /**
   * SLICE 12e-2b (owner, 2026-10-10, AC13: "this should also follow the ladder mechanism with correct note ...
   * this is the general ladder rule we have"). A pick on a field that HAS A LADDER (`spec.ladders`) which the
   * block's other answers no longer stock is NOT cleared: it is left on the item, so the pricer resolves it
   * with that field's own ladder exactly as it resolves a typed or model-read value (the same cell, the same
   * function -- nothing is copied), and it is recorded HERE, per block, as `model attribute id -> { picked,
   * other }` so the field can say "<picked> is not stocked with <the other answer> -> priced as <used>".
   * A field with no ladder (a choice) keeps the 12c-S / 12d-8 R1 rule below: cleared, never refilled.
   */
  ladderedOut?: Array<Map<string, { picked: string; other: string }>>,
): Array<Map<string, string>> {
  return assembled.map((a, i) => {
    const out = new Map<string, string>();
    const laddered = new Map<string, { picked: string; other: string }>();
    if (ladderedOut) ladderedOut[i] = laddered;
    const edit = edits.items[i];
    if (!edit) return out;
    const famRaw = a.attributes[familyAttr(spec)]?.value;
    const family = typeof famRaw === "string" ? famRaw : null;
    if (!family || !spec.families[family]) return out;
    const fieldDefs = itemFieldDefs(spec, defs, family, unitClass, { items, answers: {} });
    /**
     * SLICE 12d-8 (owner R3, 2026-10-09): TYPING INTO A BOX THE MODEL OPENED IS TYPING THROUGH "Other...".
     *
     * The box opens by itself when the model's value matches no option (`otherMode`), and the pricer then
     * types straight into it -- without ever choosing "Other..." from the select, so `edit.other` never
     * records it and the clearing below treated the typed size as a stale PICK (12d-6 C6a / 12d-7 F-3: a
     * typed 50 over the model's "250 NB" was cleared and the row lost its pipe size). The test is the one
     * `itemBlockView` uses to open the box: the model's own cell holds a non-empty value that is neither an
     * option nor matchable to one.
     */
    const base = edit.family === null && edit.base !== null ? modelItems[edit.base] : undefined;
    const modelOpened = (f: { id: string; skuAttr: string; options?: string[] }): boolean => modelOpenedField(spec, base, f);
    /**
     * ⚠️ THE TEST MUST BE DIRECTIONAL, OR BOTH ANSWERS CLEAR EACH OTHER. Pipe 100 with thickness 25 is
     * unstocked BOTH ways round -- no pipe 100 SKU carries 25, and no thickness-25 SKU carries pipe 100 --
     * so a symmetric check wipes the pair and the pricer loses the answer they just gave.
     *
     * The direction is the config's OWN `ladders` order, which the pricer already declares as
     * load-bearing ("the axis that selects the SKU set comes first"). Answers accumulate in that order
     * and each field is judged against the ones BEFORE it: the coarse axis stands, the dependent one
     * goes. Fields the ladder does not name (a plain choice such as cladding) are settled first, since
     * they select the SKU set rather than a size on it.
     */
    const rank = (f: { skuAttr: string }) => {
      const i = spec.ladders.indexOf(f.skuAttr);
      return i < 0 ? -1 : i;
    };
    const ordered = [...fieldDefs].sort((x, y) => rank(x) - rank(y));
    const answers: Record<string, string | number> = {};
    for (const f of ordered) {
      const v = a.attributes[f.id]?.value;
      const stated = typeof v === "number" ? v : (typeof v === "string" && v !== "" && v !== "None" ? v : undefined);
      const picked = edit.attrs[f.id];                            // ONLY the pricer's own pick is droppable
      /**
       * ⚠️ A FIELD WITH NO OPTIONS AT ALL CAN NEVER HAVE OFFERED THE VALUE, so the value cannot be a
       * stale pick and must not be dropped. Cladding Only stocks no sizes -- its pipe size and
       * thickness are inputs to a formula, typed by hand -- and without this guard a correctly priced
       * cladding row had both its sizes cleared and stopped pricing altogether.
       */
      const droppable = !!f.options && f.options.length > 0
        && !(edit.other ?? []).includes(f.id)                     // typed through "Other..." -- let the ladder work
        && !modelOpened(f)                                        // 12d-8 R3: the model opened the box -- the same
        && typeof picked === "string" && picked !== "" && picked !== "None";
      if (droppable) {
        const live = itemFieldDefs(spec, defs, family, unitClass, { items, answers }).find((x) => x.id === f.id);
        const opts = live?.options;
        if (opts && !opts.includes(picked)) {
          if (!spec.ladders.includes(f.skuAttr)) { out.set(f.id, picked); continue; }  // dropped: it narrows nothing
          // AC13: a LADDER field's pick stays and ladders. The answer(s) that unstocked it are named: each
          // earlier answer that, on its own, takes the pick off the list -- else all of them together.
          const optionsUnder = (ans: Record<string, string | number>) =>
            itemFieldDefs(spec, defs, family, unitClass, { items, answers: ans }).find((x) => x.id === f.id)?.options ?? [];
          const entries = Object.entries(answers).filter(([k]) => k !== f.skuAttr);
          const alone = entries.filter(([k, v]) => !optionsUnder({ [k]: v }).includes(picked));
          const named = (alone.length ? alone : entries).map(([k, v]) => plainFact(plainFactOf(spec, k, v, family)));
          laddered.set(f.id, { picked, other: named.length ? named.join(" and ") : family.trim() });
        }
      }
      if (stated !== undefined) answers[f.skuAttr] = stated;
    }
    return out;
  });
}

/** SLICE 12e-4d (owner, 2026-10-14: "fix"; AC3) -- PURE. How a ladder hop on an axis WITHOUT `how` landed, in
 * the words the working line uses for the same step: the sheet's spelling, the smallest size (below the smallest
 * stocked size), or the next size up (between two stocked sizes). */
export function hopLandedWords(hop: LadderHop): string {
  return hop.exact ? "(the sheet's own spelling of this size)" : hop.belowSmallest ? "(the smallest size)" : "(next size up)";
}

/**
 * SLICE 12e-4d (owner, 2026-10-14: "ok (fix)"; AC5) -- PURE. What the field's line quotes for a size the PRICER
 * typed on an axis without `how`: the text AS TYPED, then the number it was read as wherever the two differ --
 * "You typed 3/4 -> 19.05 mm", never "You typed 19.05 mm". A bare number, or the number with its own unit, is
 * quoted as before ("You typed 25 mm"), which also keeps a size mirrored from a pipe byte-identical.
 */
export function typedSizeEcho(typed: string, requested: number, unitSuffix: string): string {
  const read = `${fmtNum(requested)}${unitSuffix}`;
  const t = typed.trim();
  const plain = t === "" || (/^\d+(?:\.\d+)?$/.test(t) && Number(t) === requested)
    || t.replace(/\s+/g, " ").toLowerCase() === read.trim().toLowerCase();
  return plain ? read : `${t} -> ${read}`;
}

function itemBlockView(
  spec: ItemListPricingSpec,
  defs: ReturnType<typeof listSpecDefs>,
  edit: ItemEdit,
  assembled: ExtractedListItem,
  res: ItemPriceResult,
  unitClass: string | null,
  items: RateMasterItem[] = [],
  /** Every priced layer of THIS block, in order. One for an ordinary item; several after a
   *  composition. `res` stays the FIRST, so field display and refusal text are unchanged. */
  layers: ItemPriceResult[] = [res],
  /** SLICE 12c-S (E2E-1): model attribute id -> the pick that was cleared because the block's other
   *  answers no longer stock it. Empty for every block where nothing was cleared. */
  clearedByBlock: ReadonlyMap<string, string> = new Map(),
  /** SLICE 12c-F (fix B): model attribute id -> the model's wording and the option it was matched to.
   *  Empty for every block where the model's values were already the catalogue's own spellings. */
  matchedByBlock: ReadonlyMap<string, { from: string; to: string; by?: "text" | "number" }> = new Map(),
  /** SLICE 12d-8 (owner R3): the MODEL's item behind this block (undefined for an added item), so a
   *  box the model opened stays open while the pricer types into it. */
  modelItem: ExtractedListItem | undefined = undefined,
  /** SLICE 12e-2b (AC13): model attribute id -> a LADDER field's pick the other answers do not stock, and the
   *  answer(s) that unstocked it. The pricer laddered it; the field shows the value used and says so. */
  ladderedByBlock: ReadonlyMap<string, { picked: string; other: string }> = new Map(),
): ItemBlockView {
  const famId = familyAttr(spec);
  const familyIsControl = spec.panel_controls?.[famId] === "dropdown_or_other";
  const family = res.family ?? (typeof assembled.attributes.family?.value === "string" ? assembled.attributes.family.value : null)
    // SLICE 12e-2 (owner P1): on a family CONTROL a typed spelling the reader refused (SS, ABC) still heads the
    // block as written, so the refusal beneath reads against what was typed; every other category is unchanged
    ?? (familyIsControl && typeof assembled.attributes[famId]?.value === "string" ? String(assembled.attributes[famId].value) : null);
  /**
   * SLICE 12e-2 (owner P1 + amendment, block 19 d): the family as a control. The typed box opens when the pricer
   * chose "Other..." (recorded under the family id in `edit.other`) or when the value on the block is not a
   * stocked family (the reader mapped or refused it) -- so a mapped GI keeps its box open with "GI" in it while
   * the block's heading shows the family USED (MS). The note is the config's own (`panel_notes`).
   */
  const familyControl: FamilyControlView | undefined = familyIsControl
    ? (() => {
        const options = Object.keys(spec.families);
        // the box shows what is ON the block as written -- the pricer's typed spelling, or the model's answer
        // (the size box's `typedValue` reading); a resolved family never overwrites it
        const onBlock = assembled.attributes[famId]?.value;
        const typedValue = edit.family ?? (typeof onBlock === "string" && onBlock !== "None" ? onBlock : "");
        const explicit = (edit.other ?? []).includes(famId);
        const otherMode = explicit || (typedValue !== "" && !options.includes(typedValue));
        const famDef = defs.find((d) => d.id === famId);
        const note = typedFieldNote(spec, famId, new Set<string>(), options);
        return { id: famId, label: famDef?.label ?? famId, options, otherMode, typedValue, ...(note ? { note } : {}) };
      })()
    : undefined;
  // SLICE 6b (V1, X2): the block's answers as they reached the matcher (defaults applied, ladders fitted) narrow
  // each dropdown's options exactly as they narrow the ladder's rungs
  // SLICE 12c-S: the answers that narrow each dropdown are EVERY fact this block resolved, not only
  // the ones the matcher reached -- a row refusing for a missing thickness has still ANSWERED its pipe
  // size, and the thickness list must narrow to that pipe. `selection` wins where both carry a key,
  // because it holds the ladder-resolved rung.
  const answers: Record<string, string | number> = {};
  for (const [k, v] of Object.entries({ ...(res.readValues ?? {}), ...res.selection })) {
    if (typeof v === "string" || typeof v === "number") answers[k] = v;
  }
  const fieldDefs = itemFieldDefs(spec, defs, family, unitClass, { items, answers });
  const defaultedBy = new Map(res.defaulted.map((d) => [d.attr, d]));
  // SLICE 12e-5b (owner R2): a choice priced from the BoQ's own words (`choice_text`) -- its value and amber line
  const textMappedBy = new Map((res.textMapped ?? []).map((t) => [t.attr, t]));
  const hopBy = new Map(res.ladderHops.map((h) => [h.attr, h]));
  // SLICE 9 (owner A-6): a field a config override DECIDED shows the value that priced, under the
  // catalogue's own word for it, with the rule beneath -- a pricer must never read the variant the row
  // happened to name beside a figure that came from a different SKU.
  const overrideBy = new Map((res.overrides ?? []).map((o) => [o.attr, o]));
  // SLICE 12e-2b (AC13): the block's working, read here so a laddered pick's COMPOSITION line (which the pricer
  // writes into the working, not onto a hop) can be quoted under its field and re-opened with the pick's words
  const blockWorking = layersWorking(layers, res);
  const ladRewrites: Array<{ from: string; to: string }> = [];
  const fields: ItemFieldView[] = fieldDefs.map((f) => {
    const raw = assembled.attributes[f.id]?.value;
    const stated = raw === null || raw === undefined ? "" : String(raw);
    const userEdited = Object.prototype.hasOwnProperty.call(edit.attrs, f.id);
    const d = defaultedBy.get(f.skuAttr);
    // a "None" (or an absent-as-none) answer shows the ruled default it became, marked; the pricer's own pick
    // shows as picked
    const defaulted = !!d && !userEdited && (stated === "None" || stated === "");
    const tm = userEdited ? undefined : textMappedBy.get(f.skuAttr);
    let value = defaulted ? d!.value : tm ? tm.value : stated;
    const hop = hopBy.get(f.skuAttr);
    // OWNER FA8: `dropdown_or_other` is a size dropdown too -- it shows the LADDER RESULT with the
    // note naming the stated size, which is the whole reason an unstocked size may be typed.
    const isSizeDropdown = (f.control === "dropdown" || f.control === "dropdown_or_other")
      && f.skuAttr in spec.numbers;
    /**
     * OWNER C-R4 (standing, 2026-10-04): "always in pricing hlper the attrinbute should show the
     * value which was actually used to calculate the vealue", and the note "should declare correctly
     * how it landed there". So the field holds the value the pricing USED, and the note says how it
     * got there, in the owner's own phrasing.
     *
     * ⚠️ WHO SAID IT CHANGES THE SENTENCE (FA8(h)). A value the pricer typed reads "You typed ...";
     * one the model read off the BoQ reads "BoQ says ...". Same transformation, same arrow, honest
     * about its source -- a pricer should never be told they typed something they did not.
     */
    const unitOf = spec.numbers[f.skuAttr]?.unit;
    const u = unitOf ? ` ${unitOf}` : "";
    // SLICE 12e-4b (owner G1, 2026-10-12 "yes"): a value NOBODY stated -- the ruled default -- is named as the
    // default; "BoQ says 9 mm" under a thickness no BoQ mentioned (and, in the calculator, with no BoQ at all)
    // was a sentence about a source that does not exist. A value the BoQ did state keeps "BoQ says".
    const said = userEdited ? "You typed" : (defaulted ? "Default" : "BoQ says");
    /**
     * SLICE 12e-2b (AC13): a PICK the block's other answers do not stock was laddered, not cleared. Its line
     * opens "<picked> is not stocked with <the other answer>" where a typed value's opens "You typed <value>";
     * everything after the arrow is the SAME ladder wording, because it is the same ladder.
     */
    const lad = ladderedByBlock.get(f.id);
    const ladLead = lad ? `${lad.picked}${u} is not stocked with ${lad.other}` : undefined;
    /**
     * SLICE 12c-S (owner S5 on F6) -- DOES THE ROW'S REFUSAL SPEAK ABOUT *THIS* FIELD?
     *
     * The refusal belongs to the row; the line belongs to a field. Composing one from the other without
     * asking put another field's complaint under the pipe size -- "You typed 22.2 mm: no number in 'abc'
     * for thickness" -- a sentence whose subject and whose grievance are different fields. The test is
     * the one `needed` already used to decide which field to outline in red; it is simply asked here too.
     */
    const fieldName = spec.numbers[f.skuAttr]?.name ?? "\u0000";
    const altName = spec.reason_names?.[f.skuAttr] ?? "\u0000";
    const reasonIsMine = !!res.reason && (res.reason.includes(fieldName) || res.reason.includes(altName));
    let note: string | undefined;
    /**
     * SLICE 12c-S (owner S5 on F5) -- WHENEVER THE VALUE USED IS NOT THE VALUE ENTERED, SAY SO.
     *
     * ⚠️ THE OLD TEST WAS `!hop.exact`, AND IT MISSED THE PRECISION MATCH ENTIRELY. A stated 22.2 is
     * resolved onto the catalogue's 22.23 BEFORE the ladder runs, so the ladder then fits exactly and
     * reports `exact: true` -- with `requested` 22.2 and `fitted` 22.23. The screen showed 22.2 in the
     * box, 22.23 in the select, and no line at all connecting them. Comparing the two numbers catches
     * both roads to a substitution and still says nothing when nothing moved.
     */
    if (hop && hop.how !== undefined) {
      /**
       * SLICE 12e-2 (owner P2 / Q14 / Q14a / Q17 / Q11): on an axis that DECLARES its ladder rungs, the line
       * shows the whole read -- what was entered, the number read from it (both conversions when the second
       * one landed), and the rung with HOW it landed:
       *   "You typed 5/8\" -> 15.875 mm -> priced as 15.9 mm (the sheet's own spelling of this size)"
       *   "You typed 4 inch -> 101.6 mm / 100 mm -> priced as 100 mm"
       *   "You typed 110 -> priced as 150 mm (next size up)" / "... -> priced as 19 mm (the smallest size)"
       * `hop.how` is written only where a declaring key is present, so every other axis keeps the line below.
       */
      // SLICE 12e-3b (owner 2026-10-11): a text that stated two or more sizes leads with which one was taken;
      // the read that follows is the TAKEN size's, so the line never converts the whole text as one number
      const sev = hop.several;
      const entered = sev ? sev.chosen : (stated.trim() !== "" ? stated.trim() : fmtNum(hop.requested));
      const bare = /^\s*\d+(?:\.\d+)?\s*$/.test(entered) && Number(entered) === hop.requested;
      const read = bare ? "" : (hop.how === "alt" && typeof hop.alt === "number"
        ? ` -> ${fmtNum(hop.requested)}${u} / ${fmtNum(hop.alt)}${u}`
        : ` -> ${fmtNum(hop.requested)}${u}`);
      const landed = hop.how === "exact" && hop.requested === hop.fitted
        ? ""
        : hop.how === "smallest" ? " (the smallest size)"
        : hop.how === "up" ? " (next size up)"
        : hop.how === "alt" ? ""
        : " (the sheet's own spelling of this size)";
      const sevLead = sev ? `${said} ${stated.trim()}: ${severalSizesTaken(sev.sizes, sev.chosen)}` : undefined;
      if (!(hop.how === "exact" && hop.requested === hop.fitted && bare)) {
        note = `${sevLead ?? ladLead ?? `${said} ${entered}`}${read} -> priced as ${fmtNum(hop.fitted)}${u}${landed}`;
      } else if (sevLead) {
        note = sevLead;
      }
    } else if (hop && hop.several && stated.trim() !== "") {
      // SLICE 12e-4c (owner, 2026-10-13: "fix"): an axis that reads inches but declares no ladder wording
      // (Insulation's pipe size) says which of two sizes was taken, in Piping's own words -- "BoQ says 19/25:
      // states two sizes (19 / 25) - the higher, 25, is taken" -- and then, where the ladder moved it, where it
      // landed, in this axis's own ladder wording.
      note = `${said} ${stated.trim()}: ${severalSizesTaken(hop.several.sizes, hop.several.chosen)}`
        + (hop.requested !== hop.fitted
          ? ` -> priced as ${fmtNum(hop.fitted)}${u} ${hopLandedWords(hop)}`
          : "");
    } else if (hop && hop.requested !== hop.fitted) {
      // SLICE 12e-4d (AC5): a size the PRICER typed is quoted as typed ("You typed 3/4 -> 19.05 mm -> ..."); a
      // value the BoQ stated keeps its line exactly as before (`typedSizeEcho` is reached only by a typed one)
      const quoted = userEdited ? typedSizeEcho(stated, hop.requested, u) : `${fmtNum(hop.requested)}${u}`;
      note = `${ladLead ?? `${said} ${quoted}`} -> priced as ${fmtNum(hop.fitted)}${u} ${hopLandedWords(hop)}`;
    }
    if (isSizeDropdown) {
      // SLICE 6b (V3, X3): the field shows the size that will be PRICED -- the ladder result -- with the note naming
      // the stated size; an exact fit shows the stocked spelling; a size above the largest keeps the refusal and
      // shows no pick (the stated size stays on the note, never silently replaced)
      if (hop) value = String(hop.fitted);
      else if (value !== "" && !(f.options ?? []).includes(value)) {
        const parsed = readNumber(value, spec.numbers[f.skuAttr]);
        /**
         * SLICE 12d-8 (owner U7): `value` here is the text as ENTERED and may carry its own unit or be no
         * number at all ("Double layer of 19 mm thick"); the unit is appended to a BARE number only, so the
         * line never reads "... thick mm:" (the 12d-6 leftover).
         */
        const vU = /^\s*\d+(?:\.\d+)?\s*$/.test(value) ? u : "";
        if (parsed && "value" in parsed) {
          if (res.state === "priced") {
            /**
             * SLICE 12c-S (owner S5 on F7) -- A PRICED ROW DOES NOT SAY NOTHING FITS.
             *
             * A cladding-only row carries no geometry on its SKUs, so its pipe size and thickness are
             * INPUTS TO A FORMULA rather than rungs to match. The field was nonetheless told "no stocked
             * size fits" -- beside a correct price, which reads as a failure that somehow still produced
             * a figure. The size WAS used; the sheet simply stocks none to choose between.
             */
            note = `${said} ${value}${vU}: used to work out this item's rate (the sheet stocks no sizes to choose from here)`;
          } else if (reasonIsMine) {
            note = `${ladLead ?? `${said} ${value}${vU}`}: ${res.reason}`;
            value = "";
          }
          // F6: the row refused for ANOTHER field -- that field says so; this one stays quiet.
        } else if (value.trim() !== "") {
          // OWNER FA8(e): an entry that is not a number at all. SLICE 12c-S: where the row refused for
          // THIS field, its own reason is more specific than the generic prompt ("several values stated
          // for thickness ('13+13')" says what is wrong; "enter a number" does not), so it is preferred.
          note = reasonIsMine && res.reason
            ? `${said} ${value}${vU}: ${res.reason}`
            : `Enter a number in ${unitOf ?? "mm"}, or an inch size like 7/8".`;
          value = "";
        }
      }
    }
    /**
     * SLICE 12c-F (fix B): the model's wording was read into the catalogue's. The field shows the
     * option -- so the select can display it and the pricer can see what was used -- and this line
     * keeps the BoQ's own words, because a pricer checking the sheet must be able to tell that
     * "3 Slot" and 3 are the same answer and not a substitution.
     */
    const matched = matchedByBlock.get(f.id);
    /**
     * SLICE 12d-6: the stated text is the model's RAW cell and may already carry its unit ("19 mm"); the
     * unit is appended only to a BARE number, so the line reads "BoQ says 19 mm -> 19 mm", never "19 mm mm".
     */
    const fromU = matched && /^\s*\d+(?:\.\d+)?\s*$/.test(matched.from) ? u : "";
    /**
     * SLICE 12d-8 (owner R2, 2026-10-09): on a NUMBER match the note shows HOW the reader read the stated
     * text -- its own line ("states several values -- the highest, 25, is taken", "20 cm read as 200 mm",
     * "range '25 to 50' -> its top value 50") -- never "the sheet's own spelling", which is true only of a
     * plain match ("19 mm" -> 19, no reader line) and keeps that wording. The ladder's hop, where there is
     * one, follows on the same line so the two facts stay in reading order.
     */
    const readerLine = (() => {
      if (!matched || matched.by !== "number") return undefined;
      const rd = spec.numbers[f.skuAttr];
      const r = rd ? readNumber(matched.from, rd) : null;
      if (!r || !("value" in r) || !r.note) return undefined;
      const quoted = `'${matched.from}' `;
      return r.note.startsWith(quoted) ? r.note.slice(quoted.length) : r.note;
    })();
    if (matched && readerLine) {
      note = `${said} ${matched.from}${fromU} -> ${matched.to}${u} (${readerLine})`
        + (hop && hop.requested !== hop.fitted ? ` -> priced as ${fmtNum(hop.fitted)}${u} ${hopLandedWords(hop)}` : "");
    } else if (matched && !note) note = `${said} ${matched.from}${fromU} -> ${matched.to}${u} (the sheet's own spelling of this value)`;
    // SLICE 12c-S (E2E-1): a pick the pricer's later answers no longer stock was CLEARED before pricing;
    // the field says which value went and why, so nothing is substituted behind their back.
    if (lad && ladLead) {
      // a pick that COMPOSED (above the largest stocked size) carries its line in the working: "You typed 25 mm
      // -> priced as 13 + 13 mm ..." -- the same line, opened with what actually happened to the pick
      const typedLead = `You typed ${lad.picked}${u}`;
      ladRewrites.push({ from: typedLead, to: ladLead });
      const line = blockWorking.find((w) => w.startsWith(`${typedLead} -> `));
      if (!note && line) note = `${ladLead}${line.slice(typedLead.length)}`;
    }
    const dropped = clearedByBlock.get(f.id);
    if (dropped !== undefined) note = `${dropped}${u} is not stocked with the other answers on this item -- choose again`;
    const ov = overrideBy.get(f.skuAttr);
    let optionLabels: Record<string, string> | undefined;
    /**
     * SLICE 12e-2b (owner D2, "UL wins" on both paths): a HAND-PICKED value an override replaced is shown the
     * same way once the field can no longer show the pick -- its list has narrowed to what the override
     * priced (a picked "motorised" beside a picked UL "yes": the list is the UL 555 SKU alone). A pick the
     * list still offers stays the pricer's own (a picked foil, which the value map prices as 26G with its line).
     */
    if (ov && (!userEdited || !(f.options ?? []).includes(stated))) {
      value = ov.value;
      note = ov.rule;
      if (ov.display !== ov.value) optionLabels = { [ov.value]: ov.display };
    }
    // SLICE 12e-5b (owner R6, AC1): a size written two ways that do not agree ('1/2" (15.9mm)') refused the row --
    // the box shows no figure it refused on (the inch half alone would read as a stocked size), and the line says why
    const echo = f.skuAttr in spec.numbers ? inchWithMmEcho(stated) : null;
    const twoWaysHere = !!echo && "conflict" in echo && res.state === "blank" && !!res.reason && res.reason.includes(echo.conflict);
    if (twoWaysHere) {
      value = "";
      note = `${said} ${stated.trim()}: ${res.reason}`;
    }
    // OWNER FA8(c)/(d): a size field a pricer can type into explains HOW the value will be matched --
    // every number in the explanation read from the LIVE options, never written here.
    const matchHelp = f.allowOther ? sizeFieldHelp(spec, f.skuAttr, f.options ?? [])?.lines : undefined;
    const needed = res.state === "blank" && (reasonIsMine || twoWaysHere);
    /**
     * SLICE 12c-S (owner S5 on F15) -- IS THIS FIELD IN "Other..." MODE? DECIDED HERE, NOT GUESSED.
     *
     * Three cases, and only the first two open the typed box:
     *   - the pricer CHOSE "Other..." (recorded in the edit state) -- they are typing;
     *   - a value arrived that the catalogue does not stock AND the pricer did not pick it, i.e. the
     *     model read it off the BoQ -- show it, and let the ladder resolve it as it always has;
     *   - everything else, INCLUDING A FRESH FIELD. An untouched field now reads "- select -" instead
     *     of opening on "Other..." with an empty box, which is what it did when this was derived from
     *     emptiness alone.
     *
     * A pick the pricer made that the catalogue no longer stocks is NOT other mode -- it was cleared
     * before pricing (E2E-1) and the select goes back to "- select -" with the line above saying why.
     */
    const explicitOther = (edit.other ?? []).includes(f.id);
    const inOptions = (f.options ?? []).includes(stated);
    // SLICE 12d-8 (owner R3): a value the pricer typed into a box the MODEL opened keeps the box open --
    // they are typing through "Other..." without having chosen it (see `modelOpenedField`). A typed value
    // that IS an option closes it, exactly as a pick would.
    const modelOpened = !!f.allowOther && userEdited && modelOpenedField(spec, modelItem, f);
    const otherMode = !!f.allowOther
      && (explicitOther || (stated !== "" && !inOptions && (!userEdited || modelOpened)));
    // SLICE 12e-2 (owner Q10): a `panel_optional` value the MODEL supplied and the pricer has not edited is
    // read-only text ("read-only text when present"); the calculator, which has no model value, shows the box.
    const modelGave = !!f.optional && !userEdited && typeof modelItem?.attributes?.[f.id]?.value === "string"
      && String(modelItem?.attributes?.[f.id]?.value).trim() !== "";
    /**
     * SLICE 12e-3c (owner F11 "fix": "Something marked as defaulted should also show its value") -- A RULED
     * DEFAULT THE DROPDOWN DOES NOT STOCK IS SHOWN IN THE FIELD'S OWN "Other..." BOX. A thickness default of
     * 9 mm is laddered to a stocked size when the row can price, and the field then shows that size. Where
     * the ladder cannot run (the row refused earlier, e.g. on its pipe size) the value is still the ruled 9,
     * but 9 is no option, so the select fell back to "- select -" beside its amber "default" tag. The box now
     * shows the ruled value (owner 2026-10-12: "Show 9"). Only a field that allows "Other..." can show it;
     * `value` is unchanged, so nothing that prices or matches reads a different thing.
     */
    const defaultInBox = defaulted && !!f.allowOther && value !== "" && !!f.options && !f.options.includes(value);
    // ... and on a plain dropdown (no "Other...") the ruled value is listed, so the select can show the value
    // the row is using: "Cladding Only" per sq.m with cladding not mentioned -> No, where "No" is not stocked
    const defaultAsOption = defaulted && !f.allowOther && value !== "" && !!f.options && !f.options.includes(value);
    return {
      ...f,
      ...(defaultAsOption ? { options: [...f.options!, value] } : {}),
      value,
      typedValue: defaultInBox ? value : stated,
      defaulted,
      ...(defaulted ? { rule: d!.rule } : tm ? { rule: tm.line } : {}),
      ...(modelGave ? { readOnly: true as const } : {}),
      userEdited,
      otherMode: otherMode || defaultInBox,
      ...(note ? { note } : {}),
      ...(optionLabels ? { optionLabels } : {}),
      ...(matchHelp && matchHelp.length ? { matchHelp } : {}),
      blank: value === "" && needed,
    };
  });
  /**
   * CERT-FOUND 2026-10-04 (owner: "the row total line does not match ... in the calculation block,
   * which is confusing"). A COMPOSED row buys several LAYERS for one user block, so this block's
   * figures are the SUM OF ITS OWN LAYERS -- not the first layer's. Before this the block read
   * 219 / 14 / 233 while the row total read 474 / 28 / 502, two numbers on one screen that could not
   * be reconciled, and the smaller one sat under the item the pricer had filled in.
   *
   * `layers` is this block's priced items, in order; for everything uncomposed it is exactly one, so
   * every other category is byte-identical.
   */
  const figures: Partial<Record<RateKind, number>> = {};
  if (res.state === "priced") {
    let supply = 0, install = 0, anySupply = false, anyInstall = false;
    for (const l of layers) {
      if (typeof l.figures.supply === "number") { supply += l.figures.supply; anySupply = true; }
      if (typeof l.figures.install === "number") { install += l.figures.install; anyInstall = true; }
    }
    if (anySupply) figures.supply_rate = supply;
    if (anyInstall) figures.install_rate = install;
    if (anySupply && anyInstall) figures.combined_rate = supply + install;
  }
  return {
    index: res.index,
    source: edit.base !== null && edit.family === null ? "model" : "user",
    family,
    familyRaw: res.familyRaw !== null && res.familyRaw !== family ? res.familyRaw : null,
    // SLICE 12e-2 (owner Q16 / Q15 / P1): the `family_text` line, and the family CONTROL where the config
    // declares the family attribute `dropdown_or_other` -- the typed box is bound to what the pricer typed
    // (`edit.family`), never to the resolved family (the 12c FINISH lesson on the size box).
    ...(res.familyLine ? { familyLine: res.familyLine } : {}),
    ...(familyControl ? { familyControl } : {}),
    // SLICE 12d-1a (owner R2): the family was RULED, not read -- shown amber with its rule. A family
    // the pricer picked themselves is theirs, exactly as a typed field is never marked as a default.
    ...(res.familyDefaulted && edit.family === null ? { familyDefaulted: res.familyDefaulted } : {}),
    fields,
    // SLICE 12d-1a (owner R7): read-only attributes -- declared in config, read off the assembled item,
    // shown under the definition's label. A value the model did not give is simply absent.
    readOnly: (spec.panel_readonly ?? []).flatMap((id) => {
      const raw = assembled.attributes[id]?.value;
      if (raw === null || raw === undefined || raw === "None" || String(raw).trim() === "") return [];
      // SLICE 12e-4b (owner D-3, decision 2 "(b)"): the family AS WRITTEN is shown only where it differs from
      // the family priced -- "copper" beside Copper says nothing, "uPVC" beside PVC is the point of the line
      if (id === spec.family_text?.from_attr && family !== null && String(raw).trim().toLowerCase() === family.trim().toLowerCase()) return [];
      const def = defs.find((d) => d.id === id);
      return [{ id, label: def?.label ?? id, value: String(raw) }];
    }),
    // SLICE 6d: what the field shows -- the pricer's typed value, else the count the MODEL read, else code's 1
    qty: edit.qty ?? String(res.qty),
    qtyDefaulted: edit.qty === undefined && res.qtyDefaulted,
    state: res.state,
    ...(res.reason ? { reason: res.reason } : {}),
    // SLICE 12e-5b (owner, AC8a): a SKU that carries no item name (Insulation's) is named by its family -- it used to
    // read " / (Mts)". A SKU WITH a name is untouched, so every Piping and ADP line is byte-identical.
    ...(res.sku ? { skuLine: res.sku.item_name === undefined && !res.sku.item_detail && res.family
      ? `${res.family} (${res.sku.unit ?? ""})`
      : `${res.sku.item_name ?? ""} / ${res.sku.item_detail ?? ""} (${res.sku.unit ?? ""})` } : {}),
    working: ladRewrites.length
      ? blockWorking.map((w) => { const r = ladRewrites.find((x) => w.startsWith(`${x.from} -> `)); return r ? `${r.to}${w.slice(r.from.length)}` : w; })
      : blockWorking,
    figures,
  };
}

/**
 * The working a block shows. One layer -> exactly what it always was. SEVERAL layers -> the
 * composition line first (it belongs to the whole block), then each layer's own derivation under a
 * heading naming the layer and its figures, so the block's total can be ADDED UP ON SCREEN.
 *
 * ⚠️ Without this the block showed the first layer's derivation under the first layer's figure, and a
 * pricer had no way to see where the rest of the money went -- or which layer carried the cladding.
 */
function layersWorking(layers: ItemPriceResult[], res: ItemPriceResult): string[] {
  if (layers.length <= 1) return res.working;
  const out: string[] = [];
  // the composition line was unshifted onto the FIRST layer and speaks for the block
  const head = layers[0].working[0] ?? "";
  const isComposeLine = /->/.test(head) && /priced as/.test(head);
  if (isComposeLine) out.push(head);
  layers.forEach((l, i) => {
    const size = Object.entries(l.selection).map(([, v]) => v).length ? "" : "";
    const sup = typeof l.figures.supply === "number" ? l.figures.supply : null;
    const ins = typeof l.figures.install === "number" ? l.figures.install : null;
    const money = sup !== null && ins !== null ? ` -- supply ${sup}, install ${ins}` : "";
    out.push(`Layer ${i + 1} of ${layers.length}${size}${money}`);
    const body = i === 0 && isComposeLine ? l.working.slice(1) : l.working;
    for (const w of body) out.push(`   ${w}`);
  });
  return out;
}

/**
 * The item-list compute: the model's items (an in-run row) overlaid with the panel's session edits, priced by
 * the pure module, shaped for the panel. A row outside the run (and the calculator) starts with NO items --
 * "Add an item to price this row". All or nothing: `values` is filled ONLY when every item priced (S4).
 */
/** SLICE 12e-3a: what the section pass needs back from the own-items pass -- nothing it reads is recomputed. */
interface OwnPassProbe {
  /** in: the model-item count of each declared section (a section edit's `base` indexes those) */
  sectionCounts?: Record<string, number>;
  /** out: the decoded edit state */
  edits?: ItemListEditState;
  /** out: block index -> its priced layers (the first is the item's own result) */
  layers?: Map<number, ItemPriceResult[]>;
}

function computeItemListOwn(
  category: RateCategoryConfig,
  spec: ItemListPricingSpec,
  items: RateMasterItem[],
  ctx: RowContextWithUnit,
  ext: ExtractionRowWithItems | undefined,
  inRun: boolean,
  overrides?: Record<string, string>,
  probe?: OwnPassProbe,
): HelperResult {
  const modelItems = ext?.items ?? [];
  const edits = decodeItemEdits(overrides?.[ITEM_LIST_OVERRIDE_KEY], modelItems.length, probe?.sectionCounts);
  if (probe) probe.edits = edits;
  const assembled = assembleItems(edits, modelItems, familyAttr(spec));
  // SLICE 12c-S (owner S2 / S10): the picker offers only the units the chosen items can be priced in.
  const chosenFamilies = assembled.map((a) => {
    const v = a.attributes[familyAttr(spec)]?.value;
    return typeof v === "string" ? v : null;
  });
  const unitChoices = unitChoicesOf(spec, chosenFamilies);
  const unitPickable = ctx.unit === undefined || ctx.unit === null;
  // SLICE 12e-3c: the calculator -- no row supplies the unit, or a section pass says so for a delegated call
  const calculator = unitPickable || ctx.noRow === true;
  // ⚠️ A STORED PICK THAT IS NO LONGER OFFERED IS NOT HONOURED. Picking a family whose SKUs are sold
  // per metre while the row still carried a sq.m pick left the row refusing "no SKU per sq.m", with
  // a unit on screen the picker no longer lists. The first surviving choice stands instead.
  const picked = overrides?.[ROW_UNIT_OVERRIDE_KEY];
  const unit = unitPickable
    ? ((picked !== undefined && unitChoices.includes(picked) ? picked : undefined) ?? unitChoices[0] ?? "")
    : ctx.unit!;
  const defs = listSpecDefs(category);
  const rowClass = unitClassOf(spec, unit);
  /**
   * SLICE 12c-F, FIX B (owner R-B, 2026-10-06) -- READ THE MODEL'S VALUE INTO THE DROPDOWN'S VOCABULARY,
   * BEFORE ANYTHING PRICES.
   *
   * `"3 Slot"` and the option `3` are the same answer written two ways. Matching them here -- on the
   * ASSEMBLED attributes, before `priceItemList` sees them -- is what makes the field show the value the
   * rate was computed from, and it is why the fix needs no change to any pricing function: the pricing
   * already read 3 out of `"3 Slot"`; only the screen could not.
   *
   * ⚠️ A VALUE THE PRICER TYPED IS NEVER REWRITTEN. `edit.attrs` holds their own entry, and an entry
   * typed through "Other..." is deliberately an unstocked value -- rewriting it would be the
   * substitution rule 12c-S exists to forbid. Only a value the MODEL supplied is matched.
   *
   * ⚠️ NOTHING IS INVENTED. `matchStatedToOption` returns null unless an option means the same thing, so
   * an unstocked size is left untouched and still ladders to the next rung.
   */
  const matchedByBlock: Array<Map<string, { from: string; to: string; by: "text" | "number" }>> = [];
  const assembledMatched = assembled.map((a, i) => {
    const matches = new Map<string, { from: string; to: string; by: "text" | "number" }>();
    matchedByBlock.push(matches);
    const famV = a.attributes[familyAttr(spec)]?.value;
    const fam = typeof famV === "string" && famV !== "" ? famV : null;
    if (!fam || !spec.families[fam]) return a;
    const typed = edits.items[i]?.attrs ?? {};
    const attributes = { ...a.attributes };
    for (const f of itemFieldDefs(spec, defs, fam, rowClass, { items })) {
      if (Object.prototype.hasOwnProperty.call(typed, f.id)) continue; // the pricer's own entry is theirs
      const raw = attributes[f.id]?.value;
      if (typeof raw !== "string" || raw.trim() === "") continue;
      // SLICE 12e-2b (AC2): a two-way field's options are its two values, exactly as `itemFieldDefs` offers them
      const opts = twoWayValues(spec, f.skuAttr, fam) ?? fieldOptionsFromSkus(spec, items, fam, rowClass, f.skuAttr, {});
      if (opts.includes(raw)) continue;
      /**
       * SLICE 12d-6 (owner, 2026-10-08) -- OPTION MATCHING MUST NEVER DISCARD MEANING THE PRICER READS.
       * A thickness the model writes as LAYERS ("Double layer of 19mm thick", "25 mm thick - 2 Layers",
       * "13+13") is read by `readLayers` inside `priceItemList` and priced as a composition (12d-1b /
       * 12d-4c). The R-B match below reads the FIRST number of such a text (19), finds the option "19"
       * and would hand the pricer a single layer -- which is exactly what 12e-0b measured (615 / 224 where
       * the pure pricer says 991 / 238). A layered value is therefore left as written: it reaches the
       * pricer intact and the field shows it the way "25 mm thick - 2 Layers" already does (the Other...
       * box with the stated text, the layer lines in the working). Option matching runs only on values
       * the pricer would read the same way.
       */
      if (readLayers(raw) !== null) continue;
      // SLICE 12e-5b (owner R6, AC1): nor a size written two ways that do not agree -- its inch half alone would
      // match a stocked option and the box would show a size the row then refuses on
      const echo = inchWithMmEcho(raw);
      if (echo !== null && "conflict" in echo) continue;
      const hit = matchStatedToOptionDetailed(raw, opts, spec.numbers[f.skuAttr]);
      if (hit === null || hit.to === raw) continue;
      attributes[f.id] = { ...attributes[f.id], value: hit.to };
      matches.set(f.id, { from: raw, to: hit.to, by: hit.by });
    }
    return matches.size === 0 ? a : { ...a, attributes };
  });
  /**
   * SLICE 12c-S (E2E-1, owner S1) -- A PICK THE OTHER ANSWERS NO LONGER STOCK IS CLEARED, NOT SUBSTITUTED.
   *
   * Once a dropdown is narrowed by the answers already given, a value chosen EARLIER can stop being
   * offered: pick thickness 25 at pipe 25, then move to pipe 100, which stocks only 65. Leaving the 25
   * in place prices the row at 65 -- 2.6x the thickness on screen -- and that substitution is what the
   * owner ruled out. So the stale pick is dropped BEFORE pricing: the row then refuses for a missing
   * thickness and the field says which value went and why.
   *
   * ⚠️ IT TOUCHES ONLY A VALUE THE PRICER PICKED FROM A LIST. A value they TYPED through "Other..."
   * is deliberately unstocked and must still ladder; a value the MODEL read off the BoQ is evidence
   * about the row, not a choice, and must still resolve. Both are left exactly as they were.
   */
  // SLICE 12e-2b (AC13): a LADDER field's unstocked pick is not in `clearedPicks` -- it stays and ladders
  const ladderedPicks: Array<Map<string, { picked: string; other: string }>> = [];
  const clearedPicks = unstockedPicks(spec, defs, items, edits, assembledMatched, rowClass, modelItems, ladderedPicks);
  /**
   * SLICE 12d-8 (owner R1 + R2, 2026-10-09) -- WHAT THE PRICER GETS vs WHAT THE SCREEN SHOWS.
   *
   * `forDisplay` is the block as the fields draw it: every match applied, a cleared pick REMOVED (its
   * select goes back to "- select -" with the line saying why). `forPricing` differs in two deliberate ways:
   *   - a NUMBER match keeps the STATED text (R2). The pricer reads the same number from it -- that is what
   *     the match tested -- and so also produces the reader's own line ("states several values -- the
   *     highest, 25, is taken", "20 cm read as 200 mm"), which rewriting the value first discarded (12d-7
   *     F-2). A TEXT match is still rewritten: "gi rectangular" prices only as "GI rectangular".
   *   - a cleared pick is MARKED `cleared`, not deleted (R1). Deleted, the pricer read "not mentioned" and
   *     a ruled default re-priced the row beside the "choose again" note (12d-7 F-1); marked, the pricer
   *     refuses for that field until the pricer chooses, and no default fires.
   */
  const forDisplay = assembledMatched.map((a, i) => {
    const drop = clearedPicks[i];
    if (!drop || drop.size === 0) return a;
    const attributes = { ...a.attributes };
    for (const id of drop.keys()) delete attributes[id];
    return { ...a, attributes };
  });
  const forPricing = assembled.map((a, i) => {
    const attributes = { ...a.attributes };
    for (const [id, m] of matchedByBlock[i] ?? []) {
      if (m.by === "text") attributes[id] = { ...attributes[id], value: m.to };
    }
    for (const id of (clearedPicks[i] ?? new Map()).keys()) attributes[id] = { value: null, cleared: true };
    return { ...a, attributes };
  });
  /**
   * SLICE 12d-1a (owner R2): the row's own text and its HEADINGS reach the pricer, so a silent
   * material can be decided by the words the owner named ("acoustic", "lining") wherever they sit
   * -- the row or a section heading above it. The page builds `headings` from the priced rows'
   * parent chain; the calculator has none and the words simply never match there.
   */
  const rowText = [ctx.description ?? "", ...(ctx.headings ?? [])].join(" | ");
  /**
   * SLICE 12d-4a (owner D3 / D7 / D9b): the row's OWN text -- its description and its own notes, NEVER a
   * heading -- reaches the pricer separately, for the word rules that must not be triggered by a heading.
   * The calculator has no row and passes nothing, so those rules read only the model's values there.
   */
  const ownText = [ctx.description ?? "", ...(ctx.ownNotes ?? [])].join(" | ");
  const priced = priceItemList(spec, items, unit, forPricing, rowText, ownText);
  const unitClass = priced.unitClass ?? unitClassOf(spec, unit);
  /**
   * CERT-FOUND 2026-10-04. A composition turns ONE user block into SEVERAL priced layers, so
   * `priced.items` and `edits.items` stop being one-to-one and `priced.items[i]` is no longer this
   * block's item -- it is the first layer of whichever block the index happens to land in. Group by
   * the `sourceIndex` the pricer stamps; `?? index` keeps the old positional reading for any result
   * that predates the stamp, which is exactly the uncomposed one-to-one case.
   */
  const layersBySource = new Map<number, ItemPriceResult[]>();
  priced.items.forEach((p, idx) => {
    const src = typeof p.sourceIndex === "number" ? p.sourceIndex : idx;
    const list = layersBySource.get(src);
    if (list) list.push(p); else layersBySource.set(src, [p]);
  });
  if (probe) probe.layers = layersBySource;
  /**
   * SLICE 12c-F, FIX B, SECOND HALF (owner R-B) -- "A row must never price from a value its field
   * cannot show."
   *
   * After the match pass, a value still outside its dropdown's options is one of two things: a size the
   * LADDER resolved (the field then shows the rung that was bought -- honest, and the whole point of the
   * ladder), or a value nothing can show, which is the state this forbids. So the test is: the row
   * priced, the field offers options, the value is not one of them, and no ladder hop explains it.
   *
   * ⚠️ IT IS DECIDED HERE, NOT IN THE PRICING. `priceItemList` is untouched; this reads its result and
   * withholds the row, exactly as the stale-pick rule withholds a cleared value. The reason names the
   * field and the value, in the owner's words.
   */
  const unshowable: Array<{ block: number; field: string; label: string; value: string }> = [];
  if (priced.priced) {
    forDisplay.forEach((a, i) => {
      const famV = a.attributes[familyAttr(spec)]?.value;
      const fam = typeof famV === "string" && famV !== "" ? famV : null;
      if (!fam || !spec.families[fam]) return;
      const mine = layersBySource.get(i) ?? [];
      const res0 = mine[0];
      const hops = new Set(mine.flatMap((l) => l.ladderHops.map((h) => h.attr)));
      /**
       * ⚠️ THE TEST IS WHAT THE FIELD WILL SHOW, NOT WHAT THE MODEL WROTE -- and the first draft of this
       * got it wrong in a way worth recording. It refused four rows for `Damper: None`, where "None" is
       * the POSITIVE-ABSENCE sentinel that the ruled defaults consume ("damper not mentioned = without").
       * The field shows `without`, the row prices correctly, and nothing is hidden. A mechanism that
       * SUPPLIES the shown value -- a ruled default, a config override, a ladder hop -- therefore answers
       * the question before it is asked, exactly as `itemBlockView` answers it when it renders.
       */
      const supplied = new Set<string>([
        ...(res0?.defaulted ?? []).map((d) => d.attr),
        ...(res0?.overrides ?? []).map((o) => o.attr),
      ]);
      for (const f of itemFieldDefs(spec, defs, fam, unitClass, { items })) {
        const raw = a.attributes[f.id]?.value;
        if (typeof raw !== "string" || raw === NONE_SENTINEL) continue;
        // SLICE 12e-2b (AC2, recon anomaly 7): this site reads the SKU list directly, so it asks the two-way
        // test first -- the field offers both values, and the check must never disagree with the field
        const opts = twoWayValues(spec, f.skuAttr, fam) ?? fieldOptionsFromSkus(spec, items, fam, unitClass, f.skuAttr, {});
        if (!fieldCannotShowValue(raw, opts, { hopped: hops.has(f.skuAttr), supplied: supplied.has(f.skuAttr) })) continue;
        unshowable.push({ block: i, field: f.id, label: f.label, value: raw });
      }
    });
  }
  const unshowableReason = unshowable.length
    ? `${unshowable[0].label}: ${unshowable[0].value} is not one of the options - choose one`
    : undefined;
  const unshowableByBlock = new Map<number, { field: string; reason: string }>();
  for (const u2 of unshowable) {
    if (!unshowableByBlock.has(u2.block)) {
      unshowableByBlock.set(u2.block, { field: u2.field, reason: `${u2.label}: ${u2.value} is not one of the options - choose one` });
    }
  }
  const blocks = edits.items.map((e, i) => {
    const mine = layersBySource.get(i) ?? [];
    const res: ItemPriceResult = mine[0] ?? {
      index: i, familyRaw: null, family: null, skuUnitClass: null, state: "blank", reason: priced.reason,
      selection: {}, readValues: {}, defaulted: [], ladderHops: [], overrides: [], conversion: null, sku: null, finals: {}, qty: 1, qtyDefaulted: true, figures: {}, working: [], pipelineResults: [],
    };
    // SLICE 12e-5 (AC1): a section's item refusing on the size its pipe gives it shows what it had read
    const held = ctx.showHeldDefaultsOn !== undefined && res.state === "blank" && res.heldDefaults?.need === ctx.showHeldDefaultsOn
      ? { ...res, defaulted: res.heldDefaults.defaulted } : res;
    // the block is drawn from what was PRICED (the stale pick removed), with the cleared value carried
    // separately so the field can name it
    return itemBlockView(spec, defs, e, forDisplay[i], held, unitClass, items, mine.length ? mine : [res],
                         clearedPicks[i] ?? new Map(), matchedByBlock[i] ?? new Map(),
                         e.family === null && e.base !== null ? modelItems[e.base] : undefined,
                         ladderedPicks[i] ?? new Map());
  });
  const values: Record<string, number> = {};
  if (priced.priced && !unshowableReason) {
    if (typeof priced.supply === "number") values.supply_rate = priced.supply;
    if (typeof priced.install === "number") values.install_rate = priced.install;
    if (typeof values.supply_rate === "number" && typeof values.install_rate === "number") values.combined_rate = values.supply_rate + values.install_rate;
  }
  const n = blocks.length;
  const rowPriced = priced.priced && !unshowableReason;
  const basis = rowPriced
    ? `Rate master: ${categoryLabel(category)} \u00b7 ${n} item${n === 1 ? "" : "s"}`
    : n === 0
      ? "Add an item to price"
      : "Complete the missing attributes to price";
  const derivation: string[] = [];
  if (rowPriced) derivation.push(`Row total per 1 ${unit}: supply ${priced.supply} + install ${priced.install}`);
  else if (unshowableReason) derivation.push(unshowableReason);
  else if (priced.reason) derivation.push(priced.reason);
  const view: ItemListView = {
    unit, unitClass, unitPickable, unitChoices, rowPriced, ...((unshowableReason ?? priced.reason) ? { reason: unshowableReason ?? priced.reason } : {}),
    ...(priced.unitNote ? { unitNote: priced.unitNote } : {}),
    ...(priced.rateUnit ? { rateUnit: priced.rateUnit } : {}),
    items: blocks, families: familyChoices(spec), editState: edits, modelCount: modelItems.length,
    // the ROW's own totals -- the same figures the headline shows, so "Row total" can never disagree
    // with it (see the warning on `rowTotals`)
    ...(rowPriced ? { totals: { ...values } as Partial<Record<RateKind, number>> } : {}),
  };
  /**
   * SLICE 12e-3c -- THE ONE FUNCTION EVERY DISPLAY STRING OF THIS VIEW PASSES THROUGH.
   *   F7 (owner "fix"): the category's own field labels go to the plain-English step, so a field id written
   *     with an underscore reads as its label ("thickness not mentioned -> 9", never "thickness_mm ...").
   *   F4 (owner: "In the calculator it should say 'pick a cladding'" - "ok"): in the calculator a choice the
   *     pricer has not made yet reads "pick a <field>" where a BoQ row the model read says "could not tell
   *     <field>". The pricer's sentence is rewritten here, at the view boundary; the pure pricer is untouched
   *     and a model-read row keeps its wording. No field is named: the sentences are built from the config's
   *     own choice fields and their labels.
   */
  const fieldLabels: Record<string, string> = Object.fromEntries(defs.map((d) => [d.id, String(d.label ?? d.id)]));
  const pickSentences: Array<[string, string]> = calculator
    ? spec.choice_attrs.map((id) => {
        const word = labelAsWord(fieldLabels[id] ?? id);
        return [`could not tell ${spec.reason_names?.[id] ?? spec.numbers[id]?.name ?? id}`, `pick ${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`] as [string, string];
      })
    : [];
  const say = (line: string): string => {
    let s = line;
    for (const [from, to] of pickSentences) if (s.includes(from)) s = s.split(from).join(to);
    return plainPricerText(s, items, fieldLabels);
  };
  const out: ItemListSuggestion = {
    kind: "suggestion",
    values,
    ...(inRun ? { producibleKinds: PRODUCIBLE_KINDS } : {}),
    basis,
    workings: { attributes: [], matchedRows: [], derivation: derivation.map(say), finalValues: { ...values } },
    itemList: plainItemListView(view, say),
  };
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 12e-3a (owner D1 / D1a / D3 / D3a / D3b / D4 / Q2a / 13:40 / 13:42, 2026-10-11) -- THE SECTIONS OF A ROW.
//
// A config declaring `list_spec.sections` prices a row as LINES: its own items (a Piping row's pipes), a
// delegated section attached under an item whose toggle is open, and delegated sections that belong to no
// item. Owner D1: the section "prices through the Insulation category's own spec, catalogue and inputs - no
// second copy of any Insulation rule". So a section is priced by `computeItemListOwn` -- the function the
// delegated category's own rows and its calculator tab go through -- called with THAT category's config
// object (resolved from the helper's own config map), its spec and the same items, for ONE item. Owner D1a:
// it "will behave same as the insulation category except the pipe size mirror/overwrite rule i mentioned and
// the yes/no toggle" -- so nothing below reads, defaults, ladders or words anything of the section's own; the
// only things this pass adds are the toggle, the mirror and the row's totals.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

/** PURE. The size an item's number was READ as, for a section to mirror (owner D3b: "for pricing we consider
 * 1 NB = 1 mm and should be matched with the catalog as per that only"): the read that landed -- the stated
 * number (5/8" -> 15.875, MS 100 -> 100), or the second inch conversion where that is the one the item priced
 * on (4 inch -> 100). The delegated category then resolves it against ITS OWN catalogue. Undefined when the
 * item stated no readable number. */
export function mirroredNumber(res: ItemPriceResult | undefined, attr: string): string | undefined {
  if (!res) return undefined;
  // SLICE 12e-4d (AC2): a size whose READING refused the item ("size 1 has no unit") was never read -- nothing is
  // mirrored from it, so an independent section can never take it either
  if (res.sizeRefused === attr) return undefined;
  const hop = res.ladderHops.find((h) => h.attr === attr);
  if (hop) return fmtNum(hop.how === "alt" && typeof hop.alt === "number" ? hop.alt : hop.requested);
  const v = res.readValues?.[attr];
  return typeof v === "number" ? fmtNum(v) : undefined;
}

type ConfigOf = (categoryId: string) => RateCategoryConfig | null;

function computeItemList(
  category: RateCategoryConfig,
  spec: ItemListPricingSpec,
  items: RateMasterItem[],
  ctx: RowContextWithUnit,
  ext: ExtractionRowWithItems | undefined,
  inRun: boolean,
  overrides: Record<string, string> | undefined,
  configOf: ConfigOf,
): HelperResult {
  const declared = delegatedSections(spec);
  // a config that declares no section is priced exactly as it always was -- the one call, nothing around it
  if (declared.length === 0) return computeItemListOwn(category, spec, items, ctx, ext, inRun, overrides);

  const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const resolved = declared.map((s) => {
    const cfg = configOf(s.category_id);
    const dspec = cfg ? itemListPricingSpec(cfg) : null;
    return { s, cfg: dspec ? cfg : null, dspec };
  });

  /**
   * THE MODEL'S ITEMS, TOLD APART (owner Q3: insulation "arrives as a second item in the row's list").
   * SLICE 12e-4b (owner D-2, 2026-10-13): BY THE MARKER THE RUN STORES. An item belongs to a section when its
   * `section` equals that section's id -- the marker the model answers and the parser keeps, coerced by the
   * delegated category's own definitions. Every other item is this config's own, a marker naming no declared
   * section included (the parser stores such an item with no marker at all, so it shows as a blank block that
   * needs a person). REPLACES 12e-3a's test (an item NOT carrying the owner's family key): the parser stores
   * every definition of the row's category on every item, so no stored item could ever have passed it.
   */
  const ownModel: ExtractedListItem[] = [];
  const secModel: Record<string, ExtractedListItem[]> = {};
  for (const it of ext?.items ?? []) {
    const sec = typeof it.section === "string" ? resolved.find((r) => r.s.id === it.section) : undefined;
    if (sec) (secModel[sec.s.id] ??= []).push(it); else ownModel.push(it);
  }
  const probe: OwnPassProbe = { sectionCounts: Object.fromEntries(resolved.map((r) => [r.s.id, (secModel[r.s.id] ?? []).length])) };
  const ownRes = computeItemListOwn(category, spec, items, ctx, ext ? { ...ext, items: ownModel } : undefined, inRun, overrides, probe) as ItemListSuggestion;
  const ownView = ownRes.itemList!;
  const edits = probe.edits!;
  const layers = probe.layers ?? new Map<number, ItemPriceResult[]>();
  const rowUnit = ownView.unit;
  // the calculator has no row, so nothing supplies the unit (the helper's one existing test for it)
  const calculator = ownView.unitPickable;
  const ownSectionLabel = (spec.sections ?? []).find((s) => !s.category_id)?.label ?? "item";

  /** ONE section, priced by the delegated category's own path, for one item; then the mirror's tag and lines. */
  const priceSection = (
    r: (typeof resolved)[number], secEdit: ItemEdit, pipe: number | null, index: number, mirrorText: string | undefined,
    ownerQty?: string,
    /** SLICE 12e-4d (AC2): the item's own refusal, where it refused on the size this section takes from it */
    pipeRefusal?: string,
  ): SectionBlockView => {
    const heading = `${r.s.label} - priced by ${r.cfg ? categoryLabel(r.cfg) : r.s.label}'s rules`;
    if (!r.cfg || !r.dspec) {
      // the delegated category is not in this helper's config map: never price it with any other rules
      const reason = `${r.s.label} cannot be priced here - its rules are not loaded; price it by hand`;
      return { sectionId: r.s.id, heading, pipe, index,
               view: { unit: rowUnit, unitClass: null, unitPickable: false, unitChoices: [], rowPriced: false, reason, items: [], families: [], editState: { items: [] }, modelCount: 0 } };
    }
    const modelItem = secEdit.base !== null && secEdit.family === null ? secModel[r.s.id]?.[secEdit.base] : undefined;
    const offered = new Set(r.s.families ?? []);
    const stocked = (fam: string) => items.some((it) => it.kind === r.dspec!.kind && it.attributes?.[familyAttr(r.dspec!)] === fam);
    /**
     * SLICE 12e-3b (owner D1b, 2026-10-12 "option a") -- IN THE CALCULATOR THE MATERIAL STARTS BLANK. A section
     * the toggle opened used to be handed to the delegated category with no family, so its "not mentioned"
     * rule priced it as its default material with the line "Not mentioned on the BoQ" -- on a screen that has
     * no BoQ. There the section now opens on the family list with nothing picked, exactly as "+ Add insulation"
     * does, and prices once one is picked. On a BoQ row the delegated category's own default stays (the model
     * path: material not mentioned -> its ruled default, amber, its own line). "The calculator" is the one
     * test the helper already has for it: no row supplies the unit.
     */
    if (calculator && secEdit.base === null && secEdit.family === null) {
      const famLabel = String(listSpecDefs(r.cfg).find((d) => d.id === familyAttr(r.dspec!))?.label ?? r.s.label).trim();
      const reason = `Choose the ${famLabel.charAt(0).toLowerCase()}${famLabel.slice(1)}`;
      return { sectionId: r.s.id, heading, pipe, index,
               view: { unit: rowUnit, unitClass: null, unitPickable: false, unitChoices: [], rowPriced: false, reason, items: [],
                       families: familyChoices(r.dspec).filter((f) => offered.has(f.family) && stocked(f.family)),
                       editState: { items: [secEdit] }, modelCount: 0, pickFamily: true } };
    }
    const mir = r.s.mirror;
    const toId = mir ? r.dspec.numbers[mir.to]?.from[0] : undefined;
    const handEdited = toId !== undefined && hasOwn(secEdit.attrs, toId);
    const mirrored = !!mir && toId !== undefined && !handEdited && mirrorText !== undefined;
    /**
     * SLICE 12e-4d (owner, 2026-10-14: "fix"; AC2) -- A SECTION NEVER PRICES A SIZE ITS PIPE REFUSED TO READ. The
     * pipe refused on its size ("size 1 has no unit - price this row by hand", "... - pick one", a size it cannot
     * read, a cleared pick), and this section's size comes from that pipe: the section refuses with the pipe's
     * own sentence and shows no figure. Its size box stays open and empty, so a size the pricer TYPES there
     * prices the section exactly as before (owner: "the user can change it if they want"). A pipe refused for
     * anything else (SS, an unknown type, a size above the largest) does not reach this.
     */
    const refusedByPipe = !!mir && toId !== undefined && !handEdited && pipeRefusal !== undefined;
    // the mirrored size enters the delegated category exactly as a size typed into its own "Other..." box
    // would (the same cell, the same reader, the same ladder) -- it is never resolved here
    /**
     * SLICE 12e-3c (owner F10: "its should be one only"; "for insulation under pipe keep the box and link it to
     * pipe but the user can change it if they want") -- AN ATTACHED SECTION'S QUANTITY IS ITS ITEM'S. The box
     * starts as the quantity the item above it shows, tagged with the section's own tag, and follows it; once
     * the pricer types in the section's box their value stays. A count the MODEL read on the section's own
     * item does not break the link (owner 2026-10-12: "The pipe's"). A section that belongs to no item keeps
     * its own box. The quantity enters the delegated category exactly as a quantity typed in its own box.
     */
    const qtyLinked = pipe !== null && secEdit.qty === undefined && ownerQty !== undefined;
    const qtyTag = r.s.mirror?.tag ?? `from ${String(ownSectionLabel).toLowerCase()}`;
    const callEdit: ItemEdit = {
      base: modelItem ? 0 : null,
      family: secEdit.family,
      attrs: mirrored ? { ...secEdit.attrs, [toId!]: mirrorText! } : refusedByPipe ? { ...secEdit.attrs, [toId!]: "" } : { ...secEdit.attrs },
      ...(qtyLinked ? { qty: ownerQty } : (secEdit.qty !== undefined ? { qty: secEdit.qty } : {})),
      ...(mirrored || refusedByPipe ? { other: [...new Set([...(secEdit.other ?? []), toId!])] } : (secEdit.other ? { other: [...secEdit.other] } : {})),
    };
    const dext = modelItem ? ({ excelRow: ctx.excelRow, description: ctx.description, attributes: {}, items: [modelItem] } as ExtractionRowWithItems) : undefined;
    /**
     * SLICE 12e-5 (owner, 2026-10-14, on 12e-4d: "the attribute values should be captured else the user will have
     * to enter everything from scratch"; AC1) -- A SECTION REFUSING OVER ITS PIPE'S SIZE KEEPS WHAT THE AI READ.
     * Whether its pipe refused the size (12e-4d AC2) or stated none, the section's item refuses at the size need,
     * and the defaults it had already read ("None" -> cladding "No", amber, with its rule) used to be dropped, so
     * the field showed "- select -". They are shown now exactly as Insulation shows them on a priced row; the
     * section still refuses, with no figure and no "priced as" line. A value with no dropdown word ("6mm") shows
     * as before, in its "Other..." box.
     */
    const res = computeItemListOwn(r.cfg, r.dspec, items, { ...ctx, unit: rowUnit, ...(calculator ? { noRow: true } : {}), ...(mir ? { showHeldDefaultsOn: mir.to } : {}) }, dext, inRun,
                                   { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [callEdit] }) }) as ItemListSuggestion;
    const dview = res.itemList!;
    if (refusedByPipe) {
      const { totals: _t, ...rest } = dview;
      const fromPipe = mirroredLead(`${TYPED_LEAD}${pipeRefusal}`, mir!.tag);
      const view: ItemListView = {
        ...rest,
        families: dview.families.filter((f) => offered.has(f.family) && stocked(f.family)),
        rowPriced: false,
        reason: pipeRefusal,
        items: dview.items.map(({ skuLine: _sku, ...b }) => ({
          ...b,
          ...(qtyLinked ? { qtyDefaulted: false, qtyMirrorTag: qtyTag } : {}),
          state: "blank" as const,
          reason: pipeRefusal,
          figures: {},
          fields: b.fields.map((f) => (f.id === toId ? { ...f, value: "", typedValue: "", userEdited: false, mirrorTag: mir!.tag, note: fromPipe } : f)),
        })),
      };
      return { sectionId: r.s.id, heading, pipe, index, view };
    }
    const view: ItemListView = {
      ...dview,
      // the families the section offers: the declared ones that have an active SKU today
      families: dview.families.filter((f) => offered.has(f.family) && stocked(f.family)),
      items: dview.items.map((b) => ({
        ...b,
        ...(qtyLinked ? { qtyDefaulted: false, qtyMirrorTag: qtyTag } : {}),
        ...(mirrored ? { working: b.working.map((w) => (w.startsWith(`${TYPED_LEAD}${mirrorText}`) ? mirroredLead(w, mir!.tag) : w)) } : {}),
        fields: b.fields.map((f) => {
          if (f.id !== toId || !mir) return f;
          if (mirrored) {
            // owner Q6: a mirrored value was not typed -- the line leads "From pipe:", and there is no edit to undo
            return { ...f, userEdited: false, mirrorTag: mir.tag, ...(f.note !== undefined ? { note: mirroredLead(f.note, mir.tag) } : {}) };
          }
          const chosen = f.typedValue.trim();
          if (handEdited && mirrorText !== undefined && chosen !== "" && chosen !== mirrorText) {
            return { ...f, mirrorLine: mir.line.replace("{chosen}", chosen).replace("{pipe}", mirrorText) };
          }
          return f;
        }),
      })),
    };
    return { sectionId: r.s.id, heading, pipe, index, view };
  };

  // the first item with a readable number, per mirror source -- what an INDEPENDENT section mirrors (owner 13:42)
  const firstReadable = (attr: string): string | undefined => {
    for (let i = 0; i < edits.items.length; i++) {
      const v = mirroredNumber(layers.get(i)?.[0], attr);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  const editsOut: ItemListEditState = { items: edits.items.map((e) => ({ ...e })), sections: {} };
  const blocks = ownView.items.map((b, i): ItemBlockView => {
    const edit = edits.items[i];
    const isModelItem = edit.base !== null && edit.family === null;
    const attached: SectionBlockView[] = [];
    let fields = b.fields;
    for (const r of resolved) {
      const inc = r.s.include_when;
      if (!inc || !r.s.absent) continue;
      const values = twoWayValues(spec, inc.attr, null) ?? [];
      const typed = hasOwn(edit.attrs, inc.attr) && values.includes(edit.attrs[inc.attr]) ? edit.attrs[inc.attr] : undefined;
      // owner Q3: the k-th insulation item of the answer belongs to the k-th pipe of the answer
      const modelSection = isModelItem ? secModel[r.s.id]?.[edit.base!] : undefined;
      const modelCell = isModelItem ? ownModel[edit.base!]?.attributes?.[inc.attr]?.value : undefined;
      const modelSaid = typeof modelCell === "string" && values.includes(modelCell) ? modelCell : undefined;
      // the pricer's pick; else the section's facts are present (owner Q4: Yes even if the model said No);
      // else what the model read; else the declared value for "nothing was read"
      const value = typed ?? (modelSection ? inc.equals : (modelSaid ?? r.s.absent.value));
      // owner: "No" is amber with its line on a BoQ row the model read with no insulation facts; a pipe the
      // pricer added starts "No" plainly
      // SLICE 12e-3c (owner F12 "fix"): in the calculator the "No" nobody picked is a default like every other
      // and carries the amber tag and its line; a pipe the pricer adds on a BoQ row keeps its plain "No"
      const assumed = typed === undefined && !modelSection && modelSaid === undefined && (isModelItem || calculator);
      fields = fields.map((f) => {
        if (f.id !== inc.attr) return f;
        const { rule: _rule, ...rest } = f;
        return { ...rest, value, typedValue: value, defaulted: assumed, ...(assumed ? { rule: plainPricerText(r.s.absent!.line, items) } : {}), blank: false };
      });
      if (value !== inc.equals) continue;
      const secEdit: ItemEdit = edit.sections?.[r.s.id] ?? { base: modelSection ? edit.base : null, family: null, attrs: {} };
      editsOut.items[i] = { ...editsOut.items[i], sections: { ...(editsOut.items[i].sections ?? {}), [r.s.id]: secEdit } };
      const own = layers.get(i)?.[0];
      const pipeRefusal = r.s.mirror && own?.sizeRefused === r.s.mirror.from ? own.reason : undefined;
      attached.push(priceSection(r, secEdit, i, 0, r.s.mirror ? mirroredNumber(own, r.s.mirror.from) : undefined, b.qty, pipeRefusal));
    }
    return { ...b, fields, ...(attached.length ? { sections: attached } : {}) };
  });

  const independent: SectionBlockView[] = [];
  for (const r of resolved) {
    // the pricer's list once they have touched it; before that, the model's section items that no pipe of the
    // answer claimed (all of them when the answer carries no pipe)
    const list: ItemEdit[] = edits.sections?.[r.s.id]
      ?? (secModel[r.s.id] ?? []).map((_m, j) => j).filter((j) => j >= ownModel.length).map((j) => ({ base: j, family: null, attrs: {} }));
    editsOut.sections![r.s.id] = list;
    const mirrorText = r.s.mirror ? firstReadable(r.s.mirror.from) : undefined;
    list.forEach((e, k) => independent.push(priceSection(r, e, null, k, mirrorText)));
  }

  // ── the row: every item and every section is a LINE; each rounded by its own rules (owner D4); all or nothing ──
  const sectionViews = [...blocks.flatMap((b) => b.sections ?? []), ...independent];
  const ownCount = blocks.length;
  const lines = ownCount + sectionViews.length;
  const ownOk = ownCount === 0 || ownView.rowPriced;
  const rowPriced = lines > 0 && ownOk && sectionViews.every((sv) => sv.view.rowPriced);
  const bad = blocks.filter((b) => b.state !== "priced").length + sectionViews.filter((sv) => !sv.view.rowPriced).length;
  const values: Record<string, number> = {};
  if (rowPriced) {
    const parts = [...(ownCount ? [ownView.totals ?? {}] : []), ...sectionViews.map((sv) => sv.view.totals ?? {})];
    const sum = (k: RateKind) => parts.reduce((acc, p) => acc + (typeof p[k] === "number" ? p[k]! : 0), 0);
    if (parts.every((p) => typeof p.supply_rate === "number")) values.supply_rate = sum("supply_rate");
    if (parts.every((p) => typeof p.install_rate === "number")) values.install_rate = sum("install_rate");
    if (typeof values.supply_rate === "number" && typeof values.install_rate === "number") values.combined_rate = values.supply_rate + values.install_rate;
  }
  const reason = rowPriced ? undefined
    : (ownCount > 0 && !ownView.rowPriced ? ownView.reason : undefined) ?? sectionViews.find((sv) => !sv.view.rowPriced)?.view.reason ?? ownView.reason;
  const basis = rowPriced
    ? `Rate master: ${categoryLabel(category)} · ${lines} item${lines === 1 ? "" : "s"}`
    : lines === 0 ? "Add an item to price" : "Complete the missing attributes to price";
  const derivation = rowPriced
    ? [`Row total per 1 ${rowUnit}: supply ${values.supply_rate} + install ${values.install_rate}`]
    : (reason ? [reason] : []);
  const ownSection = (spec.sections ?? []).find((s) => !s.category_id);
  const { reason: _ownReason, totals: _ownTotals, ...ownRest } = ownView;
  const view: ItemListView = {
    ...ownRest,
    rowPriced,
    ...(reason ? { reason } : {}),
    items: blocks,
    editState: editsOut,
    ...(rowPriced ? { totals: { ...values } as Partial<Record<RateKind, number>> } : {}),
    sections: {
      addLabel: ownSection?.add_label ?? "Add item",
      adds: resolved.filter((r) => r.cfg && r.dspec).map((r) => ({
        id: r.s.id,
        addLabel: r.s.add_label,
        families: familyChoices(r.dspec!).filter((f) => (r.s.families ?? []).includes(f.family)
          && items.some((it) => it.kind === r.dspec!.kind && it.attributes?.[familyAttr(r.dspec!)] === f.family)),
      })),
      independent,
      lines,
      bad,
    },
  };
  return {
    ...ownRes,
    values,
    basis,
    workings: { ...ownRes.workings, derivation: derivation.map((l) => plainPricerText(l, items)), finalValues: { ...values } },
    itemList: view,
  } as ItemListSuggestion;
}

/**
 * SLICE 12d-5 (owner P1 / P2, F-C5b) -- EVERY pricer-facing string of the item-list view passes through the
 * ONE plain-English function (`plainEnglish.plainPricerText`), here, at the one place the view is built, so
 * the panel and the calculator (the same `compute`, two entries) can never show a code or an internal name
 * that the Derivation tab hides. The sites, named: a field's `rule` (the ruled default beneath it), its
 * `note` (a ladder hop / "BoQ says" / "You typed"), its `matchHelp` sentences; a block's `reason`
 * (refusal), `skuLine`, `working` lines (the interpreter's step labels incl. `item_supply:` prefixes and
 * Pricing-Input ids, the "not mentioned ->" default lines, the override lines) and its
 * `familyDefaulted.rule`; the view's `reason` and `unitNote`; the row-level `workings.derivation` line.
 *
 * ⚠️ DISPLAY STRINGS ONLY. `value` / `typedValue` / `optionLabels` / `selection` / `readValues` / the edit
 * state are what the pricing and the controls MATCH on and are not touched -- a cleaned value would stop
 * matching its option (the controlled-select trap). `label` is a definition label, already plain.
 * ⚠️ The non-item-list path (Electrical) never reaches this function; its lines are the Electrical retrofit.
 */
function plainItemListView(view: ItemListView, p: (s: string) => string): ItemListView {
  return {
    ...view,
    ...(view.reason !== undefined ? { reason: p(view.reason) } : {}),
    ...(view.unitNote !== undefined ? { unitNote: p(view.unitNote) } : {}),
    items: view.items.map((b) => ({
      ...b,
      ...(b.reason !== undefined ? { reason: p(b.reason) } : {}),
      ...(b.skuLine !== undefined ? { skuLine: p(b.skuLine) } : {}),
      ...(b.familyDefaulted ? { familyDefaulted: { ...b.familyDefaulted, rule: p(b.familyDefaulted.rule) } } : {}),
      // SLICE 12e-2: the family line and the family control's note are display strings; `typedValue` and the
      // options are what the control matches on and are never touched
      ...(b.familyLine !== undefined ? { familyLine: p(b.familyLine) } : {}),
      ...(b.familyControl ? { familyControl: { ...b.familyControl, ...(b.familyControl.note !== undefined ? { note: p(b.familyControl.note) } : {}) } } : {}),
      working: b.working.map(p),
      fields: b.fields.map((f) => ({
        ...f,
        ...(f.rule !== undefined ? { rule: p(f.rule) } : {}),
        ...(f.note !== undefined ? { note: p(f.note) } : {}),
        ...(f.matchHelp ? { matchHelp: f.matchHelp.map(p) } : {}),
      })),
    })),
  };
}

// ── SLICE 6: the item-edit OPERATIONS (S1 / S3) -- PURE, each returns a NEW state; the panel serialises it ──

export type ItemEditOp =
  /** SLICE 12c-S (F15): `other` is set by the SELECT, which knows whether the pick was a real option
   *  (false -- the typed box closes) or nothing of the sort. The typed box itself omits it, so typing
   *  never closes the box it is being typed into. */
  | { op: "set_attr"; index: number; id: string; value: string; other?: boolean;
      /** SLICE 12e-3a (owner 13:40, "No removes only that section"): set by a section's toggle when the value
       *  picked CLOSES it -- the item's stored edits for that section go with the pick. */
      dropSection?: string }
  | { op: "undo_attr"; index: number; id: string }
  | { op: "set_qty"; index: number; qty: string }
  | { op: "change_family"; index: number; family: string }
  | { op: "add"; family: string }
  | { op: "remove"; index: number }
  /** SLICE 12c-S (F15): the pricer opened, or closed, this field's "Other..." box. `on` false also
   *  covers picking a real option, which is what takes the field back out of typing. */
  | { op: "set_other"; index: number; id: string; on: boolean }
  /** SLICE 12e-2 (owner P1): the pricer opened the FAMILY field's "Other..." box (`id` = the family attribute
   *  id, recorded in `other` exactly as a size field is); the block starts BLANK with no family (S1). */
  | { op: "set_family_other"; index: number; id: string }
  /** SLICE 12e-2 (owner P1): the pricer typed a family spelling into that box. The block starts BLANK for the
   *  typed family (S1, as "Change item" does), the box stays open, and the ONE reader resolves it at compute. */
  | { op: "set_family_text"; index: number; id: string; text: string }
  /** SLICE 12e-3a (owner D1a): an edit INSIDE a delegated section -- `inner` is the delegated category's own
   *  operation on its one item (index 0). `pipe` = the item the section is attached to, or null with `index`
   *  = its place in the independent list. */
  | { op: "section"; section: string; pipe: number | null; index: number; inner: ItemEditOp }
  /** SLICE 12e-3a (owner 13:42): "+ Add insulation" -- an INDEPENDENT section of this family, blank (S1). */
  | { op: "add_section"; section: string; family: string }
  /** SLICE 12e-3a: the x of an independent section. An attached one has none: its item's toggle removes it. */
  | { op: "remove_section"; section: string; index: number };

/** PURE. Apply one panel operation. A changed or added item starts BLANK (S1): family only, no attrs, qty 1. */
export function applyItemEdit(state: ItemListEditState, op: ItemEditOp): ItemListEditState {
  const items = state.items.map((e) => ({ ...e, attrs: { ...e.attrs }, ...(e.other ? { other: [...e.other] } : {}) }));
  const at = (i: number) => items[i];
  // SLICE 12e-3a: the independent sections ride along untouched by every item operation
  const done = (list: ItemEdit[], sections: ItemListEditState["sections"] = state.sections): ItemListEditState =>
    ({ items: list, ...(sections ? { sections } : {}) });
  /** SLICE 12c-S (F15): add or remove a field from the block's "Other..." set, dropping the key when
   *  the set empties so a block that has never used one serialises exactly as it did before. */
  const setOther = (i: number, id: string, on: boolean) => {
    const cur = new Set(items[i].other ?? []);
    if (on) cur.add(id); else cur.delete(id);
    if (cur.size) items[i].other = [...cur];
    else delete items[i].other;
  };
  switch (op.op) {
    case "set_attr":
      if (!at(op.index)) return state;
      at(op.index).attrs[op.id] = op.value;
      if (op.other === false) setOther(op.index, op.id, false);
      if (op.dropSection !== undefined && at(op.index).sections) {
        const rest = { ...at(op.index).sections };
        delete rest[op.dropSection];
        if (Object.keys(rest).length) at(op.index).sections = rest; else delete at(op.index).sections;
      }
      return done(items);
    case "set_other":
      if (!at(op.index)) return state;
      setOther(op.index, op.id, op.on);
      // opening the box CLEARS the field, which is what picking "Other..." has always done
      if (op.on) at(op.index).attrs[op.id] = "";
      return done(items);
    case "undo_attr":
      if (!at(op.index)) return state;
      delete at(op.index).attrs[op.id];
      setOther(op.index, op.id, false);
      return done(items);
    case "set_qty":
      if (!at(op.index)) return state;
      at(op.index).qty = op.qty;
      return done(items);
    case "change_family":
      if (!at(op.index)) return state;
      items[op.index] = { base: null, family: op.family, attrs: {} };
      return done(items);
    case "set_family_other":
      if (!at(op.index)) return state;
      items[op.index] = { base: null, family: "", attrs: {}, other: [op.id] };
      return done(items);
    case "set_family_text":
      if (!at(op.index)) return state;
      items[op.index] = { base: null, family: op.text, attrs: {}, other: [op.id] };
      return done(items);
    case "add":
      items.push({ base: null, family: op.family, attrs: {} });
      return done(items);
    case "remove":
      if (!at(op.index)) return state;
      items.splice(op.index, 1);
      return done(items);
    case "section": {
      // the delegated category's OWN operation, applied to the one stored edit of that section
      const target = op.pipe !== null ? at(op.pipe)?.sections?.[op.section] : state.sections?.[op.section]?.[op.index];
      if (!target) return state;
      const next = applyItemEdit({ items: [target] }, { ...op.inner, index: 0 } as ItemEditOp).items[0];
      if (!next) return state;
      if (op.pipe !== null) {
        at(op.pipe).sections = { ...at(op.pipe).sections, [op.section]: next };
        return done(items);
      }
      const list = [...(state.sections?.[op.section] ?? [])];
      list[op.index] = next;
      return done(items, { ...state.sections, [op.section]: list });
    }
    case "add_section":
      return done(items, { ...state.sections, [op.section]: [...(state.sections?.[op.section] ?? []), { base: null, family: op.family, attrs: {} }] });
    case "remove_section": {
      const list = [...(state.sections?.[op.section] ?? [])];
      if (op.index < 0 || op.index >= list.length) return state;
      list.splice(op.index, 1);
      return done(items, { ...state.sections, [op.section]: list });
    }
  }
}

/**
 * SLICE 12e-3b (12e-3a review, U22): THE ROW-TOTAL BOX'S SENTENCE FOR A ROW THAT CANNOT PRICE YET. The verb
 * follows the COUNT of items that need a person ("1 of 1 item needs", "1 of 2 items need", "2 of 2 items
 * need"); the noun follows the number of lines. PURE; the one place the sentence is built.
 */
export function needPersonSentence(bad: number, lines: number): string {
  return `${bad} of ${lines} item${lines === 1 ? "" : "s"} ${bad === 1 && lines === 1 ? "needs" : "need"} a person before the row can price.`;
}

/** PURE. What the correction record carries for the items ON SCREEN at Use: one entry per block, its family,
 * whether the model identified it or the pricer added it, every field's value as shown, and the quantity. */
export function itemsOnScreen(view: ItemListView): Array<{ family: string | null; source: "model" | "user"; attributes: Record<string, string>; qty: string }> {
  const entry = (b: ItemBlockView) => ({
    family: b.family,
    source: b.source,
    attributes: Object.fromEntries(b.fields.map((f) => [f.id, f.value])),
    qty: b.qty,
  });
  // SLICE 12e-3a: every LINE on screen is recorded -- an item, then the sections under it, then the independent ones
  const sectionBlocks = (list: SectionBlockView[] | undefined) => (list ?? []).flatMap((sv) => sv.view.items.map(entry));
  return [
    ...view.items.flatMap((b) => [entry(b), ...sectionBlocks(b.sections)]),
    ...sectionBlocks(view.sections?.independent),
  ];
}

/** PURE. The row total per row unit: every priced block's figures summed per kind -- the same three the panel
 * shows per block, so the total can never be built from a fourth arithmetic. Only meaningful when the row
 * priced (S4); on a blank row the panel shows the reason instead. */
export function rowTotals(view: ItemListView): Partial<Record<RateKind, number>> {
  /**
   * CERT-FOUND DEFECT (2026-10-04) -- THIS RETURNED A WRONG PRICE ON A COMPOSED ROW.
   *
   * It summed `view.items`, which are the USER's blocks. A composition expands ONE user block into
   * several priced layers inside `priceItemList`, so after "32 mm -> 13 + 19" there is still one
   * block, holding the FIRST layer only -- and the green "Row total" read 219 where the row costs
   * 474. The headline, which reads the row's own `supply`/`install`, said 474 at the same time, so
   * the screen contradicted itself and the smaller number was the one labelled "Row total".
   *
   * ⚠️ IT SURVIVED BECAUSE THE TWO AGREE ON EVERY UNCOMPOSED ROW -- blocks and priced items are then
   * one-to-one, so the sum is right by coincidence of shape. Only a composition separates them, and
   * only the screen showed it.
   *
   * The row's totals now come from the row (`view.totals`, set from the same `priced.supply` /
   * `priced.install` the headline uses), so the two readings cannot diverge again. The block sum is
   * kept ONLY for a view with no totals -- an unpriced row, which the panel does not render this for.
   */
  if (view.totals) return { ...view.totals };
  const out: Partial<Record<RateKind, number>> = {};
  for (const b of view.items) {
    for (const [k, v] of Object.entries(b.figures)) if (typeof v === "number") out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

