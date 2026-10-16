import { TruncatedText } from "@/components/common/TruncatedText";
import { cn } from "@/lib/utils";
import { showsChequeChip } from "@/utils/cheques/chequeChip";
import type { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";

import { ChequeChip } from "./ChequeChip";
import type { ChequeChipFacts } from "./useChequeChips";

interface PaymentUtrOrChequeProps {
    payment: ProjectPayments;
    /** The Cheque the payment is on (`useChequeChips`), when it is on one. */
    chip?: ChequeChipFacts;
    className?: string;
}

/**
 * The "UTR / Cheque" cell of the Transaction Details card (#1416, spec #1407): an Online payment's UTR, or a
 * cheque payment's chip with its UTR under it once it is reconciled. The chip opens the Cheque. A Rejected
 * payment has dropped off its Cheque, so it shows no chip.
 */
export const PaymentUtrOrCheque = ({ payment, chip, className }: PaymentUtrOrChequeProps) => {
    if (!showsChequeChip(payment)) return <TruncatedText text={payment.utr} className={className} />;
    return (
        <div className="flex flex-col items-start gap-0.5">
            <ChequeChip cheque={payment.cheque} chequeNo={chip?.cheque_no || payment.cheque_no || ""} status={chip?.status} />
            {payment.utr && (
                <TruncatedText text={payment.utr} className={cn("block font-mono text-[10px] text-muted-foreground", className)} />
            )}
        </div>
    );
};
