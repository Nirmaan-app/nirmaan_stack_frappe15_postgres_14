import React, { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import type { TdsBorneBy } from "@/types/NirmaanStack/PaymentTDSDeduction";

const ENDPOINT = "nirmaan_stack.api.payments.tds_paid_by_company.mark_tds_paid_by_company";

interface TdsPaidByCompanyActionProps {
    payment: { name: string; amount?: number | string; status?: string };
    /** The payment's recorded deduction (`get_work_order_tds` payments), if any. */
    deduction?: { tds_amount: number; borne_by: TdsBorneBy };
    /** Admin only: the server checks it again. */
    isAdmin: boolean;
    /** Called after a successful mark, to refetch the Work Order and its payments. */
    onMarked: () => unknown;
}

/**
 * *TDS paid by company* (#1537): an Admin marks a payment's tax, recorded as withheld from the vendor,
 * as paid by the company on top. No figure changes; Amount Paid stops counting the tax. Shown for a
 * vendor-borne deduction; the server refuses one whose tax is already in a challan.
 */
export const TdsPaidByCompanyAction: React.FC<TdsPaidByCompanyActionProps> = ({ payment, deduction, isAdmin, onMarked }) => {
    const [open, setOpen] = useState(false);
    const { call, loading } = useFrappePostCall<{ message: { amount_paid: number; amount_due: number } }>(ENDPOINT);

    if (!isAdmin || !deduction || deduction.borne_by !== "Vendor" || payment.status === "Rejected") return null;

    const handleConfirm = async () => {
        try {
            const { message } = await call({ payment: payment.name });
            toast({
                title: "TDS paid by company",
                description: `${payment.name}: Amount Paid ${formatToIndianRupeeOrZero(message.amount_paid)}, Amount Due ${formatToIndianRupeeOrZero(message.amount_due)}.`,
                variant: "success",
            });
            await onMarked();
            setOpen(false);
        } catch (err) {
            toast({ title: "Could not mark TDS paid by company", description: getFrappeError(err), variant: "destructive" });
        }
    };

    return (
        <>
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => setOpen(true)}>
                TDS paid by company
            </Button>
            <Dialog open={open} onOpenChange={(next) => !loading && setOpen(next)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>TDS paid by company</DialogTitle>
                        <DialogDescription>{payment.name}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 text-sm">
                        <p>
                            The {formatToIndianRupeeOrZero(deduction.tds_amount)} TDS on this payment is recorded as
                            withheld from the vendor. Mark it as paid by the company on top instead.
                        </p>
                        <p className="text-muted-foreground">
                            No amount changes: the payment stays {formatToIndianRupeeOrZero(Number(payment.amount) || 0)},
                            what the vendor got. Once the payment is Paid, Amount Paid counts only that, and the tax
                            stays in Total TDS and project outflow.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
                        <Button onClick={handleConfirm} disabled={loading}>
                            {loading ? "Marking…" : "Mark TDS paid by company"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};
