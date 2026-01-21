import React, { useState, useEffect, useMemo, useRef } from "react";
import { X, ChevronDown, Check, ChevronsUpDown, PlusCircleIcon, Search, Package, ExternalLink } from "lucide-react";
import ReactSelect from 'react-select';
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup"; 
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

import { useFrappePostCall, useFrappeCreateDoc } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { CategoryTaskSelector } from "./CategoryTaskSelector";
import { AllPOsModal } from "./AllPOsModal";
import { ReviewPlansPage } from "./ReviewPlansPage";

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
    item_name: string;
    items_count?: number;
    creation?: string;
    status?: string;
    work_package?: string;
    items?: any[];
    is_critical?: boolean;
    associated_tasks?: { task_name: string; item_name: string; category: string }[];
    [key: string]: any;
}

interface POPlan {
    poId: string;
    poName: string;
    items: any[];
    selectedItems: Set<string>;
    deliveryDate: string;
    isCritical: boolean;
    category?: string;
    task?: string;
}

interface SearchItem {
    name: string;
    item_name: string;
    parent?: string;
    [key: string]: any;
    is_critical?: boolean;
}

interface AddMaterialPlanFormProps {
    planNumber: number;
    projectId: string;
    projectPackages: string[]; // Kept for backward compatibility but not used in V2
    onClose: () => void;
}

