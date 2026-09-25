// src/pages/outflow-import/components/BulkUnreconcileDialog.tsx
//
// Bulk Unreconcile (parent #1317): the check step (#1319, mockup dialog 1), then the run (#1320): one reason,
// a blocking spinner (dialog 2), and a result box (dialog 3).
//
// ⚠️ THE SERVER DECIDES EVERYTHING. The check step shows the plan; only the lines it says can be undone are
// sent, and the write re-checks each one under its own lock and may still block it. The result box shows
// what the write says happened, never what the plan predicted.
//
// ⚠️ NO CLOSE WHILE IT RUNS. The request is synchronous (owner, after timing: about 5-15 s for 50 lines);
// closing mid-run would leave the table showing a picture the server is still changing.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    bulkCheckSummary,
    bulkFailedSentence,
    bulkResultSummary,
    bulkRunningTitle,
    bulkStartLabel,
    bulkUnreconcileTitle,
    type BulkCheckSummary,
    type BulkResultSummary,
    type BulkUnreconcileResponse,
} from "../bulkUnreconcileView";
import { rowStatusTone } from "../outflowImportStatus";
import { describeFrappeError, ledgerLabel } from "../outflowTableModel";
import { legAmountLabel, type UnreconcilePlan } from "../unreconcileView";
import { LegOutcomeText } from "./UnreconcileDialog";

/** Counts openings; each one keys its own plan fetch, as `UnreconcilePanel` does. */
let bulkOpenings = 0;

type Phase =
    | { kind: "check" }
    | { kind: "running"; count: number }
    | { kind: "done"; summary: BulkResultSummary; reason: string }
    | { kind: "failed"; count: number; error: string };

const BulkRun = ({
    rows,
    phase,
    setPhase,
    onClose,
}: {
    rows: string[];
    phase: Phase;
    setPhase: (phase: Phase) => void;
    /** Cancel on the check step, Close after a run: the parent tells the two apart by the phase. */
    onClose: () => void;
}) => {
    // ⚠️ ONE CACHE ENTRY PER OPENING: a re-opened dialog must never paint verdicts cached at an earlier
    // opening (see `UnreconcilePanel`).
    const [opening] = useState(() => ++bulkOpenings);
    const { data, isLoading, error } = useFrappeGetCall<{ message: { lines: UnreconcilePlan[] } }>(
        "nirmaan_stack.api.outflow_import.bulk_unreconcile.get_bulk_unreconcile_plan",
        { rows: JSON.stringify(rows) },
        `bulk-unreconcile-plan-${opening}`
    );
    const { call } = useFrappePostCall<{ message: BulkUnreconcileResponse }>(
        "nirmaan_stack.api.outflow_import.bulk_unreconcile.bulk_unreconcile_rows"
    );
    const [reason, setReason] = useState("");
    const plans = data?.message?.lines;

    const start = async (going: string[]) => {
        const trimmed = reason.trim();
        if (!plans || !going.length || !trimmed) return;
        setPhase({ kind: "running", count: going.length });
        try {
            const response = await call({ rows: JSON.stringify(going), reason: trimmed });
            setPhase({ kind: "done", summary: bulkResultSummary(response.message, plans), reason: trimmed });
        } catch (err) {
            setPhase({
                kind: "failed",
                count: going.length,
                error: describeFrappeError(err, "the request did not finish"),
            });
        }
    };

    if (phase.kind === "running") {
        return (
            <>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                        {bulkRunningTitle(phase.count)}
                    </DialogTitle>
                    <DialogDescription>
                        This usually takes a few seconds, and up to about 15 for a full page. Each transfer is saved
                        on its own as soon as it's done.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" disabled>
                        Close
                    </Button>
                </DialogFooter>
            </>
        );
    }
    if (phase.kind === "failed") {
        return (
            <>
                <DialogHeader>
                    <DialogTitle>The unreconcile did not finish</DialogTitle>
                    <DialogDescription>{bulkFailedSentence(phase.count, phase.error)}</DialogDescription>
                </DialogHeader>
                <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                    Each transfer is saved on its own, so any finished before it stopped stay undone and the rest
                    are still Settled. The table has been refreshed to show what really changed.
                </p>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Close
                    </Button>
                </DialogFooter>
            </>
        );
    }
    if (phase.kind === "done") return <ResultStep summary={phase.summary} reason={phase.reason} onClose={onClose} />;

    const summary = plans ? bulkCheckSummary(plans) : null;
    const going = summary ? summary.lines.filter((line) => !line.blocked).map((line) => line.plan.row) : [];

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
            ) : error || !summary ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                    Could not load the records on these transfers ({describeFrappeError(error, "couldn't load")}).
                </p>
            ) : (
                <CheckList summary={summary} />
            )}

            {summary && going.length > 0 && (
                <div className="space-y-1.5">
                    <Label htmlFor="bulk-unreconcile-reason" className="text-xs">
                        Reason (required, saved on every transfer and record)
                    </Label>
                    <Input
                        id="bulk-unreconcile-reason"
                        value={reason}
                        placeholder="Why are these matches being undone?"
                        onChange={(e) => setReason(e.target.value)}
                    />
                </div>
            )}

            <DialogFooter className="gap-2 sm:items-center">
                <span className="mr-auto max-w-[44ch] text-xs text-muted-foreground">
                    Blocked transfers stay Settled. You can fix them and undo them later on their own.
                </span>
                <Button variant="outline" onClick={onClose}>
                    Cancel
                </Button>
                {summary && going.length > 0 && (
                    <Button variant="destructive" disabled={!reason.trim()} onClick={() => start(going)}>
                        {bulkStartLabel(going.length)}
                    </Button>
                )}
            </DialogFooter>
        </>
    );
};

