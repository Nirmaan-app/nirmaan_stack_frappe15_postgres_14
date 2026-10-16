import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { EditRefundDialog } from "./EditRefundDialog";
import type { VendorRefundRow } from "./useVendorRefunds";
import { useWaitingRefundExits } from "./useWaitingRefundExits";
import {
    canCancelRefund,
    canDeleteRefund,
    canMarkReceivedWithoutBankLine,
    hasNoProofAtAll,
    refundEditAccess,
} from "./waitingRefundExits";

type Exit = "cancel" | "markReceived" | "delete";

/** Each confirm dialog's words, by the action it confirms. */
const EXIT_COPY: Record<Exit, { title: (name: string) => string; body: (amount: string) => string; button: string }> = {
    cancel: {
        title: (name) => `Cancel waiting refund ${name}?`,
        body: (amount) =>
            `The refund of ${amount} is kept as Cancelled and counts for nothing. The overpaid credit it holds is free again. The PO stays locked until its balance is cleared another way.`,
        button: "Cancel refund",
    },
    markReceived: {
        title: (name) => `Mark ${name} received with no bank line?`,
        body: (amount) =>
            `The refund of ${amount} counts now: the paid amount drops, the adjustment balance clears and the PO unlocks. It shows "No bank proof" until a bank line is matched to it in Bulk Import.`,
        button: "Mark received",
    },
    delete: {
        title: (name) => `Delete cancelled refund ${name}?`,
        body: (amount) =>
            `The cancelled refund of ${amount} is removed for good. It never counted, so no paid amount, balance or credit moves.`,
        button: "Delete refund",
    },
};

interface WaitingRefundActionsProps {
    refund: VendorRefundRow;
    poId: string;
    /** Called after either write, so the page can refetch what the row does not own (the PO's paid amount). */
    onChanged?: () => void;
}

/**
 * The actions on a Vendor Refund, in its PO's Transaction Details row (#1396, #1403, ADR-0032).
 * "Edit" (its amount and PO while it waits, its proof, UTR and description at any status; "Attach proof"
 * when it has none, #1404); and the ways out for a waiting one: "Cancel" for its creator or an
 * Accountant, "Mark received" for an Admin with a required reason; and "Delete" on a Cancelled one for an
 * Admin or material Procurement. Renders nothing for anyone who may do none of these. The server
 * re-checks every one.
 */
export const WaitingRefundActions = ({ refund, poId, onChanged }: WaitingRefundActionsProps) => {
    const { user_id, role } = useUserData();
    const { cancel, markReceived, edit, remove, loading } = useWaitingRefundExits(poId);
    const [open, setOpen] = useState<Exit | null>(null);
    const [editing, setEditing] = useState(false);
    const [reason, setReason] = useState("");

    const access = refundEditAccess(refund, user_id, role);
    const mayCancel = canCancelRefund(refund, user_id, role);
    const mayMark = canMarkReceivedWithoutBankLine(refund, user_id, role);
    const mayDelete = canDeleteRefund(refund, user_id, role);
    if (!access.paperwork && !mayCancel && !mayMark && !mayDelete) return null;

    const close = () => {
        setOpen(null);
        setReason("");
    };

    const submit = async () => {
        try {
            if (open === "cancel") {
                await cancel(refund.name);
                toast({
                    title: "Refund cancelled",
                    description: `${refund.name} is Cancelled. Its credit is free again; the PO stays locked until its balance is cleared another way.`,
                    variant: "success",
                });
            } else if (open === "delete") {
                await remove(refund.name);
                toast({ title: "Refund deleted", description: `${refund.name} is deleted.`, variant: "success" });
            } else if (open === "markReceived") {
                await markReceived(refund.name, reason.trim());
                toast({
                    title: "Refund counted with no bank line",
                    description: `${refund.name} is Received and shows "No bank proof" until its bank line is matched.`,
                    variant: "success",
                });
            }
            close();
            onChanged?.();
        } catch (error) {
            toast({
                title: "Could not update the refund",
                description: error instanceof Error ? error.message : "Something went wrong.",
                variant: "destructive",
            });
        }
    };

    return (
        <span className="flex flex-col items-end gap-1">
            {access.paperwork && (
                <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setEditing(true)}>
                    {hasNoProofAtAll(refund) ? "Attach proof" : "Edit"}
                </Button>
            )}
            {access.paperwork && editing && (
                <EditRefundDialog
                    refund={refund}
                    poId={poId}
                    access={access}
                    open={editing}
                    onOpenChange={setEditing}
                    onSave={async (changes) => {
                        await edit(refund.name, changes);
                        onChanged?.();
                    }}
                />
            )}
            {mayMark && (
                <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setOpen("markReceived")}
                >
                    Mark received
                </Button>
            )}
            {mayCancel && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] text-destructive hover:text-destructive"
                    onClick={() => setOpen("cancel")}
                >
                    Cancel
                </Button>
            )}
            {mayDelete && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] text-destructive hover:text-destructive"
                    onClick={() => setOpen("delete")}
                >
                    Delete
                </Button>
            )}

            <AlertDialog open={open !== null} onOpenChange={(next) => !next && close()}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{open && EXIT_COPY[open].title(refund.name)}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {open && EXIT_COPY[open].body(formatToRoundedIndianRupee(refund.amount))}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {open === "markReceived" && (
                        <div className="space-y-1.5">
                            <Label htmlFor={`no-bank-line-reason-${refund.name}`}>
                                Reason<sup className="text-red-600">*</sup>
                            </Label>
                            <Textarea
                                id={`no-bank-line-reason-${refund.name}`}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Why does this refund count without its bank line?"
                            />
                        </div>
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={loading}>Back</AlertDialogCancel>
                        <Button
                            onClick={submit}
                            disabled={loading || (open === "markReceived" && !reason.trim())}
                            variant={open === "markReceived" ? "default" : "destructive"}
                        >
                            {loading ? "Saving…" : open && EXIT_COPY[open].button}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </span>
    );
};
