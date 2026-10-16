import React from "react";
import { AlertTriangle, Lock } from "lucide-react";

import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { chequeChipText, chequeChipTone } from "@/utils/cheques/chequeChip";
import {
    ceoNote,
    chequeApprovalRows,
    otherPaymentsText,
    type ChequeApproval,
    type ChequeApprovalStage,
} from "@/utils/cheques/chequeApproval";

interface ChequeApprovalBlockProps {
    approval: ChequeApproval;
    /** The payment the dialog was opened on: highlighted in the list. */
    openedPayment: string;
    stage: ChequeApprovalStage;
}

/**
 * The approval dialog's body for a payment on a Payment cheque (#1480, spec #1477): every payment on the
 * cheque with its PO, project, status and amount, the cheque total, where the approval lands them, and why
 * it cannot be approved yet. One cheque is approved as one, so there is no amount box.
 */
export const ChequeApprovalBlock: React.FC<ChequeApprovalBlockProps> = ({ approval, openedPayment, stage }) => {
    const rows = chequeApprovalRows(approval, openedPayment);
    const note = ceoNote(approval, stage);
    const others = otherPaymentsText(approval);

    return (
        <div className="space-y-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
                It is on
                <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs font-semibold ${chequeChipTone(approval.status)}`}
                >
                    {chequeChipText(approval.cheque_no, approval.status)}
                </span>
                {others ? `${others}. One cheque is approved as one.` : null}
            </p>

            <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[560px] text-left">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 font-medium">Payment</th>
                            <th className="px-3 py-2 font-medium">PO</th>
                            <th className="px-3 py-2 font-medium">Project</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 text-right font-medium">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr
                                key={row.key}
                                className={`border-t ${row.isOpened ? "bg-rose-50 dark:bg-rose-950/30" : ""}`}
                            >
                                <td className={`px-3 py-2 ${row.isOpened ? "font-semibold" : ""} ${row.payment ? "" : "italic text-muted-foreground"}`}>
                                    {row.paymentLabel}
                                </td>
                                <td className="px-3 py-2">{row.record ?? "—"}</td>
                                <td className="px-3 py-2">{row.project_name ?? row.project ?? "—"}</td>
                                <td className="px-3 py-2">{row.statusLabel}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{formatToRoundedIndianRupee(row.amount)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="border-t bg-muted/40">
                            <td colSpan={4} className="px-3 py-2 text-muted-foreground">
                                Cheque total · {approval.vendor_name ?? approval.vendor ?? "—"} · {approval.bank} {approval.cheque_no}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">
                                {formatToRoundedIndianRupee(approval.amount)}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {approval.problem ? (
                <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2">
                    <Lock className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
                    <p>
                        <span className="font-semibold">Approval waits.</span> {approval.problem}
                    </p>
                </div>
            ) : note ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                    <p>
                        <span className="font-semibold">Needs CEO approval too.</span> {note}
                    </p>
                </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
                Cheque payments are approved in full. There is no partial amount, and you can&apos;t approve one
                payment without the others. Once fully approved, the cheque is Issued and waits in the Cheque Tracker.
            </p>
        </div>
    );
};
