import React, { useState, useEffect, useMemo } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ReactSelect from "react-select";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { toast } from "@/components/ui/use-toast";
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
import { CustomAttachment } from "@/components/helpers/CustomAttachment";

interface TDSItem {
    name: string;
    tds_request_id: string;
    tdsi_project_id?: string;
    tdsi_project_name: string;
    tds_work_package: string;
    tds_category: string;
    tds_item_name: string;
    tds_description: string;
    tds_make: string;
    tds_attachment?: string;
    tds_status: string;
    tds_item_id?: string;
    tds_boq_line_item?: string;
}

interface TDSRepositoryDoc {
    name: string;
    tds_item_id: string;
    tds_item_name: string;
    make: string;
    work_package: string;
    category: string;
    description: string;
    tds_attachment?: string;
}

interface ProjectEditTDSItemModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: TDSItem | null;
    onSave: (itemName: string, updates: any, itemsToDelete?: string[]) => void;
    loading?: boolean;
}

/**
 * Edit modal for repository-linked TDS items (items whose tds_status !== "New").
 * Work Package + Category are derived from the chosen repo entry and stay read-only.
 * The editable part is: Item Name → Make → BOQ Ref, Description, Attachment.
 *
 * For the "New" item request flow (free-form WP/Category/Item/Make), use
 * EditRequestItemModal instead.
 */
