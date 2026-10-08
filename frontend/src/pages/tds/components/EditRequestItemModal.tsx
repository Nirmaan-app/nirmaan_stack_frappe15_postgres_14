import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
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
import { FuzzySearchSelect } from "@/components/ui/fuzzy-search-select";
import { TdsRequestTypeRadio, type TdsRequestMode } from "@/components/common/TdsRequestTypeRadio";
import { useTdsProjectCustomOptions } from "@/hooks/useTdsProjectCustomOptions";
import { getSelectStyles, mergeSelectStyles } from "@/config/selectTheme";
import { foldItemName, isProjectCustomId } from "@/utils/tdsRequestRules";

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

// search_tds_items result shape (group picker)
interface PickerGroup {
    tds_item: string;
    tds_item_name: string;
    work_package: string;
    matched_member: { item: string; item_name: string } | null;
    makes: { make: string; entry: string; tds_attachment?: string; status?: string }[];
}
// A row on the same project, read for the rejected-duplicate check.
interface SiblingRow {
    name: string;
    tds_item_id?: string;
    tds_item_name?: string;
    tds_make?: string;
    tds_status?: string;
    tdsi_project_id?: string;
}

interface GroupOption {
    label: string;
    value: string;
    workPackage: string;
    member: string;
}

/** An Admin's edit of a request row, as `edit_tds_request` reads it (`api/tds/edit_request.py`). */
export interface RequestItemEdit {
    is_project_custom: boolean;
    tds_item_id: string;      // New Make only
    tds_item_name: string;    // Project Custom only (the server reads a New Make's from its TDS Item)
    work_package: string;     // Project Custom only
    category: string;         // Project Custom only: under `work_package`
    make: string;
    tds_boq_line_item: string;
    description: string;
    previous_doc_name?: string; // a Rejected row this one replaces
}

interface EditRequestItemModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: TDSItem | null;
    /** `attachmentFile`: a new datasheet to upload; null keeps the row's current one. */
    onSave: (itemName: string, edit: RequestItemEdit, attachmentFile: File | null) => void;
    loading?: boolean;
}

// The shared dialog select theme, at the 44px height of this dialog's other fields.
const DIALOG_SELECT_STYLES = mergeSelectStyles<{ label: string; value: string }>(getSelectStyles(), {
    control: (base) => ({ ...base, minHeight: "44px" }),
});

// What switching the Type means for this row, shown only when the choice differs from the row's.
const SWITCH_NOTES: Record<TdsRequestMode, string> = {
    new_make: "This row becomes a New Make. Approving it adds the datasheet to the TDS Repository, under the TDS Item you pick.",
    project_custom: "This row becomes a Project Custom item for this project only. It never goes into the TDS Repository, even when approved.",
};

/**
 * Admin edit of a waiting request row (`isEditableRequest`): a New Make or a Project Custom Item
 * (ADR-0025 Amendment A, #1379). The Type choice is the Request New dialog's, and switching it
 * switches the row:
 *   - New Make: pick an existing TDS Item (the api/tds/picker search). Approval adds a Repository Entry.
 *   - Project Custom: a name, a Work Package (Procurement Packages) and a Category under it. The
 *     server gives the row its project-only `PCUS-` id.
 * Both: a make from the full Makelist, a required datasheet, optional BOQ line and description.
 *
 * The save goes to the Admin-only `edit_tds_request`, which re-runs the send's checks.
 * From Repository rows use `ProjectEditTDSItemModal` instead.
 */
