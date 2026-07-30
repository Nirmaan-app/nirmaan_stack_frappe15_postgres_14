/**
 * CopyForwardDialog -- the review-before-apply surface for copy-forward (Phase 5 version-view
 * slice 2). Launched from the read-only version-history view: copies RATES -- and, since WBC-W3-S5,
 * any ticked non-rate LAYERS -- from the viewed OLD version into the CURRENT version. Never
 * structure / amount / qty, and never amount formulas.
 *
 * Self-contained (mirrors CommitDialog): it fetches the server-classified plan
 * (get_copy_forward_plan), renders the per-row outcome table + bulk overwrite/keep, collects the
 * user's decisions, and POSTs apply_copy_forward; on success it hands the summary up via
 * onApplied + closes. The SERVER re-derives every outcome + target column (the client cannot force
 * a wrong write); the three hard-skips (non_match / no_rate_column / non_priceable) are shown but
 * never selectable. Default selection: clean rows + conflicts pre-ticked, conflicts default KEEP
 * (a plain confirm copies the clean ones and touches no existing rate).
 *
 * WBC-W3-S5 (ADR-0014 Amendment F R1) gives this seam parity with the cross-BoQ revision carry: the
 * SHARED `CarryLayersBlock` offers the four row-addressed layers, opt-in, CATEGORIES ON and the three
 * annotation layers OFF. That asymmetry is a UI default owned by `initialLayerChoices()` -- an
 * omitted `layers` payload is rates only, which is exactly what a pre-S5 client kept getting.
 *
 * ⚠️ Amendment F R2 moved the server's category gate to AFTER the layer carry, so ticking Categories
 * can OPEN a gate that was shut. This dialog deliberately does NOT promise that: the source's own
 * categories may be incomplete, in which case the server still refuses and rolls the whole
 * transaction back. R8 keeps that gate UNCONDITIONAL -- an annotations-only carry into an
 * uncategorised destination is refused too, and the server's refusal is what the user reads.
 *
 * WBC-S3a is a TRUTH-AND-FIT pass over the above, changing no carry behaviour: the box is bounded to
 * the viewport so its footer cannot go off-screen (R-fit), the apply button reports WRITES across
 * both axes instead of the raw selection so it cannot contradict the "Will copy ..." line above it
 * (R11), and the shared block's two "the revision" strings are re-voiced for a surface where no
 * revision exists (R9).
 */
import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
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
  ApplyCopyForwardResponse,
  CopyForwardDecision,
  CopyForwardPlanRow,
  GetCopyForwardPlanResponse,
} from "./boqTypes";
// WBC-W3-S5: the opt-in layer choice (block + pure helpers) is the SHARED CarryLayers module the
// cross-BoQ dialog uses -- not a fork of it. Its `sheet` parameter is structural (CarryLayerSource),
// which is what lets this response satisfy it without pretending to be a sheet.
import {
  CARRY_DESTINATION_WITHIN_BOQ,
  CarryLayersBlock,
  LAYER_BLOCK_SUBTEXT_WITHIN_BOQ,
  LAYER_LABEL,
  buildLayersPayload,
  carrySelectionSummary,
  carryWriteCount,
  countPhrase,
  initialLayerChoices,
  joinPhrases,
  nothingToCarry,
  type CarryLayerSource,
  type LayerChoices,
} from "./CarryLayers";

// ── Pure helpers (vitest-tested) ─────────────────────────────────────────────────

/** The per-CELL identity key (a row can carry several rate cells -- per area / rate_kind). */
export function cellKey(row: Pick<CopyForwardPlanRow, "excel_row" | "area" | "rate_kind">): string {
  return `${row.excel_row}|${row.area ?? ""}|${row.rate_kind}`;
}

/** A writable row is a clean copy (2) or a conflict (3); a hard skip (1) is never writable. */
export function isWritable(row: CopyForwardPlanRow): boolean {
  return row.outcome === 2 || row.outcome === 3;
}

/**
 * The default dialog state: every WRITABLE cell pre-selected; conflicts default to KEEP
 * (overwrite=false) so a plain confirm copies the clean ones and touches no existing rate. Hard
 * skips are excluded (not selectable).
 */
