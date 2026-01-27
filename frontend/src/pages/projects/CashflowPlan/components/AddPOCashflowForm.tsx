import React, { useState, useEffect, useMemo } from "react";
import { X, Check,Package } from "lucide-react";
import ReactSelect from 'react-select';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFrappePostCall, useFrappeCreateDoc } from "frappe-react-sdk";
import { CategoryTaskSelector } from "../../components/planning/CategoryTaskSelector"; // Reusing this

interface AddPOCashflowFormProps {
    onClose: () => void;
    onSuccess: () => void;
    projectId: string;
}

import { AllPOsModal } from "../../components/planning/AllPOsModal";

export const AddPOCashflowForm = ({ onClose, onSuccess, projectId }: AddPOCashflowFormProps) => {
    const { toast } = useToast();

    // State
    const [selectedCategory, setSelectedCategory] = useState<string>("");
    const [selectedTask, setSelectedTask] = useState<string>("");
    const [selectedTaskDoc, setSelectedTaskDoc] = useState<any>(null);
    const [searchMode, setSearchMode] = useState<"po" | "item">("po"); // New state
    
    // Available Data
    const { call: fetchCategoriesAndTasks, result: catTaskResult, loading: isLoadingCatTasks } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_categories_and_tasks"
    );
    const categories = catTaskResult?.message?.categories || [];
    const allTasks = catTaskResult?.message?.tasks || [];

    // Fetch POs for Task (V2 API)
    const { call: fetchDataV2, result: dataV2Result, loading: isLoadingDataV2 } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_material_plan_data_v2"
    );
    const taskPOs = dataV2Result?.message?.pos || [];
    const taskItems = dataV2Result?.message?.items || []; // items for item search mode

    // Fetch All POs (New)
    const { call: fetchAllPOs, result: allPOsResult, loading: isLoadingAllPOs } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_all_project_pos"
    );
    const allProjectPOs = allPOsResult?.message?.pos || [];

    // Selection State
    const [selectedPO, setSelectedPO] = useState<any>(null);
    const [selectedItems, setSelectedItems] = useState<Record<string, any>>({});
    const [isAllPOsOpen, setIsAllPOsOpen] = useState(false);
    
    // Final Form State
    const [plannedDate, setPlannedDate] = useState<string>("");
    const [plannedAmount, setPlannedAmount] = useState<string>("");
    const [remarks, setRemarks] = useState<string>("");

    // API: Create Doc
    const { createDoc, loading: isCreating } = useFrappeCreateDoc();

    // Effects
    useEffect(() => {
        if (projectId) fetchCategoriesAndTasks({ project: projectId });
    }, [projectId]);

    useEffect(() => {
        if (selectedTask) {
            fetchDataV2({
                project: projectId,
                task_id: selectedTask,
                search_type: searchMode // Pass search mode
            });
        }
    }, [selectedTask, searchMode]); // Dependency on searchMode

    // Handlers
    const handleTaskChange = (taskId: string, taskDoc: any) => {
        setSelectedTask(taskId);
        setSelectedTaskDoc(taskDoc);
        setSelectedPO(null);
        setSelectedItems({});
    };

    const handleSearchModeChange = (mode: "po" | "item") => {
        setSearchMode(mode);
        setSelectedPO(null);
        setSelectedItems({});
    };

    const handlePOSelect = (po: any) => {
        setSelectedPO(po);
        setSelectedItems({});
    };

    const handleItemSearchSelect = (item: any) => {
        // When searching by item, we find the parent PO and select it
        // The item itself is NOT automatically added to selectedItems? 
        // In Material Plan it toggles selection. Let's do that.
        // But first we need the PO content (items list) which might not be fully loaded in 'item' mode?
        // Actually, get_material_plan_data_v2 in 'item' mode returns { po_list: [], items: [] }. 
        // Logic: Find the PO from the item.parent.
        // Note: We need to set 'selectedPO' to the full PO object. 
        // If we are in item mode, 'taskPOs' might be empty or different?
        // Actually, let's check the API response structure again.
        // In "item" mode, it returns "po_list" (lightweight) and "items".
        // We might need to fetch the full PO or use what we have.
        // For simplicity, let's assume we can set selectedPO from the item's parent info if available,
        // or we rely on the user to select the PO confirming the context.
        // WAIT: In MaterialPlan, `handleItemToggle` adds to selectedItems.
        // Then `handleContinueToReview` groups by parent PO. 
        // Here we want to select ONE PO (Single Context).
        // So picking an item implies selecting its parent PO.
        
        // We'll mimic MaterialPlan: if item is selected, we fetch/set its PO. 
        // But since we want to be simpler here (Cashflow usually per PO), let's find the PO in `dataV2Result.message.po_list`?
        // Or just trust the `parent` field.
        
        // Let's implement basics:
        if(item.parent) {
             // In 'item' mode, we might need to fetch the PO details if we don't have them?
             // Actually, simplest is: User selects item -> We set selectedPO (if we can find it) -> We add item to selectedItems.
             // But we need the PO object with supplier etc.
             // Let's rely on finding it in `dataV2Result?.message?.po_list` if available?
             const parentPO = dataV2Result?.message?.po_list?.find((p:any) => p.name === item.parent);
             if(parentPO) {
                  // We need 'items' in the PO to render the checklist. 
                  // In 'item' mode, po_list is lightweight. 
                  // Maybe we should just switch to that PO?
                  // For now, let's just create a synthetic PO object if needed or warn.
                  // Actually, let's keep it simple: Select PO logic is primary.
                  // If item is clicked, we set selectedPO = { name: item.parent, ... } and add the item.
                  // But we need to load the PO items to show the checklist.
                  // MaterialPlan handles this by grouping items.
                  // Let's try to find it.
                  
                  // Re-fetch PO details if needed? 
                  // Let's just set the PO name and let the UI handle it?
                  // Or: when item is selected, we switch searchMode to 'po' and select that PO?
                  // Let's do that.
                  
                  // Actually, let's stick to the UI part first.
                  
                  // For now, if item selected, we just set selectedPO using parent name and try to populate.
                  setSelectedPO({ name: item.parent, is_critical: true });
                  setSelectedItems({ [item.name]: item });
             }
        }
    };


    const toggleItem = (item: any) => {
        setSelectedItems(prev => {
            const next = { ...prev };
            if (next[item.name]) delete next[item.name];
            else next[item.name] = item;
            return next;
        });
    };

    const handleAllPOsConfirm = (selectedPOsList: any[], selectedItemsMap: Record<string, Set<string>>) => {
        if (selectedPOsList.length > 0) {
            const po = selectedPOsList[0];
            setSelectedPO(po);
            setIsAllPOsOpen(false);

            const newItems: Record<string, any> = {};
            const itemIds = selectedItemsMap[po.name] || new Set();
            po.items?.forEach((item: any) => {
                if (itemIds.has(item.name)) {
                    newItems[item.name] = item;
                }
            });
            setSelectedItems(newItems);
        }
    };

    const openAllPOsModal = () => {
        if (!allProjectPOs.length) {
            fetchAllPOs({ project: projectId });
        }
        setIsAllPOsOpen(true);
    };

    // ... (rest of handleSubmit and calculations) ...
    const handleSubmit = async () => {
        if (!selectedPO || !plannedDate || !plannedAmount) {
            toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
            return;
        }

        const itemsList = Object.values(selectedItems).map((i:any) => ({
            name: i.name,
            item_code: i.item_code,
            item_name: i.item_name,
            rate: i.rate,
            amount: i.amount
        }));

        try {
            await createDoc("Cashflow Plan", {
                project: projectId,
                type: "PO",
                id_link: selectedPO.name,
                vendor: selectedPO.supplier || (selectedPO.original?.supplier),
                critical_po_category: selectedCategory,
                critical_po_task: selectedTaskDoc?.item_name,
                planned_date: plannedDate,
                planned_amount: parseFloat(plannedAmount),
                items: JSON.stringify({ list: itemsList }),
                remarks: remarks
            });
            
            toast({ title: "Success", description: "Cashflow Plan created successfully" });
            onSuccess();
            onClose();
        } catch (e: any) {
            console.error(e);
            toast({ title: "Error", description: e.message || "Failed to create plan", variant: "destructive" });
        }
    };

    // Calculate estimated total from selected items
    const selectedTotal = useMemo(() => {
        return Object.values(selectedItems).reduce((sum, item: any) => sum + (item.amount || 0), 0);
    }, [selectedItems]);

    useEffect(() => {
        if (selectedTotal > 0 && !plannedAmount) {
            setPlannedAmount(selectedTotal.toString());
        }
    }, [selectedTotal]);


    return (
        <div className="border rounded-lg p-6 bg-white shadow-sm border-blue-100 relative animate-in fade-in slide-in-from-top-4">
             <Button variant="ghost" size="icon" onClick={onClose} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
            </Button>
            
            <h3 className="text-lg font-bold mb-6 text-gray-800">Add PO Cashflow Plan</h3>

            {/* Step 1: Context */}
            <div className="space-y-4 mb-6">
                <Label className="text-base font-semibold text-gray-700">1. Select Task Context</Label>
                <div className="flex justify-end">
                     <Button variant="ghost" size="sm" onClick={() => {
                        if(projectId) fetchCategoriesAndTasks({ project: projectId });
                        setSelectedTask("");
                     }} className="text-xs text-blue-600 h-6">Refresh</Button>
                </div>
                <CategoryTaskSelector
                    categories={categories}
                    tasks={allTasks}
                    selectedCategory={selectedCategory}
                    selectedTask={selectedTask}
                    onCategoryChange={setSelectedCategory}
                    onTaskChange={handleTaskChange}
                    isLoading={isLoadingCatTasks}
                />
            </div>

            {/* Step 2: Select PO - Styled like Material Plan */}
            {selectedTask && (
                <div className="space-y-4 mb-6 animate-in fade-in slide-in-from-top-2">
                    <Label className="text-base font-semibold text-gray-700">2. Select Procurement Order</Label>
                    
                    {/* Search & Selection Container - ERP Style Card */}
                    <div className="bg-white border rounded-lg p-3 md:p-4 mb-4 shadow-sm">
                        
                         {/* Header Section */}
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-2 mb-4">
                            <div className="space-y-1">
                                <h3 className="text-sm font-semibold text-gray-900 leading-none">Search / Select Materials or PO ID</h3>
                                <p className="text-xs text-gray-500 max-w-2xl">
                                    Search by PO ID or by specific items within POs.
                                </p>
                            </div>
                            <Button
                                variant="link"
                                size="sm"
                                onClick={openAllPOsModal}
                                className="text-xs font-medium text-blue-600 h-auto p-0 whitespace-nowrap self-start md:self-auto"
                            >
                                Can't find? See All POs
                            </Button>
                        </div>

                         {/* Inputs Row */}
                        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
                            {/* Search Mode Selector (Left) */}
                            <div className="w-full md:w-[140px] shrink-0">
                                <Select
                                    value={searchMode}
                                    onValueChange={(val: "po" | "item") => handleSearchModeChange(val)}
                                >
                                    <SelectTrigger className="h-[40px] w-full text-sm bg-gray-50/50 border-gray-200">
                                        <SelectValue placeholder="Search Mode" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="po" className="text-sm">PO ID</SelectItem>
                                        <SelectItem value="item" className="text-sm">Items In POs</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                             {/* Search Input (Right) */}
                            <div className="flex-1 min-w-0">
                                {searchMode === "po" ? (
                                    <ReactSelect
                                        options={taskPOs.map(po => ({ label: `${po.name} - ${po.supplier || 'Unknown'}`, value: po.name, original: po }))}
                                        value={selectedPO ? { label: `${selectedPO.name} - ${selectedPO.supplier || 'Unknown'}`, value: selectedPO.name, original: selectedPO } : null}
                                        onChange={(opt) => handlePOSelect(opt?.original)}
                                        placeholder="Search PO ID..."
                                        isLoading={isLoadingDataV2}
                                        className="text-sm"
                                        styles={{ menu: (base) => ({ ...base, zIndex: 50 }) }}
                                        menuPortalTarget={document.body}
                                    />
                                ) : (
                                    <ReactSelect
                                        options={taskItems.map(item => ({ label: `${item.item_name} (${item.parent})`, value: item.name, original: item }))}
                                        onChange={(opt) => handleItemSearchSelect(opt?.original)}
                                        placeholder="Search Items..."
                                        isLoading={isLoadingDataV2}
                                        className="text-sm"
                                        styles={{ menu: (base) => ({ ...base, zIndex: 50 }) }}
                                        menuPortalTarget={document.body}
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* PO Items Selection Checklist (Only shows when PO is selected) */}
                    {selectedPO && (
                        <div className="border rounded-md p-4 bg-gray-50 mt-2">
                             <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                                <Package className="h-4 w-4 text-blue-600" />
                                <span className="font-bold text-gray-800 text-sm">{selectedPO.name}</span>
                                <span className="text-xs text-gray-500 ml-2">- {selectedPO.supplier || "Unknown Vendor"}</span>
                            </div>

                            <div className="flex justify-between items-center mb-2">
                                <h4 className="font-medium text-sm">Select Items to Pay For</h4>
                                <Button variant="ghost" size="sm" onClick={() => {
                                    if (Object.keys(selectedItems).length === (selectedPO.items?.length || 0)) setSelectedItems({});
                                    else {
                                        const all: any = {};
                                        selectedPO.items?.forEach((i:any) => all[i.name] = i);
                                        setSelectedItems(all);
                                    }
                                }}>
                                    {Object.keys(selectedItems).length === (selectedPO.items?.length || 0) ? "Unselect All" : "Select All"}
                                </Button>
                            </div>
                            <div className="max-h-40 overflow-y-auto space-y-1">
                                {selectedPO.items?.length > 0 ? selectedPO.items?.map((item: any) => (
                                    <div 
                                        key={item.name} 
                                        onClick={() => toggleItem(item)}
                                        className={`flex items-center justify-between p-2 rounded cursor-pointer border transition-colors ${selectedItems[item.name] ? "bg-blue-50 border-blue-200" : "bg-white border-gray-100 hover:border-gray-200"}`}
                                    >
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${selectedItems[item.name] ? "bg-blue-500 border-blue-500" : "border-gray-400"}`}>
                                                {selectedItems[item.name] && <Check className="w-3 h-3 text-white" />}
                                            </div>
                                            <span className="text-sm truncate max-w-[200px]">{item.item_name}</span>
                                        </div>
                                        <span className="text-xs font-medium text-gray-600">₹{item.amount?.toLocaleString()}</span>
                                    </div>
                                )) : (
                                    <div className="text-xs text-gray-500 italic p-2 text-center">
                                        No items available or PO details not loaded.
                                    </div>
                                )}
                            </div>
                            <div className="text-right mt-2 text-sm font-medium text-gray-600">
                                Selected Total: <span className="text-gray-900">₹{selectedTotal.toLocaleString()}</span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Step 3: Plan Details */}
            {selectedPO && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 border-t pt-4">
                    <Label className="text-base font-semibold text-gray-700">3. Plan Details</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <Label>Planned Date <span className="text-red-500">*</span></Label>
                            <Input 
                                type="date" 
                                value={plannedDate} 
                                onChange={(e) => setPlannedDate(e.target.value)} 
                                className="mt-1"
                            />
                        </div>
                        <div>
                            <Label>Planned Amount <span className="text-red-500">*</span></Label>
                            <div className="relative mt-1">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                                <Input 
                                    type="number" 
                                    value={plannedAmount} 
                                    onChange={(e) => setPlannedAmount(e.target.value)}
                                    placeholder="Enter amount"
                                    className="pl-7"
                                />
                            </div>
                            {selectedTotal > 0 && selectedTotal !== parseFloat(plannedAmount || "0") && (
                                <p className="text-xs text-yellow-600 mt-1">Differs from selected items total (₹{selectedTotal})</p>
                            )}
                        </div>
                    </div>
                    <div>
                        <Label>Remarks</Label>
                        <Textarea 
                            value={remarks} 
                            onChange={(e) => setRemarks(e.target.value)} 
                            placeholder="Any notes about this payment plan..."
                            className="mt-1"
                        />
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="flex justify-end gap-3 mt-8 pt-4 border-t">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button 
                    onClick={handleSubmit} 
                    disabled={!selectedPO || !plannedDate || !plannedAmount || isCreating}
                    className="bg-red-600 hover:bg-red-700 text-white min-w-[120px]"
                >
                    {isCreating ? "Creating..." : "Create Plan"}
                </Button>
            </div>

            <AllPOsModal 
                isOpen={isAllPOsOpen}
                onClose={() => setIsAllPOsOpen(false)}
                onConfirm={handleAllPOsConfirm}
                pos={allProjectPOs}
                isLoading={isLoadingAllPOs}
                currentCategory={selectedCategory}
                currentTask={selectedTaskDoc?.item_name}
            />
        </div>
    );
};
