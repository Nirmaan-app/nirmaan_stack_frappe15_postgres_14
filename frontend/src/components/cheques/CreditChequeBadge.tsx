import { cn } from "@/lib/utils";

/**
 * The "Credit" badge of a Credit Payment Cheque (`Cheques.credit_payment_cheque`, owner 2026-10-31): its own
 * badge, before the cheque chip on the payment lists and before the status in the cheque's detail view.
 */
export const CreditChequeBadge = ({ className }: { className?: string }) => (
    <span
        className={cn(
            "inline-flex shrink-0 items-center whitespace-nowrap rounded border border-purple-300 bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium leading-tight text-purple-900",
            className,
        )}
        title="Credit Payment Cheque: pays a Credit PO term. Before the term's due date it is dated on or after that date."
    >
        Credit
    </span>
);
