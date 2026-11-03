import React, { useMemo, useState } from "react";
import ReactSelect from "react-select";
import { useFrappeGetDocList } from "frappe-react-sdk";
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { getSelectStyles } from "@/config/selectTheme";
import { getFrappeError } from "@/utils/frappeErrors";
import { isProjectCustomId, resolveMakeChoices, type ResolveBlock } from "@/utils/tdsRequestRules";
import { useTdsExistingProjectItems } from "../../data/tds/useTdsQueries";
import { useDeleteTdsItem, useResolveRejectedTds } from "../../data/tds/useTdsMutations";

/** The fields of the Rejected row the dialog resolves. */
export interface ResolveRow {
    name: string;
    tds_request_id?: string | null;
    tds_item_id?: string | null;
    tds_item_name?: string | null;
    tds_make?: string | null;
    tds_status?: string | null;
    tds_rejection_reason?: string | null;
}

interface TdsResolveDialogProps {
    projectId: string;
    /** The Rejected row; the dialog is open while this is set. */
    row: ResolveRow | null;
    onClose: () => void;
    /** After the row is resolved or deleted: the table refetches. */
    onChanged: () => void;
}

type MakeOption = { label: string; value: string };

const BLOCKED_NOTE: Record<ResolveBlock, (item: string) => string> = {
    notInRepository: item => `${item} isn't in the TDS Repository, so its make can't be changed here.`,
    noOtherMake: item => `${item} has no other make in the TDS Repository.`,
    allOnProject: () => "Every other make of this item is already on the project.",
};

/**
 * Resolves a Rejected row (GLOSSARY "Resolve"): shows why it was rejected, takes another Repository
 * make of its TDS Item, and sends it back for approval as Pending. A Rejected row is also deleted
 * from here, from the request card behind a confirm, instead of from the table.
 */
export const TdsResolveDialog: React.FC<TdsResolveDialogProps> = ({ projectId, row, onClose, onChanged }) => (
    <Dialog open={!!row} onOpenChange={open => !open && onClose()}>
        {/* Mounted per open, so its lists are fetched fresh and its picks start blank. */}
        {row && <ResolveDialogBody projectId={projectId} row={row} onClose={onClose} onChanged={onChanged} />}
    </Dialog>
);

const ResolveDialogBody: React.FC<TdsResolveDialogProps & { row: ResolveRow }> = ({
    projectId,
    row,
    onClose,
    onChanged,
}) => {
    const [make, setMake] = useState<MakeOption | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const { resolve, loading: isResolving } = useResolveRejectedTds();
    const { deleteDoc, loading: isDeleting } = useDeleteTdsItem();
    const isBusy = isResolving || isDeleting;

    const itemId = row.tds_item_id ?? "";
    const { data: entries, isLoading: entriesLoading } = useFrappeGetDocList<{ make: string }>(
        "TDS Repository",
        { fields: ["make"], filters: [["tds_item", "=", itemId]], limit: 0 },
        itemId && !isProjectCustomId(itemId) ? ["tds", "resolveMakes", itemId] : null
    );
    const { data: projectRows, isLoading: rowsLoading } = useTdsExistingProjectItems(projectId);
    const isLoading = entriesLoading || rowsLoading;

    const choices = useMemo(
        () => resolveMakeChoices(row, (entries ?? []).map(e => e.make), projectRows),
        [row, entries, projectRows]
    );
    const options = choices.makes.map(m => ({ label: m, value: m }));
    const itemName = row.tds_item_name || "This item";
    const rowLabel = `${row.tds_request_id || "—"} · ${itemName} (${row.tds_make || "—"})`;

    const finish = () => {
        onChanged();
        onClose();
    };

    const handleResolve = async () => {
        if (!make) return;
        try {
            await resolve(projectId, row.name, make.value);
            toast({
                title: "Sent for approval",
                description: `${itemName} now asks for ${make.value} and is Pending again.`,
                variant: "success",
            });
            finish();
        } catch (error) {
            toast({ title: "Not resolved", description: getFrappeError(error), variant: "destructive" });
        }
    };

    const handleDelete = async () => {
        try {
            await deleteDoc(row.name, projectId);
            toast({ title: "Deleted", description: `${rowLabel} removed from history.` });
            finish();
        } catch (error) {
            toast({ title: "Error", description: getFrappeError(error) || "Failed to delete item.", variant: "destructive" });
            setConfirmingDelete(false);
        }
    };

    return (
        <DialogContent className="sm:max-w-lg" data-testid="tds-resolve-dialog">
            <DialogHeader>
                <DialogTitle>Resolve rejected request</DialogTitle>
                <DialogDescription>
                    Pick another make for {itemName}. It goes back to the Admin for approval as Pending.
                </DialogDescription>
            </DialogHeader>

            <div className="flex items-start gap-3 rounded-md border bg-gray-50 px-3.5 py-3">
                <dl className="grid flex-1 grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                    <dt className="text-gray-500">Request</dt>
                    <dd className="font-medium">{row.tds_request_id || "—"}</dd>
                    <dt className="text-gray-500">Current make</dt>
                    <dd className="font-medium">{row.tds_make || "—"}</dd>
                    <dt className="text-gray-500">Rejected because</dt>
                    <dd data-testid="tds-resolve-reason">{row.tds_rejection_reason?.trim() || "No reason given"}</dd>
                </dl>
                <Button
                    aria-label="Delete request"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={isBusy}
                    className="shrink-0 border-red-300 text-red-600 hover:text-red-700 hover:bg-red-50"
                    data-testid="tds-resolve-delete"
                >
                    <Trash2 className="w-4 h-4 mr-1.5" />
                    Delete
                </Button>
            </div>

            {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading makes…
                </div>
            ) : choices.blocked ? (
                <p className="text-sm text-gray-700" data-testid="tds-resolve-blocked">
                    {BLOCKED_NOTE[choices.blocked](itemName)} You can delete this request instead.
                </p>
            ) : (
                <div className="space-y-1.5">
                    <Label htmlFor="tds-resolve-make">New make</Label>
                    <ReactSelect<MakeOption>
                        inputId="tds-resolve-make"
                        options={options}
                        value={make}
                        onChange={setMake}
                        placeholder="Select a make"
                        isDisabled={isBusy}
                        styles={getSelectStyles<MakeOption>()}
                        menuPortalTarget={document.body}
                        menuPosition="fixed"
                    />
                </div>
            )}

            <DialogFooter className="gap-2">
                <Button variant="outline" onClick={onClose} disabled={isBusy}>
                    Cancel
                </Button>
                <Button
                    onClick={handleResolve}
                    disabled={!make || isBusy}
                    className="bg-red-600 hover:bg-red-700 text-white"
                    data-testid="tds-resolve-save"
                >
                    {isResolving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Resolve
                </Button>
            </DialogFooter>

            {/* Over the Resolve dialog; a delete closes both, since the row is gone. */}
            <AlertDialog open={confirmingDelete} onOpenChange={open => !isDeleting && setConfirmingDelete(open)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this request?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {rowLabel} will be removed from TDS History. This can't be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <Button
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="bg-red-600 hover:bg-red-700 text-white"
                            data-testid="tds-resolve-delete-confirm"
                        >
                            {isDeleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Delete
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </DialogContent>
    );
};
