import React, { useState, useMemo } from "react";
import ReactSelect from 'react-select';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarIcon, X, Package, CheckCircle2, Pencil } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

interface POItem {
    name: string;
    item_name: string;
    quantity?: number;
    unit?: string;
    uom?: string;
    [key: string]: any;
    is_critical?: boolean;
    associated_tasks?: { task_name: string; item_name: string; category: string }[];
}

interface POPlan {
    poId: string;
    poName: string;
    items: POItem[];
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

interface ReviewPOCashflowPageProps {
    plans: POPlan[];
    onPlansChange: (plans: POPlan[]) => void;
    onSubmit: () => void;
    onBack: () => void;
    onCancel: () => void;
    isSubmitting?: boolean;
    categoryName?: string;
    taskName?: string;
    availablePOs?: POItem[];
    associatedPOIds?: string[];
    allTasks?: any[]; // Tasks list for editing
}

export const ReviewPOCashflowPage: React.FC<ReviewPOCashflowPageProps> = ({
    plans,
    onPlansChange,
    onSubmit,
    onBack,
    onCancel,
    isSubmitting = false,
    categoryName,
    taskName,
    availablePOs = [],
    associatedPOIds = [],
    allTasks = [],
}) => {
    // Generate options for ReactSelect
    const poOptions = useMemo(() => 
        availablePOs.map(po => ({
            value: po.name,
            label: po.name,
            original: po
        })), 
    [availablePOs]);

    // Handle PO Change
    const handlePOChange = (planIndex: number, selectedOption: any) => {
        if (!selectedOption) return;
        
        const newPO = selectedOption.original;
        const updatedPlans = [...plans];
        const assocTasks = newPO.associated_tasks || [];
        const isLocal = associatedPOIds.includes(newPO.name);
        
        // Fallback logic: if no intrinsic data, use form's selected category/task
        const hasFormContext = !!(categoryName && taskName);
        const isFallback = !assocTasks.length && !isLocal && hasFormContext;
        const isCritical = assocTasks.length > 0 || isLocal || isFallback;
        
        updatedPlans[planIndex] = {
            ...updatedPlans[planIndex],
            poId: newPO.name,
            poName: newPO.name,
            items: newPO.items || [],
            selectedItems: new Set(), // Reset selection as items changed
            isCritical: isCritical,
            category: assocTasks.length > 0 ? assocTasks[0].category : ((isLocal || isFallback) ? categoryName : undefined),
            task: assocTasks.length > 0 ? assocTasks[0].item_name : ((isLocal || isFallback) ? taskName : undefined)
        };
        
        onPlansChange(updatedPlans);
    };

    // Handle Task Change
    const handleTaskChange = (planIndex: number, option: any) => {
        if (!option) return;
        const updatedPlans = [...plans];
        updatedPlans[planIndex] = {
            ...updatedPlans[planIndex],
            task: option.value,
            category: option.category
        };
        onPlansChange(updatedPlans);
    };

    // Toggle item selection for a specific plan
    const toggleItemSelection = (planIndex: number, itemName: string) => {
        const updatedPlans = [...plans];
        const plan = updatedPlans[planIndex];
        const newSelectedItems = new Set(plan.selectedItems);
        
        if (newSelectedItems.has(itemName)) {
            newSelectedItems.delete(itemName);
        } else {
            newSelectedItems.add(itemName);
        }
        
        plan.selectedItems = newSelectedItems;
        onPlansChange(updatedPlans);
    };

    // Select all items for a plan
    const selectAllItems = (planIndex: number) => {
        const updatedPlans = [...plans];
        const plan = updatedPlans[planIndex];
        plan.selectedItems = new Set(plan.items.map((item) => item.name));
        onPlansChange(updatedPlans);
    };

    // Clear all items for a plan
    const clearAllItems = (planIndex: number) => {
        const updatedPlans = [...plans];
        const plan = updatedPlans[planIndex];
        plan.selectedItems = new Set();
        onPlansChange(updatedPlans);
    };

    // Update planned date for a plan
    const updatePlannedDate = (planIndex: number, date: Date | undefined) => {
        const updatedPlans = [...plans];
        updatedPlans[planIndex].plannedDate = date
            ? format(date, "yyyy-MM-dd")
            : "";
        onPlansChange(updatedPlans);
    };

    // Update planned amount for a plan
    const updatePlannedAmount = (planIndex: number, amount: string) => {
        const updatedPlans = [...plans];
        updatedPlans[planIndex].plannedAmount = amount ? parseFloat(amount) : undefined;
        onPlansChange(updatedPlans);
    };

    // Remove a plan
    const removePlan = (planIndex: number) => {
        const updatedPlans = plans.filter((_, index) => index !== planIndex);
        onPlansChange(updatedPlans);
    };

    // Check if all plans are valid
    const isValid = useMemo(() => {
        return plans.every(
            (plan) => plan.selectedItems.size > 0 && plan.plannedDate
        );
    }, [plans]);

    // Count total items and plans
    const totalItems = useMemo(() => {
        return plans.reduce((sum, plan) => sum + plan.selectedItems.size, 0);
    }, [plans]);

    // Bulk Actions State
    // const [bulkDate, setBulkDate] = useState<Date | undefined>();
    // const [bulkAmount, setBulkAmount] = useState<string>("");

    // Handle Bulk Apply
    // const handleBulkApply = () => {
    //     const updatedPlans = plans.map(plan => ({
    //         ...plan,
    //         plannedDate: bulkDate ? format(bulkDate, "yyyy-MM-dd") : plan.plannedDate,
    //         plannedAmount: bulkAmount ? parseFloat(bulkAmount) : plan.plannedAmount
    //     }));
    //     onPlansChange(updatedPlans);
    // };

    if (plans.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12">
                <Package className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No plans to review</p>
                <Button variant="outline" onClick={onBack} className="mt-4">
                    Go Back
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-4 border-b pb-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold">
                            Review Plans ({plans.length})
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            {totalItems} items selected across {plans.length} POs
                        </p>
                    </div>
                </div>
                
               
            </div>

            {/* Plans List */}
            <div className="space-y-4">
                {plans.map((plan, planIndex) => (
                    <Card key={plan.poId} className="relative">
                        {/* Remove Button */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 h-6 w-6"
                            onClick={() => removePlan(planIndex)}
                        >
                            <X className="h-4 w-4" />
                        </Button>

                        <CardHeader className="pb-2">
                            <CardTitle className="flex items-center gap-2 text-base w-full">
                                <span className="whitespace-nowrap">Plan {planIndex + 1}:</span>
                                <div className="w-[300px]" onClick={(e) => e.stopPropagation()}>
                                    <ReactSelect
                                        options={poOptions}
                                        value={{ value: plan.poId, label: plan.poName }}
                                        onChange={(option) => handlePOChange(planIndex, option)}
                                        menuPortalTarget={document.body}
                                        styles={{
                                            menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                                            // control: (base) => ({ ...base, height: '30px', minHeight: '30px' })
                                        }}
                                        className="text-sm font-normal"
                                    />
                                </div>
                            </CardTitle>
                            {(() => {
                                const currentPO = availablePOs.find(p => p.name === plan.poId);
                                const associatedTasks = currentPO?.associated_tasks || [];
                                
                                // Direct display if explicitly selected or only 1 option, BUT allow edit if multiple
                                if (associatedTasks.length > 0) {
                                    const taskOptions = associatedTasks.map(t => ({
                                        value: t.item_name,
                                        label: `${t.item_name} (${t.category})`,
                                        category: t.category
                                    }));
                                    
                                    // Check if editing mode
                                    const isEditingIntrinsic = (plan as any)._isEditingIntrinsic;
                                    const currentTask = taskOptions.find(o => o.value === plan.task);
                                    
                                    // Intrinsic PO Data - Green styling
                                    if (isEditingIntrinsic) {
                                        // Show dropdown when editing
                                        return (
                                            <div className="mt-2 flex items-center gap-2">
                                                <Badge className="bg-green-500 whitespace-nowrap text-xs">
                                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                                    Critical PO 
                                                    {/* (Intrinsic) */}
                                                </Badge>
                                                <div className="w-[350px]" onClick={e => e.stopPropagation()}>
                                                    <ReactSelect
                                                        options={taskOptions}
                                                        value={currentTask || null}
                                                        onChange={(opt) => {
                                                            handleTaskChange(planIndex, opt);
                                                            // Turn off edit mode
                                                            const updated = [...plans];
                                                            (updated[planIndex] as any)._isEditingIntrinsic = false;
                                                            onPlansChange(updated);
                                                        }}
                                                        placeholder="Select Critical Task..."
                                                        menuPortalTarget={document.body}
                                                        styles={{
                                                            menuPortal: (base: any) => ({ ...base, zIndex: 9999 }),
                                                            control: (base: any) => ({ 
                                                                ...base, 
                                                                minHeight: '30px', 
                                                                fontSize: '0.875rem',
                                                                borderColor: '#22c55e',
                                                                '&:hover': { borderColor: '#16a34a' }
                                                            }),
                                                            singleValue: (base: any) => ({
                                                                ...base,
                                                                color: '#16a34a',
                                                                fontWeight: 500
                                                            })
                                                        }}
                                                    />
                                                </div>
                                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => {
                                                    const updated = [...plans];
                                                    (updated[planIndex] as any)._isEditingIntrinsic = false;
                                                    onPlansChange(updated);
                                                }}>
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        );
                                    }
                                    
                                    // Show text with edit icon by default
                                    return (
                                        <div className="mt-2 flex items-center gap-2">
                                            <Badge className="bg-green-500 whitespace-nowrap text-xs">
                                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                                Critical PO 
                                                {/* (Intrinsic) */}
                                            </Badge>
                                            <p className="text-sm text-green-600 flex items-center gap-2 font-medium">
                                                <span>{currentTask?.category || plan.category}</span>
                                                <span className="text-green-300">|</span>
                                                <span>{currentTask?.value || plan.task}</span>
                                            </p>
                                            <Button 
                                                size="icon" 
                                                variant="ghost" 
                                                className="h-6 w-6 text-green-500 hover:text-green-700"
                                                onClick={() => {
                                                    const updated = [...plans];
                                                    (updated[planIndex] as any)._isEditingIntrinsic = true;
                                                    onPlansChange(updated);
                                                }}
                                            >
                                                <Pencil className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    );
                                }
                                
                                // Fallback / No associated tasks (Manual or Single from Global)
                                if (categoryName && taskName && plan.isCritical) {
                                     // Check if we are in editing mode for this specific plan
                                     const isEditing = (plan as any)._isEditing;

                                     if (isEditing) {
                                         // Show a full task selector here
                                         return (
                                            <div className="flex items-center gap-2 mt-2">
                                                <div className="w-[300px]" onClick={e => e.stopPropagation()}>
                                                    <ReactSelect
                                                            options={allTasks.map(t => ({
                                                                value: t.name,
                                                                label: `${t.item_name} (${t.critical_po_category})`,
                                                                category: t.critical_po_category,
                                                                // Store original task name as value if needed, but display item_name
                                                                original: t
                                                            }))}
                                                            value={
                                                                allTasks.find(t => t.item_name === plan.task) 
                                                                    ? { 
                                                                        value: allTasks.find(t => t.item_name === plan.task)?.name, 
                                                                        label: plan.task 
                                                                    } 
                                                                    : null
                                                            }
                                                            onChange={(opt: any) => {
                                                                if (opt) {
                                                                    const updated = [...plans];
                                                                    const planToUpdate = updated[planIndex];
                                                                    planToUpdate.task = opt.original.item_name;
                                                                    planToUpdate.category = opt.original.critical_po_category;
                                                                    (planToUpdate as any)._isEditing = false;
                                                                    onPlansChange(updated);
                                                                }
                                                            }}
                                                            menuPortalTarget={document.body}
                                                            styles={{
                                                                menuPortal: (base: any) => ({ ...base, zIndex: 9999 }),
                                                                control: (base: any) => ({ ...base, minHeight: '30px', fontSize: '0.875rem' })
                                                            }}
                                                    />
                                                </div>
                                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => {
                                                    const updated = [...plans];
                                                    (updated[planIndex] as any)._isEditing = false;
                                                    onPlansChange(updated);
                                                }}>
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                         );
                                     }

                                     return (
                                        <div className="flex items-center gap-2 mt-1">
                                            <Badge className="bg-red-500 whitespace-nowrap text-xs">
                                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                                Critical PO 
                                                {/* (Fallback) */}
                                            </Badge>
                                            <p className="text-sm text-red-600 flex items-center gap-2 font-medium">
                                                <span>{categoryName}</span>
                                                <span className="text-red-300">|</span>
                                                <span>{taskName}</span>
                                            </p>
                                            <Button 
                                                size="icon" 
                                                variant="ghost" 
                                                className="h-6 w-6 text-red-500 hover:text-red-700"
                                                onClick={() => {
                                                    const updated = [...plans];
                                                    (updated[planIndex] as any)._isEditing = true;
                                                    onPlansChange(updated);
                                                }}
                                            >
                                                <Pencil className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    );
                                }
                                
                                return null;
                            })()}
                        </CardHeader>

                        <CardContent className="space-y-4">
                            {/* Items Selection */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">
                                        Select Items ({plan.selectedItems.size}/{plan.items.length})
                                    </span>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => selectAllItems(planIndex)}
                                        >
                                            Select All
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => clearAllItems(planIndex)}
                                        >
                                            Clear
                                        </Button>
                                    </div>
                                </div>
                                <div className="border rounded-md max-h-[200px] overflow-y-auto">
                                    {plan.items.map((item) => (
                                        <div
                                            key={item.name}
                                            className={cn(
                                                "flex items-center gap-3 p-2 border-b last:border-b-0 cursor-pointer hover:bg-accent",
                                                plan.selectedItems.has(item.name) && "bg-accent"
                                            )}
                                            onClick={() =>
                                                toggleItemSelection(planIndex, item.name)
                                            }
                                        >
                                            <Checkbox
                                                checked={plan.selectedItems.has(item.name)}
                                                onClick={(e) => e.stopPropagation()}
                                                onCheckedChange={() =>
                                                    toggleItemSelection(planIndex, item.name)
                                                }
                                            />
                                            <span className="flex-1 truncate">
                                                {item.item_name}
                                            </span>
                                            {item.quantity && (
                                                <span className="text-sm text-muted-foreground">
                                                    {item.quantity} {item.unit || item.uom}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Planned Date and Amount */}
                            <div className="space-y-4 pt-4">
                                <div className="space-y-2">
                                     <span className="text-sm font-medium">Vendor</span>
                                     <Input
                                         value={plan.vendorName || plan.vendor || ""}
                                         disabled
                                         className="bg-gray-50 text-gray-500 w-full"
                                         placeholder="No Vendor Linked"
                                     />
                                </div>

                                <div className="flex gap-4">
                                    <div className="flex-1 space-y-2">
                                        <span className="text-sm font-medium">Planned Date</span>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    className={cn(
                                                        "w-full justify-start text-left font-normal",
                                                        !plan.plannedDate && "text-muted-foreground"
                                                    )}
                                                >
                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                    {plan.plannedDate
                                                        ? format(new Date(plan.plannedDate), "PPP")
                                                        : "Select date"}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar
                                                    mode="single"
                                                    selected={
                                                        plan.plannedDate
                                                            ? new Date(plan.plannedDate)
                                                            : undefined
                                                    }
                                                    onSelect={(date) =>
                                                        updatePlannedDate(planIndex, date)
                                                    }
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                    
                                    <div className="flex-1 space-y-2">
                                        <span className="text-sm font-medium">Planned Amount</span>
                                        <Input
                                            type="number"
                                            placeholder="Enter amount"
                                            value={plan.plannedAmount || ""}
                                            onChange={(e) => updatePlannedAmount(planIndex, e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between pt-4 border-t">
                <Button variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={onBack}>
                        ← Back to Selection
                    </Button>
                    <Button
                        onClick={onSubmit}
                        disabled={!isValid || isSubmitting}
                    >
                        {isSubmitting
                            ? "Submitting..."
                            : `Confirm All Plans (${plans.length})`}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ReviewPOCashflowPage;