export const ProjectEditTDSItemModal: React.FC<ProjectEditTDSItemModalProps> = ({
    open,
    onOpenChange,
    item,
    onSave,
    loading = false,
}) => {
    // Stores tds_item_id (unique per repo item). Two repo items may share a name across
    // different categories — keying selection by id avoids mixing their makes.
    const [selectedItemId, setSelectedItemId] = useState("");
    const [selectedMake, setSelectedMake] = useState("");
    const [description, setDescription] = useState("");
    const [boqRef, setBoqRef] = useState("");
    const [attachmentFile, setAttachmentFile] = useState<File | null>(null);

    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [confirmInput, setConfirmInput] = useState("");
    const [duplicateDocName, setDuplicateDocName] = useState<string | null>(null);

    // Master repository entries — source of truth for WP/Category/Item/Make
    const { data: repoItems } = useFrappeGetDocList<TDSRepositoryDoc>("TDS Repository", {
        fields: ["name", "tds_item_id", "tds_item_name", "make", "description", "work_package", "category", "tds_attachment"],
        limit: 0,
    }, open ? undefined : null);

    // Sibling project items — for avoiding duplicate (item+make) combinations
    const { data: existingProjectItems } = useFrappeGetDocList("Project TDS Item List", {
        fields: ["name", "tds_item_id", "tds_item_name", "tds_make", "tds_status", "tdsi_project_id"],
        filters: (item && open)
            ? [["tdsi_project_id", "=", item.tdsi_project_id || ""], ["name", "!=", item.name], ["docstatus", "!=", 2]]
            : [["name", "=", "NOT_FOUND"]],
        limit: 0,
    });

    useEffect(() => {
        if (item && open) {
            setSelectedItemId(item.tds_item_id || "");
            setSelectedMake(item.tds_make || "");
            setDescription(item.tds_description || "");
            setBoqRef(item.tds_boq_line_item || "");
            setAttachmentFile(null);
        }
    }, [item, open]);

    // Remove repo entries already used by other pending/approved items in this project
    const availableRepoItems = useMemo(() => {
        if (!repoItems || !existingProjectItems) return repoItems || [];
        const occupiedIds = new Set(
            existingProjectItems
                .filter((i: any) => i.tds_status === "Approved" || i.tds_status === "Pending" || !i.tds_status)
                .map((i: any) => `${i.tds_item_id}-${i.tds_make}`)
        );
        return repoItems.filter(repoItem => {
            const id = `${repoItem.tds_item_id}-${repoItem.make}`;
            return !occupiedIds.has(id);
        });
    }, [repoItems, existingProjectItems]);

    const itemNameOptions = useMemo(() => {
        // Group by tds_item_id — one option per unique item (multiple makes are collapsed).
        const uniqueById = new Map<string, { tds_item_id: string; tds_item_name: string; category?: string }>();
        availableRepoItems.forEach(i => {
            if (i.tds_item_id && !uniqueById.has(i.tds_item_id)) {
                uniqueById.set(i.tds_item_id, {
                    tds_item_id: i.tds_item_id,
                    tds_item_name: i.tds_item_name,
                    category: i.category,
                });
            }
        });
        // Count name collisions so we can show category in blue only when needed.
        const nameCounts = new Map<string, number>();
        uniqueById.forEach(e => {
            nameCounts.set(e.tds_item_name, (nameCounts.get(e.tds_item_name) || 0) + 1);
        });
        return Array.from(uniqueById.values())
            .map(e => ({
                label: e.tds_item_name,
                value: e.tds_item_id,
                category: (nameCounts.get(e.tds_item_name) || 0) > 1 ? (e.category || '') : '',
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [availableRepoItems]);

    const makeOptions = useMemo(() => {
        if (!selectedItemId) return [];
        return availableRepoItems
            .filter(i => i.tds_item_id === selectedItemId)
            .map(i => ({ label: i.make, value: i.make }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [availableRepoItems, selectedItemId]);

    const selectedRepoEntry = useMemo(() => {
        if (!selectedItemId || !selectedMake) return null;
        return availableRepoItems.find(i =>
            i.tds_item_id === selectedItemId && i.make === selectedMake
        ) || null;
    }, [availableRepoItems, selectedItemId, selectedMake]);

    // Displayed WP/Category: prefer the repo entry matching current selection,
    // fall back to the item's stored values so the fields aren't empty mid-edit
    const displayedWP = selectedRepoEntry?.work_package || item?.tds_work_package || "";
    const displayedCategory = selectedRepoEntry?.category || item?.tds_category || "";

    const handleItemNameChange = (opt: any) => {
        setSelectedItemId(opt?.value || "");
        setSelectedMake(""); // clear downstream
    };

    const buildUpdates = () => {
        const updates: any = {
            tds_work_package: selectedRepoEntry?.work_package ?? item?.tds_work_package ?? "",
            tds_category: selectedRepoEntry?.category ?? item?.tds_category ?? "",
            tds_item_name: selectedRepoEntry?.tds_item_name ?? item?.tds_item_name ?? "",
            tds_item_id: selectedRepoEntry?.tds_item_id ?? item?.tds_item_id ?? "",
            tds_make: selectedMake,
            tds_description: description,
            tds_boq_line_item: boqRef,
            attachmentFile,
        };
        // Carry forward the repo attachment only when the user didn't upload a new file
        if (!attachmentFile && selectedRepoEntry?.tds_attachment) {
            updates.tds_attachment = selectedRepoEntry.tds_attachment;
        }
        return updates;
    };

    const handleSaveAttempt = () => {
        if (!item) return;
        if (!selectedItemId || !selectedMake) {
            toast({ title: "Validation Error", description: "Please select an item and make.", variant: "destructive" });
            return;
        }

        const duplicate = existingProjectItems?.find(i =>
            i.tds_item_id === selectedRepoEntry?.tds_item_id &&
            i.tds_make === selectedMake &&
            i.tds_status === "Rejected"
        );

        if (duplicate) {
            setDuplicateDocName(duplicate.name);
            setConfirmInput("");
            setShowConfirmDialog(true);
            return;
        }

        onSave(item.name, buildUpdates());
    };

    const confirmResubmission = () => {
        if (confirmInput !== "1") {
            toast({ title: "Invalid Input", description: "Please enter '1' to continue.", variant: "destructive" });
            return;
        }
        if (!item || !duplicateDocName) return;

        onSave(item.name, buildUpdates(), [duplicateDocName]);
        setShowConfirmDialog(false);
        setDuplicateDocName(null);
    };

    const readOnlyStyles = {
        control: (base: any) => ({
            ...base,
            minHeight: "44px",
            borderRadius: "8px",
            borderColor: "#e5e7eb",
            backgroundColor: "#f9fafb",
        }),
    };

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[480px] p-0 rounded-xl border-none max-h-[90vh] flex flex-col overflow-hidden shadow-2xl bg-white">
                    <DialogHeader className="p-6 pb-2 border-b border-gray-50">
                        <DialogTitle className="text-xl font-bold tracking-tight">Edit TDS Item</DialogTitle>
                        <DialogDescription className="text-sm text-gray-500 mt-1">
                            Select an item and make from the repository.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-6 py-4 overflow-y-auto flex-1 custom-scrollbar">
                        <div className="space-y-4">
                            {/* Work Package (auto-fill, read-only) */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">Work Package (Auto-fill)</Label>
                                <ReactSelect
                                    options={displayedWP ? [{ label: displayedWP, value: displayedWP }] : []}
                                    value={displayedWP ? { label: displayedWP, value: displayedWP } : null}
                                    isDisabled
                                    placeholder="Auto-filled from item"
                                    classNamePrefix="react-select"
                                    styles={readOnlyStyles}
                                />
                            </div>

                            {/* Item Name */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">
                                    Item Name<span className="text-red-500 ml-0.5">*</span>
                                </Label>
                                <ReactSelect
                                    options={itemNameOptions}
                                    value={
                                        itemNameOptions.find(opt => opt.value === selectedItemId)
                                        || (selectedItemId && item ? { label: item.tds_item_name || "", value: selectedItemId, category: "" } : null)
                                    }
                                    onChange={handleItemNameChange}
                                    placeholder="Select Item"
                                    classNamePrefix="react-select"
                                    formatOptionLabel={(option: any) => (
                                        <span>
                                            {option.label}
                                            {option.category && (
                                                <span className="text-blue-600 ml-1">({option.category})</span>
                                            )}
                                        </span>
                                    )}
                                    styles={{
                                        control: (base) => ({ ...base, minHeight: "44px", borderRadius: "8px", borderColor: "#e5e7eb" }),
                                    }}
                                />
                            </div>

                            {/* Category (auto-fill, read-only) */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">Category (Auto-fill)</Label>
                                <ReactSelect
                                    options={displayedCategory ? [{ label: displayedCategory, value: displayedCategory }] : []}
                                    value={displayedCategory ? { label: displayedCategory, value: displayedCategory } : null}
                                    isDisabled
                                    placeholder="Auto-filled from item"
                                    classNamePrefix="react-select"
                                    styles={readOnlyStyles}
                                />
                            </div>

                            {/* Make */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">
                                    Make<span className="text-red-500 ml-0.5">*</span>
                                </Label>
                                <ReactSelect
                                    options={makeOptions}
                                    value={
                                        makeOptions.find(opt => opt.value === selectedMake)
                                        || (selectedMake ? { label: selectedMake, value: selectedMake } : null)
                                    }
                                    onChange={(opt) => setSelectedMake(opt?.value || "")}
                                    placeholder={selectedItemId ? "Select Make" : "Pick an Item first"}
                                    isDisabled={!selectedItemId}
                                    classNamePrefix="react-select"
                                    styles={{
                                        control: (base) => ({
                                            ...base,
                                            minHeight: "44px",
                                            borderRadius: "8px",
                                            borderColor: "#e5e7eb",
                                            backgroundColor: !selectedItemId ? "#f9fafb" : "white",
                                        }),
                                    }}
                                />
                            </div>

                            {/* BOQ Line Item */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">TDS BOQ Line Item</Label>
                                <Input
                                    value={boqRef}
                                    onChange={(e) => setBoqRef(e.target.value)}
                                    placeholder="Enter BOQ Line Item"
                                    className="h-11 border-gray-200 rounded-lg bg-gray-50/30 focus:bg-white transition-all font-medium"
                                />
                            </div>

                            {/* Description */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">
                                    Item Description <span className="text-gray-400 font-normal ml-0.5">(Optional)</span>
                                </Label>
                                <Textarea
                                    rows={3}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Type Description"
                                    className="border-gray-200 rounded-lg bg-gray-50/30 focus:bg-white transition-all resize-none custom-scrollbar"
                                />
                            </div>

                            {/* Attachment */}
                            <div className="space-y-1.5 mt-2">
                                <Label className="text-sm font-bold text-gray-700">
                                    Attach Document <span className="text-gray-400 font-normal ml-0.5">(Optional)</span>
                                </Label>
                                <CustomAttachment
                                    selectedFile={attachmentFile}
                                    onFileSelect={setAttachmentFile}
                                    acceptedTypes="application/pdf"
                                    label="Upload PDF Document"
                                    maxFileSize={50 * 1024 * 1024}
                                    className="w-full"
                                />
                                {item?.tds_attachment && !attachmentFile && (
                                    <p className="text-[10px] text-gray-500 flex items-center gap-1 px-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                        Current file: <a href={item.tds_attachment} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View Document</a>
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="bg-gray-50 p-4 px-6 border-t border-gray-100 gap-3 justify-end items-center">
                        <Button
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            disabled={loading}
                            className="text-gray-500 hover:text-gray-700 h-10 px-6 font-bold tracking-tight rounded-lg"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSaveAttempt}
                            disabled={loading}
                            className="bg-[#cc4444] hover:bg-red-700 text-white h-10 px-10 font-black tracking-tight rounded-lg shadow-lg shadow-red-100 transform transition-transform active:scale-95"
                        >
                            {loading ? "Saving..." : "Save Changes"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
                <AlertDialogContent className="rounded-xl border-none shadow-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Resubmit Rejected Item?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This item-make combination already exists as a <strong>Rejected</strong> entry in the project.
                            To replace it and continue, please enter <strong>"1"</strong> below.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-2">
                        <Input
                            value={confirmInput}
                            onChange={(e) => setConfirmInput(e.target.value)}
                            placeholder="Enter 1 to confirm"
                            className="text-center text-lg font-bold h-12 border-gray-200 rounded-lg focus:ring-red-100"
                            autoFocus
                        />
                    </div>
                    <AlertDialogFooter className="pt-2">
                        <AlertDialogCancel onClick={() => setShowConfirmDialog(false)} className="rounded-lg">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                confirmResubmission();
                            }}
                            className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-8 font-bold shadow-lg shadow-red-100"
                            disabled={confirmInput !== "1"}
                        >
                            Confirm
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default ProjectEditTDSItemModal;
