import React from "react";
import { AlertTriangle, Lock } from "lucide-react";

import { ChequeChip } from "@/components/cheques/ChequeChip";
import {
    ceoNote,
    chequeApprovalRows,
    otherPaymentsText,
    type ChequeApproval,
    type ChequeApprovalStage,
} from "@/utils/cheques/chequeApproval";

import { ChequePaymentsTable } from "./ChequePaymentsTable";

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
                <ChequeChip cheque={approval.cheque} chequeNo={approval.cheque_no} status={approval.status}
                    credit={!!approval.credit_payment_cheque} />
                {others ? `${others}. One cheque is approved as one.` : null}
            </p>

            <ChequePaymentsTable rows={rows} approval={approval} />

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
