import React from 'react';
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
import { TailSpin } from 'react-loader-spinner';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import formatToIndianRupee from '@/utils/FormatPrice';
import { toast } from '@/components/ui/use-toast';
import { DeletePayload, useUpdatePaymentRequest } from '../hooks/useUpdatePaymentRequests';
import { TruncatedText } from "@/components/common/TruncatedText";
import { serverRefusalText } from "@/utils/frappeErrorText";

interface DeletePaymentDialogProps {
    isOpen: boolean;
    onOpenChange: () => void;
    paymentToDelete: ProjectPayments | null;
    onDeleteSuccess: () => void; // Callback to refresh data in parent
}

export const DeletePaymentDialog: React.FC<DeletePaymentDialogProps> = ({
    isOpen,
    onOpenChange,
    paymentToDelete,
    onDeleteSuccess,
}) => {
    const { trigger: updatePaymentTrigger, isMutating } = useUpdatePaymentRequest();

    const handleConfirmDelete = async () => {
        if (!paymentToDelete) return;

        const payload: DeletePayload = {
            action: "delete",
            name: paymentToDelete.name,
        };

        try {
            const result = await updatePaymentTrigger(payload); // Pass payload as the argument for SWRMutation

            // Your useSWRMutation fetcher returns {status:"success"}
            if (result && result.status === "success") {
                toast({
                    title: "Success!",
                    description: `Payment ${paymentToDelete.name} deleted successfully.`,
                    variant: "success",
                });
                onDeleteSuccess();
                onOpenChange(); // Close dialog on success
            } else {
                // If backend returns a different structure on error, or if result is unexpected
                const errorMsg = result?.message || "Failed to delete payment. Unexpected response.";
                toast({ title: "Deletion Failed", description: errorMsg, variant: "destructive" });
            }
        } catch (error: unknown) {
            // A network error, or the server's own refusal (`frappe.throw`): read by the one typed accessor (F2),
            // which prefers the server's message over the SDK's generic one.
            console.error("Error during payment deletion:", error);
            const description = serverRefusalText(error) || "Could not delete payment.";
            toast({ title: "Error", description, variant: "destructive" });
        }
    };

    if (!paymentToDelete) return null;

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
                    <AlertDialogDescription>
                        Are you sure you want to delete Payment ID: <strong>{paymentToDelete.name}</strong>
                        {paymentToDelete.utr && <> (UTR: <TruncatedText text={paymentToDelete.utr} className="max-w-[16rem]" />)</>}
                        {" "}for an amount of <strong>{formatToIndianRupee(paymentToDelete.amount)}</strong>?
                        <br />
                        {/* The server does this, not the dialog: Project Payments on_trash. */}
                        {paymentToDelete.document_type === "Service Requests" && (
                            <>Any TDS deducted on this payment is deleted with it.<br /></>
                        )}
                        This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
                    <Button
                        variant="destructive"
                        onClick={handleConfirmDelete}
                        disabled={isMutating}
                    >
                        {isMutating ? (
                            <TailSpin color="#fff" height={20} width={20} />
                        ) : (
                            "Confirm Delete"
                        )}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};