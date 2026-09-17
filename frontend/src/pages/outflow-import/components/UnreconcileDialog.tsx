// src/pages/outflow-import/components/UnreconcileDialog.tsx
//
// Unreconcile a settled transfer (#1275, parent #1270, ADR-0022). Mockup scenes 1-3.

import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Ban, CornerUpLeft, GitMerge, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { describeFrappeError, ledgerLabel } from "../outflowTableModel";
import {
    legOutcomeLine,
    recordsHeading,
    reverseAllBlockedSentence,
    reverseAllLabel,
    type LegTone,
    type UnreconcilePlan,
    type UnreconcileResult,
    VERDICT_REFUSED,
} from "../unreconcileView";

const TONE_CLASS: Record<LegTone, string> = {
    back: "text-sky-800",
    deleted: "text-red-700",
    split: "text-amber-800",
    refused: "text-muted-foreground",
    other: "text-foreground",
};

/** Counts panel openings; each one keys its own plan fetch (see `UnreconcilePanel`). */
let planOpenings = 0;

/**
 * The record list, the one reason box and Reverse all -- the ONE undo surface, shown in the
 * Unreconcile dialog and in the decision dialog's "Already allocated" section (#1270 story 48).
 *
 * ⚠️ IT READS THE SERVER'S PLAN, NEVER THE LEGS ITS PARENT ALREADY HOLDS. Each record's verdict and
 * sentence come from `get_unreconcile_plan`, the same decision the write re-asks under its locks, so a
 * record that would be refused is greyed here instead of being offered and then refused.
 *
 * ⚠️ RENDER IT ONLY FOR THE UNDO ROLES. The plan endpoint refuses a plain Accountant.
 *
 * The write's refusal (a record changed since the plan was read, a concurrent writer) shows inline,
 * and nothing closes until the write succeeds.
 */
