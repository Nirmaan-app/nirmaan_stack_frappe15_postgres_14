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
  Pipeline,
  PipelineResult,
  RateCategoryConfig,
  RateMasterItem,
} from "@/pages/pricing/rate-master/rateMasterTypes";
import { sortAttrNotes } from "./rateHelperTypes";
import type {
  AttrNote,
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

  return attrs.map((a) => {
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
        return {
          ...a,
          derived: true,
          derivedValue: cf.fitted,
          substituted: cf.substituted || restsOnASubstitutedFact,
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
      ...(ladder.upgraded && ladder.label ? { substituted: true } : {}),
      ...(ladder.upgraded && ladder.label
        ? {
            notes: [
              {
                kind: "upgrade" as const,
                stated: ladder.upgraded.stated,
                statedHolds: ladder.upgraded.statedHolds,
                occupied: ladder.upgraded.occupied,
                using: ladder.label,
              },
            ],
          }
        : {}),
    };
  });
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
    // The attributes THIS config computes rather than accepts -- a blank one is not missing input.
    const derived = derivedAttrIds(category);
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
    const unfillableDerived = new Set<string>();
    for (const [resultAttr, src] of mapAttributeSources(category)) {
      if (src.hasDefault) continue; // the curve-else-C shape: always fillable, never narrowed
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
      const cell = ext?.attributes[d.id];
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
      }
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
          // DERIVED DISPLAY: no pipeline runs on this path, so there is no computed value to show --
          // but the derived attributes must still not be flagged as the thing that is missing. The
          // red borders that remain are the GENUINE missing inputs, which is exactly the narrowing
          // this slice is: fewer fields flagged, and every one that still is, really is.
          attributes: applyDerivedDisplay(workingsAttrs, category, [], fillableDerived),
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
    // DERIVED DISPLAY: keep every result so the derived attributes can be filled from what the
    // pipelines actually computed (a category may split supply/install across pipelines).
    const pipelineResults: PipelineResult[] = [];
    surfaced.forEach(([pid, pl], idx) => {
      const res = runPipeline(pid, pl as Pipeline, items, selected);
      pipelineResults.push(res);
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
        attributes: applyDerivedDisplay(workingsAttrs, category, pipelineResults, fillableDerived),
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
      pipelineResults.push(tr);
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
      attributes: applyDerivedDisplay(workingsAttrs, config, pipelineResults),
      matchedRows,
      derivation,
      finalValues: { ...values },
      ...(sections ? { sections } : {}),
    },
  };
}
