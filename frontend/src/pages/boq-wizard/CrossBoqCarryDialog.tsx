/**
 * CrossBoqCarryDialog -- the review-before-apply surface for cross-BOQ RATE carry (S10 / #1106,
 * ADR-0014 D9). Launched from the BoQ hub footer AFTER a revision is committed: it pulls the
 * ORIGINAL's committed rates across into the revision, whole-BOQ, one explicit action.
 *
 * This is the same-BOQ CopyForwardDialog pointed cross-BOQ + made multi-sheet. It fetches the
 * server-classified per-sheet plan (get_cross_boq_carry_plan), renders a SUMMARY-FIRST per-sheet
 * view (counts + a sheet-level tick; conflicts always shown, clean rows folded behind an expander,
 * skips listed muted), collects the user's decisions, and POSTs start_cross_boq_carry (a long
 * job). The SERVER re-derives every outcome + target column + rate (a client-supplied outcome /
 * column / rate is NEVER trusted); the hard skips (removed / no_rate_column / non_priceable) are
 * shown but never selectable. NEW dest rows never enter the plan -- they are
 * reported as "M rows need new values" and found via the pricing editor's "Show unpriced" filter.
 *
 * Decision identity is DESTINATION-keyed (dest_excel_row, area, rate_kind) -- source and dest
 * excel rows differ under D6 (match on description, not row number). A sheet blocked by the
 * mandatory amount-formula gate (formulas_complete=false) is shown UNTICKED + labelled, never
 * silently skipped. On apply the dialog hands the job_id + the total needs-new-value count up to
 * the hub (which owns the socket lifecycle + the results modal) and closes.
 */
import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";
import { CARRY_LAYER_KEYS } from "./boqTypes";
import type {
  ApplySheetCarryResponse,
  CrossBoqCarryCounts,
  CrossBoqCarryDecision,
  CrossBoqCarryPlanRow,
  CrossBoqCarrySheet,
  GetCrossBoqCarryPlanResponse,
} from "./boqTypes";
// WBC-W1-S1: the opt-in layer choice (block + pure helpers) lives in the shared CarryLayers module
// so the within-BoQ carry surface can reuse it instead of importing out of this dialog.
import {
  CarryLayersBlock,
  LAYER_LABEL,
  armedLayerReplacements,
  buildLayersPayload,
  carryChangesPhrase,
  carrySelectionSummary,
  carryWriteCount,
  countPhrase,
  initialLayerChoices,
  joinPhrases,
  nothingToCarry,
  type LayerChoices,
} from "./CarryLayers";

export const CROSS_BOQ_CARRY_PLAN_METHOD =
  "nirmaan_stack.api.boq.wizard.cross_boq_carry.get_cross_boq_carry_plan";

// ── Pure helpers (vitest-tested in CrossBoqCarryDialog.test.ts) ────────────────────

/** The per-CELL identity key, qualified by sheet (the dialog is whole-BOQ). A row can carry
 *  several rate cells -- one per area / rate_kind. `\0` separates the sheet (sheet names never
 *  contain NUL) so a sheet's rows never collide with another's. */
export function cellKey(
  sheetName: string,
  row: Pick<CrossBoqCarryPlanRow, "dest_excel_row" | "area" | "rate_kind">,
): string {
  return `${sheetName}\0${row.dest_excel_row}|${row.area ?? ""}|${row.rate_kind}`;
}

/** A writable row is a clean copy (2) or a conflict (3); a hard skip (1) is never writable.
 *  Writable rows always carry a non-null dest_excel_row by construction (a skip may not). */
export function isWritable(row: CrossBoqCarryPlanRow): boolean {
  return row.outcome === 2 || row.outcome === 3;
}

/** The writable cell keys for one sheet (drives the sheet-level tick / select-all). */
export function sheetWritableKeys(sheet: CrossBoqCarrySheet): string[] {
  return sheet.plan.filter(isWritable).map((r) => cellKey(sheet.sheet_name, r));
}

/**
 * The default dialog state: every writable cell of an UNBLOCKED sheet pre-selected; conflicts
 * default to KEEP (overwrite=false) so a plain confirm copies the clean ones and touches no
 * existing rate. A BLOCKED sheet (formulas_complete=false) starts fully unticked -- the server
 * would reject it, so it must not carry.
 */
