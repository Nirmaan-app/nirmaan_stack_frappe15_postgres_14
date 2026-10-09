import React, { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** The fields of a ticked row the dialog lists. */
export interface ClientRejectRow {
    name: string;
    tds_request_id?: string;
    tds_item_name?: string;
    tds_make?: string;
}

interface TdsClientRejectDialogProps {
    /** The ticked rows; the dialog is open while this is non-empty. */
    rows: ClientRejectRow[];
    isSubmitting: boolean;
    onCancel: () => void;
    /** Called with the client's reason, trimmed; blank when none was typed. */
    onConfirm: (reason: string) => void;
}

/**
 * Confirms marking ticked rows *Rejected by Client*: lists them, takes an optional client's reason,
 * and warns that a row with a Client Status can't be deleted.
 */
export const TdsClientRejectDialog: React.FC<TdsClientRejectDialogProps> = ({
    rows,
    isSubmitting,
    onCancel,
    onConfirm,
}) => {
    const [reason, setReason] = useState("");
    const isOpen = rows.length > 0;

    const handleOpenChange = (open: boolean) => {
        if (open || isSubmitting) return;
        setReason("");
        onCancel();
    };

    const handleConfirm = () => {
        onConfirm(reason.trim());
        setReason("");
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Mark {rows.length} {rows.length === 1 ? "row" : "rows"} Rejected by Client</DialogTitle>
                    <DialogDescription>
                        Rows with a Client Status can't be deleted afterwards. Only an Admin can clear it.
                    </DialogDescription>
                </DialogHeader>

                <ul className="max-h-48 overflow-y-auto divide-y rounded-md border text-sm" data-testid="client-reject-rows">
                    {rows.map(row => (
                        <li key={row.name} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span className="font-medium text-gray-900">{row.tds_item_name}</span>
                            <span className="text-xs text-gray-500 whitespace-nowrap">
                                {row.tds_make} · {row.tds_request_id}
                            </span>
                        </li>
                    ))}
                </ul>

                <div className="space-y-1.5">
                    <Label htmlFor="client-reject-reason">Client's reason (optional)</Label>
                    <Textarea
                        id="client-reject-reason"
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder="Why did the client reject these datasheets?"
                        rows={3}
                    />
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={isSubmitting}
                        className="bg-orange-600 hover:bg-orange-700 text-white"
                    >
                        {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Mark Rejected by Client
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
