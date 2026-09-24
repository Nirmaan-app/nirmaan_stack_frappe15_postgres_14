// src/pages/outflow-import/components/BulkUnreconcileDialog.tsx
//
// The bulk Unreconcile check step (#1319, parent #1317). Mockup dialog 1.
//
// ⚠️ READ ONLY IN THIS SLICE. It lists what an Unreconcile would do to every ticked line and has only
// Cancel; the reason box and the run button are the next ticket's. No destructive action exists without
// this preview in front of it.

import { useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { bulkCheckSummary, bulkUnreconcileTitle } from "../bulkUnreconcileView";
import { describeFrappeError, ledgerLabel } from "../outflowTableModel";
import { legAmountLabel, type UnreconcilePlan } from "../unreconcileView";
import { LegOutcomeText } from "./UnreconcileDialog";

/** Counts openings; each one keys its own plan fetch, as `UnreconcilePanel` does. */
let bulkOpenings = 0;

const CheckStep = ({ rows, onClose }: { rows: string[]; onClose: () => void }) => {
    // ⚠️ ONE CACHE ENTRY PER OPENING: a re-opened dialog must never paint verdicts cached at an earlier
    // opening (see `UnreconcilePanel`).
    const [opening] = useState(() => ++bulkOpenings);
    const { data, isLoading, error } = useFrappeGetCall<{ message: { lines: UnreconcilePlan[] } }>(
        "nirmaan_stack.api.outflow_import.bulk_unreconcile.get_bulk_unreconcile_plan",
        { rows: JSON.stringify(rows) },
        `bulk-unreconcile-plan-${opening}`
    );
    const plans = data?.message?.lines;

    return (
        <>
            <DialogHeader>
                <DialogTitle>{bulkUnreconcileTitle(rows.length)}</DialogTitle>
                <DialogDescription>
                    Each transfer below is undone whole, the same as Reverse all on its own dialog. A transfer
                    that can't be undone is left as it is, and the others still go ahead.
                </DialogDescription>
            </DialogHeader>

            {isLoading ? (
                <p className="rounded-md border px-3 py-2.5 text-sm text-muted-foreground">
                    Loading the records on these transfers…
                </p>
            ) : error || !plans ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                    Could not load the records on these transfers ({describeFrappeError(error, "couldn't load")}).
                </p>
            ) : (
                <CheckList plans={plans} />
            )}

            <DialogFooter className="gap-2 sm:items-center">
                <span className="mr-auto max-w-[44ch] text-xs text-muted-foreground">
                    Nothing has changed. Blocked transfers stay Settled; you can fix them and undo them later on
                    their own.
                </span>
                <Button variant="outline" onClick={onClose}>
                    Cancel
                </Button>
            </DialogFooter>
        </>
    );
};

const CheckList = ({ plans }: { plans: UnreconcilePlan[] }) => {
    const summary = bulkCheckSummary(plans);
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
                {summary.pills.map((pill) => (
                    <span
                        key={pill.tone}
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium tabular-nums ${
                            pill.tone === "go"
                                ? "border-sky-600/30 bg-sky-50 text-sky-800"
                                : "border-border bg-muted text-muted-foreground"
                        }`}
                    >
                        {pill.text}
                    </span>
                ))}
            </div>
            <div className="max-h-[50vh] overflow-y-auto rounded-md border">
                {summary.lines.map(({ plan, blocked, reason, records }) => (
                    <div
                        key={plan.row}
                        className={`space-y-1.5 border-t px-3 py-2.5 first:border-t-0 ${blocked ? "bg-muted/50" : ""}`}
                    >
                        <div
                            className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm ${
                                blocked ? "opacity-70" : ""
                            }`}
                        >
                            <b className="tabular-nums">{formatToRoundedIndianRupee(plan.amount)}</b>
                            {plan.beneficiary_name && <span>{plan.beneficiary_name}</span>}
                            {plan.reference && (
                                <span className="font-mono text-xs text-muted-foreground">{plan.reference}</span>
                            )}
                            {plan.added_on && (
                                <span className="text-xs text-muted-foreground">
                                    {formatDate(plan.added_on.split(/[ T]/)[0])}
                                </span>
                            )}
                            {records.length > 1 && (
                                <span className="text-xs text-muted-foreground">{records.length} records</span>
                            )}
                            {blocked && (
                                <span className="rounded border px-1.5 text-[11px] font-medium text-muted-foreground">
                                    left out
                                </span>
                            )}
                        </div>
                        {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
                        {records.map(({ leg, outcome }) => (
                            <div key={leg.match} className="space-y-0.5 border-l-2 pl-2.5">
                                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/70">
                                        {ledgerLabel(leg.target_doctype)}
                                    </span>
                                    <span className="font-mono">{leg.target_name}</span>
                                    <span className="tabular-nums text-muted-foreground">{legAmountLabel(leg)}</span>
                                </div>
                                <LegOutcomeText line={outcome} />
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

/**
 * Opened by the toolbar's "Unreconcile N" with the ticked Settled lines (a snapshot taken at open).
 *
 * ⚠️ RENDER IT ONLY FOR THE UNDO ROLES. The plan endpoint refuses a plain Accountant.
 */
export const BulkUnreconcileDialog = ({ rows, onClose }: { rows: string[] | null; onClose: () => void }) => (
    <Dialog open={Boolean(rows)} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[85vh] w-[min(92vw,800px)] overflow-y-auto sm:max-w-none">
            {rows && <CheckStep rows={rows} onClose={onClose} />}
        </DialogContent>
    </Dialog>
);