export function initialSelection(sheets: CrossBoqCarrySheet[]): {
  selected: Set<string>;
  overwrite: Record<string, boolean>;
} {
  const selected = new Set<string>();
  const overwrite: Record<string, boolean> = {};
  for (const sheet of sheets) {
    if (!sheet.formulas_complete) continue; // blocked -> unticked
    for (const row of sheet.plan) {
      if (!isWritable(row)) continue;
      const key = cellKey(sheet.sheet_name, row);
      selected.add(key);
      if (row.outcome === 3) overwrite[key] = false; // default KEEP
    }
  }
  return { selected, overwrite };
}

/** Bulk set every CONFLICT row's overwrite flag for ONE sheet (its "overwrite all" / "keep all"). */
export function applyBulkOverwrite(
  sheet: CrossBoqCarrySheet,
  value: boolean,
): Record<string, boolean> {
  const overwrite: Record<string, boolean> = {};
  for (const row of sheet.plan) {
    if (row.outcome === 3) overwrite[cellKey(sheet.sheet_name, row)] = value;
  }
  return overwrite;
}

/** How many SELECTED conflict cells have overwrite armed -- the destructive footer's count.
 *  AMENDMENT D: before, the footer covered only the annotation layers, so once those were removed
 *  the dialog's one destructive warning would have gone with them -- while an armed rate overwrite
 *  (which replaces a rate the user may have typed by hand) stayed silent. It now reports exactly
 *  that. Pure; unit-tested. */
export function armedRateOverwrites(
  sheet: CrossBoqCarrySheet | null | undefined,
  selected: Set<string>,
  overwrite: Record<string, boolean>,
): number {
  if (!sheet) return 0;
  return sheet.plan.filter(
    (row) =>
      row.outcome === 3 &&
      selected.has(cellKey(sheet.sheet_name, row)) &&
      !!overwrite[cellKey(sheet.sheet_name, row)],
  ).length;
}

/** Build the per-sheet apply payload from the current selection + per-conflict overwrite choices.
 *  Destination-keyed; a sheet with no selected cell is OMITTED (a sheet absent from
 *  decisions_by_sheet is skipped server-side, same as an empty list). */
export function buildDecisionsBySheet(
  sheets: CrossBoqCarrySheet[],
  selected: Set<string>,
  overwrite: Record<string, boolean>,
): Record<string, CrossBoqCarryDecision[]> {
  const out: Record<string, CrossBoqCarryDecision[]> = {};
  for (const sheet of sheets) {
    const decisions: CrossBoqCarryDecision[] = [];
    for (const row of sheet.plan) {
      if (!isWritable(row)) continue;
      const key = cellKey(sheet.sheet_name, row);
      if (!selected.has(key)) continue;
      decisions.push({
        dest_excel_row: row.dest_excel_row as number,
        area: row.area,
        rate_kind: row.rate_kind,
        overwrite: row.outcome === 3 ? !!overwrite[key] : false,
      });
    }
    if (decisions.length > 0) out[sheet.sheet_name] = decisions;
  }
  return out;
}

export interface PlanTotals {
  writableCells: number; // clean + conflict across all sheets (carry candidates)
  cleanCells: number;
  conflictCells: number;
  skipCells: number;
  needsNewValues: number; // sum of needs_new_value_count (D6 NEW priceable dest rows)
  blockedSheets: string[]; // sheets with formulas_complete === false
  totalSheets: number;
}

/** Roll the whole-BOQ plan up for the dialog summary + the results modal's needs-new-value figure. */
export function planTotals(sheets: CrossBoqCarrySheet[]): PlanTotals {
  const t: PlanTotals = {
    writableCells: 0,
    cleanCells: 0,
    conflictCells: 0,
    skipCells: 0,
    needsNewValues: 0,
    blockedSheets: [],
    totalSheets: sheets.length,
  };
  for (const sheet of sheets) {
    const c = sheet.counts;
    t.cleanCells += c.clean;
    t.conflictCells += c.conflict;
    t.writableCells += c.clean + c.conflict;
    t.skipCells += c.removed + c.no_rate_column + c.non_priceable;
    t.needsNewValues += sheet.needs_new_value_count;
    if (!sheet.formulas_complete) t.blockedSheets.push(sheet.sheet_name);
  }
  return t;
}

export interface SheetCountsDisplay {
  copy: number;
  conflicts: number;
  skipped: number;
}

