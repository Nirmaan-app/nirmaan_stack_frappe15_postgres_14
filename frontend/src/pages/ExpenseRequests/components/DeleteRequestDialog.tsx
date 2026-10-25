// src/pages/ExpenseRequests/components/DeleteRequestDialog.tsx
//
// Confirm, then delete a rejected request. Who may, and when, is decided by the server
// (`delete.can_delete`); the call refuses anything else whatever this screen shows.

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
    onClose: () => void;
    onDone: () => void;
}

const DeleteRequestDialog: React.FC<Props> = ({ request, onClose, onDone }) => {
    const { toast } = useToast();
    const [busy, setBusy] = useState(false);
    // The request on screen, kept after `request` turns null: the dialog animates out AFTER the
    // caller clears it, and read straight from the prop it then said "Delete ?" while closing.
    const [shown, setShown] = useState(request);
    if (request && request !== shown) setShown(request);
    const { call: remove } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.delete.delete_expense_request"
    );

    const run = async () => {
        if (!request) return;
        setBusy(true);
        try {
            await remove({ name: request.name });
            toast({ title: "Deleted", description: request.name, variant: "success" });
            onClose();
            onDone();
        } catch (e) {
            toast({ title: "Could not delete", description: getFrappeError(e), variant: "destructive" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <AlertDialog open={!!request} onOpenChange={(o) => !o && !busy && onClose()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete {shown?.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This rejected request ({shown?.type}) will be removed from the list.
                        You cannot undo this here.
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
