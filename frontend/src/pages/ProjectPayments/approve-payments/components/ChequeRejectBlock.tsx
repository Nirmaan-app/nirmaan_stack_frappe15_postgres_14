import React from "react";
import { AlertCircle } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { ChequeChip } from "@/components/cheques/ChequeChip";
import { chequeApprovalRows, rejectNote, type ChequeApproval } from "@/utils/cheques/chequeApproval";

import { ChequePaymentsTable } from "./ChequePaymentsTable";

interface ChequeRejectBlockProps {
    approval: ChequeApproval;
    /** The payment the dialog was opened on: named first and highlighted. */
    openedPayment: string;
    reason: string;
    onReasonChange: (reason: string) => void;
    disabled?: boolean;
}

/**
 * The reject dialog's body for a payment on a Payment cheque (#1481, spec #1477): every payment that will be
 * Rejected with it, what happens to the cheque, and the one required reason, written on each payment and in
 * the cheque's history.
 */
export const ChequeRejectBlock: React.FC<ChequeRejectBlockProps> = ({
    approval,
    openedPayment,
    reason,
    onReasonChange,
    disabled = false,
}) => {
    const rows = chequeApprovalRows(approval, openedPayment).filter((row) => row.payment);
    const others = rows.length - 1;

    return (
        <div className="space-y-3 text-sm">
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
                You picked {openedPayment}.
                {others > 0 ? " It shares " : " It is on "}
                <ChequeChip cheque={approval.cheque} chequeNo={approval.cheque_no} status={approval.status}
                    credit={!!approval.credit_payment_cheque} />
                {others > 0 ? ` with ${others} other${others === 1 ? "" : "s"}, so all are rejected.` : null}
            </p>

            <ChequePaymentsTable rows={rows} />

            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                <p>{rejectNote(approval)}</p>
            </div>

            <div>
                <label htmlFor="cheque-reject-reason" className="text-xs font-medium text-muted-foreground">
                    Reason <span className="text-red-600">*</span>
                </label>
                <Textarea
                    id="cheque-reject-reason"
                    rows={3}
                    value={reason}
                    onChange={(e) => onReasonChange(e.target.value)}
                    disabled={disabled}
                    required
                    aria-required="true"
                    placeholder="Why are these payments rejected?"
                    className="mt-1 resize-none"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Saved on each payment and in the cheque&apos;s history.</p>
            </div>
        </div>
    );
};
