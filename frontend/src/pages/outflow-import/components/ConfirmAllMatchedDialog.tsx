// src/pages/outflow-import/components/ConfirmAllMatchedDialog.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

import { ledgerLabel, type ConfirmableRow, type ConfirmOutcome } from "../outflowTableModel";

interface Props {
    batch?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSettled: () => Promise<void> | void;
}

interface Payload {
    batch: string;
    ready: ConfirmableRow[];
    needs_you: ConfirmableRow[];
    ready_value: number;
}

/**
 * Confirm every transfer the matcher was SURE about, for one import (slice X5).
 *
 * ⚠️ IT SAYS "CONFIRM", NEVER "APPROVE" (owner ruling 2026-08-09). This feature never approves
 * anything -- it records that already-approved money left the bank. A dialog headed "Approve"
 * would tell an accountant they are approving payments, which is false, and this is the one screen
 * where that misunderstanding would be acted on forty times in a row.
 *
 * ⚠️ ONE CALL PER ROW, DELIBERATELY -- NOT ONE BULK ENDPOINT. Each settle is its own savepoint and
 * its own commit, so a failure on the third leaves the first two written and the rest still
 * attempted. `settle_row`'s own docstring forbids the all-or-nothing shape in as many words: one
 * unsettleable row must never discard the good decisions around it. That reasoning gets STRONGER at
 * forty rows, not weaker, which is why the loop lives here rather than on the server where the easy
 * version of it would be a single transaction.
 *
 * ⚠️ FAILURES ARE NORMAL HERE. Payments get ticked Paid by hand all day, so some rows will be gone
 * by the time this runs. The per-row lock makes a stale confirm FAIL rather than write the wrong
 * thing -- so the results panel reports them plainly instead of treating them as an error state.
 */
