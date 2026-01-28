import { useState, useEffect, useMemo } from "react";
import { useFrappeGetDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
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
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";

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
    const [plannedDate, setPlannedDate] = useState<Date | undefined>(undefined);
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState("");
    
    // New PO Specific
    const [manualItemsText, setManualItemsText] = useState("");

    const isNewPO = plan?.type === "New PO";

    // Fetch the linked PO to get all available items
    // Only if NOT New PO
    const poId = plan?.id_link;
    const { data: poDoc, isLoading: isLoadingPO } = useFrappeGetDoc("Procurement Orders", poId, {
        enabled: !!poId && isOpen && !isNewPO
    });

    // Initialize/Reset State when Plan changes or Form opens
    useEffect(() => {
        if (isOpen && plan) {
            setPlannedAmount(plan.planned_amount?.toString() || "");
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
            } else {
                // For Existing PO, populate selection
                const currentItemNames = new Set<string>(list.map((i: any) => i.name));
                setSelectedItems(currentItemNames);
            }
        }
    }, [isOpen, plan, isNewPO]);

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

        if (!plannedDate) {
            toast({
                title: "Invalid Date",
                description: "Planned Date is required.",
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

        try {
            await updateDoc("Cashflow Plan", plan.name, {
                planned_amount: parseFloat(plannedAmount),
                planned_date: format(plannedDate, "yyyy-MM-dd"),
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
                            Edit PO Plan-
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
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                <span className="text-gray-500"><i className="far fa-money-bill-alt"></i></span> 
                                Planned Amount
                            </Label>
                            <Input 
                                value={plannedAmount}
                                onChange={(e) => setPlannedAmount(e.target.value)}
                                className="h-11 text-lg"
                                prefix="₹"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                <span className="text-gray-500"><i className="far fa-calendar-alt"></i></span>
                                Payment Date
                            </Label>
                             <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "w-full pl-3 text-left font-normal h-11 text-base",
                                            !plannedDate && "text-muted-foreground"
                                        )}
                                    >
                                        {plannedDate ? format(plannedDate, "dd/MM/yyyy") : <span>dd/mm/yyyy</span>}
                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={plannedDate}
                                        onSelect={setPlannedDate}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
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
