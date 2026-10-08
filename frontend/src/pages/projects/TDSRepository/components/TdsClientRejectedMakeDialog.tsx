import React from "react";
import { format } from "date-fns";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

/** The fields of the *Rejected by Client* row the dialog explains. */
export interface ClientRejectedMakeRow {
    name: string;
    tds_item_name?: string | null;
    tds_make?: string | null;
    tds_request_id?: string | null;
    client_status_by?: string | null;
    client_status_on?: string | null;
    client_rejection_reason?: string | null;
}

interface TdsClientRejectedMakeDialogProps {
    /** The row whose item + make was picked again; the dialog is open while this is set. */
    row: ClientRejectedMakeRow | null;
    /** The full name of the user who marked the row, if known. */
    markedByName?: string;
    /** Closes the dialog; the user picks another make. */
    onPickAnother: () => void;
    /** Closes the form and opens TDS History's Rejected by Client tab. */
    onOpenRejectedTab: () => void;
}

/**
 * Explains why a make can't be picked: the client rejected that item + make on this project. Names
 * the row, its request, who marked it and when, and the client's reason, and offers the two ways out.
 */
export const TdsClientRejectedMakeDialog: React.FC<TdsClientRejectedMakeDialogProps> = ({
    row,
    markedByName,
    onPickAnother,
    onOpenRejectedTab,
}) => (
    <Dialog open={!!row} onOpenChange={open => !open && onPickAnother()}>
        <DialogContent className="sm:max-w-lg" data-testid="tds-client-rejected-make-dialog">
            <DialogHeader className="flex-row items-start gap-3 space-y-0 text-left">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700">
                    <XCircle className="h-5 w-5" />
                </span>
                <div className="space-y-1.5">
                    <DialogTitle>The client rejected {row?.tds_make} for this item</DialogTitle>
                    <DialogDescription>
                        {row?.tds_item_name} ({row?.tds_make}) is already on this project in{" "}
                        {row?.tds_request_id || "—"}, so it can't be added again.
                    </DialogDescription>
                </div>
            </DialogHeader>

            <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-md border bg-gray-50 px-3.5 py-3 text-sm">
                <dt className="text-gray-500">Marked by</dt>
                <dd className="font-medium">{markedByName || row?.client_status_by || "—"}</dd>
                <dt className="text-gray-500">Marked on</dt>
                <dd className="font-medium">
                    {row?.client_status_on ? format(new Date(row.client_status_on), "dd-MMM-yyyy HH:mm") : "—"}
                </dd>
                <dt className="text-gray-500">Client's reason</dt>
                <dd data-testid="tds-client-rejected-reason">{row?.client_rejection_reason || "No reason given"}</dd>
            </dl>

            <div className="space-y-1.5 text-sm">
                <p className="font-semibold">What you can do</p>
                <p className="text-gray-700">
                    Pick a different make for this item. Or, if the client changed their mind about {row?.tds_make},
                    switch that row to Approved by Client in the Rejected by Client tab.
                </p>
            </div>

            <DialogFooter>
                <Button variant="outline" onClick={onPickAnother}>
                    Pick another make
                </Button>
                <Button onClick={onOpenRejectedTab} className="bg-red-600 hover:bg-red-700 text-white">
                    Open Rejected by Client tab
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
);