/** Split one sheet's server counts into the summary line's copy / conflicts / skipped figures. */
export function sheetCountsDisplay(sheet: CrossBoqCarrySheet): SheetCountsDisplay {
  const c: CrossBoqCarryCounts = sheet.counts;
  return {
    copy: c.clean,
    conflicts: c.conflict,
    skipped: c.removed + c.no_rate_column + c.non_priceable,
  };
}

// ── AMENDMENT C / C3: the pricing-screen button's state ────────────────────────────

/** The four disabled reasons, as the tooltip copy the button shows. Module-level so the button and
 *  its tests read the SAME strings. */
export const CARRY_DISABLED_REASON = {
  loading: "Checking what can be carried from the original…",
  locked: "This sheet is read-only right now.",
  formulas: "Declare the amount formulas for this sheet first.",
  nothing: "Nothing left to carry from the original.",
} as const;

export type CarryButtonState =
  | { kind: "hidden" }
  | { kind: "disabled"; reason: string }
  | { kind: "ready"; rateCells: number };

/**
 * The pricing-screen "Carry rates from original" button's state (ADR-0010 F4 -- the rule is pure
 * and unit-tested; the page only renders it).
 *
 * Precedence is deliberate: HIDDEN off a revision (there is no original, so the action does not
 * exist); then the transient loading state; then LOCKED (the dominant fact -- no write of any kind
 * can land); then the formula gate (the one actionable blocker); then "nothing to carry".
 *
 * ⚠️ AMENDMENT D: readiness is RATES ONLY. `conflict` still counts toward "something to carry" --
 * an already-filled dest rate is real work the dialog can do (overwrite) -- but a sheet whose only
 * carryable content was annotations is now correctly "nothing to carry", because the annotation
 * carry no longer exists.
 */
export function carryButtonState(input: {
  isRevisionSheet: boolean;
  loading: boolean;
  locked: boolean;
  formulasComplete: boolean;
  sheet: CrossBoqCarrySheet | null | undefined;
}): CarryButtonState {
  if (!input.isRevisionSheet) return { kind: "hidden" };
  if (input.loading) return { kind: "disabled", reason: CARRY_DISABLED_REASON.loading };
  // No plan entry for this sheet = no mapped source sheet (a declared-New sheet, or a source with
  // no committed version). Nothing to carry, ever -- not a transient state.
  if (!input.sheet) return { kind: "disabled", reason: CARRY_DISABLED_REASON.nothing };
  if (input.locked) return { kind: "disabled", reason: CARRY_DISABLED_REASON.locked };
  if (!input.formulasComplete) {
    return { kind: "disabled", reason: CARRY_DISABLED_REASON.formulas };
  }
  const rateCells = input.sheet.counts.clean + input.sheet.counts.conflict;
  if (rateCells === 0) {
    return { kind: "disabled", reason: CARRY_DISABLED_REASON.nothing };
  }
  return { kind: "ready", rateCells };
}

/** One sheet's rate decisions (the single-sheet apply payload -- the whole-BoQ builder above stays
 *  for the hub path until C6 removes it). */
export function buildDecisions(
  sheet: CrossBoqCarrySheet | null | undefined,
  selected: Set<string>,
  overwrite: Record<string, boolean>,
): CrossBoqCarryDecision[] {
  if (!sheet) return [];
  return buildDecisionsBySheet([sheet], selected, overwrite)[sheet.sheet_name] ?? [];
}

/** The post-apply summary line for the pricing screen (single-sheet mode). Reports what LANDED
 *  (a clean copy and an overwrite both landed), what was deliberately left alone, and the rows the
 *  carry could never help with -- pointing at the "Show unpriced" filter in the same screen, which
 *  is the owner-chosen review surface for them.
 *
 *  ⚠️ AMENDMENT E: rates are no longer the only thing that can land, so the "nothing" branch keys
 *  off EVERY axis. Reporting "Nothing was carried." after a category-only carry would be flatly
 *  false -- and it is the likeliest shape of all, since a freshly committed revision whose rates
 *  all conflict can still take the full category set. */
