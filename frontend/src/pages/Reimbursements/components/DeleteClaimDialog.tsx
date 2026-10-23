/**
 * Delete the claimant's own claim: while it is Pending Approval, or once it is Rejected. Its receipts go
 * with it, and so does a rejection's reason. The server checks the same rule (`claims.delete_reimbursement`).
 */

import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";

import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import type { Reimbursement } from "@/types/NirmaanStack/Reimbursement";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import { REJECTED } from "@/utils/reimbursements/rules";

const DELETE_API = "nirmaan_stack.api.reimbursements.claims.delete_reimbursement";

interface Props {
    open: boolean;
    /** Kept by the page after closing, so the dialog still shows it while it animates out. */
    claim: Reimbursement | null;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}

export function DeleteClaimDialog({ open, claim, onOpenChange, onDone }: Props) {
    const { toast } = useToast();
    const [error, setError] = useState<string | null>(null);
    const { call, loading } = useFrappePostCall(DELETE_API);

    const close = (next: boolean) => {
        if (!next) setError(null);
        onOpenChange(next);
    };

    const confirm = async () => {
        if (!claim) return;
        try {
            await call({ name: claim.name });
            toast({ title: `Deleted ${claim.name}`, variant: "success" });
            close(false);
            onDone();
        } catch (e) {
            setError(getFrappeError(e));
        }
    };

    return (
        <AlertDialog open={open && !!claim} onOpenChange={close}>
            <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete {claim?.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {claim && `${claim.title} · ${formatToIndianRupee(claim.amount)}. `}
                        {claim?.status === REJECTED ? "Its rejection reason and receipts are deleted too." : "Its receipts are deleted too."}{" "}
                        This can't be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Keep it</AlertDialogCancel>
                    <Button variant="destructive" onClick={confirm} disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Delete claim
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
