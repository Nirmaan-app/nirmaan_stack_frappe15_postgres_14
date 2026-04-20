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
import { useTDSItemOptions } from "../hooks/useTDSItemOptions";
import { CustomItemDialog } from "./AddTDSItemDialog";

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

interface EditRequestItemModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: TDSItem | null;
    onSave: (itemName: string, updates: any, itemsToDelete?: string[]) => void;
    loading?: boolean;
}

export const EditRequestItemModal: React.FC<EditRequestItemModalProps> = ({
    open,
    onOpenChange,
    item,
    onSave,
    loading = false,
}) => {
    // Selection state
    const [selectedWP, setSelectedWP] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedItemId, setSelectedItemId] = useState("");
    const [selectedItemName, setSelectedItemName] = useState("");
    const [selectedMake, setSelectedMake] = useState("");
    const [description, setDescription] = useState("");
    const [boqRef, setBoqRef] = useState("");
    const [attachmentFile, setAttachmentFile] = useState<File | null>(null);

    // Custom Item state
    const [isCustomItem, setIsCustomItem] = useState(false);
    const [customItemName, setCustomItemName] = useState("");
    const [customItemDialogOpen, setCustomItemDialogOpen] = useState(false);

    // Custom Make state
    const [isCustomMake, setIsCustomMake] = useState(false);
    const [customMake, setCustomMake] = useState("");

    // Rejected-duplicate confirm dialog
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [confirmInput, setConfirmInput] = useState("");
    const [duplicateDocName, setDuplicateDocName] = useState<string | null>(null);

    const {
        wpOptions,
        catOptions,
        itemOptionsForWP,
        makeOptions,
        allCustomItems,
        getCategoryForItem,
        catList,
    } = useTDSItemOptions({
        selectedWP,
        selectedCategory,
        watchedTdsItemId: selectedItemId,
        currentItem: item ? {
            name: item.name,
            work_package: item.tds_work_package,
            category: item.tds_category,
            tds_item_name: item.tds_item_name,
            tds_item_id: item.tds_item_id,
            description: item.tds_description,
            make: item.tds_make,
            tds_attachment: item.tds_attachment || "",
            creation: "",
        } : null,
    });

    // Siblings in the same project, for duplicate check
    const { data: existingProjectItems } = useFrappeGetDocList("Project TDS Item List", {
        fields: ["name", "tds_item_id", "tds_item_name", "tds_make", "tds_status", "tdsi_project_id"],
        filters: (item && open)
            ? [["tdsi_project_id", "=", item.tdsi_project_id || ""], ["name", "!=", item.name], ["docstatus", "!=", 2]]
            : [["name", "=", "NOT_FOUND"]],
        limit: 0,
    });

    // Hydrate from item on open
    useEffect(() => {
        if (item && open) {
            setSelectedWP(item.tds_work_package || "");
            setSelectedCategory(item.tds_category || "");
            setSelectedItemId(item.tds_item_id || "");
            setSelectedItemName(item.tds_item_name || "");
            setSelectedMake(item.tds_make || "");
            setDescription(item.tds_description || "");
            setBoqRef(item.tds_boq_line_item || "");
            setAttachmentFile(null);

            const isCustom = item.tds_item_id?.startsWith("CUS-") || (!item.tds_item_id && !!item.tds_item_name);
            setIsCustomItem(!!isCustom);
            setCustomItemName(isCustom ? (item.tds_item_name || "") : "");

            setIsCustomMake(false);
            setCustomMake("");
        }
    }, [item, open]);

    // Cascading field handlers — each one resets everything downstream
    const handleWorkPackageChange = (opt: any) => {
        setSelectedWP(opt?.value || "");
        setSelectedCategory("");
        setSelectedItemId("");
        setSelectedItemName("");
        setIsCustomItem(false);
        setCustomItemName("");
        setSelectedMake("");
        setIsCustomMake(false);
        setCustomMake("");
    };

    const handleCategoryChange = (opt: any) => {
        setSelectedCategory(opt?.value || "");
        setSelectedItemId("");
        setSelectedItemName("");
        setIsCustomItem(false);
        setCustomItemName("");
        setSelectedMake("");
        setIsCustomMake(false);
        setCustomMake("");
    };

    const handleItemChange = (opt: any) => {
        const isCustom = !!opt?.value?.startsWith?.("CUS-");
        const pinned = opt?.value ? getCategoryForItem(opt.value) : null;
        // Item pins win — override WP/Category (option A, per user decision)
        if (pinned) {
            if (pinned.workPackage) setSelectedWP(pinned.workPackage);
            if (pinned.category) setSelectedCategory(pinned.category);
        }
        setSelectedItemId(opt?.value || "");
        setSelectedItemName(opt?.label || "");
        setIsCustomItem(isCustom);
        setCustomItemName(isCustom ? (opt?.label || "") : "");
        // Clear make (downstream)
        setSelectedMake("");
        setIsCustomMake(false);
        setCustomMake("");
    };

    const handleCustomItemSelect = (customItem: { id: string; name: string; category: string; workPackage: string; isNew: boolean }) => {
        setCustomItemDialogOpen(false);
        setIsCustomItem(true);
        setCustomItemName(customItem.name);
        setSelectedItemId(customItem.id || "");
        setSelectedItemName(customItem.name);
        if (customItem.workPackage) setSelectedWP(customItem.workPackage);
        if (customItem.category) setSelectedCategory(customItem.category);
        setSelectedMake("");
        setIsCustomMake(false);
        setCustomMake("");
    };

    const handleMakeChange = (opt: any) => {
        if (opt?.value === "__others__") {
            setIsCustomMake(true);
            setCustomMake("");
            setSelectedMake("");
        } else {
            setSelectedMake(opt?.value || "");
        }
    };

    const itemOptionsWithCustom = useMemo(() => {
        const nameCounts = new Map<string, number>();
        itemOptionsForWP.forEach(opt => {
            nameCounts.set(opt.label, (nameCounts.get(opt.label) || 0) + 1);
        });
        return itemOptionsForWP.map(opt => ({
            label: opt.label,
            value: opt.value,
            category: opt.category,
            categoryName: opt.categoryName,
            showCategory: (nameCounts.get(opt.label) || 0) > 1,
        }));
    }, [itemOptionsForWP]);

    const getItemDisplayValue = () => {
        if (isCustomItem && customItemName) {
            return { label: customItemName, value: selectedItemId || "__new_custom__" };
        }
        if (selectedItemId || selectedItemName) {
            return itemOptionsWithCustom.find(opt => opt.value === selectedItemId)
                || { label: selectedItemName, value: selectedItemId };
        }
        return null;
    };

    const buildUpdates = () => ({
        tds_work_package: selectedWP,
        tds_category: selectedCategory,
        tds_item_name: selectedItemName,
        tds_item_id: selectedItemId,
        tds_make: selectedMake,
        tds_description: description,
        tds_boq_line_item: boqRef,
        attachmentFile,
    });

    const handleSaveAttempt = () => {
        if (!item) return;

        if (!selectedWP || !selectedCategory || !selectedItemName || !selectedMake) {
            toast({ title: "Validation Error", description: "Please fill in all required fields.", variant: "destructive" });
            return;
        }

        // Rejected-duplicate: same item name + make combo already exists as Rejected in this project
        const duplicate = existingProjectItems?.find(i =>
            i.tds_item_name === selectedItemName &&
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

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[480px] p-0 rounded-xl border-none max-h-[90vh] flex flex-col overflow-hidden shadow-2xl bg-white">
                    <DialogHeader className="p-6 pb-2 border-b border-gray-50">
                        <DialogTitle className="text-xl font-bold tracking-tight">Edit Request Item</DialogTitle>
                        <DialogDescription className="text-sm text-gray-500 mt-1">
                            Update the details of this new item request.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-6 py-4 overflow-y-auto flex-1 custom-scrollbar">
                        <div className="space-y-4">
                            {/* Work Package */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">
                                    Work Package<span className="text-red-500 ml-0.5">*</span>
                                </Label>
                                <ReactSelect
                                    options={wpOptions}
                                    value={
                                        wpOptions.find(opt => opt.value === selectedWP)
                                        || (selectedWP ? { label: selectedWP, value: selectedWP } : null)
                                    }
                                    onChange={handleWorkPackageChange}
                                    placeholder="Select Work Package"
                                    classNamePrefix="react-select"
                                    styles={{
                                        control: (base) => ({ ...base, minHeight: "44px", borderRadius: "8px", borderColor: "#e5e7eb" }),
                                    }}
                                />
                            </div>

                            {/* Category */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">
                                    Category<span className="text-red-500 ml-0.5">*</span>
                                </Label>
                                <ReactSelect
                                    options={catOptions}
                                    value={
                                        catOptions.find(opt => opt.value === selectedCategory)
                                        || (selectedCategory ? { label: selectedCategory, value: selectedCategory } : null)
                                    }
                                    onChange={handleCategoryChange}
                                    placeholder={selectedWP ? "Select Category" : "Pick a Work Package first"}
                                    isDisabled={!selectedWP}
                                    classNamePrefix="react-select"
                                    styles={{
                                        control: (base) => ({
                                            ...base,
                                            minHeight: "44px",
                                            borderRadius: "8px",
                                            borderColor: "#e5e7eb",
                                            backgroundColor: !selectedWP ? "#f9fafb" : "white",
                                        }),
                                    }}
                                />
                            </div>

                            {/* Item Name */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">
                                    Item Name<span className="text-red-500 ml-0.5">*</span>
                                </Label>
                                {isCustomItem ? (
                                    <div className="flex items-center justify-between p-3 border rounded-lg bg-orange-50 border-orange-200 shadow-sm transition-all hover:shadow-md">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-semibold text-orange-900 leading-tight">{customItemName}</span>
                                            <span className="text-[10px] text-orange-600 font-black uppercase tracking-widest mt-0.5">Custom Item</span>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="text-orange-700 hover:text-orange-900 hover:bg-orange-100 h-8 px-3 text-xs font-bold"
                                            onClick={() => setCustomItemDialogOpen(true)}
                                        >
                                            Change
                                        </Button>
                                    </div>
                                ) : (
                                    <ReactSelect
                                        options={itemOptionsWithCustom}
                                        value={getItemDisplayValue()}
                                        onChange={handleItemChange}
                                        placeholder={selectedWP ? "Select Item" : "Pick a Work Package first"}
                                        isDisabled={!selectedWP}
                                        classNamePrefix="react-select"
                                        formatOptionLabel={(option: any) => (
                                            <span>
                                                {option.label}
                                                {option.showCategory && option.categoryName && (
                                                    <span className="text-blue-600 ml-1">({option.categoryName})</span>
                                                )}
                                            </span>
                                        )}
                                        styles={{
                                            control: (base) => ({
                                                ...base,
                                                minHeight: "44px",
                                                borderRadius: "8px",
                                                borderColor: "#e5e7eb",
                                                backgroundColor: !selectedWP ? "#f9fafb" : "white",
                                            }),
                                        }}
                                    />
                                )}
                            </div>

                            {/* Make */}
                            <div className="space-y-1">
                                <Label className="text-sm font-bold text-gray-700">
                                    Make<span className="text-red-500 ml-0.5">*</span>
                                </Label>
                                {isCustomMake ? (
                                    <div className="space-y-2">
                                        <Input
                                            placeholder="Enter custom make name"
                                            value={customMake}
                                            onChange={(e) => {
                                                setCustomMake(e.target.value);
                                                setSelectedMake(e.target.value);
                                            }}
                                            className="h-11 border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-100 transition-all font-medium"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setIsCustomMake(false);
                                                setCustomMake("");
                                                setSelectedMake("");
                                            }}
                                            className="text-xs text-blue-600 hover:text-blue-700 h-6 px-2 font-black tracking-tight"
                                        >
                                            ← BACK TO LIST
                                        </Button>
                                    </div>
                                ) : (
                                    <ReactSelect
                                        options={makeOptions}
                                        value={
                                            makeOptions.find(opt => opt.value === selectedMake)
                                            || (selectedMake ? { label: selectedMake, value: selectedMake } : null)
                                        }
                                        onChange={handleMakeChange}
                                        placeholder={selectedCategory ? "Select Make" : "Pick a Category first"}
                                        isDisabled={!selectedCategory}
                                        classNamePrefix="react-select"
                                        styles={{
                                            control: (base) => ({
                                                ...base,
                                                minHeight: "44px",
                                                borderRadius: "8px",
                                                borderColor: "#e5e7eb",
                                                backgroundColor: !selectedCategory ? "#f9fafb" : "white",
                                            }),
                                            option: (base, state: any) => ({
                                                ...base,
                                                ...(state.data.value === "__others__" ? {
                                                    backgroundColor: state.isFocused ? "#eff6ff" : "#f8fafc",
                                                    color: "#2563eb",
                                                    fontWeight: 800,
                                                    borderTop: "1px solid #f1f5f9",
                                                    letterSpacing: "-0.025em",
                                                } : {}),
                                            }),
                                        }}
                                        formatOptionLabel={(option) => (
                                            option.value === "__others__" ? (
                                                <span className="flex items-center gap-1 uppercase text-xs font-black">
                                                    <span>+ OTHERS</span>
                                                </span>
                                            ) : option.label
                                        )}
                                    />
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

            <CustomItemDialog
                open={customItemDialogOpen}
                onClose={() => setCustomItemDialogOpen(false)}
                onSelect={handleCustomItemSelect}
                allCustomItems={allCustomItems}
                standardItems={itemOptionsForWP}
                catList={catList || []}
            />

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

export default EditRequestItemModal;
