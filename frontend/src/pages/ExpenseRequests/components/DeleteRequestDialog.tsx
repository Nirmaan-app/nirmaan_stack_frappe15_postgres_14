// src/pages/ExpenseRequests/components/DeleteRequestDialog.tsx
//
// Confirm, then delete a REJECTED request. Who may, and which status, is decided by the
// server (`delete.can_delete`); the endpoint refuses anything else regardless.

import React, { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";
import type { ExpenseRequest } from "@/types/NirmaanStack/ExpenseRequest";

interface Props {
    request: ExpenseRequest | null;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}

const DeleteRequestDialog: React.FC<Props> = ({ request, onOpenChange, onDone }) => {
    const { toast } = useToast();
    const [busy, setBusy] = useState(false);
    const { call: remove } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.delete.delete_expense_request"
    );

    const run = async () => {
        if (!request) return;
        setBusy(true);
        try {
            await remove({ name: request.name });
            toast({ title: "Deleted", description: request.name, variant: "success" });
            onOpenChange(false);
            onDone();
        } catch (e: any) {
            toast({ title: "Could not delete", description: getFrappeError(e), variant: "destructive" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <AlertDialog open={!!request} onOpenChange={(o) => !o && !busy && onOpenChange(false)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete {request?.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This rejected request ({request?.type}) will be removed from the list.
                        This cannot be undone from here.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <Button variant="destructive" onClick={run} disabled={busy}>
                        {busy ? "Deleting..." : "Delete"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default DeleteRequestDialog;