export function initialSelection(plan: CopyForwardPlanRow[]): {
  selected: Set<string>;
  overwrite: Record<string, boolean>;
} {
  const selected = new Set<string>();
  const overwrite: Record<string, boolean> = {};
  for (const row of plan) {
    if (!isWritable(row)) continue;
    selected.add(cellKey(row));
    if (row.outcome === 3) overwrite[cellKey(row)] = false; // default KEEP
  }
  return { selected, overwrite };
}

/** Bulk set every CONFLICT row's overwrite flag (the "overwrite all" / "keep all" actions). */
export function applyBulkOverwrite(
  plan: CopyForwardPlanRow[],
  value: boolean,
): Record<string, boolean> {
  const overwrite: Record<string, boolean> = {};
  for (const row of plan) {
    if (row.outcome === 3) overwrite[cellKey(row)] = value;
  }
  return overwrite;
}

/** Build the apply payload from the current selection + per-conflict overwrite choices. */
export function buildDecisions(
  plan: CopyForwardPlanRow[],
  selected: Set<string>,
  overwrite: Record<string, boolean>,
): CopyForwardDecision[] {
  const decisions: CopyForwardDecision[] = [];
  for (const row of plan) {
    if (!isWritable(row)) continue;
    const key = cellKey(row);
    if (!selected.has(key)) continue;
    decisions.push({
      excel_row: row.excel_row,
      area: row.area,
      rate_kind: row.rate_kind,
      overwrite: row.outcome === 3 ? !!overwrite[key] : false,
    });
  }
  return decisions;
}

/**
 * How many rate cells the apply will actually WRITE: every selected CLEAN copy, plus the selected
 * CONFLICTS whose Overwrite is armed. A selected conflict left on KEEP writes nothing.
 *
 * ⚠️ Why this is not `selected.size`. Conflicts are PRE-selected with Keep as their default, so on a
 * version that has already been copied into, every rate reads as "selected" and none of them will
 * move. Commit 313697e7 fixed exactly this on the cross-BoQ dialog, where the raw selection made it
 * promise "Will carry 12 rates" and the post-apply line answer "Nothing was carried. 12 existing
 * rates left as they were." The layer half has always respected the choice (`layerMoveCount`), so a
 * selection-based rate figure would put the two halves of one sentence at odds with each other.
 *
 * The apply GATE deliberately still keys off the selection (via `nothingToCarry`): pressing Copy on
 * an all-Keep version is a harmless no-op that reports honestly, and disabling it there would be a
 * separate behaviour change.
 */
export function rateWriteCount(
  plan: CopyForwardPlanRow[],
  selected: Set<string>,
  overwrite: Record<string, boolean>,
): number {
  return plan.filter((row) => {
    const key = cellKey(row);
    if (!selected.has(key)) return false;
    if (row.outcome === 2) return true; // clean copy -> always writes
    return row.outcome === 3 && !!overwrite[key]; // conflict -> only when armed
  }).length;
}

/**
 * The post-apply line the pricing page shows once the copy has landed (WBC-S3a).
 *
 * ⚠️ Why it is not the old inline template. That one reported RATES only, so a categories-only copy
 * -- the likeliest shape of all, since a version whose rates all conflict can still take the whole
 * category set -- read "Copied 0 rates into the current version." Not false, but it under-reports
 * work that actually happened, on the axis this whole arc is about.
 *
 * This is `summarizeSheetCarry`'s multi-axis branch in the copy-forward's own voice: a clean copy
 * and an overwrite both LANDED, a layer's `replaced` rows landed just as much as its `carried` ones,
 * and the destination ("the current version") is named because this dialog is launched from a
 * read-only view of an OLDER one.
 */
