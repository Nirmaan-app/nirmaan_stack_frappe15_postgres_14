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
  assemblyOnlyCtxKeys,
  catalogFitOutcomes,
  derivedAttrOutcomes,
  mapAttributeOutcomes,
  moduleFitOutcome,
  NONE_SENTINEL,
  noneRefusalOf,
  runPipeline,
} from "@/pages/pricing/rate-master/ratePipelineInterpreter";
import { labelAsWord, mirroredLead, plainFact, plainPricerText, TYPED_LEAD } from "@/pages/pricing/rate-master/plainEnglish";
// CP2: `coerceForMatch` moved to the shared rate-master module (the single point where an attribute
// value becomes a match key); this file imports it and no longer defines it.
import {
  blanksQtyAttr,
  blanksBindItemAttr,
  categoryItemKinds,
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
import { applyConductorFloor, conductorFloorGroups, CONDUCTOR_FLOOR_NOTE } from "./conductorFloor";
import { USED_INPUT_MARK, attributeWorkingLine, moneyValue, usedAssemblyInputs } from "./attributeWorkingLines";
// SLICE 6 (owner S1-S5, 2026-09-24): the item-list mode prices a LIST of items per row through the pure module;
// the helper only assembles the list (the model's items overlaid with the panel's session edits) and shapes the
// result for the panel. Every default, ladder and conversion stays in the module + config.
import {
  delegatedSections,
  familyAttr,
  familyChoices,
  familyDisplayName,
  plainItemListWording,
  plainWorking,
  familyUnitClasses,
  fieldOptionsFromSkus,
  inchWithMmEcho,
  isRateOnlyUnit,
  itemFieldDefs,
  itemListPricingSpec,
  familyUnitOf,
  kindIn,
  matchStatedToOption,
  matchStatedToOptionDetailed,
  pricingInputFactor,
  readCapacity,
  unitPickerUnits,
  UNIT_PICK_SUFFIX,
  plainFactOf,
  readLayers,
  readNumber,
  ruledDefaultValue,
  sizeIsOutsideDiameter,
  severalSizesTaken,
  listSpecDefs,
  applyFamilyMerge,
  countedPieces,
  isLotUnit,
  isPerSetUnit,
  priceItemList,
  sizeFieldHelp,
  splitRateOnlyUnit,
  twoWayValues,
  typedFieldNote,
  unitClassOf,
  cableSpecText,
  extraBandOf,
  pricingInputRates,
  readCableSpecWords,
  boqExtrasOf,
  sheetUnitCounts,
  workingStandbyWords,
  boqInclusionsOf,
  ownRowQuotes,
  readCableKindWords,
  readLengthRange,
  readLengthWords,
  readQtyWords,
  type ExtraIncludeId,
  type ExtraLineId,
  type ExtrasSpec,
  type CountedPieces,
  type CountedSpec,
  type ExtractedListItem,
  type AccessorySpec,
  type ItemFieldDef,
  type ItemListPricingSpec,
  type ItemPriceResult,
  type LadderHop,
  type CoverChoice,
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

/** VRF-5 (owner R1 SAFEGUARD, ANSWER 9): every run row's CATEGORY, kept beside the map (never on the row objects, so each
 * extraction row stays byte-identical) -- the own-row rule reads only rows of the asking row's discipline. */
const ROW_CATEGORIES = new WeakMap<ReadonlyMap<number, ExtractionRow>, ReadonlyMap<number, string>>();

/** Build the excel_row -> ExtractionRow map from a run's `results` payload. PURE. */
export function buildExtractionByRow(
  results: Array<{
    excel_row: number;
    description?: string;
    attributes: Record<string, { value: string | number | null; confidence: number; corroborated?: boolean }>;
    /** SLICE 6: an item-list row's stored items (slice 4's `results[i].items`); absent on every other row. */
    items?: ExtractedListItem[];
    /** VRF-4 (q2): the row's category, carried onto an item-list row only (a refnet counts the sheet's VRF units) */
    category_id?: string;
  }>,
): Map<number, ExtractionRow> {
  const m = new Map<number, ExtractionRow>();
  const cats = new Map<number, string>();
  for (const r of results ?? []) {
    if (typeof r.category_id === "string" && r.category_id) cats.set(r.excel_row, r.category_id);
    const row: ExtractionRowWithItems = { excelRow: r.excel_row, description: r.description, attributes: r.attributes };
    // carried ONLY when present, so a non-list row's map entry is byte-identical to before
    if (Array.isArray(r.items)) {
      row.items = r.items;
      if (typeof r.category_id === "string" && r.category_id) row.category = r.category_id;
    }
    m.set(r.excel_row, row);
  }
  ROW_CATEGORIES.set(m, cats);
  return m;
}

/** SLICE 6: an extraction row that may carry the run's ITEMS (an item-list category). The base type lives
 * outside this slice's scope, so the items ride as an optional extension read through this alias. */
export type ExtractionRowWithItems = ExtractionRow & { items?: ExtractedListItem[]; category?: string };

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
  /** SLICE 12e-6 (AC1, owner R7): set by the section pass -- the pipe above is Copper or its size is written as an
   * outside diameter / inch size (true), or it is another pipe (false). Absent on an Insulation row of its own, where
   * the row's own words decide. Read only by the cladding's girth. */
  pipeOdHint?: boolean;
  /** VRF-4 (q2): the sheet's outdoor / indoor unit counts, added up from the rows the model read (`sheetUnitCounts`), set by
   * `compute` on a BoQ row of a config whose refnets count from the sheet. Absent everywhere else. */
  sheetUnits?: ReturnType<typeof sheetUnitCounts>;
  /** VRF-6 (owner Q-pre 5): the make of this sheet's outdoor units (the first outdoor-unit row the run read whose make resolves),
   * set by `compute` on a BoQ row of a config declaring `extras.prepare.same_as_outdoor`. Absent everywhere else. */
  sheetOutdoorBrand?: { brand: string; row: number };
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
 * eligible; it shows "coming soon"). PURE.
 *
 * VRF-4 (owner Q1 A "removed at VRF-4"; D-10): VRF-2a's temporary `calculator_only` switch and its calculator-only
 * admission are REMOVED -- one predicate, every surface, as 12d-2 ruled. */
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

/**
 * ADP-3a (owner H1, U1; ADP-R3 R2 gap 3). PURE. The `catalog_fit` binds that fit FROM THEMSELVES (`fit_from.attr` is
 * the bind) -- the cable-tray width, the conduit size. `derivedAttrIds` counts every bind as derived, which is true of
 * one fitted from ANOTHER attribute (an industrial socket's paired MCB, from its amps) and false of these: with the
 * value blank the step has nothing to fit and the row fell through to "no match", the box never outlined. Read from
 * config; no category or attribute is named.
 */
export function selfFitBinds(config: RateCategoryConfig): Set<string> {
  const out = new Set<string>();
  for (const pl of Object.values(config.pipelines ?? {})) {
    for (const raw of pl.steps ?? []) {
      // ELR-4d (owner R-W6): a `hop_only` fit (the wiring conduit) moves a stated size that is not stocked and does nothing
      // else -- its bind has its own filler, so a blank one is not a needed input
      const st = raw as { step?: string; params?: { bind?: unknown; fit_from?: { attr?: unknown }; hop_only?: unknown } };
      if (st.step === "catalog_fit" && typeof st.params?.bind === "string" && st.params.fit_from?.attr === st.params.bind && st.params.hop_only !== true) out.add(st.params.bind);
    }
  }
  return out;
}

/**
 * ADP-3a (owner B6, 2026-10-20 13:32). PURE. The "No <label> rate row matches ..." facts, ONLY those the pipeline's
 * catalogue rows VARY on -- a fact every row shares (or none carries) cannot be why nothing matched. The rows are the
 * ones the pipeline's own steps name by `kind`; with none named, every stated fact is listed as before.
 */
export function varyingAttrLine(attrs: WorkingsAttribute[], items: RateMasterItem[], pl: Pipeline): string {
  // ELR-4d (owner R-W6): a `hop_only` fit's kind is not a row this pipeline matches on, so it adds no fact to the sentence
  const kinds = new Set((pl.steps ?? []).filter((s) => (s as { params?: { hop_only?: unknown } }).params?.hop_only !== true).map((s) => (s as { params?: { kind?: unknown } }).params?.kind).filter((k): k is string => typeof k === "string"));
  const rows = kinds.size ? items.filter((it) => kinds.has(it.kind)) : [];
  // a value every row shares WITH the answer is not the reason; one every row shares that the answer contradicts is
  const varies = (id: string, value: string): boolean => {
    if (!rows.length) return true;
    const vals = new Set(rows.filter((it) => id in (it.attributes ?? {})).map((it) => String(it.attributes[id])));
    return vals.size > 1 || (vals.size === 1 && !vals.has(value));
  };
  return attrs.filter((a) => a.value !== "" && varies(a.id, a.value)).map((a) => `${a.label} = ${a.value}`).join(", ");
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
  // ADP-3a (U6): AFTER the no-match notes, so a field the no-match producer speaks for is never re-explained
  return withLandedNotes(withNoMatchNotes(displayed, config, items, selected), config, results, selected);
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
/**
 * ADP-3a (owner standing rule, U6: "every attribute shows the value actually used with a note on how it landed
 * there"). PURE. THE `landed` NOTE: one line on a DERIVED field that no other note explains, saying how its value
 * landed, per mechanism -- read from config (the step's params) and the run's own outcome readers, never the trace:
 *   catalog_fit   "As the row states - a stocked size" / "The row states 140 - fitted to 150"
 *   map_attribute "16 SWG read as 1.6" (from its source) / "Not stated - the rule's default: PVC"
 *   derive        "Worked out: 15 + (3 - 1) x 5 = 25 m"
 *   module_fit    "As the row states" / "The smallest that holds the contents (4 modules)"
 * A field already carrying a note, showing nothing, or not derived is returned unchanged. Display only: the value,
 * the price and every other note are untouched.
 */
export function withLandedNotes(
  attrs: WorkingsAttribute[],
  config: RateCategoryConfig,
  results: PipelineResult[],
  selected?: Record<string, string | number>,
): WorkingsAttribute[] {
  if (!results.length) return attrs;
  const steps = Object.values(config.pipelines ?? {}).flatMap((p) => p.steps ?? []) as Array<{ step: string; params?: Record<string, unknown> }>;
  const labelOf = (id: string) => (config.attribute_definitions ?? []).find((d) => d.id === id)?.label ?? id;
  const fits = catalogFitOutcomes(results);
  const derives = derivedAttrOutcomes(results);
  const maps = mapAttributeOutcomes(results);
  const fit = moduleFitOutcome(results);
  const ladders = new Map((fit?.ladders ?? []).map((l) => [l.bind, l]));
  const shownOf = (a: WorkingsAttribute) => attrDisplayValue(a);
  return attrs.map((a) => {
    if (!a.derived || (a.notes && a.notes.length) || a.disabled) return a;
    const shown = shownOf(a);
    if (shown === "" || shown === NONE_SENTINEL) return a;
    let how: string | undefined;
    const cf = fits.get(a.id);
    const dv = derives.get(a.id);
    const mp = maps.get(a.id);
    const ld = ladders.get(a.id);
    if (cf) {
      if (cf.stated !== undefined) {
        how = cf.fitted !== null && String(cf.fitted) !== String(cf.stated)
          ? `The row states ${cf.stated} - fitted to ${cf.fitted}`
          : "As the row states - a stocked size";
      } else if (cf.fitted !== null) {
        // a requested size the catalogue stocks was not fitted at all ("Fitted to 25 from 25" said otherwise)
        const same = cf.requested !== null && (String(cf.requested) === String(cf.fitted)
          || (String(cf.requested).trim() !== "" && Number.isFinite(Number(cf.requested)) && Number(cf.requested) === Number(cf.fitted)));
        how = same ? "As given - a stocked size" : cf.requested !== null ? `Fitted to ${cf.fitted} from ${cf.requested}` : `Fitted to ${cf.fitted}`;
      }
    } else if (dv && dv.value !== null) {
      const st = steps.find((x) => x.step === "derive_attribute" && x.params?.result_attr === a.id);
      const formula = typeof st?.params?.formula === "string" ? st.params.formula : undefined;
      // ELR-3a (owner Q1 a): a constant read from a Pricing Input is substituted with the value pricing USED, carried
      // on the outcome -- the config holds a ctx key there, which would put "base" / "per_extra" on screen
      const consts = (dv.constants ?? st?.params?.constants ?? {}) as Record<string, unknown>;
      const terms = (Array.isArray(st?.params?.terms) ? st!.params!.terms : []) as Array<{ ident?: string; attr?: string }>;
      if (formula) {
        let text = formula;
        for (const [k, v] of Object.entries(consts)) text = text.replace(new RegExp(`\\b${k}\\b`, "g"), String(v));
        for (const t of terms) {
          const v = t.attr && selected ? selected[t.attr] : undefined;
          if (t.ident && v !== undefined) text = text.replace(new RegExp(`\\b${t.ident}\\b`, "g"), String(v));
        }
        how = `Worked out: ${text.replace(/\*/g, "x")} = ${dv.value}${dv.unit ? ` ${dv.unit}` : ""}`;
      } else {
        how = `Worked out by the rule: ${dv.value}${dv.unit ? ` ${dv.unit}` : ""}`;
      }
    } else if (mp) {
      if (mp.stated) {
        how = "As the row states";
      } else {
        const st = steps.find((x) => x.step === "map_attribute" && x.params?.result_attr === a.id);
        const from = typeof st?.params?.from_attr === "string" ? st.params.from_attr : undefined;
        // ELR-3a (owner Q1 a): a table read from Pricing Inputs (`table_from_ctx`) has the same KEYS -- only the keys
        // are tested here; the value shown is the outcome's, the number pricing used
        const tableSrc = st?.params?.table ?? st?.params?.table_from_ctx;
        const table = tableSrc && typeof tableSrc === "object" ? tableSrc as Record<string, unknown> : undefined;
        const src = from && selected ? selected[from] : undefined;
        how = src !== undefined && src !== null && src !== "" && src !== NONE_SENTINEL && table && Object.prototype.hasOwnProperty.call(table, String(src))
          ? `${labelOf(from!)} ${String(src)} read as ${String(mp.value)}`
          : `Not stated - the rule's default: ${String(mp.value)}`;
      }
    } else if (ld && ld.label) {
      how = ld.pick && !ld.pick.raised && ld.pick.label === ld.label
        ? "As the row states"
        : fit && typeof fit.occupied === "number"
          ? `The smallest that holds the contents (${fit.occupied} module${fit.occupied === 1 ? "" : "s"})`
          : undefined;
    }
    return how ? { ...a, notes: [{ kind: "landed" as const, how }] } : a;
  });
}

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
      // ADP-3a (U4): the sentence names the VISIBLE field it sits on, never the hidden gauge it was converted from
      return { ...a, notes: [{ kind: "no_match", stated: `${String(src)} SWG`, field: a.label, stocked: range }] };
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
/**
 * ELR-4a (owner R-PW-BLANK, 2026-10-29: "remove it and in its place goive a note explaining how blank count is
 * arrived"; text N1 approved at P6) -- PURE. The note that says how the blank count is worked out, for a category
 * whose `module_fit` `blanks` block shows its blanker on NO field (no `display_attr`: point wiring's v70 hides its
 * "Blank plate" with `panel: false`). It is drawn where that field was, so on the field before the blanks' own
 * quantity. Written FROM THE CONFIG -- the terms' items and weights, the blanker's name, the quantity's label -- and
 * null for a block that displays its blanker (switches & sockets, pop-up boxes keep "Blank plate", owner "4 let it be").
 */
export function blanksWorkedOutNote(config: RateCategoryConfig): { attr: string; text: string } | null {
  const defs = config.attribute_definitions ?? [];
  const label = (id: unknown): string => defs.find((d) => d.id === id)?.label ?? String(id ?? "");
  for (const [pid, pl] of Object.entries(config.pipelines ?? {})) {
    if (/bcs/i.test(pid)) continue;
    for (const raw of pl.steps ?? []) {
      const s = raw as { step?: string; params?: { terms?: Array<{ weight?: number; none_when?: string }>; blanks?: Record<string, unknown> } };
      const b = s.params?.blanks;
      if (s.step !== "module_fit" || !b || b.display_attr || typeof b.qty_attr !== "string" || typeof b.item_when_positive !== "string") continue;
      const terms = (s.params?.terms ?? []).map((t) => ({ what: label(t.none_when).toLowerCase(), weight: Number(t.weight) }));
      if (!terms.length) continue;
      const plural = (w: string) => (/(ch|sh|s|x)$/.test(w) ? `${w}es` : `${w}s`);
      const users = [...terms].reverse().map((t) => plural(t.what));
      const users2 = users.length > 1 ? `${users.slice(0, -1).join(", ")} and ${users[users.length - 1]}` : users[0];
      const weights = terms.map((t, i) => (i === 0 ? `a ${t.what} takes ${t.weight}` : `a ${t.what} ${t.weight}`)).join(", ");
      return {
        attr: b.qty_attr,
        text: `Blank plates are worked out, not chosen: the plate's modules less the modules its ${users2} use (${weights}). ` +
          `Each spare module gets a '${b.item_when_positive}'. '${label(b.qty_attr)}' can lower that count but never raise it above the spare.`,
      };
    }
  }
  return null;
}

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

/**
 * ELR-3b (owner R-8; R-V1 2026-10-27 "2 v1"; R-V1b / R-V1c 2026-10-29). PURE. THE PLATE-QUANTITY DEFAULT -- the mirror of
 * the server's `extraction.fill_paired_slot_defaults` case (b) (with `paired_fill_plan`), which fills NEW reads only
 * (since 226509192). A stored row read before that kept a blank plate quantity and refused "Missing to price: Plate qty";
 * this gives the panel and the calculator the SAME answer the server gives, through this one function.
 *
 * THE RULE, exactly the server's:
 *   - the item is COMPUTED: a `requires_named` target of an `extraction_defaults` spec with a `default` that is a
 *     `module_fit` ladder `bind` (the face plate) -- read from the config, never from a category or attribute name;
 *   - its quantity is BLANK and the item is BLANK (not named, not "None");
 *   - the row is OCCUPIED: some occupancy term of the first `module_fit` step (the terms `module_fit` itself sums) whose
 *     `none_when` item is filled (a real value, not "None", not blank) carries a quantity above zero.
 * -> the quantity takes the declared default. NOT an empty box (every switch / socket None or blank: owner R-V1, V2 was
 * not ruled), NOT a named plate (U7's, calculator only, unchanged), NOT a "None" plate, NEVER over a stated quantity.
 *
 * `valueOf` is the row's value as the pricer sees it (an override, else the stored cell, else a never-asked default),
 * coerced; null = blank. Returns attribute id -> default value.
 */
export function computedPlateQtyDefaults(
  config: RateCategoryConfig,
  valueOf: (id: string) => string | number | null,
): Map<string, string | number> {
  const out = new Map<string, string | number>();
  const defaults = readExtractionDefaults(config);
  const pairs: Array<[string, string, string | number]> = [];
  for (const [aid, spec] of Object.entries(defaults)) {
    if (spec === null || typeof spec !== "object") continue;
    const s = spec as { default?: unknown; requires_named?: unknown };
    if (typeof s.requires_named !== "string" || !("default" in s)) continue;
    if (typeof s.default === "string" || typeof s.default === "number") pairs.push([aid, s.requires_named, s.default]);
  }
  if (!pairs.length) return out;
  const named = new Set(pairs.map(([, item]) => item));
  const computed = new Set<string>();
  let terms: Array<{ attr: string; none_when?: unknown }> = [];
  for (const pl of Object.values(config.pipelines ?? {})) {
    for (const raw of pl.steps ?? []) {
      const s = raw as { step?: string; params?: { ladders?: unknown; terms?: unknown } };
      if (s.step !== "module_fit") continue;
      for (const l of Array.isArray(s.params?.ladders) ? s.params!.ladders as Array<{ bind?: unknown }> : []) {
        if (typeof l?.bind === "string" && named.has(l.bind)) computed.add(l.bind);
      }
      if (!terms.length && Array.isArray(s.params?.terms)) {
        terms = (s.params!.terms as Array<{ attr?: unknown; none_when?: unknown }>)
          .filter((t): t is { attr: string; none_when?: unknown } => typeof t?.attr === "string" && t.attr !== "");
      }
    }
  }
  if (!computed.size) return out;
  const filled = (id: string) => {
    const v = valueOf(id);
    return v !== null && v !== "" && v !== NONE_SENTINEL;
  };
  const occupied = terms.some(
    (t) => (typeof t.none_when !== "string" || t.none_when === "" || filled(t.none_when)) && Number(valueOf(t.attr) ?? 0) > 0,
  );
  if (!occupied) return out;
  for (const [aid, item, dflt] of pairs) {
    if (!computed.has(item)) continue;
    const q = valueOf(aid);
    const it = valueOf(item);
    if ((q === null || q === "") && (it === null || it === "")) out.set(aid, dflt);
  }
  return out;
}

/**
 * ELR-1 (owner R-UNIT: 12c-U carried to the attribute path; Q1 ruling 2026-10-27, "a"). PURE. The note a PRICED
 * attribute-path row shows when the BoQ row stated NO unit, or a rate-only one (`isRateOnlyUnit` / a rate-only marker
 * before a unit, `splitRateOnlyUnit` -- the item-list path's own predicates): the 12c-U lead, then the unit the
 * figure is a rate in.
 *
 * WHICH UNIT, read from the config and the priced result, never a category name:
 *   - a primary pipeline that BUILDS the rate from two or more components of the category's own item kinds is an
 *     ASSEMBLY (a DB build-up, a switch-socket plate, a pop-up box) -> "priced as one <category> item";
 *   - else the catalogue row it MATCHED (`match_master_row`) -> "priced per <its unit>";
 *   - else ONE own-kind component whose catalogue rows share one unit (an industrial socket and its paired MCB) ->
 *     that unit;
 *   - else (no own item kind at all: point wiring prices from other categories' rows) -> an assembly.
 * The verb is "priced" because only a priced row is noted: a refusing row stays exactly as it was (AC3).
 * `rowUnit` undefined is the calculator (no row) -> nothing.
 */
export function attributeUnitNote(
  config: RateCategoryConfig,
  items: readonly RateMasterItem[],
  rowUnit: string | null | undefined,
  primaryId: string,
  primary: PipelineResult | undefined,
): string | undefined {
  if (rowUnit === undefined) return undefined;
  const unit = String(rowUnit ?? "").trim();
  let lead: string;
  if (unit === "") lead = "No unit on the BoQ row";
  else if (isRateOnlyUnit(unit) || splitRateOnlyUnit(unit) !== null) lead = `BoQ says ${unit} (rate only)`;
  else return undefined;
  const own = new Set(categoryItemKinds(config));
  const steps = (config.pipelines?.[primaryId]?.steps ?? []) as Array<{ step?: string; ref?: { kind?: unknown } }>;
  const ownRefs = steps.filter((s) => s.step === "component_ref" && typeof s.ref?.kind === "string" && own.has(s.ref.kind));
  let word: string | undefined;
  if (ownRefs.length < 2) {
    const matched = primary?.matchedItem?.unit;
    if (typeof matched === "string" && matched.trim() !== "") word = matched.trim();
    else if (ownRefs.length === 1) {
      const units = new Set(items.filter((it) => it.kind === ownRefs[0].ref!.kind).map((it) => String(it.unit ?? "").trim()));
      if (units.size === 1) {
        const [only] = units;
        if (only !== "") word = only;
      }
    }
  }
  return word !== undefined
    ? `${lead} -> priced per ${word}, the catalogue's unit for this item`
    : `${lead} -> priced as one ${categoryLabel(config)} item`;
}

/** ELR-4c (owner "Q4 a", 2026-10-30): an attribute-path field as the helper hands it to the panel. `eitherWords` is set on a
 *  NEEDED field that a field hidden from the panel can also fill (a tray thickness the BoQ gives as a gauge); the BoQ panel
 *  shows it beside the "*", the calculator -- where there is no other way to give it -- keeps the plain "*". */
export type ShownAttribute = WorkingsAttribute & { eitherWords?: string };

/** "Thickness (mm)" -> "this, or a thickness the BoQ gives another way" -- the field's own label, its unit dropped; the
 *  hidden field is never named (owner R-SWG). */
export function eitherWordsFor(label: string): string {
  return `this, or a ${label.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase()} the BoQ gives another way`;
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
    // VRF-4 (Q1 A): VRF-2a's calculator-surface admission is removed -- the same predicate on every surface.
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
      // VRF-3b: an extra cable line is priced by ELECTRICAL's own rules -- this same compute, on that category, read only
      const cableRate: CableRate = (cableCategory, attrs, unit) => {
        const r = compute({ excelRow: EXTRA_CABLE_ROW, description: "", nodeType: "", category: cableCategory, discipline: "Electrical",
                            rateKinds: ctx.rateKinds, unit: unit ?? "Mtr" } as RowContextWithUnit, attrs);
        if (r.kind === "suggestion" && typeof r.values.supply_rate === "number" && typeof r.values.install_rate === "number") {
          return { supply: r.values.supply_rate, install: r.values.install_rate };
        }
        return { reason: r.kind === "none" ? r.reason : (r.basis || "no cable rate row matches") };
      };
      // VRF-4 (q2): a refnet on a Set row of a BoQ sheet counts the sheet's outdoor / indoor units from the rows the model read
      const fromSheet = listSpec.per_set?.counted?.from_sheet;
      const rowCtx = ctx as RowContextWithUnit;
      const onSheet = fromSheet && rowCtx.rowQuantities && typeof rowCtx.unit === "string" && rowCtx.noRow !== true && isPerSetUnit(listSpec, rowCtx.unit)
        ? { ...rowCtx, sheetUnits: sheetUnitCounts(fromSheet, [...extractionByRow.values()] as ExtractionRowWithItems[], ctx.excelRow, ctx.category,
                                                    rowCtx.rowQuantities, familyAttr(listSpec)) }
        : rowCtx;
      // VRF-5 (owner R1 SAFEGUARD): the sheet's quoting rows carry each row's model item 1 family, from the run this helper serves
      // VRF-5 (owner ANSWER 9 "lets restrict on same sheet"; 18:50 "checks only rows which carry categories from the same
      // discipline viz HVAC"): ONLY this sheet's rows whose category (the run's) belongs to the row's own discipline
      const rowCats = ROW_CATEGORIES.get(extractionByRow);
      const sameDiscipline = (row: number) => {
        const cat = rowCats?.get(row);
        const c = cat ? (configsByCategory?.get(cat) ?? (config && config.category_id === cat ? config : null)) : null;
        return !!c && c.discipline === category.discipline;
      };
      // VRF-6 (F4, owner Q-pre 10): category first -- the sheet's rows also carry their category; an uncategorised line item is
      // kept (it counts by words only) and a rate-editable Preamble the run read is kept (00234 r55); every other row as before
      const catFirst = listSpec.extras?.safeguard?.match === "category";
      const keepLine = (l: { row: number; sheet?: string; preamble?: boolean }) => {
        if (l.sheet !== undefined) return false;
        if (!catFirst) return !l.preamble && sameDiscipline(l.row);
        const cat = rowCats?.get(l.row);
        if (l.preamble) return !!cat && sameDiscipline(l.row);
        return !cat || sameDiscipline(l.row);
      };
      const scopeQ = listSpec.extras?.from_model?.scope;
      const withLines = listSpec.extras?.safeguard && onSheet.sheetLines
        ? { ...onSheet, sheetLines: onSheet.sheetLines.filter(keepLine).map((l) => {
            const it0 = (extractionByRow.get(l.row) as ExtractionRowWithItems | undefined)?.items?.[0];
            const v = it0?.attributes?.[familyAttr(listSpec)]?.value;
            const base = l.family1 !== undefined ? l : { ...l, family1: typeof v === "string" && v !== "" ? v : null };
            if (!catFirst) return base;
            const sc = scopeQ ? it0?.attributes?.[scopeQ]?.value : undefined;
            return { ...base, category: rowCats?.get(l.row) ?? null, ...(typeof sc === "string" && sc.trim() !== "" ? { scope1: sc.trim() } : {}) };
          }) }
        : onSheet;
      // VRF-6 (owner Q-pre 5): "make same as outdoor" -> the make of this sheet's outdoor units (the first such row whose stated
      // make(s) resolve: Blue Star if listed, else the first make the catalogue stocks for the outdoor family)
      const so = listSpec.extras?.prepare?.same_as_outdoor;
      const withOdu = so && !rowCtx.noRow ? (() => {
        const famAt = familyAttr(listSpec);
        const stockedFor = new Map<string, string>();
        for (const it of items) {
          if (!kindIn(listSpec, it.kind) || it.attributes?.[famAt] !== so.outdoor_family) continue;
          const b = String(it.attributes?.brand ?? it.brand ?? "").trim();
          if (b) stockedFor.set(b.toLowerCase().replace(/\s+/g, ""), b);
        }
        const rows = [...extractionByRow.keys()].sort((a, b) => a - b);
        for (const r of rows) {
          const it0 = (extractionByRow.get(r) as ExtractionRowWithItems | undefined)?.items?.[0];
          if (it0?.attributes?.[famAt]?.value !== so.outdoor_family) continue;
          const words = String(it0?.attributes?.[so.attr]?.value ?? "");
          const makes = words.split(/[,/&+]|\band\b|\bor\b/i).map((m) => m.trim().toLowerCase().replace(/\s+/g, "")).filter((m) => m && m !== "none");
          if (!makes.length) continue;
          const bs = makes.find((m) => m === "bluestar");
          const hit = bs ? stockedFor.get("bluestar") : makes.map((m) => stockedFor.get(m)).find((b) => !!b);
          if (hit) return { ...withLines, sheetOutdoorBrand: { brand: hit, row: r } };
        }
        return withLines;
      })() : withLines;
      return computeItemList(category, listSpec, items, withOdu, ext as ExtractionRowWithItems | undefined, inRun, overrides, configOf, cableRate);
    }
    const defs = selectableDefs(category);
    // The attributes THIS config computes rather than accepts -- a blank one is not missing input.
    // (Hoisted above the never-asked pass, which must not seed a derived attribute.)
    const derived = derivedAttrIds(category);
    // ADP-3a (owner H1, U1; R2 gap 3): a `catalog_fit` that fits a bind FROM ITSELF (the tray width, the conduit size)
    // computes nothing when that value is blank -- it is a needed input then, asked for and outlined, not derived
    const selfFit = selfFitBinds(category);

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
    /**
     * ADP-3a (owner U7: "plate quantity takes the same default the extraction uses, shown as a default"): ON THE
     * CALCULATOR (no extraction) the quantity of an item the pipeline COMPUTES (the face plate -- a `module_fit` bind;
     * no other `requires_named` item is computed) takes its `extraction_defaults` value exactly as the extraction gives
     * it -- once the item IS named (picked), never before (`requires_named`, unchanged). Shown as a default (amber),
     * overridable. Scoped to the plate, as ruled: a switch or socket quantity is untouched. A BoQ row is untouched.
     */
    if (!ext) {
      const defaults = readExtractionDefaults(category);
      for (const d of defs) {
        const spec = defaults[d.id] as { default?: unknown; requires_named?: unknown } | undefined;
        if (!spec || typeof spec !== "object" || typeof spec.requires_named !== "string" || !derived.has(spec.requires_named)) continue;
        const named = overrides?.[spec.requires_named];
        if (named === undefined || named === "" || named === NONE_SENTINEL) continue;
        if (overrides?.[d.id] !== undefined) continue;
        const v = spec.default;
        if (typeof v === "string" || typeof v === "number") neverAsked.set(d.id, { value: v, confidence: 0, defaulted: true });
      }
      /**
       * ADP-3a (owner U7): a controller's `absent_when_value` ("circuit wiring included = No") makes each BLANK
       * `absent_dependents` field the "None" sentinel -- exactly `force_absent_dependents`, which the server applies
       * to a run's answers at extraction: blanks only, a stated value never overwritten. A stored row already
       * carries it; the calculator now does too, so the circuit-wire fields stop asking for what the row says is
       * not there.
       */
      for (const d of defs) {
        const ad = d as { absent_when_value?: unknown; absent_dependents?: unknown };
        if (typeof ad.absent_when_value !== "string" || !Array.isArray(ad.absent_dependents)) continue;
        if (String(overrides?.[d.id] ?? "") !== ad.absent_when_value) continue;
        for (const t of ad.absent_dependents) {
          if (typeof t !== "string") continue;
          const typed = overrides?.[t];
          if (typed !== undefined && typed !== "") continue; // STATED -- never overwritten
          neverAsked.set(t, { value: NONE_SENTINEL, confidence: 0 });
        }
      }
    }
    /**
     * ELR-3b (owner R-V1 / R-V1b): the plate-quantity default, on the panel AND the calculator through the one function
     * (`computedPlateQtyDefaults`, the server's case (b)). It replaces a stored BLANK cell (the never-asked map above
     * cannot: it fills only a key the stored row lacks) and is marked `defaulted`, so the field shows the existing
     * "default" badge and the existing "(defaulted -- ...)" line. A quantity the pricer typed (any override) is theirs:
     * no fill -- the gate reads the override first anyway. R-V1c: no confidence is shown for it (a rule, not a reading).
     */
    const plateQtyDefault = new Map<string, ExtractedAttr>();
    {
      const valueOfAny = (id: string): string | number | null => {
        const dd = defs.find((x) => x.id === id);
        if (!dd) return null;
        const ov = overrides?.[id];
        const raw = ov !== undefined ? ov : (ext?.attributes[id] ?? neverAsked.get(id))?.value ?? null;
        return coerceForMatch(dd, raw as string | number | null);
      };
      for (const [id, v] of computedPlateQtyDefaults(category, valueOfAny)) {
        if (overrides?.[id] !== undefined) continue;
        plateQtyDefault.set(id, { value: v, confidence: 0, defaulted: true });
      }
    }
    /** The stored cell for a def, or the never-asked synthesized one (or the ELR-3b plate-quantity default). */
    const cellOf = (d: AttributeDefinition): ExtractedAttr | undefined =>
      plateQtyDefault.get(d.id) ?? ext?.attributes[d.id] ?? neverAsked.get(d.id);
    // ELR-4d (owner R-3C-CALC): the conductor floor over the effective values, on the panel and the calculator alike. A raised
    // value wins over a typed one (a value stating three or more is never raised); nothing is written to the row.
    const floorRaised = applyConductorFloor((id) => {
      const dd = defs.find((x) => x.id === id);
      if (!dd) return null;
      const ov = overrides?.[id];
      return coerceForMatch(dd, (ov !== undefined ? ov : cellOf(dd)?.value ?? null) as string | number | null);
    }, conductorFloorGroups(category));

    // EA-4a-r: which defs are DISABLED because an allow_none controller is set to "None" (positive
    // absence) -- e.g. plate_item="None" disables plate_qty AND back_box. A controller can disable a def
    // that appears BEFORE it in the list (wire2_thickness_sqmm controls wire2_core), so resolve in a
    // pre-pass. A disabled target is greyed + cleared and is NOT treated as an unknown (never blocks).
    const valueOfDef = (d: AttributeDefinition): string | number | null => {
      const up = floorRaised.get(d.id);
      if (up !== undefined) return up;
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
    const workingsAttrs: ShownAttribute[] = [];
    const blanksNote = blanksWorkedOutNote(category);
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
    // ELR-4c (TS-15, owner "Q5 a"): an unfillable target whose source is a field ON SCREEN, blank and its own to fill -- the
    // source carries the "*", so the target does not ("Circuit wiring stretch" while "Circuit wiring included" is blank).
    // Display only: the gate below still reads `unfillableDerived`, so no refusal changes.
    const blankShownSource = new Set<string>();
    // ELR-4c (owner R-SWG / "Q4 a"): a target a HIDDEN field can also fill (tray thickness from the BoQ's gauge) -- its "*"
    // says "this, or ... another way", never naming the hidden field
    const hiddenSourced = new Set<string>();
    for (const [resultAttr, src] of mapAttributeSources(category)) {
      const fromDef = src.fromAttr ? defs.find((d) => d.id === src.fromAttr) : undefined;
      if (fromDef?.panel === false) hiddenSourced.add(resultAttr);
      if (src.hasDefault) continue; // the curve-else-C shape: always fillable, never narrowed
      // A SECOND FILLER: `derive_attribute` can compute this target whatever the map's source says.
      if (deriveTargets.has(resultAttr)) continue;
      const srcDef = fromDef;
      // A source we cannot resolve is NOT evidence of absence -- leave the exemption alone rather
      // than narrow on a guess. Only a source we can read AND find empty narrows it.
      if (!srcDef) continue;
      const v = valueOfDef(srcDef);
      if (v === null || v === NONE_SENTINEL) unfillableDerived.add(resultAttr);
      if (v === null && srcDef.panel !== false && !derived.has(srcDef.id)) blankShownSource.add(resultAttr);
    }
    for (const id of selfFit) {
      const sd = defs.find((d) => d.id === id);
      if (sd && valueOfDef(sd) === null) unfillableDerived.add(id);
    }
    const fillableDerived =
      unfillableDerived.size === 0
        ? derived
        : new Set([...derived].filter((id) => !unfillableDerived.has(id)));
    // ADP-3b (owner 2026-10-20 21:57, fix (3)): a field its controller has declared ABSENT ("circuit wiring included =
    // No" -> the circuit-wire fields) is not needed to price -- it carries no "*", on the panel and the calculator
    // alike. Display only: the gate above and below is unchanged ("None" is an answer, and it prices).
    const absentNow = new Set<string>();
    for (const d of defs) {
      const ad = d as { absent_when_value?: unknown; absent_dependents?: unknown };
      if (typeof ad.absent_when_value !== "string" || !Array.isArray(ad.absent_dependents)) continue;
      if (String(valueOfDef(d) ?? "") !== ad.absent_when_value) continue;
      for (const t of ad.absent_dependents) if (typeof t === "string") absentNow.add(t);
    }
    let missing = false;
    // ADP-3a (U3): every missing field, by its label, so the refusal names them all
    const missingLabels: string[] = [];
    for (const d of defs) {
      const cell = cellOf(d);
      const wasNeverAsked = neverAsked.has(d.id);
      const overridden = overrides?.[d.id];
      const disabled = disabledByNone.has(d.id);
      const raised = disabled ? undefined : floorRaised.get(d.id);
      const rawValue = disabled ? null : raised !== undefined ? raised : overridden !== undefined ? overridden : cell?.value ?? null;
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
        // ELR-4d (owner R-TS15, "1 ... ok"): the gate is unchanged; the sentence names the blank source on screen, not its target
        if (!disabled && !fillableDerived.has(d.id) && d.panel !== false) { missing = true; if (!blankShownSource.has(d.id)) missingLabels.push(d.label); }
      }
      else selected[d.id] = coerced;
      // A defaulted attribute is one the model filled from the config default (no positive text
      // identification); the pricer should see WHICH values came from a default, not read (EA-4a). An
      // override (the pricer typed it) clears the defaulted mark.
      // U2: `defaulted` is now DECLARED on ExtractedAttr, so the undeclared cast is gone. The SAME
      // condition drives both surfaces -- the prose trace line below AND the per-attribute flag the
      // panel tints -- so the two can never disagree about which values came from a default.
      const isDefaulted =
        !disabled && raised === undefined && overridden === undefined && coerced !== null && cell?.defaulted === true;
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
      const needed = !disabled && !absentNow.has(d.id) && (!derived.has(d.id) || selfFit.has(d.id) || (unfillableDerived.has(d.id) && !blankShownSource.has(d.id)));
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
        // ELR-3b (owner R-V1c): nor has the plate-quantity default
        // ELR-4d: nor has a value the conductor floor raised
        confidence: disabled || raised !== undefined || ((wasNeverAsked || plateQtyDefault.has(d.id)) && overridden === undefined) ? undefined : cell?.confidence,
        corroborated: disabled ? undefined : cell?.corroborated,
        disabled: disabled || undefined,
        allowNone: d.allow_none || undefined,
        // ADP-3a (owner H1, U1): NEEDED TO PRICE -- the gate's own condition (a blank one withholds the price), plus a
        // self-fit bind (needed whenever it is blank). The marker can never disagree with the gate.
        // ELR-4c (TS-15): BEFORE `unfillableDerived.has(d.id)` alone -- a target whose blank source is on screen is not starred
        ...(needed ? { required: true } : {}),
        ...(needed && hiddenSourced.has(d.id) ? { eitherWords: eitherWordsFor(d.label) } : {}),
        defaulted: isDefaulted || undefined,
        ...(ratingUp ? { notes: [ratingUp] } : {}),
        // ELR-4d (owner R-3C-CALC): the raised field shows "(computed)" with the note
        ...(raised !== undefined ? { derivedValue: String(raised), substituted: true, notes: [{ kind: "landed" as const, how: CONDUCTOR_FLOOR_NOTE }] } : {}),
        // ELR-1 (owner R-NOTES-RULE, AC2): the definition's own note, as the item-list path shows its typed note
        ...(typeof d.note === "string" && d.note.trim() !== "" ? { typedNote: d.note } : {}),
        // ELR-4a (owner R-PW-BLANK): how the blank count is worked out, drawn before this field (`blanksWorkedOutNote`)
        ...(blanksNote && d.id === blanksNote.attr ? { leadNote: blanksNote.text } : {}),
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
            // ADP-3a (U3): the refusal NAMES every missing field (it named none)
            inRun
              ? `Missing to price: ${missingLabels.join(", ")} -- fill them to compute a rate.`
              : `Fill to price: ${missingLabels.join(", ")}.`,
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
    // ELR-4d (owner R-DB-MANUAL): a pipeline's declared whole-row refusal, said once
    let wholeRowRefusal: string | undefined;
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
          derivation.push(`${outputWord(o)} = ${moneyValue(res.finals[o])}`);   // ELR-4c (R-FLOAT): money to 2 decimals
          // EA-4a: a category may split supply + install across SEPARATE pipelines (point_wiring's
          // pw_boq_supply / pw_boq_install, cabletray). Take each rate-kind from the FIRST pipeline
          // that produces it -- a single combined pipeline (conduit) still fills both from its one pass.
          const kind = kindForOutput(o);
          if (kind && values[kind] === undefined) values[kind] = res.finals[o];
        }
        // EA-4a: the assembly categories expose their per-component build-up as the step traces; surface
        // each component line (name = value) in the group so the pricer sees the bill, not just the total.
        // ELR-2 (owner R-WORD / R-MISC, D1-D8): in plain English -- the Pricing Input's own name, the bound field's label
        // ELR-3a (owner Q2 a): a Pricing Input read ONLY by an assembly step (a length, a conduit fill) moves no SKU's
        // own rate and adds no line -- the bill reads exactly as it did while those numbers were literals
        const assemblyOnly = assemblyOnlyCtxKeys(pl as Pipeline);
        // ELR-4c (owner R-ELR2 (c), "one line per input used"; P6 "Q1 b"): such an input DOES get a line on a row whose
        // pipeline used it -- "<name> = <value> <unit> (Pricing Input)" -- and none on a row that did not
        const usedInputs = usedAssemblyInputs(pl as Pipeline, res.steps, selected);
        for (const st of res.steps) {
          if (st.step === "rate_ref" && st.produced && assemblyOnly.has(st.produced.key)) {
            if (usedInputs.has(st.produced.key)) matchedRows.push(`${attributeWorkingLine(st, pl as Pipeline, category, items, (a) => selected[a])} ${USED_INPUT_MARK}`);
            continue;
          }
          if (st.produced && st.refItem) matchedRows.push(attributeWorkingLine(st, pl as Pipeline, category, items, (a) => selected[a]));
        }
        flatMatched.push(`Matched ${label} for ${attrLine}.`);
      } else if (noneRefusalOf(res)) {
        if (!wholeRowRefusal) derivation.push(noneRefusalOf(res)!);
        wholeRowRefusal ??= noneRefusalOf(res);
      } else if (res.status === "no_match") {
        // ADP-3a (B6 #4): only the facts this pipeline's catalogue rows vary on
        const facts = varyingAttrLine(workingsAttrs, items, pl as Pipeline);
        derivation.push(facts ? `No ${label} rate row matches ${facts}.` : `No ${label} rate row matches these answers.`);
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
      const combinedLine = `Combined = supply + install = ${moneyValue(values.combined_rate)}`;
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

    // ELR-1 (R-UNIT, AC3): a priced row that stated no unit, or a rate-only one, says what the rate is per
    const unitNote = Object.keys(values).length
      ? attributeUnitNote(category, items, (ctx as RowContextWithUnit).unit, surfaced[0][0], pipelineResults[0])
      : undefined;
    return {
      kind: "suggestion",
      values,
      producibleKinds: PRODUCIBLE_KINDS,
      // Calculator slice 1: the category's LABEL ("Switches and Sockets"), not its id ("switches_sockets").
      basis: Object.keys(values).length
        ? `Rate master: ${categoryLabel(category)} @ ${attrLine}`
        : wholeRowRefusal ?? "no match for these attributes",
      workings: {
        attributes: applyDerivedDisplay(workingsAttrs, category, pipelineResults, fillableDerived, items, selected),
        matchedRows: flatMatched,
        derivation: flatDerivation,
        finalValues: { ...values },
        sections,
        ...(unitNote ? { unitNote } : {}),
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
      derivation.push(`${outputWord(o)} = ${moneyValue(result.finals[o])}`);
    }
    if (typeof values.supply_rate === "number" && typeof values.install_rate === "number") {
      values.combined_rate = values.supply_rate + values.install_rate;
      derivation.push(`Combined = supply + install = ${moneyValue(values.combined_rate)}`);
    }
    matchedRows.push(`Matched ${termination ? "termination" : "cable"} rate row for ${attrLine}.`);
  } else if (result.status === "no_match") {
    // ADP-3a (B6 #4): only the facts this pipeline's catalogue rows vary on
    const facts = varyingAttrLine(workingsAttrs, items, primary as Pipeline);
    derivation.push(`No ${termination ? "termination" : "cable"} rate row matches ${facts || "these answers"}.`);
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
        secondaryGroup.derivation.push(`${outputWord(o)} = ${moneyValue(sr.finals[o])}`);
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
  // ELR-1 (R-UNIT, AC3): the PRIMARY block's matched row names the unit (a cable per Mtr, a termination per Set)
  const unitNote = Object.keys(values).length
    ? attributeUnitNote(config, items, (ctx as RowContextWithUnit).unit, primaryId, result)
    : undefined;

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
      ...(unitNote ? { unitNote } : {}),
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
/** VRF-3a K2 (owner QR-1 (a), U9, 2026-11-04 19:07): the calculator's "BoQ quantity of this row" -- the panel reads the BoQ
 * row's own quantity (`ctx.quantity`); the calculator has no row, so the pricer types it. Read only by a counted item
 * (refnets) on a per-Set row. */
export const ROW_QTY_OVERRIDE_KEY = "__row_qty__";
/** VRF-3b (U6, owner 2026-11-05): the calculator's "This row's price includes" tick boxes -- the include ids ticked,
 * comma-separated ("copper,insulation,power,comm"). A BoQ row gets the same flags from the model at VRF-4. */
export const EXTRAS_INCLUDES_KEY = "__includes__";
/** VRF-3b: the row number an extra cable line is computed on -- never a sheet row, so no extraction is ever read for it */
const EXTRA_CABLE_ROW = -987654321;

/** VRF-3b: the pricer's edits to the extras of ONE unit -- kept ON the unit's entry, so removing the unit (or a split
 * module) takes its extras with it. */
export interface ExtrasEdit {
  /** the pricer's values, per extra line, per field ("size", "thickness", "spec", "length", "count") */
  set?: Record<string, Record<string, string>>;
  /** VRF-3b (owner 12:23 "the user should be able to remove the xtras"; as SHAPE Q3): the HIDDEN TAG -- the lines the
   * pricer removed. Nothing adds a removed line back on its own; "Put it back" takes it off this list. */
  removed?: string[];
}

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
  /** ADP-1: the attribute ids this edit carries MIRRORED from the item above (a section's pipe size). Written only by
   * the section pass, which encodes it into its own call; never typed by a person and never in a saved edit state. */
  mirrored?: string[];
  /** VRF-3a (owner SHAPE Q3 "Hidden tag", 2026-11-04 14:56): this line came from the HELPER's split -- an invisible
   * marker. While any entry of a row carries one, the split never fires on that row again (its own lines, a re-compute,
   * after any edit / remove / add, the calculator's re-run of the seam). Written only by `splitEdits`. */
  helper?: HelperMark;
  /** VRF-6 U11 (owner 2026-11-09 18:52): the option the pricer stepped to on the helper's ranked singles / pairs for this
   *  entry (`CoverChoice`); absent = the helper's own pick. Written only by the `cover_option` operation. */
  cover?: number;
  /** VRF-3b: the pricer's edits to this unit's extra lines (values typed / picked, lines removed). Absent on every entry
   * of a config that declares no `extras`, and on a unit nobody has touched. */
  extras?: ExtrasEdit;
  /**
   * SLICE 12e-3a (owner 13:40): the edits of the sections ATTACHED to this item, by section id -- a pipe's own
   * insulation. Kept ON the item so removing or changing the item takes its section with it. Absent on every
   * item of a config that declares no section. `base` inside is an index into that SECTION's model items.
   */
  sections?: Record<string, ItemEdit>;
}
/** VRF-3a (Q3): the hidden tag on a line the helper's split made -- what the split was, so the panel can say it, tell an
 * edited line ("changed by you") and put the row back ("Reset to the helper's split"). */
export interface HelperMark {
  /** the split's group: the index of the entry it replaced */
  g: number;
  /** this line's place in the split, and how many lines the split made */
  i: number;
  n: number;
  /** the field the size sits in, and the size the split gave this line (in the family's unit) */
  attr: string;
  size: string;
  /** every size the split made, in order (the row note says the helper's split even after a line is removed; found in the cert) */
  layers?: string[];
  /** the total split, the family's unit word, whether the lines add up exactly, the largest size of the variant */
  total: number;
  unit: string;
  exact: boolean;
  top: number;
  /** the row's entry count right after the split (a line added after it = the split was changed) */
  rowN: number;
  /** the line as made -- a line that differs from it now was changed by the pricer */
  made: string;
  /** the entry the split replaced -- "Reset to the helper's split" puts it back */
  from: ItemEdit;
  /** the reader's line for the total (a conversion) */
  readNote?: string;
  /** a split the row WROTE (R-SPLIT (a)): the modules, their sum, the total as written, the text */
  stated?: { modules: number[]; sum: number; total: number | null; written: string; typed: boolean };
  /** D-3: the condition the row states about the split, as written */
  cond?: string;
  /** VRF-6 (F8): a pair / set chosen before the next size up -- the sentence that replaces "bigger than the largest unit" */
  why?: string;
  /** VRF-6 U11: the ranked options this split was one of -- the panel's "next best option" steps on from it */
  cover?: CoverChoice;
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
      // ADP-1: the section pass's own mirrored-size marker survives its one encode / decode round
      ...(Array.isArray(e.mirrored) ? { mirrored: e.mirrored.filter((x) => typeof x === "string") } : {}),
      ...(Object.keys(secs).length ? { sections: secs } : {}),
      // VRF-3a (Q3): the helper's hidden tag survives every encode / decode -- it is what stops a re-split
      ...(nested ? helperMarkOf(e.helper, count) : {}),
      // VRF-3b: the extras' edits and the removed-extras tag survive too (strings only)
      ...(nested ? extrasEditOf(e.extras) : {}),
      // VRF-6 U11: the option the pricer stepped to survives (a positive whole number only)
      ...(typeof e.cover === "number" && Number.isInteger(e.cover) && e.cover > 0 ? { cover: e.cover } : {}),
    };
  };
  const extrasEditOf = (x: unknown): { extras: ExtrasEdit } | Record<string, never> => {
    if (!x || typeof x !== "object") return {};
    const src = x as ExtrasEdit;
    const set: Record<string, Record<string, string>> = {};
    for (const [line, fields] of Object.entries(src.set && typeof src.set === "object" ? src.set : {})) {
      if (!fields || typeof fields !== "object") continue;
      const f = Object.fromEntries(Object.entries(fields).filter(([, v]) => typeof v === "string")) as Record<string, string>;
      if (Object.keys(f).length) set[line] = f;
    }
    const removed = Array.isArray(src.removed) ? src.removed.filter((r) => typeof r === "string") : [];
    if (!Object.keys(set).length && !removed.length) return {};
    return { extras: { ...(Object.keys(set).length ? { set } : {}), ...(removed.length ? { removed } : {}) } };
  };
  const helperMarkOf = (h: unknown, count: number): { helper: HelperMark } | Record<string, never> => {
    if (!h || typeof h !== "object") return {};
    const m = h as HelperMark;
    const nums = [m.g, m.i, m.n, m.total, m.top, m.rowN];
    if (!nums.every((x) => typeof x === "number" && Number.isFinite(x)) || typeof m.attr !== "string" || typeof m.size !== "string"
        || typeof m.made !== "string" || typeof m.unit !== "string" || typeof m.exact !== "boolean" || !m.from || typeof m.from !== "object") return {};
    const f = one(m.from as ItemEdit, count, false);
    return { helper: { ...m, from: { base: f.base, family: f.family, attrs: f.attrs, ...(f.qty !== undefined ? { qty: f.qty } : {}), ...(f.other ? { other: f.other } : {}), ...(f.cover !== undefined ? { cover: f.cover } : {}) } } };
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
    // VRF-3a: a line of the helper's split carries its size as the HELPER's, not a typed value -- the field reads it as one
    // of its options; a size the pricer types afterwards (in `attrs`) wins below, as every typed value does
    if (e.helper && !Object.prototype.hasOwnProperty.call(e.attrs, e.helper.attr)) attributes[e.helper.attr] = { value: e.helper.size };
    // SLICE 12d-1b (owner T6): a value the PRICER typed is marked, so the pricer never parses it as layers.
    for (const [k, v] of Object.entries(e.attrs)) attributes[k] = { value: v === "" ? null : v, typed: true, ...((e.mirrored ?? []).includes(k) ? { mirrored: true } : {}) };
    // SLICE 12e-2 (owner P1): a family TYPED through the family field's "Other..." box (recorded in `other`
    // under the family attribute id, exactly as a size field records it) is marked typed too, so the
    // `family_text` reader can tell a pricer's spelling from a model's answer. A block that never opened the
    // box carries no such entry and is byte-identical.
    if (e.family !== null && (e.other ?? []).includes(familyAttrId)) attributes[familyAttrId] = { value: e.family === "" ? null : e.family, typed: true };
    // SLICE 6c: an untyped quantity is passed as ABSENT, which the module has always priced as 1 -- so the
    // marking changes no rate anywhere.
    return { attributes, ...(e.qty !== undefined ? { qtyPerRowUnit: e.qty } : {}), ...(e.cover !== undefined ? { coverPick: e.cover } : {}) };
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
/** ADP-3a (B6 #7). PURE. A field label as a person reads it: "Neck size (as written)" -> "Neck size". */
export function plainFieldLabel(label: string): string {
  return label.replace(/\s*\(as written\)\s*$/i, "");
}

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
  /** ADP-3a (U3 / U4): the box HOLDS words but the refusal is about what it did not give (an access door's "600"
   * gave no height) -- outlined like a blank one. Absent when nothing refused on this field. */
  outline?: true;
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
  /** ADP-4a (owner B5 / U5): the words the select's empty choice shows -- "not stated" where the model's stored
   *  answer is "None" and "None" is not offered. Absent everywhere else (the panel shows "- select -"). */
  placeholder?: string;
  /** VRF-2b (owner Q3 / U1): the unit picker beside the typed box of a reader declaring `units` -- the item attribute
   *  it writes (`<id>__unit`), the units offered, the one shown (the pricer's pick, else the family's), the family's. */
  unitPicker?: { id: string; units: string[]; value: string; defaultUnit: string };
  /** VRF-3a (found in the cert): the size box of a `split` family -- a value typed here is handed to the pricer when the
   * pricer leaves the box or presses Enter, not on every keystroke (a split fired on the first number typed, "60" of
   * "60 HP (18+18+24)", and the row split before the rest of the text was in). Present only there. */
  splitOnCommit?: true;
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
  /** VRF-3a: "helper" -- a line of the helper's split ("Item N · split by the helper") */
  source: "model" | "user" | "helper";
  /** VRF-3a (U1 / U2): on a helper line, the line saying where it came from, and whether the pricer has changed it */
  helperLine?: string;
  changedByYou?: true;
  /** VRF-6 U11 (owner 18:52): on the unit a stated size no single SKU matched (the first line of its split, or the single) --
   *  the helper's pick or the next best (K1d: exactly two), and the option the one toggle steps to (`cover_option`). */
  cover?: { option: number; of: number; userChosen: boolean; label: string; next: number };
  /** VRF-3a K2 (U5, board 11): a counted item (a refnet) on a per-Set row -- its three typed fields, the expected-count
   * formula, the case's sentence, the pieces the rule gave (null = withheld: the box blank and red) and whether the
   * pricer typed the pieces themselves. */
  setCount?: { fields: Array<{ id: string; label: string; note?: string; options?: string[]; value: string; /** VRF-3b (U8): typed by the pricer (its undo arrow) */ edited?: true;
    /** VRF-4 (q2, U5): added up from the sheet's rows (the note names them); editable */ fromSheet?: true }>; formula?: string; sentence: string; pieces: number | null; typed: boolean };
  family: string | null;
  /** The family the model returned when it differs from the family that prices (the R3 alias note). */
  familyRaw: string | null;
  /** ADP-4a (owner AC2, display only): the family and the model's family as a pricer reads them ("Not in the
   *  catalogue", "Grille (type not stated)"). Present ONLY on the plain item wording where they differ. */
  familyLabel?: string;
  familyRawLabel?: string;
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
  /** VRF-3b (U1 / U5): this unit's place among ALL the row's lines ("Item N"), present only on a row with extras */
  lineNo?: number;
  /** VRF-3b (U1-U5, boards 12 / 13): the extra lines this unit's price includes, drawn under it; the lines the pricer
   * removed ("You removed: ... [Put it back]"). Present only on an indoor / outdoor unit of a row with extras. */
  extras?: { lines: ExtraLineView[]; removed: Array<{ id: ExtraLineId; label: string }>; removedNote?: string;
    /** VRF-4 (O-5): on a BoQ row, "the BoQ says this unit's price includes ..." (read by the model) */ boqNote?: string;
    /** VRF-5 (owner R1 SAFEGUARD, U1): "This row may include extras - please review" -- what / why, one point per inclusion
     *  a heading or note states (added, or not added because the BoQ quotes it on its own row) */
    review?: { title: string; points: string[] };
    /** VRF-5 (owner R1, U1): further items the BoQ lists with the unit that are no extra -- one note point each, not priced */
    notes?: { title: string; points: string[] } };
}

/** VRF-3b (U1 / U2 / U3 / U8): one field of an extra line. */
export interface ExtraFieldView {
  /** K1b: "family" (the line's item -- Change item), "size", "cladding", "thickness", "conductor", "armour", "cores", "sqmm",
   *  "spec" (read-only), "length", "count" */
  id: string;
  /** VRF-3b K1b (owner 16:07, ANSWER 2): the line's ITEM, changed through "Change item" as on every item-list line */
  changeItem?: true;
  /** what a read-only value is in ("mm"); absent = shown as is */
  suffix?: string;
  label: string;
  /** the value that PRICES (a typed rough size shows the closest stocked size -- "show the one used", 13:53) */
  value: string;
  /** what the pricer typed in the "Other..." box */
  typedValue: string;
  options?: string[];
  allowOther?: boolean;
  otherMode?: boolean;
  required?: boolean;
  /** U2: where the value came from -- the Pricing Inputs default (amber), picked by you (blue), from the BoQ, or the
   * copper line it follows */
  tag?: "default" | "picked" | "boq" | "follows";
  tagText?: string;
  /** U8: the pricer changed this field (the undo arrow) */
  userEdited: boolean;
  blank?: boolean;
  note?: string;
  readOnly?: true;
}

/** VRF-3b (U1 / U4, boards 12 / 13): one extra line -- priced by its own category's rules, per Nos of the row. */
export interface ExtraLineView {
  id: ExtraLineId;
  /** the unit block it belongs to */
  unitIndex: number;
  lineNo: number;
  /** "Item N · extra the BoQ includes · from Piping" */
  heading: string;
  /** "Copper pipe - supply line" */
  title: string;
  /** VRF-4 (U2): a BoQ row's line -- the model read that the unit's price includes it ("from the BoQ") */
  fromBoq?: true;
  fromBoqText?: string;
  fields: ExtraFieldView[];
  state: "priced" | "blank";
  reason?: string;
  working: string[];
  /** the per-metre rate, kept where known even when the line cannot price (B: "unit rate kept where known") */
  perMetre?: { supply: number; install: number };
  figures: Partial<Record<RateKind, number>>;
  /** VRF-5 (owner R1): an ACCESSORY line -- one that cannot price (no catalogue match, a default not set) is a note, never a
   *  block: the row prices without it */
  optional?: true;
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
   * VRF-3a (U1 / U2 / U3, boards 6-8): the helper's split on this row -- the row note saying what was split and how, the
   * D-3 condition the row states, and once the pricer changed a line / removed one / added one: the amber box, the
   * lines-vs-total note and "Reset to the helper's split". Present ONLY on a row with a split.
   */
  split?: { note: string; sumNote?: string; condition?: string; changed?: string; linesNote?: string; resetLabel: string };
  /** VRF-3a K2 (U4 / U5 / U6, boards 9 / 11): the bold bar above the card on a per-Set or whole-lot row -- orange when the
   * row prices on the team rule, red when it is not priced -- and the ringed "Unit Set · Qty q" line. */
  unitBar?: { tone: "orange" | "red"; title: string; lines: string[]; ring?: string };
  /** VRF-4 (R-WS, D-5 "option D", D-9): the solid red WORKING + STANDBY bar above the card and the ringed unit and quantity,
   * raised only by the model's copied W+S words. The price is ONE unit: nothing else changes. */
  standbyBar?: { title: string; lines: string[]; ring: string };
  /** VRF-3a K2 (U4): the per-item quantity box's label on a per-Set row ("Pieces in one Set of this row"). */
  qtyLabel?: string;
  /** VRF-3a K2 (QR-1 (a), U9): the calculator's "BoQ quantity of this row" -- shown only on a per-Set row with a counted
   * item. Never on a BoQ row (the row's own quantity is read). */
  rowQtyField?: { label: string; value: string };
  /** VRF-3b (U6): the calculator's "This row's price includes" tick boxes ("Insulation needs copper piping"). Present
   * only in the calculator, on a config that declares `extras`. */
  extrasIncludes?: { title: string; options: Array<{ id: ExtraIncludeId; label: string; checked: boolean; disabled?: boolean; note?: string }> };
  /** VRF-3b (U4): on a row with extras every LINE counts for "n of m items need a person" -- each unit, each extra */
  lineCount?: { lines: number; bad: number };
  /** VRF-5 (owner R4-R8, U5): the row's scope -- supply only (install 0 on every line) / installation only (supply 0, install x
   *  (1 + the uplift)) -- with its note and, in the calculator, the "BoQ scope" choice. Absent on a supply + installation row. */
  scope?: { value: string; note?: string; picker?: { title: string; options: string[]; value: string } };
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
  // VRF-3a K2 (owner SET; U4 "Set in the Row unit list"): a config pricing per Set offers its first per-Set spelling right
  // after the spelling of the class it prices in, so the calculator can state a Set row. ABSENT => byte-identical.
  const ps = spec.per_set?.units?.[0];
  if (ps && !seen.has(ps.trim().toLowerCase())) {
    const cls = unitClassOf(spec, ps);
    const first = cls !== null ? spec.unit_classes[cls]?.[0] : undefined;
    const at = first !== undefined ? out.indexOf(first) : -1;
    if (at >= 0) out.splice(at + 1, 0, ps);
  }
  // VRF-3b (owner 01:15 "Lot in the calculator's Row unit", calculator = panel; U7): a config declaring whole-lot spellings
  // offers its first one LAST, so the calculator can state a Lot row and see the panel's red bar. ABSENT => byte-identical.
  const lot = spec.lot_units?.units?.[0];
  if (lot && !seen.has(lot.trim().toLowerCase())) out.push(lot);
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
      // ADP-3a (U2): the outer-size box's WORDS are not a width -- they narrow nothing here (the second key reads them)
      if (stated !== undefined && !f.secondKey) answers[f.skuAttr] = stated;
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
  /**
   * SLICE 12e-6 (AC9 a, owner U7; 12e-5b2 review "ok with 12e-6"): on a COMPOSED block the cladding belongs to the
   * OUTER layer -- `outer_only` sets every inner layer's to its plain "No", so the first layer (`res`) carries no
   * default for it and the field showed the model's raw "None" ("- select -"). It shows the outer layer's ruled value
   * ("No", amber, with its rule) instead. Display only; one layer (everything uncomposed) is untouched.
   */
  const outerOnly = spec.compose?.outer_only?.attr;
  if (outerOnly && layers.length > 1 && !defaultedBy.has(outerOnly)) {
    const od = layers[layers.length - 1].defaulted.find((d) => d.attr === outerOnly);
    if (od) defaultedBy.set(outerOnly, od);
  }
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
    // ADP-1 (owner H3 (d) / U2): a TYPED-ONLY box the pricer cleared is not stated either -- it shows its ruled default
    const defaulted = !!d && (stated === "None" || stated === "") && (!userEdited || (stated === "" && !!spec.numbers[f.skuAttr]?.typed_only))
      // VRF-2b (R-BRAND): a stated brand off the sheet / several brands priced as the default shows the default, amber
      || (!!d && d.asWritten !== undefined && !userEdited);
    const tm = userEdited ? undefined : textMappedBy.get(f.skuAttr);
    let value = defaulted ? d!.value : tm ? tm.value : stated;
    // ADP-1 (owner H3): a typed-only number read from the size as written shows the value USED, with its line below
    const lr = stated === "" && res.lengthRead?.attr === f.skuAttr ? res.lengthRead : undefined;
    if (lr) value = fmtNum(lr.metres);
    // ADP-2 (owner H7): a typed-only box FILLED from the model's own reading (a plenum side, its area) likewise
    const fr = stated === "" ? res.filledReads?.[f.skuAttr] : undefined;
    if (fr) value = fmtNum(fr.value);
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
          // ADP-3a (B6 #6): the inch hint only where this field's reader ACCEPTS inches -- ADP refuses them
          note = reasonIsMine && res.reason
            ? `${said} ${value}${vU}: ${res.reason}`
            : spec.numbers[f.skuAttr]?.inches
              ? `Enter a number in ${unitOf ?? "mm"}, or an inch size like 7/8".`
              : `Enter a number in ${unitOf ?? "mm"}.`;
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
      // VRF-2b (R-CONV): a unit-converting reader says how it converted ("4 HP / 1.25 (HP per TR, ...) = 3.2 TR")
      const r = rd?.units
        ? readCapacity(matched.from, rd, { familyUnit: familyUnitOf(spec, items, family, rd), factorOf: (id) => pricingInputFactor(items, id), family })
        : rd ? readNumber(matched.from, rd) : null;
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
    /**
     * SLICE 12e-5b2 (owner R5 / U2): a COMPOSED axis shows the TOTAL thickness of its layers ("24"), never the
     * first layer's ("9"), and its line is the composition line the working already opens with. One layer
     * (everything uncomposed) is untouched, and so is a field the row refused on (it stays blank and red).
     */
    if (layers.length > 1 && spec.compose && f.skuAttr === spec.compose.attr && !(res.state === "blank" && reasonIsMine)) {
      const parts = layers.map((l) => Number(l.selection[f.skuAttr]));
      if (parts.every((n) => Number.isFinite(n))) {
        value = fmtNum(parts.reduce((a, b) => a + b, 0));
        const line = blockWorking[0];
        if (!note && line && /->/.test(line) && /priced as/.test(line)) note = line;
      }
    }
    if (lr && !note) note = lr.line;
    if (fr && !note) note = fr.line;
    /**
     * VRF-2b (owner R-CONV, U3): a capacity READ IN ANOTHER UNIT says the conversion, then where the ladder put it --
     * "5 kW / 3.517 (kW per TR, Pricing Inputs) = 1.42 TR -> priced as 1.5 TR (next size up)". It replaces the ladder's
     * own "You typed 5 -> priced as 1.5" line, whose 5 was never in the family's unit.
     */
    const unitRead = res.unitReads?.[f.skuAttr];
    const capUnit = spec.numbers[f.skuAttr]?.units ? familyUnitOf(spec, items, family, spec.numbers[f.skuAttr]) : null;
    if (unitRead) {
      note = unitRead + (hop && hop.requested !== hop.fitted ? ` -> priced as ${fmtNum(hop.fitted)} ${capUnit ?? ""} ${hopLandedWords(hop)}`.replace(/\s+/g, " ") : "");
    }
    /**
     * ADP-3a (U6): A TYPED SIZE OR AREA BOX SAYS WHAT PRICING READ FROM IT. The owner's standing rule ("every
     * attribute shows the value actually used with a note on how it landed there") reached the dropdowns and the
     * typed-only boxes; a plain text box holding the BoQ's own words ("750 X 150 mm", "Up to 0.5 Sqmt") showed the
     * words and nothing about the numbers taken from them. Only where the item priced, the box is text, and no other
     * line already speaks for it.
     */
    if (!note && res.state === "priced" && f.control === "text" && stated.trim() !== "" && !f.optional) {
      const used = (f.axes ?? [f.skuAttr]).filter((a) => typeof res.readValues?.[a] === "number");
      if (used.length) {
        const unitOfAxis = (a: string) => spec.numbers[a]?.unit === "sqm" ? " sq.m" : spec.numbers[a]?.unit ? ` ${spec.numbers[a]!.unit}` : "";
        const band = used.some((a) => spec.numbers[a]?.unit === "sqm") && (/\bup\s*to\b/i.test(stated) || (stated.match(/\d+(?:\.\d+)?/g) ?? []).length > 1);
        const parts = used.map((a) => used.length === 1 && spec.numbers[a]?.unit === "sqm"
          ? `priced at ${fmtNum(Number(res.readValues![a]))}${unitOfAxis(a)}`
          : `${spec.numbers[a]?.name ?? a} ${fmtNum(Number(res.readValues![a]))}${unitOfAxis(a)}`);
        note = `${said} ${stated.trim()} -> ${parts.join(", ")}${band ? " (the largest value)" : ""}`;
      }
    }
    // ADP-3a (U6): the neck TAKEN FROM THE OUTER SIZE says so on the neck itself (the working said it alone)
    const skHere = (spec.second_key ?? []).find((r) => !!family && r.families.includes(family));
    if (!note && skHere && f.skuAttr === skHere.primary && stated.trim() === "") {
      const a4 = blockWorking.find((w) => /\(A-4\)$/.test(w) && (w.startsWith("matched on the") || w.startsWith("only one SKU carries")));
      if (a4) note = a4.replace(/\s*\(A-4\)$/, "");
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
    // VRF-2b (owner U2 A): each size option of a unit-converting reader shows its unit ("16HP", "1.5TR"); the option's
    // VALUE stays the bare number (what prices and what is stored)
    if (capUnit && !optionLabels && (f.options ?? []).length) optionLabels = Object.fromEntries((f.options ?? []).map((o) => [o, `${o}${capUnit}`]));
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
    const matchHelp = f.allowOther ? sizeFieldHelp(spec, f.skuAttr, f.options ?? [], family)?.lines : undefined;
    /**
     * ADP-3a (U3 / U4): THE OUTLINE IS KEYED TO THE FIELD. A refusal now says WHICH facts it is about (`missing`,
     * `refusedFor`, `sizeRefused`) and a field is outlined when it feeds one of them -- its own SKU attribute or any
     * side its box feeds (a size box holding "600" is outlined for the height it did not give). Searching the
     * sentence for a field's name (`reasonIsMine`) outlined the Area box under every plenum refusal (each contains
     * "area") and never the Cladding box (no reader name); it still chooses the field's NOTE, never its outline.
     */
    const feeds = f.axes ?? [f.skuAttr];
    const keyed = res.state === "blank"
      && feeds.some((a) => (res.missing ?? []).includes(a) || res.refusedFor === a || res.sizeRefused === a);
    const needed = keyed || (res.state === "blank" && twoWaysHere);
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
    /**
     * ADP-4a (owner register B5, U5): "None" is not offered on the plain item wording (`itemFieldDefs`), so a STORED
     * "None" -- the model's "not mentioned" -- would match no option. The select shows its empty choice, worded "not
     * stated"; the stored answer is unchanged (the pricing reads the assembled item, never this display value).
     * ONLY where that "None" was an option before -- no ruled default maps it (U5 names the air stream); a field whose
     * "None" a default already turned into a catalogue value never offered it (12d-2) and keeps its display as it was.
     */
    const noneShown = plainItemListWording(spec) && f.allowNone && stated === "None" && !defaulted && !!f.options && !f.options.includes("None")
      && family !== null && ruledDefaultValue(spec, f.skuAttr, family) === undefined;
    return {
      ...f,
      ...(defaultAsOption ? { options: [...f.options!, value] } : {}),
      ...(noneShown ? { placeholder: "not stated" } : {}),
      value: noneShown ? "" : value,
      typedValue: defaultInBox ? value : stated,
      defaulted,
      ...(defaulted ? { rule: d!.rule } : tm ? { rule: tm.line } : {}),
      ...(modelGave ? { readOnly: true as const } : {}),
      userEdited,
      otherMode: otherMode || defaultInBox,
      ...(note ? { note } : {}),
      ...(optionLabels ? { optionLabels } : {}),
      // VRF-2b (owner Q3 / U1): the unit picker beside the typed box -- only on a reader declaring `units`
      ...(f.allowOther && spec.split && spec.compose?.attr === f.skuAttr && family !== null && spec.split.families.includes(family) ? { splitOnCommit: true as const } : {}),
      ...(capUnit && f.allowOther ? { unitPicker: {
        id: `${f.id}${UNIT_PICK_SUFFIX}`,
        units: unitPickerUnits(spec.numbers[f.skuAttr]),
        value: (() => { const v = edit.attrs[`${f.id}${UNIT_PICK_SUFFIX}`]; return typeof v === "string" && v ? v : capUnit; })(),
        defaultUnit: capUnit,
      } } : {}),
      ...(matchHelp && matchHelp.length ? { matchHelp } : {}),
      blank: value === "" && needed,
      // ADP-3a (U3 / U4): a box that HOLDS words but did not give what the refusal needs is outlined too
      ...(needed && value !== "" ? { outline: true as const } : {}),
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
    source: edit.helper ? "helper" : edit.base !== null && edit.family === null ? "model" : "user",
    ...(edit.helper ? {
      helperLine: edit.helper.stated
        ? `From the split ${edit.helper.stated.typed ? "you typed" : "the row states"}: ${edit.helper.size} ${edit.helper.unit}`.trim()
        : (edit.helper.cover && edit.helper.cover.picked > 0
          ? `From the next-best option you chose for ${fmtN(edit.helper.total)} ${edit.helper.unit} -> ${edit.helper.size} ${edit.helper.unit}`
          : `From the helper's split of ${fmtN(edit.helper.total)} ${edit.helper.unit} -> ${edit.helper.size} ${edit.helper.unit}`).replace(/\s+$/, ""),
      ...(helperLineChanged(edit) ? { changedByYou: true as const } : {}),
    } : {}),
    ...(() => {
      const c = edit.helper ? (edit.helper.i === 0 ? edit.helper.cover : undefined) : res.cover;
      if (!c || c.options.length < 2) return {};
      const o = c.options[c.picked];
      const u = c.unit ? ` ${c.unit}` : "";
      return { cover: { option: c.picked + 1, of: c.options.length, userChosen: c.picked > 0, next: c.picked > 0 ? 0 : 1,
        label: `${c.picked > 0 ? "Next-best option (chosen by you)" : "The helper's pick"}: ${o.layers.map(fmtN).join(" + ")}${u} for the BoQ's ${fmtN(c.total)}${u}` } };
    })(),
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
    working: withoutRestatements(spec, res, family, edit, fields, ladRewrites.length
      ? blockWorking.map((w) => { const r = ladRewrites.find((x) => w.startsWith(`${x.from} -> `)); return r ? `${r.to}${w.slice(r.from.length)}` : w; })
      : blockWorking),
    figures,
  };
}

/**
 * ADP-4a (owner D5, 2026-10-21 "Show each default once, on the field (where it can be changed), not again in the
 * working" - "Yes"; AC3; scope ruled the same day: ADP and Insulation, an Insulation block the same wherever it sits).
 *
 * A fact the panel states ON A FIELD -- a ruled default (the amber line), the family a row's kind decided (the heading),
 * a ladder's move, a size read from the size as written, an override, the alias a family priced as -- is said there
 * ONCE; its copy in the working goes. The working keeps the arithmetic. Each copy is rebuilt EXACTLY from the record the
 * pricer wrote it from (the same template, the same record), and it is removed ONLY when the field (or the heading) that
 * states it is on screen -- a fact with no field to stand on stays in the working, so nothing is ever said nowhere.
 *
 * Scope: a category that rules defaults (`pricing.defaults` / `number_defaults`) -- ADP and Insulation. Piping rules
 * none and its working is untouched, byte for byte. PURE.
 */
export function withoutRestatements(
  spec: ItemListPricingSpec,
  res: ItemPriceResult,
  family: string | null,
  edit: ItemEdit,
  fields: ItemFieldView[],
  working: string[],
): string[] {
  if (!spec.defaults && !spec.number_defaults) return working;
  const exact = new Set<string>();
  const fieldOf = (attr: string) => fields.find((f) => f.skuAttr === attr || (f.axes ?? []).includes(attr));
  for (const d of res.defaulted) {
    const f = fieldOf(d.attr);
    if (f && f.defaulted && f.rule !== undefined) exact.add(`${d.when ? `${d.when.equals} ${d.when.attr}, ` : ""}${d.attr} not mentioned -> ${d.value} (${d.rule})`);
  }
  if (res.familyDefaulted && edit.family === null) exact.add(`${familyAttr(spec)} not mentioned -> ${res.familyDefaulted.value} (${res.familyDefaulted.rule})`);
  for (const o of res.overrides ?? []) if (fieldOf(o.attr)?.note === o.rule) exact.add(o.rule);
  if (res.familyRaw !== null && res.familyRaw !== family && !res.familyLine && family !== null && spec.family_alias?.[res.familyRaw]) {
    exact.add(`'${res.familyRaw}' prices as ${family} (R3)`);
  }
  // a reading or a ladder move restated: the field that shows it carries a note
  const said: Array<{ name: string; note: string; attr: string }> = [];
  for (const f of fields) {
    if (!f.note) continue;
    for (const attr of f.axes ?? [f.skuAttr]) {
      const name = spec.numbers[attr]?.name;
      if (!name) continue;
      said.push({ name, note: f.note, attr });
      const filled = res.filledReads?.[attr];
      if (filled) exact.add(`${name}: ${filled.line}`);
      if (res.lengthRead?.attr === attr) exact.add(`${name}: ${res.lengthRead.line}`);
    }
  }
  const hopNames = new Set(res.ladderHops.filter((h) => said.some((s) => s.attr === h.attr)).map((h) => h.name));
  const restated = (line: string): boolean => {
    const w = line.trim();
    if (exact.has(w)) return true;
    for (const n of hopNames) if (w.startsWith(`${n} `) && w.includes(" is not on the sheet -> ")) return true;
    for (const s of said) {
      // a reader's own line ("torque: range '10-12' -> its top value 12") whose words the field's note carries
      if (w.startsWith(`${s.name}: `)) {
        const body = w.slice(s.name.length + 2).replace(/^'[^']*'\s*/, "");
        if (body !== "" && s.note.includes(body)) return true;
      }
      // several sizes stated ("pipe size states two sizes (19 / 25) - the higher, 25, is taken")
      if (w.startsWith(`${s.name} `) && s.note.includes(w.slice(s.name.length + 1))) return true;
    }
    return false;
  };
  return working.filter((w) => !restated(w));
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
  /** out: VRF-5 (owner R1) -- the further model items folded off a unit row (never priced as items, never a block) */
  folded?: Array<{ base: number; family: string | null }>;
}

/** VRF-3a: a number as the split's lines say it (2 decimals at most). */
function fmtN(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

/** VRF-3a (Q3): the line as the split made it, as one comparable key -- a line that differs from it was changed. */
function helperMadeKey(e: Pick<ItemEdit, "family" | "attrs" | "qty" | "other">): string {
  const attrs = Object.keys(e.attrs).sort().map((k) => [k, e.attrs[k]]);
  return JSON.stringify({ f: e.family, a: attrs, q: e.qty ?? null, o: [...(e.other ?? [])].sort() });
}

/** VRF-3a (U2): the pricer changed this line of the helper's split. PURE. */
function helperLineChanged(e: ItemEdit): boolean {
  return !!e.helper && helperMadeKey(e) !== e.helper.made;
}

/**
 * VRF-3a (owner R-SPLIT, D-1, SHAPE Q3) -- PURE. The edit state with every requested split applied: the entry is replaced by
 * one line per size, each keeping the entry's brand / variant answers (its other attributes, quantity and base) and
 * carrying the hidden tag. The size sits in the tag, not in `attrs`, so the field shows it as the helper's.
 */
export function splitEdits(
  spec: ItemListPricingSpec,
  edits: ItemListEditState,
  splits: ReadonlyMap<number, NonNullable<ItemPriceResult["splitInto"]>>,
  modelItems: readonly ExtractedListItem[],
  rowText: string,
): ItemListEditState {
  const out: ItemEdit[] = [];
  edits.items.forEach((e, idx) => {
    const sp = splits.get(idx);
    if (!sp) { out.push(e); return; }
    const fid = spec.numbers[sp.attr]?.from?.[0] ?? sp.attr;
    const attrs = { ...e.attrs };
    delete attrs[fid];
    delete attrs[`${fid}${UNIT_PICK_SUFFIX}`];
    const other = (e.other ?? []).filter((x) => x !== fid);
    const line: ItemEdit = { base: e.base, family: e.family, attrs, ...(e.qty !== undefined ? { qty: e.qty } : {}), ...(other.length ? { other } : {}) };
    const typedSize = Object.prototype.hasOwnProperty.call(e.attrs, fid);
    const sizeText = typedSize ? e.attrs[fid] : String((e.base !== null ? modelItems[e.base]?.attributes?.[fid]?.value : "") ?? "");
    const cond = (() => {
      const c = spec.split?.conditions;
      if (!c) return undefined;
      for (const w of c.words) {
        let m: RegExpExecArray | null = null;
        try { m = new RegExp(w, "i").exec([sizeText, rowText].join(" | ")); } catch { m = null; }
        if (m) return m[0].trim();
      }
      return undefined;
    })();
    const { helper: _h, ...from } = e;
    sp.layers.forEach((size, i) => {
      out.push({ ...line, attrs: { ...attrs }, ...(other.length ? { other: [...other] } : {}), helper: {
        g: idx, i, n: sp.layers.length, attr: fid, size: fmtN(size), layers: sp.layers.map(fmtN), total: sp.total, unit: sp.unit, exact: sp.exact, top: sp.top,
        rowN: 0, made: helperMadeKey(line), from: { ...from, attrs: { ...from.attrs } },
        ...(sp.readNote ? { readNote: sp.readNote } : {}),
        ...(sp.stated ? { stated: { ...sp.stated, typed: typedSize } } : {}),
        ...(cond ? { cond } : {}),
        ...(sp.why ? { why: sp.why } : {}),
        ...(sp.cover ? { cover: sp.cover } : {}),
      } });
    });
  });
  for (const e of out) if (e.helper) e.helper.rowN = out.length;
  return { ...edits, items: out };
}

/**
 * VRF-3a (U1 / U2 / U3, boards 6-8) -- PURE. What the panel says about the helper's split on this row: the row note (the
 * helper's split or the split the row writes), the D-3 condition, and -- once the pricer changed a line, removed one or
 * added one -- the amber box, the lines-vs-total note and the reset button. Read off the hidden tags and the priced lines.
 */
function splitViewOf(spec: ItemListPricingSpec, edits: ItemListEditState, layersBySource: Map<number, ItemPriceResult[]>): ItemListView["split"] {
  const marks = edits.items.map((e) => e.helper).filter((h): h is HelperMark => !!h);
  if (!marks.length) return undefined;
  const h = marks[0];
  const u = h.unit ? ` ${h.unit}` : "";
  const groups = new Map<number, HelperMark[]>();
  for (const m of marks) groups.set(m.g, [...(groups.get(m.g) ?? []), m]);
  const sizesOf = (g: HelperMark[]) => [...g].sort((a, b) => a.i - b.i).map((m) => m.size);
  const notes: string[] = [];
  let sumNote: string | undefined;
  for (const g of groups.values()) {
    const m = g[0];
    const all = m.stated ? m.stated.modules.map(fmtN) : (Array.isArray(m.layers) && m.layers.length ? m.layers : sizesOf(g));
    if (m.stated) {
      const tot = m.stated.total ?? m.stated.sum;
      notes.push(`${m.readNote ? `${m.readNote}. ` : ""}${m.stated.typed ? "You typed" : "The row states"} a split: ${all.join(" + ")}${u} (total ${fmtN(tot)}${u}) -> one line per module, each priced on its own.`);
      if (m.stated.total !== null && m.stated.total !== m.stated.sum) {
        sumNote = `The modules add up to ${fmtN(m.stated.sum)}${u}, not the ${fmtN(m.stated.total)}${u} the split states. Each module is priced as written: check this is what you meant.`;
      }
    } else if (m.why) {
      // VRF-6 (F8): a pair / set the helper chose before the next size up says so, in the config's words
      notes.push(`${m.readNote ? `${m.readNote}. ` : ""}${m.why} Each unit is its own item below: change, add or remove them.`);
    } else {
      notes.push(`${m.readNote ? `${m.readNote}. ` : ""}${fmtN(m.total)}${u} is bigger than the largest unit (${fmtN(m.top)}${u}), so the helper split it: ${all.join(" + ")}${u} `
        + `(${m.exact ? "fewest units that add up exactly" : "fewest units, the smallest total above"}; the cheapest of the equal splits). `
        + `Each unit is its own item below: change, add or remove them.`);
    }
    // VRF-6 (F8 / Q4): a split into three or more modules carries its own note
    const nMods = all.length;
    if (nMods >= 3 && spec.split?.many_line) notes.push(spec.split.many_line.replace("{n}", String(nMods)));
  }
  const cond = marks.find((m) => m.cond)?.cond;
  const condLine = cond && spec.split?.conditions ? spec.split.conditions.line.replace("{said}", cond) : undefined;
  const changed = edits.items.some((e) => helperLineChanged(e))
    || [...groups.values()].some((g) => g.length < g[0].n)
    || edits.items.length > h.rowN;
  let linesNote: string | undefined;
  if (changed) {
    const fams = new Set(spec.split?.families ?? []);
    let sum = 0;
    edits.items.forEach((_e, i) => {
      const r = (layersBySource.get(i) ?? [])[0];
      if (!r || !r.family || !fams.has(r.family)) return;
      const v = r.readValues?.[h.attr] ?? r.selection?.[h.attr];
      const n = typeof v === "number" ? v : Number(v);
      const q = typeof r.qty === "number" && Number.isFinite(r.qty) ? r.qty : 1;
      if (Number.isFinite(n)) sum += n * q;
    });
    const target = h.stated ? (h.stated.total ?? h.stated.sum) : h.total;
    sum = Math.round(sum * 100) / 100;
    if (sum !== target) linesNote = `The lines add up to ${fmtN(sum)}${u}; the BoQ says ${fmtN(target)}${u}. The row is still priced as you set it: check this is what you meant.`;
  }
  return {
    note: notes.join(" "),
    ...(sumNote ? { sumNote } : {}),
    ...(condLine ? { condition: condLine } : {}),
    ...(changed ? { changed: "You changed the helper's split. The helper will not split this row again: the lines below stay as you set them. The row total is the sum of the lines." } : {}),
    ...(linesNote ? { linesNote } : {}),
    resetLabel: "Reset to the helper's split",
  };
}

/**
 * VRF-5 (owner R1 18:14-18:21). PURE. The model items a unit row folds off: only on a config whose `extras` declares `folded`,
 * only when the row's FIRST entry is a unit (`extras.roles`), and only an untouched MODEL entry after it (the pricer's own item,
 * a changed family or a helper's split line is theirs) whose family is no unit role. Null when nothing folds.
 */
function foldedModelItems(spec: ItemListPricingSpec, edits: ItemListEditState, modelItems: ExtractedListItem[]):
  { kept: ItemEdit[]; points: Array<{ base: number; family: string | null }> } | null {
  const x = spec.extras;
  if (!x?.folded || edits.items.length < 2) return null;
  const fa = familyAttr(spec);
  const famOf = (e: ItemEdit): string | null => {
    if (e.family !== null) return e.family;
    const v = e.base !== null ? modelItems[e.base]?.attributes?.[fa]?.value : null;
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };
  const first = famOf(edits.items[0]);
  if (!first || !x.roles[first]) return null;
  const kept: ItemEdit[] = [edits.items[0]];
  const points: Array<{ base: number; family: string | null }> = [];
  for (const e of edits.items.slice(1)) {
    const fam = famOf(e);
    const untouched = e.base !== null && e.family === null && !e.helper && Object.keys(e.attrs).length === 0 && e.qty === undefined;
    if (untouched && !(fam && x.roles[fam])) points.push({ base: e.base!, family: fam });
    else kept.push(e);
  }
  return points.length ? { kept, points } : null;
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
  const decoded = decodeItemEdits(overrides?.[ITEM_LIST_OVERRIDE_KEY], modelItems.length, probe?.sectionCounts);
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
  // ADP-5a (HN-2, owner 2026-10-22): the headings' NOTES -- read ONLY by the both-streams check and `family_merge`
  const headingNoteText = (ctx.headingNotes ?? []).join(" | ");
  /**
   * ADP-5a (SCOPE-5a-1): `family_merge` -- two items that are ONE item (a spigot and its butterfly damper) become one
   * BEFORE anything prices or shows. The absorbed item leaves the EDIT STATE too, because a block's position is its
   * edit index on the panel: dropping only its view would hand the next block's edits to the wrong item.
   */
  const merge = applyFamilyMerge(spec, assembleItems(decoded, modelItems, familyAttr(spec)), [rowText, ownText, headingNoteText].join(" | "));
  const editsMerged: ItemListEditState = merge ? { ...decoded, items: merge.kept.map((i) => decoded.items[i]) } : decoded;
  // VRF-5 (owner R1 18:14-18:21): on a row whose ITEM 1 is a unit, a further MODEL item of any other family (an accessory the
  // BoQ says the unit's price includes, a "none of these", a family-less item) is folded off the row: never priced as an item,
  // never blocking -- an accessory becomes the unit's own extra line (`withExtras`), anything else a note point
  const folded = foldedModelItems(spec, editsMerged, modelItems);
  const edits: ItemListEditState = folded ? { ...editsMerged, items: folded.kept } : editsMerged;
  if (probe) { probe.edits = edits; if (folded) probe.folded = folded.points; }
  // VRF-3a (Q3): the helper may split only a row none of whose entries came from a split
  const anyHelper = edits.items.some((e) => e.helper);
  const assembled0 = merge && !folded ? merge.items : assembleItems(edits, modelItems, familyAttr(spec));
  const assembled = spec.split && !anyHelper ? assembled0.map((a) => ({ ...a, splitAllowed: true as const })) : assembled0;
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
  /**
   * VRF-5 B2 (the VRF-4 review F6: "an MS stand on a Nos row gets the per-Kg rate (00350 r135, 00397 r172); the panel refuses
   * correctly") -- ON A CONFIG WITH `extras` (VRF) a unit the pricer PICKED that is a unit of this category stays, even once the
   * items chosen are not stocked in it: the item then refuses with the panel's own sentence ("MS Angle Base Frame Structure is
   * not stocked per Nos (stocked per Kg)") instead of being priced silently per Kg. The pick stays in the list, so the screen
   * shows the unit the row is priced in. Every other config keeps 12c-S's rule (a pick no longer offered is not honoured).
   */
  const keepPick = unitPickable && !!spec.extras && picked !== undefined && picked !== "" && !unitChoices.includes(picked) && unitClassOf(spec, picked) !== null;
  if (keepPick) unitChoices.push(picked!);
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
      // ADP-3a (U2): the outer-size box is read by the second key as WIDTH x HEIGHT; matching its words to one stocked
      // width would hand the second key a single number -- it was never matched here and is not now
      if (f.secondKey) continue;
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
      // VRF-2b (R-CONV): a unit-converting reader reads the stated text in its unit and converts it to the family's
      // ("12 TR" on an HP family is 15 HP -- no option, so the ladder shows 16; never the option "12")
      const rdU = spec.numbers[f.skuAttr];
      const readStated = rdU?.units
        ? (t: string) => readCapacity(t, rdU, { familyUnit: familyUnitOf(spec, items, fam, rdU), factorOf: (id) => pricingInputFactor(items, id), family: fam })
        : undefined;
      const hit = matchStatedToOptionDetailed(raw, opts, rdU, readStated);
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
   * VRF-3a K2 (owner SET 17:00 / 17:37 / 17:39 / 18:49; QR-1 (a)) -- A COUNTED ITEM ON A PER-SET ROW. A refnet on a Set row
   * holds as many pieces as the system's unit counts and the BoQ quantity say (`countedPieces`); the pieces become the
   * item's quantity per row unit. A count or the quantity missing, or a quantity that fits no reading, gives no pieces:
   * the quantity goes blank and the item refuses, so the row is withheld. A quantity the pricer TYPED wins outright.
   */
  const perSetRow = isPerSetUnit(spec, unit);
  const counted = perSetRow ? spec.per_set?.counted : undefined;
  const rowQtyText = calculator ? (overrides?.[ROW_QTY_OVERRIDE_KEY] ?? "") : "";
  const rowQty = calculator
    ? (rowQtyText.trim() === "" ? null : Number(rowQtyText.trim()))
    : (typeof ctx.quantity === "number" ? ctx.quantity : null);
  const countedByBlock = new Map<number, CountedPieces & { typed: boolean }>();
  if (counted) {
    forDisplay.forEach((a, i) => {
      const famV = a.attributes[familyAttr(spec)]?.value;
      if (typeof famV !== "string" || !counted.families.includes(famV)) return;
      const e = edits.items[i];
      // the three answers as the item carries them -- typed by the pricer or read from the row (a model item's attributes)
      const said = (id: string) => { const v = a.attributes[id]?.value; return v === null || v === undefined ? undefined : String(v); };
      const answers = Object.fromEntries([counted.covers.id, ...counted.counts.map((c) => c.id)].map((id) => [id, said(id)]));
      // VRF-4 (q2): a count the row did not answer is added up from the sheet (a typed count -- even blank -- stays the pricer's)
      for (const c of counted.counts) {
        const sheet = ctx.sheetUnits?.[c.side];
        if (answers[c.id] === undefined && sheet && sheet.rows.length) answers[c.id] = String(sheet.n);
      }
      const rc = countedPieces(counted, answers, rowQty);
      const typed = e?.qty !== undefined;
      countedByBlock.set(i, { ...rc, typed });
      if (!typed) forPricing[i] = { ...forPricing[i], qtyPerRowUnit: rc.pieces !== null ? String(rc.pieces) : "" };
    });
  }
  // the row's texts are built above, where `family_merge` first reads them
  // ADP-5d (HN-3): the headings themselves too, so a rule can read the heading directly above the row on its own
  const priced = priceItemList(spec, items, unit, forPricing, rowText, ownText, ctx.pipeOdHint, headingNoteText, ctx.headings ?? []);
  /**
   * VRF-3a (owner R-SPLIT (a) / (b), D-1, SHAPE Q3) -- THE HELPER'S SPLIT, AT THE SEAM. An item the pricer asked to split
   * (above the largest of its resolved variant, or a split the row writes) is replaced by one REAL entry per line, each
   * carrying the hidden tag, and the row is computed again from that edit state -- which is what `editState` returns,
   * so the panel's next operation applies to the lines. The second pass carries the tags, so it never splits again.
   */
  if (spec.split && !anyHelper) {
    const splits = new Map<number, NonNullable<ItemPriceResult["splitInto"]>>();
    priced.items.forEach((p, idx) => { if (p.splitInto) splits.set(typeof p.sourceIndex === "number" ? p.sourceIndex : idx, p.splitInto); });
    if (splits.size) {
      const next = splitEdits(spec, edits, splits, modelItems, [rowText, ownText].join(" | "));
      return computeItemListOwn(category, spec, items, ctx, ext, inRun, { ...(overrides ?? {}), [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(next) }, probe);
    }
  }
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
        // ADP-3a (U2): the outer-size box ADP-3a SHOWS is a text box holding the BoQ's words -- it can always show
        // them, and its stocked widths are not its options; it was never in this check and stays out of it
        if (f.secondKey) continue;
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
    // ADP-3a (B6 #7): the field as a person reads it, without the model's "(as written)"
    ? `${plainFieldLabel(unshowable[0].label)}: ${unshowable[0].value} is not one of the options - choose one`
    : undefined;
  const unshowableByBlock = new Map<number, { field: string; reason: string }>();
  for (const u2 of unshowable) {
    if (!unshowableByBlock.has(u2.block)) {
      unshowableByBlock.set(u2.block, { field: u2.field, reason: `${plainFieldLabel(u2.label)}: ${u2.value} is not one of the options - choose one` });
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
  // VRF-3a K2 (U5): a counted item shows its three fields, the formula and the case; withheld, its box is blank and its
  // refusal is the case's sentence
  if (counted) {
    countedByBlock.forEach((rc, i) => {
      const b = blocks[i];
      if (!b) return;
      const e = edits.items[i];
      const said = (id: string) => { const v = forDisplay[i]?.attributes[id]?.value; return v === null || v === undefined ? "" : String(v); };
      // VRF-3b (U8): a count the pricer typed carries its undo arrow
      const edited = (id: string) => (e && Object.prototype.hasOwnProperty.call(e.attrs, id) ? { edited: true as const } : {});
      // VRF-4 (q2, U5): a count added up from the sheet shows that count, with the rows it came from as its note
      const fs = counted.from_sheet;
      const fromSheetOf = (c: CountedSpec["counts"][number]) => {
        const sheet = ctx.sheetUnits?.[c.side];
        if (!fs || !sheet || forDisplay[i]?.attributes[c.id]?.value !== undefined && forDisplay[i]?.attributes[c.id]?.value !== null) return null;
        const rows = sheet.rows.map((r) => `row ${r.row}${r.units > 1 ? ` (${r.units} units)` : ""} x ${r.qty === null ? "no qty" : fmtN(r.qty)}`).join(", ");
        return { value: sheet.rows.length ? String(sheet.n) : "", note: (sheet.rows.length ? fs.line : fs.none).replace("{n}", String(sheet.n)).replace("{word}", c.word).replace("{rows}", rows) };
      };
      const fields = [
        { id: counted.covers.id, label: counted.covers.label, ...(counted.covers.note ? { note: counted.covers.note } : {}), options: counted.covers.options.map((o) => o.value), value: said(counted.covers.id), ...edited(counted.covers.id) },
        ...counted.counts.map((c) => {
          const sheet = fromSheetOf(c);
          return sheet
            ? { id: c.id, label: c.label, note: sheet.note, value: sheet.value, fromSheet: true as const }
            : { id: c.id, label: c.label, ...(c.note ? { note: c.note } : {}), value: said(c.id), ...edited(c.id) };
        }),
      ];
      const sentence = rc.typed ? counted.lines.typed.replace("{p}", String(e?.qty ?? "")) : rc.sentence;
      blocks[i] = {
        ...b,
        setCount: { fields, ...(rc.formula ? { formula: rc.formula } : {}), sentence, pieces: rc.typed ? null : rc.pieces, typed: rc.typed },
        ...(!rc.typed ? { qty: rc.pieces !== null ? String(rc.pieces) : "", qtyDefaulted: false } : {}),
        ...(!rc.typed && rc.pieces === null ? { reason: sentence } : {}),
      };
    });
  }
  // VRF-3a K2 (U5): a row withheld because a refnet's pieces are not worked out says WHY (the case's sentence), not the
  // pricer's generic "quantity per row unit is blank" that the blank pieces produced
  const countedReason = priced.reason === "quantity per row unit is blank"
    ? [...countedByBlock.values()].find((rc) => !rc.typed && rc.pieces === null)?.sentence
    : undefined;
  const rowReason = countedReason ?? priced.reason;
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
  else if (rowReason) derivation.push(rowReason);
  const splitView = anyHelper ? splitViewOf(spec, edits, layersBySource) : undefined;
  // VRF-3a K2 (U4 / U5 / U6): the bold bar, the ringed unit line, the quantity label and the calculator's quantity field
  const unitBar = ((): ItemListView["unitBar"] => {
    if (isLotUnit(spec, unit) && spec.lot_units) {
      // VRF-5 (owner wording): a unit with its own bar title ("per HP") says so; every other lot unit keeps the one bar
      const own = Object.entries(spec.lot_units.bar_by_unit ?? {}).find(([u]) => u.trim().toLowerCase() === unit.trim().toLowerCase())?.[1];
      return { tone: "red", title: own ?? spec.lot_units.bar, lines: [spec.lot_units.line.replace("{unit}", unit.trim())] };
    }
    if (!perSetRow || !spec.per_set) return undefined;
    const qtyShown = rowQty !== null && Number.isFinite(rowQty) ? String(rowQty) : "-";
    const ring = `Unit ${unit.trim()} \u00b7 Qty ${qtyShown}`;
    const others = blocks.filter((b, i) => !countedByBlock.has(i) && b.family);
    const setLine = spec.per_set.bar.line.replace("{item}", others[0]?.family ?? blocks[0]?.family ?? "piece");
    if (countedByBlock.size && counted) {
      const withheld = [...countedByBlock.values()].some((rc) => !rc.typed && rc.pieces === null);
      const lines = [...countedByBlock.entries()].flatMap(([i]) => (blocks[i]?.setCount ? [blocks[i].setCount!.sentence] : []));
      return { tone: withheld ? "red" : "orange", title: counted.bar, lines: [...new Set(lines)].concat(others.length ? [setLine] : []), ring };
    }
    return { tone: "orange", title: spec.per_set.bar.title, lines: [setLine], ring };
  })();
  // VRF-4 (R-WS, D-5 "option D", D-9): the model's copied working + standby words raise the red bar -- ONLY words matching the
  // config's list (never a standby-only or heading-only mention); the price stays ONE unit
  const standbyBar = ((): ItemListView["standbyBar"] => {
    const ws = spec.working_standby;
    if (!ws) return undefined;
    const said = [...new Set(forDisplay.map((a) => workingStandbyWords(ws, a.attributes[ws.attr]?.value)).filter((w): w is string => w !== null))];
    if (!said.length) return undefined;
    const qtyShown = rowQty !== null && Number.isFinite(rowQty) ? fmtN(rowQty) : "-";
    return {
      title: ws.bar.title,
      lines: said.map((w) => ws.bar.line.replace("{said}", w).replace("{qty}", qtyShown)),
      ring: `Unit ${unit.trim() || "-"} · Qty ${qtyShown}`,
    };
  })();
  const view: ItemListView = {
    ...(splitView ? { split: splitView } : {}),
    ...(standbyBar ? { standbyBar } : {}),
    ...(unitBar ? { unitBar } : {}),
    ...(perSetRow && spec.per_set ? { qtyLabel: spec.per_set.qty_label } : {}),
    ...(calculator && counted && countedByBlock.size ? { rowQtyField: { label: "BoQ quantity of this row", value: rowQtyText } } : {}),
    unit, unitClass, unitPickable, unitChoices, rowPriced, ...((unshowableReason ?? rowReason) ? { reason: unshowableReason ?? rowReason } : {}),
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
  // ADP-1: a `typed_only` number has no definition -- its own label names it ("piece length not mentioned -> 1 ...")
  for (const [id, rd] of Object.entries(spec.numbers)) if (rd.typed_only && rd.label && !(id in fieldLabels)) fieldLabels[id] = rd.label;
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
    itemList: plainItemListView(view, say, spec),
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// VRF-3b (owner O-5 / O-6 / B / SHEETS 2026-11-03; 2026-11-05 11:30-14:56, boards 12-15) -- THE EXTRAS A UNIT'S PRICE
// INCLUDES. Copper (supply + return), insulation on each copper line, power cable and communication cable, as OWN LINES
// under each indoor / outdoor unit (each split module its own unit), PER NOS of the row (11:56 "per unit only...qty has no
// bearing"). Each line is priced by ITS OWN category's rules -- Piping and Insulation through `computeItemListOwn` (the
// path their own rows and calculator tabs take), the cable through Electrical's own compute, read only -- at a size
// banded on the unit's capacity, from the Pricing Inputs defaults (12:07 live-linked). Per Nos = length x the per-metre
// BoQ rate, rounded up, x "How many in one Nos". A config without `extras` never reaches this.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

/** VRF-3b: Electrical's own per-metre cable rate for one spec (the helper's compute on that category), or why not. */
export type CableRate = (category: string, attrs: Record<string, string>, unit?: string) => { supply: number; install: number } | { reason: string };

const EXTRA_LINE_ORDER: ExtraLineId[] = ["copper_supply", "copper_return", "ins_supply", "ins_return", "power", "comm"];

/** PURE. The include ids ticked, from the calculator's override (or, on a BoQ row, the model's flags -- VRF-4). */
export function extrasIncludesOf(raw: string | undefined | null): Set<ExtraIncludeId> {
  const ok = new Set<string>(["copper", "insulation", "power", "comm"]);
  return new Set(String(raw ?? "").split(",").map((s) => s.trim()).filter((s) => ok.has(s)) as ExtraIncludeId[]);
}

function fmtMm(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
}

function withExtras(
  spec: ItemListPricingSpec,
  items: RateMasterItem[],
  ctx: RowContextWithUnit,
  ext: ExtractionRowWithItems | undefined,
  overrides: Record<string, string> | undefined,
  configOf: ConfigOf,
  cableRate: CableRate | undefined,
  own: ItemListSuggestion,
  probe: OwnPassProbe,
  /** VRF-5 (owner R1): the row's own category -- a VRF accessory line is priced by VRF's own rules */
  category?: RateCategoryConfig,
): ItemListSuggestion {
  const x: ExtrasSpec = spec.extras!;
  const view = own.itemList!;
  const L = x.lines;
  const calculator = view.unitPickable || ctx.noRow === true;
  // the flags: the calculator's tick boxes; a BoQ row's from the model -- VRF-4 (owner "q1 ok"): PER ITEM, the model item's own
  // includes_* answers (`x.from_model`; a split module reads its source item's); without `from_model` the row's `includes` cell
  const modelFlags = ext?.attributes?.includes?.value;
  const on = extrasIncludesOf(calculator ? overrides?.[EXTRAS_INCLUDES_KEY] : (typeof modelFlags === "string" ? modelFlags : undefined));
  const edits0 = probe.edits ?? view.editState;
  const modelItems0 = ext?.items ?? [];
  const perItem = !calculator && !!x.from_model;
  const boqOf = (i: number) => {
    const e = edits0.items[i];
    return boqExtrasOf(e && e.base !== null ? modelItems0[e.base] : undefined, x.from_model);
  };
  const onFor = (i: number): Set<ExtraIncludeId> => (perItem ? boqOf(i).includes : on);
  const incSpec = new Map(x.includes.map((i) => [i.id, i]));
  const activeIn = (set: Set<ExtraIncludeId>, id: ExtraIncludeId) => set.has(id) && (!incSpec.get(id)?.needs || set.has(incSpec.get(id)!.needs!));
  const active = (id: ExtraIncludeId) => activeIn(on, id);
  // VRF-5 (owner R1): the accessories -- the calculator's tick boxes beside the four; on a BoQ row the model's per-item answers,
  // plus an accessory the model listed as an item of its own on the unit row (folded off it: every unit of its role carries it)
  const accs = x.accessories ?? [];
  const sg = x.safeguard;
  const onAcc = new Set<string>(calculator ? String(overrides?.[EXTRAS_INCLUDES_KEY] ?? "").split(",").map((t) => t.trim()).filter((t) => accs.some((a) => a.id === t)) : []);
  const inclOf = (i: number) => {
    const e = edits0.items[i];
    return boqInclusionsOf(e && e.base !== null ? modelItems0[e.base] : undefined, x.from_model, sg);
  };
  const foldedPts = probe.folded ?? [];
  const foldedAcc = new Set<string>(foldedPts.map((p) => accs.find((a) => a.family && a.family === p.family)?.id).filter((t): t is string => !!t));
  const accOnFor = (i: number): Set<string> => (perItem ? new Set([...inclOf(i).accessories, ...foldedAcc]) : onAcc);
  const includesView: ItemListView["extrasIncludes"] = calculator
    ? { title: L.includes_title, options: [...x.includes.map((i) => {
        const blocked = !!i.needs && !on.has(i.needs);
        return { id: i.id, label: i.label, checked: on.has(i.id) && !blocked, ...(blocked ? { disabled: true, note: i.needs_line } : {}) };
      }), ...accs.map((a) => ({ id: a.id as ExtraIncludeId, label: a.label, checked: onAcc.has(a.id) }))] }
    : undefined;
  const rowClassOk = !isLotUnit(spec, view.unit) && view.unitClass === x.row_class;
  const anyAcc = view.items.some((b, i) => !!b.family && !!x.roles[b.family] && accs.some((a) => a.roles.includes(x.roles[b.family!]) && accOnFor(i).has(a.id)));
  const anyOn = (perItem ? view.items.some((_b, i) => [...onFor(i)].some((id) => activeIn(onFor(i), id))) : [...on].some((id) => active(id)))
    || anyAcc || (perItem && foldedPts.length > 0)
    // VRF-6 (F3): an accessory read as included on ANY entry (a unit of the other role, or no unit) is said -- so the row is walked
    || (!!sg?.lines.not_added && (perItem ? view.items.some((_b, i) => inclOf(i).accessories.size > 0) : onAcc.size > 0))
    // VRF-6 (owner Q-pre 11): "control wiring" in a heading includes the communication cable even when the model read no include
    || (perItem && !!sg?.control_wiring && (() => { try { return new RegExp(sg.control_wiring!.words, "i").test([...(ctx.headings ?? []), ...(ctx.headingNotes ?? [])].join(" | ")); } catch { return false; } })());
  if (!anyOn || !rowClassOk || view.items.length === 0) {
    return withScope(spec, items, ctx, ext, overrides, includesView ? { ...own, itemList: { ...view, extrasIncludes: includesView } } : own, probe);
  }

  const edits = probe.edits ?? view.editState;
  const layers = probe.layers ?? new Map<number, ItemPriceResult[]>();
  const modelItems = ext?.items ?? [];
  const reader = spec.numbers.capacity;
  const convert = reader?.units;
  const factorOf = (id: string) => pricingInputFactor(items, id);
  /** a capacity in `from` -> `to`, through the reader's base unit and its Pricing Input factors */
  const convertUnit = (v: number, from: string | null, to: string): number | null => {
    if (!from || from === to) return v;
    if (!convert) return null;
    const toBase = (val: number, u: string) => (u === convert.base ? val : (convert.convert?.[u] ? (factorOf(convert.convert[u].input) ? val / factorOf(convert.convert[u].input)! : null) : null));
    const fromBase = (val: number, u: string) => (u === convert.base ? val : (convert.convert?.[u] ? (factorOf(convert.convert[u].input) ? val * factorOf(convert.convert[u].input)! : null) : null));
    const b = toBase(v, from);
    return b === null ? null : fromBase(b, to);
  };

  // the targets' stocked sizes -- what a typed or rough size snaps to (13:46 "closest"; 13:53 "show the one used")
  const pcfg = configOf(x.copper.category);
  const pspec = pcfg ? itemListPricingSpec(pcfg) : null;
  const icfg = configOf(x.insulation.category);
  const ispec = icfg ? itemListPricingSpec(icfg) : null;
  const numsOf = (vals: unknown[]) => [...new Set(vals.map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  // VRF-3b K1b (owner ANSWER 2: "every value stocked in its own catalogue"): each line's choices, read off the live catalogue
  const pipeFamilies = pspec ? Object.keys(pspec.families).filter((f) => items.some((it) => kindIn(pspec, it.kind) && it.attributes?.[familyAttr(pspec)] === f
    && Number.isFinite(Number(it.attributes?.[x.copper.size_attr])))) : [];
  const pipeSizesOf = (fam: string) => (pspec ? numsOf(items.filter((it) => kindIn(pspec, it.kind) && it.attributes?.[familyAttr(pspec)] === fam).map((it) => it.attributes?.[x.copper.size_attr])) : []);
  const insPipeSkus = ispec ? items.filter((it) => kindIn(ispec, it.kind) && Number.isFinite(Number(it.attributes?.[x.insulation.size_attr])) && it.attributes?.[x.insulation.size_attr] !== null) : [];
  const insFamilies = ispec ? Object.keys(ispec.families).filter((f) => insPipeSkus.some((it) => it.attributes?.[familyAttr(ispec)] === f)) : [];
  const insOf = (fam: string, where: Record<string, string | number> = {}) => insPipeSkus.filter((it) => it.attributes?.[familyAttr(ispec!)] === fam
    && Object.entries(where).every(([k, v]) => String(it.attributes?.[k]) === String(v)));
  const strsOf = (vals: unknown[]) => [...new Set(vals.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").map(String))];
  const cableSkus = items.filter((it) => String(it.kind) === "cable");
  const cableOf = (where: Record<string, string | number>) => cableSkus.filter((it) => Object.entries(where).every(([k, v]) => String(it.attributes?.[k]) === String(v)));

  // ONE per-metre rate per target + stated values, each from its own category's path (cached: a split row asks twice)
  const cache = new Map<string, { supply: number; install: number } | { reason: string }>();
  const lineCtx = (category: string, pipeOd?: boolean): RowContextWithUnit => ({
    excelRow: ctx.excelRow, description: "", nodeType: ctx.nodeType, category, discipline: ctx.discipline, rateKinds: ctx.rateKinds, unit: "mts", noRow: true,
    ...(pipeOd !== undefined ? { pipeOdHint: pipeOd } : {}),
  } as RowContextWithUnit);
  type LineCall = { rate: { supply: number; install: number } | { reason: string }; attrs?: Record<string, string>; notes?: Record<string, string>; size?: string; note?: string; read?: string };
  const lineCache = new Map<string, LineCall>();
  /**
   * VRF-4 B2 (owner BORROWED 22:18 "option a" + "any field which is borrowd from other categories als gets their respective
   * rules"; R5 (c)) -- ONE line priced per metre through the target category's OWN path. The values go in AS STATED: a typed or
   * default value as the pricer would type it ("Other..."), the BoQ's words as the model's item ("BoQ says ..."), a size taken
   * from the copper line MIRRORED (the Piping -> Insulation section precedent). The target's own reader, ladder, notes and
   * refusals apply; nothing is resolved here. Read back: the rate or the refusal, the value each stated attribute PRICED AS
   * (several layers joined "13 + 19"), its field note, and the number the target READ (what a section mirrors).
   */
  const lineCall = (cfg: RateCategoryConfig | null, dspec: ItemListPricingSpec | null, label: string, family: string,
                    attrs: Record<string, string>, fromBoq: boolean, mirrorId?: string): LineCall => {
    const key = `${cfg?.category_id}|${family}|${fromBoq}|${mirrorId ?? ""}|${JSON.stringify(attrs)}`;
    const hit = lineCache.get(key);
    if (hit) return hit;
    let out: LineCall;
    if (!cfg || !dspec) out = { rate: { reason: L.not_loaded.replace("{rules}", label) } };
    else {
      const famAttr = familyAttr(dspec);
      const fid = (a: string) => dspec.numbers[a]?.from?.[0] ?? a;
      const typedAttrs: Record<string, string> = {};
      const boqAttrs: Record<string, string> = {};
      for (const [a, v] of Object.entries(attrs)) {
        if (fromBoq && dspec.numbers[a] && a !== mirrorId) boqAttrs[fid(a)] = v;
        else typedAttrs[fid(a)] = v;
      }
      const other = Object.keys(attrs).filter((a) => dspec.numbers[a] && fid(a) in typedAttrs).map(fid);
      const mirrored = mirrorId ? [fid(mirrorId)] : [];
      const modelItem: ExtractedListItem | undefined = fromBoq
        ? { attributes: Object.fromEntries([[famAttr, family], ...Object.entries(boqAttrs)].map(([k, v]) => [k, { value: v, confidence: 1 }])) }
        : undefined;
      const edit: ItemEdit = modelItem
        ? { base: 0, family: null, attrs: typedAttrs, ...(other.length ? { other } : {}), ...(mirrored.length ? { mirrored } : {}) }
        : { base: null, family, attrs: typedAttrs, ...(other.length ? { other } : {}), ...(mirrored.length ? { mirrored } : {}) };
      const dext = modelItem ? ({ excelRow: ctx.excelRow, description: "", attributes: {}, items: [modelItem] } as ExtractionRowWithItems) : undefined;
      const lp: OwnPassProbe = {};
      const r = computeItemListOwn(cfg, dspec, items, lineCtx(cfg.category_id, mirrorId ? true : undefined), dext, !!dext,
                                   { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [edit] }) }, lp) as ItemListSuggestion;
      const v = r.itemList;
      const b = v?.items?.[0];
      const layersOf = lp.layers?.get(0) ?? [];
      const res = layersOf[0];
      const rate = v?.rowPriced && typeof v.totals?.supply_rate === "number" && typeof v.totals?.install_rate === "number"
        ? { supply: v.totals.supply_rate, install: v.totals.install_rate }
        : { reason: v?.reason ?? b?.reason ?? L.not_priced };
      const pricedAs: Record<string, string> = {};
      const notes: Record<string, string> = {};
      for (const a of Object.keys(attrs)) {
        const vals = layersOf.map((l) => l.selection?.[a]).filter((x) => x !== undefined && x !== null && String(x) !== "").map((x) => (typeof x === "number" ? fmtMm(x) : String(x)));
        if (vals.length) pricedAs[a] = [...new Set(vals)].length === 1 && vals.length === 1 ? vals[0] : vals.join(" + ");
        const n = b?.fields?.find((f) => f.id === fid(a))?.note;
        if (n) notes[a] = n;
      }
      const sizeAttr = Object.keys(attrs).find((a) => dspec.numbers[a] && a !== mirrorId);
      out = {
        rate, attrs: pricedAs, notes,
        ...(sizeAttr && pricedAs[sizeAttr] !== undefined && "supply" in rate ? { size: pricedAs[sizeAttr] } : {}),
        ...(sizeAttr && notes[sizeAttr] ? { note: notes[sizeAttr] } : {}),
        ...(sizeAttr ? { read: mirroredNumber(res, sizeAttr) } : {}),
      };
    }
    lineCache.set(key, out);
    return out;
  };

  const titleOf = (id: ExtraLineId) => L[`title_${id}`] ?? id;
  const fromOf = (id: ExtraLineId) => (id.startsWith("copper") ? L.from_copper : id.startsWith("ins") ? L.from_insulation : L.from_cable);
  const tagText = (t: ExtraFieldView["tag"]) => (t === "default" ? L.tag_default : t === "picked" ? L.tag_picked : t === "boq" ? L.tag_boq : t === "follows" ? L.tag_follows : undefined);
  const num = (s: string | undefined) => (s === undefined || s.trim() === "" ? null : Number(s.trim()));

  // VRF-5 (owner R1 SAFEGUARD, P0 (b)): an inclusion the ROW's own text states is added; one a heading / note states is added
  // UNLESS the BoQ quotes that item on a row of its own (`ownRowQuotes`), and either way the row says "please review"
  const unitFams = new Set(Object.keys(x.roles));
  const sheetLines = ctx.sheetLines ?? [];
  // VRF-6 (F4, owner Q-pre 10): category first -- the own-row rule reads each sheet row's category (and, on a row of this
  // category, its item-1 family); words only for an uncategorised row
  const catFirst = sg?.match === "category";
  const quotesOf = (id: string) => ownRowQuotes(sg?.own_row[id], sheetLines, ctx.excelRow, unitFams,
    catFirst ? { categoryFirst: true, askingCategory: ctx.category ?? null } : undefined);
  const rowsText = (quotes: Array<{ row: number; sheet?: string }>) => quotes.slice(0, 4).map((q) => `${q.sheet ? `${q.sheet} ` : ""}row ${q.row}`).join(", ")
    + (quotes.length > 4 ? ` and ${quotes.length - 4} more` : "");
  const whereOf = (i: number, id: string) => {
    const inc = inclOf(i);
    const where = (inc.where[id] ?? "").trim();
    const whereWord = where !== "" ? where.toLowerCase() : (sg?.lines.where_unknown ?? "a heading or note");
    const wording = inc.wording[id] ? (sg?.lines.wording ?? " ({wording})").replace("{wording}", inc.wording[id].toLowerCase()) : "";
    return { where, whereWord, wording };
  };
  const decide = (i: number, id: string, label: string): { add: boolean; point?: string; extra?: string } => {
    if (!perItem || !sg) return { add: true };
    const { where, whereWord, wording } = whereOf(i, id);
    if (where !== "" && where.toLowerCase() === sg.row_value.toLowerCase()) return { add: true };
    const quotes = quotesOf(id);
    if (quotes.length) {
      return { add: false, point: sg.lines.excluded.replace("{label}", label).replace("{where}", whereWord).replace("{wording}", wording).replace("{rows}", rowsText(quotes)) };
    }
    // VRF-6 (owner Q-pre 13, soft guidance): copper added from a heading / note says the sheet usually quotes it separately
    const extra = id === "copper" && sg.lines.copper_usual ? sg.lines.copper_usual : undefined;
    return { add: true, point: sg.lines.added.replace("{label}", label).replace("{where}", whereWord).replace("{wording}", wording), ...(extra ? { extra } : {}) };
  };
  /** VRF-6 (F3): an include the model read that this unit cannot carry -- the reason, and the rows that quote it on their own */
  const notCarried = (i: number, id: string, label: string, why: string): string => {
    const { whereWord, wording } = whereOf(i, id);
    const quotes = sg && perItem ? quotesOf(id) : [];
    const own = quotes.length && sg?.lines.also_own_row ? sg.lines.also_own_row.replace("{rows}", rowsText(quotes)) : "";
    return (sg?.lines.not_added ?? "{label}: stated in {where}{wording} - NOT added: {why}").replace("{label}", label)
      .replace("{where}", perItem ? whereWord : (sg?.lines.where_calculator ?? "your tick")).replace("{wording}", perItem ? wording : "").replace("{why}", why) + own;
  };
  // VRF-5 (owner R1, ANSWER 4): ONE accessory line on one unit -- quantity (typed / the BoQ's / the default by band), the per-unit
  // rate by the item's own rules, figures = quantity x rate, each rounded up to the rupee. Optional: never blocks the row.
  const remoteWords = [ctx.description ?? "", ...(ctx.headings ?? [])].join(" | ");
  // VRF-6 (F1): the row's own notes and its headings' notes join the words a choice reads
  const allWords = [ctx.description ?? "", ...(ctx.ownNotes ?? []), ...(ctx.headings ?? []), ...(ctx.headingNotes ?? [])].join(" | ");
  const reTest = (w: string | undefined, text: string) => { if (!w) return false; try { return new RegExp(w, "i").test(text); } catch { return false; } };
  const accessoryLine = (acc: AccessorySpec, lineId: ExtraLineId, i: number, role: "indoor" | "outdoor", bandValue: number | null,
                         typed: Record<string, string>, boqQty: string | undefined,
                         /** VRF-6: the unit's priced size in its band unit, its brand and its model item */
                         unit: { size: number | null; brand: string | null; model?: ExtractedListItem }): ExtraLineView => {
    lineNo++;
    const heading = `Item ${lineNo} · ${L.heading_tail} · ${acc.electrical ? `from ${acc.electrical.label}` : (L.acc_from ?? "from VRF")}`;
    const band = acc.bands ? extraBandOf(acc.bands[role] ?? [], bandValue) : null;
    const bandRates = band ? pricingInputRates(items, band.input) : null;
    const pos = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);
    const working: string[] = [];
    // VRF-6 (team rule "gas kg = HP of ODU"): the default quantity is the unit's priced size x the Pricing Input's factor
    const perSize = acc.qty_per_size ? pos(pricingInputFactor(items, acc.qty_per_size.input)) : null;
    const qSized = acc.qty_per_size && perSize !== null && unit.size !== null ? Math.round(unit.size * perSize * 100) / 100 : null;
    const qDefault = acc.electrical ? 1 : acc.qty_per_size ? qSized : (acc.input ? pos(pricingInputFactor(items, acc.input)) : pos(bandRates?.qty));
    const qBoq = readQtyWords(boqQty);
    const q = typed.qty !== undefined ? { raw: typed.qty, tag: "picked" as const } : qBoq !== null ? { raw: fmtMm(qBoq), tag: "boq" as const }
      : { raw: qDefault !== null ? fmtMm(qDefault) : "", tag: qDefault !== null ? ("default" as const) : undefined };
    if (q.tag === "default" && acc.qty_per_size && qSized !== null && unit.size !== null) {
      working.push(acc.qty_per_size.line.replace("{size}", fmtMm(unit.size)).replace("{qty}", fmtMm(qSized)).replace("{unit}", acc.unit_word));
    }
    const qty = num(q.raw);
    let what = acc.title;
    let choiceTag: ExtraFieldView["tag"];
    let rate: { supply: number; install: number } | { reason: string } | null = null;
    let reason: string | undefined;
    const el = acc.electrical;
    if (el && el.match && el.schedule) {
      // VRF-6 (team rule 2026-11-09): the rating by the unit's HP from the schedule, the item found in Electrical's catalogue by
      // its attributes (the smallest stocked rating at or above it, noted when it steps up), priced by Electrical's own rules
      const row = unit.size === null ? null : (el.schedule.find((s) => unit.size! <= s.max + 1e-9) ?? el.schedule[el.schedule.length - 1]);
      const want = row ? pos(pricingInputFactor(items, row.input)) : null;
      if (want === null) reason = (L.acc_default_needed ?? "default needed - set it in Pricing Inputs");
      else {
        const m = el.match;
        const cands = items.filter((it) => it.discipline === el.discipline && (!m.kind || it.kind === m.kind)
          && Object.entries(m.attrs).every(([k, v]) => String(it.attributes?.[k] ?? "") === v)
          && (!m.name_words || reTest(m.name_words, String(it.attributes?.item ?? "")))
          && Number.isFinite(Number(it.attributes?.[m.rating_attr])))
          .sort((a, b) => Number(a.attributes?.[m.rating_attr]) - Number(b.attributes?.[m.rating_attr]));
        const got = cands.find((it) => Number(it.attributes?.[m.rating_attr]) >= want - 1e-9);
        if (!got) reason = `${acc.title}: no ${fmtMm(want)} A or larger is stocked - price this line by hand`;
        else {
          what = String(got.attributes?.item ?? acc.title);
          const g = Number(got.attributes?.[m.rating_attr]);
          if (g > want + 1e-9) working.push(m.step_up_line.replace("{want}", fmtMm(want)).replace("{got}", fmtMm(g)).replace("{item}", what));
          if (el.alias && reTest(el.alias.words, allWords)) working.push(el.alias.line.replace("{item}", what));
          rate = cableRate ? cableRate(el.category, { ...(el.fill ?? {}), [el.item_attr]: what, [el.qty_attr]: "1" }, "Nos")
            : { reason: L.not_loaded.replace("{rules}", el.label) };
        }
      }
    } else if (el) {
      const amp = pos(bandRates?.[el.rating_key ?? "amp"]);
      if (amp === null) reason = (L.acc_default_needed ?? "default needed - set it in Pricing Inputs");
      else {
        what = (el.template ?? "").replace("{amp}", fmtMm(amp));
        // VRF-5 (owner ANSWER 6): an isolator the BoQ names prices as the default MCCB, said in the working
        const alias = el.alias;
        if (alias) { try { if (new RegExp(alias.words, "i").test(remoteWords)) working.push(alias.line.replace("{item}", what)); } catch { /* a bad pattern never fires */ } }
        rate = cableRate ? cableRate(el.category, { ...(el.fill ?? {}), [el.item_attr]: what, [el.qty_attr]: "1" }, "Nos")
          : { reason: L.not_loaded.replace("{rules}", el.label) };
      }
    } else if (acc.family && category) {
      const fa = familyAttr(spec);
      const sku = items.find((it) => kindIn(spec, it.kind) && it.attributes?.[fa] === acc.family);
      const unitWord = String(sku?.unit ?? acc.unit_word);
      const attrs: Record<string, string> = {};
      if (acc.choice) {
        const c = acc.choice;
        const words = c.read_notes ? allWords : remoteWords;
        const options = [c.default, ...Object.keys(c.words)];
        // VRF-6 (F1, owner Q-pre 1): typed > the words that decide first ("corded or cordless" -> Cordless) > the model's own answer >
        // the plain words ("corded" / "wired" -> Wired) > the default (Cordless, tagged). The default never overrides the model.
        const first = Object.entries(c.first_words ?? {}).find(([, w]) => reTest(w, words));
        const mv = c.model_attr ? unit.model?.attributes?.[c.model_attr]?.value : undefined;
        const modelSaid = typeof mv === "string" && options.includes(mv.trim()) ? mv.trim() : null;
        const hit = Object.entries(c.words).find(([, w]) => reTest(w, words));
        const said = first ? first[0] : modelSaid ?? (hit ? hit[0] : null);
        attrs[c.attr] = typed[c.attr] ?? said ?? c.default;
        choiceTag = typed[c.attr] !== undefined ? "picked" : said !== null ? "boq" : "default";
        what = `${attrs[c.attr]} ${acc.title}`;
      }
      const priceAt = (a: Record<string, string>) => {
        const r = computeItemListOwn(category, spec, items, { ...lineCtx(category.category_id), unit: unitWord } as RowContextWithUnit, undefined, false,
          { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: acc.family, attrs: a }] }) }) as ItemListSuggestion;
        const v = r.itemList;
        const brand = v?.items?.[0]?.fields?.find((f) => f.id === "brand")?.value;
        return { v, brand: typeof brand === "string" && brand !== "" && brand !== "None" ? brand : null };
      };
      let p = priceAt(attrs);
      // VRF-6 (F12, owner Q-pre 5): the accessory takes the UNIT's brand where the catalogue stocks it in that brand; else the line
      // keeps the default brand and says so
      if (acc.follow_unit_brand && unit.brand && p.brand !== unit.brand) {
        const tryIt = priceAt({ ...attrs, brand: unit.brand });
        if (tryIt.v?.rowPriced && tryIt.brand === unit.brand) p = tryIt;
        else working.push(acc.follow_unit_brand.line.replace("{brand}", unit.brand).replace("{item}", acc.title.toLowerCase()).replace("{got}", p.brand ?? "the catalogue's item (no make)"));
      }
      if (p.brand && acc.follow_unit_brand) what = `${what} (${p.brand})`;
      const v = p.v;
      rate = v?.rowPriced && typeof v.totals?.supply_rate === "number" && typeof v.totals?.install_rate === "number"
        ? { supply: v.totals.supply_rate, install: v.totals.install_rate } : { reason: v?.reason ?? L.not_priced };
    } else rate = { reason: L.not_loaded.replace("{rules}", acc.title) };
    if (!reason && rate && "reason" in rate) reason = rate.reason;
    if (!reason && (qty === null || !Number.isFinite(qty) || qty <= 0)) reason = (L.acc_default_needed ?? "default needed - set it in Pricing Inputs");
    const per = rate && "supply" in rate ? rate : undefined;
    let figures: Partial<Record<RateKind, number>> = {};
    if (!reason && per && qty !== null) {
      // `+ 0` turns a -0 (ceil of a zero rate less the epsilon -- the frame's install 0) into 0
      const s2 = Math.ceil(qty * per.supply - 1e-9) + 0;
      const i2 = Math.ceil(qty * per.install - 1e-9) + 0;
      working.push((L.acc_working ?? "{what}: {q} {unit} x supply {s} / install {i} = {S} / {I}").replace("{what}", what).replace("{q}", fmtMm(qty))
        .replace("{unit}", acc.unit_word).replace("{s}", String(per.supply)).replace("{i}", String(per.install)).replace("{S}", String(s2)).replace("{I}", String(i2)));
      figures = { supply_rate: s2, install_rate: i2, combined_rate: s2 + i2 };
    }
    // VRF-5 (QR-1.2 "ok with a"): a choice the line sets (the remote's type) is a field the pricer can change, on both surfaces
    const choiceField: ExtraFieldView[] = acc.choice ? [{ id: acc.choice.attr, label: acc.choice.attr === "remote_type" ? "Type" : acc.choice.attr,
      value: (what.split(" ")[0] ?? ""), typedValue: "", options: [acc.choice.default, ...Object.keys(acc.choice.words)].filter((v, n, a) => a.indexOf(v) === n),
      ...(choiceTag ? { tag: choiceTag, tagText: tagText(choiceTag) } : {}), userEdited: typed[acc.choice.attr] !== undefined }] : [];
    const fields: ExtraFieldView[] = [
      { id: "item", label: L.acc_label_item ?? "Item", value: what, typedValue: "", readOnly: true, userEdited: false },
      ...choiceField,
      { id: "qty", label: (L.acc_label_qty ?? "Quantity per unit ({unit})").replace("{unit}", acc.unit_word), value: q.raw, typedValue: typed.qty ?? "", required: true,
        ...(q.tag ? { tag: q.tag, tagText: tagText(q.tag) } : {}), userEdited: typed.qty !== undefined, ...(q.raw.trim() === "" ? { blank: true } : {}) },
    ];
    return { id: lineId, unitIndex: i, lineNo, heading, title: acc.title, fields, state: reason ? "blank" : "priced", ...(reason ? { reason } : {}), working,
      ...(per ? { perMetre: per } : {}), figures, optional: true, ...(perItem ? { fromBoq: true as const, fromBoqText: L.tag_boq } : {}) };
  };
  // VRF-5 (owner R1): the further items folded off the unit row that are no accessory -- a note point each, never priced
  const foldedNotes = x.folded ? foldedPts.filter((p) => !accs.some((a) => a.family && a.family === p.family)).map((p) =>
    (p.family === null || /^none of these$/i.test(p.family) ? x.folded!.none_line : x.folded!.other_line).replace("{family}", p.family ?? "")) : [];
  const firstUnit = view.items.findIndex((b) => !!b.family && !!x.roles[b.family]);

  let lineNo = 0;
  const lineViews: ExtraLineView[] = [];
  const blocks = view.items.map((b, i): ItemBlockView => {
    lineNo++;
    const unitNo = lineNo;
    const role = b.family ? x.roles[b.family] : undefined;
    if (!role) {
      // VRF-6 (F3, owner Q-pre 2 interim): an item that is no unit (a controller, an AHU kit) carries no extras -- each include the
      // model read on it is said, never dropped silently
      const pts = perItem && sg?.lines.no_extras && b.family ? [
        ...x.includes.filter((inc) => onFor(i).has(inc.id)).map((inc) => notCarried(i, inc.id, inc.label, sg.lines.no_extras.replace("{family}", b.family!))),
        ...accs.filter((a) => inclOf(i).accessories.has(a.id)).map((a) => notCarried(i, a.id, a.label, sg.lines.no_extras.replace("{family}", b.family!))),
      ] : [];
      return pts.length && sg ? { ...b, lineNo: unitNo, extras: { lines: [], removed: [], review: { title: sg.lines.review_title, points: [...new Set(pts)] } } } : { ...b, lineNo: unitNo };
    }
    const e = edits.items[i];
    const ex = e?.extras ?? {};
    const removed = new Set(ex.removed ?? []);
    const set = ex.set ?? {};
    // VRF-4: the model item this block came from (a split module, or a block whose family the pricer changed, keeps it)
    const modelItem = e && e.base !== null ? modelItems[e.base] : undefined;
    // VRF-5 (owner R1 SAFEGUARD): the four as the safeguard leaves them, with the review points it raised
    const itemOn0 = new Set(onFor(i));
    const reviewPts: string[] = [];
    // VRF-6 (owner Q-pre 11): "control wiring" in a unit heading = the communication cable included, with a note
    const cw = sg?.control_wiring;
    const cwFired = perItem && !!cw && reTest(cw.words, [...(ctx.headings ?? []), ...(ctx.headingNotes ?? [])].join(" | "));
    if (cwFired && cw) {
      itemOn0.add("comm");
      reviewPts.push(cw.line);
    }
    // VRF-6 (owner Q7): a note saying the cables are quantified separately wins over a heading that includes them
    const nw = sg?.note_wins;
    const noteSaid = perItem && nw ? (() => {
      for (const t of [...(ctx.ownNotes ?? []), ...(ctx.headingNotes ?? []), ctx.description ?? ""]) {
        try { const m = new RegExp(nw.words, "i").exec(t); if (m) return m[0].trim(); } catch { /* a bad pattern never fires */ }
      }
      return null;
    })() : null;
    // VRF-6 (F11): cabling the BoQ ties to the drain pump is not the unit's power cable
    const cableWords = String(modelItem?.attributes?.[x.from_model?.cable_spec ?? ""]?.value ?? "");
    // ... and with no cable words copied, a note whose ONLY cabling is the drain pump's (00020 r114 "Necessary cabling including plug
    // top ... for the drain pump") is not the unit's power cable either
    const noteCable = perItem && cableWords.trim() === "" && !!L.drain_cable_note_words
      ? [...(ctx.ownNotes ?? []), ...(ctx.headingNotes ?? [])].map((t) => { try { return new RegExp(L.drain_cable_note_words, "i").exec(t)?.[0] ?? null; } catch { return null; } }).find((m) => !!m) ?? null
      : null;
    const powerElsewhere = !!L.power_cable_words && reTest(L.power_cable_words, [ctx.description ?? "", ...(ctx.ownNotes ?? []), ...(ctx.headingNotes ?? [])].join(" | "));
    const drainCable = perItem && !!L.drain_cable_words && (reTest(L.drain_cable_words, cableWords) || (noteCable !== null && !powerElsewhere));
    const drainSaid = reTest(L.drain_cable_words, cableWords) ? cableWords.trim() : (noteCable ?? "");
    const itemOn = new Set([...itemOn0].filter((id) => {
      if (!activeIn(itemOn0, id)) return true;
      const label = incSpec.get(id)?.label ?? id;
      if (noteSaid !== null && nw && nw.ids.includes(id)) { reviewPts.push(nw.line.replace("{label}", label).replace("{said}", noteSaid)); return false; }
      if (drainCable && id === "power" && L.drain_cable_line) { reviewPts.push(L.drain_cable_line.replace("{said}", drainSaid)); return false; }
      const d = decide(i, id, label);
      // the control-wiring note already says why the communication cable is in; an "added" point would repeat it
      if (d.point && !(cwFired && id === "comm" && d.add)) reviewPts.push(d.point);
      if (d.add && d.extra) reviewPts.push(d.extra);
      return d.add;
    })) as Set<ExtraIncludeId>;
    // VRF-6 (F3): an include that needs another (insulation needs copper) and lost it is said, never dropped silently
    if (sg?.lines.not_added) {
      for (const inc of x.includes) {
        if (inc.needs && itemOn0.has(inc.id) && itemOn.has(inc.id) && !itemOn.has(inc.needs) && inc.needs_line) {
          reviewPts.push(notCarried(i, inc.id, inc.label, inc.needs_line.charAt(0).toLowerCase() + inc.needs_line.slice(1)));
        }
      }
    }
    const boq = perItem ? boqOf(i).values : {};
    // VRF-6 (F11, 00073 r51): a length the BoQ gives for ONE item reaches that item only -- the length inside the cable's own words
    // (or words naming a cable / cord) is the cable's; words naming the piping are the copper's; any other length, every line's
    const lenTarget = (() => {
      if (!perItem || !L.length_per_item) return null;
      const lw = String(modelItem?.attributes?.[x.from_model?.length ?? ""]?.value ?? "");
      if (lw.trim() === "") return null;
      const n = readLengthWords(lw);
      if ((n !== null && readLengthWords(cableWords) === n) || reTest(L.length_cable_words, lw)) return reTest(x.from_model?.comm_words, cableWords || lw) ? "comm" : "power";
      if (reTest(L.length_pipe_words, lw)) return "copper";
      return null;
    })();
    const said = (line: string, field: string): string | undefined => {
      const v = modelItem?.attributes?.[`extra_${line}_${field}`]?.value;
      if (!(v === null || v === undefined || String(v).trim() === "")) return String(v);
      if (field === "length" && lenTarget !== null && !line.startsWith(lenTarget)) return undefined;
      // VRF-4 (B1): the model's copied words, read into this line's fields (`boqExtrasOf`)
      const w = boq[`${line}_${field}`];
      return w === undefined || w.trim() === "" ? undefined : w;
    };
    const pick = (line: string, field: string, def: string | undefined) => {
      const typed = set[line]?.[field];
      if (typed !== undefined) return { raw: typed, tag: "picked" as const, typed };
      const boq = said(line, field);
      if (boq !== undefined) return { raw: boq, tag: "boq" as const, typed: undefined };
      return { raw: def ?? "", tag: def !== undefined ? ("default" as const) : undefined, typed: undefined };
    };
    // the unit's size, after conversion, in its role's band unit
    const res = layers.get(i)?.[0];
    // the size the row STATED (after conversion) -- a ladder hop's requested value, else the value read (= the rung)
    const hop = res?.ladderHops?.find((h) => h.attr === "capacity");
    const read = hop ? hop.requested : (res?.readValues?.capacity ?? res?.selection?.capacity);
    const famUnit = familyUnitOf(spec, items, b.family, reader);
    const bandValue = typeof read === "number" || (typeof read === "string" && read.trim() !== "" && Number.isFinite(Number(read)))
      ? convertUnit(Number(read), famUnit, x.band_unit[role]) : null;
    const sizeWords = bandValue !== null ? `${fmtMm(Math.round(bandValue * 100) / 100)} ${x.band_unit[role]}` : "";
    const pipeBand = extraBandOf(x.pipe_bands[role], bandValue);
    const pipeRates = pipeBand ? pricingInputRates(items, pipeBand.input) : null;
    const powerBand = extraBandOf(x.power_bands[role], bandValue);
    const lengthDefault = (id: string) => { const f = pricingInputFactor(items, id); return f !== null ? fmtMm(f) : undefined; };

    const act = (id: ExtraIncludeId) => activeIn(itemOn, id);
    const want: ExtraLineId[] = EXTRA_LINE_ORDER.filter((id) =>
      (id.startsWith("copper") && act("copper")) || (id.startsWith("ins") && act("insulation")) || (id === "power" && act("power")) || (id === "comm" && act("comm")));
    const gone = (id: ExtraLineId) => removed.has(id) || (id === "ins_supply" && removed.has("copper_supply")) || (id === "ins_return" && removed.has("copper_return"));
    const mine: ExtraLineView[] = [];
    const copperUsed = new Map<string, { read: string | undefined; length: string }>();

    const finish = (id: ExtraLineId, fields: ExtraFieldView[], rate: { supply: number; install: number } | { reason: string } | null, why: string | undefined, lengthText: string, countText: string, sizeText: string): ExtraLineView => {
      lineNo++;
      const heading = `Item ${lineNo} · ${L.heading_tail} · ${fromOf(id)}`;
      const per = rate && "supply" in rate ? rate : undefined;
      const len = num(lengthText); const cnt = num(countText);
      let reason = why;
      if (!reason && rate && "reason" in rate) reason = rate.reason;
      if (!reason && (len === null || !Number.isFinite(len) || len <= 0)) reason = L.length_needed;
      if (!reason && (cnt === null || !Number.isFinite(cnt) || cnt <= 0)) reason = L.count_needed;
      const working: string[] = [];
      if (per) working.push(L.working_rate.replace("{title}", titleOf(id)).replace("{size}", sizeText).replace("{rules}", fromOf(id).replace(/^from /, ""))
        .replace("{s}", String(per.supply)).replace("{i}", String(per.install)));
      let figures: Partial<Record<RateKind, number>> = {};
      if (!reason && per && len !== null && cnt !== null) {
        const s = Math.ceil(len * per.supply - 1e-9) * cnt;
        const ins = Math.ceil(len * per.install - 1e-9) * cnt;
        working.push(L.working_nos.split("{len}").join(fmtMm(len)).replace("{s}", String(per.supply)).replace("{S}", String(Math.ceil(len * per.supply - 1e-9)))
          .replace("{i}", String(per.install)).replace("{I}", String(Math.ceil(len * per.install - 1e-9))));
        if (cnt !== 1) working.push(L.working_count.replace("{n}", fmtMm(cnt)).replace("{S}", String(s)).replace("{I}", String(ins)));
        figures = { supply_rate: s, install_rate: ins, combined_rate: s + ins };
      }
      const lv: ExtraLineView = { id, unitIndex: i, lineNo, heading, title: titleOf(id), fields, state: reason ? "blank" : "priced", ...(reason ? { reason } : {}), working, ...(per ? { perMetre: per } : {}), figures,
        ...(perItem ? { fromBoq: true as const, fromBoqText: L.tag_boq } : {}) };
      return lv;
    };
    const lengthField = (line: ExtraLineId, def: string | undefined, follows?: { text: string }): ExtraFieldView => {
      const p = pick(line, "length", follows ? follows.text : def);
      const tag = p.tag === "default" && follows ? "follows" : p.tag;
      return { id: "length", label: L.label_length, value: p.raw, typedValue: p.typed ?? "", ...(tag ? { tag, tagText: tagText(tag) } : {}), userEdited: p.typed !== undefined, ...(p.raw.trim() === "" ? { blank: true } : {}) };
    };
    const countField = (line: ExtraLineId): ExtraFieldView => {
      const p = pick(line, "count", "1");
      // the assumed 1 is a default like every other assumed quantity (amber), not a Pricing Input
      const tt = p.tag === "default" ? L.tag_assumed : tagText(p.tag);
      return { id: "count", label: L.label_count, value: p.raw, typedValue: p.typed ?? "", ...(p.tag ? { tag: p.tag, tagText: tt } : {}), userEdited: p.typed !== undefined, ...(p.raw.trim() === "" ? { blank: true } : {}) };
    };

    for (const id of want) {
      if (gone(id)) continue;
      if (id === "copper_supply" || id === "copper_return") {
        const side = id === "copper_supply" ? "supply" : "return";
        // VRF's OWN default (Pricing Inputs) -- owner 09:50 "the defaults remain the same as we declared and are not overwritten by
        // the defaults of the parent settings": Piping's own defaults never fill a VRF line
        const def = pipeRates && typeof pipeRates[`${side}_mm`] === "number" && pipeRates[`${side}_mm`] > 0 ? fmtMm(pipeRates[`${side}_mm`]) : undefined;
        // K1b: the line's item -- Copper by default; any pipe Piping stocks through "Change item"
        const fp = pick(id, "family", x.copper.family);
        const fam = fp.raw;
        // the dropdown's choices: the sizes Piping stocks for that pipe (a pick list -- never a pricing rule)
        const options = pipeSizesOf(fam).map(fmtMm);
        const p = pick(id, "size", def);
        // VRF-4 B2 (owner BORROWED 22:18 "option a"; R5 (c)): the size goes to PIPING AS STATED -- typed, the BoQ's words, or the
        // default -- and Piping's own reader and ladder resolve it (next size up, inch, the no-unit and above-largest refusals)
        const cu = p.raw.trim() === "" ? null : lineCall(pcfg, pspec, L.rules_piping, fam, { [x.copper.size_attr]: p.raw }, p.tag === "boq");
        const value = cu?.size ?? "";
        let why: string | undefined;
        if (p.raw.trim() === "") why = (bandValue === null ? L.size_needed_no_size : L.size_needed_no_default.replace("{size}", sizeWords));
        else if (cu && "reason" in cu.rate) why = cu.rate.reason;
        // Piping's own note on the size ("BoQ says 14 mm -> priced as 15.9 mm (next size up)"), shown where the value was not
        // the default as declared
        const note = p.tag !== "default" ? cu?.note : undefined;
        const otherMode = p.typed !== undefined && !options.includes(p.typed.trim());
        const lenF = lengthField(id, lengthDefault(x.copper_length_input));
        const cntF = countField(id);
        copperUsed.set(side, { read: cu?.read, length: lenF.value });
        const fields: ExtraFieldView[] = [
          { id: "family", label: L.label_family, value: fam, typedValue: "", options: pipeFamilies, changeItem: true,
            ...(fp.tag ? { tag: fp.tag, tagText: tagText(fp.tag) } : {}), userEdited: fp.typed !== undefined },
          { id: "size", label: L.label_pipe_size, value, typedValue: p.typed ?? "", options, allowOther: true, otherMode, required: true,
            ...(p.tag ? { tag: p.tag, tagText: tagText(p.tag) } : {}), userEdited: p.typed !== undefined, ...(why ? { blank: true } : {}), ...(note ? { note } : {}) },
          lenF, cntF,
        ];
        const rate = !why && cu ? cu.rate : null;
        // the working names the pipe only where it is not the default (Copper)
        mine.push(finish(id, fields, rate, why, lenF.value, cntF.value, fam === x.copper.family ? `${value} mm` : `${value} mm (${fam})`));
        continue;
      }
      if (id === "ins_supply" || id === "ins_return") {
        const side = id === "ins_supply" ? "supply" : "return";
        const cu = copperUsed.get(side);
        // K1b: the line's item (Nitrile Rubber by default; any pipe insulation Insulation stocks), its cladding and thickness
        const fp = pick(id, "family", x.insulation.family);
        const fam = fp.raw;
        const cp = pick(id, "cladding", x.insulation.attrs.cladding);
        const def = pipeRates && typeof pipeRates.insulation_mm === "number" && pipeRates.insulation_mm > 0 ? fmtMm(pipeRates.insulation_mm) : undefined;
        const p = pick(id, "thickness", def);
        // VRF-4 B2 (R5 (c), the Piping -> Insulation section precedent): ONE Insulation call on the copper size AS READ (mirrored,
        // copper = an outside diameter), the thickness as stated -- Insulation's own rules pick the pipe size (next size up) and
        // the thickness (next size up, layers above its largest); VRF's declared item / cladding / thickness are always sent
        const ins = cu?.read !== undefined && p.raw.trim() !== ""
          ? lineCall(icfg, ispec, L.rules_insulation, fam, { ...x.insulation.attrs, cladding: cp.raw, [x.insulation.thickness_attr]: p.raw, [x.insulation.size_attr]: cu.read },
                     p.tag === "boq", x.insulation.size_attr)
          : null;
        // the dropdowns' choices: what Insulation stocks on the size it priced (pick lists only)
        const insSize = ins?.attrs?.[x.insulation.size_attr];
        const cladOptions = insSize !== undefined ? strsOf(insOf(fam, { [x.insulation.size_attr]: insSize }).map((it) => it.attributes?.cladding)) : [];
        const insThicknesses = insSize !== undefined ? numsOf(insOf(fam, { [x.insulation.size_attr]: insSize, ...(cladOptions.includes(cp.raw) ? { cladding: cp.raw } : {}) }).map((it) => it.attributes?.[x.insulation.thickness_attr])) : [];
        let why: string | undefined;
        if (cu?.read === undefined) why = L.size_needed_copper;
        else if (p.raw.trim() === "") why = (bandValue === null ? L.size_needed_no_size : L.size_needed_no_default.replace("{size}", sizeWords));
        else if (ins && "reason" in ins.rate) why = ins.rate.reason;
        const thValue = ins?.attrs?.[x.insulation.thickness_attr] ?? "";
        const lenF = lengthField(id, undefined, { text: cu?.length ?? "" });
        const cntF = countField(id);
        const sizeText = insSize ?? "";
        const thNote = p.tag !== "default" ? ins?.notes?.[x.insulation.thickness_attr] : undefined;
        const fields: ExtraFieldView[] = [
          { id: "family", label: L.label_family, value: fam, typedValue: "", options: insFamilies, changeItem: true,
            ...(fp.tag ? { tag: fp.tag, tagText: tagText(fp.tag) } : {}), userEdited: fp.typed !== undefined },
          { id: "cladding", label: L.label_cladding, value: cp.raw, typedValue: "", options: cladOptions.length ? cladOptions : (cp.raw ? [cp.raw] : []), required: true,
            ...(cp.tag ? { tag: cp.tag, tagText: tagText(cp.tag) } : {}), userEdited: cp.typed !== undefined },
          { id: "thickness", label: L.label_thickness, value: thValue, typedValue: p.typed ?? "", options: insThicknesses.map(fmtMm), required: true,
            ...(p.tag ? { tag: p.tag, tagText: tagText(p.tag) } : {}), userEdited: p.typed !== undefined, ...(why && cu?.read !== undefined ? { blank: true } : {}), ...(thNote ? { note: thNote } : {}) },
          { id: "size", label: L.label_pipe_size, value: sizeText, typedValue: "", readOnly: true, userEdited: false, suffix: "mm",
            ...(ins?.notes?.[x.insulation.size_attr] ? { note: mirroredLead(ins.notes[x.insulation.size_attr], L.tag_follows) } : {}),
            ...(insSize !== undefined ? { tag: "follows" as const, tagText: tagText("follows") } : {}) },
          lenF, cntF,
        ];
        const rate = !why && ins ? ins.rate : null;
        mine.push(finish(id, fields, rate, why, lenF.value, cntF.value, `${thValue} mm on ${sizeText} mm`));
        continue;
      }
      // power / communication cable
      const rates = id === "power" ? (powerBand ? pricingInputRates(items, powerBand.input) : null) : pricingInputRates(items, x.comm_input);
      const def = rates && typeof rates.cores === "number" && typeof rates.sqmm === "number" && rates.cores > 0 && rates.sqmm > 0 ? cableSpecText(rates.cores, rates.sqmm) : undefined;
      // the spec as a whole (a typed "4C x 16", the BoQ's words, else the Pricing Inputs default) seeds the cores and the size
      const sp = pick(id, "spec", def);
      const parsed = readCableSpecWords(sp.raw);
      // VRF-5 (F2): the BoQ's words name the cable but no size -> the band's default spec (Pricing Inputs); an armour / conductor
      // word the words state sets that attribute; a length they state is used (a range -> the higher figure). Never "Size needed"
      // while a default exists. Gated on the config's words for it (v61), so an older config is byte-identical.
      const wordsOnly = (sp.tag === "boq" || sp.tag === "picked") && parsed === null && L.cable_words_default !== undefined && def !== undefined;
      const defParsed = wordsOnly ? readCableSpecWords(def!) : null;
      // VRF-6 (F11): the BoQ's armour / conductor words apply also where it states the size ("4C x 6 AL armoured")
      const kindAlways = !!L.cable_kind_always && (sp.tag === "boq" || sp.tag === "picked") && parsed !== null;
      const kindWords: { armour?: string; conductor?: string } = wordsOnly || kindAlways ? readCableKindWords(sp.raw, { abbrev: !!L.cable_kind_always }) : {};
      const seeded = (field: string, seed: string | undefined, seedTag?: ExtraFieldView["tag"]) => {
        const typed = set[id]?.[field];
        if (typed !== undefined) return { raw: typed, tag: "picked" as const, typed };
        const boq = said(id, field);
        if (boq !== undefined) return { raw: boq, tag: "boq" as const, typed: undefined };
        return { raw: seed ?? "", tag: seed !== undefined ? (seedTag ?? sp.tag) : undefined, typed: undefined };
      };
      // K1b (owner ANSWER 2): conductor, armour, cores and size -- the choices Electrical's wiring_cabling stocks (read only);
      // VRF-4 B2: Electrical's own attribute ids come from the config (`cable.conductor_attr` / `armour_attr`)
      const M = x.cable.conductor_attr ?? "material";
      const A = x.cable.armour_attr ?? "insulation";
      const mp = wordsOnly || kindAlways ? seeded("conductor", kindWords.conductor ?? x.cable.attrs[M], kindWords.conductor ? "boq" : "default") : seeded("conductor", x.cable.attrs[M]);
      const ap = wordsOnly || kindAlways ? seeded("armour", kindWords.armour ?? x.cable.attrs[A], kindWords.armour ? "boq" : "default") : seeded("armour", x.cable.attrs[A]);
      const cp = defParsed ? seeded("cores", String(defParsed.cores), "default") : seeded("cores", parsed ? String(parsed.cores) : undefined);
      const zp = defParsed ? seeded("sqmm", String(defParsed.sqmm), "default") : seeded("sqmm", parsed ? String(parsed.sqmm) : undefined);
      const conductorOptions = strsOf(cableSkus.map((it) => it.attributes?.[M])).sort();
      const armourOptions = strsOf(cableOf({ [M]: mp.raw }).map((it) => it.attributes?.[A])).sort();
      const coresOptions = numsOf(cableOf({ [M]: mp.raw, [A]: ap.raw }).map((it) => it.attributes?.[x.cable.cores_attr])).map(fmtMm);
      const sqmmOptions = numsOf(cableOf({ [M]: mp.raw, [A]: ap.raw, [x.cable.cores_attr]: Number(cp.raw) }).map((it) => it.attributes?.[x.cable.size_attr])).map(fmtMm);
      const cores = Number(cp.raw); const sqmm = Number(zp.raw);
      const value = cp.raw !== "" && zp.raw !== "" && Number.isFinite(cores) && Number.isFinite(sqmm) ? cableSpecText(cores, sqmm) : "";
      let why: string | undefined;
      if (sp.raw.trim() === "" && cp.raw === "" && zp.raw === "") why = id === "power" && bandValue !== null && !powerBand ? L.no_default.replace("{size}", sizeWords) : (bandValue === null && id === "power" ? L.size_needed_no_size : L.spec_needed);
      else if (value === "") why = L.size_needed_unread.replace("{typed}", sp.raw.trim() || `${cp.raw} x ${zp.raw}`);
      // VRF-4 B2 (R5 (c)): no VRF-side "stocked" check -- Electrical's own match prices the spec or answers with its own sentence
      const rate = !why
        ? (cableRate
            ? (cache.get(`cable|${mp.raw}|${ap.raw}|${cores}|${sqmm}`) ?? (() => {
                const r = cableRate(x.cable.category, { ...x.cable.attrs, [M]: mp.raw, [A]: ap.raw, [x.cable.cores_attr]: String(cores), [x.cable.size_attr]: String(sqmm) });
                cache.set(`cable|${mp.raw}|${ap.raw}|${cores}|${sqmm}`, r);
                return r;
              })())
            : { reason: L.not_loaded.replace("{rules}", x.cable.label) })
        : null;
      if (!why && rate && "reason" in rate) why = rate.reason;
      // VRF-5 (F2): a length the cable's own words state, where nothing else stated one (a range -> the higher figure, noted)
      const lenWords = wordsOnly && set[id]?.length === undefined && said(id, "length") === undefined
        ? readLengthRange(sp.raw) : null;
      const lenF0 = lengthField(id, lengthDefault(x.cable_length_input));
      const lenF: ExtraFieldView = lenWords
        ? { ...lenF0, value: lenWords.value, tag: "boq", tagText: tagText("boq"), blank: undefined,
            ...(lenWords.range && L.length_range ? { note: L.length_range.replace("{a}", lenWords.range[0]).replace("{b}", lenWords.range[1]).replace("{v}", lenWords.value) } : {}) }
        : lenF0;
      const cntF = countField(id);
      // VRF-5 (F2, U2): which values came from the BoQ and which are the default
      const fromBoqKinds = [kindWords.armour ? kindWords.armour.toLowerCase() : null, kindWords.conductor ? kindWords.conductor.toLowerCase() : null, lenWords ? `${lenWords.value} m` : null]
        .filter((t): t is string => !!t);
      const wordsNote = wordsOnly ? L.cable_words_default!.replace("{said}", sp.raw.trim()).replace("{spec}", def!)
        .replace("{boq}", fromBoqKinds.length ? (L.cable_words_boq ?? "; from the BoQ: {list}").replace("{list}", fromBoqKinds.join(", ")) : "") : undefined;
      const tagOf = (q: { tag?: ExtraFieldView["tag"]; typed?: string }) => ({ ...(q.tag ? { tag: q.tag, tagText: tagText(q.tag) } : {}), userEdited: q.typed !== undefined });
      const opt = (opts: string[], v: string) => (v !== "" && !opts.includes(v) ? [...opts, v] : opts);
      const fields: ExtraFieldView[] = [
        { id: "conductor", label: L.label_conductor, value: mp.raw, typedValue: "", options: opt(conductorOptions, mp.raw), required: true, ...tagOf(mp), ...(mp.raw === "" ? { blank: true } : {}) },
        { id: "armour", label: L.label_armour, value: ap.raw, typedValue: "", options: opt(armourOptions, ap.raw), required: true, ...tagOf(ap), ...(ap.raw === "" ? { blank: true } : {}) },
        { id: "cores", label: L.label_cores, value: cp.raw === "" ? "" : fmtMm(cores), typedValue: "", options: opt(coresOptions, cp.raw === "" ? "" : fmtMm(cores)), required: true, ...tagOf(cp), ...(why ? { blank: true } : {}) },
        { id: "sqmm", label: L.label_sqmm, value: zp.raw === "" ? "" : fmtMm(sqmm), typedValue: "", options: opt(sqmmOptions, zp.raw === "" ? "" : fmtMm(sqmm)), required: true, ...tagOf(zp), ...(why ? { blank: true } : {}) },
        { id: "spec", label: L.label_spec, value: !why ? value : "", typedValue: "", readOnly: true, userEdited: false, note: wordsNote ?? L.cable_note },
        lenF, cntF,
      ];
      // the working names the conductor and the armour only where they are not the default (copper, unarmoured)
      const isDefaultKind = mp.raw === x.cable.attrs[M] && ap.raw === x.cable.attrs[A];
      mine.push(finish(id, fields, rate, why, lenF.value, cntF.value, isDefaultKind ? value : `${value} ${mp.raw.toLowerCase()} ${ap.raw.toLowerCase()}`));
    }
    // VRF-5 (owner R1, ANSWER 4, U10): the ACCESSORIES this unit's price includes -- each its own line under the unit, like the
    // four: the quantity from the BoQ, else the Pricing Inputs default (by the unit's band), typed wins; priced by its own rules
    // (a VRF family by VRF's, the MCCB by Electrical's, read only). A line that cannot price is a note: it never blocks the unit.
    const accOn = accOnFor(i);
    // VRF-6: the unit's priced size (its rung, in the role's band unit), its brand and its model item -- read by the accessories
    const pricedRaw = res?.selection?.capacity;
    const pricedSize = typeof pricedRaw === "number" || (typeof pricedRaw === "string" && pricedRaw.trim() !== "" && Number.isFinite(Number(pricedRaw)))
      ? convertUnit(Number(pricedRaw), famUnit, x.band_unit[role]) : null;
    const brandRaw = res?.selection?.brand;
    const unitInfo = { size: pricedSize, brand: typeof brandRaw === "string" && brandRaw !== "" && brandRaw !== "None" ? brandRaw : null, model: modelItem };
    for (const acc of accs) {
      const lineId = `acc_${acc.id}` as ExtraLineId;
      if (!acc.roles.includes(role)) {
        // VRF-6 (F3, owner Q2 / Q8): an accessory read as included that this unit's role never carries is said, with the reason
        if (accOn.has(acc.id) && sg?.lines.not_added && sg.lines[`role_${acc.roles[0]}`]) reviewPts.push(notCarried(i, acc.id, acc.label, sg.lines[`role_${acc.roles[0]}`]));
        continue;
      }
      if (!accOn.has(acc.id) || removed.has(lineId)) continue;
      const d = decide(i, acc.id, acc.label);
      if (d.point) reviewPts.push(d.point);
      if (!d.add) continue;
      mine.push(accessoryLine(acc, lineId, i, role, bandValue, set[lineId] ?? {}, perItem ? inclOf(i).qty[acc.id] : undefined, unitInfo));
      // VRF-6 (owner Q1): a unit the BoQ says has the item built in still gets the line, with a review point
      if (acc.builtin && reTest(acc.builtin.words, allWords)) reviewPts.push(acc.builtin.line);
    }
    lineViews.push(...mine);
    // VRF-4 U8 (owner 2026-11-06): a removed copper line names the insulation it took with it
    const takesIns = (id: ExtraLineId) => (id === "copper_supply" && want.includes("ins_supply")) || (id === "copper_return" && want.includes("ins_return"));
    const accRemoved = accs.filter((a) => a.roles.includes(role) && accOn.has(a.id) && removed.has(`acc_${a.id}` as ExtraLineId))
      .map((a) => ({ id: `acc_${a.id}` as ExtraLineId, label: a.title }));
    const removedList = [...want.filter((id) => removed.has(id)).map((id) => ({ id, label: takesIns(id) ? `${titleOf(id)} (and its insulation)` : titleOf(id) })), ...accRemoved];
    // VRF-4 (O-5 "...we can add a note"): on a BoQ row, what the BoQ says this unit's price includes, read by the model
    const incLabels = x.includes.filter((inc) => act(inc.id)).map((inc) => inc.label.toLowerCase());
    const boqNote = perItem && incLabels.length && L.boq_note ? L.boq_note.replace("{list}", incLabels.join(", ")) : undefined;
    const notePts = i === firstUnit ? foldedNotes : [];
    if (!mine.length && !removedList.length && !reviewPts.length && !notePts.length) return { ...b, lineNo: unitNo };
    return { ...b, lineNo: unitNo, extras: { lines: mine, removed: removedList, ...(removedList.length ? { removedNote: L.removed_note } : {}), ...(boqNote ? { boqNote } : {}),
      ...(reviewPts.length && sg ? { review: { title: sg.lines.review_title, points: reviewPts } } : {}),
      ...(notePts.length && x.folded ? { notes: { title: x.folded.title, points: notePts } } : {}) } };
  });

  // ── the row: every unit and every extra is a LINE; all or nothing (O-6 "n of m items need a person") ──
  const lines = blocks.length + lineViews.length;
  // VRF-5 (owner R1): an accessory line that cannot price never blocks the unit (it shows its reason as a note)
  const badExtras = lineViews.filter((l) => l.state !== "priced" && !l.optional).length;
  const bad = blocks.filter((b) => b.state !== "priced").length + badExtras;
  const rowPriced = view.rowPriced && badExtras === 0;
  const values: Record<string, number> = {};
  if (rowPriced) {
    const sum = (k: "supply_rate" | "install_rate") => (view.totals?.[k] ?? 0) + lineViews.reduce((a, l) => a + (l.figures[k] ?? 0), 0);
    if (typeof view.totals?.supply_rate === "number") values.supply_rate = sum("supply_rate");
    if (typeof view.totals?.install_rate === "number") values.install_rate = sum("install_rate");
    if (typeof values.supply_rate === "number" && typeof values.install_rate === "number") values.combined_rate = values.supply_rate + values.install_rate;
  }
  const reason = rowPriced ? undefined : (view.rowPriced ? lineViews.find((l) => l.state !== "priced" && !l.optional)?.reason : view.reason);
  const { reason: _r, totals: _t, ...rest } = view;
  const nextView: ItemListView = {
    ...rest,
    rowPriced,
    ...(reason ? { reason } : {}),
    items: blocks,
    ...(includesView ? { extrasIncludes: includesView } : {}),
    lineCount: { lines, bad },
    ...(rowPriced ? { totals: { ...values } as Partial<Record<RateKind, number>> } : {}),
  };
  const basis = rowPriced ? `${own.basis.replace(/ · \d+ items?$/, "")} · ${lines} item${lines === 1 ? "" : "s"}` : own.basis;
  const derivation = rowPriced ? [`Row total per 1 ${view.unit}: supply ${values.supply_rate} + install ${values.install_rate}`] : (reason ? [plainPricerText(reason, items)] : own.workings?.derivation ?? []);
  return withScope(spec, items, ctx, ext, overrides, {
    ...own,
    values,
    basis,
    workings: { ...(own.workings ?? { attributes: [], matchedRows: [] }), derivation, finalValues: { ...values } },
    itemList: nextView,
  } as ItemListSuggestion, probe);
}

/** VRF-5 (owner R4-R8): the row's scope override key in the calculator ("BoQ scope"); a BoQ row reads the model's answer. */
export const SCOPE_OVERRIDE_KEY = "__scope__";

/**
 * VRF-5 (owner R4 "you can add"; R6 "for installation only use 1.5 times the installation rate as per catalog and declare the
 * same in the note clearly"; R7 "1.5 is after applying any installtion markup or any other required markip"; R8 "model the 1.5
 * multiplier as 50% installation only multiplier in the pricing input sheets"). The ROW's scope, applied LAST to every line of
 * the row (each unit, each extra): supply only -> install 0; installation only -> supply 0 and install = the line's FINAL install
 * (after every markup / rounding) x (1 + the Pricing Input uplift), rounded up to the rupee once, after the multiplier; a line
 * with no install rate refuses with a note. A config without `extras.scope`, and a supply + installation row, are unchanged.
 */
function withScope(spec: ItemListPricingSpec, items: RateMasterItem[], ctx: RowContextWithUnit, ext: ExtractionRowWithItems | undefined,
                   overrides: Record<string, string> | undefined, res: ItemListSuggestion, _probe?: OwnPassProbe): ItemListSuggestion {
  const sc = spec.extras?.scope;
  const view = res.itemList;
  if (!sc || !view) return res;
  const calculator = view.unitPickable || ctx.noRow === true;
  let value = "";
  if (calculator) value = String(overrides?.[SCOPE_OVERRIDE_KEY] ?? "").trim();
  else {
    const id = spec.extras?.from_model?.scope;
    for (const it of id ? (ext?.items ?? []) : []) {
      const v = it.attributes?.[id!]?.value;
      if (typeof v === "string" && v.trim() !== "" && v.trim() !== "None") { value = v.trim(); break; }
    }
  }
  const picker = calculator ? { title: sc.title, options: sc.options, value: sc.options.includes(value) ? value : sc.options[0] } : undefined;
  const L = sc.lines;
  // VRF-6 (owner Q5, Divyansh 11:38-11:55; INSTALLATION-ONLY 11:50 / 11:55): on a BoQ row, the same sheet's rows of the SAME kind
  // of item (item-1 family) and their scope answers decide -- a supply-only row under a note that includes installation, and an
  // installation-only row, each carry a note naming the rows that decided
  const fam0 = (() => { const v = ext?.items?.[0]?.attributes?.[familyAttr(spec)]?.value; return typeof v === "string" && v !== "" ? v : null; })();
  const sameKind = (pred: (s: string) => boolean) => (ctx.sheetLines ?? []).filter((l) => l.row !== ctx.excelRow && l.sheet === undefined && fam0 !== null
    && l.family1 === fam0 && typeof l.scope1 === "string" && pred(l.scope1)).map((l) => l.row).sort((a, b) => a - b);
  const rowsWord = (rs: number[]) => rs.slice(0, 4).map((r) => `row ${r}`).join(", ") + (rs.length > 4 ? ` and ${rs.length - 4} more` : "");
  let extraNote: string | undefined;
  if (!calculator && sc.conflict && value === sc.supply_only) {
    const text = [...(ctx.headings ?? []), ...(ctx.headingNotes ?? []), ...(ctx.ownNotes ?? [])].join(" | ");
    let said: string | null = null;
    try { const m = new RegExp(sc.conflict.words, "i").exec(text); said = m ? m[0].trim() : null; } catch { said = null; }
    if (said !== null) {
      const inst = sameKind((s) => s === sc.install_only);
      if (inst.length) extraNote = sc.conflict.with_row.replace("{said}", said).replace("{rows}", rowsWord(inst));
      else {
        // no installation row of this kind on the sheet: supply + installation, said
        const note = sc.conflict.no_row.replace("{said}", said);
        return { ...res, itemList: { ...view, scope: { value: sc.options[0], note } } };
      }
    }
  }
  // VRF-6 K2 (parity): the calculator's own way to say "installation only, its supply quoted on another row"
  const installNormal = !!sc.install_only_normal && value === sc.install_only_normal;
  if (value !== sc.supply_only && value !== sc.install_only && !installNormal) {
    return picker ? { ...res, itemList: { ...view, scope: { value: picker.value, picker } } } : res;
  }
  const supplyOnly = value === sc.supply_only;
  // VRF-6 (INSTALLATION-ONLY): x (1 + uplift) only when the sheet has no supply row for this kind of item; with one, the normal rate
  const supplyRows = !supplyOnly && !installNormal && !calculator && sc.supply_row ? sameKind((s) => s !== sc.install_only && s !== sc.install_only_normal) : [];
  const normalRate = installNormal || supplyRows.length > 0;
  const uplift0 = supplyOnly ? null : pricingInputFactor(items, sc.uplift_input);
  const uplift = normalRate ? 0 : uplift0;
  if (!supplyOnly && !calculator && sc.supply_row && !installNormal) {
    extraNote = supplyRows.length ? sc.supply_row.with_row.replace("{rows}", rowsWord(supplyRows)) : sc.supply_row.no_row;
  }
  // the row's scope as the calculator states it: a panel row whose sheet quotes the supply elsewhere shows the normal-rate option
  const shownValue = supplyRows.length && sc.install_only_normal ? sc.install_only_normal : value;
  const pct = uplift === null ? "" : `${fmtN(uplift * 100)}%`;
  // the lines of the row, each with its own figures: the units (a block per unit) and every extra line that priced
  type Ln = { title: string; f: Partial<Record<RateKind, number>> };
  const lns: Ln[] = [];
  view.items.forEach((b) => {
    if (b.state === "priced") lns.push({ title: b.family ?? "item", f: b.figures });
    for (const l of b.extras?.lines ?? []) if (l.state === "priced") lns.push({ title: l.title, f: l.figures });
  });
  const sumOf = (k: "supply_rate" | "install_rate") => lns.reduce((a, l) => a + (l.f[k] ?? 0), 0);
  const perLine = view.rowPriced && typeof view.totals?.install_rate === "number" && sumOf("install_rate") === view.totals.install_rate
    && sumOf("supply_rate") === view.totals.supply_rate;
  const points: string[] = [];
  let refuse: string | undefined;
  const adj = (f: Partial<Record<RateKind, number>>, title: string): Partial<Record<RateKind, number>> => {
    const s0 = f.supply_rate ?? 0;
    const i0 = f.install_rate ?? 0;
    if (supplyOnly) return { supply_rate: s0, install_rate: 0, combined_rate: s0 };
    if (uplift === null) { refuse = L.uplift_missing; return f; }
    if (!(i0 > 0)) { refuse ??= L.no_install.replace("{title}", title); return { supply_rate: 0, install_rate: 0, combined_rate: 0 }; }
    const i1 = Math.ceil(i0 * (1 + uplift) - 1e-9);
    if (uplift > 0) points.push(L.install_only_line.replace("{title}", title).replace("{rate}", String(i0)).replace("{pct}", pct).replace("{figure}", String(i1)));
    return { supply_rate: 0, install_rate: i1, combined_rate: i1 };
  };
  let items2 = view.items;
  let totals: Partial<Record<RateKind, number>> | undefined;
  if (view.rowPriced && view.totals) {
    if (perLine) {
      items2 = view.items.map((b) => ({
        ...b,
        ...(b.state === "priced" ? { figures: adj(b.figures, b.family ?? "item") } : {}),
        ...(b.extras ? { extras: { ...b.extras, lines: b.extras.lines.map((l) => (l.state === "priced" ? { ...l, figures: adj(l.figures, l.title) } : l)) } } : {}),
      }));
      const all = items2.flatMap((b) => [...(b.state === "priced" ? [b.figures] : []), ...(b.extras?.lines ?? []).filter((l) => l.state === "priced").map((l) => l.figures)]);
      const sum = (k: RateKind) => all.reduce((a, f) => a + (f[k] ?? 0), 0);
      totals = { supply_rate: sum("supply_rate"), install_rate: sum("install_rate"), combined_rate: sum("supply_rate") + sum("install_rate") };
    } else {
      totals = adj(view.totals, L.row_title ?? "the row");
    }
  }
  const note0 = supplyOnly ? L.supply_only_note : (normalRate && sc.supply_row ? sc.supply_row.normal_note : L.install_only_note.replace("{pct}", pct || "-"));
  const note = extraNote ? `${note0} ${extraNote}` : note0;
  const scopeView = { value: shownValue, note: points.length ? `${note} ${points.join("; ")}` : note, ...(picker ? { picker: { ...picker, value } } : {}) };
  if (!view.rowPriced || !totals) return { ...res, itemList: { ...view, scope: scopeView } };
  if (refuse) {
    const { totals: _t, ...rest } = view;
    return { ...res, values: {}, workings: { ...res.workings, derivation: [refuse], finalValues: {} },
             itemList: { ...rest, rowPriced: false, reason: refuse, scope: scopeView } };
  }
  const values: Record<string, number> = { supply_rate: totals.supply_rate ?? 0, install_rate: totals.install_rate ?? 0, combined_rate: (totals.supply_rate ?? 0) + (totals.install_rate ?? 0) };
  return {
    ...res,
    values,
    workings: { ...res.workings, derivation: [`Row total per 1 ${view.unit}: supply ${values.supply_rate} + install ${values.install_rate}`], finalValues: { ...values } },
    itemList: { ...view, items: items2, totals: { ...values } as Partial<Record<RateKind, number>>, scope: scopeView },
  };
}

/**
 * VRF-6 (owner rulings 2026-11-09). PURE. A BoQ row's model items as the reading rules settle them BEFORE pricing, each change with
 * its note (`extras.prepare`; ABSENT => the items as stored, byte-identical):
 *   spaced_decimal  "6 .3TR" reads 6.3 (00197 r318)
 *   family_by_unit  a frame / stand quoted per Nos prices on the per-Nos frame item (team rule; 00210 r29 / r30)
 *   same_as_outdoor "make same as outdoor" -> the make of the sheet's outdoor units (Q-pre 5)
 *   row_cooling     the row's own "Cooling Type" / "heat pump" wins over the heading, noted when they differ (Q6)
 *   family_words    an ON/OFF central controller is the Touch Screen controller, noted (Q-pre 4)
 * The calculator (no model item) is never touched.
 */
function prepareModelItems(spec: ItemListPricingSpec, ctx: RowContextWithUnit, ext: ExtractionRowWithItems | undefined):
  { ext: ExtractionRowWithItems | undefined; notes: string[] } {
  const P = spec.extras?.prepare;
  if (!P || !ext?.items?.length) return { ext, notes: [] };
  const notes: string[] = [];
  const fa = familyAttr(spec);
  const rowText = [ctx.description ?? "", ...(ctx.ownNotes ?? [])].join(" | ");
  // every heading above the row and every heading's notes (00114: "(HEAT PUMP)" sits on the grandparent)
  const headText = [...(ctx.headings ?? []), ...(ctx.ancestorNotes ?? ctx.headingNotes ?? [])].join(" | ");
  const find = (w: string | undefined, t: string): string | null => { if (!w) return null; try { const m = new RegExp(w, "i").exec(t); return m ? m[0].trim() : null; } catch { return null; } };
  const textOf = (where: "row" | "heading" | "both" | undefined) => (where === "heading" ? headText : where === "both" ? `${rowText} | ${headText}` : rowText);
  const val = (it: ExtractedListItem, a: string) => { const v = it.attributes?.[a]?.value; return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v); };
  const setVal = (it: ExtractedListItem, a: string, v: string): ExtractedListItem => ({ ...it, attributes: { ...it.attributes, [a]: { ...(it.attributes?.[a] ?? { confidence: 1 }), value: v } } });
  const rowClass = typeof ctx.unit === "string" ? unitClassOf(spec, ctx.unit) : null;
  const out = ext.items.map((it0, idx) => {
    let it = it0;
    if (P.spaced_decimal) {
      const c = val(it, P.spaced_decimal.attr);
      const j = c.replace(/(\d)\s+\.(\d)/g, "$1.$2");
      if (j !== c) it = setVal(it, P.spaced_decimal.attr, j);
    }
    const fam = val(it, fa);
    for (const fb of P.family_by_unit ?? []) {
      if (fam === fb.family && rowClass === fb.unit_class) { it = setVal(it, fa, fb.to); notes.push(fb.line.replace("{unit}", String(ctx.unit ?? "")).replace("{to}", fb.to)); }
    }
    for (const fw of P.family_words ?? []) {
      const said = find(fw.words, textOf(fw.in));
      if (said && (fam === fw.family || fam === "" || fam === "None" || /^none of these$/i.test(fam) || (fw.from ?? []).includes(fam))) {
        if (fam !== fw.family) it = setVal(it, fa, fw.family);
        notes.push(fw.line.replace("{said}", said).replace("{family}", fw.family));
      }
    }
    // VRF-6 (owner Q-pre 7): a spec the owner reads one way -- 600x600 / 2'x2' = the compact cassette; "1 way" in a heading = a one-way
    // cassette -- sets that answer on the family it names, where the row's own text states no other value for it
    for (const aw of P.attr_words ?? []) {
      const famNow = val(it, fa);
      if (!aw.families.includes(famNow)) continue;
      const said = find(aw.words, textOf(aw.in));
      if (!said || val(it, aw.attr) === aw.value) continue;
      if (aw.unless_row && find(aw.unless_row, rowText)) continue;
      it = setVal(it, aw.attr, aw.value);
      notes.push(aw.line.replace("{said}", said).replace("{value}", aw.value));
    }
    if (idx === 0 && P.row_cooling) {
      const rc = P.row_cooling;
      const rowSaid = Object.entries(rc.words).map(([v, w]) => [v, find(w, rowText)] as const).find(([, m]) => m !== null);
      if (rowSaid) {
        const headSaid = Object.entries(rc.words).map(([v, w]) => [v, find(w, headText)] as const).find(([v, m]) => m !== null && v !== rowSaid[0]);
        if (val(it, rc.attr) !== rowSaid[0]) it = setVal(it, rc.attr, rowSaid[0]);
        if (headSaid) notes.push(rc.line.replace("{row}", rowSaid[1]!).replace("{heading}", headSaid[1]!).replace("{value}", rowSaid[0]));
      }
    }
    if (P.same_as_outdoor && ctx.sheetOutdoorBrand) {
      const so = P.same_as_outdoor;
      const said = find(so.words, [rowText, headText, val(it, so.attr)].join(" | "));
      if (said && x2Role(spec, val(it, fa)) !== "outdoor") {
        it = setVal(it, so.attr, ctx.sheetOutdoorBrand.brand);
        // the brand answer itself too, so the item's brand field shows the make it is priced as
        if (so.also_attr) it = setVal(it, so.also_attr, ctx.sheetOutdoorBrand.brand);
        notes.push(so.line.replace("{said}", said).replace("{brand}", ctx.sheetOutdoorBrand.brand).replace("{row}", String(ctx.sheetOutdoorBrand.row)));
      }
    }
    return it;
  });
  return { ext: { ...ext, items: out }, notes: [...new Set(notes)] };
}

const x2Role = (spec: ItemListPricingSpec, fam: string): "indoor" | "outdoor" | undefined => spec.extras?.roles?.[fam];

/** VRF-6. The notes `prepareModelItems` made, as review points on the row's first item (its own extras block when it has none). */
function withPrepNotes(spec: ItemListPricingSpec, res: HelperResult, notes: string[]): HelperResult {
  const r = res as ItemListSuggestion;
  if (!notes.length || !r.itemList || !r.itemList.items.length) return res;
  const title = spec.extras?.safeguard?.lines.review_title ?? "Please review";
  const items = r.itemList.items.map((b, i) => {
    if (i !== 0) return b;
    const ex = b.extras ?? { lines: [], removed: [] };
    const points = [...notes, ...(ex.review?.points ?? [])];
    return { ...b, extras: { ...ex, review: { title: ex.review?.title ?? title, points } } };
  });
  return { ...r, itemList: { ...r.itemList, items } } as HelperResult;
}

/** VRF-6 (00352 r150, 00368 r45, 00370 r8). A unit refused for "no capacity stated" whose own row text states two different
 * capacities says so: "two capacities stated (2.6 TR / 1.3 TR) - pick one" (`extras.two_capacities`). Everything else as is. */
function withTwoCapacities(spec: ItemListPricingSpec, ctx: RowContextWithUnit, res: HelperResult): HelperResult {
  const tc = spec.extras?.two_capacities;
  const r = res as ItemListSuggestion;
  const v = r.itemList;
  if (!tc || !v || v.rowPriced || ctx.noRow) return res;
  const found: string[] = [];
  try {
    for (const m of String(ctx.description ?? "").matchAll(new RegExp(tc.words, "gi"))) {
      const t = `${Number(m[1])} ${String(m[2]).toUpperCase()}`;
      if (!found.includes(t)) found.push(t);
    }
  } catch { return res; }
  if (found.length < 2) return res;
  const line = tc.line.replace("{list}", found.join(" / "));
  const hit = (s: string | undefined) => !!s && s === tc.refusal;
  if (!v.items.some((b) => hit(b.reason)) && !hit(v.reason)) return res;
  const items = v.items.map((b) => (hit(b.reason) ? { ...b, reason: line } : b));
  return { ...r, itemList: { ...v, items, ...(hit(v.reason) ? { reason: line } : {}) },
           workings: { ...(r.workings ?? { attributes: [], matchedRows: [] }), derivation: [line] } } as HelperResult;
}

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
  /** VRF-3b: Electrical's own per-metre cable rate (the helper's compute on that category) -- read by `extras` only */
  cableRate?: CableRate,
): HelperResult {
  const declared = delegatedSections(spec);
  // VRF-3b: a config declaring `extras` (VRF) prices its own items exactly as before, then its units' extra lines
  if (declared.length === 0 && spec.extras) {
    // VRF-6: the model's answers as the owner's reading rules settle them, before pricing (each change noted)
    const prep = prepareModelItems(spec, ctx, ext);
    const probe: OwnPassProbe = {};
    const own = computeItemListOwn(category, spec, items, ctx, prep.ext, inRun, overrides, probe) as ItemListSuggestion;
    const done = own.itemList ? withExtras(spec, items, ctx, prep.ext, overrides, configOf, cableRate, own, probe, category) : own;
    return withTwoCapacities(spec, ctx, withPrepNotes(spec, done, prep.notes));
  }
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
    /** SLICE 12e-6 (AC1): the pipe above is Copper / written as an outside diameter (true), another pipe (false) */
    pipeOd?: boolean,
    /** SLICE 12e-6 (AC3): the MODEL opened this section ("Insulated: Yes") and answered no item for it */
    modelOpened = false,
  ): SectionBlockView => {
    const heading = `${r.s.label} - priced by ${r.cfg ? categoryLabel(r.cfg) : r.s.label}'s rules`;
    if (!r.cfg || !r.dspec) {
      // the delegated category is not in this helper's config map: never price it with any other rules
      const reason = `${r.s.label} cannot be priced here - its rules are not loaded; price it by hand`;
      return { sectionId: r.s.id, heading, pipe, index,
               view: { unit: rowUnit, unitClass: null, unitPickable: false, unitChoices: [], rowPriced: false, reason, items: [], families: [], editState: { items: [] }, modelCount: 0 } };
    }
    const answeredItem = secEdit.base !== null && secEdit.family === null ? secModel[r.s.id]?.[secEdit.base] : undefined;
    /**
     * SLICE 12e-6 (AC3; owner D1b / D5b, 2026-10-12). "Insulated: Yes" on a BoQ row with NO insulation item in the reply:
     * the section opens on the MODEL PATH's defaults, exactly as the delegated category prices a row that mentions none
     * of its facts -- the material by the row-kind default (AC2), the thickness by its ruled default and the ladder,
     * the cladding "None" -> "No" -- each amber with its own line. It used to open with nothing answered and refuse
     * "could not tell cladding". It is the delegated category's own rules on an answer of "not mentioned" (every choice
     * and the family "None"); nothing is decided here. Not the calculator (D1b: there the material starts blank), and not
     * a pipe the pricer added or switched to Yes.
     */
    const dspecNow = r.dspec;
    const modelItem: ExtractedListItem | undefined = answeredItem ?? (modelOpened && !calculator && secEdit.base === null && secEdit.family === null
      ? { attributes: Object.fromEntries([familyAttr(dspecNow), ...dspecNow.choice_attrs].map((a) => [a, { value: "None" }])) }
      : undefined);
    const offered = new Set(r.s.families ?? []);
    const stocked = (fam: string) => items.some((it) => kindIn(r.dspec!, it.kind) && it.attributes?.[familyAttr(r.dspec!)] === fam);
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
      // ADP-1: the mirrored size is marked, so F1 does not read the pipe's mm size as a bare number the BoQ wrote
      ...(mirrored ? { mirrored: [toId!] } : {}),
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
    const res = computeItemListOwn(r.cfg, r.dspec, items, { ...ctx, unit: rowUnit, ...(calculator ? { noRow: true } : {}), ...(mir ? { showHeldDefaultsOn: mir.to } : {}), ...(pipeOd !== undefined ? { pipeOdHint: pipeOd } : {}) }, dext, inRun,
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
      // SLICE 12e-6 (AC1, owner R7): the pipe above -- Copper, or a size written as an outside diameter / inch size --
      // keeps its cladding on the size as read; any other pipe is mm = NB. A pipe with no family tells nothing.
      const pipeRaw = r.s.mirror
        ? (hasOwn(edit.attrs, r.s.mirror.from) ? edit.attrs[r.s.mirror.from] : (isModelItem ? ownModel[edit.base!]?.attributes?.[r.s.mirror.from]?.value : undefined))
        : undefined;
      const pipeOd = own?.family ? (/\bcopper\b/i.test(own.family) || sizeIsOutsideDiameter(pipeRaw ?? null)) : undefined;
      const opened = typed === undefined && !modelSection && modelSaid === inc.equals;
      attached.push(priceSection(r, secEdit, i, 0, r.s.mirror ? mirroredNumber(own, r.s.mirror.from) : undefined, b.qty, pipeRefusal, pipeOd, opened));
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
          && items.some((it) => kindIn(r.dspec!, it.kind) && it.attributes?.[familyAttr(r.dspec!)] === f.family)),
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
function plainItemListView(view: ItemListView, p: (s: string) => string, spec?: ItemListPricingSpec): ItemListView {
  // ADP-4a (owner AC2): on the plain item wording the working reads in words and the family's sentinel answers by
  // their display names; every other category's view is mapped exactly as before
  const plainWords = !!spec && plainItemListWording(spec);
  const shown = (f: string | null): string | undefined => {
    if (!plainWords || f === null) return undefined;
    const d = familyDisplayName(spec!, f);
    return d !== f ? d : undefined;
  };
  return {
    ...view,
    ...(view.reason !== undefined ? { reason: p(view.reason) } : {}),
    ...(view.unitNote !== undefined ? { unitNote: p(view.unitNote) } : {}),
    items: view.items.map((b) => ({
      ...b,
      ...(shown(b.family) ? { familyLabel: shown(b.family)! } : {}),
      ...(shown(b.familyRaw) ? { familyRawLabel: shown(b.familyRaw)! } : {}),
      ...(b.reason !== undefined ? { reason: p(b.reason) } : {}),
      ...(b.skuLine !== undefined ? { skuLine: p(b.skuLine) } : {}),
      ...(b.familyDefaulted ? { familyDefaulted: { ...b.familyDefaulted, rule: p(b.familyDefaulted.rule) } } : {}),
      // SLICE 12e-2: the family line and the family control's note are display strings; `typedValue` and the
      // options are what the control matches on and are never touched
      ...(b.familyLine !== undefined ? { familyLine: p(b.familyLine) } : {}),
      ...(b.familyControl ? { familyControl: { ...b.familyControl, ...(b.familyControl.note !== undefined ? { note: p(b.familyControl.note) } : {}) } } : {}),
      working: plainWords ? plainWorking(b.working.map(p)) : b.working.map(p),
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
  /** VRF-3a (U2): "Reset to the helper's split" -- every line of a split goes, the entry each split replaced comes back,
   *  and the row splits again at the next compute */
  | { op: "reset_split" }
  /** VRF-6 U11 (owner 18:52): step entry `index` (a helper line = its whole split) to option `option` of the helper's ranked
   *  singles / pairs (0 = back to the helper's pick). The split's entry comes back carrying the choice and the row re-prices
   *  from it -- every split of the row comes back, as "Reset to the helper's split" does, since a row splits only whole. */
  | { op: "cover_option"; index: number; option: number }
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
  | { op: "remove_section"; section: string; index: number }
  /** VRF-3b (U1 / U3): the pricer's value in one field of one extra line of unit `index` */
  | { op: "extra_set"; index: number; line: string; field: string; value: string }
  /** VRF-3b (U8): the undo arrow beside a changed extra field -- back to its default / BoQ value */
  | { op: "extra_undo"; index: number; line: string; field: string }
  /** VRF-3b (U5): the x of an extra line (copper takes its insulation) -- recorded in the hidden tag */
  | { op: "extra_remove"; index: number; line: string }
  /** VRF-3b (U5): "Put it back" */
  | { op: "extra_restore"; index: number; line: string }
  /** VRF-3b (U8, owner 14:20 / 14:56): the undo arrow beside a changed quantity -- the assumed 1 (or the model's) again */
  | { op: "undo_qty"; index: number };

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
      // VRF-2b (QR-1 U1 A): a pick from the list (the select's one operation) drops the unit picker's value too
      if (op.other === false) delete at(op.index).attrs[`${op.id}${UNIT_PICK_SUFFIX}`];
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
      // VRF-2b (owner QR-1 U1 A: "picking a size from the dropdown needs no picker -- the option already says its unit";
      // found in the cert): closing the typed box -- a real pick or "- select -" -- drops the unit picker's value, so a picked
      // "1.5TR" is never read in a unit left over from the box (it priced as 1.5 kW). An item without a picker is unchanged.
      if (!op.on) delete at(op.index).attrs[`${op.id}${UNIT_PICK_SUFFIX}`];
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
    case "cover_option": {
      const t = at(op.index);
      if (!t) return state;
      const withCover = (e: ItemEdit): ItemEdit => {
        const { cover: _c, ...rest } = e;
        return op.option > 0 ? { ...rest, cover: op.option } : rest;
      };
      if (!t.helper) {
        items[op.index] = withCover(t);
        return done(items);
      }
      const g = t.helper.g;
      const seen = new Set<number>();
      const out: ItemEdit[] = [];
      for (const e of items) {
        if (!e.helper) { out.push(e); continue; }
        if (seen.has(e.helper.g)) continue;
        seen.add(e.helper.g);
        const from = { ...e.helper.from, attrs: { ...e.helper.from.attrs } };
        out.push(e.helper.g === g ? withCover(from) : from);
      }
      return done(out);
    }
    case "reset_split": {
      const seen = new Set<number>();
      const out: ItemEdit[] = [];
      for (const e of items) {
        if (!e.helper) { out.push(e); continue; }
        if (seen.has(e.helper.g)) continue;
        seen.add(e.helper.g);
        // VRF-6 U11: back to the HELPER's split -- a stepped option goes too
        const { cover: _c, ...from } = e.helper.from;
        out.push({ ...from, attrs: { ...from.attrs } });
      }
      return done(out);
    }
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
    case "undo_qty":
      if (!at(op.index)) return state;
      delete at(op.index).qty;
      return done(items);
    case "extra_set":
    case "extra_undo":
    case "extra_remove":
    case "extra_restore": {
      if (!at(op.index)) return state;
      const cur = at(op.index).extras ?? {};
      const set: Record<string, Record<string, string>> = Object.fromEntries(Object.entries(cur.set ?? {}).map(([k, v]) => [k, { ...v }]));
      const removed = new Set(cur.removed ?? []);
      if (op.op === "extra_set") (set[op.line] ??= {})[op.field] = op.value;
      if (op.op === "extra_undo" && set[op.line]) { delete set[op.line][op.field]; if (!Object.keys(set[op.line]).length) delete set[op.line]; }
      if (op.op === "extra_remove") removed.add(op.line);
      if (op.op === "extra_restore") removed.delete(op.line);
      const next: ExtrasEdit = { ...(Object.keys(set).length ? { set } : {}), ...(removed.size ? { removed: [...removed] } : {}) };
      if (Object.keys(next).length) at(op.index).extras = next; else delete at(op.index).extras;
      return done(items);
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
export function itemsOnScreen(view: ItemListView): Array<{ family: string | null; source: "model" | "user" | "helper"; attributes: Record<string, string>; qty: string }> {
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

