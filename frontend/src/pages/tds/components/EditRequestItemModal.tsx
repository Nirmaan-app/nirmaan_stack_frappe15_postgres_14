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
import { cn } from "@/lib/utils";

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
interface GroupOption {
    label: string;
    value: string;
    workPackage: string;
    member: string;
}

interface EditRequestItemModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: TDSItem | null;
    onSave: (itemName: string, updates: any, itemsToDelete?: string[]) => void;
    loading?: boolean;
}

type GroupMode = "existing" | "new";

/**
 * Phase 2 (ADR-0003 P2-3) edit modal for "New" REQUEST rows (tds_status === "New").
 *
 * A request proposes a (group, make, datasheet). The group is EITHER an existing
 * TDS Item (chosen via the api/tds/picker fuzzy search) OR a brand-new group
 * (free-text label + Work Package). The make is the FULL Makelist (no "+ Others" /
 * custom-make creation — promotion is Admin-only and curated). Datasheet is required.
 *
 * Keeps "New" status semantics: this edits the proposal; approval (backend) does the
 * promotion. CUS-/category-string logic is gone — tds_category is preserved as the
 * frozen snapshot only.
 *
 * Frozen onto the row:
 *   - existing group → tds_item_id = group id, tds_item_name = group name, WP = group WP
 *   - new group      → tds_item_id = "" (backend mints a member-less group on approval),
 *                      tds_item_name = typed label, WP = selected WP
 */
