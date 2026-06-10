// src/pages/tds/components/EditTDSItemDialog.tsx
//
// Shared, reusable edit dialog for a single "TDS Items" grouping record. Edits
// the TDS Item's name / work_package / description. Used by BOTH the master
// "TDS Items" table AND the TDS Item detail page header so the work_package
// propagation logic below lives in exactly one place.
//
// IMPORTANT — Work Package propagation:
//   "TDS Repository".work_package is a DENORMALIZED `fetch_from: tds_item.work_package`
//   field. Changing the WP on the grouping doctype does NOT retroactively update
//   already-linked Repository entries (Frappe only re-fetches on save of each
//   linked doc). So when the WP changes here, we explicitly push the new WP onto
//   every linked "TDS Repository" entry (filter fieldname = `tds_item`).
//
//   Per the locked product decision, the Work Package is editable EVEN when the
//   TDS Item already has member items — hence the propagation.
//
// Design source of truth:
//   nirmaan_stack/.claude/context/domain/tds/phase-1-plan.md

import React, { useMemo, useState } from "react";
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import RSelect from "react-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";

export interface EditTDSItemDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tdsItem: {
        name: string;
        tds_item_name?: string;
        work_package?: string;
        description?: string;
    } | null;
    onSaved?: () => void;
}

// react-select needs these overrides to be clickable inside a Radix Dialog:
// Radix sets `pointer-events: none` on <body> while a dialog is open, which
// also disables the portalled menu. Portalling to body + restoring
// `pointerEvents: "auto"` on the portal fixes the otherwise-unclickable menu.
const rselectStyles = {
    menuPortal: (base: any) => ({ ...base, zIndex: 9999, pointerEvents: "auto" }),
    control: (base: any) => ({
        ...base,
        minHeight: "40px",
        borderRadius: "8px",
        borderColor: "#e5e7eb",
    }),
};

export const EditTDSItemDialog: React.FC<EditTDSItemDialogProps> = ({
    open,
    onOpenChange,
    tdsItem,
    onSaved,
}) => {
    const { updateDoc, loading: updating } = useFrappeUpdateDoc();

    const [tdsItemName, setTdsItemName] = useState("");
    const [workPackage, setWorkPackage] = useState("");
    const [description, setDescription] = useState("");

    // Work Package options.
    const { data: wpList } = useFrappeGetDocList("Work Packages", {
        fields: ["name", "work_package_name"],
        limit: 0,
    });

    const wpOptions = useMemo(
        () =>
            (wpList || []).map((w: any) => ({
                label: w.work_package_name,
                value: w.name,
            })),
        [wpList]
    );

    // Linked datasheet entries — needed both to propagate the WP change and to
    // render the "N linked entries" note. 3rd arg is the SWR key
    // (frappe-react-sdk gotcha): `undefined` = fetch, `null` = skip. Do NOT use
    // `{ enabled }` here.
    const { data: linkedEntries } = useFrappeGetDocList(
        "TDS Repository",
        {
            filters: [["tds_item", "=", tdsItem?.name ?? ""]],
            fields: ["name", "work_package"],
            limit: 0,
        },
        open && tdsItem?.name ? undefined : null
    );

    // Reset local form state from `tdsItem` whenever the dialog opens.
    React.useEffect(() => {
        if (open && tdsItem) {
            setTdsItemName(tdsItem.tds_item_name || "");
            setWorkPackage(tdsItem.work_package || "");
            setDescription(tdsItem.description || "");
        }
    }, [open, tdsItem]);

    const wpChanged = !!tdsItem && workPackage !== (tdsItem.work_package || "");
    const linkedCount = linkedEntries?.length ?? 0;

    const handleSave = async () => {
        if (!tdsItem) return;

        const trimmedName = tdsItemName.trim();
        if (!trimmedName) {
            toast({ title: "TDS Item Name is required", variant: "destructive" });
            return;
        }

        try {
            await updateDoc("TDS Items", tdsItem.name, {
                tds_item_name: trimmedName,
                work_package: workPackage,
                description: description || "",
            });

            // Propagate WP change to all linked datasheet entries — the
            // denormalized fetch_from field won't update on its own.
            if (wpChanged && linkedEntries && linkedEntries.length > 0) {
                for (const entry of linkedEntries) {
                    await updateDoc("TDS Repository", entry.name, {
                        work_package: workPackage,
                    });
                }
            }

            toast({
                title: "Success",
                description: "TDS Item updated",
                variant: "success",
            });
            onSaved?.();
            onOpenChange(false);
        } catch (e: any) {
            console.error("Error updating TDS Item:", e);
            toast({
                title: "Error",
                description: e?.message || "Failed to update TDS Item",
                variant: "destructive",
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle className="text-lg font-bold">Edit TDS Item</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* TDS Item Name */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-semibold flex items-center">
                            TDS Item Name<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <Input
                            value={tdsItemName}
                            onChange={(e) => setTdsItemName(e.target.value)}
                            placeholder="Type TDS Item Name"
                            className="bg-white border-gray-200"
                        />
                    </div>

                    {/* Work Package */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-semibold">Work Package</label>
                        <RSelect
                            options={wpOptions}
                            value={wpOptions.find((o) => o.value === workPackage) || null}
                            onChange={(opt) => setWorkPackage((opt as any)?.value || "")}
                            placeholder="Select Work Package"
                            className="react-select-container"
                            classNamePrefix="react-select"
                            isClearable
                            menuPortalTarget={document.body}
                            menuPosition="fixed"
                            styles={rselectStyles}
                        />
                        {wpChanged && linkedCount > 0 && (
                            <p className="text-xs text-amber-600">
                                Changing the Work Package will update {linkedCount} linked datasheet{" "}
                                {linkedCount === 1 ? "entry" : "entries"}.
                            </p>
                        )}
                    </div>

                    {/* Description */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-semibold">
                            Description <span className="text-gray-400 font-normal">(Optional)</span>
                        </label>
                        <Textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Type Description"
                            className="bg-white border-gray-200 min-h-[80px]"
                        />
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        className="bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSave}
                        disabled={updating}
                        className="bg-[#dc2626] hover:bg-[#b91c1c] text-white"
                    >
                        {updating ? "Saving..." : "Save"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default EditTDSItemDialog;
