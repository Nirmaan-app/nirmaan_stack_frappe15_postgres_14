import React, { useState, useEffect, useMemo, useRef } from "react";
import { X, ChevronDown, Check, ChevronsUpDown, PlusCircleIcon, Search, Package, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import ReactSelect from 'react-select';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup"; 
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useFrappePostCall, useFrappeCreateDoc } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { CategoryTaskSelector } from "../../components/planning/CategoryTaskSelector";
import { AllPOsModal } from "../../components/planning/AllPOsModal";
import { ReviewPOCashflowPage } from "./ReviewPOCashflowPage";

// Types
interface Task {
    name: string;
    item_name: string;
    critical_po_category: string;
    associated_pos: string[];
    associated_pos_count: number;
    status?: string;
    sub_category?: string;
}

interface POItem {
    name: string;
    item_name?: string;
    items_count?: number;
    creation?: string;
    status?: string;
    work_package?: string;
    items?: any[];
    is_critical?: boolean;
    associated_tasks?: { task_name: string; item_name: string; category: string }[];
    vendor?: string;
    vendor_name?: string;
    [key: string]: any;
}

interface POPlan {
    poId: string;
    poName: string;
    items: any[];
    selectedItems: Set<string>;
    plannedDate: string;
    plannedAmount?: number;
    estimatedPrice?: number;
    isCritical: boolean;
    category?: string;
    task?: string;
    vendor?: string;
    vendorName?: string;
}



interface AddPOCashflowFormProps {
    planNumber?: number; // Optional as it might not be passed in original usage
    projectId: string;
    onClose: () => void;
    onSuccess: () => void; // Restoring original prop
}

