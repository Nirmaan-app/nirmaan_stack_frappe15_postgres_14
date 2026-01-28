import { useState, useEffect, useMemo } from "react";
import { useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Search } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import Select from "react-select";

interface EditWOCashflowFormProps {
    isOpen: boolean;
    projectId: string;
    plan: any; // The Cashflow Plan document
    onClose: () => void;
    onSuccess: () => void;
}

export const EditWOCashflowForm = ({ isOpen, projectId, plan, onClose, onSuccess }: EditWOCashflowFormProps) => {
    const { toast } = useToast();
    const { updateDoc, loading: isUpdating } = useFrappeUpdateDoc();
    const isExistingWO = plan?.type === "Existing WO";

    // State
    const [plannedAmount, setPlannedAmount] = useState<string>("");
    const [plannedDate, setPlannedDate] = useState<Date | undefined>(undefined);
    
    // Existing WO specific - Read Only Items
    const existingItems = useMemo(() => {
        if (!isExistingWO || !plan?.items) return [];
        try {
            const raw = plan.items;
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return data?.list || (Array.isArray(data) ? data : []);
        } catch (e) {
            return [];
        }
    }, [plan, isExistingWO]);

    // New WO specific
    const [description, setDescription] = useState("");
    const [estimatedValue, setEstimatedValue] = useState("");
    const [vendor, setVendor] = useState<{ value: string, label: string } | null>(null);

    // Fetch Vendors for New WO edit
    const { data: vendors, isLoading: isLoadingVendors } = useFrappeGetDocList("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 0,
        enabled: isOpen && !isExistingWO
    });

    const vendorOptions = useMemo(() => 
        (vendors || []).map(v => ({ value: v.name, label: v.vendor_name })), 
    [vendors]);

    // Initialize/Reset State
    useEffect(() => {
        if (isOpen && plan) {
            setPlannedAmount(plan.planned_amount?.toString() || "");
            setPlannedDate(plan.planned_date ? new Date(plan.planned_date) : undefined);

            if (!isExistingWO) {
                // New WO initialization
                setDescription(plan.remarks || "");
                setEstimatedValue(plan.estimated_price?.toString() || "");
                if (plan.vendor) {
                    setVendor({ 
                        value: plan.vendor, 
                        label: plan.vendor_name || plan.vendor // fallback
                    });
                }
            }
        }
    }, [isOpen, plan, isExistingWO]);

    // Update vendor label when options load if needed
    useEffect(() => {
        if (!isExistingWO && vendors && plan?.vendor) {
             const found = vendors.find(v => v.name === plan.vendor);
             if (found) {
                 setVendor({ value: found.name, label: found.vendor_name });
             }
        }
    }, [vendors, plan, isExistingWO]);

    const handleSubmit = async () => {
        if (!plannedAmount || parseFloat(plannedAmount) <= 0) {
            toast({ title: "Invalid Amount", description: "Amount must be > 0", variant: "destructive" });
            return;
        }
        if (!plannedDate) {
            toast({ title: "Invalid Date", description: "Date is required", variant: "destructive" });
            return;
        }

        const updateData: any = {
            planned_amount: parseFloat(plannedAmount),
            planned_date: format(plannedDate, "yyyy-MM-dd"),
        };

        if (isExistingWO) {
             // For existing WO, we don't update items as they are read-only
        } else {
            // New WO specific fields
            if (!description.trim()) {
                toast({ title: "Missing Description", description: "Description is required", variant: "destructive" });
                return;
            }
             if (!estimatedValue || parseFloat(estimatedValue) <= 0) {
                toast({ title: "Invalid Estimated Value", description: "Estimated Value must be > 0", variant: "destructive" });
                return;
            }
            if (!vendor) {
                 toast({ title: "Missing Vendor", description: "Vendor is required", variant: "destructive" });
                 return;
            }
            updateData.remarks = description;
            updateData.estimated_price = parseFloat(estimatedValue);
            updateData.vendor = vendor.value;
            // Also update the single item description if we store it that way for New WO
            updateData.items = JSON.stringify({ list: [{ description: description, category: "" }] });
        }

        try {
            await updateDoc("Cashflow Plan", plan.name, updateData);
            toast({ title: "Success", description: "WO Cashflow Plan updated." });
            onSuccess();
            onClose();
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Failed to update plan.", variant: "destructive" });
        }
    };

    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[700px] p-0 gap-0 overflow-hidden bg-white">
                <div className="px-6 py-4 border-b bg-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <DialogTitle className="text-lg font-semibold text-gray-900">
                            Edit WO Plan
                        </DialogTitle>
                        <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-sm font-normal">
                             {plan?.name}
                        </Badge>
                    </div>
                </div>

                <div className="px-6 py-3 bg-gray-50/50 border-b flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-1 bg-white border rounded text-gray-600">
                        Type: {plan?.type}
                    </span>
                    {plan?.id_link && (
                        <span className="px-2 py-1 bg-white border rounded text-gray-600">
                            WO ID: {plan?.id_link}
                        </span>
                    )}
                </div>

                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* New WO Specific Fields */}
                    {!isExistingWO && (
                        <div className="space-y-4 border-b pb-6">
                            <div className="space-y-2">
                                <Label>Vendor</Label>
                                <Select 
                                    options={vendorOptions}
                                    value={vendor}
                                    onChange={setVendor}
                                    placeholder="Select vendor"
                                    className="text-sm"
                                    isLoading={isLoadingVendors}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Description</Label>
                                <Textarea 
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Description"
                                    className="resize-none"
                                />
                            </div>
                             <div className="space-y-2">
                                <Label className="flex items-center gap-2">Estimated Value</Label>
                                <Input 
                                    value={estimatedValue}
                                    onChange={(e) => setEstimatedValue(e.target.value)}
                                    type="number"
                                    prefix="₹"
                                />
                            </div>
                        </div>
                    )}

                    {/* Common Fields */}
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-gray-900 flex items-center gap-2">
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
                        </div>
                    </div>

                    {/* Existing WO Items Display (Read Only) */}
                    {/* {isExistingWO && existingItems.length > 0 && (
                        <div className="border-t pt-4">
                            <Label className="text-sm font-semibold text-gray-900 mb-3 block">
                                Items Description ({existingItems.length})
                            </Label>
                            <div className="flex flex-wrap gap-2 group-hover:block">
                                {existingItems.map((item: any, i: number) => (
                                    <div key={i} className="bg-[#EBE9F8] text-gray-700 text-xs px-2.5 py-1 rounded-md font-medium">
                                        {item.description || item.item_name || "Item"}
                                        {item.category && <span className="ml-1 text-gray-500 font-normal">({item.category})</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )} */}
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
