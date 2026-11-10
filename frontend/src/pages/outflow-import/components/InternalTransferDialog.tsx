// src/pages/outflow-import/components/InternalTransferDialog.tsx

import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { describeFrappeError, isCreditRow } from "../outflowTableModel";

/** Which hand action the dialog takes: `mark` an open line as an Internal Transfer, or `sendBack` an Internal
 * Transfer line to Mismatched. */
export type InternalTransferAction = "mark" | "sendBack";

const ENDPOINT = "nirmaan_stack.api.outflow_import.internal_transfer_actions";

interface InternalTransferDialogProps {
    row: OutflowImportRow;
    action: InternalTransferAction;
    onClose: () => void;
    onDone: () => void;
}

/**
 * Mark as Internal Transfer, and Send back to Mismatched (#1626, spec #1619). Admin and Accountant Lead only: the
 * page mounts it only when the user may (`canUndoOutflow`), and the server checks again.
 *
 * Marking fills the line's own side from the server's offer (`row.hand_mark`); the person chooses only the other end,
 * and the Detail starts as the offer's (a Cashbook line's wallet holder, owner decision 8a). Both need a typed
 * reason. A refusal shows the server's sentence and changes nothing.
 *
 * ⚠️ ITS FORM STARTS FRESH EACH TIME IT OPENS because the page mounts it per open, keyed by row and action
 * (frontend § React effects rule 4): no effect copies props into state.
 */
export const InternalTransferDialog = ({ row, action, onClose, onDone }: InternalTransferDialogProps) => {
    const offer = row.hand_mark;
    const [otherEnd, setOtherEnd] = useState("");
    const [detail, setDetail] = useState(offer?.detail ?? "");
    const [reason, setReason] = useState("");
    const [error, setError] = useState<string | null>(null);
    const { call, loading } = useFrappePostCall(
        `${ENDPOINT}.${action === "mark" ? "mark_internal_transfer" : "send_back_to_mismatched"}`
    );

    const own = offer?.own_place ?? "";
    const choices = offer?.other_ends ?? [];
    const incoming = isCreditRow(row);
    const marking = action === "mark";
    const ready = reason.trim() !== "" && (!marking || otherEnd !== "");

    const submit = async () => {
        setError(null);
        try {
            await call(
                marking
                    ? { row: row.name, other_end: otherEnd, reason: reason.trim(), detail: detail.trim() }
                    : { row: row.name, reason: reason.trim() }
            );
            onDone();
        } catch (caught) {
            setError(describeFrappeError(caught, "It could not be saved. Nothing was changed."));
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{marking ? "Mark as Internal Transfer" : "Send back to Mismatched"}</DialogTitle>
                    <DialogDescription>
                        {formatToRoundedIndianRupee(row.amount)} {incoming ? "in" : "out"} on {row.source} ·{" "}
                        {row.remarks || row.beneficiary_name || row.name}
                    </DialogDescription>
                </DialogHeader>

                {marking ? (
                    <div className="space-y-3 text-sm">
                        <p className="text-muted-foreground">
                            Our own money moving between our own accounts. The line's own side is{" "}
                            <strong className="text-foreground">{own}</strong>; choose where the money{" "}
                            {incoming ? "came from" : "went to"}.
                        </p>
                        <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                            <Label htmlFor="it-from">From</Label>
                            {incoming ? (
                                <PlaceSelect id="it-from" value={otherEnd} onChange={setOtherEnd} choices={choices} />
                            ) : (
                                <span id="it-from">{own}</span>
                            )}
                            <Label htmlFor="it-to">To</Label>
                            {incoming ? (
                                <span id="it-to">{own}</span>
                            ) : (
                                <PlaceSelect id="it-to" value={otherEnd} onChange={setOtherEnd} choices={choices} />
                            )}
                            <Label htmlFor="it-detail">Detail</Label>
                            <Input
                                id="it-detail"
                                value={detail}
                                placeholder="Optional: the employee, the card's last four"
                                onChange={(event) => setDetail(event.target.value)}
                            />
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        Deletes this line's Internal Transfer record ({row.transfer_from ?? "—"} to{" "}
                        {row.transfer_to ?? "—"}) and reopens the line as Mismatched, to be worked like any other.
                    </p>
                )}

                <div className="space-y-1">
                    <Label htmlFor="it-reason">Reason</Label>
                    <Textarea
                        id="it-reason"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder={marking ? "Why this is our own money moving" : "Why this is not an Internal Transfer"}
                    />
                </div>

                {error && (
                    <p role="alert" className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-sm text-red-800">
                        {error}
                    </p>
                )}

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="button" disabled={!ready || loading} onClick={() => void submit()}>
                        {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                        {marking ? "Mark as Internal Transfer" : "Send back to Mismatched"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

interface PlaceSelectProps {
    id: string;
    value: string;
    onChange: (value: string) => void;
    /** The places the server offers as the other end, in its order. */
    choices: readonly string[];
}

/** A plain select over the places other than the line's own. Its placeholder stays selectable (the owner-locked rule). */
const PlaceSelect = ({ id, value, onChange, choices }: PlaceSelectProps) => (
    <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
    >
        <option value="">Choose a place</option>
        {choices.map((place) => (
            <option key={place} value={place}>
                {place}
            </option>
        ))}
    </select>
);
