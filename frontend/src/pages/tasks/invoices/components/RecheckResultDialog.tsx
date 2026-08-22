/**
 * Preview / result dialog for the ceiling re-check.
 *
 * ONE PHASE: it shows what the dry run found and asks for confirmation, then
 * closes. There is deliberately no "here is what happened" screen afterwards —
 * the reviewer has just read this exact list and pressed the button on it, so a
 * second screen restating it, behind a Done button, is a click that buys
 * nothing. What actually got written is reported in the toast, which carries
 * the APPLIED numbers (they can differ from the preview if a delivery landed in
 * between).
 *
 * IT LISTS CANDIDATES ONLY. The queue is mostly Work Order invoices and rows
 * blocked on something the re-check has no opinion about; none of them can move,
 * so none of them appear. They are reported as a single count in the footer.
 * An earlier version listed every pending row it had looked at, and the handful
 * that mattered were invisible among forty that never stood a chance.
 *
 * ONE LIST: the invoices that will be auto-approved (owner ruling). Everything
 * else is a count, never a row.
 *
 * Earlier versions listed the rows that stay pending along with the reasons
 * holding them — and those reasons belong to gates this feature does not run.
 * Printing "Net + tax doesn't add up" under a re-check result claims the
 * re-check looked at it and formed a view, which it did not: that token was
 * copied through untouched. The honest surface for a run that only re-tests two
 * PO ceilings is the set of invoices those two ceilings just released.
 *
 * The confirm button is destructive-styled only when it approves something: an
 * approval moves money and cannot be undone here, whereas a reason-only
 * correction should not wear a warning.
 */
import React from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { TailSpin } from "react-loader-spinner";
import { CheckCircle2 } from "lucide-react";

import { describeReason } from "../utils/autoApproveReasons";
import {
    RecheckResponse,
    RecheckResultRow,
} from "../hooks/useRecheckAutoApprove";

interface RecheckResultDialogProps {
    isOpen: boolean;
    onClose: () => void;
    preview: RecheckResponse | null;
    isApplying: boolean;
    onConfirm: () => void;
    /** Names what the run covered, e.g. "the pending queue". */
    scopeLabel: string;
}

/** Reason tokens → their reviewer-facing labels, comma-joined. */
const labelTokens = (tokens: string[]): string =>
    tokens.map((token) => describeReason(token).label).join(", ");

/** The invoices this run releases — the only rows the dialog lists. */
const ApprovedList: React.FC<{ rows: RecheckResultRow[]; heading: string }> = ({
    rows,
    heading,
}) => (
    <div className="rounded-md border border-emerald-200">
        <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>
                {heading} · {rows.length}
            </span>
            <span className="font-normal opacity-75">
                invoiced total is now within both ceilings
            </span>
        </div>
        {/* Capped in HEIGHT, never in count — this is the list a reviewer is
            being asked to approve, so no row may be hidden from it. */}
        <ul className="max-h-[220px] divide-y divide-gray-100 overflow-y-auto px-3 py-1">
            {rows.map((row) => (
                <li
                    key={row.invoice_id}
                    className="flex items-baseline justify-between gap-3 py-1.5"
                >
                    <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium text-gray-900">
                            {row.document_name || row.invoice_id}
                            {row.invoice_no ? (
                                <span className="ml-1.5 font-normal text-gray-400">
                                    {row.invoice_no}
                                </span>
                            ) : null}
                        </p>
                        {row.cleared.length > 0 && (
                            <p className="mt-0.5 truncate text-[10px] text-red-600">
                                was: {labelTokens(row.cleared)}
                            </p>
                        )}
                        {/* THE EVIDENCE. "cleared: nothing delivered yet" says
                            what used to be wrong; it does not say why approving
                            is safe now. These are the two comparisons the checks
                            actually made, in the order they made them. */}
                        {row.cumulative !== null && (
                            <p className="mt-0.5 text-[10px] text-emerald-700">
                                invoiced {formatToRoundedIndianRupee(row.cumulative)}
                                {" ≤ delivered "}
                                {formatToRoundedIndianRupee(row.po_delivered ?? undefined)}
                                {" · ≤ PO value "}
                                {formatToRoundedIndianRupee(row.po_total ?? undefined)}
                            </p>
                        )}
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-gray-600">
                        {formatToRoundedIndianRupee(row.invoice_amount)}
                    </span>
                </li>
            ))}
        </ul>
    </div>
);

