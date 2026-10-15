// src/pages/outflow-import/components/PorterDiscardButton.tsx

import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2, Trash2 } from "lucide-react";

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
import { useUserData } from "@/hooks/useUserData";

import { canUndoOutflow } from "../outflowImportStatus";
import { describeFrappeError } from "../outflowTableModel";
import { PORTER_DISCARD_METHOD, canDiscardPorter, discardConfirmation } from "../porterDiscard";
import type { PorterStatus } from "../porterImport";

/**
 * Discard a Porter import Create has not written to (#1447): its batch, lines, Porter Invoices and PDFs.
 * Admin and Accountant Lead only; renders nothing for anyone else, or once Create has written anything.
 * Asks first, then posts; `onDiscarded` runs once the server has deleted it.
 */
export const PorterDiscardButton = ({
    status,
    onDiscarded,
}: {
    status: PorterStatus;
    onDiscarded: () => void | Promise<void>;
}) => {
    const { role, user_id } = useUserData();
    const { call: discard } = useFrappePostCall(PORTER_DISCARD_METHOD);
    const [asking, setAsking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!canDiscardPorter(status, canUndoOutflow(role, user_id))) return null;

    const handleDiscard = async () => {
        setBusy(true);
        setError(null);
        try {
            await discard({ batch: status.batch });
            setAsking(false);
            await onDiscarded();
        } catch (err: any) {
            setError(describeFrappeError(err, "The import could not be discarded."));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Button
                variant="ghost"
                className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                    setError(null);
                    setAsking(true);
                }}
            >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Discard import
            </Button>
            <AlertDialog open={asking} onOpenChange={(open) => !busy && setAsking(open)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Discard this Porter import?</AlertDialogTitle>
                        <AlertDialogDescription>{discardConfirmation(status)}</AlertDialogDescription>
                    </AlertDialogHeader>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
                        <Button variant="destructive" onClick={handleDiscard} disabled={busy}>
                            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                            Discard
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
