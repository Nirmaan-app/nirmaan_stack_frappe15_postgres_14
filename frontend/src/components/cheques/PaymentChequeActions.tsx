import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import type { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { getFrappeError } from "@/utils/frappeErrors";
import { paymentChequeButtons, SWITCH_TO_ONLINE_API } from "@/utils/cheques/paymentChequeActions";

import { NewPaymentChequeDialog, type NewPaymentChequeKind } from "./NewPaymentChequeDialog";
import type { ChequeChipFacts } from "./useChequeChips";

interface PaymentChequeActionsProps {
    payment: ProjectPayments;
    /** The Cheque the payment is on (`useChequeChips`), when it is on one. */
    chip?: ChequeChipFacts;
    /** Called after any change, so the card refetches its payments. */
    onChanged: () => void;
}

const BUTTON = "h-6 px-2 text-[11px] text-foreground";

/**
 * The cheque buttons on a payment in the PO / Work Order page's Transaction Details (#1416, spec #1407),
 * inline like the rest of the app: Convert to Cheque on an Online payment that is not Rejected; Link a new
 * cheque and Switch to Online once the payment's Cheque is Cancelled. Admin, Accountants and Procurement
 * only (`paymentChequeButtons`); the server re-checks every one.
 */
export const PaymentChequeActions = ({ payment, chip, onChanged }: PaymentChequeActionsProps) => {
    const { role } = useUserData();
    const [dialog, setDialog] = useState<NewPaymentChequeKind | null>(null);
    const [switching, setSwitching] = useState(false);
    const { call: switchToOnline, loading } = useFrappePostCall<{ message: { status: string } }>(SWITCH_TO_ONLINE_API);

    const buttons = paymentChequeButtons({ ...payment, chequeStatus: chip?.status }, role);
    if (!buttons.convert && !buttons.linkNew && !buttons.switchOnline) return null;

    const confirmSwitch = async () => {
        try {
            const r = await switchToOnline({ payment: payment.name });
            toast({
                title: "Switched to Online",
                description: `${payment.name} is an Online payment again and stays ${r.message.status}.`,
                variant: "success",
            });
            setSwitching(false);
            onChanged();
        } catch (e) {
            toast({ title: "Could not switch to Online", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <span className="inline-flex flex-wrap items-center justify-end gap-1">
            {buttons.convert && (
                <Button variant="outline" size="sm" className={BUTTON} onClick={() => setDialog("convert")}>
                    Convert to Cheque
                </Button>
            )}
            {buttons.linkNew && (
                <Button variant="outline" size="sm" className={BUTTON} onClick={() => setDialog("link_new")}>
                    Link a new cheque
                </Button>
            )}
            {buttons.switchOnline && (
                <Button variant="ghost" size="sm" className={BUTTON} onClick={() => setSwitching(true)}>
                    Switch to Online
                </Button>
            )}

            {dialog && (
                <NewPaymentChequeDialog payment={payment} kind={dialog} onClose={() => setDialog(null)} onDone={onChanged} />
            )}

            <AlertDialog open={switching} onOpenChange={(open) => !open && !loading && setSwitching(false)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Switch {payment.name} to Online?</AlertDialogTitle>
                        <AlertDialogDescription>
                            The payment leaves cancelled cheque {chip?.cheque_no ?? payment.cheque_no} and becomes an Online
                            payment. Its status stays {payment.status}. The cancelled cheque is kept as history.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={loading}>Back</AlertDialogCancel>
                        <Button onClick={confirmSwitch} disabled={loading}>
                            {loading ? "Switching…" : "Switch to Online"}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </span>
    );
};
