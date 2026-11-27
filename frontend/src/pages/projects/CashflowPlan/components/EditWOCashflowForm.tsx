import { useState, useEffect, useMemo } from "react";
import { CheckCircle } from "lucide-react";
import { useCashflowProjectWOs, useCashflowVendors } from "@/pages/projects/data/cashflow-plan/useCashflowPlanQueries";
import { useUserData } from "@/hooks/useUserData";
import { canEditCashflowPlan } from "@/constants/roles";
import { cashflowWOLinkUpdate, woOptionLabel, type ProjectWO } from "@/utils/cashflowPlan/cashflowLink";
import { EditableLinkBadge, LinkPickerPanel } from "@/pages/projects/components/planning/LinkPicker";
import { useUpdateCashflowPlan } from "@/pages/projects/data/cashflow-plan/useCashflowPlanMutations";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import Select from "react-select";
import { CashflowDatePicker } from "./CashflowDatePicker";

interface EditWOCashflowFormProps {
    isOpen: boolean;
    projectId: string;
    plan: any; // The Cashflow Plan document
    onClose: () => void;
    onSuccess: () => void;
}

export const EditWOCashflowForm = ({ isOpen, projectId, plan, onClose, onSuccess }: EditWOCashflowFormProps) => {
    const { toast } = useToast();
    const { updateCashflow, loading: isUpdating } = useUpdateCashflowPlan();
    const isExistingWO = plan?.type === "Existing WO";

    // --- Link WO (New WO entry) / Change WO (Existing WO entry) — Admin + PMO; the server refuses anyone else
    //     (CashflowPlan.validate). Rules in utils/cashflowPlan/cashflowLink. ---
    const { role, user_id } = useUserData();
    const canChangeWO = canEditCashflowPlan(role, user_id);
    const [woPickerOpen, setWoPickerOpen] = useState(false);
    const [targetWOName, setTargetWOName] = useState<string | null>(null);
    const { call: fetchProjectWOs, result: woResult, loading: isLoadingWOs } = useCashflowProjectWOs();
    const projectWOs: ProjectWO[] = useMemo(() => woResult?.message?.wos || [], [woResult]);
    const targetWO = targetWOName ? projectWOs.find((wo) => wo.name === targetWOName) ?? null : null;
    // Picking the entry's own WO again is no change.
    const woChanged = !!targetWO && targetWO.name !== plan?.id_link;
    // The description and estimated value belong to a New WO entry that is not being linked.
    const showNewWOFields = !isExistingWO && !woChanged;

    // State
    const [plannedAmount, setPlannedAmount] = useState<string>("");
    const [plannedDate, setPlannedDate] = useState<Date | undefined>(undefined);
    
 

    // New WO specific
    const [description, setDescription] = useState("");
    const [estimatedValue, setEstimatedValue] = useState("");
    const [vendor, setVendor] = useState<{ value: string, label: string } | null>(null);
    const [isCustomVendor, setIsCustomVendor] = useState(false);

    // Fetch Vendors for edit (enabled for all types)
    const { data: vendors, isLoading: isLoadingVendors } = useCashflowVendors(isOpen);

    const vendorOptions = useMemo(() => [
        ...(vendors || []).map((v: any) => ({ value: v.name, label: v.vendor_name })),
        { label: "Others", value: "__others__" }
    ], [vendors]);

    // Initialize/Reset State
    useEffect(() => {
        if (isOpen && plan) {
            setPlannedAmount(plan.planned_amount?.toString() || "");
            setPlannedDate(plan.planned_date ? new Date(plan.planned_date) : undefined);

            if (!isExistingWO) {
                // New WO initialization
                let desc = plan.remarks || "";
                // Fallback to items if remarks is empty
                if (!desc && plan.items) {
                    try {
                        const raw = plan.items;
                        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        const list = data?.list || (Array.isArray(data) ? data : []);
                        if (list.length > 0 && list[0].description) {
                            desc = list[0].description;
                        }
                    } catch (e) {
                         console.error("Failed to parse items for description", e);
                    }
                }
                setDescription(desc);
                setEstimatedValue(plan.estimated_price?.toString() || "");
                if (plan.vendor || plan.vendor_name) {
                    // Check if existing vendor ID (starts with VEND usually or matches list)
                    // Simple check: if vendor ID is empty but name exists -> custom
                    if (!plan.vendor && plan.vendor_name) {
                        setIsCustomVendor(true);
                        setVendor({ value: "", label: plan.vendor_name });
                    } else {
                        setIsCustomVendor(false);
                        setVendor({ 
                            value: plan.vendor, 
                            label: plan.vendor_name || plan.vendor // fallback
                        });
                    }
                }
            } else {
                // Existing WO - also populate vendor
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
    }, [isOpen, plan, isExistingWO]);

    // Update vendor label when options load if needed
    // Update vendor label when options load if needed
    useEffect(() => {
        if (vendors && plan?.vendor && !isCustomVendor) {
            const found = vendors.find((v: any) => v.name === plan.vendor);
            if (found) {
                setVendor({ value: found.name, label: found.vendor_name });
            }
        }
    }, [vendors, plan, isCustomVendor]);

    const openWOPicker = () => {
        setWoPickerOpen(true);
        if (!woResult) fetchProjectWOs({ project: projectId });
    };
    const pickWO = (woName: string) => {
        setTargetWOName(woName);
        const wo = projectWOs.find((w) => w.name === woName);
        // The vendor follows the picked WO (still editable, as on any Existing WO entry).
        if (wo && woName !== plan?.id_link) {
            setIsCustomVendor(!wo.vendor);
            setVendor({ value: wo.vendor || "", label: wo.vendor_name || wo.vendor || "" });
        }
    };
    const keepCurrentWO = () => {
        setWoPickerOpen(false);
        setTargetWOName(null);
        if (plan) {
            setIsCustomVendor(!plan.vendor && !!plan.vendor_name);
            setVendor(plan.vendor || plan.vendor_name ? { value: plan.vendor || "", label: plan.vendor_name || plan.vendor } : null);
        }
    };

    const handleSubmit = async () => {
        if (!plannedAmount || parseFloat(plannedAmount) < 1) {
            toast({ title: "Invalid Amount", description: "Amount must be at least 1", variant: "destructive" });
            return;
        }


        if (!vendor) {
             toast({ title: "Missing Vendor", description: "Vendor is required", variant: "destructive" });
             return;
        }

        const updateData: any = {
            planned_amount: parseFloat(plannedAmount),
            planned_date: plannedDate ? format(plannedDate, "yyyy-MM-dd") : "",
            vendor: isCustomVendor ? "" : vendor.value,
            vendor_name: vendor.label
        };

        if (woChanged && targetWO) {
            // Link / Change WO: type, WO, all its descriptions, no estimated value.
            Object.assign(updateData, cashflowWOLinkUpdate(targetWO));
        } else if (isExistingWO) {
             // For existing WO, we don't update items as they are read-only
        } else {
            // New WO specific fields
            if (!description.trim()) {
                toast({ title: "Missing Description", description: "Description is required", variant: "destructive" });
                return;
            }
             if (!estimatedValue || parseFloat(estimatedValue) < 1) {
                toast({ title: "Invalid Estimated Value", description: "Estimated Value must be at least 1", variant: "destructive" });
                return;
            }

            // updateData.remarks = description;
            updateData.estimated_price = parseFloat(estimatedValue);
            // Also update the single item description if we store it that way for New WO
            updateData.items = JSON.stringify({ list: [{ description: description, category: "" }] });
        }

        try {
            await updateCashflow(plan.name, updateData);
            toast({
                title: "Success",
                description: woChanged && targetWO
                    ? `WO Cashflow Plan ${isExistingWO ? "moved to" : "linked to"} ${targetWO.name}.`
                    : "WO Cashflow Plan updated.",
            });
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
                            Edit WO Cashflow Plan-
                        </DialogTitle>
                        <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-sm font-normal">
                             {plan?.name}
                        </Badge>
                    </div>
                </div>

                <div className="px-6 py-3 bg-gray-50/50 border-b flex flex-wrap gap-2 text-xs">
                    <span className={`px-2 py-1 border rounded ${woChanged ? "border-blue-300 bg-blue-50 text-blue-700" : "bg-white text-gray-600"}`}>
                        Type: {woChanged ? "Existing WO" : plan?.type}
                    </span>
                    {/* WO ID — the ✏️ inside opens Link WO (New WO) / Change WO (Existing WO); Admin + PMO. */}
                    <EditableLinkBadge
                        text={`WO ID: ${woChanged && targetWO ? targetWO.name : (plan?.id_link || "N/A")}`}
                        changed={woChanged}
                        canEdit={canChangeWO && !woPickerOpen}
                        editLabel={isExistingWO ? "Change WO" : "Link WO"}
                        onEdit={openWOPicker}
                        changedHint={`Not saved yet (was ${plan?.id_link || "New WO"})`}
                    />
                </div>

                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* Link / Change WO picker — opened by the ✏️ in the WO ID badge (Admin + PMO). */}
                    {canChangeWO && woPickerOpen && (
                        <LinkPickerPanel
                            title={isExistingWO ? "Change WO" : "Link a WO"}
                            options={projectWOs.map((wo) => ({ value: wo.name, label: woOptionLabel(wo) }))}
                            value={targetWO ? { value: targetWO.name, label: woOptionLabel(targetWO) } : null}
                            onPick={pickWO}
                            isLoading={isLoadingWOs}
                            placeholder="Search WO number or vendor…"
                            ariaLabel="Pick the WO for this entry"
                            emptyMessage={woResult && projectWOs.length === 0 ? "This project has no work orders yet." : null}
                            summary={woResult ? `${projectWOs.length} work order${projectWOs.length === 1 ? "" : "s"} on this project.` : "Loading WOs…"}
                            plannedItems={!isExistingWO && description ? [description] : undefined}
                            footnote="The entry takes all of the picked WO's descriptions; the planned amount and date stay as they are."
                            keepLabel={isExistingWO ? "Keep the current WO" : "Keep it as New WO"}
                            onKeep={keepCurrentWO}
                        />
                    )}

                    {/* Vendor Field (Now for both Existing and New) */}
                    <div className="space-y-2">
                        <Label>Vendor</Label>
                        {isCustomVendor ? (
                            <div className="space-y-2">
                                <Input
                                    placeholder="Enter custom vendor name"
                                    value={vendor?.label || ""}
                                    onChange={(e) => setVendor({ value: "", label: e.target.value })}
                                    className="h-9 text-sm"
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
                            <Select 
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
                                placeholder="Select vendor"
                                className="text-sm"
                                isLoading={isLoadingVendors}
                                maxMenuHeight={200}
                                filterOption={(option: any, inputValue: any) => {
                                        if (option.data.value === "__others__") return true;
                                        return option.label.toLowerCase().includes(inputValue.toLowerCase());
                                }}
                                styles={{
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

                    {/* New WO Specific Description */}
                    {showNewWOFields && (
                        <div className="space-y-2">
                            <Label>Description <span className="text-red-500">*</span></Label>
                            <Textarea 
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Description"
                                className="resize-none"
                            />
                        </div>
                    )}

                    {/* The picked WO's descriptions (what the entry will hold after Confirm) */}
                    {woChanged && targetWO && (
                        <div className="space-y-2">
                            <Label>Description ({targetWO.items?.length ?? 0})</Label>
                            <div className="flex flex-wrap gap-2">
                                {(targetWO.items ?? []).map((item, i) => (
                                    <div key={i} className="bg-[#EBE9F8] text-gray-700 text-xs px-2.5 py-1 rounded-md font-medium">
                                        {item.description}
                                        {item.category && <span className="ml-1 text-gray-500 font-normal">({item.category})</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Amount Fields Grid */}
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
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (parseFloat(val) < 0) return;
                                        setPlannedAmount(val);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "-" || e.key === "e") e.preventDefault();
                                    }}
                                    min={1}
                                    className="pl-7"
                                    placeholder="Enter amount"
                                />
                            </div>
                        </div>

                        {showNewWOFields && (
                            <div className="space-y-2">
                                <Label className="text-sm font-bold text-gray-900 flex items-center gap-2">
                                    Estimated WO Amount <span className="text-red-500">*</span>
                                </Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2 text-gray-500">₹</span>
                                    <Input 
                                        type="number"
                                        value={estimatedValue}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (parseFloat(val) < 0) return;
                                            setEstimatedValue(val);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "-" || e.key === "e") e.preventDefault();
                                        }}
                                        min={1}
                                        className="pl-7"
                                        placeholder="Enter estimated value"
                                     
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <CashflowDatePicker
                            date={plannedDate}
                            setDate={setPlannedDate}
                            label="Planned Date"
                            required
                        />
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
                        <CheckCircle className="w-4 h-4 mr-2" />
                        {isUpdating ? "Saving..." : "Confirm"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
