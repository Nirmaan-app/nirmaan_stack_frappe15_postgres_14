import React, { useState, useEffect } from "react";
import { X, ChevronDown } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup"; 
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useFrappePostCall, useFrappeCreateDoc } from "frappe-react-sdk";

interface AddMaterialPlanFormProps {
    planNumber: number;
    projectId: string;
    projectPackages: string[];
    onClose: () => void;
}

export const AddMaterialPlanForm = ({ planNumber, projectId, projectPackages, onClose }: AddMaterialPlanFormProps) => {
    // State for form
    const [poMode, setPoMode] = useState<"existing" | "new" | undefined>(undefined);
    const [selectedPackage, setSelectedPackage] = useState<string>("");
    const [selectedPO, setSelectedPO] = useState<string>("");
    
    // We store the full PO object (with items) here to avoid re-fetching
    const [poDataMap, setPoDataMap] = useState<Record<string, any>>({});
    
    const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
    const [deliveryDate, setDeliveryDate] = useState<string>("");

    // 2. Fetch Procurement Orders filtered by package using POST
    const { call: fetchPOs, result: poResult, loading: isLoadingPOs } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_material_plan_data"
    );

    // 3. Trigger Fetch & Reset Logic: When Package or Mode Changes
    useEffect(() => {
        if (selectedPackage) {
            setSelectedPO("");
            setSelectedItems({});
            
            // Only call API if mode is 'existing'
            if (poMode === 'existing') {
                 setPoDataMap({}); // Clear old data
                 // Call API
                 fetchPOs({ 
                    project: projectId,
                    procurement_package: selectedPackage,
                    mode: "list"
                 });
            }
        }
    }, [selectedPackage, poMode]);

    // Update local map when result arrives
    useEffect(() => {
        if (poResult?.message && Array.isArray(poResult.message)) {
            const newMap: Record<string, any> = {};
            poResult.message.forEach((po: any) => {
                newMap[po.name] = po;
            });
            setPoDataMap(newMap);
        }
    }, [poResult]);

    // 4. Reset Logic: When PO Changes (or Mode changes)
    useEffect(() => {
        // If PO changes, reset items
        setSelectedItems({});
    }, [selectedPO]);

    // 5. Get Full PO Details from local map (no extra API call needed!)
    const fullPO = selectedPO ? poDataMap[selectedPO] : null;

    const handleItemToggle = (itemName: string) => {
        setSelectedItems(prev => ({
            ...prev,
            [itemName]: !prev[itemName]
        }));
    };

    // Create Material Delivery Plan
    const { createDoc, loading: isCreating } = useFrappeCreateDoc();

    const handleConfirm = async () => {
        if (!processDelivery()) return;
    };

    const processDelivery = async () => {
        if (!selectedPackage || !selectedPO || !deliveryDate) {
            alert("Please select Package, PO and Delivery Date");
            return false;
        }

        const itemsToPlan = fullPO?.items?.filter((item: any) => selectedItems[item.name]) || [];
        
        if (itemsToPlan.length === 0) {
            alert("Please select at least one item from the PO");
            return false;
        }

        try {
            // Filter item fields to save space
            const minimalItems = itemsToPlan.map((item: any) => ({
                name: item.name,
                item_id: item.item_id,
                item_name: item.item_name,
                procurement_package: item.procurement_package,
                unit: item.unit,
                category: item.category,
                quantity: item.quantity
            }));

            await createDoc("Material Delivery Plan", {
                project: projectId,
                po_link: selectedPO,
                package_name: selectedPackage,
                delivery_date: deliveryDate,
                mp_items: JSON.stringify({ list: minimalItems })
            });
            onClose();
            return true;
        } catch (e) {
            console.error("Failed to create plan", e);
            alert("Failed to create Material Delivery Plan");
            return false;
        }
    }

    const selectedCount = Object.values(selectedItems).filter(Boolean).length;
    const totalItems = fullPO?.items?.length || 0;
    
    // Derived PO List for Dropdown
    const procurementOrders = (poResult?.message && Array.isArray(poResult.message)) ? poResult.message : [];

    return (
        <div className="border border-indigo-100 rounded-lg bg-white shadow-sm overflow-hidden mb-4">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-indigo-50/50 border-b border-indigo-100">
                <h3 className="text-sm font-semibold text-gray-800">Plan {planNumber}</h3>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-4 space-y-4">
                {/* Select Work Package */}
                <div className="space-y-2">
                    <Label className="text-xs font-bold text-gray-700">Select Work Package</Label>
                    <Select value={selectedPackage} onValueChange={setSelectedPackage}>
                        <SelectTrigger className="w-full bg-white border-gray-200 text-gray-900">
                            <SelectValue placeholder="Select one package for material plan" />
                        </SelectTrigger>
                        <SelectContent>
                            {projectPackages.map((pkgName) => (
                                <SelectItem key={pkgName} value={pkgName}>
                                    {pkgName}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* PO Selection Mode */}
                <div className={`space-y-2 ${!selectedPackage ? "opacity-50 pointer-events-none" : ""}`}>
                    <Label className="text-xs font-bold text-gray-700">PO Selection Mode</Label>
                    <RadioGroup 
                        value={poMode} 
                        onValueChange={(v) => setPoMode(v as "existing" | "new")}
                        className="flex items-center gap-6"
                        disabled={!selectedPackage}
                    >
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="existing" id={`r1-${planNumber}`} className="text-indigo-600 border-indigo-600" />
                            <Label htmlFor={`r1-${planNumber}`} className="font-normal text-sm text-gray-700">Use Existing PO</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="new" id={`r2-${planNumber}`} />
                            <Label htmlFor={`r2-${planNumber}`} className="font-normal text-sm text-gray-700">Create New PO</Label>
                        </div>
                    </RadioGroup>
                </div>

                {/* Existing PO Selection */}
                {poMode === "existing" && (
                    <div className="space-y-4 pt-2">
                        <div className="space-y-2">
                            <Label className="text-xs font-bold text-gray-700">Search/ Select Materials and PR ID</Label>
                            <p className="text-xs text-blue-800">
                                Materials you list must exist in the PO you link. A PO can only be linked if it contains those materials
                            </p>
                            <div className="flex gap-2">
                                <div className="w-[120px] shrink-0">
                                    <button className="w-full flex items-center justify-between px-3 py-2 bg-white border border-gray-200 rounded-md text-sm text-gray-700">
                                        <span>PO ID</span>
                                        <ChevronDown className="h-4 w-4 opacity-50" />
                                    </button>
                                </div>
                                <div className="flex-1">
                                    <Select value={selectedPO} onValueChange={setSelectedPO}>
                                        <SelectTrigger className="w-full bg-white border-gray-200 text-gray-900">
                                            <SelectValue placeholder="Select one PO ID" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {isLoadingPOs ? (
                                                <div className="p-2 text-xs text-gray-500">Loading POs...</div>
                                            ) : (
                                                procurementOrders?.map((po: any) => (
                                                    <SelectItem key={po.name} value={po.name}>
                                                        <span className="truncate">
                                                            {po.name}
                                                        </span>
                                                    </SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>

                        {/* Items List Selection */}
                        
                        {selectedPO && fullPO && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Label className="text-xs font-bold text-gray-700">Select Items from PO</Label>
                                        <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200 font-normal">
                                            {selectedCount}/{totalItems} Items
                                        </Badge>
                                    </div>
                                    
                                    {selectedPO ? (
                                        <div className="flex w-full max-w-[200px] h-8 items-center justify-between rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 ml-auto mr-2">
                                            <span className="truncate flex-1">
                                                {selectedPO} 
                                            </span>
                                            <button 
                                                onClick={() => setSelectedPO("")}
                                                className="ml-2 font-medium text-red-600 hover:text-red-800 focus:outline-none"
                                            >
                                                Change
                                            </button>
                                        </div>
                                    ) : null}
                                </div>

                                <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-60 overflow-y-auto">
                                    {fullPO.items?.map((item: any) => (
                                        <div key={item.name} className="flex items-center space-x-3 p-3 hover:bg-gray-50 bg-white">
                                            <Checkbox 
                                                id={`item-${item.name}`} 
                                                checked={selectedItems[item.name] || false}
                                                onCheckedChange={() => handleItemToggle(item.name)}
                                            />
                                            <label 
                                                htmlFor={`item-${item.name}`}
                                                className="text-sm text-gray-700 font-medium cursor-pointer flex-1"
                                            >
                                                {item.item_name}
                                            </label>
                                        </div>
                                    ))}
                                    {(!fullPO.items || fullPO.items.length === 0) && (
                                        <div className="p-4 text-center text-gray-500 text-sm">
                                            No items found in this PO.
                                        </div>
                                    )}
                                </div>
                                
                                {/* Delivery Date & Confirm */}
                                <div className="flex items-end gap-4 pt-2 border-t border-gray-100 mt-2">
                                    <div className="space-y-1 flex-1">
                                        <Label className="text-xs font-bold text-gray-700">Delivery Date</Label>
                                        <input 
                                            type="date" 
                                            value={deliveryDate}
                                            onChange={(e) => setDeliveryDate(e.target.value)}
                                            className="w-full flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                        />
                                    </div>
                                    <button 
                                        onClick={handleConfirm}
                                        disabled={isCreating}
                                        className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium h-9 px-6 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isCreating ? "Creating..." : "Confirm"}
                                    </button>
                                </div>

                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
