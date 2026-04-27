import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";

import { X, Search, Calendar, CheckCircle2, Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useProcurementOrderDoc } from "@/pages/projects/data/material-plan/useMaterialPlanQueries";
import { useUpdateMaterialDeliveryPlan } from "@/pages/projects/data/material-plan/useMaterialPlanMutations";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ADMIN_ROLE = "Nirmaan Admin Profile";
const PROCUREMENT_ROLE = "Nirmaan Procurement Executive Profile";
const DELIVERY_STATUS_AUTHORIZED_ROLES = [ADMIN_ROLE, PROCUREMENT_ROLE];

interface EditMaterialPlanFormProps {
    plan: any;
    onClose: () => void;
    onSuccess: () => void;
}

export const EditMaterialPlanForm = ({ plan, onClose, onSuccess }: EditMaterialPlanFormProps) => {
    
    // Parse existing items from plan
    const initialItems = React.useMemo(() => {
        try {
            const raw = plan.mp_items;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const list = parsed?.list || parsed;
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    }, [plan]);

    const isNewPO = plan.po_type === "New PO";
    const { toast } = useToast();
    const { role } = useUserData();
    const isAdmin = role === ADMIN_ROLE;
    const canEditDeliveryStatus = DELIVERY_STATUS_AUTHORIZED_ROLES.includes(role || "");
    // Admin can edit everything; Procurement can only change delivery_status.
    const canEditAll = isAdmin;

    // State
    const [deliveryDate, setDeliveryDate] = useState<string>(plan.delivery_date || "");
    const [deliveryStatus, setDeliveryStatus] = useState<"Delivered" | "Not Delivered">(
        plan.delivery_status === "Delivered" ? "Delivered" : "Not Delivered"
    );
    
    // --- Existing PO State ---
    // Map of item_name -> boolean (for selection)
    const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>(() => {
        if (isNewPO) return {}; 
        const initial: Record<string, boolean> = {};
        initialItems.forEach((i: any) => {
            initial[i.name] = true; 
        });
        return initial;
    });

    const [searchTerm, setSearchTerm] = useState("");
    // Fetch Full PO Data using standard Doc fetch (Only for Existing PO)
    const { data: poDoc, isLoading: isLoadingPO } = useProcurementOrderDoc(
        !isNewPO ? plan.po_link : null,
        !isNewPO
    );
    
    // Derived PO Items
    const poItems = React.useMemo(() => {
        if (poDoc && Array.isArray(poDoc.items)) {
            return poDoc.items;
        }
        return [];
    }, [poDoc]);

    // --- New PO State ---
    const [manualItemsText, setManualItemsText] = useState<string>(() => {
        if (!isNewPO) return "";
        return initialItems.map((i: any) => i.item_name).join("\n");
    });

    // Toggle Selection (Existing PO)
    const handleToggle = (itemName: string) => {
        setSelectedItems(prev => ({
            ...prev,
            [itemName]: !prev[itemName]
        }));
    };

    const handleSelectAll = () => {
        const all: Record<string, boolean> = {};
        filteredItems.forEach((i: any) => all[i.name] = true);
        setSelectedItems(prev => ({ ...prev, ...all }));
    };

    const handleClearAll = () => {
        const cleared: Record<string, boolean> = {};
        filteredItems.forEach((i: any) => cleared[i.name] = false);
        setSelectedItems(prev => ({ ...prev, ...cleared }));
    };

    // Filter items for search (Existing PO)
    const filteredItems = poItems.filter((item: any) => 
        item.item_name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const selectedCount = Object.values(selectedItems).filter(Boolean).length;


    // Update Doc
    const { updateMaterialPlan, loading: isUpdating } = useUpdateMaterialDeliveryPlan();

    // Validation — Admin must keep at least one item; Procurement is exempt (only updates status)
    const manualItemsCount = React.useMemo(
        () => manualItemsText.split('\n').map(l => l.trim()).filter(Boolean).length,
        [manualItemsText]
    );
    const itemsInvalid = canEditAll && (isNewPO ? manualItemsCount === 0 : selectedCount === 0);
    const isConfirmDisabled = isUpdating || itemsInvalid;

    const handleConfirm = async () => {
        // Procurement-only path: only delivery_status changes; skip all date/items validation.
        if (!canEditAll) {
            try {
                await updateMaterialPlan(plan.name, { delivery_status: deliveryStatus });
                toast({
                    title: "Success",
                    description: "Delivery status updated",
                    variant: "default",
                });
                onSuccess();
                onClose();
            } catch (e) {
                console.error("Failed to update delivery status", e);
                toast({
                    title: "Error",
                    description: "Failed to update delivery status. Please try again.",
                    variant: "destructive",
                });
            }
            return;
        }

        if (!deliveryDate) {
            toast({
                title: "Validation Error",
                description: "Please select a delivery date",
                variant: "destructive",
            });
            return;
        }

        let itemsToSave = [];

        if (isNewPO) {
             const lines = manualItemsText.split('\n').map(l => l.trim()).filter(Boolean);
             if (lines.length === 0) {
                 toast({
                    title: "Validation Error",
                    description: "Please enter at least one item (one per line).",
                    variant: "destructive",
                 });
                 return;
             }
             
             // Reconstruct items from lines. We use new IDs or try to preserve? 
             // Since it's text edit, preserving is hard/impossible if lines move. 
             // Just recreate.
             itemsToSave = lines.map((line, idx) => ({
                 name: `manual-${Date.now()}-${idx}`, // New temp names
                 item_name: line,
                 item_id: `TEMP-${Date.now()}-${idx}`,
                //  quantity: 0, // Default or ignored
                //  unit: "",
                 procurement_package: plan.package_name,
                 category: ""
             }));

        } else {
            if (selectedCount === 0) {
                toast({
                    title: "Validation Error",
                    description: "Please select at least one item",
                    variant: "destructive",
                });
                return;
            }
             // Prepare items list with minimal fields
            itemsToSave = poItems
                .filter((item: any) => selectedItems[item.name])
                .map((item: any) => ({
                    name: item.name,
                    item_id: item.item_id,
                    item_name: item.item_name,
                    procurement_package: item.procurement_package,
                    // unit: item.unit,
                    category: item.category
                }));
        }

        try {
            const updatePayload: any = {
                delivery_date: deliveryDate,
                mp_items: JSON.stringify({ list: itemsToSave })
            };
            // Only authorized roles can change delivery_status; others' value is ignored server-side anyway
            if (canEditDeliveryStatus) {
                updatePayload.delivery_status = deliveryStatus;
            }
            await updateMaterialPlan(plan.name, updatePayload);
            toast({
                title: "Success",
                description: "Material plan updated successfully",
                variant: "default", // or "success" if you have it configured
            });
            onSuccess();
            onClose();
        } catch (e) {
            console.error("Failed to update plan", e);
            toast({
                title: "Error",
                description: "Failed to update plan. Please try again.",
                variant: "destructive",
            });
        }
    };
    
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="flex flex-col px-6 py-4 border-b border-gray-100">
                    <div className="flex items-center justify-between w-full mb-3">
                        <h2 className="text-xl font-bold text-gray-900">Edit Materials - Plan {plan.idx || ""}</h2>
                        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full transition-colors">
                            <X className="w-5 h-5 text-gray-500" />
                        </button>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Category */}
                        <Badge variant="secondary" className={`${!plan.critical_po_category ? "bg-red-50 text-red-600 border-red-100" : "bg-rose-50 text-rose-700 border-rose-100 hover:bg-rose-100"}`}>
                            {plan.critical_po_category || "Category Undefined"}
                        </Badge>

                        {/* Sub Category - NEW */}
                        {plan.critical_po_sub_category && (
                             <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-100 hover:bg-orange-100">
                                {plan.critical_po_sub_category}
                            </Badge>
                        )}

                        {/* Task */}
                        <Badge variant="secondary" className={`${!plan.critical_po_task ? "bg-red-50 text-red-600 border-red-100" : "bg-red-50 text-red-700 border-red-100 hover:bg-red-100"}`}>
                            {plan.critical_po_task || "Task Undefined"}
                        </Badge>
                        
                        <div className="h-4 w-[1px] bg-gray-200 mx-1 hidden sm:block"></div>

                        {/* PO ID */}
                        <Badge variant="outline" className="text-gray-500 font-medium whitespace-nowrap border-gray-200">
                             PO: {plan.po_link || "N/A"}
                        </Badge>

                        {/* PO Type */}
                        <Badge variant="outline" className="text-gray-500 font-medium whitespace-nowrap border-gray-200">
                            {plan.po_type || "--"}
                        </Badge>
                    </div>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto space-y-6 flex-1">

                    {/* Date Picker — Admin only */}
                    <div className="space-y-2">
                        <Label className="flex items-center gap-2 font-bold text-gray-700">
                            <Calendar className="w-4 h-4" />
                            Delivery Date
                            {!canEditAll && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                                    <Lock className="w-3 h-3" /> Read-only
                                </span>
                            )}
                        </Label>
                        <input
                            type="date"
                            value={deliveryDate}
                            onChange={(e) => setDeliveryDate(e.target.value)}
                            onClick={(e) => canEditAll && (e.target as HTMLInputElement).showPicker?.()}
                            min={new Date().toISOString().split('T')[0]} // Restrict to future dates
                            disabled={!canEditAll}
                            className={`w-full p-2 border rounded-md ${canEditAll ? "cursor-pointer" : "cursor-not-allowed bg-gray-50 text-gray-500"}`}
                        />
                        <p className="text-xs text-gray-500">This delivery date will apply to all selected items in this plan</p>
                    </div>

                    {/* Delivery Status — select dropdown (role-gated) */}
                    <div className="space-y-2">
                        <Label className="flex items-center gap-2 font-bold text-gray-700">
                            <CheckCircle2 className="w-4 h-4" />
                            Delivery Status
                            {!canEditDeliveryStatus && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                                    <Lock className="w-3 h-3" /> Read-only
                                </span>
                            )}
                        </Label>
                        <Select
                            value={deliveryStatus}
                            onValueChange={(v) => setDeliveryStatus(v as "Delivered" | "Not Delivered")}
                            disabled={!canEditDeliveryStatus}
                        >
                            <SelectTrigger className="w-full h-10">
                                <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Not Delivered">
                                    <span className="inline-flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-red-500" />
                                        Not Delivered
                                    </span>
                                </SelectItem>
                                <SelectItem value="Delivered">
                                    <span className="inline-flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                        Delivered
                                    </span>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-gray-500">
                            {canEditDeliveryStatus
                                ? "Mark whether the materials in this plan have been delivered to site."
                                : "Only Admin and Procurement Executives can change delivery status."}
                        </p>
                    </div>

                    <div className="h-px bg-gray-100" />

                    {isNewPO ? (
                        /* --- NEW PO EDIT INTERFACE — Admin only --- */
                         <div className="space-y-2">
                            <Label className="flex items-center gap-2 text-xs font-bold text-gray-700">
                                List Materials (One per line)
                                {!canEditAll && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                                        <Lock className="w-3 h-3" /> Read-only
                                    </span>
                                )}
                            </Label>
                            <textarea
                                placeholder="Enter material names here..."
                                value={manualItemsText}
                                onChange={(e) => setManualItemsText(e.target.value)}
                                disabled={!canEditAll}
                                className={`w-full h-48 p-3 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
                                    !canEditAll
                                        ? "bg-gray-50 text-gray-500 cursor-not-allowed border-gray-300"
                                        : itemsInvalid
                                            ? "border-red-300 focus:ring-red-500"
                                            : "border-gray-300"
                                }`}
                            />
                            {canEditAll && itemsInvalid ? (
                                <p className="text-[11px] text-red-600 font-medium">
                                    Please enter at least one material (one per line).
                                </p>
                            ) : (
                                <p className="text-[10px] text-gray-500">
                                    Each line will be saved as a separate material item.
                                </p>
                            )}
                        </div>
                    ) : (
                        /* --- EXISTING PO EDIT INTERFACE --- */
                        <>
                            <div className="space-y-4">
                                <div className="flex flex-col gap-1">
                                    <h3 className="flex items-center gap-2 font-bold text-gray-800 text-md">
                                        {selectedCount} of {poItems.length} items selected
                                        {!canEditAll && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                                                <Lock className="w-3 h-3" /> Read-only
                                            </span>
                                        )}
                                    </h3>
                                    <p className={`text-sm ${canEditAll && itemsInvalid ? "text-red-600 font-medium" : "text-gray-500"}`}>
                                        {canEditAll
                                            ? itemsInvalid
                                                ? "At least one item must be selected before saving."
                                                : "Select or de-select items to update this delivery plan"
                                            : "Items are read-only. Only Admin can change items; you can update the delivery status above."}
                                    </p>
                                </div>

                                <div className="flex gap-3">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                        <input
                                            type="text"
                                            placeholder="Search Items in PO"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                    {canEditAll && (
                                        <>
                                            <button
                                                onClick={handleSelectAll}
                                                className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                                            >
                                                Select All
                                            </button>
                                            <button
                                                onClick={handleClearAll}
                                                className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                                            >
                                                Clear All
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Items List */}
                            <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                                {isLoadingPO ? (
                                    <div className="p-8 text-center text-gray-500">Loading items...</div>
                                ) : filteredItems.length === 0 ? (
                                    <div className="p-8 text-center text-gray-500">No items found matching "{searchTerm}"</div>
                                ) : (
                                    filteredItems.map((item: any) => (
                                        <div
                                            key={item.name}
                                            className={`flex items-center gap-4 p-4 transition-colors ${canEditAll ? "hover:bg-gray-50" : ""} ${selectedItems[item.name] ? 'bg-blue-50/30' : ''}`}
                                        >
                                            <Checkbox
                                                checked={!!selectedItems[item.name]}
                                                onCheckedChange={() => canEditAll && handleToggle(item.name)}
                                                disabled={!canEditAll}
                                                id={`edit-item-${item.name}`}
                                            />
                                            <div
                                                className={`flex-1 ${canEditAll ? "cursor-pointer" : ""}`}
                                                onClick={() => canEditAll && handleToggle(item.name)}
                                            >
                                                <label htmlFor={`edit-item-${item.name}`} className={`font-medium text-gray-800 text-sm block ${canEditAll ? "cursor-pointer" : ""}`}>
                                                    {item.item_name}
                                                </label>
                                                <div className="flex gap-4 mt-1 text-xs text-gray-500">
                                                    {/* <span>Qty: {item.quantity} {item.unit}</span> */}
                                                    {/* <span>Rate: ₹{item.rate}</span> */}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </>
                    )}

                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                    <button 
                        onClick={onClose}
                        disabled={isUpdating}
                        className="px-6 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isConfirmDisabled}
                        title={itemsInvalid ? (isNewPO ? "Add at least one material line" : "Select at least one item") : undefined}
                        className="px-6 py-2 bg-red-600 rounded-lg text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed disabled:hover:bg-gray-300"
                    >
                        {isUpdating ? "Updating..." : "Confirm"}
                    </button>
                </div>

            </div>
        </div>
    );
};
