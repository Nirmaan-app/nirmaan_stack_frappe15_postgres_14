// src/pages/tds/components/EditTDSEntryDialog.tsx
//
// Shared, reusable edit dialog for a single TDS Repository entry. Edits
// make / status / description / tds_attachment of an EXISTING entry. The
// tds_item link is fixed (this dialog only edits entries already belonging to
// a TDS Item) and work_package is fetched server-side from the linked
// tds_item, so neither is edited here.
//
// Extracted/generalized from the inline EditEntryDialog formerly living in
// TDSItemDetail.tsx so the master page, detail page, and peek dialogs share
// one implementation. Design source of truth:
//   nirmaan_stack/.claude/context/domain/tds/phase-1-plan.md

import React, { useMemo, useState } from "react";
import { useFrappeGetDocList, useFrappeUpdateDoc, useFrappeFileUpload } from "frappe-react-sdk";
import { FileText } from "lucide-react";
import RSelect from "react-select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { TDS_STATUS_OPTIONS } from "./types";
import { TDSRepository } from "@/types/NirmaanStack/TDSRepository";

export interface EditTDSEntryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    entry: TDSRepository | null;
    /** Makes already taken by OTHER entries of this TDS Item (excluding `entry`). */
    takenMakes: Set<string>;
    onSaved: () => void;
}

export const EditTDSEntryDialog: React.FC<EditTDSEntryDialogProps> = ({
    open,
    onOpenChange,
    entry,
    takenMakes,
    onSaved,
}) => {
    const { updateDoc, loading: updating } = useFrappeUpdateDoc();
    const { upload: uploadFile, loading: uploading } = useFrappeFileUpload();

    const [make, setMake] = useState("");
    const [status, setStatus] = useState<(typeof TDS_STATUS_OPTIONS)[number]>("Not Verified");
    const [description, setDescription] = useState("");
    const [newFile, setNewFile] = useState<File | null>(null);

    const { data: makeList } = useFrappeGetDocList("Makelist", {
        fields: ["name", "make_name"],
        limit: 0,
    });

    // Reset local state whenever the dialog opens for a (possibly new) entry.
    React.useEffect(() => {
        if (open && entry) {
            setMake(entry.make || "");
            setStatus((entry.status as any) || "Not Verified");
            setDescription(entry.description || "");
            setNewFile(null);
        }
    }, [open, entry]);

    // Make options: full Makelist minus makes taken by other entries of this
    // TDS Item, but always keep the current entry's own make selectable.
    const makeOptions = useMemo(
        () =>
            (makeList || [])
                .filter((m: any) => !takenMakes.has(m.name) || m.name === entry?.make)
                .map((m: any) => ({ label: m.make_name, value: m.name })),
        [makeList, takenMakes, entry]
    );

    const handleSave = async () => {
        if (!entry) return;
        if (!make) {
            toast({ title: "Make is required", variant: "destructive" });
            return;
        }
        try {
            await updateDoc("TDS Repository", entry.name, {
                make,
                status,
                description: description || "",
            });

            if (newFile) {
                const uploadResp = await uploadFile(newFile, {
                    doctype: "TDS Repository",
                    docname: entry.name,
                    fieldname: "tds_attachment",
                    isPrivate: true,
                });
                const responseData = uploadResp as any;
                const fileUrl = responseData?.message?.file_url || responseData?.file_url;
                if (fileUrl) {
                    await updateDoc("TDS Repository", entry.name, {
                        tds_attachment: fileUrl,
                    });
                }
            }

            toast({ title: "Success", description: "Entry updated successfully", variant: "success" });
            onSaved();
            onOpenChange(false);
        } catch (e: any) {
            console.error("Error updating TDS entry:", e);
            toast({
                title: "Error",
                description: e?.message || "Failed to update entry",
                variant: "destructive",
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle className="text-lg font-bold">Edit Repository Entry</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Make */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-semibold flex items-center">
                            Make<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <RSelect
                            options={makeOptions}
                            value={makeOptions.find((o) => o.value === make) || null}
                            onChange={(opt) => setMake((opt as any)?.value || "")}
                            placeholder="Select Make"
                            className="react-select-container"
                            classNamePrefix="react-select"
                            isClearable
                        />
                    </div>

                    {/* Status */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-semibold flex items-center">
                            Status<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <RSelect
                            options={TDS_STATUS_OPTIONS.map((s) => ({ label: s, value: s }))}
                            value={status ? { label: status, value: status } : null}
                            onChange={(opt) => setStatus(((opt as any)?.value || "Not Verified") as any)}
                            placeholder="Select Status"
                            className="react-select-container"
                            classNamePrefix="react-select"
                        />
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

                    {/* Attachment */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-semibold">
                            Datasheet (PDF)
                            <span className="text-gray-400 font-normal ml-1">— replace to update</span>
                        </label>
                        {entry?.tds_attachment && !newFile && (
                            <a
                                href={entry.tds_attachment}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                            >
                                <FileText className="h-4 w-4" /> View current datasheet
                            </a>
                        )}
                        <CustomAttachment
                            maxFileSize={50 * 1024 * 1024}
                            selectedFile={newFile}
                            onFileSelect={setNewFile}
                            acceptedTypes="application/pdf"
                            label="Upload new PDF (optional)"
                            className="w-full"
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
                        disabled={updating || uploading}
                        className="bg-[#dc2626] hover:bg-[#b91c1c] text-white"
                    >
                        {updating || uploading ? "Saving..." : "Save"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default EditTDSEntryDialog;