export const UnreconcilePanel = ({
    row,
    disabled = false,
    onDone,
    onCancel,
    heading,
}: {
    row: string;
    disabled?: boolean;
    onDone: (result: UnreconcileResult) => Promise<void> | void;
    /** Present in the standalone dialog, which owns a Cancel beside Reverse all. */
    onCancel?: () => void;
    /** A caption above the list, for the decision dialog's section. */
    heading?: string;
}) => {
    const [reason, setReason] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const trimmed = reason.trim();
    // ⚠️ ONE CACHE ENTRY PER OPENING, NEVER ONE PER ROW. A row-only key let a re-opened panel paint the
    // plan cached at its last opening before the refetch landed -- after undoing a DIFFERENT line (the
    // transfer that paid a part payment's leftover, #1279) that stale paint showed a refusal which was no
    // longer true. A fresh key shows "Loading…" until the server's current verdicts arrive. Held in
    // state so it is stable for this mount: the post-reverse `mutate` still refreshes the same entry.
    const [opening] = useState(() => ++planOpenings);

    const {
        data,
        isLoading,
        error: planError,
        mutate,
    } = useFrappeGetCall<{ message: UnreconcilePlan }>(
        "nirmaan_stack.api.outflow_import.unreconcile.get_unreconcile_plan",
        { row },
        `unreconcile-plan-${row}-${opening}`,
    );
    const { call } = useFrappePostCall<{ message: UnreconcileResult }>(
        "nirmaan_stack.api.outflow_import.unreconcile.unreconcile_row",
    );
    const plan = data?.message;

    const reverse = async (legs: string[] | "all") => {
        setBusy(true);
        setError(null);
        try {
            const response = await call({
                row,
                legs: legs === "all" ? "all" : JSON.stringify(legs),
                reason: trimmed,
            });
            await mutate();
            setReason("");
            await onDone(response.message);
        } catch (err) {
            setError(describeFrappeError(err, "Nothing was reversed."));
            // A refusal can mean the plan is out of date; re-read it so the list shows why.
            mutate();
        } finally {
            setBusy(false);
        }
    };

    if (isLoading) {
        return (
            <p className="rounded-md border px-3 py-2.5 text-sm text-muted-foreground">
                Loading the records on this transfer…
            </p>
        );
    }
    if (planError || !plan) {
        return (
            <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                Could not load the records on this transfer (
                {describeFrappeError(planError, "couldn't load")}).
            </p>
        );
    }

    const locked = disabled || busy;
    const blockedSentence = reverseAllBlockedSentence(plan);

    return (
        <div className="space-y-4">
            {heading && <p className="text-sm font-medium text-sky-900">{heading}</p>}
            <div className="overflow-hidden rounded-md border">
                <div className="flex items-center justify-between gap-2 bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    <span>{recordsHeading(plan)}</span>
                    <span className="tabular-nums">{formatToRoundedIndianRupee(plan.allocated)} allocated</span>
                </div>
                {plan.legs.map((leg) => {
                    const line = legOutcomeLine(leg);
                    const refused = leg.verdict === VERDICT_REFUSED;
                    return (
                        <div
                            key={leg.match}
                            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t px-3 py-2.5 ${
                                refused ? "bg-muted/30" : ""
                            }`}
                        >
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/70">
                                    {ledgerLabel(leg.target_doctype)}
                                </span>
                                <span className="font-mono">{leg.target_name}</span>
                                <span className="tabular-nums text-xs text-muted-foreground">
                                    {formatToRoundedIndianRupee(leg.target_amount)}
                                </span>
                            </div>
                            <div className="row-span-2">
                                {/* A vendor refund line is undone whole -- no per-record Reverse. */}
                                {!plan.reverse_all_only && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 px-2 text-xs"
                                        disabled={refused || !trimmed || locked}
                                        title={
                                            refused
                                                ? "This record can't be undone here."
                                                : !trimmed
                                                  ? "Type a reason first."
                                                  : undefined
                                        }
                                        onClick={() => reverse([leg.match])}
                                    >
                                        Reverse
                                    </Button>
                                )}
                            </div>
                            <div className={`flex items-start gap-1.5 text-xs ${TONE_CLASS[line.tone]}`}>
                                {refused ? (
                                    <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                ) : line.tone === "deleted" ? (
                                    <Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                ) : line.tone === "split" ? (
                                    <GitMerge className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                ) : (
                                    <CornerUpLeft className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                )}
                                <div>
                                    {line.lead && <b className="font-semibold">{line.lead} </b>}
                                    {line.text}
                                    {line.items && (
                                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                            {line.items.map((item) => (
                                                <li key={item}>{item}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {plan.reverse_all_only && (
                <p className="text-xs text-muted-foreground">
                    Vendor refunds on a transfer are undone together: Reverse all deletes every vendor
                    refund on it, and the transfer goes back to needing a record.
                </p>
            )}

            <div className="space-y-1.5">
                <Label htmlFor={`unreconcile-reason-${row}`} className="text-xs">
                    Reason (required)
                </Label>
                <Input
                    id={`unreconcile-reason-${row}`}
                    value={reason}
                    placeholder="Why is this match being undone?"
                    disabled={locked}
                    onChange={(e) => {
                        setReason(e.target.value);
                        setError(null);
                    }}
                />
                {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
                {blockedSentence && (
                    <span className="mr-auto max-w-[44ch] text-xs text-amber-800">{blockedSentence}</span>
                )}
                {onCancel && (
                    <Button variant="outline" disabled={busy} onClick={onCancel}>
                        Cancel
                    </Button>
                )}
                <Button
                    variant="destructive"
                    disabled={Boolean(blockedSentence) || !plan.legs.length || !trimmed || locked}
                    onClick={() => reverse("all")}
                >
                    {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    {reverseAllLabel(plan)}
                </Button>
            </div>
        </div>
    );
};

/** The standalone dialog behind a Settled line's Unreconcile button (mockup scene 2). */
export const UnreconcileDialog = ({
    row,
    onClose,
    onDone,
}: {
    row: OutflowImportRow | null;
    onClose: () => void;
    onDone: (result: UnreconcileResult) => Promise<void> | void;
}) => (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[85vh] w-[min(92vw,760px)] overflow-y-auto sm:max-w-none">
            {row && (
                <>
                    <DialogHeader>
                        <DialogTitle>Unreconcile this transfer?</DialogTitle>
                        <DialogDescription>
                            Each record below comes off this transfer. The transfer then needs a record
                            again, and each record is free to match another transfer.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                        <span>
                            <b className="tabular-nums text-foreground">
                                {formatToRoundedIndianRupee(row.amount)}
                            </b>{" "}
                            paid
                        </span>
                        {row.beneficiary_name && <span>{row.beneficiary_name}</span>}
                        {(row.bank_reference_no || row.transfer_id) && (
                            <span className="font-mono">{row.bank_reference_no || row.transfer_id}</span>
                        )}
                        {row.added_on && <span>{formatDate(row.added_on.split(/[ T]/)[0])}</span>}
                    </div>
                    <UnreconcilePanel row={row.name} onDone={onDone} onCancel={onClose} />
                </>
            )}
        </DialogContent>
    </Dialog>
);
