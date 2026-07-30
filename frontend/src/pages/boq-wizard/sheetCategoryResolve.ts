// HV-10 -- pure helpers for the multi-engine pricing editor. No React, no discipline named:
// everything is generic over the disciplines present in the data. Unit-tested in
// sheetCategoryResolve.test.ts (the codebase's pure-helper pattern, ADR-0010 F4).

import type {
  ClassifyScope,
  EngineCatalog,
  ResolvedSheetCategory,
  SheetCategoryRow,
} from "./boqTypes";
// TYPE-ONLY (erased at build): the tooltip's `state` parameter is defined as exactly what
// deriveVerdictState returns, so the two cannot drift. No runtime import, so no module edge.
import type { deriveVerdictState } from "./CategoryVerdictPicker";

/** The three carry-provenance fields the tooltip reads -- nothing else about the row. */
type CarriedProvenance = Pick<
  SheetCategoryRow,
  "carried_from_boq" | "carried_from_version" | "carried_from_other_boq"
>;

/**
 * Adapt a server-resolved row onto the grid's SheetCategoryRow shape, so PricingGrid +
 * deriveVerdictState render off the same triple they always have.
 *
 * The ladder already picked the effective verdict; we only translate its `effective_source` into
 * the (effective_category_id, human_category_id, routing) triple the existing pure renderers read:
 *   - "human" -> human wins  -> deriveVerdictState = "human"        (emerald "your pick")
 *   - "auto"  -> a category  -> routing "Auto-accepted"            -> "auto"
 *   - "blank" -> no category -> routing "Needs review", blank      -> "unclassified" + amber, and
 *                counts in the Check-Category filter (isMasterSetBlank true)
 *
 * cross_engine_conflict, review_priority and the per-discipline votes are DELIBERATELY DROPPED --
 * they are telemetry and MUST NOT reach any rendered surface (owner ruling).
 *
 * ⚠️ ADR-0014 Amendment E adds `carried_from_boq`, which is NOT telemetry and MUST reach the
 * surface: it is the ONE input to the "carried" cell state, which marks every row inherited from
 * the original. Without it a carried verdict renders identically to one decided on this sheet --
 * for a HUMAN verdict that means emerald "your pick", attributing to this reviewer a decision
 * someone else made on another BoQ. That indistinguishability is what made Amendment D delete the
 * annotation carry outright, so dropping this field here would re-create the defect the whole
 * amendment exists to avoid.
 *
 * ⚠️ Amendment F (R3) adds `carried_from_version`, the other half of that pair, on the same
 * not-telemetry footing. Within ONE BoQ it is the only half that carries information -- the source
 * and the destination are the same BoQ there, so naming the BoQ names what the reader is already
 * looking at.
 */
export function resolvedToSheetCategoryRow(r: ResolvedSheetCategory): SheetCategoryRow {
  const isBlank = r.effective_source === "blank";
  return {
    excel_row: r.excel_row,
    rule_category_id: "",
    ai_category_id: "",
    final_category_id: isBlank ? "" : r.effective_category_id,
    routing: isBlank ? "Needs review" : "Auto-accepted",
    routing_reason: "",
    human_category_id: r.human_category_id ?? "",
    effective_category_id: r.effective_category_id ?? "",
    carried_from_boq: r.carried_from_boq ?? null,
    // Amendment F (R3): the VERSION half of the provenance pair, passed through for the same
    // reason -- and within one BoQ it is the ONLY half that says anything, since there the source
    // and the destination are the same BoQ. `?? null` normalises only absent/null; a legitimate 0
    // (the server's NOT-NULL Int default on an uncarried row) passes through VERBATIM.
    carried_from_version: r.carried_from_version ?? null,
    // Amendment F (R16): which of the two halves is the informative one. It CANNOT be re-derived
    // downstream -- the grid is never told which BoQ it is rendering -- so dropping it here would
    // leave the tooltip with no way to tell the two carries apart. `?? null` again keeps a
    // legitimate `false` false.
    carried_from_other_boq: r.carried_from_other_boq ?? null,
  };
}

/**
 * The Category cell's tooltip: the whole `title` string, or undefined when there is nothing to
 * say. Extracted from the grid's JSX so owner ruling R3 is enforceable by ASSERTION -- this repo
 * has no DOM environment (`environment: "node"`, deliberate), so a string built inline in a
 * `title=` attribute is untestable. Same reasoning as `carryChangesPhrase` (R13).
 *
 * `state` is whatever `deriveVerdictState` returned, tied to it by construction (a type-only
 * import, fully erased at runtime -- no module edge, no cycle) so the two can never drift.
 *
 * PURE. The caller does no comparison and needs no knowledge of which BoQ it is rendering; R16
 * put that decision on the server, which is the only place holding both operands.
 */
export function categoryCellTitle(
  label: string,
  state: ReturnType<typeof deriveVerdictState>,
  cat: CarriedProvenance | undefined,
): string | undefined {
  if (state === "human") return `${label} (your pick)`;
  if (state === "carried") return `${label} (carried from ${carriedFromNoun(cat)})`;
  return label || undefined;
}

/**
 * What to call the place a carried verdict came from.
 *
 * VERSION only when the server positively said the source was this same BoQ AND gave a real
 * version. Everything else -- a cross-BoQ carry, a pre-R16 payload with no signal, or a carry
 * stamped at version 0 (which is what an UNCARRIED row reads on that NOT-NULL Int column, so it
 * is never a real source version) -- falls back to naming the BoQ, which is the wording that
 * shipped first and is correct wherever the reader is not already looking at that BoQ.
 */
