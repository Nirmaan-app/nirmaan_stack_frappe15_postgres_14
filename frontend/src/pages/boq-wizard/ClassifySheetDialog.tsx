/**
 * ClassifySheetDialog -- the launch surface for CL-2 AI category classification (BoQ Phase 5).
 * Modeled on CopyForwardDialog: it fetches the available engines (classify.list_engines), lets the
 * user pick one or more AVAILABLE engines + a scope (whole-sheet or an Excel-row range) per engine,
 * then hands the chosen launches up via onStarted + closes.
 *
 * The dialog OWNS only the pick; SheetPricingPage starts each engine as its own background
 * operation (start_classify, #1666) and follows it through that operation's status record. An
 * unavailable engine renders disabled with a "(coming soon)" hint.
 */
import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ClassifyScope, EngineOption } from "./boqTypes";

// ── Pure helpers (vitest-tested) ─────────────────────────────────────────────────

/** The engines the user may actually select -- the available ones (v1: only Electrical). */
export function selectableEngines(engines: EngineOption[]): EngineOption[] {
  return engines.filter((e) => e.available);
}

/**
 * Validate an inclusive Excel-row range. NaN / negative bounds and start>end are rejected with a
 * short message; everything else is ok (the server is still the authority on real row bounds).
 */
export function validateRange(start: number, end: number): { ok: boolean; error?: string } {
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return { ok: false, error: "Enter a start and end row." };
  }
  if (start < 0 || end < 0) {
    return { ok: false, error: "Row numbers can't be negative." };
  }
  if (start > end) {
    return { ok: false, error: "Start row must be less than or equal to the end row." };
  }
  return { ok: true };
}

/** The start_classify args for one engine: its discipline + the chosen scope. */
export function buildStartArgs(
  engine: EngineOption,
  scope: ClassifyScope,
): { discipline: string; scope: ClassifyScope } {
  return { discipline: engine.discipline, scope };
}

const SKIP_REASON_WORDS: Record<string, string> = {
  layout: "layout row",
  note: "note row",
  subtotal: "subtotal row",
  superseded: "superseded row",
  other: "other row",
};
const SKIP_REASON_ORDER = ["layout", "note", "subtotal", "superseded", "other"];

/** Plain-words rollup of the skipped-by-reason map, e.g. "3 note rows, 1 subtotal row skipped". */
export function skipRollupText(skipped: Record<string, number>): string {
  const knownKeys = SKIP_REASON_ORDER.filter((k) => (skipped[k] ?? 0) > 0);
  const extraKeys = Object.keys(skipped).filter(
    (k) => !SKIP_REASON_ORDER.includes(k) && (skipped[k] ?? 0) > 0,
  );
  const parts = [...knownKeys, ...extraKeys].map((k) => {
    const count = skipped[k];
    const word = SKIP_REASON_WORDS[k] ?? `${k} row`;
    return `${count} ${word}${count === 1 ? "" : "s"}`;
  });
  if (parts.length === 0) return "";
  return `${parts.join(", ")} skipped`;
}

/**
 * A note for the completion message when the AI voter did NOT actually run, so an all-needs-review
 * result does not read as a silent failure. "" when the AI ran normally ("ran") or is unknown.
 */
export function aiStatusNote(aiStatus: string | null | undefined): string {
  if (aiStatus === "disabled")
    return "The AI voter was off, so every row was routed to review. Enable AI in settings to auto-accept consensus rows.";
  if (aiStatus === "no_key")
    return "The AI key is not configured, so every row was routed to review.";
  return "";
}

// Slice G2e: isNeedsReviewCategory was RETIRED here. It returned FALSE for a never-classified row
// (undefined), so it could not surface the rows the widened "empty is empty" gate now counts. Its
// sole functional caller (the Check-Category view filter) + the grid's amber fill now share ONE
// predicate, PricingGrid.isMasterSetBlank(row, cat), which takes the ROW (for node_type) and treats
// a never-classified / blank / whitespace cell as blank -- the filter shows exactly what amber shows.

// ── Component ────────────────────────────────────────────────────────────────────

const DEFAULT_SCOPE: ClassifyScope = { mode: "sheet" };

interface ClassifySheetDialogProps {
  open: boolean;
  onClose: () => void;
  // HV-10b: report each launched engine's chosen scope (not just its discipline) so the page can
  // start each engine's operation with it and scope the COMBINED-EFFECTIVE completion summary to the
  // run set's row range union.
  onStarted: (launches: Array<{ discipline: string; scope: ClassifyScope }>) => void;
}