export const EditRequestItemModal: React.FC<EditRequestItemModalProps> = ({
    open,
    onOpenChange,
    item,
    onSave,
    loading = false,
}) => {
    const [mode, setMode] = useState<TdsRequestMode>("new_make");
    const originalMode: TdsRequestMode = isProjectCustomId(item?.tds_item_id) ? "project_custom" : "new_make";

    // New Make: the picked TDS Item
    const [selectedGroupId, setSelectedGroupId] = useState("");
    const [selectedGroupName, setSelectedGroupName] = useState("");
    const [selectedGroupWP, setSelectedGroupWP] = useState("");

    // Project Custom
    const [customName, setCustomName] = useState("");
    const [customWP, setCustomWP] = useState("");
    const [category, setCategory] = useState("");

    const [selectedMake, setSelectedMake] = useState("");
    const [description, setDescription] = useState("");
    const [boqRef, setBoqRef] = useState("");
    const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);

    // Rejected-duplicate confirm dialog
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [confirmInput, setConfirmInput] = useState("");
    const [duplicateDocName, setDuplicateDocName] = useState<string | null>(null);

    // ── Reference data ─────────────────────────────────────────────────────────
    // Full Makelist — no "+ Others" / custom-make creation.
    const { data: makeList } = useFrappeGetDocList("Makelist", {
        fields: ["name", "make_name"],
        limit: 0,
    }, open ? undefined : null);
    const { packageOptions, categoryOptions, isLoadingCategories } = useTdsProjectCustomOptions(
        open && mode === "project_custom",
        customWP
    );

    const makeOptions = useMemo(
        () => (makeList || []).map((d: any) => ({ label: d.make_name, value: d.name })),
        [makeList]
    );

    // ── Group picker (server-side, debounced) ───────────────────────────────────
    const { call: searchTdsItems } = useFrappePostCall(
        "nirmaan_stack.api.tds.picker.search_tds_items"
    );
    const [groupOptions, setGroupOptions] = useState<GroupOption[]>([]);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const runSearch = useCallback(async (query: string) => {
        try {
            const resp = await searchTdsItems({ query, limit: 50 });
            const rows: PickerGroup[] = resp?.message || [];
            setGroupOptions(rows.map(g => ({
                label: g.tds_item_name,
                value: g.tds_item,
                workPackage: g.work_package,
                member: g.matched_member?.item_name || g.matched_member?.item || "",
            })));
        } catch (e) {
            console.error("TDS picker search failed", e);
            setGroupOptions([]);
        }
    }, [searchTdsItems]);

    const handleGroupSearchInput = useCallback((input: string) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(input), 300);
    }, [runSearch]);

    // Siblings in the same project, for the rejected-duplicate check
    const { data: existingProjectItems } = useFrappeGetDocList<SiblingRow>("Project TDS Item List", {
        fields: ["name", "tds_item_id", "tds_item_name", "tds_make", "tds_status", "tdsi_project_id"],
        filters: (item && open)
            ? [["tdsi_project_id", "=", item.tdsi_project_id || ""], ["name", "!=", item.name], ["docstatus", "!=", 2]]
            : [["name", "=", "NOT_FOUND"]],
        limit: 0,
    }, (item && open) ? undefined : null);

    // Hydrate from the row on open. Each side starts from the row, so a switch to Project Custom
    // keeps the name and package and asks only for a Category, and a switch to New Make asks for
    // a TDS Item.
    useEffect(() => {
        if (item && open) {
            const custom = isProjectCustomId(item.tds_item_id);
            setMode(custom ? "project_custom" : "new_make");

            // A legacy `CUS-` id is no TDS Item: the Admin picks one.
            const hasGroupId = !custom && !!item.tds_item_id && !item.tds_item_id.startsWith("CUS-");
            setSelectedGroupId(hasGroupId ? (item.tds_item_id || "") : "");
            setSelectedGroupName(hasGroupId ? (item.tds_item_name || "") : "");
            setSelectedGroupWP(hasGroupId ? (item.tds_work_package || "") : "");

            setCustomName(item.tds_item_name || "");
            setCustomWP(item.tds_work_package || "");
            setCategory(custom ? (item.tds_category || "") : "");

            setSelectedMake(item.tds_make || "");
            setDescription(item.tds_description || "");
            setBoqRef(item.tds_boq_line_item || "");
            setAttachmentFile(null);
            setFileError(null);

            runSearch(""); // seed group dropdown
        }
    }, [item, open, runSearch]);

    const currentGroupValue = useMemo<GroupOption | null>(() => {
        if (!selectedGroupId) return null;
        const fromOptions = groupOptions.find(o => o.value === selectedGroupId);
        if (fromOptions) return fromOptions;
        return { label: selectedGroupName || selectedGroupId, value: selectedGroupId, workPackage: selectedGroupWP, member: "" };
    }, [selectedGroupId, selectedGroupName, selectedGroupWP, groupOptions]);

    const groupOptionsWithCurrent = useMemo<GroupOption[]>(() => {
        if (!currentGroupValue) return groupOptions;
        if (groupOptions.some(o => o.value === currentGroupValue.value)) return groupOptions;
        return [currentGroupValue, ...groupOptions];
    }, [groupOptions, currentGroupValue]);

    const handleGroupChange = (opt: GroupOption | null) => {
        setSelectedGroupId(opt?.value || "");
        setSelectedGroupName(opt?.label || "");
        setSelectedGroupWP(opt?.workPackage || "");
    };

    // A HANDLER, not an effect: a Category belongs to one package, so any package change strands it.
    const handleCustomWPChange = (opt: { value: string } | null) => {
        const next = opt?.value || "";
        if (next === customWP) return;
        setCustomWP(next);
        setCategory("");
    };

    // Just switch — keep each side's state, so a round trip loses nothing. `buildEdit` reads
    // only the active side.
    const handleModeChange = (next: TdsRequestMode) => setMode(next);

    const buildEdit = (previousDocName?: string): RequestItemEdit => ({
        is_project_custom: mode === "project_custom",
        tds_item_id: mode === "new_make" ? selectedGroupId : "",
        tds_item_name: mode === "project_custom" ? customName.trim() : "",
        work_package: mode === "project_custom" ? customWP : "",
        category: mode === "project_custom" ? category : "",
        make: selectedMake,
        tds_boq_line_item: boqRef,
        description,
        previous_doc_name: previousDocName,
    });

    const handleSaveAttempt = () => {
        if (!item) return;

        const invalid = (message: string) =>
            toast({ title: "Validation Error", description: message, variant: "destructive" });
        if (mode === "new_make" && !selectedGroupId) return invalid("Please select an existing TDS Item.");
        if (mode === "project_custom" && !(customName.trim() && customWP && category)) {
            return invalid("Enter the item name, Work Package and Category.");
        }
        if (!selectedMake) return invalid("Please select a Make.");
        if (!attachmentFile && !item.tds_attachment) {
            setFileError("Attachment is required");
            return;
        }

        // A Rejected sibling with the same item + make is replaced, after a confirm. The item is
        // the TDS Item id, or for Project Custom the name (trimmed, ignoring case), as the server keys it.
        const matchesItem = (sib: SiblingRow) =>
            mode === "new_make"
                ? sib.tds_item_id === selectedGroupId
                : isProjectCustomId(sib.tds_item_id) && foldItemName(sib.tds_item_name) === foldItemName(customName);

        const dupRejected = existingProjectItems?.find((i) =>
            matchesItem(i) && i.tds_make === selectedMake && i.tds_status === "Rejected"
        );
        if (dupRejected) {
            setDuplicateDocName(dupRejected.name);
            setConfirmInput("");
            setShowConfirmDialog(true);
            return;
        }

        onSave(item.name, buildEdit(), attachmentFile);
    };

    const confirmResubmission = () => {
        if (confirmInput !== "1") {
            toast({ title: "Invalid Input", description: "Please enter '1' to continue.", variant: "destructive" });
            return;
        }
        if (!item || !duplicateDocName) return;
        onSave(item.name, buildEdit(duplicateDocName), attachmentFile);
        setShowConfirmDialog(false);
        setDuplicateDocName(null);
    };

    const menuPortalTarget = typeof document !== "undefined" ? document.body : undefined;
    const menuPortalStyle = (base: any) => ({ ...base, zIndex: 9999, pointerEvents: "auto" as const });

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[480px] p-0 rounded-xl border-none max-h-[90vh] flex flex-col overflow-hidden shadow-2xl bg-white">
                    <DialogHeader className="p-6 pb-2 border-b border-gray-50">
                        <DialogTitle className="text-xl font-bold tracking-tight">Edit Request Item</DialogTitle>
                        <DialogDescription className="text-sm text-gray-500 mt-1">
                            Update this request, or switch it between New Make and Project Custom.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-6 py-4 overflow-y-auto flex-1 custom-scrollbar">
                        <div className="space-y-4">
                            <TdsRequestTypeRadio value={mode} onChange={handleModeChange} />
                            {mode !== originalMode && (
                                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                    {SWITCH_NOTES[mode]}
                                </p>
                            )}

                            {mode === "new_make" ? (
                                <div className="space-y-1">
                                    <Label className="text-sm font-bold text-gray-700">
                                        Select TDS Item<span className="text-red-500 ml-0.5">*</span>
                                    </Label>
                                    <FuzzySearchSelect
                                        allOptions={groupOptionsWithCurrent}
                                        tokenSearchConfig={{
                                            searchFields: ['label', 'member'],
                                            minSearchLength: 1,
                                            partialMatch: true,
                                            minTokenLength: 1,
                                            fieldWeights: { label: 2.0, member: 1.0 },
                                            minTokenMatches: 1,
                                        }}
                                        value={currentGroupValue}
                                        onChange={handleGroupChange as any}
                                        onSearchInputChange={handleGroupSearchInput}
                                        placeholder="Search TDS Item or member item..."
                                        classNamePrefix="react-select"
                                        isClearable
                                        menuPortalTarget={menuPortalTarget}
                                        formatOptionLabel={(option: any) => (
                                            <div className="flex flex-col">
                                                <span>{option.label}</span>
                                                {option.member && (
                                                    <span className="text-[11px] text-slate-500">contains {option.member}</span>
                                                )}
                                            </div>
                                        )}
                                        styles={{
                                            control: (base: any) => ({ ...base, minHeight: "44px", borderRadius: "8px", borderColor: "#e5e7eb" }),
                                            menuPortal: menuPortalStyle,
                                        }}
                                    />
                                    {selectedGroupWP && (
                                        <p className="text-[10px] text-slate-500 px-1">Work Package: <span className="font-medium">{selectedGroupWP}</span></p>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <div className="space-y-1">
                                        <Label className="text-sm font-bold text-gray-700">
                                            Item Name<span className="text-red-500 ml-0.5">*</span>
                                        </Label>
                                        <Input
                                            value={customName}
                                            onChange={(e) => setCustomName(e.target.value)}
                                            placeholder="e.g. Facade Linear Light 24W"
                                            className="h-11 border-gray-200 rounded-lg bg-gray-50/30 focus:bg-white transition-all font-medium"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="space-y-1 min-w-0">
                                            <Label className="text-sm font-bold text-gray-700">
                                                Work Package<span className="text-red-500 ml-0.5">*</span>
                                            </Label>
                                            <ReactSelect
                                                options={packageOptions}
                                                value={packageOptions.find(o => o.value === customWP) || (customWP ? { label: customWP, value: customWP } : null)}
                                                onChange={handleCustomWPChange}
                                                placeholder="Select Work Package"
                                                classNamePrefix="react-select"
                                                styles={DIALOG_SELECT_STYLES}
                                                menuPortalTarget={menuPortalTarget}
                                                menuPosition="fixed"
                                            />
                                        </div>
                                        <div className="space-y-1 min-w-0">
                                            <Label className="text-sm font-bold text-gray-700">
                                                Category<span className="text-red-500 ml-0.5">*</span>
                                            </Label>
                                            <ReactSelect
                                                options={categoryOptions}
                                                value={categoryOptions.find(o => o.value === category) || (category ? { label: category, value: category } : null)}
                                                onChange={(opt) => setCategory(opt?.value || "")}
                                                placeholder={customWP ? "Select Category" : "Pick a Work Package first"}
                                                isDisabled={!customWP}
                                                isLoading={isLoadingCategories}
                                                noOptionsMessage={() => "No categories under this package"}
                                                classNamePrefix="react-select"
                                                styles={DIALOG_SELECT_STYLES}
                                                menuPortalTarget={menuPortalTarget}
                                                menuPosition="fixed"
                                            />
                                            <p className="text-[11px] text-gray-500">Categories under the chosen package.</p>
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* Make — full Makelist (no "+ Others") */}
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
                                    placeholder="Select Make"
                                    classNamePrefix="react-select"
                                    menuPortalTarget={menuPortalTarget}
                                    styles={{
                                        control: (base) => ({ ...base, minHeight: "44px", borderRadius: "8px", borderColor: "#e5e7eb" }),
                                        menuPortal: menuPortalStyle,
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
                                    Attach Datasheet<span className="text-red-500 ml-0.5">*</span>
                                </Label>
                                <CustomAttachment
                                    selectedFile={attachmentFile}
                                    onFileSelect={(file) => {
                                        setAttachmentFile(file);
                                        if (file) setFileError(null);
                                    }}
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
                                {fileError && (
                                    <p className="text-xs font-medium text-red-500">{fileError}</p>
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
                            This item + make combination already exists as a <strong>Rejected</strong> entry in the project.
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

export default EditRequestItemModal;