export const AddPOCashflowForm = ({ projectId, onClose, onSuccess, planNumber = 1 }: AddPOCashflowFormProps) => {
    const { toast } = useToast();

    // ==========================================================================
    // STATE - V2 IMPLEMENTATION
    // ==========================================================================
    
    // Form Step: "selection" | "review"
    const [formStep, setFormStep] = useState<"selection" | "review">("selection");
    
    // PO Mode: "existing" | "new"
    const [poMode, setPoMode] = useState<"existing" | "new" | undefined>(undefined);
    
    // Search Mode: "po" | "item"
    const [searchMode, setSearchMode] = useState<"po" | "item">("po");
    
    // V2: Category/Task State
    const [selectedCategory, setSelectedCategory] = useState<string>("");
    const [selectedTask, setSelectedTask] = useState<string>("");
    const [selectedTaskDoc, setSelectedTaskDoc] = useState<Task | null>(null);
    
    // PO Selection State
    const [selectedPOs, setSelectedPOs] = useState<POItem[]>([]);
    const [showAllPOsModal, setShowAllPOsModal] = useState(false);
    
    // Review Plans State
    const [reviewPlans, setReviewPlans] = useState<POPlan[]>([]);
    
    // New PO Mode State
    const [manualItemsText, setManualItemsText] = useState<string>("");
    const [plannedDate, setplannedDate] = useState<string>("");
    const [newPOVendor, setNewPOVendor] = useState<{value: string, label: string} | null>(null);
    const [newPOAmount, setNewPOAmount] = useState<string>("");
    const [estimatedPrice, setEstimatedPrice] = useState<string>("");
    
    // Item Search State
    const [poSearchInput, setPoSearchInput] = useState("");
    const [itemSearchInput, setItemSearchInput] = useState("");
    const [selectedItems, setSelectedItems] = useState<Record<string, any>>({});
    const [isDropdownOpen, setDropdownOpen] = useState(false);
    const searchWrapperRef = useRef<HTMLDivElement>(null);

    // ==========================================================================
    // API CALLS
    // ==========================================================================
    
    // Fetch Categories and Tasks
    const { call: fetchCategoriesAndTasks, result: catTaskResult, loading: isLoadingCatTasks } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_categories_and_tasks"
    );
    
    // Fetch POs/Items for Task (V2 API)
    const { call: fetchDataV2, result: dataV2Result, loading: isLoadingDataV2 } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_material_plan_data_v2"
    );
    
    // Fetch All Project POs (for "See All POs" modal)
    const { call: fetchAllPOs, result: allPOsResult, loading: isLoadingAllPOs } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_all_project_pos"
    );
    
    // Create Material Delivery Plan
    const { createDoc, loading: isCreating } = useFrappeCreateDoc();
    
    // Fetch Vendors
    const { call: fetchVendors, result: vendorsResult, loading: isLoadingVendors } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.cashflow_plan_api.get_active_vendors"
    );

    // ==========================================================================
    // DERIVED DATA
    // ==========================================================================
    
    const categories = catTaskResult?.message?.categories || [];
    const allTasks = catTaskResult?.message?.tasks || [];
    const associatedPOs = selectedTaskDoc?.associated_pos || [];
    
    // POs from Task's associated_pos
    const taskPOs = dataV2Result?.message?.pos || [];
    const taskItems = dataV2Result?.message?.items || [];
    const hasTaskPOs = dataV2Result?.message?.has_pos || false;
    
    // All project POs
    const allProjectPOs = allPOsResult?.message?.pos || [];
    
    // Vendors
    const vendorOptions = (vendorsResult?.message || []).map((v: any) => ({
        label: v.vendor_name,
        value: v.name
    }));

    // ==========================================================================
    // EFFECTS
    // ==========================================================================
    
    // Fetch Categories/Tasks on mount
    useEffect(() => {
        fetchCategoriesAndTasks({ project: projectId });
    }, [projectId]);
    
    // Fetch POs/Items when Task is selected
    useEffect(() => {
        if (selectedTask && poMode === "existing") {
            fetchDataV2({
                project: projectId,
                task_id: selectedTask,
                search_type: searchMode
            });
        }
    }, [selectedTask, poMode, searchMode]);
    
    // Fetch all POs for modal
    useEffect(() => {
        if (showAllPOsModal) {
            fetchAllPOs({ project: projectId });
        }
    }, [showAllPOsModal]);
    
    // Fetch vendors on mount check
    useEffect(() => {
        fetchVendors();
    }, []);
    
    // Click outside to close dropdown
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target as Node)) {
                setDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // ==========================================================================
    // HANDLERS
    // ==========================================================================
    
    const handleCategoryChange = (category: string) => {
        setSelectedCategory(category);
    };
    
    const handleTaskChange = (taskId: string, taskDoc: Task | null) => {
        setSelectedTask(taskId);
        setSelectedTaskDoc(taskDoc);
        // Reset selections when task changes
        setSelectedPOs([]);
        setSelectedItems({});
        setReviewPlans([]);
        setFormStep("selection");
    };
    
    const handlePOModeChange = (mode: "existing" | "new") => {
        setPoMode(mode);
        setSelectedPOs([]);
        setSelectedItems({});
        setReviewPlans([]);
        setFormStep("selection");
    };
    
    const handleSearchModeChange = (mode: "po" | "item") => {
        setSearchMode(mode);
        setSelectedPOs([]);
        setSelectedItems({});
        // Re-fetch with new search type
        if (selectedTask) {
            fetchDataV2({
                project: projectId,
                task_id: selectedTask,
                search_type: mode
            });
        }
    };
    
    const handlePOSelect = (po: POItem) => {
        // Toggle PO selection? No, Single Select for Search Mode now.
        // But we keep this toggler for internal logic if needed, OR replace it.
        // User requested: "select only on po".
        
        setSelectedPOs([po]);
        // Auto-select ALL items for this PO
        const newSelectedItems: Record<string, any> = {};
        (po.items || []).forEach((item: any) => {
            newSelectedItems[item.name] = item;
        });
        setSelectedItems(newSelectedItems);
        setPoSearchInput(""); // Clear search
    };
    
    const unselectPO = () => {
        setSelectedPOs([]);
        setSelectedItems({});
    };
    
    const handleAllPOsConfirm = (pos: POItem[], modalSelectedItems: Record<string, Set<string>>) => {
        setSelectedPOs(pos);
        setShowAllPOsModal(false);

        // Sync Task Context from selected PO
        if (pos.length > 0) {
            const firstPO = pos[0];
            const assocTasks = firstPO.associated_tasks || [];
            
            // If PO has associated tasks, switch context to the first one
            if (assocTasks.length > 0) {
                const targetTaskName = assocTasks[0].task_name;
                
                // Only switch if different from current
                if (targetTaskName && targetTaskName !== selectedTask) {
                    const targetTaskDoc = allTasks.find((t: Task) => t.name === targetTaskName);
                    
                    if (targetTaskDoc) {
                        setSelectedTask(targetTaskName);
                        setSelectedTaskDoc(targetTaskDoc);
                        if (targetTaskDoc.critical_po_category) {
                            setSelectedCategory(targetTaskDoc.critical_po_category);
                        }
                        
                        toast({
                            title: "Plan Context Updated",
                            description: `Switched to ${targetTaskDoc.item_name} based on selected PO.`,
                            variant: "default"
                        });
                    }
                }
            }
        }
        
        // Count total items selected
        let totalItems = 0;
        Object.values(modalSelectedItems).forEach(set => totalItems += set.size);
        
        // Show confirmation toast
        toast({
            title: "POs Selected",
            description: `${pos.length} PO(s) with ${totalItems} items selected. Setting up review...`,
            variant: "default"
        });
        
        // Build plans for review using the modal's selected items
        const plans: POPlan[] = pos.map(po => {
            const assocTasks = po.associated_tasks || [];
            const isLocal = associatedPOs.includes(po.name);
            
            // Fallback context if no existing association
            const hasCategory = !!(selectedCategory || selectedTaskDoc?.critical_po_category);
            const hasFormContext = !!(hasCategory && selectedTaskDoc?.item_name);
            const isFallback = !assocTasks.length && !isLocal && hasFormContext;
            
            // Use the items selected in the modal
            const poItemsSet = modalSelectedItems[po.name] || new Set();

            return {
                poId: po.name,
                poName: po.name,
                items: po.items || [],
                selectedItems: poItemsSet,
                plannedDate: "",
                plannedAmount: undefined,
                plannedDate: "",
                plannedAmount: undefined,
                vendor: po.vendor,
                vendorName: po.vendor_name,
                isCritical: assocTasks.length > 0 || isLocal || isFallback,
                isCritical: assocTasks.length > 0 || isLocal || isFallback,
                category: assocTasks.length > 0 ? assocTasks[0].category : (isLocal || isFallback ? (selectedCategory || selectedTaskDoc?.critical_po_category) : undefined),
                task: assocTasks.length > 0 ? assocTasks[0].item_name : (isLocal || isFallback ? selectedTaskDoc?.item_name : undefined)
            };
        });
        setReviewPlans(plans);
        setFormStep("review");
    };
    
    const handleItemToggle = (item: any) => {
        const key = item.name;
        setSelectedItems(prev => {
            if (prev[key]) {
                const { [key]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [key]: item };
        });
    };
    
    const handleContinueToReview = () => {
        // Ensure all POs are loaded for the "Changes PO" feature in Review Page
        if (allProjectPOs.length === 0) {
            fetchAllPOs({ project: projectId });
        }

        if (searchMode === "po") {
            // PO Mode: Create plans from selected POs
            const plans: POPlan[] = selectedPOs.map(po => {
                const assocTasks = po.associated_tasks || [];
                const isLocal = associatedPOs.includes(po.name);
                
                const hasCategory = !!(selectedCategory || selectedTaskDoc?.critical_po_category);
                const hasFormContext = !!(hasCategory && selectedTaskDoc?.item_name);
                const isFallback = !assocTasks.length && !isLocal && hasFormContext;

                return {
                    poId: po.name,
                    poName: po.name,
                    items: po.items || [],
                    selectedItems: new Set(
                        (po.items || [])
                            .filter((i: any) => selectedItems[i.name])
                            .map((i: any) => i.name)
                    ),
                    plannedDate: "",
                    plannedAmount: undefined,
                    vendor: po.vendor,
                    vendorName: po.vendor_name,
                    isCritical: assocTasks.length > 0 || isLocal || isFallback,
                    category: assocTasks.length > 0 ? assocTasks[0].category : (isLocal || isFallback ? (selectedCategory || selectedTaskDoc?.critical_po_category) : undefined),
                    task: assocTasks.length > 0 ? assocTasks[0].item_name : (isLocal || isFallback ? selectedTaskDoc?.item_name : undefined)
                };
            });
            setReviewPlans(plans);
        } else {
            // Item Mode: Group items by PO
            const poGroups: Record<string, any[]> = {};
            Object.values(selectedItems).forEach((item: any) => {
                const poId = item.parent;
                if (poId) {
                    if (!poGroups[poId]) poGroups[poId] = [];
                    poGroups[poId].push(item);
                }
            });
            
            const plans: POPlan[] = Object.entries(poGroups).map(([poId, items]) => {
                const poDoc = allProjectPOs.find(p => p.name === poId);
                const assocTasks = poDoc?.associated_tasks || [];
                const isLocal = associatedPOs.includes(poId);
                
                const hasCategory = !!(selectedCategory || selectedTaskDoc?.critical_po_category);
                const hasFormContext = !!(hasCategory && selectedTaskDoc?.item_name);
                const isFallback = !assocTasks.length && !isLocal && hasFormContext;

                return {
                    poId,
                    poName: poId,
                    items,
                    selectedItems: new Set(items.map(i => i.name)),
                    plannedDate: "",
                    plannedAmount: undefined,
                    vendor: poDoc?.vendor,
                    vendorName: poDoc?.vendor_name,
                    isCritical: assocTasks.length > 0 || isLocal || isFallback,
                    category: assocTasks.length > 0 ? assocTasks[0].category : (isLocal || isFallback ? (selectedCategory || selectedTaskDoc?.critical_po_category) : undefined),
                    task: assocTasks.length > 0 ? assocTasks[0].item_name : (isLocal || isFallback ? selectedTaskDoc?.item_name : undefined)
                };
            });
            setReviewPlans(plans);
        }
        setFormStep("review");
    };
    
    const handleSubmitPlans = async () => {
        let successCount = 0;
        console.log("reviewPlans",reviewPlans)
        for (const plan of reviewPlans) {
            if (plan.selectedItems.size === 0 || !plan.plannedDate) continue;
            console.log("plan",plan)
            const items = plan.items.filter(item => plan.selectedItems.has(item.name));
            const minimalItems = items.map((item: any) => ({
                name: item.name,
                item_id: item.item_id || item.item_code,
                item_name: item.item_name,
                category: item.category
            }));
            
            try {
                await createDoc("Cashflow Plan", {
                    project: projectId,

                    id_link: plan.poName,
                    package_name: "", // V2: Not used
                    critical_po_category: plan.isCritical ? plan.category : null,
                    critical_po_task: plan.isCritical ? plan.task : null,
                    planned_date: plan.plannedDate,
                    planned_amount: plan.plannedAmount,
                    estimated_price: plan.estimatedPrice || 0,
                    vendor: plan.vendor,
                    type: "Existing PO",
                    items: JSON.stringify({ list: minimalItems })
                });
                successCount++;
            } catch (e) {
                console.error(`Failed to create plan for PO ${plan.poName}`, e);
            }
        }
        
        if (successCount > 0) {
            toast({
                title: "Success",
                description: `Successfully created ${successCount} Material Delivery Plan(s).`,
                variant: "default"
            });
            if (onSuccess) onSuccess();
            onClose();
        } else {
            toast({
                title: "Error",
                description: "Failed to create any plans. Please check your selections.",
                variant: "destructive"
            });
        }
    };
    
    const handleSubmitNewPO = async () => {
        if (!manualItemsText.trim()) {
            toast({
                title: "Missing Materials",
                description: "Review your fields! Please enter at least one material.",
                variant: "destructive"
            });
            return;
        }

        const items = manualItemsText.split('\n').filter(line => line.trim());
        const finalManualItems = items.map((itemName, idx) => ({
            name: `manual-${Date.now()}-${idx}`,
            item_name: itemName.trim(),
            item_id: `TEMP-${Date.now()}-${idx}`,
            category: ""
        }));

        // Validate Critical PO Category and Task for New PO
        if (!selectedCategory || !selectedTask) {
            toast({
                title: "Incomplete Selection",
                description: "Please select a Critical PO Category and Task.",
                variant: "destructive"
            });
            return;
        }

        if (!plannedDate) {
            toast({
                title: "Missing Planned Date",
                description: "Review your fields! Planned Date is mandatory.",
                variant: "destructive"
            });
            return;
        }

        if (!newPOVendor) {
            toast({
                title: "Missing Vendor",
                description: "Review your fields! Vendor selection is mandatory.",
                variant: "destructive"
            });
            return;
        }

        if (!newPOAmount || parseFloat(newPOAmount) <= 0) {
            toast({
                title: "Missing Planned Amount",
                description: "Review your fields! Planned Amount is mandatory and must be greater than 0.",
                variant: "destructive"
            });
            return;
        }

        if (!estimatedPrice || parseFloat(estimatedPrice) <= 0) {
            toast({
                title: "Missing Estimated Price",
                description: "Review your fields! Estimated Price is mandatory and must be greater than 0.",
                variant: "destructive"
            });
            return;
        }
        
        try {
            await createDoc("Cashflow Plan", {
                project: projectId,
                id_link: "",
                package_name: "",
                critical_po_category: selectedCategory || null,
                critical_po_task: selectedTaskDoc?.item_name || null,
                planned_date: plannedDate,
                planned_amount: parseFloat(newPOAmount),
                estimated_price: parseFloat(estimatedPrice),
                vendor: newPOVendor.value,
                type: "New PO",
                items: JSON.stringify({ list: finalManualItems })
            });
            toast({
                title: "Success",
                description: "Successfully created Material Plan (New PO).",
                variant: "default"
            });
            onSuccess();
            onClose();
        } catch (e) {
            console.error("Failed to create new PO plan", e);
            toast({
                title: "Error",
                description: "Failed to create plan.",
                variant: "destructive"
            });
        }
    };

    // ==========================================================================
    // VALIDATION
    // ==========================================================================
    
    const canContinueToReview = useMemo(() => {
        if (searchMode === "po") {
            // Require at least one PO and at least one item selected
            return selectedPOs.length > 0 && Object.keys(selectedItems).length > 0;
        } else {
            return Object.keys(selectedItems).length > 0;
        }
    }, [searchMode, selectedPOs, selectedItems]);

    // ==========================================================================
    // RENDER
    // ==========================================================================
    
    // Review Page
    if (formStep === "review") {
        return (
            <div className="border rounded-lg p-4 bg-white shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-semibold text-gray-800">Cashflow Plan #{planNumber}</h4>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <ReviewPOCashflowPage
                    plans={reviewPlans}
                    onPlansChange={setReviewPlans}
                    onSubmit={handleSubmitPlans}
                    onBack={() => setFormStep("selection")}
                    onCancel={onClose}
                    isSubmitting={isCreating}
                    categoryName={selectedCategory || selectedTaskDoc?.critical_po_category}
                    taskName={selectedTaskDoc?.item_name}
                    availablePOs={allProjectPOs}
                    associatedPOIds={associatedPOs}
                    allTasks={allTasks}
                />
            </div>
        );
    }

    return (
        <div className="border rounded-lg p-4 bg-white shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-gray-800">Cashflow Plan #{planNumber}</h4>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* Step 1: Category/Task Selection (V2) */}
            <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">Select Critical PO Task</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-blue-600 hover:text-blue-800"
                        onClick={() => {
                            fetchCategoriesAndTasks({ project: projectId });
                            fetchAllPOs({ project: projectId });
                            toast({
                                title: "Refreshing...",
                                description: "Fetching latest Categories & Tasks",
                                variant: "default"
                            });
                        }}
                        disabled={isLoadingCatTasks}
                    >
                        <RefreshCw className={`h-3 w-3 mr-1 ${isLoadingCatTasks ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
                <CategoryTaskSelector
                    categories={categories}
                    tasks={allTasks}
                    selectedCategory={selectedCategory}
                    selectedTask={selectedTask}
                    onCategoryChange={handleCategoryChange}
                    onTaskChange={handleTaskChange}
                    isLoading={isLoadingCatTasks}
                    required={poMode === "new"}
                />
            </div>


            {/* Step 2: PO Mode Selection - Shown only if Task is selected */}
            {selectedTask && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="mb-6">
                        <Label className="mb-2 block">PO Type</Label>
                        <RadioGroup 
                            value={poMode} 
                            onValueChange={(v) => handlePOModeChange(v as "existing" | "new")}
                            className="flex gap-4"
                        >
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="existing" id="existing" />
                                <Label htmlFor="existing" className="cursor-pointer">Existing PO</Label>
                            </div>
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="new" id="new" />
                                <Label htmlFor="new" className="cursor-pointer">New PO</Label>
                            </div>
                        </RadioGroup>
                    </div>

            {/* Existing PO Mode */}
            {poMode === "existing" && (
                <>
                    {/* Show Search Mode Toggle only if task has associated POs */}
                    {associatedPOs.length > 0 && (
                        <>
                            {/* Search & Selection Container - ERP Style Card */}
                            <div className="bg-white border rounded-lg p-3 md:p-4 mb-4 shadow-sm">
                                {/* Header Section */}
                                <div className="flex flex-col md:flex-row md:items-start justify-between gap-2 mb-4">
                                    <div className="space-y-1">
                                        <h3 className="text-sm font-semibold text-gray-900 leading-none">Search / Select Materials and PO ID</h3>
                                        <p className="text-xs text-gray-500 max-w-2xl">
                                            Materials you list must exist in the PO you link. A PO can only be linked if it contains those materials.
                                        </p>
                                    </div>
                                    <Button
                                        variant="link"
                                        size="sm"
                                        onClick={() => setShowAllPOsModal(true)}
                                        className="text-xs font-medium text-blue-600 h-auto p-0 whitespace-nowrap self-start md:self-auto"
                                    >
                                        See All POs
                                    </Button>
                                </div>

                                {/* Inputs Row - Single Row Layout */}
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

                                    {/* Search Input (Right - Expands) */}
                                    <div className="flex-1 min-w-0">
                                        {searchMode === "po" ? (
                                            <ReactSelect
                                                options={taskPOs.map(po => ({
                                                    label: po.name,
                                                    value: po.name,
                                                    original: po
                                                }))}
                                                value={selectedPOs.length > 0 ? {
                                                    label: selectedPOs[0].name,
                                                    value: selectedPOs[0].name,
                                                    original: selectedPOs[0]
                                                } : null}
                                                onChange={(option) => {
                                                    if (option) handlePOSelect(option.original);
                                                    else unselectPO();
                                                }}
                                                placeholder="Select PO (e.g. PO/2024/001)..."
                                                className="text-sm"
                                                styles={{
                                                    control: (base, state) => ({
                                                        ...base,
                                                        borderColor: state.isFocused ? "#3b82f6" : "#e5e7eb",
                                                        backgroundColor: "#ffffff",
                                                        borderRadius: "0.5rem",
                                                        minHeight: "40px",
                                                        height: "40px",
                                                        boxShadow: state.isFocused ? "0 0 0 1px #3b82f6" : "none",
                                                        "&:hover": { borderColor: "#cbd5e1" }
                                                    }),
                                                    menu: (base) => ({ ...base, zIndex: 50 }),
                                                    option: (base, state) => ({
                                                        ...base,
                                                        backgroundColor: state.isSelected ? "#eff6ff" : state.isFocused ? "#f8fafc" : "white",
                                                        color: state.isSelected ? "#1e40af" : "#1e293b",
                                                        fontSize: "0.875rem"
                                                    })
                                                }}
                                                formatOptionLabel={(option: any) => (
                                                    <div className="flex items-center justify-between">
                                                        <span>{option.label}</span>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs text-gray-500">
                                                                {option.original.items_count} items
                                                            </span>
                                                            {option.original.is_critical && (
                                                                <Badge className="bg-blue-500 text-[10px] py-0 h-5">Critical</Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                                isClearable
                                                isLoading={isLoadingDataV2}
                                            />
                                        ) : (
                                            <ReactSelect
                                                options={taskItems.map(item => ({
                                                    label: item.item_name,
                                                    value: item.name,
                                                    original: item
                                                }))}
                                                value={null}
                                                onChange={(option) => {
                                                    if (option) handleItemToggle(option.original);
                                                }}
                                                placeholder="Type to search items..."
                                                className="text-sm"
                                                styles={{
                                                    control: (base, state) => ({
                                                        ...base,
                                                        borderColor: state.isFocused ? "#3b82f6" : "#e5e7eb",
                                                        backgroundColor: "#ffffff",
                                                        borderRadius: "0.5rem",
                                                        minHeight: "40px",
                                                        height: "40px",
                                                        boxShadow: state.isFocused ? "0 0 0 1px #3b82f6" : "none",
                                                        "&:hover": { borderColor: "#cbd5e1" }
                                                    }),
                                                    menu: (base) => ({ ...base, zIndex: 50 }),
                                                    option: (base, state) => ({
                                                        ...base,
                                                        backgroundColor: state.isSelected ? "#eff6ff" : state.isFocused ? "#f8fafc" : "white",
                                                        color: state.isSelected ? "#1e40af" : "#1e293b",
                                                        fontSize: "0.875rem"
                                                    })
                                                }}
                                                formatOptionLabel={(option: any) => (
                                                    <div>
                                                        <div className="font-medium text-gray-800">{option.label}</div>
                                                        <div className="text-xs text-gray-500 flex gap-2">
                                                            <span>{option.original.parent}</span>
                                                            {option.original.selected && <span className="text-blue-500 font-bold">(Selected)</span>}
                                                        </div>
                                                    </div>
                                                )}
                                                isLoading={isLoadingDataV2}
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Selection Results Area (Full Width below inputs) */}
                            <div className="mb-4">
                                {/* Selected PO Detail View */}
                                {searchMode === "po" && selectedPOs.length > 0 && (
                                    <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                                        {selectedPOs.map((po) => (
                                            <div key={po.name} className="border rounded-lg bg-gray-50/50 overflow-hidden">
                                                <div className="flex items-center justify-between p-3 bg-white border-b">
                                                    <div className="flex items-center gap-2">
                                                        <Package className="h-4 w-4 text-blue-600" />
                                                        <span className="font-bold text-gray-800 text-sm">{po.name}</span>
                                                        {po.is_critical && <Badge className="bg-blue-500 text-[10px] h-5">Critical</Badge>}
                                                    </div>
                                                </div>
                                                
                                                {/* Item Selection for this PO */}
                                                <div className="p-3">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <Label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Select Items ({(po.items || []).filter((i: any) => selectedItems[i.name]).length}/{po.items?.length || 0})</Label>
                                                        <Button 
                                                            variant="ghost" 
                                                            size="sm" 
                                                            onClick={() => {
                                                                const allSelected = (po.items || []).every((i: any) => selectedItems[i.name]);
                                                                const newSelectedItems = { ...selectedItems };
                                                                
                                                                (po.items || []).forEach((item: any) => {
                                                                    if (allSelected) {
                                                                        delete newSelectedItems[item.name];
                                                                    } else {
                                                                        newSelectedItems[item.name] = item;
                                                                    }
                                                                });
                                                                setSelectedItems(newSelectedItems);
                                                            }}
                                                            className="h-6 text-[10px] px-2"
                                                        >
                                                            {(po.items || []).every((i: any) => selectedItems[i.name]) ? "Unselect All" : "Select All"}
                                                        </Button>
                                                    </div>
                                                    
                                                    <div className="border rounded-md bg-white max-h-[220px] overflow-y-auto shadow-sm">
                                                        {(po.items || []).map((item: any) => (
                                                            <div 
                                                                key={item.name}
                                                                className={`flex items-start gap-3 p-2.5 border-b last:border-b-0 cursor-pointer hover:bg-gray-50 transition-colors ${selectedItems[item.name] ? 'bg-blue-50/40' : ''}`}
                                                                onClick={() => handleItemToggle(item)}
                                                            >
                                                                <Checkbox 
                                                                    checked={!!selectedItems[item.name]}
                                                                    onCheckedChange={() => handleItemToggle(item)}
                                                                    className="mt-0.5"
                                                                />
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="font-medium text-sm text-gray-800 break-words">{item.item_name}</div>
                                                                    <div className="flex gap-2 items-center text-[10px] text-gray-400 mt-0.5">
                                                                        <span>{item.item_code}</span>
                                                                        {item.category && <span className="bg-gray-100 px-1 rounded">{item.category}</span>}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Selected Items Chips (Item Mode) */}
                                {searchMode === "item" && Object.keys(selectedItems).length > 0 && (
                                    <div className="mt-2">
                                        <Label className="mb-2 block text-xs font-semibold text-gray-500 uppercase tracking-wide">Selected ({Object.keys(selectedItems).length})</Label>
                                        <div className="flex flex-wrap gap-2">
                                            {Object.values(selectedItems).map((item: any) => (
                                                <Badge key={item.name} variant="secondary" className="gap-1 pl-2 pr-1 py-1 bg-white border shadow-sm">
                                                    <span className="truncate max-w-[200px]">{item.item_name}</span>
                                                    <div 
                                                        className="cursor-pointer hover:bg-gray-200 rounded-full p-0.5" 
                                                        onClick={() => handleItemToggle(item)}
                                                    >
                                                        <X className="h-3 w-3 text-gray-500" />
                                                    </div>
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                
                                {searchMode === "item" && Object.keys(selectedItems).length === 0 && (
                                    <div className="text-center py-6 text-gray-400 bg-gray-50/50 rounded-lg border border-dashed text-xs">
                                        Search and select items or POs above
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {/* Show fallback if no associated POs */}
                    {associatedPOs.length === 0 && (
                        <div className="mb-4">
                            <div className="text-center py-8 text-muted-foreground border rounded-md bg-muted/20">
                                <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
                                <p className="mb-4 font-medium">No associated POs found for this task.</p>
                                <Button
                                    variant="outline"
                                    onClick={() => setShowAllPOsModal(true)}
                                >
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    Browse All Project POs
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Continue Button */}
                    <div className="flex justify-end gap-2 mt-4">
                        <Button variant="outline" onClick={onClose}>Cancel</Button>
                        <Button 
                            onClick={handleContinueToReview}
                            disabled={!canContinueToReview}
                        >
                            Continue to Review
                        </Button>
                    </div>
                </>
            )}

                    {/* New PO Mode */}
                    {poMode === "new" && (
                        <>
                            <div className="mb-4">
                                <Label className="mb-2 block font-medium">Materials (one per line)</Label>
                                <Textarea
                                    placeholder="Steel Rods 12mm&#10;Cement 50kg&#10;Sand Fine"
                                    value={manualItemsText}
                                    onChange={(e) => setManualItemsText(e.target.value)}
                                    rows={5}
                                    className="bg-white"
                                />
                            </div>
                            
                            <div className="mb-4">
                                <Label className="mb-2 block font-medium">Vendor</Label>
                                <ReactSelect
                                    options={vendorOptions}
                                    value={newPOVendor}
                                    onChange={setNewPOVendor}
                                    placeholder="Select Vendor..."
                                    className="text-sm"
                                    isClearable
                                    isLoading={isLoadingVendors}
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-4 mb-4">
                                <div className="space-y-2">
                                    <Label className="block font-medium">Planned Date</Label>
                                    <input
                                        type="date"
                                        value={plannedDate}
                                        onChange={(e) => setplannedDate(e.target.value)}
                                        onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                                        className="w-full p-2 border rounded-md cursor-pointer text-sm h-[38px] bg-white"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="block font-medium">Planned Amount</Label>
                                    <Input
                                        type="number"
                                        placeholder="Enter Total Amount"
                                        value={newPOAmount}
                                        onChange={(e) => setNewPOAmount(e.target.value)}
                                        className="h-[38px] bg-white"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="block font-medium">Estimated Price</Label>
                                    <Input
                                        type="number"
                                        placeholder="Enter Price"
                                        value={estimatedPrice}
                                        onChange={(e) => setEstimatedPrice(e.target.value)}
                                        className="h-[38px] bg-white"
                                    />
                                </div>
                            </div>
                            
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={onClose}>Cancel</Button>
                                <Button onClick={handleSubmitNewPO} disabled={isCreating}>
                                    {isCreating ? "Creating..." : "Create Plan"}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* All POs Modal */}
            <AllPOsModal
                isOpen={showAllPOsModal}
                onClose={() => setShowAllPOsModal(false)}
                onConfirm={handleAllPOsConfirm}
                pos={allProjectPOs}
                associatedPOs={associatedPOs}
                isLoading={isLoadingAllPOs}
                currentCategory={selectedCategory}
                currentTask={selectedTaskDoc?.item_name}
            />
        </div>
    );
};

export default AddPOCashflowForm;
