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
    // Hierarchical Selection States
    const [selectedWP, setSelectedWP] = useState<string | null>(null);
    const [selectedCat, setSelectedCat] = useState<string | null>(null);
    const [selectedItemName, setSelectedItemName] = useState<string | null>(null);
    const [selectedMake, setSelectedMake] = useState<string | null>(null);
    const [description, setDescription] = useState("");

    // Dialog State for Validation
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [confirmInput, setConfirmInput] = useState("");
    const [duplicateDocName, setDuplicateDocName] = useState<string | null>(null);

    // 1. Fetch Master Data
    const { data: repoItems } = useFrappeGetDocList<TDSRepositoryDoc>("TDS Repository", {
        fields: ["name", "tds_item_id", "tds_item_name", "make", "description", "work_package", "category", "tds_attachment"],
        limit: 1000,
        enabled: open
    });

    // 2. Fetch Existing Project Items (to avoid duplicates)
    const { data: existingProjectItems } = useFrappeGetDocList("Project TDS Item List", {
        fields: ["name", "tds_item_id", "tds_make", "tds_status", "tdsi_project_id"],
        filters: (item && open) ? [["tdsi_project_id", "=", item.tdsi_project_id || ""], ["name", "!=", item.name], ["docstatus", "!=", 2]] : [["name", "=", "NOT_FOUND"]],
        limit: 1000
    });

    // Initialize states when item changes or modal opens
    useEffect(() => {
        if (item && open) {
            setSelectedWP(item.tds_work_package || "");
            setSelectedCat(item.tds_category || "");
            setSelectedItemName(item.tds_item_name || "");
            setSelectedMake(item.tds_make || "");
            setDescription(item.tds_description || "");
        }
    }, [item, open]);

    // --- Options Computation (Hierarchy) ---

    const wpOptions = useMemo(() => {
        if (!repoItems) return [];
        const unique = Array.from(new Set(repoItems.map(i => i.work_package).filter(Boolean)));
        return unique.sort().map(val => ({ label: val, value: val }));
    }, [repoItems]);

    const catOptions = useMemo(() => {
        if (!repoItems || !selectedWP) return [];
        const unique = Array.from(new Set(
            repoItems
                .filter(i => i.work_package === selectedWP)
                .map(i => i.category)
                .filter(Boolean)
        ));
        return unique.sort().map(val => ({ label: val, value: val }));
    }, [repoItems, selectedWP]);

    const itemOptions = useMemo(() => {
        if (!repoItems || !selectedCat) return [];
        const unique = Array.from(new Set(
            repoItems
                .filter(i => i.work_package === selectedWP && i.category === selectedCat)
                .map(i => i.tds_item_name)
                .filter(Boolean)
        ));
        return unique.sort().map(val => ({ label: val, value: val }));
    }, [repoItems, selectedWP, selectedCat]);

    const makeOptions = useMemo(() => {
        if (!repoItems || !selectedItemName) return [];
        const unique = Array.from(new Set(
            repoItems
                .filter(i => i.work_package === selectedWP && i.category === selectedCat && i.tds_item_name === selectedItemName)
                .map(i => i.make)
                .filter(Boolean)
        ));
        return unique.sort().map(val => ({ label: val, value: val }));
    }, [repoItems, selectedWP, selectedCat, selectedItemName]);

    // Find Repo Entry to get ID and description if needed
    const selectedRepoEntry = useMemo(() => {
        if (!repoItems || !selectedWP || !selectedCat || !selectedItemName || !selectedMake) return null;
        return repoItems.find(i => 
            i.work_package === selectedWP && 
            i.category === selectedCat && 
            i.tds_item_name === selectedItemName && 
            i.make === selectedMake
        );
    }, [repoItems, selectedWP, selectedCat, selectedItemName, selectedMake]);

    // --- Handlers ---

    const handleWPChange = (val: string | null) => {
        setSelectedWP(val);
        setSelectedCat(null);
        setSelectedItemName(null);
        setSelectedMake(null);
    };

    const handleCatChange = (val: string | null) => {
        setSelectedCat(val);
        setSelectedItemName(null);
        setSelectedMake(null);
    };

    const handleItemNameChange = (val: string | null) => {
        setSelectedItemName(val);
        setSelectedMake(null);
    };

    const handleSaveAttempt = () => {
        if (!item || !selectedRepoEntry) {
            toast({ title: "Incomplete Selection", description: "Please ensure all identity fields are selected from the repository.", variant: "destructive" });
            return;
        }

        // Project Duplicate Check
        const duplicate = existingProjectItems?.find(i => 
            i.tds_item_id === selectedRepoEntry.tds_item_id && 
            i.tds_make === selectedMake
        );

        if (duplicate) {
            if (duplicate.tds_status === "Rejected") {
                setDuplicateDocName(duplicate.name);
                setConfirmInput("");
                setShowConfirmDialog(true);
                return;
            } else {
                toast({
                    title: "Duplicate Item",
                    description: `This items already exists in the project with status: ${duplicate.tds_status}.`,
                    variant: "destructive"
                });
                return;
            }
        }

        const updates: Partial<TDSItem> = {
            tds_work_package: selectedWP!,
            tds_category: selectedCat!,
            tds_item_name: selectedItemName!,
            tds_make: selectedMake!,
            tds_item_id: selectedRepoEntry.tds_item_id,
            tds_description: description
        };

        onSave(item.name, updates);
    };

    const confirmResubmission = () => {
        if (confirmInput === "1" && item && duplicateDocName && selectedRepoEntry) {
            const updates: Partial<TDSItem> = {
                tds_work_package: selectedWP!,
                tds_category: selectedCat!,
                tds_item_name: selectedItemName!,
                tds_make: selectedMake!,
                tds_item_id: selectedRepoEntry.tds_item_id,
                tds_description: description
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
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>Edit TDS Item</DialogTitle>
                        <DialogDescription>
                            Change any detail. Selection MUST be from the TDS Repository.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Work Package <span className="text-red-500">*</span></Label>
                            <ReactSelect
                                options={wpOptions}
                                value={selectedWP ? { label: selectedWP, value: selectedWP } : null}
                                onChange={(opt) => handleWPChange(opt?.value || null)}
                                placeholder="Select Work Package"
                                isLoading={!repoItems}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label>Category <span className="text-red-500">*</span></Label>
                            <ReactSelect
                                options={catOptions}
                                value={selectedCat ? { label: selectedCat, value: selectedCat } : null}
                                onChange={(opt) => handleCatChange(opt?.value || null)}
                                placeholder={selectedWP ? "Select Category" : "NA"}
                                isDisabled={!selectedWP}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label>Item Name <span className="text-red-500">*</span></Label>
                            <ReactSelect
                                options={itemOptions}
                                value={selectedItemName ? { label: selectedItemName, value: selectedItemName } : null}
                                onChange={(opt) => handleItemNameChange(opt?.value || null)}
                                placeholder={selectedCat ? "Select Item Name" : "NA"}
                                isDisabled={!selectedCat}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label>Make <span className="text-red-500">*</span></Label>
                            <ReactSelect
                                options={makeOptions}
                                value={selectedMake ? { label: selectedMake, value: selectedMake } : null}
                                onChange={(opt) => setSelectedMake(opt?.value || null)}
                                placeholder={selectedItemName ? "Select Make" : "NA"}
                                isDisabled={!selectedItemName}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="description">Description</Label>
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
                            This item-make combination already exists as a <strong>Rejected</strong> entry. 
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
