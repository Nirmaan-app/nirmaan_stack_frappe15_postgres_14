import { useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Info, Loader2 } from "lucide-react";

import { useDuplicateChequeOf } from "@/components/cheques/useExistingCheque";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { PaymentModeFields } from "@/pages/ProjectPayments/components/PaymentModeFields";
import { useVendorTdsRates } from "@/pages/ProjectPayments/hooks/useVendorTdsRates";
import { isGstPayment } from "@/pages/ProjectPayments/paymentKind";
import {
    EMPTY_PAYMENT_MODE,
    isPaymentModeComplete,
    PAYMENT_MODE_CHEQUE,
    paymentModeArgs,
    type PaymentModeValue,
} from "@/pages/ProjectPayments/paymentMode";
import { forecastTds } from "@/pages/ProjectPayments/tdsForecast";
import type { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import { newChequeStatusHint, PUT_ON_NEW_CHEQUE_API, tdsStillToWithhold } from "@/utils/cheques/paymentChequeActions";

export type NewPaymentChequeKind = "convert" | "link_new";

const COPY: Record<NewPaymentChequeKind, { title: string; button: string; done: string }> = {
    convert: { title: "Convert to Cheque", button: "Convert to Cheque", done: "Payment converted to Cheque" },
    link_new: { title: "Link a new cheque", button: "Link new cheque", done: "New cheque linked" },
};

interface NewPaymentChequeDialogProps {
    payment: ProjectPayments;
    kind: NewPaymentChequeKind;
    onClose: () => void;
    /** Called after the Cheque was made, so the card refetches its payments. */
    onDone: () => void;
}

/**
 * Convert to Cheque (an Online payment) and Link a new cheque (a payment whose Cheque is Cancelled, or on no Cheque), from
 * the Transaction Details card (#1416, spec #1407). The same photo-first cheque form as Request Payment; the
 * server makes a new one-line Cheque for the payment. Says what will happen to the payment's status; a
 * replaced Cheque stays, Cancelled, as history. Mount it only while open.
 */
export const NewPaymentChequeDialog = ({ payment, kind, onClose, onDone }: NewPaymentChequeDialogProps) => {
    const [cheque, setCheque] = useState<PaymentModeValue>({ ...EMPTY_PAYMENT_MODE, mode: PAYMENT_MODE_CHEQUE });
    const duplicateOf = useDuplicateChequeOf(cheque);
    const { call, loading } = useFrappePostCall<{ message: { cheque: string; status: string } }>(PUT_ON_NEW_CHEQUE_API);
    const copy = COPY[kind];

    // A waiting Work Order payment is still gross: the cheque is written for it after the TDS forecast.
    const tdsRows = useMemo(
        () =>
            tdsStillToWithhold(payment.status)
                ? [{ vendor: payment.vendor, document_type: payment.document_type, document_name: payment.document_name }]
                : [],
        [payment.status, payment.vendor, payment.document_type, payment.document_name],
    );
    const { rateFor, companyBorneFor, isLoading: tdsLoading } = useVendorTdsRates(tdsRows);
    const companyBorne = companyBorneFor(payment.document_name);
    const tds = tdsRows.length
        ? forecastTds(payment.document_type, payment.amount, rateFor(payment.vendor ?? ""), companyBorne, isGstPayment(payment))
        : null;

    const submit = async () => {
        const { mode_of_payment: _mode, ...args } = paymentModeArgs(cheque);
        try {
            const r = await call({ payment: payment.name, ...args });
            toast({
                title: copy.done,
                description: `${payment.name} is on its new cheque ${cheque.cheque_no.trim()} and is ${r.message.status}.`,
                variant: "success",
            });
            onDone();
            onClose();
        } catch (e) {
            toast({ title: `Could not ${copy.title.toLowerCase()}`, description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <Dialog open onOpenChange={(o) => !o && !loading && onClose()}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>{copy.title}</DialogTitle>
                    <DialogDescription>
                        Payment {payment.name}, {formatToIndianRupeeOrZero(payment.amount)}, {payment.status}.
                        {kind === "link_new" && payment.cheque && " Its cancelled cheque stays as history."}
                    </DialogDescription>
                </DialogHeader>
                <PaymentModeFields
                    value={cheque}
                    onChange={setCheque}
                    amount={tdsLoading ? undefined : payment.amount}
                    tds={tds}
                    companyBorne={companyBorne}
                    vendor={payment.vendor}
                    disabled={loading}
                    purpose="new_cheque"
                />
                <p className="flex items-start gap-1.5 rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-900">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {newChequeStatusHint(payment)}
                </p>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={loading}>
                        Back
                    </Button>
                    <Button onClick={submit} disabled={loading || !isPaymentModeComplete(cheque, duplicateOf)}>
                        {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                        {copy.button}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
