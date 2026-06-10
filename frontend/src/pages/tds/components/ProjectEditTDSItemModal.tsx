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
import { FileText } from "lucide-react";

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

// Shape returned by nirmaan_stack.api.tds.picker.search_tds_items
interface PickerMake {
    make: string;
    entry: string;
    tds_attachment?: string;
    status?: string;
}
interface PickerGroup {
    tds_item: string;          // TDS Item (group) id — frozen onto the row as tds_item_id
    tds_item_name: string;     // group name
    work_package: string;
    matched_member: { item: string; item_name: string } | null;
    makes: PickerMake[];       // makes-with-datasheet for this group
}

// react-select option for the group fuzzy picker
interface GroupOption {
    label: string;             // group name
    value: string;             // tds_item id
    workPackage: string;
    member: string;            // matched member hint ("contains …") for the subtitle
    makes: PickerMake[];
}

interface ProjectEditTDSItemModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: TDSItem | null;
    onSave: (itemName: string, updates: any, itemsToDelete?: string[]) => void;
    loading?: boolean;
}

/**
 * Phase 2 (ADR-0003) edit modal for PICKED rows (tds_status !== "New").
 *
 * Re-runs the group + make picker: fuzzy-search a TDS Item (group) over its name
 * AND member item codes/names (server-side via api/tds/picker.search_tds_items),
 * then pick a Make from the makes-with-datasheet for that group. The chosen make's
 * Repository Entry datasheet (tds_attachment) is carried onto the row unless the
 * user uploads a replacement. Work Package is derived from the group (read-only).
 *
 * The frozen snapshot written back: tds_item_id (= TDS Item group id), tds_item_name
 * (group name), tds_make, tds_attachment, tds_work_package. Dedup key against sibling
 * project rows = (tds_item_id, tds_make). No CUS-/category-string logic.
 */
