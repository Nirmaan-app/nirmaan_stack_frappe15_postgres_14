/**
 * CopyForwardDialog -- the review-before-apply surface for copy-forward (Phase 5 version-view
 * slice 2). Launched from the read-only version-history view: copies RATES from the viewed OLD
 * version into the CURRENT version. RATES ONLY -- never structure / amount / qty.
 *
 * Self-contained (mirrors CommitDialog): it fetches the server-classified plan
 * (get_copy_forward_plan), renders the per-row outcome table + bulk overwrite/keep, collects the
 * user's decisions, and POSTs apply_copy_forward; on success it hands the summary up via
 * onApplied + closes. The SERVER re-derives every outcome + target column (the client cannot force
 * a wrong write); the three hard-skips (non_match / no_rate_column / non_priceable) are shown but
 * never selectable. Default selection: clean rows + conflicts pre-ticked, conflicts default KEEP
 * (a plain confirm copies the clean ones and touches no existing rate).
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
import type {
  ApplyCopyForwardResponse,
  CopyForwardDecision,
  CopyForwardPlanRow,
  GetCopyForwardPlanResponse,
} from "./boqTypes";

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

  const plan = useMemo(() => data?.message?.plan ?? [], [data]);
  const formulasComplete = data?.message?.current_formulas_complete ?? true;
  const currentVersion = data?.message?.current_version ?? null;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the default selection whenever a fresh plan arrives.
  useEffect(() => {
    const init = initialSelection(plan);
    setSelected(init.selected);
    setOverwrite(init.overwrite);
    setError(null);
  }, [plan]);

  const conflictCount = plan.filter((r) => r.outcome === 3).length;
  const selectedCount = selected.size;

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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Copy rates forward</DialogTitle>
          <DialogDescription>
            Copy rates from Version {fromVersion}
            {currentVersion !== null ? ` into the current Version ${currentVersion}` : " into the current version"}.
            Rates only -- structure and amounts are never changed.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : plan.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Version {fromVersion} has no priced rates to copy.
          </p>
        ) : (
          <>
            {!formulasComplete && (
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                The current version still has amount columns without a formula. Declare them before copying.
              </div>
            )}

            {conflictCount > 0 && (
              <div className="flex items-center gap-2 text-xs">
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

            <div className="max-h-[45vh] overflow-auto rounded-md border border-border">
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
          </>
        )}

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={running || isLoading || selectedCount === 0 || !formulasComplete}
          >
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Copy {selectedCount > 0 ? `${selectedCount} ` : ""}rate{selectedCount === 1 ? "" : "s"} forward
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
