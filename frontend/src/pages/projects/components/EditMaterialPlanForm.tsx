import React, { useState, useEffect } from "react";
import { X, Search, Calendar } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useFrappeGetDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { format } from "date-fns";

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

    // State
    const [deliveryDate, setDeliveryDate] = useState<string>(plan.delivery_date || "");
    // Map of item_name -> boolean (for selection)
    const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {};
        initialItems.forEach((i: any) => {
            initial[i.name] = true; // Use unique name (child table name from PO if possible, or item_name as fallback?)
            // WAIT: The plan stores COPIES of items. When we fetch the full PO, we need to match them.
            // The plan items have `name` which is the Row ID in the *Plan* (if created) or just data.
            // BUT we want to match against the *PO's* items. 
            // In `AddMaterialPlanForm`, we selected items from PO. 
            // Let's assume the plan stores the item `name` (the PO Item Row Name) as `name` or we match by `item_id`.
            // Looking at previous API response: The stored list has `name`. 
            // Ideally we match by the PO Item's `name` (ID).
        });
        return initial;
    });

    const [searchTerm, setSearchTerm] = useState("");
    // Fetch Full PO Data using standard Doc fetch
    const { data: poDoc, isLoading: isLoadingPO } = useFrappeGetDoc<any>(
        "Procurement Orders", 
        plan.po_link
    );
    
    // Derived PO Items
    const poItems = React.useMemo(() => {
        if (poDoc && Array.isArray(poDoc.items)) {
            return poDoc.items;
        }
        return [];
    }, [poDoc]);

    // Cleanup unnecessary effects and state
    // (removed fetchPO, poResult, useEffects, poItems state)

    // Toggle Selection
    const handleToggle = (itemName: string) => {
        setSelectedItems(prev => ({
            ...prev,
            [itemName]: !prev[itemName]
        }));
    };

    const handleSelectAll = () => {
        const all: Record<string, boolean> = {};
        filteredItems.forEach(i => all[i.name] = true);
        setSelectedItems(prev => ({ ...prev, ...all }));
    };

    const handleClearAll = () => {
        const cleared: Record<string, boolean> = {};
        filteredItems.forEach(i => cleared[i.name] = false);
        setSelectedItems(prev => ({ ...prev, ...cleared }));
    };

    // Filter items for search
    const filteredItems = poItems.filter(item => 
        item.item_name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const selectedCount = Object.values(selectedItems).filter(Boolean).length;
    const totalSelected = selectedCount;

    // Update Doc
    const { updateDoc, loading: isUpdating } = useFrappeUpdateDoc();

    const handleConfirm = async () => {
        if (!deliveryDate) {
            alert("Please select a delivery date");
            return;
        }
        if (selectedCount === 0) {
            alert("Please select at least one item");
            return;
        }

        // Prepare items list with minimal fields
        const itemsToSave = poItems
            .filter(item => selectedItems[item.name])
            .map(item => ({
                name: item.name,
                item_id: item.item_id,
                item_name: item.item_name,
                procurement_package: item.procurement_package,
                unit: item.unit,
                category: item.category,
                quantity: item.quantity
            }));

        try {
            await updateDoc("Material Delivery Plan", plan.name, {
                delivery_date: deliveryDate,
                mp_items: JSON.stringify({ list: itemsToSave })
            });
            onSuccess();
            onClose();
        } catch (e) {
            console.error("Failed to update plan", e);
            alert("Failed to update plan");
        }
    };

    // Calculate dates for visual confirmation or min/max?
    // User didn't specify constraints, so open.

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">Edit Materials - Plan {plan.idx || ""}</h2>
                        <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                            <span className="font-medium text-gray-700">{plan.package_name}</span>
                            <span className="border-l border-gray-300 pl-4">PO ID: {plan.po_link}</span>
                            <span className="border-l border-gray-300 pl-4">PO Type: Existing PO</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto space-y-6 flex-1">
                    
                    {/* Date Picker */}
                    <div className="space-y-2">
                        <Label className="flex items-center gap-2 font-bold text-gray-700">
                            <Calendar className="w-4 h-4" />
                            Delivery Date
                        </Label>
                        <input 
                            type="date" 
                            value={deliveryDate}
                            onChange={(e) => setDeliveryDate(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-4 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="text-xs text-gray-500">This delivery date will apply to all selected items in this plan</p>
                    </div>

                    <div className="h-px bg-gray-100" />

                    {/* Selection Header */}
                    <div className="space-y-4">
                        <div className="flex flex-col gap-1">
                            <h3 className="font-bold text-gray-800 text-md">
                                {selectedCount} of {poItems.length} items selected
                            </h3>
                            <p className="text-gray-500 text-sm">Select or de-select items to update this delivery plan</p>
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
                        </div>
                    </div>

                    {/* Items List */}
                    <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                        {isLoadingPO ? (
                            <div className="p-8 text-center text-gray-500">Loading items...</div>
                        ) : filteredItems.length === 0 ? (
                            <div className="p-8 text-center text-gray-500">No items found matching "{searchTerm}"</div>
                        ) : (
                            filteredItems.map((item) => (
                                <div 
                                    key={item.name} 
                                    className={`flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors ${selectedItems[item.name] ? 'bg-blue-50/30' : ''}`}
                                >
                                    <Checkbox 
                                        checked={!!selectedItems[item.name]}
                                        onCheckedChange={() => handleToggle(item.name)}
                                        id={`edit-item-${item.name}`}
                                    />
                                    <div className="flex-1 cursor-pointer" onClick={() => handleToggle(item.name)}>
                                        <label htmlFor={`edit-item-${item.name}`} className="font-medium text-gray-800 text-sm cursor-pointer block">
                                            {item.item_name}
                                        </label>
                                        <div className="flex gap-4 mt-1 text-xs text-gray-500">
                                            <span>Qty: {item.quantity} {item.unit}</span>
                                            {/* <span>Rate: ₹{item.rate}</span> */}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

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
                        disabled={isUpdating}
                        className="px-6 py-2 bg-red-600 rounded-lg text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                        {isUpdating ? "Updating..." : "Confirm"}
                    </button>
                </div>

            </div>
        </div>
    );
};