export const RecheckResultDialog: React.FC<RecheckResultDialogProps> = ({
    isOpen,
    onClose,
    preview,
    isApplying,
    onConfirm,
    scopeLabel,
}) => {
    const shown = preview;

    const rows = shown?.results ?? [];
    const approved = rows.filter((r) => r.outcome === "approved");
    const cleared = rows.filter((r) => r.outcome === "cleared");
    const blocked = rows.filter((r) => r.outcome === "blocked");

    // Blocked rows whose reason set is unchanged are written NOWHERE, so they
    // are not part of what the button applies.
    const rewritten = blocked.filter(
        (r) => r.before.join() !== r.after.join()
    );
    const writeCount = approved.length + cleared.length + rewritten.length;
    const stayingPending = cleared.length + blocked.length;

    return (
        <Dialog
            open={isOpen}
            onOpenChange={(open) => {
                if (!open && !isApplying) onClose();
            }}
        >
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Re-check results</DialogTitle>
                    <DialogDescription>
                        {shown
                            ? shown.checked === 0
                                ? `No invoice in ${scopeLabel} is waiting on a PO-value check.`
                                : `${shown.checked} invoice${
                                      shown.checked === 1 ? "" : "s"
                                  } in ${scopeLabel} waiting on a PO-value check.`
                            : "Re-checking…"}
                    </DialogDescription>
                </DialogHeader>

                {!shown ? (
                    <div className="flex justify-center py-8">
                        <TailSpin color="#d03b45" height={32} width={32} />
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {approved.length > 0 && (
                            <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                                <span className="font-semibold">
                                    {approved.length} invoice
                                    {approved.length === 1 ? "" : "s"} ·{" "}
                                    {formatToRoundedIndianRupee(shown.approved_value)}
                                </span>{" "}
                                now pass both checks and will be auto-approved,
                                with approved-by recorded as System.
                            </p>
                        )}

                        {approved.length > 0 && (
                            <p className="text-[11px] leading-relaxed text-gray-500">
                                An invoice is approved when everything invoiced on
                                its PO — this invoice plus every other pending or
                                approved one — comes to no more than the value
                                delivered, and no more than the PO itself. Both
                                figures are read off the PO as it stands right now.
                            </p>
                        )}

                        {approved.length > 0 && (
                            <ApprovedList rows={approved} heading="Will approve" />
                        )}

                        {approved.length === 0 && (
                            <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                                {shown.checked === 0
                                    ? "No invoice is waiting on a PO-value check right now."
                                    : "None of these can be auto-approved yet — the PO checks still hold them, or another reason does."}
                            </p>
                        )}

                        {/* The rest of the run as COUNTS. Naming those rows would
                            mean printing reasons from gates this run never
                            evaluated, which reads as a verdict it did not reach. */}
                        <p className="text-[10px] leading-relaxed text-gray-400">
                            Re-check re-runs only the PO-value checks — nothing
                            delivered yet, invoiced past delivered, invoiced past the
                            PO value. Every other reason is left exactly as recorded.
                            {stayingPending > 0 && (
                                <>
                                    {" "}
                                    {stayingPending} stay
                                    {stayingPending === 1 ? "s" : ""} pending.
                                </>
                            )}
                            {shown.truncated > 0 && (
                                <>
                                    {" "}
                                    {shown.truncated} candidate
                                    {shown.truncated === 1 ? "" : "s"} were beyond this
                                    run's limit — re-check again to continue.
                                </>
                            )}
                        </p>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isApplying}>
                        Cancel
                    </Button>
                            <Button
                                variant={approved.length > 0 ? "destructive" : "default"}
                                onClick={onConfirm}
                                disabled={isApplying || writeCount === 0}
                            >
                                {isApplying ? (
                                    <TailSpin color="#fff" height={18} width={18} />
                                ) : approved.length > 0 ? (
                                    `Approve ${approved.length}`
                                ) : (
                                    `Update ${writeCount} reason${
                                        writeCount === 1 ? "" : "s"
                                    }`
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default RecheckResultDialog;
