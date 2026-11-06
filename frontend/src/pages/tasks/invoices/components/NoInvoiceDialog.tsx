/**
 * The "Mark No invoice" dialog of the Pending Invoices Upload queues (Credit Card #1570, Cashbook #1592): a typed
 * reason is required; who and when are recorded by the server.
 */
import React from "react";

import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface NoInvoiceDialogProps {
    /** The expense being marked; the dialog is open while it is set. */
    expense: string | null;
    reason: string;
    setReason: (reason: string) => void;
    saving: boolean;
    onClose: () => void;
    onSubmit: () => void;
    /** The textarea's id, unique per queue. */
    inputId: string;
}

export const NoInvoiceDialog: React.FC<NoInvoiceDialogProps> = ({
    expense, reason, setReason, saving, onClose, onSubmit, inputId,
}) => (
    <AlertDialog open={!!expense} onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Mark No invoice</AlertDialogTitle>
                <AlertDialogDescription>
                    {expense}: this spend will never have an invoice. Your name, the time and the reason
                    are kept on the expense.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-1">
                <Label htmlFor={inputId}>Reason <sup className="text-destructive">*</sup></Label>
                <Textarea id={inputId} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <AlertDialogFooter>
                <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
                <Button onClick={onSubmit} disabled={saving || !reason.trim()}>
                    {saving ? "Saving..." : "Mark No invoice"}
                </Button>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
);

export default NoInvoiceDialog;
