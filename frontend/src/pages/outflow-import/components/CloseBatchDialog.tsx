// src/pages/outflow-import/components/CloseBatchDialog.tsx

import { useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

interface ClosePreview {
    abandoned_rows: number;
    abandoned_amount: number;
    rows: { name: string; beneficiary_name: string; amount: number; row_status: string }[];
}

interface Props {
    batch: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (reason: string) => Promise<void>;
}

/**
 * Confirmation for closing a batch with work outstanding.
 *
 * It SAYS what will be abandoned rather than implying it -- the count, the money, and the rows --
 * because closing is the one action here whose consequence is invisible afterwards: the rows keep
 * their statuses and nothing on them changes.
 *
 * ⚠️ v3 made that MORE true, not less. "Completed with exceptions" is retired, so closing no longer
 * changes the batch's status at all -- it records `closed_at` and nothing else. Saying what is
 * abandoned is now the ONLY feedback the action gives. V5 simplifies this to a single button.
 */
export const CloseBatchDialog = ({ batch, open, onOpenChange, onConfirm }: Props) => {
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);

    const { data } = useFrappeGetCall<{ message: ClosePreview }>(
        "nirmaan_stack.api.outflow_import.review.get_close_preview",
        { batch },
        open ? undefined : null // only fetch while the dialog is actually open
    );
    const preview = data?.message;

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Close this import?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-3">
                            {preview?.abandoned_rows ? (
                                <>
                                    <p>
                                        <span className="font-medium text-foreground">
                                            {preview.abandoned_rows} transfers
                                        </span>{" "}
                                        totalling{" "}
                                        <span className="font-medium text-foreground">
                                            {formatToRoundedIndianRupee(preview.abandoned_amount)}
                                        </span>{" "}
                                        still need a decision. Closing records that they were left
                                        undecided.
                                    </p>
                                    <ul className="max-h-40 space-y-1 overflow-auto rounded border p-2 text-xs">
                                        {preview.rows.map((r) => (
                                            <li key={r.name} className="flex justify-between gap-3">
                                                <span className="truncate">
                                                    {r.beneficiary_name || "--"}
                                                </span>
                                                <span className="tabular-nums">
                                                    {formatToRoundedIndianRupee(r.amount)}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                    {/* Said explicitly because both halves surprise people: nothing
                                        happens to the rows, and closing is reversible. */}
                                    <p className="text-xs">
                                        Their status does not change and they can still be settled
                                        later. You can reopen the import at any time.
                                    </p>
                                </>
                            ) : (
                                <p>Every transfer in this import has been dealt with.</p>
                            )}
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {preview?.abandoned_rows ? (
                    <div className="space-y-1">
                        <Label className="text-xs">Reason (optional)</Label>
                        <Textarea
                            rows={2}
                            value={reason}
                            placeholder="Why are these being left?"
                            onChange={(e) => setReason(e.target.value)}
                        />
                    </div>
                ) : null}

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={busy}
                        onClick={async (e) => {
                            e.preventDefault();
                            setBusy(true);
                            try {
                                await onConfirm(reason.trim());
                                onOpenChange(false);
                                setReason("");
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Close import
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