const ResultStep = ({
    summary,
    reason,
    onClose,
}: {
    summary: BulkResultSummary;
    reason: string;
    onClose: () => void;
}) => (
    <>
        <DialogHeader>
            <DialogTitle>{summary.title}</DialogTitle>
            <DialogDescription>Reason saved: “{reason}”.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
            {summary.groups.length > 0 && (
                <div className="overflow-hidden rounded-md border">
                    <div className="flex justify-between gap-2 bg-muted px-3 py-2 text-xs font-medium">
                        <span>Undone</span>
                        <span className="font-normal text-muted-foreground">where each one is now</span>
                    </div>
                    {summary.groups.flatMap((group) =>
                        group.lines.map((line) => (
                            <div
                                key={line.row}
                                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t px-3 py-2 text-sm"
                            >
                                <LineName beneficiary={line.beneficiary} amount={line.amount} row={line.row} />
                                <span className="row-span-2 flex flex-wrap items-center justify-end gap-1.5">
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${rowStatusTone(group.status)}`}
                                    >
                                        {group.label}
                                    </span>
                                    {group.confirmByHand && (
                                        <span className="whitespace-nowrap rounded border border-amber-500/40 bg-amber-50 px-1.5 text-[11px] font-medium text-amber-900">
                                            Confirm by hand
                                        </span>
                                    )}
                                </span>
                                <span className="text-xs text-muted-foreground">{line.records.join(" · ")}</span>
                            </div>
                        ))
                    )}
                </div>
            )}

            {summary.blocked.length > 0 && (
                <div className="overflow-hidden rounded-md border">
                    <div className="flex justify-between gap-2 bg-muted px-3 py-2 text-xs font-medium">
                        <span>Blocked, still Settled</span>
                        <span className="font-normal text-muted-foreground">nothing changed on these</span>
                    </div>
                    {summary.blocked.map((line) => (
                        <div key={line.row} className="space-y-0.5 border-t px-3 py-2 text-sm">
                            <LineName beneficiary={line.beneficiary} amount={line.amount} row={line.row} />
                            <p className="text-xs text-muted-foreground">{line.reason}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {summary.confirmByHandNote && (
            <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                Undone transfers are marked <b>Confirm by hand</b>, so "Confirm all matched" skips them. Open each
                one to confirm the right record.
            </p>
        )}

        <DialogFooter>
            <Button variant="outline" onClick={onClose}>
                Close
            </Button>
        </DialogFooter>
    </>
);

const LineName = ({ beneficiary, amount, row }: { beneficiary: string | null; amount: number | null; row: string }) => (
    <span>
        {beneficiary ?? <span className="font-mono text-xs">{row}</span>}
        {amount !== null && <span className="tabular-nums"> · {formatToRoundedIndianRupee(amount)}</span>}
    </span>
);

const CheckList = ({ summary }: { summary: BulkCheckSummary }) => {
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
 * `onClose` is Cancel on the check step: nothing changed. `onFinished` is Close after a run (or a failed
 * one): the page clears every tick and refetches the table and the summary (#1317 story 28). `onRefresh`
 * refetches straight away when the request fails, so the table behind the box shows what is true.
 *
 * ⚠️ RENDER IT ONLY FOR THE UNDO ROLES. Both endpoints refuse a plain Accountant.
 */
export const BulkUnreconcileDialog = ({
    rows,
    onClose,
    onFinished,
    onRefresh,
}: {
    rows: string[] | null;
    onClose: () => void;
    onFinished: () => void;
    onRefresh: () => void;
}) => {
    const [phase, setPhaseState] = useState<Phase>({ kind: "check" });
    const setPhase = (next: Phase) => {
        setPhaseState(next);
        if (next.kind === "failed") onRefresh();
    };
    const running = phase.kind === "running";
    const ran = phase.kind === "done" || phase.kind === "failed";
    const close = () => {
        if (running) return;
        setPhaseState({ kind: "check" });
        if (ran) onFinished();
        else onClose();
    };
    return (
        <Dialog open={Boolean(rows)} onOpenChange={(open) => !open && close()}>
            <DialogContent
                className="max-h-[85vh] w-[min(92vw,800px)] overflow-y-auto sm:max-w-none"
                // ⚠️ The prop is named backwards: `true` SHOWS the X. Hidden only while it runs.
                disableCloseIcon={!running}
                onEscapeKeyDown={(e) => running && e.preventDefault()}
                onInteractOutside={(e) => running && e.preventDefault()}
            >
                {rows && <BulkRun rows={rows} phase={phase} setPhase={setPhase} onClose={close} />}
            </DialogContent>
        </Dialog>
    );
};