export function ClassifySheetDialog({
  open,
  onClose,
  onStarted,
}: ClassifySheetDialogProps) {
  const { data, isLoading } = useFrappeGetCall<{ message: EngineOption[] }>(
    "nirmaan_stack.api.boq.wizard.classify.list_engines",
    {},
    open ? undefined : null,
  );

  const engines = useMemo(() => data?.message ?? [], [data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scopeByEngine, setScopeByEngine] = useState<Record<string, ClassifyScope>>({});

  // Reset the transient picks whenever the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setScopeByEngine({});
    }
  }, [open]);

  const scopeFor = (id: string): ClassifyScope => scopeByEngine[id] ?? DEFAULT_SCOPE;

  const toggleEngine = (engine: EngineOption) => {
    if (!engine.available) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(engine.id)) next.delete(engine.id);
      else next.add(engine.id);
      return next;
    });
  };
  const setScope = (id: string, scope: ClassifyScope) =>
    setScopeByEngine((prev) => ({ ...prev, [id]: scope }));

  // A confirm is blocked while any SELECTED engine sits on an invalid range.
  const rangeError = engines.some((e) => {
    if (!selected.has(e.id)) return false;
    const scope = scopeFor(e.id);
    return scope.mode === "range" && !validateRange(scope.start, scope.end).ok;
  });
  const canConfirm = !isLoading && selected.size > 0 && !rangeError;

  const handleConfirm = () => {
    const launches = engines
      .filter((e) => selected.has(e.id) && e.available)
      .map((engine) => buildStartArgs(engine, scopeFor(engine.id)));
    onStarted(launches);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Classify sheet</DialogTitle>
          <DialogDescription>
            Run AI category classification over this sheet. Pick an engine and the rows to classify;
            each row's verdict appears in the Category column when the run finishes.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : engines.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No classification engines are available.
          </p>
        ) : (
          <div className="space-y-3">
            {engines.map((engine) => {
              const isSel = selected.has(engine.id);
              const scope = scopeFor(engine.id);
              const rangeCheck =
                scope.mode === "range" ? validateRange(scope.start, scope.end) : { ok: true };
              return (
                <div
                  key={engine.id}
                  className={cn(
                    "rounded-md border border-border px-3 py-2",
                    !engine.available && "opacity-60",
                  )}
                >
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={isSel}
                      disabled={!engine.available}
                      onCheckedChange={() => toggleEngine(engine)}
                      aria-label={`Classify with ${engine.label}`}
                    />
                    <span className="text-sm text-foreground">{engine.label}</span>
                    {!engine.available && (
                      <span className="text-xs text-muted-foreground">(coming soon)</span>
                    )}
                  </label>

                  {isSel && engine.available && (
                    <div className="mt-2 space-y-2 pl-6">
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setScope(engine.id, { mode: "sheet" })}
                          className={cn(
                            "rounded px-2 py-1",
                            scope.mode === "sheet"
                              ? "bg-primary/10 font-semibold text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          Whole sheet
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setScope(engine.id, { mode: "range", start: NaN, end: NaN })
                          }
                          className={cn(
                            "rounded px-2 py-1",
                            scope.mode === "range"
                              ? "bg-primary/10 font-semibold text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          Row range
                        </button>
                      </div>

                      {scope.mode === "range" && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              value={Number.isNaN(scope.start) ? "" : scope.start}
                              onChange={(ev) =>
                                setScope(engine.id, {
                                  mode: "range",
                                  start: ev.target.value === "" ? NaN : Number(ev.target.value),
                                  end: scope.end,
                                })
                              }
                              placeholder="Start row"
                              className="h-8 w-28"
                              aria-label="Start row"
                            />
                            <span className="text-xs text-muted-foreground">to</span>
                            <Input
                              type="number"
                              min={0}
                              value={Number.isNaN(scope.end) ? "" : scope.end}
                              onChange={(ev) =>
                                setScope(engine.id, {
                                  mode: "range",
                                  start: scope.start,
                                  end: ev.target.value === "" ? NaN : Number(ev.target.value),
                                })
                              }
                              placeholder="End row"
                              className="h-8 w-28"
                              aria-label="End row"
                            />
                          </div>
                          {!rangeCheck.ok && (
                            <p className="text-xs text-destructive">{rangeCheck.error}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            Classify {selected.size > 0 ? `${selected.size} ` : ""}
            engine{selected.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
