import { useState } from "react";
import { useFrappePostCall, useSWRConfig } from "frappe-react-sdk";
import { AlertTriangle, Loader2 } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { CHEQUE_STATUS, type ChequeStatus } from "@/types/NirmaanStack/Cheques";
import {
    bulkResultText,
    CHEQUE_STATUS_API,
    CHEQUE_STATUSES_API,
    noteProblem,
    pendingAfterCancel,
    statusTargets,
    type ChequeStatusesResult,
} from "@/utils/cheques/chequeStatus";
import { getFrappeError } from "@/utils/frappeErrors";

import { chequeDetailKey } from "./useChequeDetail";

interface ChangeChequeStatusDialogProps {
    /** The Cheques to move (one from a row, several from the bulk bar). */
    cheques: string[];
    /** Their status when they all share one; undefined for a mixed selection. */
    currentStatus?: ChequeStatus;
    /** The target it opens on (the tracker's Clear and Cancel buttons, #1483); the first one otherwise. */
    initialTarget?: ChequeStatus;
    onClose: () => void;
    /** Called after a change was written. */
    onDone: () => void;
}

/**
 * Change status (#1412, spec #1407), for one Cheque or a bulk selection. Previews the move on the
 * server (`dry_run`), so the user sees which cheques will be skipped and why (a Paid payment blocks
 * Cancel), and, for Cancel, which payments stay at Reconciliation Pending. The note is optional
 * except for Cancel, and one note covers every cheque.
 *
 * Mount it only while open, keyed on the selection: each opening starts at the first target with no note.
 * The preview is keyed on the selection and the target, so picking a target fetches its own.
 */
export const ChangeChequeStatusDialog = ({ cheques, currentStatus, initialTarget, onClose, onDone }: ChangeChequeStatusDialogProps) => {
    const targets = statusTargets(currentStatus);
    const [target, setTarget] = useState<ChequeStatus>(
        initialTarget && targets.includes(initialTarget) ? initialTarget : targets[0],
    );
    const [note, setNote] = useState("");
    const { call: callPreview } = useFrappePostCall<{ message: ChequeStatusesResult }>(CHEQUE_STATUSES_API);
    const { call: changeMany, loading: changingMany } = useFrappePostCall<{ message: ChequeStatusesResult }>(CHEQUE_STATUSES_API);
    const { call: changeOne, loading: changingOne } = useFrappePostCall<{ message: { status: ChequeStatus } }>(CHEQUE_STATUS_API);

    const { mutate } = useSWRConfig();
    const single = cheques.length === 1;
    const { data: preview, isValidating: previewing } = useSWR(
        ["cheque-status-preview", cheques.join("|"), target],
        async () => (await callPreview({ cheques: JSON.stringify(cheques), status: target, dry_run: true })).message,
        {
            revalidateOnFocus: false,
            onError: (e) => toast({ title: "Could not check the cheques", description: getFrappeError(e), variant: "destructive" }),
        },
    );

    const problem = noteProblem(target, note);
    const movable = preview?.changed.length ?? 0;
    const pending = preview ? pendingAfterCancel(preview.changed) : [];
    const saving = changingOne || changingMany;

    const submit = async () => {
        try {
            if (single) {
                await changeOne({ cheque: cheques[0], status: target, note: note.trim() || undefined });
                toast({ title: `Cheque is now ${target}`, variant: "success" });
            } else {
                const r = await changeMany({ cheques: JSON.stringify(cheques), status: target, note: note.trim() || undefined });
                toast({
                    title: `Cheques moved to ${target}`,
                    description: bulkResultText(r.message),
                    variant: r.message.skipped.length ? "default" : "success",
                });
            }
            // A detail view open on these Cheques shows the new status and history at once, without
            // waiting on the realtime event.
            cheques.forEach((cheque) => mutate(chequeDetailKey(cheque)));
            onDone();
            onClose();
        } catch (e) {
            toast({ title: "Status not changed", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{single ? "Change status" : `Change status of ${cheques.length} cheques`}</DialogTitle>
                    <DialogDescription>
                        Each change is recorded in the cheque's history with your name, the time and the note.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label>Move to</Label>
                        <Select value={target} onValueChange={(v) => setTarget(v as ChequeStatus)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {targets.map((s) => (
                                    <SelectItem key={s} value={s}>
                                        {s}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label>
                            Note{" "}
                            {target === CHEQUE_STATUS.CANCELLED ? (
                                <span className="text-destructive">*</span>
                            ) : (
                                <span className="text-muted-foreground">(optional)</span>
                            )}
                        </Label>
                        <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder={target === CHEQUE_STATUS.CANCELLED ? "Why is the cheque cancelled?" : ""}
                            rows={3}
                        />
                    </div>

                    {previewing && (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
                        </p>
                    )}

                    {preview && !single && (
                        <p className="text-sm">
                            {movable} will change
                            {preview.skipped.length > 0 && `, ${preview.skipped.length} will be skipped`}.
                        </p>
                    )}
                    {preview && preview.skipped.length > 0 && (
                        <ul className="space-y-1 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                            {preview.skipped.map((s) => (
                                <li key={s.cheque}>
                                    {single ? "This cheque cannot move: " : `${s.cheque_no || s.cheque}: `}
                                    {s.reason}
                                </li>
                            ))}
                        </ul>
                    )}

                    {target === CHEQUE_STATUS.CANCELLED && pending.length > 0 && (
                        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            <p className="flex items-center gap-1.5 font-medium">
                                <AlertTriangle className="h-4 w-4" /> Cancelling does not touch payments.
                            </p>
                            <p className="mt-1">
                                These stay at Reconciliation Pending: Revert them to Approved or put them on a new cheque by hand.
                            </p>
                            <p className="mt-1 font-mono text-xs">{pending.join(", ")}</p>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Close
                    </Button>
                    <Button onClick={submit} disabled={saving || previewing || !preview || movable === 0 || !!problem}>
                        {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                        {target === CHEQUE_STATUS.CANCELLED ? "Cancel cheque" : `Mark ${target}`}
                        {!single && movable > 0 && ` (${movable})`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
