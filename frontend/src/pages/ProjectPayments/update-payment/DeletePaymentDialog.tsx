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
        } catch (error: any) {
            // This catch block handles errors thrown by the fetcher itself (e.g., network error, or if fetcher re-throws)
            // or errors from frappe.call if not caught within the fetcher
            console.error("Error during payment deletion:", error);
            let description = "Could not delete payment.";
            if (error.message) { // General JS error
                description = error.message;
            }
            // If your useFrappePostCall within useUpdatePaymentRequest's fetcher
            // throws an error object with _server_messages (Frappe standard for API errors)
            else if (error._server_messages) {
                try {
                    const serverMessage = JSON.parse(error._server_messages);
                    description = serverMessage[0]?.message || JSON.stringify(serverMessage[0]) || description;
                } catch (e) { /* ignore parsing error of _server_messages */ }
            }
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
                        {paymentToDelete.utr && ` (UTR: ${paymentToDelete.utr})`}
                        {" "}for an amount of <strong>{formatToIndianRupee(paymentToDelete.amount)}</strong>?
                        <br />
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