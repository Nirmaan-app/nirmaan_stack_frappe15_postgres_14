import { useState } from "react";
import { useFrappePostCall, useSWRConfig } from "frappe-react-sdk";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { CHEQUE_TYPE } from "@/types/NirmaanStack/Cheques";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { CANCEL_CHEQUE_API, cancelNote, cancelNoteProblem, paymentsRejectedByCancel } from "@/utils/cheques/chequeStatus";
import { getFrappeError } from "@/utils/frappeErrors";

import { chequeDetailKey, useChequeDetail } from "./useChequeDetail";

interface CancelChequeDialogProps {
    /** The Cheque to cancel. */
    cheque: string;
    onClose: () => void;
    /** Called after the cheque was cancelled. */
    onDone: () => void;
}

/**
 * Cancel by hand (#1484, spec #1477): every payment on the cheque becomes Rejected, with the note as their
 * reason, and the cheque becomes Cancelled. Lists the payments that will be Rejected before the user confirms.
 * The cheque keeps its lines and history. A Security Deposit cheque (#1486) is "marked returned": it becomes
 * Cancelled with the note, and no payment is touched. Mount it only while open.
 */
export const CancelChequeDialog = ({ cheque: name, onClose, onDone }: CancelChequeDialogProps) => {
    const { cheque, isLoading } = useChequeDetail(name);
    const [note, setNote] = useState("");
    const { call, loading } = useFrappePostCall(CANCEL_CHEQUE_API);
    const { mutate } = useSWRConfig();

    const isDeposit = cheque?.cheque_type === CHEQUE_TYPE.SECURITY_DEPOSIT;
    const rejected = cheque && !isDeposit ? paymentsRejectedByCancel(cheque.lines) : [];
    const problem = cancelNoteProblem(note);

    const submit = async () => {
        try {
            await call({ cheque: name, note: note.trim() });
            toast({
                title: isDeposit
                    ? `Security Deposit ${cheque?.cheque_no ?? ""} marked returned`
                    : `Cheque ${cheque?.cheque_no ?? ""} cancelled`,
                variant: "success",
            });
            mutate(chequeDetailKey(name));
            onDone();
            onClose();
        } catch (e) {
            toast({ title: "Not cancelled", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {isDeposit ? `Mark Security Deposit ${cheque?.cheque_no ?? ""} returned` : `Cancel cheque ${cheque?.cheque_no ?? ""}`}
                    </DialogTitle>
                    <DialogDescription>
                        {isDeposit
                            ? "It becomes Cancelled. No payment is touched: a deposit cheque pays nothing. This cannot be undone."
                            : "Cancelling cannot be undone."}
                    </DialogDescription>
                </DialogHeader>

                {isLoading || !cheque ? (
                    <div className="flex justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        {!isDeposit && (
                        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            <p className="flex items-center gap-1.5 font-medium">
                                <AlertTriangle className="h-4 w-4 shrink-0" /> {cancelNote(cheque.cheque_no, rejected.length)}
                            </p>
                            {rejected.length > 0 && (
                                <ul className="mt-2 space-y-0.5 text-xs">
                                    {rejected.map((l) => (
                                        <li key={l.payment_name} className="flex justify-between gap-3">
                                            <span className="font-mono">{l.payment_name}</span>
                                            <span className="text-amber-800">
                                                {l.record_name} · {l.payment_status} · {formatToIndianRupeeOrZero(l.amount)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        )}
                        <div className="space-y-1.5">
                            <Label htmlFor="cancel-note">
                                Note <span className="text-destructive">*</span>
                            </Label>
                            <Textarea
                                id="cancel-note"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder={
                                    isDeposit
                                        ? "e.g. Returned by vendor at handover."
                                        : "Why is the cheque cancelled? Each payment is rejected with this reason."
                                }
                                rows={3}
                            />
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={loading}>
                        Close
                    </Button>
                    <Button variant="destructive" onClick={submit} disabled={loading || !cheque || !!problem}>
                        {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                        {isDeposit
                            ? "Mark returned"
                            : rejected.length > 0
                              ? `Reject ${rejected.length} and cancel cheque`
                              : "Cancel cheque"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
