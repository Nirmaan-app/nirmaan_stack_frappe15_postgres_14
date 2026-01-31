import { useState, useEffect, useMemo } from "react";
import { useFrappeGetDoc, useFrappeUpdateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Search, X } from "lucide-react";
import ReactSelect from "react-select";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import { CashflowDatePicker } from "./CashflowDatePicker";

interface EditPOCashflowFormProps {
    isOpen: boolean;
    projectId: string;
    plan: any; // The Cashflow Plan document
    onClose: () => void;
    onSuccess: () => void;
}

export const EditPOCashflowForm = ({ isOpen, projectId, plan, onClose, onSuccess }: EditPOCashflowFormProps) => {
    const { toast } = useToast();
    const { updateDoc, loading: isUpdating } = useFrappeUpdateDoc();

    // State
    const [plannedAmount, setPlannedAmount] = useState<string>("");
    const [estimatedPrice, setEstimatedPrice] = useState<string>("");
    const [plannedDate, setPlannedDate] = useState<Date | undefined>(undefined);
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState("");
    
    // New PO Specific
    const [manualItemsText, setManualItemsText] = useState("");
    const [vendor, setVendor] = useState<{ value: string, label: string } | null>(null);
    const [isCustomVendor, setIsCustomVendor] = useState(false);

    const isNewPO = plan?.type === "New PO";

    // Fetch the linked PO to get all available items
    // Only if NOT New PO
    const poId = plan?.id_link;
    const { data: poDoc, isLoading: isLoadingPO } = useFrappeGetDoc("Procurement Orders", poId, {
        enabled: !!poId && isOpen && !isNewPO
    });

    // Fetch Vendors for New PO edit
    // Fetch Vendors for edit (enabled for both New and Existing to allow overrides)
    const { data: vendors, isLoading: isLoadingVendors } = useFrappeGetDocList("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 0,
        enabled: isOpen
    });

    const vendorOptions = useMemo(() => [
        ...(vendors || []).map((v: any) => ({ value: v.name, label: v.vendor_name })),
        { label: "Others", value: "__others__" }
    ], [vendors]);

    // Initialize/Reset State when Plan changes or Form opens
    useEffect(() => {
        if (isOpen && plan) {
            setPlannedAmount(plan.planned_amount?.toString() || "");
            setEstimatedPrice(plan.estimated_price?.toString() || "");
            setPlannedDate(plan.planned_date ? new Date(plan.planned_date) : undefined);

            // Parse existing items
            let list: any[] = [];
            try {
                const rawItems = plan.items;
                const parsed = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
                list = parsed?.list || (Array.isArray(parsed) ? parsed : []);
            } catch (e) {
                console.error("Failed to parse plan items", e);
                list = [];
            }

            if (isNewPO) {
                // For New PO, populate textarea
                const text = list.map((i: any) => i.item_name || i.description).join("\n");
                setManualItemsText(text);

                // Populate Vendor (Common for New and Existing now)
                if (plan.vendor || plan.vendor_name) {
                    if (!plan.vendor && plan.vendor_name) {
                         setIsCustomVendor(true);
                         setVendor({ value: "", label: plan.vendor_name });
                    } else {
                         setIsCustomVendor(false);
                         setVendor({ 
                             value: plan.vendor, 
                             label: plan.vendor_name || plan.vendor
                         });
                    }
                }
            } else {
                // For Existing PO, populate selection
                const currentItemNames = new Set<string>(list.map((i: any) => i.name));
                setSelectedItems(currentItemNames);

                // Populate Vendor for Existing PO as well
                if (plan.vendor || plan.vendor_name) {
                    if (!plan.vendor && plan.vendor_name) {
                         setIsCustomVendor(true);
                         setVendor({ value: "", label: plan.vendor_name });
                    } else {
                         setIsCustomVendor(false);
                         setVendor({ 
                             value: plan.vendor, 
                             label: plan.vendor_name || plan.vendor
                         });
                    }
                }
            }
        }
    }, [isOpen, plan, isNewPO]);

    // Update vendor label when options load if needed
    useEffect(() => {
        if (vendors && plan?.vendor && !isCustomVendor) {
             const found = vendors.find((v: any) => v.name === plan.vendor);
             if (found) {
                 setVendor({ value: found.name, label: found.vendor_name });
             }
        }
    }, [vendors, plan, isCustomVendor]);

    // All Items from the PO
    const allPOItems = useMemo(() => {
        return poDoc?.items || [];
    }, [poDoc]);

    // Filtered items for display
    const filteredItems = useMemo(() => {
        if (!searchQuery) return allPOItems;
        return allPOItems.filter((item: any) => 
            (item.item_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (item.item_code || "").toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [allPOItems, searchQuery]);

    const handleToggleItem = (itemName: string) => {
        const newSet = new Set(selectedItems);
        if (newSet.has(itemName)) {
            newSet.delete(itemName);
        } else {
            newSet.add(itemName);
        }
        setSelectedItems(newSet);
    };

    const handleSelectAll = () => {
        const allNames = filteredItems.map((i: any) => i.name);
        const allSelected = allNames.every((name: string) => selectedItems.has(name));
        const newSet = new Set(selectedItems);
        if (allSelected) {
            allNames.forEach((name: string) => newSet.delete(name));
        } else {
            allNames.forEach((name: string) => newSet.add(name));
        }
        setSelectedItems(newSet);
    };

    const handleClearAll = () => {
        setSelectedItems(new Set());
    };

    const handleSubmit = async () => {
        if (!plannedAmount || parseFloat(plannedAmount) <= 0) {
            toast({
                title: "Invalid Amount",
                description: "Planned Amount must be greater than 0.",
                variant: "destructive"
            });
            return;
        }

        if (isNewPO && (!estimatedPrice || parseFloat(estimatedPrice) <= 0)) {
            toast({
                title: "Invalid Amount",
                description: "Estimated PO Amount must be greater than 0.",
                variant: "destructive"
            });
            return;
        }

       

        let finalItemsList = [];

        if (isNewPO) {
            if (!manualItemsText.trim()) {
                toast({ title: "No Items", description: "Please enter at least one item.", variant: "destructive" });
                return;
            }
            const lines = manualItemsText.split('\n').filter(line => line.trim());
            finalItemsList = lines.map((itemName, idx) => ({
                name: `manual-${Date.now()}-${idx}`,
                item_name: itemName.trim(),
                item_id: `TEMP-${Date.now()}-${idx}`,
                category: ""
            }));
        } else {
            if (selectedItems.size === 0) {
                toast({
                    title: "No Items Selected",
                    description: "You must select at least one item for this plan.",
                    variant: "destructive"
                });
                return;
            }
            finalItemsList = allPOItems
                .filter((item: any) => selectedItems.has(item.name))
                .map((item: any) => ({
                    name: item.name,
                    item_name: item.item_name,
                    item_code: item.item_code,
                    category: item.category,
                }));
        }

        if (isNewPO && !vendor) {
            toast({
                title: "Missing Vendor",
                description: "Review your fields! Vendor selection is mandatory.",
                variant: "destructive"
            });
            return;
        }

        try {
            await updateDoc("Cashflow Plan", plan.name, {
                planned_amount: parseFloat(plannedAmount),
                planned_amount: parseFloat(plannedAmount),
                estimated_price: isNewPO ? parseFloat(estimatedPrice) : undefined,
                planned_date: format(plannedDate, "yyyy-MM-dd"),
                lines: undefined, // ensure no collision if any
                vendor: isCustomVendor ? "" : vendor?.value,
                vendor_name: vendor?.label,
                items: JSON.stringify({ list: finalItemsList })
            });

            toast({
                title: "Success",
                description: "PO Cashflow Plan updated successfully.",
            });
            onSuccess();
            onClose();
        } catch (e) {
            console.error("Failed to update plan", e);
            toast({
                title: "Error",
                description: "Failed to update plan.",
                variant: "destructive"
            });
        }
    };

    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[700px] p-0 gap-0 overflow-hidden bg-white">
                {/* Header */}
                <div className="px-6 py-4 border-b bg-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <DialogTitle className="text-lg font-semibold text-gray-900">
                            Edit PO Cashflow Plan-
                        </DialogTitle>
                        <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-sm font-normal">
                             {plan?.name}
                        </Badge>
                    </div>
                    {/* <div className="flex items-center gap-2">
                         <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-gray-400">
                            <X className="h-4 w-4" />
                        </Button>
                    </div> */}
                </div>

                {/* Sub-Header / Tags */}
                <div className="px-6 py-3 bg-gray-50/50 border-b flex flex-wrap gap-2 text-xs">
                    {plan?.critical_po_task && (
                         <span className="px-2 py-1 bg-red-50 text-red-700 border border-red-100 rounded">
                            {plan.critical_po_task}
                         </span>
                    )}
                     {plan?.critical_po_category && (
                         <span className="px-2 py-1 bg-red-50 text-red-700 border border-red-100 rounded">
                            {plan.critical_po_category}
                         </span>
                    )}
                    <span className="px-2 py-1 bg-white border rounded text-gray-600">
                        PO ID: {plan?.id_link}
                    </span>
                    <span className="px-2 py-1 bg-white border rounded text-gray-600">
                        PO Type: {plan?.type}
                    </span>
                </div>

                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* Amount & Date */}
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="text-sm font-bold text-gray-900 flex items-center gap-2">
                                    Planned Amount <span className="text-red-500">*</span>
                                </Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2 text-gray-500">₹</span>
                                    <Input 
                                        type="number"
                                        value={plannedAmount}
                                        onChange={(e) => setPlannedAmount(e.target.value)}
                                        className="pl-7"
                                        placeholder="Enter amount"
                                    />
                                </div>
                            </div>

                            {isNewPO && (
                                <div className="space-y-2">
                                    <Label className="text-sm font-bold text-gray-900 flex items-center gap-2">
                                        Estimated PO Amount <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-2 text-gray-500">₹</span>
                                        <Input 
                                            type="number"
                                            value={estimatedPrice}
                                            onChange={(e) => setEstimatedPrice(e.target.value)}
                                            className="pl-7"
                                            placeholder="Enter estimated amount"
                                        />
                                    </div>
                                </div>
                            )}
                            
                            <div className="space-y-2">
                                <Label className="text-sm font-bold text-gray-900 flex items-center gap-2">
                                    Vendor
                                </Label>
                                    {isCustomVendor ? (
                                        <div className="space-y-2">
                                            <Input
                                                placeholder="Enter custom vendor name"
                                                value={vendor?.label || ""}
                                                onChange={(e) => setVendor({ value: "", label: e.target.value })}
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setIsCustomVendor(false);
                                                    setVendor(null);
                                                }}
                                                className="text-xs text-gray-500 hover:text-gray-700 h-6 px-2"
                                            >
                                                ← Back to Vendor list
                                            </Button>
                                        </div>
                                    ) : (
                                        <ReactSelect
                                            options={vendorOptions}
                                            value={vendor}
                                            onChange={(option: any) => {
                                                if (option?.value === "__others__") {
                                                    setIsCustomVendor(true);
                                                    setVendor({ value: "", label: "" });
                                                } else {
                                                    setVendor(option);
                                                }
                                            }}
                                            placeholder="Select Vendor"
                                            isLoading={isLoadingVendors}
                                            filterOption={(option: any, inputValue: any) => {
                                                 if (option.data.value === "__others__") return true;
                                                 return option.label.toLowerCase().includes(inputValue.toLowerCase());
                                            }}
                                            styles={{
                                                 control: (base: any) => ({ ...base, minHeight: '36px', height: '36px', fontSize: '0.875rem' }),
                                                 option: (base: any, state: any) => ({
                                                     ...base,
                                                     ...(state.data.value === "__others__" ? {
                                                         backgroundColor: state.isFocused ? '#dbeafe' : '#eff6ff',
                                                         color: '#2563eb',
                                                         fontWeight: 600,
                                                         borderTop: '1px solid #e5e7eb',
                                                         position: 'sticky',
                                                         bottom: 0,
                                                     } : {})
                                                 }),
                                                 menuList: (base: any) => ({ ...base, paddingBottom: 0 })
                                            }}
                                            formatOptionLabel={(option: any) => (
                                                 option.value === "__others__" ? (
                                                     <span className="flex items-center gap-1">
                                                         <span>+ Others</span>
                                                         <span className="text-xs text-blue-400">(type custom)</span>
                                                     </span>
                                                 ) : option.label
                                            )}
                                        />
                                    )}
                                </div>
                        </div>

                        <div className="space-y-2">
                            <CashflowDatePicker
                                date={plannedDate}
                                setDate={setPlannedDate}
                                label="Planned Date"
                                required
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                This delivery date will apply to all selected items in this plan
                            </p>
                        </div>
                    </div>

                    {/* Items Section */}
                    <div className="border-t pt-4">
                        {isNewPO ? (
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold text-gray-900">
                                    Items (One per line)
                                </Label>
                                <Textarea
                                    value={manualItemsText}
                                    onChange={(e) => setManualItemsText(e.target.value)}
                                    placeholder="Enter items, one per line..."
                                    rows={5}
                                    className="resize-none"
                                />
                            </div>
                        ) : (
                            <>
                                {/* Item Selection Header */}
                                <div className="flex flex-col gap-3 mb-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="font-semibold text-sm text-gray-900">
                                            {selectedItems.size} of {allPOItems.length} items selected
                                        </h4>
                                    </div>
                                    <p className="text-sm text-gray-500">
                                        Select or de-select items to update this delivery plan
                                    </p>
                                </div>

                                {/* Search & Actions */}
                                <div className="flex gap-3 mb-4">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                                        <Input
                                            placeholder="Search Items in PO"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="pl-9 bg-gray-50"
                                        />
                                    </div>
                                    <Button variant="outline" onClick={handleSelectAll} className="whitespace-nowrap">
                                        Select All
                                    </Button>
                                    <Button variant="outline" onClick={handleClearAll} className="whitespace-nowrap">
                                        Clear All
                                    </Button>
                                </div>

                                {/* Items List */}
                                <div className="border rounded-lg overflow-hidden">
                                    <div className="max-h-[300px] overflow-y-auto divide-y">
                                        {isLoadingPO && <div className="p-4 text-center text-gray-500">Loading PO items...</div>}
                                        
                                        {!isLoadingPO && filteredItems.length === 0 && (
                                            <div className="p-4 text-center text-gray-500">No items found matching your search.</div>
                                        )}

                                        {!isLoadingPO && filteredItems.map((item: any) => (
                                            <div 
                                                key={item.name} 
                                                className={cn(
                                                    "flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors cursor-pointer",
                                                    selectedItems.has(item.name) ? "bg-blue-50/30" : ""
                                                )}
                                                onClick={() => handleToggleItem(item.name)}
                                            >
                                                <Checkbox 
                                                    checked={selectedItems.has(item.name)}
                                                    onCheckedChange={() => handleToggleItem(item.name)}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium text-gray-700 truncate">
                                                        {item.item_name}
                                                    </div>
                                                    {/* Optional: Show Category or Work Package if available */}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="flex justify-end items-center gap-3 px-6 py-4 bg-gray-50 border-t">
                    <Button variant="outline" onClick={onClose} disabled={isUpdating}>
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleSubmit} 
                        disabled={isUpdating}
                        className="bg-red-600 hover:bg-red-700 text-white"
                    >
                        {isUpdating ? "Saving..." : "Confirm"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