export const AddMaterialPlanForm = ({ planNumber, projectId, projectPackages, onClose }: AddMaterialPlanFormProps) => {
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
    const [deliveryDate, setDeliveryDate] = useState<string>("");
    
    // Item Search State
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
        // Toggle PO selection
        const isSelected = selectedPOs.some(p => p.name === po.name);
        if (isSelected) {
            setSelectedPOs(prev => prev.filter(p => p.name !== po.name));
        } else {
            setSelectedPOs(prev => [...prev, po]);
        }
    };
    
    const handleAllPOsConfirm = (pos: POItem[]) => {
        setSelectedPOs(pos);
        setShowAllPOsModal(false);
        
        // Show confirmation toast
        toast({
            title: "POs Selected",
            description: `${pos.length} PO(s) selected. Setting up review...`,
            variant: "default"
        });
        
        // Build plans for review with all items pre-selected
        const plans: POPlan[] = pos.map(po => {
            const assocTasks = po.associated_tasks || [];
            const isLocal = associatedPOs.includes(po.name);
            return {
                poId: po.name,
                poName: po.name,
                items: po.items || [],
                selectedItems: new Set((po.items || []).map((i: any) => i.name)),
                deliveryDate: "",
                isCritical: assocTasks.length > 0 || isLocal,
                category: assocTasks.length > 0 ? assocTasks[0].category : (isLocal ? selectedCategory : undefined),
                task: assocTasks.length > 0 ? assocTasks[0].item_name : (isLocal ? selectedTaskDoc?.item_name : undefined)
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
                return {
                    poId: po.name,
                    poName: po.name,
                    items: po.items || [],
                    selectedItems: new Set((po.items || []).map((i: any) => i.name)),
                    deliveryDate: "",
                    isCritical: assocTasks.length > 0 || isLocal,
                    category: assocTasks.length > 0 ? assocTasks[0].category : (isLocal ? selectedCategory : undefined),
                    task: assocTasks.length > 0 ? assocTasks[0].item_name : (isLocal ? selectedTaskDoc?.item_name : undefined)
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
                
                return {
                    poId,
                    poName: poId,
                    items,
                    selectedItems: new Set(items.map(i => i.name)),
                    deliveryDate: "",
                    isCritical: assocTasks.length > 0 || isLocal,
                    category: assocTasks.length > 0 ? assocTasks[0].category : (isLocal ? selectedCategory : undefined),
                    task: assocTasks.length > 0 ? assocTasks[0].item_name : (isLocal ? selectedTaskDoc?.item_name : undefined)
                };
            });
            setReviewPlans(plans);
        }
        setFormStep("review");
    };
    
    const handleSubmitPlans = async () => {
        let successCount = 0;
        
        for (const plan of reviewPlans) {
            if (plan.selectedItems.size === 0 || !plan.deliveryDate) continue;
            
            const items = plan.items.filter(item => plan.selectedItems.has(item.name));
            const minimalItems = items.map((item: any) => ({
                name: item.name,
                item_id: item.item_id || item.item_code,
                item_name: item.item_name,
                category: item.category
            }));
            
            try {
                await createDoc("Material Delivery Plan", {
                    project: projectId,
                    po_link: plan.poName,
                    package_name: "", // V2: Not used
                    critical_po_category: plan.isCritical ? plan.category : null,
                    critical_po_task: plan.isCritical ? plan.task : null,
                    delivery_date: plan.deliveryDate,
                    po_type: "Existing PO",
                    mp_items: JSON.stringify({ list: minimalItems })
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
                title: "No Materials",
                description: "Please enter at least one material.",
                variant: "destructive"
            });
            return;
        }
        if (!deliveryDate) {
            toast({
                title: "Missing Delivery Date",
                description: "Please select a Delivery Date",
                variant: "destructive"
            });
            return;
        }
        
        const lines = manualItemsText.split('\n').map(l => l.trim()).filter(Boolean);
        const manualItems = lines.map((line, idx) => ({
            name: `manual-${Date.now()}-${idx}`,
            item_name: line,
            item_id: `TEMP-${Date.now()}-${idx}`,
            category: ""
        }));
        
        try {
            await createDoc("Material Delivery Plan", {
                project: projectId,
                po_link: "",
                package_name: "",
                critical_po_category: selectedCategory || null,
                critical_po_task: selectedTaskDoc?.item_name || null,
                delivery_date: deliveryDate,
                po_type: "New PO",
                mp_items: JSON.stringify({ list: manualItems })
            });
            toast({
                title: "Success",
                description: "Successfully created Material Plan (New PO).",
                variant: "default"
            });
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
            return selectedPOs.length > 0;
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
                    <h4 className="font-semibold text-gray-800">Material Plan #{planNumber}</h4>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <ReviewPlansPage
                    plans={reviewPlans}
                    onPlansChange={setReviewPlans}
                    onSubmit={handleSubmitPlans}
                    onBack={() => setFormStep("selection")}
                    onCancel={onClose}
                    isSubmitting={isCreating}
                    categoryName={selectedCategory}
                    taskName={selectedTaskDoc?.item_name}
                    availablePOs={allProjectPOs}
                    associatedPOIds={associatedPOs}
                />
            </div>
        );
    }

    return (
        <div className="border rounded-lg p-4 bg-white shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-gray-800">Material Plan #{planNumber}</h4>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* Step 1: Category/Task Selection (V2) */}
            <div className="mb-6">
                <CategoryTaskSelector
                    categories={categories}
                    tasks={allTasks}
                    selectedCategory={selectedCategory}
                    selectedTask={selectedTask}
                    onCategoryChange={handleCategoryChange}
                    onTaskChange={handleTaskChange}
                    isLoading={isLoadingCatTasks}
                />
            </div>

            {/* Step 2: PO Mode Selection */}
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
                            {/* Search Mode Toggle */}
                            <div className="mb-4">
                                <Label className="mb-2 block">Search By</Label>
                                <div className="flex gap-2">
                                    <Button
                                        variant={searchMode === "po" ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => handleSearchModeChange("po")}
                                    >
                                        PO ID
                                    </Button>
                                    <Button
                                        variant={searchMode === "item" ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => handleSearchModeChange("item")}
                                    >
                                        Items in POs
                                    </Button>
                                </div>
                            </div>

                            {/* PO ID Mode */}
                            {searchMode === "po" && (
                                <div className="mb-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <Label>Select POs</Label>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setShowAllPOsModal(true)}
                                            className="text-xs"
                                        >
                                            <ExternalLink className="h-3 w-3 mr-1" />
                                            See All POs
                                        </Button>
                                    </div>
                                    
                                    {isLoadingDataV2 ? (
                                        <div className="space-y-2">
                                            <Skeleton className="h-10 w-full" />
                                            <Skeleton className="h-10 w-full" />
                                        </div>
                                    ) : (
                                        <div className="border rounded-md max-h-[200px] overflow-y-auto">
                                            {taskPOs.map((po: POItem) => (
                                                <div
                                                    key={po.name}
                                                    className={`flex items-center gap-3 p-3 border-b last:border-b-0 cursor-pointer hover:bg-accent ${
                                                        selectedPOs.some(p => p.name === po.name) ? "bg-accent" : ""
                                                    }`}
                                                    onClick={() => handlePOSelect(po)}
                                                >
                                                    <Checkbox
                                                        checked={selectedPOs.some(p => p.name === po.name)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onCheckedChange={() => handlePOSelect(po)}
                                                    />
                                                    <div className="flex-1">
                                                        <span className="font-medium">{po.name}</span>
                                                        <span className="text-sm text-muted-foreground ml-2">
                                                            ({po.items_count} items)
                                                        </span>
                                                    </div>
                                                    {po.is_critical && (
                                                        <Badge className="bg-blue-500">Critical</Badge>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    
                                    {selectedPOs.length > 0 && (
                                        <div className="mt-2 text-sm text-muted-foreground">
                                            {selectedPOs.length} PO(s) selected
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Items in POs Mode */}
                            {searchMode === "item" && (
                        <div className="mb-4" ref={searchWrapperRef}>
                            <Label className="mb-2 block">Search Items</Label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Search items..."
                                    value={itemSearchInput}
                                    onChange={(e) => {
                                        setItemSearchInput(e.target.value);
                                        setDropdownOpen(true);
                                    }}
                                    onFocus={() => setDropdownOpen(true)}
                                    className="w-full pl-9 pr-4 py-2 border rounded-md"
                                />
                            </div>
                            
                            {isDropdownOpen && (
                                <div className="border rounded-md mt-1 max-h-[200px] overflow-y-auto bg-white shadow-lg">
                                    {isLoadingDataV2 ? (
                                        <div className="p-4 text-center text-muted-foreground">Loading...</div>
                                    ) : taskItems.length === 0 ? (
                                        <div className="p-4 text-center text-muted-foreground">No items found</div>
                                    ) : (
                                        taskItems
                                            .filter((item: any) => 
                                                !itemSearchInput || 
                                                item.item_name?.toLowerCase().includes(itemSearchInput.toLowerCase())
                                            )
                                            .slice(0, 50)
                                            .map((item: any) => (
                                                <div
                                                    key={item.name}
                                                    className={`flex items-center gap-3 p-2 border-b last:border-b-0 cursor-pointer hover:bg-accent ${
                                                        selectedItems[item.name] ? "bg-accent" : ""
                                                    }`}
                                                    onClick={() => handleItemToggle(item)}
                                                >
                                                    <Checkbox checked={!!selectedItems[item.name]} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="truncate">{item.item_name}</div>
                                                        <div className="text-xs text-muted-foreground">{item.parent}</div>
                                                    </div>
                                                </div>
                                            ))
                                    )}
                                </div>
                            )}
                            
                            {Object.keys(selectedItems).length > 0 && (
                                <div className="mt-3">
                                    <Label className="mb-2 block">Selected Items ({Object.keys(selectedItems).length})</Label>
                                    <div className="flex flex-wrap gap-2">
                                        {Object.values(selectedItems).map((item: any) => (
                                            <Badge key={item.name} variant="secondary" className="gap-1">
                                                {item.item_name}
                                                <X 
                                                    className="h-3 w-3 cursor-pointer" 
                                                    onClick={() => handleItemToggle(item)}
                                                />
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                            )}
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
                        <Label className="mb-2 block">Enter Materials (one per line)</Label>
                        <Textarea
                            placeholder="Steel Rods 12mm&#10;Cement 50kg&#10;Sand Fine"
                            value={manualItemsText}
                            onChange={(e) => setManualItemsText(e.target.value)}
                            rows={5}
                        />
                    </div>
                    
                    <div className="mb-4">
                        <Label className="mb-2 block">Delivery Date</Label>
                        <input
                            type="date"
                            value={deliveryDate}
                            onChange={(e) => setDeliveryDate(e.target.value)}
                            className="w-full p-2 border rounded-md"
                        />
                    </div>
                    
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={onClose}>Cancel</Button>
                        <Button onClick={handleSubmitNewPO} disabled={isCreating}>
                            {isCreating ? "Creating..." : "Create Plan"}
                        </Button>
                    </div>
                </>
            )}

            {/* All POs Modal */}
            <AllPOsModal
                isOpen={showAllPOsModal}
                onClose={() => setShowAllPOsModal(false)}
                onConfirm={handleAllPOsConfirm}
                pos={allProjectPOs}
                associatedPOs={associatedPOs}
                isLoading={isLoadingAllPOs}
            />
        </div>
    );
};

export default AddMaterialPlanForm;