export function summarizeSheetCarry(
  summary: ApplySheetCarryResponse | null | undefined,
  needsNewValues: number,
): string {
  const rates = (summary?.copied ?? 0) + (summary?.conflicts_overwritten ?? 0);
  const kept = summary?.conflicts_kept ?? 0;

  // What actually landed, per axis. A layer's `replaced` rows landed just as much as its `carried`
  // ones -- the difference is only whether something was displaced on the way in.
  const landed: string[] = [];
  if (rates > 0) landed.push(countPhrase(rates, "rate", "rates"));
  for (const key of CARRY_LAYER_KEYS) {
    const outcome = summary?.layers?.[key];
    if (!outcome) continue; // the layer did not run at all
    const n = outcome.carried + outcome.replaced;
    if (n > 0) landed.push(`${n} ${LAYER_LABEL[key].toLowerCase()}`);
  }

  const parts: string[] = [];
  if (landed.length === 0) {
    parts.push("Nothing was carried.");
  } else {
    parts.push(`Carried ${joinPhrases(landed)}.`);
  }
  if (kept > 0) {
    parts.push(`${kept} existing rate${kept === 1 ? "" : "s"} left as ${kept === 1 ? "it was" : "they were"}.`);
  }
  if (needsNewValues > 0) {
    parts.push(
      `${needsNewValues} row${needsNewValues === 1 ? "" : "s"} still need${needsNewValues === 1 ? "s" : ""} a rate — use “Show unpriced”.`,
    );
  }
  return parts.join(" ");
}

/** Human labels for the three PLAN skip reasons (shown on the muted per-sheet skip list). */
export const SKIP_REASON_LABEL: Record<NonNullable<CrossBoqCarryPlanRow["skip_reason"]>, string> = {
  removed: "Removed in the revision",
  no_rate_column: "Rate column not in the revision",
  non_priceable: "Not priceable in the revision",
};

/**
 * How many rate cells the apply will actually WRITE: every selected CLEAN copy, plus the selected
 * CONFLICTS whose Overwrite is armed. A selected conflict left on KEEP writes nothing.
 *
 * ⚠️ Why this is not just `selected.size`. The conflict rows are pre-SELECTED with Keep as their
 * default, so on a sheet that has already been carried once every rate is "selected" and none of
 * them will move. Counting the raw selection made the dialog promise "Will carry 12 rates" and the
 * post-apply line answer "Nothing was carried. 12 existing rates left as they were." -- observed
 * live on a re-run. The layer half already respected the choice (`layerMoveCount`), so the two
 * halves of one sentence disagreed with each other.
 *
 * The apply GATE deliberately still keys off the raw selection: pressing Carry on an all-Keep sheet
 * is a harmless no-op that reports honestly, and disabling the button there would be a separate
 * behaviour change.
 */
export function rateWriteCount(
  sheet: CrossBoqCarrySheet | null | undefined,
  selected: Set<string>,
  overwrite: Record<string, boolean>,
): number {
  if (!sheet) return 0;
  return sheet.plan.filter((row) => {
    const key = cellKey(sheet.sheet_name, row);
    if (!selected.has(key)) return false;
    if (row.outcome === 2) return true; // clean copy -> always writes
    return row.outcome === 3 && !!overwrite[key]; // conflict -> only when armed
  }).length;
}

/** The same figure across every sheet -- the WHOLE-BoQ button's count (WBC-S3a / R11). That path
 *  offers no layer choice, so rates are all it can write; but it named `selected.size`, which is the
 *  identical selection-vs-writes lie the single-sheet line was fixed for at 313697e7. */
export function rateWriteCountAll(
  sheets: CrossBoqCarrySheet[],
  selected: Set<string>,
  overwrite: Record<string, boolean>,
): number {
  return sheets.reduce((n, sheet) => n + rateWriteCount(sheet, selected, overwrite), 0);
}

// ── Component ──────────────────────────────────────────────────────────────────────

interface CrossBoqCarryDialogProps {
  open: boolean;
  /** The committed REVISION (destination). */
  boqId: string;
  /** The committed ORIGINAL (advisory -- the server re-derives identity from BOQs.source_boq). */
  sourceBoq: string;
  /** AMENDMENT C / C3: scope the dialog to ONE sheet (the pricing editor's launch point). Omitted
   *  = the legacy whole-BoQ hub dialog, removed at C6. The plan is fetched with the SAME
   *  `sheet_names` argument the page uses for the button's eligibility, so SWR serves both from one
   *  request and the dialog opens instantly. */
  sheetName?: string;
  onClose: () => void;
  /** Called on a successful enqueue with the total D6-NEW priceable rows (so the hub's results modal
   *  can report "N carried -- M rows need new values"). The carry status poll is keyed by dest_boq,
   *  so the job id is not needed. LEGACY whole-BoQ path only (removed at C6). */
  onStarted?: (needsNewValues: number) => void;
  /** Single-sheet mode: the apply is SYNCHRONOUS, so the summary comes straight back. */
  onApplied?: (summary: ApplySheetCarryResponse, needsNewValues: number) => void;
}

