import React from "react";

import { cn } from "@/lib/utils";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import type { ChequeApproval, ChequeApprovalRow } from "@/utils/cheques/chequeApproval";

interface ChequePaymentsTableProps {
    /** The cheque's lines (`chequeApprovalRows`); the opened payment is highlighted. */
    rows: ChequeApprovalRow[];
    /** Adds the Status column and the cheque-total footer (the approve dialog). */
    approval?: ChequeApproval;
}

/**
 * The payments on one Payment cheque, as the approve and reject dialogs list them (#1480, #1481, spec #1477):
 * payment, PO, project and amount, with the payment the dialog was opened on highlighted. Given `approval`,
 * it also shows each payment's status and the cheque total.
 */
export const ChequePaymentsTable: React.FC<ChequePaymentsTableProps> = ({ rows, approval }) => (
    <div className="overflow-x-auto rounded-md border">
        <table className={cn("w-full text-left", approval ? "min-w-[560px]" : "min-w-[480px]")}>
            <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                    <th className="px-3 py-2 font-medium">Payment</th>
                    <th className="px-3 py-2 font-medium">PO</th>
                    <th className="px-3 py-2 font-medium">Project</th>
                    {approval && <th className="px-3 py-2 font-medium">Status</th>}
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((row) => (
                    <tr key={row.key} className={cn("border-t", row.isOpened && "bg-rose-50 dark:bg-rose-950/30")}>
                        <td
                            className={cn(
                                "px-3 py-2",
                                row.isOpened && "font-semibold",
                                !row.payment && "italic text-muted-foreground",
                            )}
                        >
                            {row.paymentLabel}
                        </td>
                        <td className="px-3 py-2">{row.record ?? "—"}</td>
                        <td className="px-3 py-2">{row.project_name ?? row.project ?? "—"}</td>
                        {approval && <td className="px-3 py-2">{row.statusLabel}</td>}
                        <td className="px-3 py-2 text-right tabular-nums">{formatToRoundedIndianRupee(row.amount)}</td>
                    </tr>
                ))}
            </tbody>
            {approval && (
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
            )}
        </table>
    </div>
);