export const ProjectEditTDSItemModal: React.FC<ProjectEditTDSItemModalProps> = ({
    open,
    onOpenChange,
    item,
    onSave,
    loading = false,
}) => {
    // Selected group (TDS Item) — id + the makes-with-datasheet we resolved for it.
    const [selectedGroupId, setSelectedGroupId] = useState("");
    const [selectedGroupName, setSelectedGroupName] = useState("");
    const [selectedGroupWP, setSelectedGroupWP] = useState("");
    const [selectedGroupMakes, setSelectedGroupMakes] = useState<PickerMake[]>([]);
    const [selectedMake, setSelectedMake] = useState("");
    const [description, setDescription] = useState("");
    const [boqRef, setBoqRef] = useState("");
    const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);

    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [confirmInput, setConfirmInput] = useState("");
    const [duplicateDocName, setDuplicateDocName] = useState<string | null>(null);

    // ── Server-side group search (debounced) ──────────────────────────────────
    const { call: searchTdsItems } = useFrappePostCall(
        "nirmaan_stack.api.tds.picker.search_tds_items"
    );
    const { call: getTdsItemMakes } = useFrappePostCall(
        "nirmaan_stack.api.tds.picker.get_tds_item_makes"
    );
    const [groupOptions, setGroupOptions] = useState<GroupOption[]>([]);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const toGroupOption = (g: PickerGroup): GroupOption => ({
        label: g.tds_item_name,
        value: g.tds_item,
        workPackage: g.work_package,
        member: g.matched_member?.item_name || g.matched_member?.item || "",
        makes: g.makes || [],
    });

    const runSearch = useCallback(async (query: string) => {
        try {
            const resp = await searchTdsItems({ query, limit: 50 });
            const rows: PickerGroup[] = resp?.message || [];
            setGroupOptions(rows.map(toGroupOption));
        } catch (e) {
            console.error("TDS picker search failed", e);
            setGroupOptions([]);
        }
    }, [searchTdsItems]);

    const handleGroupSearchInput = useCallback((input: string) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(input), 300);
    }, [runSearch]);

    // Sibling project rows — for (tds_item_id, tds_make) dedup.
    const { data: existingProjectItems } = useFrappeGetDocList("Project TDS Item List", {
        fields: ["name", "tds_item_id", "tds_item_name", "tds_make", "tds_status", "tdsi_project_id"],
        filters: (item && open)
            ? [["tdsi_project_id", "=", item.tdsi_project_id || ""], ["name", "!=", item.name], ["docstatus", "!=", 2]]
            : [["name", "=", "NOT_FOUND"]],
        limit: 0,
    }, (item && open) ? undefined : null);

    // Hydrate from the row on open, and seed the group dropdown with the row's
    // current group + an initial unfiltered search so the picker isn't empty.
    useEffect(() => {
        if (item && open) {
            setSelectedGroupId(item.tds_item_id || "");
            setSelectedGroupName(item.tds_item_name || "");
            setSelectedGroupWP(item.tds_work_package || "");
            setSelectedMake(item.tds_make || "");
            setDescription(item.tds_description || "");
            setBoqRef(item.tds_boq_line_item || "");
            setAttachmentFile(null);
            setFileError(null);
            setSelectedGroupMakes([]);

            // Seed the dropdown with an initial slice and resolve the current
            // group's makes so the Make dropdown + datasheet are populated.
            runSearch("");
            if (item.tds_item_id) {
                getTdsItemMakes({ tds_item: item.tds_item_id })
                    .then(resp => setSelectedGroupMakes(resp?.message || []))
                    .catch(() => setSelectedGroupMakes([]));
            }
        }
    }, [item, open, runSearch, getTdsItemMakes]);

    // Build the current group option (so the FuzzySearchSelect can show a value
    // even when the row's group isn't in the latest search slice).
    const currentGroupValue = useMemo<GroupOption | null>(() => {
        if (!selectedGroupId) return null;
        const fromOptions = groupOptions.find(o => o.value === selectedGroupId);
        if (fromOptions) return fromOptions;
        return {
            label: selectedGroupName || selectedGroupId,
            value: selectedGroupId,
            workPackage: selectedGroupWP,
            member: "",
            makes: selectedGroupMakes,
        };
    }, [selectedGroupId, selectedGroupName, selectedGroupWP, selectedGroupMakes, groupOptions]);

    // Ensure the current group is selectable in the option list.
    const groupOptionsWithCurrent = useMemo<GroupOption[]>(() => {
        if (!currentGroupValue) return groupOptions;
        if (groupOptions.some(o => o.value === currentGroupValue.value)) return groupOptions;
        return [currentGroupValue, ...groupOptions];
    }, [groupOptions, currentGroupValue]);

    const makeOptions = useMemo(
        () => selectedGroupMakes
            .map(m => ({ label: m.make, value: m.make }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        [selectedGroupMakes]
    );

    // The Repository Entry datasheet for the picked (group, make).
    const selectedEntry = useMemo(
        () => selectedGroupMakes.find(m => m.make === selectedMake) || null,
        [selectedGroupMakes, selectedMake]
    );

    const handleGroupChange = (opt: GroupOption | null) => {
        setSelectedGroupId(opt?.value || "");
        setSelectedGroupName(opt?.label || "");
        setSelectedGroupWP(opt?.workPackage || "");
        setSelectedGroupMakes(opt?.makes || []);
        setSelectedMake(""); // clear downstream make
    };

    const buildUpdates = () => {
        const updates: any = {
            tds_item_id: selectedGroupId,
            tds_item_name: selectedGroupName,
            tds_work_package: selectedGroupWP,
            // tds_category is a frozen snapshot from the original row; the group
            // model derives categories live (joined member categories) and no
            // longer stores a single category. Preserve the row's existing value.
            tds_category: item?.tds_category ?? "",
            tds_make: selectedMake,
            tds_description: description,
            tds_boq_line_item: boqRef,
            attachmentFile,
        };
        // Carry the entry datasheet forward when the user didn't upload a new file.
        if (!attachmentFile && selectedEntry?.tds_attachment) {
            updates.tds_attachment = selectedEntry.tds_attachment;
        }
        return updates;
    };

    const handleSaveAttempt = () => {
        if (!item) return;
        if (!selectedGroupId || !selectedMake) {
            toast({ title: "Validation Error", description: "Please select a TDS Item and make.", variant: "destructive" });
            return;
        }

        // Datasheet must exist: either an existing row attachment, a fresh upload,
        // or the selected entry's datasheet.
        if (!attachmentFile && !item.tds_attachment && !selectedEntry?.tds_attachment) {
            setFileError("Attachment is required");
            return;
        }

        // Dedup on (tds_item_id, tds_make). A Rejected duplicate can be replaced
        // after confirmation; an active (Pending/Approved) duplicate is blocked.
        const dupActive = existingProjectItems?.find((i: any) =>
            i.tds_item_id === selectedGroupId &&
            i.tds_make === selectedMake &&
            (i.tds_status === "Approved" || i.tds_status === "Pending" || !i.tds_status)
        );
        if (dupActive) {
            toast({
                title: "Duplicate",
                description: "This TDS Item + Make is already selected in this project.",
                variant: "destructive",
            });
            return;
        }

        const dupRejected = existingProjectItems?.find((i: any) =>
            i.tds_item_id === selectedGroupId &&
            i.tds_make === selectedMake &&
            i.tds_status === "Rejected"
        );
        if (dupRejected) {
            setDuplicateDocName(dupRejected.name);
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

    // react-select inside a Radix dialog: the dialog sets body { pointer-events: none },
    // so a portaled menu needs pointer-events restored to be clickable.
    const menuPortalTarget = typeof document !== "undefined" ? document.body : undefined;
    const menuPortalStyle = (base: any) => ({ ...base, zIndex: 9999, pointerEvents: "auto" as const });

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[480px] p-0 rounded-xl border-none max-h-[90vh] flex flex-col overflow-hidden shadow-2xl bg-white">
                    <DialogHeader className="p-6 pb-2 border-b border-gray-50">
                        <DialogTitle className="text-xl font-bold tracking-tight">Edit TDS Item</DialogTitle>
                        <DialogDescription className="text-sm text-gray-500 mt-1">
                            Select a TDS Item and make from the repository.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-6 py-4 overflow-y-auto flex-1 custom-scrollbar">
                        <div className="space-y-4">
                            {/* TDS Item (group) — fuzzy search over name + member items */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">
                                    TDS Item<span className="text-red-500 ml-0.5">*</span>
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
                                    formatOptionLabel={(option: any) => (
                                        <div className="flex flex-col">
                                            <span>{option.label}</span>
                                            {option.member && (
                                                <span className="text-[11px] text-slate-500">
                                                    contains {option.member}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    menuPortalTarget={menuPortalTarget}
                                    styles={{
                                        control: (base: any) => ({ ...base, minHeight: "44px", borderRadius: "8px", borderColor: "#e5e7eb" }),
                                        menuPortal: menuPortalStyle,
                                    }}
                                />
                            </div>

                            {/* Work Package (derived from group, read-only) */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">Work Package (Auto-fill)</Label>
                                <ReactSelect
                                    options={selectedGroupWP ? [{ label: selectedGroupWP, value: selectedGroupWP }] : []}
                                    value={selectedGroupWP ? { label: selectedGroupWP, value: selectedGroupWP } : null}
                                    isDisabled
                                    placeholder="Auto-filled from TDS Item"
                                    classNamePrefix="react-select"
                                    styles={readOnlyStyles}
                                />
                            </div>

                            {/* Make — only makes-with-datasheet for the chosen group */}
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
                                    placeholder={
                                        !selectedGroupId
                                            ? "Pick a TDS Item first"
                                            : makeOptions.length === 0
                                                ? "No datasheets available for this item"
                                                : "Select Make"
                                    }
                                    isDisabled={!selectedGroupId || makeOptions.length === 0}
                                    menuPortalTarget={menuPortalTarget}
                                    classNamePrefix="react-select"
                                    styles={{
                                        control: (base) => ({
                                            ...base,
                                            minHeight: "44px",
                                            borderRadius: "8px",
                                            borderColor: "#e5e7eb",
                                            backgroundColor: !selectedGroupId ? "#f9fafb" : "white",
                                        }),
                                        menuPortal: menuPortalStyle,
                                    }}
                                />
                                {selectedEntry?.status && (
                                    <p className="text-[10px] text-slate-500 px-1">
                                        Master status:{" "}
                                        <span className={selectedEntry.status === "Verified" ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>
                                            {selectedEntry.status}
                                        </span>
                                    </p>
                                )}
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
                            {(() => {
                                const existingDocUrl = item?.tds_attachment || selectedEntry?.tds_attachment || "";
                                const hasExistingDoc = !!existingDocUrl;
                                const attachmentLabel = hasExistingDoc ? "Replace Document" : "Upload PDF Document";
                                return (
                                    <div className="space-y-1.5 mt-2">
                                        <Label className="text-sm font-bold text-gray-700">
                                            Attach Document<span className="text-red-500 ml-0.5">*</span>
                                        </Label>
                                        <CustomAttachment
                                            selectedFile={attachmentFile}
                                            onFileSelect={(file) => {
                                                setAttachmentFile(file);
                                                if (file) setFileError(null);
                                            }}
                                            acceptedTypes="application/pdf"
                                            label={attachmentLabel}
                                            maxFileSize={50 * 1024 * 1024}
                                            className="w-full"
                                        />
                                        {hasExistingDoc && !attachmentFile && (
                                            <p className="text-[10px] text-gray-500 flex items-center gap-1 px-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                Current file:{" "}
                                                <a href={existingDocUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">
                                                    <FileText className="h-3 w-3" /> View Document
                                                </a>
                                            </p>
                                        )}
                                        {fileError && (
                                            <p className="text-xs font-medium text-red-500">{fileError}</p>
                                        )}
                                    </div>
                                );
                            })()}
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
                            This TDS Item + Make combination already exists as a <strong>Rejected</strong> entry in the project.
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
