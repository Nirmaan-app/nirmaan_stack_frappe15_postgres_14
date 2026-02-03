import { useState, useMemo, useEffect } from "react";
import { useFrappeGetDocList, useFrappeGetDoc, useFrappeCreateDoc } from "frappe-react-sdk";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, ChevronLeft, X, Loader2 } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import ReactSelect from "react-select";
import { useToast } from "@/components/ui/use-toast";
import { safeFormatDate } from "@/lib/utils";
import { CashflowDatePicker } from "./CashflowDatePicker";

interface FromMaterialPlanDialogProps {
    isOpen: boolean;
    onClose: () => void;
    projectId: string;
    onSuccess: () => void;
}

interface SelectedPlanData {
    name: string;
    po_link: string;
    po_type: string;
    package_name: string;
    critical_po_category: string;
    critical_po_task: string;
    items: any[];
    delivery_date: string;
    plannedDate?: string;
    plannedAmount?: string;
    estimatedPrice?: string;
    vendor?: { value: string; label: string } | null;
    vendorName?: string;
}

export const FromMaterialPlanDialog = ({ isOpen, onClose, projectId, onSuccess }: FromMaterialPlanDialogProps) => {
    const { toast } = useToast();
    const { createDoc } = useFrappeCreateDoc();
    const [step, setStep] = useState<"selection" | "review">("selection");
    const [searchTerm, setSearchTerm] = useState("");
    const [searchMode, setSearchMode] = useState<"po_id" | "items">("po_id");
    const [selectedPlanNames, setSelectedPlanNames] = useState<Set<string>>(new Set());
    const [reviewPlans, setReviewPlans] = useState<SelectedPlanData[]>([]);

    const resetState = () => {
        setStep("selection");
        setSearchTerm("");
        setSelectedPlanNames(new Set());
        setReviewPlans([]);
    };

    // Fetch Material Delivery Plans
    const { data: materialPlans, isLoading: isLoadingPlans } = useFrappeGetDocList("Material Delivery Plan", {
        fields: ["name", "po_link", "package_name", "critical_po_category", "critical_po_task", "delivery_date", "mp_items", "po_type"],
        filters: [["project", "=", projectId]],
        orderBy: { field: "creation", order: "desc" },
        limit: 0
    });

    // Fetch Vendors for New PO selection
    const { data: vendors } = useFrappeGetDocList("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 0
    });

    const vendorOptions = useMemo(() => {
        return vendors?.map(v => ({ value: v.name, label: v.vendor_name })) || [];
    }, [vendors]);

    // Filtered plans based on search
    const filteredPlans = useMemo(() => {
        if (!materialPlans) return [];
        return materialPlans.filter(plan => {
            const term = searchTerm.toLowerCase();
            if (searchMode === "po_id") {
                return plan.po_link?.toLowerCase().includes(term);
            } else {
                // Search in items
                try {
                    const items = typeof plan.mp_items === 'string' ? JSON.parse(plan.mp_items) : plan.mp_items;
                    const itemList = items?.list || items || [];
                    return itemList.some((it: any) => it.item_name?.toLowerCase().includes(term));
                } catch (e) {
                    return false;
                }
            }
        });
    }, [materialPlans, searchTerm, searchMode]);

    const togglePlanSelection = (name: string) => {
        const newSet = new Set(selectedPlanNames);
        if (newSet.has(name)) newSet.delete(name);
        else newSet.add(name);
        setSelectedPlanNames(newSet);
    };

    const handleContinue = async () => {
        const selected = (materialPlans || []).filter(p => selectedPlanNames.has(p.name));
        
        // Prepare initial review data
        const initialReviewData: SelectedPlanData[] = await Promise.all(selected.map(async (p) => {
            let items = [];
            try {
                const parsed = typeof p.mp_items === 'string' ? JSON.parse(p.mp_items) : p.mp_items;
                items = parsed?.list || parsed || [];
            } catch (e) {}

            const planData: SelectedPlanData = {
                ...p,
                items,
                plannedDate: "",
                plannedAmount: "",
                estimatedPrice: "",
                vendor: null,
                vendorName: ""
            };

            // If existing PO, try to get vendor from backend? 
            // Actually, we'll fetch them lazily or in a single pass if needed.
            return planData;
        }));

        setReviewPlans(initialReviewData);
        setStep("review");
    };

    // Effect to fetch vendors for "Existing PO" plans in review
    useEffect(() => {
        if (step === "review" && reviewPlans.length > 0) {
            const fetchExistingVendors = async () => {
                const updatedPlans = [...reviewPlans];

                for (let i = 0; i < updatedPlans.length; i++) {
                    const plan = updatedPlans[i];
                    if (plan.po_type === "Existing PO" && plan.po_link && !plan.vendor) {
                        try {
                            // Note: useFrappeGetDoc might be better as a hook, but here we are in an effect for multi-fetching.
                            // To keep it simple and within the rules, we'll assume we can't easily wait for multiple hooks.
                            // Alternatively, we could have a child component for each plan that handles its own vendor fetch.
                        } catch (e) {
                            console.error("Failed to fetch vendor for", plan.po_link, e);
                        }
                    }
                }
            };
            fetchExistingVendors();
        }
    }, [step]); // Only run when entering review

    const updateReviewPlan = (index: number, updates: Partial<SelectedPlanData>) => {
        const newPlans = [...reviewPlans];
        newPlans[index] = { ...newPlans[index], ...updates };
        setReviewPlans(newPlans);
    };

    const handleSubmit = async () => {
        // Validate
        const today = new Date().toISOString().split('T')[0];
        for (const plan of reviewPlans) {
            if (!plan.plannedDate || !plan.plannedAmount || parseFloat(plan.plannedAmount) <= 0) {
                toast({ title: "Incomplete Data", description: `Please fill date and amount for ${plan.po_link || plan.name}`, variant: "destructive" });
                return;
            }
            if (plan.plannedDate < today) {
                toast({ title: "Invalid Date", description: `Planned date for ${plan.po_link || plan.name} cannot be in the past.`, variant: "destructive" });
                return;
            }
            if (plan.po_type === "New PO" && (!plan.estimatedPrice || !plan.vendor)) {
                toast({ title: "Incomplete Data", description: `Please fill price and vendor for New PO: ${plan.name}`, variant: "destructive" });
                return;
            }
        }

        try {
            for (const plan of reviewPlans) {
                await createDoc("Cashflow Plan", {
                    project: projectId,
                    id_link: plan.po_link || "",
                    type: plan.po_type,
                    planned_date: plan.plannedDate,
                    planned_amount: parseFloat(plan.plannedAmount || "0"),
                    estimated_price: parseFloat(plan.estimatedPrice || "0"),
                    vendor: plan.vendor?.value,
                    critical_po_category: plan.critical_po_category,
                    critical_po_task: plan.critical_po_task,
                    items: JSON.stringify({ list: plan.items })
                });
            }
            toast({ title: "Success", description: "Cashflow plans created successfully." });
            resetState();
            onSuccess();
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Failed to create plans.", variant: "destructive" });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            if (!open) {
                resetState();
                onClose();
            }
        }}>
            <DialogContent className="max-w-5xl p-0 overflow-hidden bg-gray-50 flex flex-col h-[90vh]">
                <DialogHeader className="p-6 pb-2 bg-white shrink-0">
                    <div className="flex justify-between items-center">
                        <div>
                            <DialogTitle className="text-xl md:text-2xl font-bold text-gray-900">
                                {step === "selection" ? "Create PO Plans" : "Review and complete PO Plans"}
                            </DialogTitle>
                            <p className="text-xs md:text-sm text-gray-500 mt-1">
                                Select Material Plans to convert into PO Plans by adding payment and vendor details
                            </p>
                        </div>
                    </div>

                    {step === "selection" && (
                        <div className="flex flex-col md:flex-row gap-2 mt-4 md:mt-6">
                            <Select value={searchMode} onValueChange={(v: any) => setSearchMode(v)}>
                                <SelectTrigger className="w-full md:w-[120px] bg-white">
                                    <SelectValue placeholder="Search by" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="po_id">PO ID</SelectItem>
                                    <SelectItem value="items">Items</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder={searchMode === "po_id" ? "Search by PO ID" : "Search by items..."}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10 bg-white w-full"
                                />
                            </div>
                        </div>
                    )}
                </DialogHeader>

                <ScrollArea className="flex-1 p-6">
                    {step === "selection" ? (
                        <div className="space-y-2">
                             {isLoadingPlans ? (
                                <div className="flex justify-center py-10"><Loader2 className="animate-spin h-8 w-8 text-gray-400" /></div>
                             ) : filteredPlans.length === 0 ? (
                                <div className="text-center py-10 text-gray-500">No material plans found with current filter.</div>
                             ) : filteredPlans.map((plan, idx) => (
                                <div 
                                    key={plan.name} 
                                    className="bg-white border rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-3 md:gap-4 hover:shadow-sm transition-shadow cursor-pointer relative"
                                    onClick={() => togglePlanSelection(plan.name)}
                                >
                                    <div className="flex items-center gap-3">
                                        <Checkbox 
                                            checked={selectedPlanNames.has(plan.name)} 
                                            onCheckedChange={() => togglePlanSelection(plan.name)}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <div className="w-16 shrink-0">
                                            <Badge variant="secondary" className="bg-blue-50 text-blue-700 font-normal">
                                                Plan {idx + 1}
                                            </Badge>
                                        </div>
                                    </div>
                                    
                                    <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-sm text-gray-900 truncate">{plan.critical_po_task}</div>
                                        <div className="text-xs text-gray-500 truncate">{plan.critical_po_category}</div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-3 md:gap-4">
                                        <div className="text-sm text-gray-600 font-medium truncate md:w-[150px]">
                                            {plan.po_link || "--"}
                                        </div>
                                        <div className="shrink-0">
                                            <Badge variant="outline" className={`${plan.po_type === 'New PO' ? 'bg-orange-50 text-orange-700 border-orange-100' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>
                                                {plan.po_type}
                                            </Badge>
                                        </div>
                                        <div className="shrink-0 text-xs font-semibold text-gray-700 text-center bg-gray-100 rounded-full py-0.5 px-2">
                                            {(() => {
                                                try {
                                                    const items = typeof plan.mp_items === 'string' ? JSON.parse(plan.mp_items) : plan.mp_items;
                                                    return (items?.list?.length || items?.length || 0);
                                                } catch (e) { return 0; }
                                            })()} Items
                                        </div>
                                        <div className="text-xs text-gray-500 md:text-right whitespace-nowrap ml-auto md:ml-0 md:w-[180px]">
                                            Delivery Date: {safeFormatDate(plan.delivery_date)}
                                        </div>
                                    </div>
                                </div>
                             ))}
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <button onClick={() => setStep("selection")} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
                                <ChevronLeft className="h-4 w-4" /> Back to selection
                            </button>
                            {reviewPlans.map((plan, idx) => (
                                <ReviewPlanCard 
                                    key={plan.name} 
                                    plan={plan} 
                                    index={idx}
                                    vendorOptions={vendorOptions}
                                    onUpdate={(updates) => updateReviewPlan(idx, updates)}
                                    onRemove={() => {
                                        const newPlans = reviewPlans.filter((_, i) => i !== idx);
                                        setReviewPlans(newPlans);
                                        const newNames = new Set(selectedPlanNames);
                                        newNames.delete(plan.name);
                                        setSelectedPlanNames(newNames);
                                        if (newPlans.length === 0) setStep("selection");
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </ScrollArea>

                <div className="p-6 bg-white border-t flex justify-end gap-3 shrink-0">
                    <Button variant="outline" onClick={onClose} className="px-8 bg-white border-gray-200">
                        Cancel
                    </Button>
                    {step === "selection" ? (
                        <Button 
                            className="bg-red-600 hover:bg-red-700 px-8" 
                            disabled={selectedPlanNames.size === 0}
                            onClick={handleContinue}
                        >
                            Continue
                        </Button>
                    ) : (
                        <Button className="bg-red-600 hover:bg-red-700 px-8" onClick={handleSubmit}>
                            Create PO Plan
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

const ReviewPlanCard = ({ plan, index, onUpdate, onRemove, vendorOptions }: { plan: SelectedPlanData, index: number, onUpdate: (updates: Partial<SelectedPlanData>) => void, onRemove: () => void, vendorOptions: any[] }) => {
    
    // Fetch vendor for Existing PO if po_link is present
    const { data: poDoc } = useFrappeGetDoc("Procurement Orders", plan.po_link, (plan.po_type === "Existing PO" && !!plan.po_link) ? undefined : null);

    useEffect(() => {
        if (poDoc && poDoc.vendor && !plan.vendor) {
            onUpdate({ 
                vendor: { value: poDoc.vendor, label: poDoc.vendor_name },
                vendorName: poDoc.vendor_name 
            });
        }
    }, [poDoc, plan.vendor, onUpdate]);

    return (
        <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
            <div className="bg-gray-50/80 px-4 py-2 flex justify-between items-center border-b">
                <span className="font-semibold text-gray-700">Plan {index + 1}</span>
                <button onClick={onRemove} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 md:gap-6 mb-6">
                    <div>
                        <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1 block">Critical PO Category</Label>
                        <div className="text-xs md:text-sm font-semibold text-gray-900">{plan.critical_po_category || "--"}</div>
                    </div>
                    <div>
                        <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1 block">Item</Label>
                        <div className="text-xs md:text-sm font-semibold text-gray-900">{plan.critical_po_task || "--"}</div>
                    </div>
                    <div>
                        <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1 block">PO ID</Label>
                        <div className="text-xs md:text-sm font-semibold text-gray-900 truncate" title={plan.po_link}>{plan.po_link || "--"}</div>
                    </div>
                    <div>
                        <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1 block">PO Type</Label>
                        <Badge variant="outline" className={`${plan.po_type === 'New PO' ? 'bg-orange-50 text-orange-700 border-orange-100' : 'bg-blue-50 text-blue-700 border-blue-100'} text-[10px] px-1.5`}>
                            {plan.po_type}
                        </Badge>
                    </div>
                    <div>
                        <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1 block">Materials</Label>
                        <Badge variant="outline" className="bg-white font-bold text-[10px] px-1.5">{plan.items.length} Items</Badge>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-8 items-center">
                    <span className="text-xs font-bold text-gray-700">Materials ({plan.items.length}):</span>
                    {plan.items.map((it: any, i) => (
                        <div key={i} className="text-[10px] md:text-[11px] px-2 py-0.5 bg-gray-100 text-gray-600 rounded border font-medium">
                            {it.item_name}
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                    {plan.po_type === "New PO" && (
                        <>
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold text-gray-700">Estimate PO Amount <span className="text-red-500">*</span></Label>
                                <Input 
                                    type="number" 
                                    placeholder="Enter estimated price"
                                    className="bg-white"
                                    value={plan.estimatedPrice}
                                    onChange={(e) => onUpdate({ estimatedPrice: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold text-gray-700">Vendor <span className="text-red-500">*</span></Label>
                                <ReactSelect
                                    options={vendorOptions}
                                    value={plan.vendor}
                                    onChange={(val) => onUpdate({ vendor: val, vendorName: val?.label })}
                                    placeholder="Select Vendor..."
                                    className="text-sm"
                                    isClearable
                                />
                            </div>
                        </>
                    )}
                    {plan.po_type === "Existing PO" && (
                        <div className="space-y-2 pointer-events-none opacity-70">
                            <Label className="text-xs font-semibold text-gray-700">Vendor</Label>
                            <Input value={plan.vendorName || "Loading..."} readOnly className="bg-gray-50 text-sm" />
                        </div>
                    )}
                    <div className="space-y-2">
                        <Label className="text-xs font-semibold text-gray-700">Planned Amount <span className="text-red-500">*</span></Label>
                        <Input 
                            type="number" 
                            placeholder="Enter amount"
                            className="bg-white"
                            value={plan.plannedAmount}
                            onChange={(e) => onUpdate({ plannedAmount: e.target.value })}
                        />
                    </div>
                    <div className="space-y-2">
                        <CashflowDatePicker
                            date={plan.plannedDate ? new Date(plan.plannedDate) : undefined}
                            setDate={(date) => {
                                const dateStr = date ? date.toISOString().split('T')[0] : "";
                                onUpdate({ plannedDate: dateStr });
                            }}
                            label="Planned Date"
                            required
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