export const EditRequestItemModal: React.FC<EditRequestItemModalProps> = ({
    open,
    onOpenChange,
    item,
    onSave,
    loading = false,
}) => {
    const [groupMode, setGroupMode] = useState<GroupMode>("existing");

    // Existing-group selection (via picker)
    const [selectedGroupId, setSelectedGroupId] = useState("");
    const [selectedGroupName, setSelectedGroupName] = useState("");
    const [selectedGroupWP, setSelectedGroupWP] = useState("");

    // New-group proposal
    const [newGroupLabel, setNewGroupLabel] = useState("");
    const [newGroupWP, setNewGroupWP] = useState("");

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
    const { data: wpList } = useFrappeGetDocList("Work Packages", {
        fields: ["name", "work_package_name"],
        limit: 0,
    }, open ? undefined : null);
    // Full Makelist — no "+ Others" / custom-make creation in Phase 2.
    const { data: makeList } = useFrappeGetDocList("Makelist", {
        fields: ["name", "make_name"],
        limit: 0,
    }, open ? undefined : null);

    const wpOptions = useMemo(
        () => (wpList || []).map((d: any) => ({ label: d.work_package_name, value: d.name })),
        [wpList]
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

    // Siblings in the same project, for duplicate check
    const { data: existingProjectItems } = useFrappeGetDocList("Project TDS Item List", {
        fields: ["name", "tds_item_id", "tds_item_name", "tds_make", "tds_status", "tdsi_project_id"],
        filters: (item && open)
            ? [["tdsi_project_id", "=", item.tdsi_project_id || ""], ["name", "!=", item.name], ["docstatus", "!=", 2]]
            : [["name", "=", "NOT_FOUND"]],
        limit: 0,
    }, (item && open) ? undefined : null);

    // Hydrate from the row on open. A row with a group id → existing mode; a row
    // with only a name → new-group mode.
    useEffect(() => {
        if (item && open) {
            const hasGroupId = !!item.tds_item_id && !item.tds_item_id.startsWith("CUS-") && !item.tds_item_id.startsWith("PCUS-");
            setGroupMode(hasGroupId ? "existing" : "new");

            setSelectedGroupId(hasGroupId ? (item.tds_item_id || "") : "");
            setSelectedGroupName(hasGroupId ? (item.tds_item_name || "") : "");
            setSelectedGroupWP(hasGroupId ? (item.tds_work_package || "") : "");

            setNewGroupLabel(hasGroupId ? "" : (item.tds_item_name || ""));
            setNewGroupWP(hasGroupId ? "" : (item.tds_work_package || ""));

            setSelectedMake(item.tds_make || "");
            setDescription(item.tds_description || "");
            setBoqRef(item.tds_boq_line_item || "");
            setAttachmentFile(null);
            setFileError(null);

            runSearch(""); // seed group dropdown
        }
    }, [item, open, runSearch]);

    const currentGroupValue = useMemo<GroupOption | null>(() => {
        if (groupMode !== "existing" || !selectedGroupId) return null;
        const fromOptions = groupOptions.find(o => o.value === selectedGroupId);
        if (fromOptions) return fromOptions;
        return { label: selectedGroupName || selectedGroupId, value: selectedGroupId, workPackage: selectedGroupWP, member: "" };
    }, [groupMode, selectedGroupId, selectedGroupName, selectedGroupWP, groupOptions]);

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

    const handleModeChange = (mode: GroupMode) => {
        setGroupMode(mode);
        // Reset the OTHER side so we don't carry stale group identity.
        if (mode === "existing") {
            setNewGroupLabel("");
            setNewGroupWP("");
        } else {
            setSelectedGroupId("");
            setSelectedGroupName("");
            setSelectedGroupWP("");
        }
    };

    // Derived: the proposed group identity for both validation and the payload.
    const proposed = useMemo(() => {
        if (groupMode === "existing") {
            return {
                tds_item_id: selectedGroupId,
                tds_item_name: selectedGroupName,
                tds_work_package: selectedGroupWP,
            };
        }
        return {
            tds_item_id: "", // new group — backend mints a member-less TDS Item on approval
            tds_item_name: newGroupLabel.trim(),
            tds_work_package: newGroupWP,
        };
    }, [groupMode, selectedGroupId, selectedGroupName, selectedGroupWP, newGroupLabel, newGroupWP]);

    const buildUpdates = () => ({
        tds_item_id: proposed.tds_item_id,
        tds_item_name: proposed.tds_item_name,
        tds_work_package: proposed.tds_work_package,
        // tds_category is no longer chosen at request time (the group model derives
        // categories from members). Preserve the row's frozen snapshot.
        tds_category: item?.tds_category ?? "",
        tds_make: selectedMake,
        tds_description: description,
        tds_boq_line_item: boqRef,
        attachmentFile,
    });

    const handleSaveAttempt = () => {
        if (!item) return;

        if (groupMode === "existing" && !proposed.tds_item_id) {
            toast({ title: "Validation Error", description: "Please select an existing TDS Item.", variant: "destructive" });
            return;
        }
        if (groupMode === "new" && (!proposed.tds_item_name || !proposed.tds_work_package)) {
            toast({ title: "Validation Error", description: "Enter a new TDS Item name and Work Package.", variant: "destructive" });
            return;
        }
        if (!selectedMake) {
            toast({ title: "Validation Error", description: "Please select a Make.", variant: "destructive" });
            return;
        }
        if (!attachmentFile && !item.tds_attachment) {
            setFileError("Attachment is required");
            return;
        }

        // Dedup on (group identity, make). For an existing group, key on the group
        // id; for a new group, key on the proposed name (no id yet).
        const matchesGroup = (sib: any) =>
            groupMode === "existing"
                ? sib.tds_item_id === proposed.tds_item_id
                : (!sib.tds_item_id || sib.tds_item_id.startsWith("CUS-") || sib.tds_item_id.startsWith("PCUS-"))
                    && sib.tds_item_name === proposed.tds_item_name;

        const dupRejected = existingProjectItems?.find((i: any) =>
            matchesGroup(i) && i.tds_make === selectedMake && i.tds_status === "Rejected"
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

    const menuPortalTarget = typeof document !== "undefined" ? document.body : undefined;
    const menuPortalStyle = (base: any) => ({ ...base, zIndex: 9999, pointerEvents: "auto" as const });

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[480px] p-0 rounded-xl border-none max-h-[90vh] flex flex-col overflow-hidden shadow-2xl bg-white">
                    <DialogHeader className="p-6 pb-2 border-b border-gray-50">
                        <DialogTitle className="text-xl font-bold tracking-tight">Edit Request Item</DialogTitle>
                        <DialogDescription className="text-sm text-gray-500 mt-1">
                            Update this new TDS Item request (group + make + datasheet).
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-6 py-4 overflow-y-auto flex-1 custom-scrollbar">
                        <div className="space-y-4">
                            {/* Group mode toggle */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">TDS Item</Label>
                                <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                                    <button
                                        type="button"
                                        onClick={() => handleModeChange("existing")}
                                        className={cn(
                                            "px-3 py-1.5 text-xs font-bold rounded-md transition-colors",
                                            groupMode === "existing" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                                        )}
                                    >
                                        Existing Item
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleModeChange("new")}
                                        className={cn(
                                            "px-3 py-1.5 text-xs font-bold rounded-md transition-colors",
                                            groupMode === "new" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                                        )}
                                    >
                                        New Item
                                    </button>
                                </div>
                            </div>

                            {groupMode === "existing" ? (
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
                                    {/* New group label */}
                                    <div className="space-y-1">
                                        <Label className="text-sm font-bold text-gray-700">
                                            New TDS Item Name<span className="text-red-500 ml-0.5">*</span>
                                        </Label>
                                        <Input
                                            value={newGroupLabel}
                                            onChange={(e) => setNewGroupLabel(e.target.value)}
                                            placeholder="e.g. Modular Switch Plate"
                                            className="h-11 border-gray-200 rounded-lg bg-gray-50/30 focus:bg-white transition-all font-medium"
                                        />
                                    </div>
                                    {/* New group WP */}
                                    <div className="space-y-1">
                                        <Label className="text-sm font-bold text-gray-700">
                                            Work Package<span className="text-red-500 ml-0.5">*</span>
                                        </Label>
                                        <ReactSelect
                                            options={wpOptions}
                                            value={wpOptions.find(o => o.value === newGroupWP) || (newGroupWP ? { label: newGroupWP, value: newGroupWP } : null)}
                                            onChange={(opt) => setNewGroupWP(opt?.value || "")}
                                            placeholder="Select Work Package"
                                            classNamePrefix="react-select"
                                            menuPortalTarget={menuPortalTarget}
                                            styles={{
                                                control: (base) => ({ ...base, minHeight: "44px", borderRadius: "8px", borderColor: "#e5e7eb" }),
                                                menuPortal: menuPortalStyle,
                                            }}
                                        />
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

export default EditRequestItemModal;