function carriedFromNoun(cat: CarriedProvenance | undefined): string {
  const version = cat?.carried_from_version;
  if (cat?.carried_from_other_boq === false && version) return `Version ${version}`;
  return `${cat?.carried_from_boq}`;
}

/**
 * Should a classify socket/poll event for `discipline` be accepted? Membership in the sheet's
 * ran disciplines UNION any currently launching/running ones -- so a FIRST-EVER run on a fresh
 * sheet (no ran disciplines yet) is not discarded, while events for an unrelated discipline are.
 * Replaces the old `=== CLASSIFY_DISCIPLINE` equality that discarded every non-Electrical event.
 */
export function acceptClassifyEvent(
  discipline: string,
  ranDisciplines: readonly string[],
  runningDisciplines: readonly string[],
): boolean {
  return ranDisciplines.includes(discipline) || runningDisciplines.includes(discipline);
}

/** Remove one terminated discipline from the running set (order-stable, dedup-safe). */
export function removeRunningDiscipline(
  running: readonly string[],
  done: string,
): string[] {
  return running.filter((d) => d !== done);
}

/** Union of the launched disciplines into the running set (dedup, order-stable). */
export function addRunningDisciplines(
  running: readonly string[],
  launched: readonly string[],
): string[] {
  const out = [...running];
  for (const d of launched) if (!out.includes(d)) out.push(d);
  return out;
}

/**
 * The picker's engine groups for a sheet: ONE catalog per ran-discipline, in the resolved read's
 * order, labelled from the engine registry (falling back to the discipline string). A ran
 * discipline with no fetched catalog yet is skipped (it appears once its catalog lands).
 * N-generic: no discipline is named.
 */
export function buildSheetEngineCatalogs(
  ranDisciplines: readonly string[],
  catalogsByDiscipline: Readonly<Record<string, EngineCatalog>>,
  labelByDiscipline: Readonly<Record<string, string>>,
): EngineCatalog[] {
  const out: EngineCatalog[] = [];
  for (const d of ranDisciplines) {
    const cat = catalogsByDiscipline[d];
    if (!cat) continue;
    out.push({
      discipline: d,
      label: labelByDiscipline[d] ?? d,
      categories: cat.categories,
    });
  }
  return out;
}

// ── HV-10b: completion summary = COMBINED EFFECTIVE outcome ─────────────────────────
// Owner ruling (2026-07-22): the "xx classified, yy flagged for review" completion message must
// report the COMBINED effective outcome (what the grid shows), not a per-engine denominator. It is
// computed from the resolved read (the grid's source of truth), scoped to the union of the run
// set's row range(s).

/**
 * The row scope a completion summary covers: the WHOLE sheet, or an explicit set of Excel rows
 * (the union of one run set's per-engine ranges). Whole-sheet DOMINATES a mixed union: if any
 * engine in the run set ran whole-sheet, the union is the whole sheet.
 */
export type ScopeUnion = { mode: "sheet" } | { mode: "rows"; rows: number[] };

/**
 * Fold one run set's per-engine scopes into a single ScopeUnion (owner condition 1):
 *   - any `{mode:"sheet"}` present            -> `{mode:"sheet"}` (whole-sheet dominates)
 *   - all ranges                              -> `{mode:"rows"}` = every Excel row any range covers
 *   - empty / unknown (defensive)             -> `{mode:"sheet"}` (never UNDER-report a run's rows)
 * PURE + stateless: each call depends only on the scopes passed, so a fresh run set that calls this
 * with only its own scopes RESETS the union (no carry from a prior run set -- the reset semantics
 * the page relies on by REPLACING its ref each onStarted).
 */
export function unionScopes(scopes: readonly ClassifyScope[]): ScopeUnion {
  if (scopes.length === 0) return { mode: "sheet" };
  if (scopes.some((s) => s.mode === "sheet")) return { mode: "sheet" };
  const rows = new Set<number>();
  for (const s of scopes) {
    if (s.mode === "range") {
      for (let r = s.start; r <= s.end; r++) rows.add(r);
    }
  }
  return { mode: "rows", rows: [...rows].sort((a, b) => a - b) };
}

/**
 * The COMBINED EFFECTIVE completion summary over the resolved read, scoped to `rangeUnion`:
 *   - categorised = rows whose EFFECTIVE verdict is non-blank (an auto-accept OR a human verdict --
 *                   so a pre-existing human verdict counts as categorised, owner condition)
 *   - review      = rows whose effective verdict is blank (the blank-review law)
 * Whole-sheet scope counts every resolved row; a rows scope counts only rows in the union. This is
 * the SAME split the grid renders, so the message and the grid agree by construction. A single
 * whole-sheet engine with no human verdicts yields exactly the engine's own (auto-accept / review)
 * numbers -- the equality-by-construction guarantee (tested).
 */
export function summariseResolvedOutcome(
  resolvedRows: readonly Pick<ResolvedSheetCategory, "excel_row" | "effective_category_id">[],
  rangeUnion: ScopeUnion,
): { categorised: number; review: number } {
  const inScope =
    rangeUnion.mode === "sheet"
      ? () => true
      : (excelRow: number) => rangeUnion.rows.includes(excelRow);
  let categorised = 0;
  let review = 0;
  for (const r of resolvedRows) {
    if (!inScope(r.excel_row)) continue;
    if ((r.effective_category_id ?? "").trim()) categorised++;
    else review++;
  }
  return { categorised, review };
}