export function summarizeCopyForward(
  summary: ApplyCopyForwardResponse | null | undefined,
): string {
  const rates = (summary?.copied ?? 0) + (summary?.conflicts_overwritten ?? 0);
  const kept = summary?.conflicts_kept ?? 0;
  const s = summary?.skipped;
  const skipped =
    (s?.non_match ?? 0) + (s?.no_rate_column ?? 0) + (s?.non_priceable ?? 0) + (s?.invalid ?? 0);

  const landed: string[] = [];
  if (rates > 0) landed.push(countPhrase(rates, "rate", "rates"));
  for (const key of CARRY_LAYER_KEYS) {
    const outcome = summary?.layers?.[key];
    if (!outcome) continue; // the layer did not run at all
    const n = outcome.carried + outcome.replaced;
    if (n > 0) landed.push(`${n} ${LAYER_LABEL[key].toLowerCase()}`);
  }

  const parts: string[] = [
    landed.length === 0
      ? "Nothing was copied into the current version."
      : `Copied ${joinPhrases(landed)} into the current version.`,
  ];
  if (kept > 0) {
    parts.push(
      `${kept} existing rate${kept === 1 ? "" : "s"} left as ${kept === 1 ? "it was" : "they were"}.`,
    );
  }
  if (skipped > 0) {
    parts.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped.`);
  }
  return parts.join(" ");
}

const OUTCOME_META: Record<
  string,
  { label: string; badge: string }
> = {
  clean: { label: "Copy", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200" },
  conflict: { label: "Conflict", badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" },
  skip: { label: "Skipped", badge: "bg-muted text-muted-foreground" },
};

/** The presentation key for a plan row's status chip. */
export function outcomeMetaKey(row: CopyForwardPlanRow): "clean" | "conflict" | "skip" {
  if (row.outcome === 2) return "clean";
  if (row.outcome === 3) return "conflict";
  return "skip";
}

// ── Component ────────────────────────────────────────────────────────────────────

interface CopyForwardDialogProps {
  open: boolean;
  boqId: string;
  sheetName: string;
  fromVersion: number;
  onClose: () => void;
  onApplied: (summary: ApplyCopyForwardResponse) => void;
}

export function CopyForwardDialog({
  open,
  boqId,
  sheetName,
  fromVersion,
  onClose,
  onApplied,
}: CopyForwardDialogProps) {
  const { data, isLoading } = useFrappeGetCall<{ message: GetCopyForwardPlanResponse }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_copy_forward_plan",
    { boq_name: boqId, sheet_name: sheetName, from_version: fromVersion },
    open ? undefined : null,
  );
  const { call: applyCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.apply_copy_forward",
  );

  const message = data?.message ?? null;
  const plan = useMemo(() => data?.message?.plan ?? [], [data]);
  const formulasComplete = data?.message?.current_formulas_complete ?? true;
  const currentVersion = data?.message?.current_version ?? null;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState<Record<string, boolean>>({});
  const [layerChoices, setLayerChoices] = useState<LayerChoices>(initialLayerChoices);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the default selection whenever a fresh plan arrives. The layer choices reset with it --
  // they are a decision about THIS plan, so a stale tick must not survive into another.
  useEffect(() => {
    const init = initialSelection(plan);
    setSelected(init.selected);
    setOverwrite(init.overwrite);
    setLayerChoices(initialLayerChoices());
    setError(null);
  }, [plan]);

  const conflictCount = plan.filter((r) => r.outcome === 3).length;
  const selectedCount = selected.size;
  /**
   * The layer choice is OFFERED only where the block renders -- inside the non-empty-plan branch. A
   * version with no priced rates shows the "nothing to copy" state and no block, so its layers must
   * not be reachable from the footer button either: a carried record the user was never offered is
   * precisely the defect Amendment E exists to keep answered. The cross-BoQ seam has the same hole by
   * owner-locked design (`carryButtonState` refuses at zero rate cells), so this is parity, not a new
   * restriction.
   */
  const layerSource: CarryLayerSource | null = plan.length > 0 ? message : null;
  // The apply gate spans BOTH axes: unticking every rate but leaving Categories ticked is real work,
  // which the pre-S5 `selectedCount === 0` test would have refused.
  const nothingToWrite = nothingToCarry(selectedCount, layerSource, layerChoices);
  // WRITES, not the selection -- see rateWriteCount. This is what the "Will copy ..." line reports.
  const rateWrites = useMemo(
    () => rateWriteCount(plan, selected, overwrite),
    [plan, selected, overwrite],
  );
  const selectionSummary = useMemo(
    () => carrySelectionSummary(rateWrites, layerSource, layerChoices),
    [rateWrites, layerSource, layerChoices],
  );
  // WBC-S3a / R11: what the BUTTON reports. The same walk that built the line above it, so the two
  // can never contradict each other -- which they could, and did: `selectedCount` pre-includes every
  // conflict on Keep, so "Copy 12 rates forward" could sit above "Will copy 30 categories".
  const writeCount = useMemo(
    () => carryWriteCount(rateWrites, layerSource, layerChoices),
    [rateWrites, layerSource, layerChoices],
  );

  const toggleRow = (row: CopyForwardPlanRow) => {
    const key = cellKey(row);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const setRowOverwrite = (row: CopyForwardPlanRow, value: boolean) =>
    setOverwrite((prev) => ({ ...prev, [cellKey(row)]: value }));

  const handleApply = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await applyCall({
        boq_name: boqId,
        sheet_name: sheetName, // VERBATIM (#152)
        from_version: fromVersion,
        decisions: JSON.stringify(buildDecisions(plan, selected, overwrite)),
        // The ticked layers ride the SAME server transaction as the rates -- one commit, one
        // rollback. `{}` = rates only, which is what an un-offered layer axis must post.
        layers: JSON.stringify(layerSource ? buildLayersPayload(layerChoices) : {}),
      });
      onApplied(res.message as ApplyCopyForwardResponse);
      onClose();
    } catch (e) {
      setError(getFrappeError(e) || "Could not copy the rates forward. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !running) onClose(); }}>
      {/* Bounded height + flex column: the ONE scroll region below is the only thing that grows, so
          the dialog can never run off the top or bottom of the viewport. The shadcn primitive is
          `fixed top-1/2 -translate-y-1/2` with NO height bound, so an over-tall box overflows
          SYMMETRICALLY and cannot be scrolled back -- and the bottom half that goes off-screen is
          the footer, i.e. Copy and Cancel become unreachable. WBC-S3a: the S5 layer block put ~270px
          of fixed height in here and the old mitigation (dropping the table cap 45vh -> 32vh) does
          not bound the non-vh budget at all. Same fix, same house pattern, as 6619280a applied to
          the sibling CrossBoqCarryDialog (and GenerateRFQDialog / SelectWOModal before it). */}
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Copy rates forward</DialogTitle>
          {/* ⚠️ "Rates only" became FALSE at WBC-W3-S5 -- this action can carry the four non-rate
              layers now. Structure and amounts still never change. PENDING OWNER CONFIRMATION. */}
          <DialogDescription>
            Copy from Version {fromVersion}
            {currentVersion !== null ? ` into the current Version ${currentVersion}` : " into the current version"}.
            Structure and amounts are never changed.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex shrink-0 items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : plan.length === 0 ? (
          <p className="shrink-0 py-8 text-center text-sm text-muted-foreground">
            Version {fromVersion} has no priced rates to copy.
          </p>
        ) : (
          <>
            {!formulasComplete && (
              <div className="flex shrink-0 items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                The current version still has amount columns without a formula. Declare them before copying.
              </div>
            )}

            {conflictCount > 0 && (
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <span className="text-muted-foreground">{conflictCount} conflict{conflictCount > 1 ? "s" : ""}:</span>
                <Button size="sm" variant="outline" className="h-7 px-2"
                  onClick={() => setOverwrite(applyBulkOverwrite(plan, true))}>
                  Overwrite all
                </Button>
                <Button size="sm" variant="outline" className="h-7 px-2"
                  onClick={() => setOverwrite(applyBulkOverwrite(plan, false))}>
                  Keep all existing
                </Button>
              </div>
            )}

            {/* The ONE scroll region: the row table AND the layer block ride it together. The old
                45vh/32vh conditional on the table is GONE -- it was the wrong mechanism, not a wrong
                number. A `vh` cap on one child bounds nothing when the parent has no bound of its
                own, and pinning the ~270px layer block outside the scroller would starve the table
                to nothing on a short viewport (the reason 6619280a moved it inside on the sibling
                dialog). The table keeps its frame but no longer scrolls itself: a second scroller
                would put us straight back to "how tall may the inner one be?". */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
              <div className="rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="w-8 px-2 py-1.5"></th>
                      <th className="px-2 py-1.5 text-left font-medium">Row</th>
                      <th className="px-2 py-1.5 text-left font-medium">Description</th>
                      <th className="px-2 py-1.5 text-right font-medium">Rate</th>
                      <th className="px-2 py-1.5 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.map((row) => {
                      const key = cellKey(row);
                      const metaKey = outcomeMetaKey(row);
                      const meta = OUTCOME_META[metaKey];
                      const writable = isWritable(row);
                      return (
                        <tr key={key} className={cn("border-t border-border", !writable && "opacity-60")}>
                          <td className="px-2 py-1.5 align-top">
                            {writable && (
                              <Checkbox
                                checked={selected.has(key)}
                                onCheckedChange={() => toggleRow(row)}
                                aria-label={`Copy row ${row.excel_row}`}
                              />
                            )}
                          </td>
                          <td className="px-2 py-1.5 align-top font-mono text-muted-foreground">{row.excel_row}</td>
                          <td className="px-2 py-1.5 align-top">
                            <span className="text-foreground">{row.description || "(no description)"}</span>
                            {row.outcome === 1 && row.reason && (
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">{row.reason}</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 align-top text-right tabular-nums">
                            {row.outcome === 3 ? (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                <span className="text-muted-foreground line-through">{row.current_rate}</span>
                                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                <span className="text-foreground">{row.source_rate}</span>
                              </span>
                            ) : (
                              <span className="text-foreground">{row.source_rate}</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", meta.badge)}>
                              {meta.label}
                            </span>
                            {row.outcome === 3 && selected.has(key) && (
                              <div className="mt-1 flex items-center gap-2">
                                <button type="button"
                                  onClick={() => setRowOverwrite(row, false)}
                                  className={cn("text-[11px]", !overwrite[key] ? "font-semibold text-foreground" : "text-muted-foreground")}>
                                  Keep
                                </button>
                                <span className="text-muted-foreground">/</span>
                                <button type="button"
                                  onClick={() => setRowOverwrite(row, true)}
                                  className={cn("text-[11px]", overwrite[key] ? "font-semibold text-destructive" : "text-muted-foreground")}>
                                  Overwrite
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* The SHARED opt-in layer block (WBC-W3-S5), INSIDE the scroller above. `disabled` is
                  the mandatory amount-formula gate: the server refuses the WHOLE call while it is
                  unmet, layers included, so nothing here may be armed. The block hides itself when the
                  server sent no preview, so a pre-Amendment-F server degrades to the rate-only dialog.
                  `destination` is R9: within one BoQ the copy lands in the CURRENT VERSION -- there is
                  no revision here for the colour rows to name. */}
              {layerSource && (
                <CarryLayersBlock
                  sheet={layerSource}
                  choices={layerChoices}
                  disabled={!formulasComplete}
                  subtext={LAYER_BLOCK_SUBTEXT_WITHIN_BOQ}
                  destination={CARRY_DESTINATION_WITHIN_BOQ}
                  onChange={(key, next) =>
                    setLayerChoices((prev) => ({ ...prev, [key]: next }))
                  }
                />
              )}
            </div>
          </>
        )}

        {/* What will actually be WRITTEN, across both axes. A conflict left on Keep is excluded --
            see rateWriteCount for the live symptom that rule was written for. */}
        {selectionSummary && (
          <p className="shrink-0 text-xs text-muted-foreground">Will copy {selectionSummary}.</p>
        )}

        {error && (
          <p className="shrink-0 text-xs text-destructive">{error}</p>
        )}

        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={running || isLoading || nothingToWrite || !formulasComplete}
          >
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {/* WBC-S3a / R11: WRITES across both axes, from the same walk as the "Will copy ..."
                line directly above -- so the two can never contradict each other. It used to name
                `selectedCount` rates, which pre-includes every conflict left on Keep. */}
            Copy {writeCount > 0 ? `${writeCount} ` : ""}item{writeCount === 1 ? "" : "s"} forward
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
