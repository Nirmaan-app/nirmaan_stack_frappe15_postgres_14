import React, { useState, useEffect, useMemo,useRef } from "react";
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
    onSave: (itemName: string, updates: Partial<TDSItem>, itemsToDelete?: string[]) => void;
    loading?: boolean;
}

export const ProjectEditTDSItemModal: React.FC<ProjectEditTDSItemModalProps> = ({
    open,
    onOpenChange,
    item,
    onSave,
    loading = false,
}) => {
    // States for selection
    const [selectedItemName, setSelectedItemName] = useState<string | null>(null);
    const [selectedMake, setSelectedMake] = useState<string | null>(null);
    const [description, setDescription] = useState("");
    const [boqRef, setBoqRef] = useState("");

    // Dialog State for Validation
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [confirmInput, setConfirmInput] = useState("");
    const [duplicateDocName, setDuplicateDocName] = useState<string | null>(null);

    // 1. Fetch Master Data
    const { data: repoItems } = useFrappeGetDocList<TDSRepositoryDoc>("TDS Repository", {
        fields: ["name", "tds_item_id", "tds_item_name", "make", "description", "work_package", "category", "tds_attachment"],
        limit: 0,
        enabled: open
    });

    // 2. Fetch Existing Project Items (to avoid duplicates)
    // We check against all project items except the one we are editing
    const { data: existingProjectItems } = useFrappeGetDocList("Project TDS Item List", {
        fields: ["name", "tds_item_id", "tds_make", "tds_status", "tdsi_project_id","tds_description"],
        filters: (item && open) ? [["tdsi_project_id", "=", item.tdsi_project_id || ""], ["name", "!=", item.name], ["docstatus", "!=", 2]] : [["name", "=", "NOT_FOUND"]],
        limit: 0
    });

    // Initialize states when item changes or modal opens
    // Track previous Make to detect changes
    const prevMakeRef = useRef<string | null>(null);

    // Initialize states when item changes or modal opens
    // Initialize states when item changes or modal opens
    useEffect(() => {
        if (item && open) {
            setSelectedItemName(item.tds_item_name || "");
            setSelectedMake(item.tds_make || "");
            setDescription(item.tds_description || "");
            setBoqRef(item.tds_boq_line_item || "");
            prevMakeRef.current = item.tds_make || "";
        }
    }, [item, open]);

    // 3. Filter repository items to see what is "Available"
    // An item is available if it's NOT already in the project as Approved/Pending
    // UNLESS it's the current record being edited (handled by existingProjectItems filters)
    const availableRepoItems = useMemo(() => {
        if (!repoItems || !existingProjectItems) return repoItems || [];

        // Exclude if Approved or Pending in project
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

    // 4. Compute Options
    const itemOptions = useMemo(() => {
        const unique = new Map();
        availableRepoItems.forEach(i => {
            if (!unique.has(i.tds_item_name)) {
                unique.set(i.tds_item_name, { label: i.tds_item_name, value: i.tds_item_name });
            }
        });
        return Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label));
    }, [availableRepoItems]);

    const makeOptions = useMemo(() => {
        if (!selectedItemName) return [];
        return availableRepoItems
            .filter(i => i.tds_item_name === selectedItemName)
            .map(i => ({ label: i.make, value: i.make }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [availableRepoItems, selectedItemName]);

    // Identify Selected Repo Entry (for auto-filling WP and Category)
    const selectedRepoEntry = useMemo(() => {
        if (!selectedItemName || !selectedMake) return null;
        return availableRepoItems.find(i => 
            i.tds_item_name === selectedItemName && 
            i.make === selectedMake
        );
    }, [availableRepoItems, selectedItemName, selectedMake]);

    // Auto-fill Description from Repo Entry when Make changes
    useEffect(() => {
        // Only run if make has changed (and not initial load)
        if (selectedMake !== prevMakeRef.current) {
            setDescription(selectedRepoEntry?.description || "");
        }
        // Update ref
        prevMakeRef.current = selectedMake;
    }, [selectedMake, selectedRepoEntry]);

    // --- Handlers ---

    const handleItemNameChange = (val: string | null) => {
        setSelectedItemName(val);
        setSelectedMake(null);
    };

    const handleSaveAttempt = () => {
        if (!item || !selectedRepoEntry) {
            toast({ title: "Validation Error", description: "Please select a valid item and make from the repository.", variant: "destructive" });
            return;
        }

        if (boqRef.length > 300) {
            toast({
                title: "Validation Error",
                description: "BOQ Line Item cannot exceed 300 characters",
                variant: "destructive"
            });
            return;
        }

        // Project Duplicate Check for "Rejected" entries
        // Since active ones are filtered out of options, we only need to check for Rejected duplicates
        const duplicate = existingProjectItems?.find(i => 
            i.tds_item_id === selectedRepoEntry.tds_item_id && 
            i.tds_make === selectedMake &&
            i.tds_status === "Rejected"
        );

        if (duplicate) {
            setDuplicateDocName(duplicate.name);
            setConfirmInput("");
            setShowConfirmDialog(true);
            return;
        }

        const updates: Partial<TDSItem> = {
            tds_work_package: selectedRepoEntry.work_package,
            tds_category: selectedRepoEntry.category,
            tds_item_name: selectedItemName!,
            tds_make: selectedMake!,
            tds_item_id: selectedRepoEntry.tds_item_id,
            tds_attachment: selectedRepoEntry.tds_attachment,
            tds_description: description,
            tds_boq_line_item: boqRef
        };

        onSave(item.name, updates);
    };

    const confirmResubmission = () => {
        if (confirmInput === "1" && item && duplicateDocName && selectedRepoEntry) {
            const updates: Partial<TDSItem> = {
                tds_work_package: selectedRepoEntry.work_package,
                tds_category: selectedRepoEntry.category,
                tds_item_name: selectedItemName!,
                tds_make: selectedMake!,
                tds_item_id: selectedRepoEntry.tds_item_id,
                tds_attachment: selectedRepoEntry.tds_attachment,
                tds_description: description,
                tds_boq_line_item: boqRef
            };
            onSave(item.name, updates, [duplicateDocName]);
            setShowConfirmDialog(false);
            setDuplicateDocName(null);
        } else {
            toast({ title: "Invalid Input", description: "Please enter '1' to continue.", variant: "destructive" });
        }
    };

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit TDS Item</DialogTitle>
                        <DialogDescription>
                            Select an item and make. Work Package and Category will auto-fill.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Item Name <span className="text-red-500">*</span></Label>
                            <ReactSelect
                                options={itemOptions}
                                value={selectedItemName ? { label: selectedItemName, value: selectedItemName } : null}
                                onChange={(opt) => handleItemNameChange(opt?.value || null)}
                                placeholder="Select Item Name"
                                isLoading={!repoItems}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label>Make <span className="text-red-500">*</span></Label>
                            <ReactSelect
                                options={makeOptions}
                                value={selectedMake ? { label: selectedMake, value: selectedMake } : null}
                                onChange={(opt) => setSelectedMake(opt?.value || null)}
                                placeholder={selectedItemName ? "Select Make" : "Select an item first"}
                                isDisabled={!selectedItemName}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label>Work Package (Auto-fill)</Label>
                            <ReactSelect
                                isDisabled
                                value={selectedRepoEntry ? { label: selectedRepoEntry.work_package, value: selectedRepoEntry.work_package } : null}
                                placeholder="Auto-populated"
                                styles={{ control: (base) => ({ ...base, backgroundColor: '#f9fafb' }) }}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label>Category (Auto-fill)</Label>
                            <ReactSelect
                                isDisabled
                                value={selectedRepoEntry ? { label: selectedRepoEntry.category, value: selectedRepoEntry.category } : null}
                                placeholder="Auto-populated"
                                styles={{ control: (base) => ({ ...base, backgroundColor: '#f9fafb' }) }}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="boq_ref">BOQ Line Item (Optional)</Label>
                            <Textarea
                                id="boq_ref"
                                value={boqRef}
                                onChange={(e) => setBoqRef(e.target.value)}
                                placeholder="Edit BOQ Ref"
                                rows={4}
                                maxLength={500}
                            />
                            <div className="text-xs text-right text-gray-500 mt-1">
                                {(boqRef || '').length}/500
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="description">Description (Input Edit)</Label>
                            <Textarea
                                id="description"
                                rows={3}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Edit description if needed"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveAttempt} disabled={loading || !selectedRepoEntry}>
                            {loading ? "Saving..." : "Save Changes"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Confirmation Dialog for Rejected Duplicate */}
            <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Resubmit Rejected Item?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This item-make combination already exists as a <strong>Rejected</strong> entry in the project. 
                            To replace it and continue, please enter <strong>"1"</strong> below.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4">
                        <Input 
                            value={confirmInput}
                            onChange={(e) => setConfirmInput(e.target.value)}
                            placeholder="Enter 1 to confirm"
                            className="text-center text-lg font-bold"
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setShowConfirmDialog(false)}>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                            onClick={(e) => {
                                e.preventDefault();
                                confirmResubmission();
                            }}
                            className="bg-red-600 hover:bg-red-700"
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
