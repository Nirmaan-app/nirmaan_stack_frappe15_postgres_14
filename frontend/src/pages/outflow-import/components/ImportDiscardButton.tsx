// src/pages/outflow-import/components/ImportDiscardButton.tsx

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

/**
 * Discard an import its own Create has not written to: Porter (#1447) and Credit Card (#1566). `offered` gets
 * whether the user is Admin or Accountant Lead (`canUndoOutflow`) and decides: a Credit Card import asks for
 * that, a Porter import does not (#1557). Renders nothing when `offered` says no. Asks first, then posts
 * `{batch}` to `method`; `onDiscarded` runs once the server has deleted it. The server asks every rule again.
 */
export const ImportDiscardButton = ({
    method,
    batch,
    offered,
    title,
    confirmation,
    onDiscarded,
}: {
    method: string;
    batch: string;
    /** Whether this import may be discarded by someone with undo access (the import's own rule). */
    offered: (canUndo: boolean) => boolean;
    title: string;
    confirmation: string;
    onDiscarded: () => void | Promise<void>;
}) => {
    const { role, user_id } = useUserData();
    const { call: discard } = useFrappePostCall(method);
    const [asking, setAsking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!offered(canUndoOutflow(role, user_id))) return null;

    const handleDiscard = async () => {
        setBusy(true);
        setError(null);
        try {
            await discard({ batch });
            setAsking(false);
            await onDiscarded();
        } catch (err: unknown) {
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
                        <AlertDialogTitle>{title}</AlertDialogTitle>
                        <AlertDialogDescription>{confirmation}</AlertDialogDescription>
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