export const ConfirmAllMatchedDialog = ({ batch, open, onOpenChange, onSettled }: Props) => {
    const [skip, setSkip] = useState<ReadonlySet<string>>(new Set());
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(0);
    const [outcomes, setOutcomes] = useState<ConfirmOutcome[] | null>(null);

    const { data, isLoading } = useFrappeGetCall<{ message: Payload }>(
        "nirmaan_stack.api.outflow_import.review.get_confirmable_rows",
        { batch },
        open && batch ? `outflow-confirmable-${batch}` : null
    );

    const { call: callSettle } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.expenses.settle_row"
    );

    const ready = useMemo(() => data?.message?.ready ?? [], [data]);
    const needsYou = useMemo(() => data?.message?.needs_you ?? [], [data]);

    // A dialog is reused; without this the second run opens showing the first one's results.
    useEffect(() => {
        if (open) return;
        setSkip(new Set());
        setOutcomes(null);
        setDone(0);
        setRunning(false);
    }, [open]);

    const chosen = useMemo(() => ready.filter((r) => !skip.has(r.name)), [ready, skip]);
    const changing = useMemo(() => chosen.filter((r) => r.amount_changes), [chosen]);

    const toggle = useCallback((name: string) => {
        setSkip((prev) => {
            const next = new Set(prev);
            next.has(name) ? next.delete(name) : next.add(name);
            return next;
        });
    }, []);

    const run = useCallback(async () => {
        if (!chosen.length) return;
        setRunning(true);
        setDone(0);
        const results: ConfirmOutcome[] = [];
        for (const row of chosen) {
            try {
                await callSettle({
                    row: row.name,
                    target_doctype: row.target_doctype,
                    target_name: row.target_name,
                });
                results.push({ row, ok: true });
            } catch (err: any) {
                results.push({ row, ok: false, error: err?.message || "Could not settle." });
            }
            setDone((n) => n + 1);
        }
        setOutcomes(results);
        setRunning(false);
        await onSettled();
    }, [chosen, callSettle, onSettled]);

    const settled = outcomes?.filter((o) => o.ok).length ?? 0;
    const failed = outcomes?.filter((o) => !o.ok) ?? [];

    return (
        <Dialog open={open} onOpenChange={(next) => (running ? null : onOpenChange(next))}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>
                        {outcomes ? "Confirmation results" : `Confirm ${chosen.length} matched`}
                    </DialogTitle>
                    <DialogDescription>
                        {outcomes
                            ? "Each row was settled on its own. A failure left the others untouched."
                            : "Each transfer is recorded against the approved record the matcher picked. Nothing here approves anything."}
                    </DialogDescription>
                </DialogHeader>

                {isLoading && (
                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
                    </div>
                )}

                {!isLoading && outcomes && (
                    <div className="max-h-[50vh] space-y-2 overflow-y-auto">
                        <p className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            <span className="font-medium">{settled} settled</span>
                            {failed.length > 0 && (
                                <span className="text-muted-foreground">
                                    · {failed.length} could not be
                                </span>
                            )}
                        </p>
                        {failed.map((outcome) => (
                            <div
                                key={outcome.row.name}
                                className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm"
                            >
                                <div className="flex items-center gap-2">
                                    <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                                    <span className="font-medium">
                                        {outcome.row.beneficiary_name}
                                    </span>
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {outcome.row.target_name}
                                    </span>
                                </div>
                                <p className="pl-5 text-xs text-destructive">{outcome.error}</p>
                            </div>
                        ))}
                        {failed.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                                These are usually rows somebody settled by hand since the match ran.
                                Re-run the match to see where they stand now.
                            </p>
                        )}
                    </div>
                )}

                {!isLoading && !outcomes && (
                    <div className="max-h-[50vh] space-y-4 overflow-y-auto">
                        {ready.length === 0 && (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                                Nothing is ready to confirm in this import.
                            </p>
                        )}

                        {ready.length > 0 && (
                            <table className="w-full border-collapse text-sm">
                                <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                                    <tr className="text-left">
                                        <th className="w-8 px-2 py-1.5" />
                                        <th className="px-2 py-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                                            Transfer
                                        </th>
                                        <th className="px-2 py-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                                            Settles
                                        </th>
                                        <th className="px-2 py-1.5 text-right text-xs uppercase tracking-wide text-muted-foreground">
                                            Amount
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ready.map((row) => (
                                        <tr key={row.name} className="border-t align-top">
                                            <td className="px-2 py-1.5">
                                                <Checkbox
                                                    checked={!skip.has(row.name)}
                                                    disabled={running}
                                                    onCheckedChange={() => toggle(row.name)}
                                                    aria-label={`Confirm ${row.beneficiary_name}`}
                                                />
                                            </td>
                                            <td className="px-2 py-1.5">
                                                <div className="font-medium">
                                                    {row.beneficiary_name || "—"}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {row.added_on
                                                        ? formatDate(row.added_on.split(/[ T]/)[0])
                                                        : "—"}
                                                    {row.remarks ? ` · ${row.remarks}` : ""}
                                                </div>
                                            </td>
                                            <td className="px-2 py-1.5">
                                                <div className="flex items-center gap-1.5">
                                                    <Badge
                                                        variant="outline"
                                                        className="border-0 bg-muted text-[11px]"
                                                    >
                                                        {ledgerLabel(row.target_doctype ?? "")}
                                                    </Badge>
                                                    <span className="font-mono text-xs">
                                                        {row.target_name}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {[row.vendor_name, row.project_name]
                                                        .filter(Boolean)
                                                        .join(" · ") || "—"}
                                                </div>
                                            </td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">
                                                {/* ⚠️ THE DELTA IS SHOWN BEFORE THE CLICK, NOT AFTER
                                                    (slice X1). Confirming REWRITES the record's
                                                    amount to the bank's, so a row that will change
                                                    an approved figure has to say so here. */}
                                                {row.amount_changes ? (
                                                    <div className="flex items-center justify-end gap-1 text-xs">
                                                        <span className="text-muted-foreground line-through">
                                                            {formatToRoundedIndianRupee(
                                                                row.target_amount
                                                            )}
                                                        </span>
                                                        <ArrowRight className="h-3 w-3 text-amber-600" />
                                                        <span className="font-medium text-amber-700">
                                                            {formatToRoundedIndianRupee(row.amount)}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span>
                                                        {formatToRoundedIndianRupee(row.amount)}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}

                        {changing.length > 0 && (
                            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>
                                    {changing.length}{" "}
                                    {changing.length === 1 ? "record" : "records"} will be updated to
                                    the amount that actually left the bank. The change is recorded
                                    against your name.
                                </span>
                            </p>
                        )}

                        {/* ⚠️ LISTED, NEVER CONFIRMABLE. These matched SEVERAL approved records, so
                            the matcher deliberately picked none -- there is nothing to confirm them
                            against, and a checkbox here would be a promise this dialog cannot keep. */}
                        {needsYou.length > 0 && (
                            <div className="rounded-md border bg-muted/30 p-3">
                                <p className="text-sm font-medium">
                                    {needsYou.length} matched more than one record
                                </p>
                                <p className="mb-2 text-xs text-muted-foreground">
                                    Nothing was pre-selected for these, so they are not part of this
                                    action. Open each one from the table to choose.
                                </p>
                                <ul className="space-y-0.5 text-xs text-muted-foreground">
                                    {needsYou.slice(0, 8).map((row) => (
                                        <li key={row.name} className="truncate">
                                            {row.beneficiary_name} ·{" "}
                                            {formatToRoundedIndianRupee(row.amount)}
                                        </li>
                                    ))}
                                    {needsYou.length > 8 && (
                                        <li>and {needsYou.length - 8} more</li>
                                    )}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter>
                    {outcomes ? (
                        <Button onClick={() => onOpenChange(false)}>Close</Button>
                    ) : (
                        <>
                            <Button
                                variant="outline"
                                disabled={running}
                                onClick={() => onOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            <Button disabled={!chosen.length || running} onClick={run}>
                                {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {running
                                    ? `Confirming ${done} of ${chosen.length}…`
                                    : `Confirm ${chosen.length}`}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