export function CrossBoqCarryDialog({
  open,
  boqId,
  sourceBoq,
  sheetName,
  onClose,
  onStarted,
  onApplied,
}: CrossBoqCarryDialogProps) {
  const { data, isLoading } = useFrappeGetCall<{ message: GetCrossBoqCarryPlanResponse }>(
    "nirmaan_stack.api.boq.wizard.cross_boq_carry.get_cross_boq_carry_plan",
    {
      dest_boq: boqId,
      source_boq: sourceBoq,
      ...(sheetName ? { sheet_names: JSON.stringify([sheetName]) } : {}),
    },
    open ? undefined : null,
  );
  const { call: startCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.cross_boq_carry.start_cross_boq_carry",
  );
  const { call: applyCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.cross_boq_carry.apply_sheet_carry",
  );

  const sheets = useMemo(() => data?.message?.sheets ?? [], [data]);
  const totals = useMemo(() => planTotals(sheets), [sheets]);
  // AMENDMENT C / C4. Single-sheet mode = the pricing editor's launch point; the whole-BoQ path
  // below is the hub's, kept intact until C6 removes it.
  const single = !!sheetName;
  const sheet = single ? sheets[0] ?? null : null;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState<Record<string, boolean>>({});
  const [expandedClean, setExpandedClean] = useState<Set<string>>(new Set());
  const [layerChoices, setLayerChoices] = useState<LayerChoices>(initialLayerChoices);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the default selection whenever a fresh plan arrives. AMENDMENT E: the layer choices reset
  // with it -- they are a decision about THIS plan, so a stale tick must not survive into another.
  useEffect(() => {
    const init = initialSelection(sheets);
    setSelected(init.selected);
    setOverwrite(init.overwrite);
    setExpandedClean(new Set());
    setLayerChoices(initialLayerChoices());
    setError(null);
  }, [sheets]);

  const selectedCount = selected.size;
  // AMENDMENT E: the apply gate spans BOTH axes. Untick every rate but leave Categories ticked and
  // that is real work -- the pre-E `selectedCount === 0` test would have refused it.
  const nothingToWrite = single && nothingToCarry(selectedCount, sheet, layerChoices);
  const armedRates = useMemo(
    () => armedRateOverwrites(sheet, selected, overwrite),
    [sheet, selected, overwrite],
  );
  const armedLayers = useMemo(
    () => armedLayerReplacements(sheet, layerChoices),
    [sheet, layerChoices],
  );
  // AMENDMENT E: the line reports what will actually be WRITTEN, so a conflict left on Keep is not
  // counted. `selectedCount` still drives the apply gate -- see rateWriteCount's note.
  const rateWrites = useMemo(
    () => rateWriteCount(sheet, selected, overwrite),
    [sheet, selected, overwrite],
  );
  const selectionSummary = useMemo(
    () => carrySelectionSummary(rateWrites, sheet, layerChoices),
    [rateWrites, sheet, layerChoices],
  );
  // WBC-S3a / R11: the WHOLE-BoQ button's figure. Rates across every sheet, counted as WRITES --
  // routed through the SAME shared `carryWriteCount` the within-BoQ button uses, so the two cannot
  // drift apart. This path offers no layer choice, so the source is null and the layer term is 0.
  const wholeBoqWrites = useMemo(
    () => carryWriteCount(rateWriteCountAll(sheets, selected, overwrite), null, layerChoices),
    [sheets, selected, overwrite, layerChoices],
  );

  const toggleCell = (sheetName: string, row: CrossBoqCarryPlanRow) => {
    const key = cellKey(sheetName, row);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const setCellOverwrite = (sheetName: string, row: CrossBoqCarryPlanRow, value: boolean) =>
    setOverwrite((prev) => ({ ...prev, [cellKey(sheetName, row)]: value }));

  const toggleSheet = (sheet: CrossBoqCarrySheet) => {
    const keys = sheetWritableKeys(sheet);
    const allOn = keys.length > 0 && keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOn) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  };

  const toggleExpandClean = (sheetName: string) =>
    setExpandedClean((prev) => {
      const next = new Set(prev);
      if (next.has(sheetName)) next.delete(sheetName);
      else next.add(sheetName);
      return next;
    });

  const handleApply = async () => {
    setRunning(true);
    setError(null);
    try {
      if (single) {
        // SYNCHRONOUS (C2): one sheet, one transaction, the summary straight back. AMENDMENT E:
        // the selected layers ride that SAME transaction -- one commit, one rollback.
        const res = await applyCall({
          dest_boq: boqId,
          sheet_name: sheetName,
          decisions: JSON.stringify(buildDecisions(sheet, selected, overwrite)),
          layers: JSON.stringify(buildLayersPayload(layerChoices)),
        });
        onApplied?.(res?.message as ApplySheetCarryResponse, sheet?.needs_new_value_count ?? 0);
      } else {
        await startCall({
          dest_boq: boqId,
          source_boq: sourceBoq, // advisory -- the server re-derives identity
          decisions_by_sheet: JSON.stringify(buildDecisionsBySheet(sheets, selected, overwrite)),
        });
        onStarted?.(totals.needsNewValues);
      }
      onClose();
    } catch (e) {
      setError(getFrappeError(e) || "Could not carry from the original. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !running) onClose(); }}>
      {/* Bounded height + flex column: the ONE scroll region below is the only thing that grows,
          so the dialog can never run off the top or bottom of the viewport (a `fixed` +
          translate-centred box that overflows is unreachable at the top -- you cannot scroll it
          back into view). Matches the house pattern (GenerateRFQDialog / SelectWOModal). */}
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{single ? "Carry from the original" : "Carry rates from the original"}</DialogTitle>
          <DialogDescription>
            {single && sheet ? (
              <>
                <span className="font-medium text-foreground">
                  {sheet.sheet_name.trim() || sheet.sheet_name}
                </span>
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  v{sheet.source_version} &rarr; v{sheet.dest_version}
                </span>
                <span className="mt-1 block">
                  Copy the original&rsquo;s work into this sheet. Structure, quantities and amounts
                  are never changed. New rows have no original to copy &mdash; price those by hand.
                </span>
              </>
            ) : (
              <>
                Copy priced rates from the original BoQ into this revision. Rates only -- structure,
                quantities and amounts are never changed. New rows in the revision are not carried
                (there is no original rate for them) -- price those by hand.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex shrink-0 items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : sheets.length === 0 ? (
          <p className="shrink-0 py-8 text-center text-sm text-muted-foreground">
            There are no committed sheets with rates to carry from the original.
          </p>
        ) : (
          <>
            {/* Whole-BoQ summary line (hub path only -- single-sheet says it in the header). */}
            {!single && (
            <p className="shrink-0 text-xs text-muted-foreground">
              {totals.writableCells} rate{totals.writableCells === 1 ? "" : "s"} to carry across{" "}
              {totals.totalSheets} sheet{totals.totalSheets === 1 ? "" : "s"}
              {totals.needsNewValues > 0 &&
                ` · ${totals.needsNewValues} row${totals.needsNewValues === 1 ? "" : "s"} will need new values`}
              {totals.blockedSheets.length > 0 &&
                ` · ${totals.blockedSheets.length} sheet${totals.blockedSheets.length === 1 ? "" : "s"} blocked`}
            </p>
            )}

            {/* AMENDMENT E restores a non-rate block, but NOT Amendment C's: every layer is opt-in
                and its counts are shown before it is ticked, which is the half of Amendment D's
                objection the UI owns (the server owns the other half, the provenance stamp). */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
              <div className="space-y-3">
                {sheets.map((sheet) => (
                  <CarrySheetSection
                    key={sheet.sheet_name}
                    sheet={sheet}
                    selected={selected}
                    overwrite={overwrite}
                    expanded={expandedClean.has(sheet.sheet_name)}
                    onToggleSheet={() => toggleSheet(sheet)}
                    onToggleCell={(row) => toggleCell(sheet.sheet_name, row)}
                    onSetCellOverwrite={(row, v) => setCellOverwrite(sheet.sheet_name, row, v)}
                    onBulkOverwrite={(v) =>
                      setOverwrite((prev) => ({ ...prev, ...applyBulkOverwrite(sheet, v) }))
                    }
                    onToggleExpandClean={() => toggleExpandClean(sheet.sheet_name)}
                  />
                ))}
              </div>

              {/* Single-sheet only: the hub's whole-BoQ button was removed at Amendment C, so the
                  pricing editor is the one launch point the layer choice can come from. It rides
                  the SAME scroller as the sheet list rather than being pinned below it -- the
                  block is ~260px of FIXED height, so pinning it would starve the list to nothing
                  on a short viewport. */}
              {single && sheet && (
                <CarryLayersBlock
                  sheet={sheet}
                  choices={layerChoices}
                  disabled={!sheet.formulas_complete}
                  onChange={(key, next) =>
                    setLayerChoices((prev) => ({ ...prev, [key]: next }))
                  }
                />
              )}
            </div>
          </>
        )}

        {/* The one consolidated destructive notice -- shown ONLY when an armed overwrite will
            actually replace something. AMENDMENT E: it spans BOTH axes again (rates + layers), but
            counts them separately, because "12 rates" and "8 remarks" are not the same kind of
            loss and a single merged number would hide which one the user armed. */}
        {single && armedRates + armedLayers > 0 && (
          <p className="flex shrink-0 items-start gap-1.5 text-[11px] text-destructive">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span>
              <span className="font-medium">
                Overwriting{" "}
                {[
                  armedRates > 0 && `${armedRates} existing rate${armedRates === 1 ? "" : "s"}`,
                  armedLayers > 0 &&
                    `${armedLayers} existing record${armedLayers === 1 ? "" : "s"} in the ticked layers`,
                ]
                  .filter(Boolean)
                  .join(" and ")}
                .
              </span>{" "}
              This replaces work already on the revision. There is no undo.
            </span>
          </p>
        )}

        {single && selectionSummary && (
          <p className="shrink-0 text-xs text-muted-foreground">Will carry {selectionSummary}.</p>
        )}

        {error && <p className="shrink-0 text-xs text-destructive">{error}</p>}

        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={running || isLoading || (single ? nothingToWrite : selectedCount === 0)}
          >
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {/* AMENDMENT E: the SINGLE-sheet button deliberately names no payload -- it may be
                carrying rates, layers or both, and the "Will carry ..." line above says exactly
                what. Owner-locked; left as it is.

                WBC-S3a / R11: the WHOLE-BoQ button DID name one, and named the wrong number --
                `selectedCount` counts pre-ticked conflicts that are on Keep and will write nothing.
                It now reports WRITES, from the shared `carryWriteCount`.

                R13: and it names them as CHANGES. "Items" collides with `node_type === "Line Item"`,
                a term the reader has just been looking at on the grid behind this dialog. */}
            {single ? "Carry" : `Carry ${carryChangesPhrase(wholeBoqWrites)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Per-sheet section (summary-first) ────────────────────────────────────────────────

interface CarrySheetSectionProps {
  sheet: CrossBoqCarrySheet;
  selected: Set<string>;
  overwrite: Record<string, boolean>;
  expanded: boolean;
  onToggleSheet: () => void;
  onToggleCell: (row: CrossBoqCarryPlanRow) => void;
  onSetCellOverwrite: (row: CrossBoqCarryPlanRow, value: boolean) => void;
  onBulkOverwrite: (value: boolean) => void;
  onToggleExpandClean: () => void;
}

function CarrySheetSection({
  sheet,
  selected,
  overwrite,
  expanded,
  onToggleSheet,
  onToggleCell,
  onSetCellOverwrite,
  onBulkOverwrite,
  onToggleExpandClean,
}: CarrySheetSectionProps) {
  const blocked = !sheet.formulas_complete;
  const counts = sheetCountsDisplay(sheet);
  const conflicts = sheet.plan.filter((r) => r.outcome === 3);
  const cleanRows = sheet.plan.filter((r) => r.outcome === 2);
  const skips = sheet.plan.filter((r) => r.outcome === 1);
  const writableKeys = sheetWritableKeys(sheet);
  const selectedInSheet = writableKeys.filter((k) => selected.has(k)).length;
  const allSelected = writableKeys.length > 0 && selectedInSheet === writableKeys.length;

  return (
    <div className="rounded-md border border-border">
      {/* Header: sheet-level tick + name + version + counts. */}
      <div className="flex items-start gap-2.5 border-b border-border/60 bg-muted/30 px-3 py-2">
        <Checkbox
          checked={allSelected}
          disabled={blocked || writableKeys.length === 0}
          onCheckedChange={onToggleSheet}
          aria-label={`Carry all rates for ${sheet.sheet_name.trim() || sheet.sheet_name}`}
          className="mt-0.5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {sheet.sheet_name.trim() || sheet.sheet_name}
            </span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              v{sheet.source_version} &rarr; v{sheet.dest_version}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {counts.copy} to copy
            {counts.conflicts > 0 && ` · ${counts.conflicts} conflict${counts.conflicts === 1 ? "" : "s"}`}
            {counts.skipped > 0 && ` · ${counts.skipped} skipped`}
            {sheet.needs_new_value_count > 0 &&
              ` · ${sheet.needs_new_value_count} need new values`}
          </p>
          {blocked && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Declare amount formulas for this sheet before carrying -- it will be skipped.
            </p>
          )}
        </div>
      </div>

      {!blocked && (
        <div className="px-3 py-2">
          {/* Conflicts -- always shown (they need a decision). */}
          {conflicts.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}
                </span>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                  onClick={() => onBulkOverwrite(true)}>
                  Overwrite all
                </Button>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                  onClick={() => onBulkOverwrite(false)}>
                  Keep all
                </Button>
              </div>
              <ul className="space-y-1">
                {conflicts.map((row) => {
                  const key = cellKey(sheet.sheet_name, row);
                  const isSelected = selected.has(key);
                  return (
                    <li key={key} className="flex items-start gap-2 text-xs">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggleCell(row)}
                        aria-label={`Carry row ${row.dest_excel_row}`}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="w-10 shrink-0 font-mono text-muted-foreground">
                        {row.dest_excel_row}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {row.dest_description || row.description || "(no description)"}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums">
                        <span className="text-muted-foreground line-through">{row.current_rate}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="text-foreground">{row.source_rate}</span>
                      </span>
                      {isSelected && (
                        <span className="flex shrink-0 items-center gap-1.5">
                          <button type="button"
                            onClick={() => onSetCellOverwrite(row, false)}
                            className={cn("text-[11px]", !overwrite[key] ? "font-semibold text-foreground" : "text-muted-foreground")}>
                            Keep
                          </button>
                          <span className="text-muted-foreground">/</span>
                          <button type="button"
                            onClick={() => onSetCellOverwrite(row, true)}
                            className={cn("text-[11px]", overwrite[key] ? "font-semibold text-destructive" : "text-muted-foreground")}>
                            Overwrite
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Clean copies -- folded behind an expander (the common bulk case). */}
          {cleanRows.length > 0 && (
            <div>
              <button type="button"
                onClick={onToggleExpandClean}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {expanded ? "Hide" : "Show"} {cleanRows.length} row{cleanRows.length === 1 ? "" : "s"} to copy
              </button>
              {expanded && (
                <ul className="mt-1 space-y-1">
                  {cleanRows.map((row) => {
                    const key = cellKey(sheet.sheet_name, row);
                    return (
                      <li key={key} className="flex items-start gap-2 text-xs">
                        <Checkbox
                          checked={selected.has(key)}
                          onCheckedChange={() => onToggleCell(row)}
                          aria-label={`Carry row ${row.dest_excel_row}`}
                          className="mt-0.5 shrink-0"
                        />
                        <span className="w-10 shrink-0 font-mono text-muted-foreground">
                          {row.dest_excel_row}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {row.dest_description || row.description || "(no description)"}
                          {row.area && <span className="ml-1 text-muted-foreground">({row.area})</span>}
                        </span>
                        <span className="shrink-0 tabular-nums text-foreground">{row.source_rate}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* Skips -- read-only, muted, with the reason. */}
          {skips.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-muted-foreground">
                {skips.length} not carried
              </summary>
              <ul className="mt-1 space-y-0.5">
                {skips.map((row) => (
                  <li key={`${row.source_excel_row}|${row.area ?? ""}|${row.rate_kind}`}
                    className="flex items-start gap-2 text-[11px] text-muted-foreground">
                    <span className="w-10 shrink-0 font-mono">{row.dest_excel_row ?? "--"}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {row.description || "(no description)"}
                    </span>
                    <span className="shrink-0">
                      {row.skip_reason ? SKIP_REASON_LABEL[row.skip_reason] : "Not carried"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
