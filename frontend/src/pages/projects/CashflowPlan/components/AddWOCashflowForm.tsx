import { useState, useMemo } from "react";
import { FolderOpen, Plus, X, Calendar as CalendarIcon, Edit2, Trash2, Folder, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SelectWOModal } from "./SelectWOModal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import Select from "react-select";
import { useFrappeGetDocList, useFrappeCreateDoc } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { CashflowDatePicker } from "./CashflowDatePicker";

interface GenericWO {
    name: string;
    vendor: string;
    vendor_name: string;
    grand_total: number;
    total_paid: number;
    items?: any[];
}

interface WOPlanItem extends GenericWO {
    planned_amount: string;
    planned_date: Date | undefined;
    temp_id: number;
}

interface AddWOCashflowFormProps {
    projectId: string;
    onClose: () => void;
    onSuccess: () => void;
}

export const AddWOCashflowForm = ({ projectId, onClose, onSuccess }: AddWOCashflowFormProps) => {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState<"existing" | "new">("existing");
    const [isSelectModalOpen, setIsSelectModalOpen] = useState(false);
    
    // Existing WO State
    const [selectedPlans, setSelectedPlans] = useState<WOPlanItem[]>([]);

    // New WO State
    const [newPlan, setNewPlan] = useState({
        vendor: null as { value: string, label: string } | null,
        description: "",
        estimated_value: "",
        planned_amount: "",
        planned_date: undefined as Date | undefined
    });
    const [isCustomVendor, setIsCustomVendor] = useState(false);

    const { data: vendors, isLoading: isLoadingVendors } = useFrappeGetDocList("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 0
    });

    const vendorOptions = useMemo(() => [
        ...(vendors || []).map(v => ({ value: v.name, label: v.vendor_name })),
        { label: "Others", value: "__others__" }
    ], [vendors]);

    const { createDoc, loading: isSubmitting } = useFrappeCreateDoc();

    // Handlers
    const handleConfirmSelection = (wos: GenericWO[]) => {
        const newItems: WOPlanItem[] = wos.map(wo => ({
            ...wo,
            planned_amount: "", // Default empty
            planned_date: undefined,
            temp_id: Date.now() + Math.random()
        }));
        setSelectedPlans(prev => [...prev, ...newItems]);
    };

    const updatePlanItem = (id: number, field: keyof WOPlanItem, value: any) => {
        setSelectedPlans(prev => prev.map(item => 
            item.temp_id === id ? { ...item, [field]: value } : item
        ));
    };

    const removePlanItem = (id: number) => {
        setSelectedPlans(prev => prev.filter(item => item.temp_id !== id));
    };

    const handleSubmitExisting = async () => {
        // Validate
        const validPlans = selectedPlans.filter(p => p.planned_amount && p.planned_date);
        if (validPlans.length === 0) {
            toast({ title: "Error", description: "Please fill in amount and date for at least one plan.", variant: "destructive" });
            return;
        }

        let successCount = 0;
        for (const plan of validPlans) {
            try {
                await createDoc("Cashflow Plan", {
                    project: projectId,
                    type: "Existing WO",
                    id_link: plan.name,
                    planned_amount: parseFloat(plan.planned_amount),
                  
                    planned_date: format(plan.planned_date!, "yyyy-MM-dd"),
                    vendor: plan.vendor,
                    vendor_name: plan.vendor_name,
                    grand_total: plan.grand_total, // Store snapshot
                    total_paid: plan.total_paid,
                    items: JSON.stringify({ list: plan.items || [] })
                });
                successCount++;
            } catch (e) {
                console.error("Failed to create plan", plan.name, e);
            }
        }

        if (successCount > 0) {
            toast({ title: "Success", description: `Created ${successCount} plans.` });
            onSuccess();
            onClose();
        } else {
            toast({ title: "Error", description: "Failed to create plans.", variant: "destructive" });
        }
    };

    const handleSubmitNew = async () => {
        if (!newPlan.vendor) {
            toast({
                title: "Missing Vendor",
                description: "Review your fields! Vendor selection is mandatory.",
                variant: "destructive"
            });
            return;
        }

        if (!newPlan.description.trim()) {
            toast({
                title: "Missing Description",
                description: "Review your fields! Please enter a work order description.",
                variant: "destructive"
            });
            return;
        }

        if (!newPlan.estimated_value || parseFloat(newPlan.estimated_value) <= 0) {
            toast({
                title: "Incomplete Data",
                description: "Review your fields! Estimated Value is mandatory and must be greater than 0.",
                variant: "destructive"
            });
            return;
        }

        if (!newPlan.planned_amount || parseFloat(newPlan.planned_amount) <= 0) {
             toast({
                title: "Missing Planned Amount",
                description: "Review your fields! Planned Amount is mandatory and must be greater than 0.",
                variant: "destructive"
            });
            return;
        }

        if (!newPlan.planned_date) {
             toast({
                title: "Missing Planned Date",
                description: "Review your fields! Planned Date is mandatory.",
                variant: "destructive"
            });
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        const plannedDateStr = format(newPlan.planned_date, "yyyy-MM-dd");
        if (plannedDateStr < today) {
            toast({
                title: "Invalid Date",
                description: "Planned Date cannot be in the past.",
                variant: "destructive"
            });
            return;
        }

        try {
            await createDoc("Cashflow Plan", {
                project: projectId,
                type: "New WO",
                vendor: isCustomVendor ? "" : newPlan.vendor.value,
                vendor_name: newPlan.vendor.label,
                estimated_price: parseFloat(newPlan.estimated_value),
                planned_amount: parseFloat(newPlan.planned_amount),
                planned_date: plannedDateStr,
                items: JSON.stringify({ list: [{ description: newPlan.description, category: "" }] })
            });
            toast({ title: "Success", description: "Created new WO plan." });
            onSuccess();
            onClose();
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Failed to create plan.", variant: "destructive" });
        }
    };

    return (
        <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b flex justify-between items-center bg-gray-50/50">
                 <h3 className="font-semibold text-gray-900">Add WO Cashflow Plan</h3>
                 <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 hover:bg-gray-200 rounded-full">
                     <X className="w-4 h-4" />
                 </Button>
            </div>

            <div className="p-4 bg-white min-h-[300px]">
                <div className="space-y-4 mb-6">
                    <Label className="text-sm font-semibold text-gray-900">WO Type</Label>
                    <RadioGroup
                        value={activeTab}
                        onValueChange={(val) => setActiveTab(val as "existing" | "new")}
                        className="flex items-center gap-6"
                    >
                        <div className="flex items-center gap-2">
                            <RadioGroupItem value="existing" id="existing" />
                            <Label htmlFor="existing" className="cursor-pointer font-normal">Use Existing WO</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <RadioGroupItem value="new" id="new" />
                            <Label htmlFor="new" className="cursor-pointer font-normal">Create New WO</Label>
                        </div>
                    </RadioGroup>
                </div>
                {activeTab === "existing" ? (
                    <div className="space-y-6">
                        {selectedPlans.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                                <div className="p-4 bg-gray-100 rounded-full">
                                    <Folder className="w-8 h-8 text-gray-400" />
                                </div>
                                <div className="space-y-1">
                                    <h3 className="font-semibold text-gray-900">No Work Orders Selected</h3>
                                    <p className="text-sm text-gray-500">Select Work Orders from your project to create cash flow plan</p>
                                </div>
                                <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setIsSelectModalOpen(true)}>
                                    Select Work Orders
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {selectedPlans.map((plan, index) => (
                                    <div key={plan.temp_id} className="border rounded-lg overflow-hidden bg-white shadow-sm">
                                         {/* Plan Header */}
                                         <div className="flex justify-between items-center px-4 py-2 bg-slate-100/80 border-b">
                                            <span className="font-semibold text-gray-700 text-sm">Plan {index + 1}</span>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-red-600" onClick={() => removePlanItem(plan.temp_id)}>
                                                <X className="w-4 h-4" />
                                            </Button>
                                         </div>
                                         
                                         {/* Plan Body */}
                                         <div className="p-4 flex flex-col lg:flex-row gap-6 items-stretch">
                                             {/* Left: Inputs */}
                                             <div className="w-full lg:w-5/12 flex flex-col sm:flex-row gap-4 p-4 border rounded-lg bg-white shadow-sm">
                                                 <div className="flex-1 space-y-2">
                                                     <Label className="text-sm font-medium text-gray-700">Planned Amount <span className="text-red-500">*</span></Label>
                                                     <div className="relative">
                                                         <span className="absolute left-3 top-2 text-gray-500">₹</span>
                                                         <Input 
                                                            type="number" 
                                                            className="pl-7 bg-white" 
                                                            value={plan.planned_amount}
                                                            onChange={(e) => updatePlanItem(plan.temp_id, "planned_amount", e.target.value)}
                                                         />
                                                     </div>
                                                 </div>
                                                  <div className="flex-1 space-y-2">
                                                      <CashflowDatePicker
                                                            date={plan.planned_date}
                                                            setDate={(date) => updatePlanItem(plan.temp_id, "planned_date", date)}
                                                            label="Planned Date"
                                                            required
                                                      />
                                                  </div>
                                             </div>

                                             {/* Right: Details */}
                                             <div className="w-full lg:w-7/12 bg-white p-4 rounded-lg border shadow-sm grid grid-cols-3 gap-6 items-center">
                                                 <div>
                                                     <span className="block text-xs text-gray-500 font-semibold mb-1">WO ID</span>
                                                     <span className="font-semibold text-gray-900 text-sm">{plan.name}</span>
                                                 </div>
                                                 <div>
                                                     <span className="block text-xs text-gray-500 font-semibold mb-1">Vendor</span>
                                                     <span className="text-gray-900 font-medium truncate block text-sm" title={plan.vendor_name}>{plan.vendor_name}</span>
                                                 </div>
                                                 <div>
                                                     <span className="block text-xs text-gray-500 font-semibold mb-1">Total (Incl. GST)</span>
                                                     <span className="text-gray-900 font-medium text-sm">₹ {plan.grand_total?.toLocaleString()}</span>
                                                 </div>
                                             </div>
                                         </div>
                                    </div>
                                ))}

                                <div className="flex justify-end gap-3 pt-2">
                                    <Button variant="outline" onClick={onClose} className="bg-white">
                                        Cancel
                                    </Button>
                                    <Button 
                                        className="bg-red-600 hover:bg-red-700 text-white"
                                        onClick={handleSubmitExisting}
                                        disabled={isSubmitting}
                                    >
                                        <CheckCircle className="w-4 h-4 mr-2" />
                                        {isSubmitting ? "Creating..." : selectedPlans.length > 1 ? "Create All Plan" : "Create Plan"}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    // NEW WO FORM
                     <div className="space-y-6">
                         <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>Vendor <span className="text-red-500">*</span></Label>
                                {isCustomVendor ? (
                                    <div className="space-y-2">
                                        <Input
                                            placeholder="Enter custom vendor name"
                                            value={newPlan.vendor?.label || ""}
                                            onChange={(e) => setNewPlan({ ...newPlan, vendor: { value: "", label: e.target.value } })}
                                            className="h-9 text-sm"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setIsCustomVendor(false);
                                                setNewPlan({ ...newPlan, vendor: null });
                                            }}
                                            className="text-xs text-gray-500 hover:text-gray-700 h-6 px-2"
                                        >
                                            ← Back to Vendor list
                                        </Button>
                                    </div>
                                ) : (
                                    <Select 
                                        options={vendorOptions}
                                        value={newPlan.vendor}
                                        onChange={(option) => {
                                            if (option?.value === "__others__") {
                                                setIsCustomVendor(true);
                                                setNewPlan({ ...newPlan, vendor: { value: "", label: "" } });
                                            } else {
                                                setNewPlan({ ...newPlan, vendor: option });
                                            }
                                        }}
                                        placeholder="Select Vendor"
                                        className="text-sm"
                                        isLoading={isLoadingVendors}
                                        filterOption={(option, inputValue) => {
                                             if (option.data.value === "__others__") return true;
                                             return option.label.toLowerCase().includes(inputValue.toLowerCase());
                                        }}
                                        styles={{
                                             control: (base) => ({ ...base, minHeight: '36px', height: '36px', fontSize: '0.875rem' }),
                                             option: (base, state) => ({
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
                                             menuList: (base) => ({ ...base, paddingBottom: 0 })
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

                            <div className="space-y-2">
                                <Label>Work Order Description <span className="text-red-500">*</span></Label>
                                <Textarea 
                                    placeholder="Write a short description" 
                                    className="resize-none"
                                    value={newPlan.description}
                                    onChange={(e) => setNewPlan({...newPlan, description: e.target.value})}
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                     <Label>Estimated WO Amount <span className="text-red-500">*</span></Label>
                                     <div className="relative">
                                         <span className="absolute left-3 top-2 text-gray-500">₹</span>
                                         <Input 
                                            type="number" 
                                            className="pl-7" 
                                            value={newPlan.estimated_value}
                                            onChange={(e) => setNewPlan({...newPlan, estimated_value: e.target.value})}
                                         />
                                     </div>
                                </div>
                                <div className="space-y-2">
                                     <Label>Planned Amount <span className="text-red-500">*</span></Label>
                                     <div className="relative">
                                         <span className="absolute left-3 top-2 text-gray-500">₹</span>
                                         <Input 
                                            type="number" 
                                            className="pl-7" 
                                            value={newPlan.planned_amount}
                                            onChange={(e) => setNewPlan({...newPlan, planned_amount: e.target.value})}
                                         />
                                     </div>
                                </div>
                                <div className="space-y-2">
                                      <CashflowDatePicker
                                        date={newPlan.planned_date}
                                        setDate={(date) => setNewPlan({...newPlan, planned_date: date})}
                                        label="Planned Date"
                                        required
                                      />
                                </div>
                            </div>
                         </div>

                         <div className="flex justify-end gap-3 pt-4 border-t mt-6 bg-gray-50 -mx-4 -mb-4 p-4">
                                <Button variant="outline" onClick={onClose} className="bg-white">
                                    Cancel
                                </Button>
                                <Button 
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                    onClick={handleSubmitNew}
                                    disabled={
                                        isSubmitting || 
                                        !newPlan.vendor || 
                                        !newPlan.description.trim() || 
                                        !newPlan.estimated_value || 
                                        !newPlan.planned_amount || 
                                        !newPlan.planned_date
                                    }
                                >
                                    <CheckCircle className="w-4 h-4 mr-2" />
                                    {isSubmitting ? "Creating..." : "Create Plan"}
                                </Button>
                         </div>
                    </div>
                )}
            </div>

            <SelectWOModal 
                isOpen={isSelectModalOpen} 
                onClose={() => setIsSelectModalOpen(false)} 
                projectId={projectId}
                onConfirm={handleConfirmSelection}
            />
        </div>
    );
};
