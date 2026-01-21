import React, { useState, useEffect } from "react";
import { X, Search, Calendar, Trash2, Plus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useFrappeGetDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

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

    // State
    const [deliveryDate, setDeliveryDate] = useState<string>(plan.delivery_date || "");
    
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
    const { data: poDoc, isLoading: isLoadingPO } = useFrappeGetDoc<any>(
        "Procurement Orders", 
        !isNewPO ? plan.po_link : null
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
        filteredItems.forEach(i => all[i.name] = true);
        setSelectedItems(prev => ({ ...prev, ...all }));
    };

    const handleClearAll = () => {
        const cleared: Record<string, boolean> = {};
        filteredItems.forEach(i => cleared[i.name] = false);
        setSelectedItems(prev => ({ ...prev, ...cleared }));
    };

    // Filter items for search (Existing PO)
    const filteredItems = poItems.filter(item => 
        item.item_name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const selectedCount = Object.values(selectedItems).filter(Boolean).length;


    // Update Doc
    const { updateDoc, loading: isUpdating } = useFrappeUpdateDoc();

    const handleConfirm = async () => {
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
                .filter(item => selectedItems[item.name])
                .map(item => ({
                    name: item.name,
                    item_id: item.item_id,
                    item_name: item.item_name,
                    procurement_package: item.procurement_package,
                    // unit: item.unit,
                    category: item.category
                }));
        }

        try {
            await updateDoc("Material Delivery Plan", plan.name, {
                delivery_date: deliveryDate,
                mp_items: JSON.stringify({ list: itemsToSave })
            });
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
                    <div className="flex items-center justify-between w-full mb-1">
                        <h2 className="text-xl font-bold text-gray-900">Edit Materials- Plan {plan.idx || ""}</h2>
                        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full transition-colors">
                            <X className="w-5 h-5 text-gray-500" />
                        </button>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
                        {/* Category */}
                        <span className={`font-medium ${!plan.critical_po_category ? "text-red-500" : "text-gray-400"}`}>
                            {plan.critical_po_category || "Not Defined"}
                        </span>

                        <div className="h-5 w-[1px] bg-red-400/60 shrink-0"></div>

                        {/* Task */}
                        <span className={`font-medium ${!plan.critical_po_task ? "text-red-500" : "text-gray-400"}`}>
                            {plan.critical_po_task || "Not Defined"}
                        </span>

                        <div className="h-5 w-[1px] bg-red-400/60 shrink-0"></div>

                        {/* PO ID */}
                        <span className="text-gray-400 font-medium whitespace-nowrap">PO ID: {plan.po_link || "N/A"}</span>

                        <div className="h-5 w-[1px] bg-red-400/60 shrink-0"></div>

                        {/* PO Type */}
                        <span className="text-gray-400 font-medium whitespace-nowrap">PO Type: {plan.po_type || "--"}</span>
                    </div>
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

                    {isNewPO ? (
                        /* --- NEW PO EDIT INTERFACE --- */
                         <div className="space-y-2">
                            <Label className="text-xs font-bold text-gray-700">List Materials (One per line)</Label>
                            <textarea 
                                placeholder="Enter material names here..."
                                value={manualItemsText}
                                onChange={(e) => setManualItemsText(e.target.value)}
                                className="w-full h-48 p-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            />
                            <p className="text-[10px] text-gray-500">
                                Each line will be saved as a separate material item.
                            </p>
                        </div>
                    ) : (
                        /* --- EXISTING PO EDIT INTERFACE --- */
                        <>
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
