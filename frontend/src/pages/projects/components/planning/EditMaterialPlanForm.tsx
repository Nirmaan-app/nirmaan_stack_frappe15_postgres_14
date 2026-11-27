import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";

import { X, Search, Calendar, CheckCircle2, Lock, Link2, Pencil } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FuzzySearchSelect, type TokenSearchConfig } from "@/components/ui/fuzzy-search-select";
import { useProcurementOrderDoc } from "@/pages/projects/data/material-plan/useMaterialPlanQueries";
import { useFetchAllPOs, useUpdateMaterialDeliveryPlan } from "@/pages/projects/data/material-plan/useMaterialPlanMutations";
import { criticalFieldsForPO, isLinkedToPlanTask, poLinkUpdate, posForPicker, poTaskLabel, sortPOsForPlan, type ProjectPO } from "@/utils/materialPlan/poLink";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MATERIAL_PROCUREMENT_PROFILES, PMO_EXECUTIVE_PROFILE } from "@/constants/roles";
import { REMARKS_REQUIRED_MESSAGE, remarksMissing, remarksRequired as isRemarksRequired, remarksToSave } from "@/utils/materialPlan/planRemarks";

const ADMIN_ROLE = "Nirmaan Admin Profile";
const DELIVERY_STATUS_AUTHORIZED_ROLES = [ADMIN_ROLE, PMO_EXECUTIVE_PROFILE, ...MATERIAL_PROCUREMENT_PROFILES];

/** The Link / Change PO picker searches the PO number and the vendor (the label holds both). */
const PO_SEARCH_CONFIG: TokenSearchConfig = {
    searchFields: ["label", "value"],
    partialMatch: true,
    fieldWeights: { value: 2.0, label: 1.5 },
};

interface EditMaterialPlanFormProps {
    plan: any;
    /** The plan's project; the plan list does not load `project`, and Link / Change PO lists this project's POs. */
    projectId: string;
    onClose: () => void;
    onSuccess: () => void;
}

export const EditMaterialPlanForm = ({ plan, projectId, onClose, onSuccess }: EditMaterialPlanFormProps) => {
    
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
    // Admin + PMO can edit everything; Procurement can only change delivery_status.
    const canEditAll = isAdmin || role === PMO_EXECUTIVE_PROFILE;

    type DeliveryStatus = "Delivered" | "Not Delivered" | "Partially Delivered";

    // State
    const [deliveryDate, setDeliveryDate] = useState<string>(plan.delivery_date || "");
    const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus>(
        plan.delivery_status === "Delivered"
            ? "Delivered"
            : plan.delivery_status === "Partially Delivered"
                ? "Partially Delivered"
                : "Not Delivered"
    );
    const [remarks, setRemarks] = useState<string>(plan.remarks || "");
    const remarksRequired = isRemarksRequired(deliveryStatus);
    const remarksInvalid = remarksMissing(deliveryStatus, remarks);
    
    // --- Existing PO State ---
    // Map of PO item row name -> boolean (for selection). The plan's own items start ticked.
    const initialSelection = React.useMemo(() => {
        const initial: Record<string, boolean> = {};
        if (!isNewPO) initialItems.forEach((i: any) => { initial[i.name] = true; });
        return initial;
    }, [initialItems, isNewPO]);
    const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>(initialSelection);

    const [searchTerm, setSearchTerm] = useState("");
    // Fetch Full PO Data using standard Doc fetch (Only for Existing PO)
    const { data: poDoc, isLoading: isLoadingPO } = useProcurementOrderDoc(
        !isNewPO ? plan.po_link : null,
        !isNewPO
    );

    // --- Link PO (New PO plan) / Change PO (Existing PO plan) — Admin + PMO; rules in utils/materialPlan/poLink ---
    const [poPickerOpen, setPoPickerOpen] = useState(false);
    const [showAllPOs, setShowAllPOs] = useState(false); // "See all project POs" (default: the task's own, like Add)
    const [targetPOName, setTargetPOName] = useState<string | null>(null);
    const { fetchAllPOs, allPOsResult, isLoadingAllPOs } = useFetchAllPOs();
    const projectPOs = React.useMemo<ProjectPO[]>(
        () => sortPOsForPlan(allPOsResult?.message?.pos, plan),
        [allPOsResult, plan]
    );
    const taskPOCount = React.useMemo(() => posForPicker(projectPOs, plan, false).length, [projectPOs, plan]);
    const targetPO = targetPOName ? projectPOs.find((po) => po.name === targetPOName) ?? null : null;
    // Picking the plan's own PO again is no change.
    const poChanged = !!targetPO && targetPO.name !== plan.po_link;
    // "PO/105/… · Vendor · 4 items"; in the all-POs list a PO of another task also names that task.
    const poLabel = React.useCallback((po: ProjectPO) => [
        po.name,
        po.vendor_name,
        `${po.items?.length ?? 0} item${(po.items?.length ?? 0) === 1 ? "" : "s"}`,
        showAllPOs && !isLinkedToPlanTask(po, plan) ? `task: ${poTaskLabel(po)}` : null,
    ].filter(Boolean).join(" · "), [showAllPOs, plan]);
    const poOptions = React.useMemo(
        () => posForPicker(projectPOs, plan, showAllPOs).map((po) => ({ value: po.name, label: poLabel(po) })),
        [projectPOs, plan, showAllPOs, poLabel]
    );
    const nextCritical = targetPO ? criticalFieldsForPO(targetPO, plan) : null;
    const taskWillChange = poChanged && !!nextCritical && (
        nextCritical.critical_po_task !== (plan.critical_po_task || null) ||
        nextCritical.critical_po_category !== (plan.critical_po_category || null)
    );

    const openPOPicker = () => {
        setPoPickerOpen(true);
        if (!allPOsResult) fetchAllPOs({ project: projectId });
    };
    const pickPO = (poName: string) => {
        setTargetPOName(poName);
        // The old items belong to the old PO (or were typed in): start the new PO with nothing ticked.
        setSelectedItems(poName === plan.po_link ? initialSelection : {});
        setSearchTerm("");
    };
    const cancelPOPicker = () => {
        setPoPickerOpen(false);
        setShowAllPOs(false);
        setTargetPOName(null);
        setSelectedItems(initialSelection);
        setSearchTerm("");
    };

    // Derived PO Items: the picked PO's items while linking/changing, else the plan's own PO.
    const poItems = React.useMemo(() => {
        if (poChanged && targetPO) return targetPO.items ?? [];
        if (poDoc && Array.isArray(poDoc.items)) {
            return poDoc.items;
        }
        return [];
    }, [poDoc, poChanged, targetPO]);
    // The typed-in materials list shows only for a New PO plan that is not being linked.
    const showManualItems = isNewPO && !poChanged;

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
    const itemsInvalid = canEditAll && (showManualItems ? manualItemsCount === 0 : selectedCount === 0);
    const isConfirmDisabled = isUpdating || itemsInvalid || (canEditDeliveryStatus && remarksInvalid);

    const handleConfirm = async () => {
        // Procurement-only path: only delivery_status changes; skip all date/items validation.
        if (!canEditAll) {
            if (remarksInvalid) {
                toast({
                    title: "Validation Error",
                    description: REMARKS_REQUIRED_MESSAGE,
                    variant: "destructive",
                });
                return;
            }
            try {
                await updateMaterialPlan(plan.name, {
                    delivery_status: deliveryStatus,
                    remarks: remarksToSave(remarks),
                });
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

        if (showManualItems) {
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
            const updatePayload: any = poChanged && targetPO
                // Link PO / Change PO: the plan moves onto the picked PO (type, PO, ticked items, task fields).
                ? { delivery_date: deliveryDate, ...poLinkUpdate(targetPO, (row) => !!selectedItems[row], plan) }
                : { delivery_date: deliveryDate, mp_items: JSON.stringify({ list: itemsToSave }) };
            // Only authorized roles can change delivery_status; others' value is ignored server-side anyway
            if (canEditDeliveryStatus) {
                if (remarksInvalid) {
                    toast({
                        title: "Validation Error",
                        description: REMARKS_REQUIRED_MESSAGE,
                        variant: "destructive",
                    });
                    return;
                }
                updatePayload.delivery_status = deliveryStatus;
                updatePayload.remarks = remarksToSave(remarks);
            }
            await updateMaterialPlan(plan.name, updatePayload);
            toast({
                title: "Success",
                description: poChanged && targetPO
                    ? `Material plan ${isNewPO ? "linked to" : "moved to"} ${targetPO.name}`
                    : "Material plan updated successfully",
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

                        {/* PO ID — the ✏️ opens Link PO (New PO plan) / Change PO (Existing PO plan); Admin + PMO.
                            A picked, unsaved PO shows highlighted here until Confirm. */}
                        {canEditAll && !poPickerOpen ? (
                            <button
                                type="button"
                                onClick={openPOPicker}
                                title={isNewPO ? "Link PO" : "Change PO"}
                                aria-label={`PO: ${poChanged && targetPO ? targetPO.name : (plan.po_link || "N/A")}. ${isNewPO ? "Link PO" : "Change PO"}`}
                                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors hover:border-blue-300 hover:bg-blue-50 ${poChanged ? "border-blue-300 bg-blue-50 text-blue-700" : "text-gray-500 border-gray-200"}`}
                            >
                                PO: {poChanged && targetPO ? targetPO.name : (plan.po_link || "N/A")}
                                <Pencil className="w-3 h-3 text-blue-600" aria-hidden="true" />
                            </button>
                        ) : (
                            <Badge
                                variant="outline"
                                className={`font-medium whitespace-nowrap ${poChanged ? "border-blue-300 bg-blue-50 text-blue-700" : "text-gray-500 border-gray-200"}`}
                                title={poChanged ? `Not saved yet (was ${plan.po_link || "New PO"})` : undefined}
                            >
                                PO: {poChanged && targetPO ? targetPO.name : (plan.po_link || "N/A")}
                            </Badge>
                        )}

                        {/* PO Type */}
                        <Badge
                            variant="outline"
                            className={`font-medium whitespace-nowrap ${poChanged ? "border-blue-300 bg-blue-50 text-blue-700" : "text-gray-500 border-gray-200"}`}
                        >
                            {poChanged ? "Existing PO" : (plan.po_type || "--")}
                        </Badge>
                    </div>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto space-y-6 flex-1">

                    {/* Link / Change PO picker — opened by the ✏️ beside the PO in the header (Admin + PMO).
                        Like Add Material Plan: the plan's task POs by default, "See all project POs" for the rest. */}
                    {canEditAll && poPickerOpen && (
                        <div className="space-y-3 p-3 border border-blue-200 rounded-lg bg-blue-50/30">
                            <Label className="flex items-center gap-2 font-bold text-gray-700">
                                <Link2 className="w-4 h-4" />
                                {isNewPO ? "Link a PO" : "Change PO"}
                            </Label>
                            {allPOsResult && !showAllPOs && taskPOCount === 0 ? (
                                <p className="text-sm text-gray-600">
                                    No POs are linked to this plan's task{plan.critical_po_task ? ` (${plan.critical_po_task})` : ""}.
                                </p>
                            ) : (
                                <FuzzySearchSelect
                                    allOptions={poOptions}
                                    tokenSearchConfig={PO_SEARCH_CONFIG}
                                    value={targetPO ? { value: targetPO.name, label: poLabel(targetPO) } : null}
                                    onChange={(option) => option && pickPO(option.value)}
                                    isLoading={isLoadingAllPOs}
                                    placeholder="Search PO number or vendor…"
                                    aria-label="Pick the PO for this plan"
                                    menuPortalTarget={document.body}
                                    menuPosition="fixed"
                                />
                            )}
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-gray-500">
                                <span>
                                    {showAllPOs
                                        ? `All ${projectPOs.length} project POs; this task's own are listed first.`
                                        : allPOsResult
                                            ? `${taskPOCount} PO${taskPOCount === 1 ? "" : "s"} linked to this plan's task${plan.critical_po_task ? ` (${plan.critical_po_task})` : ""}.`
                                            : "Loading POs…"}
                                </span>
                                {allPOsResult && (
                                    <button
                                        type="button"
                                        onClick={() => setShowAllPOs((v) => !v)}
                                        className="font-medium text-blue-700 hover:underline"
                                    >
                                        {showAllPOs ? "Show only this task's POs" : "See all project POs"}
                                    </button>
                                )}
                            </div>
                            {isNewPO && initialItems.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                    <span className="font-semibold text-gray-700">You planned:</span>
                                    {initialItems.map((item: { item_name?: string }, i: number) => (
                                        <span key={i} className="px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-700">
                                            {item.item_name}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {taskWillChange && nextCritical && (
                                <p className="text-[11px] text-amber-700">
                                    This PO is linked to another task, so the plan's task will change to{" "}
                                    <span className="font-semibold">
                                        {nextCritical.critical_po_category} / {nextCritical.critical_po_task}
                                    </span>.
                                </p>
                            )}
                            <p className="text-[11px] text-gray-500">
                                Then tick the items from that PO below; the plan keeps only the ticked items.
                            </p>
                            <button
                                type="button"
                                onClick={cancelPOPicker}
                                className="text-xs font-medium text-gray-600 hover:text-gray-900 underline"
                            >
                                {isNewPO ? "Keep it as New PO" : "Keep the current PO"}
                            </button>
                        </div>
                    )}

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
                            onValueChange={(v) => setDeliveryStatus(v as DeliveryStatus)}
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
                                <SelectItem value="Partially Delivered">
                                    <span className="inline-flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                                        Partially Delivered
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

                    {/* Remarks — always shown; required only when Partially Delivered */}
                    <div className="space-y-2">
                        <Label className="flex items-center gap-2 font-bold text-gray-700">
                            Remarks
                            {remarksRequired ? (
                                <span className="text-red-600">*</span>
                            ) : (
                                <span className="font-normal text-gray-400">(optional)</span>
                            )}
                            {!canEditDeliveryStatus && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                                    <Lock className="w-3 h-3" /> Read-only
                                </span>
                            )}
                        </Label>
                        <textarea
                            placeholder={
                                remarksRequired
                                    ? "Describe what was delivered and what is still pending…"
                                    : "Any note for this plan"
                            }
                            value={remarks}
                            onChange={(e) => setRemarks(e.target.value)}
                            disabled={!canEditDeliveryStatus}
                            className={`w-full h-24 p-3 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
                                !canEditDeliveryStatus
                                    ? "bg-gray-50 text-gray-500 cursor-not-allowed border-gray-300"
                                    : remarksInvalid
                                        ? "border-red-300 focus:ring-red-500"
                                        : "border-gray-300"
                            }`}
                        />
                        {canEditDeliveryStatus && remarksInvalid ? (
                            <p className="text-[11px] text-red-600 font-medium">
                                {REMARKS_REQUIRED_MESSAGE}
                            </p>
                        ) : remarksRequired ? (
                            <p className="text-[10px] text-gray-500">
                                Mention the items / quantities that were delivered vs. still pending.
                            </p>
                        ) : null}
                    </div>

                    <div className="h-px bg-gray-100" />

                    {showManualItems ? (
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
                                {!poChanged && isLoadingPO ? (
                                    <div className="p-8 text-center text-gray-500">Loading items...</div>
                                ) : filteredItems.length === 0 ? (
                                    <div className="p-8 text-center text-gray-500">
                                        {searchTerm ? `No items found matching "${searchTerm}"` : "This PO has no items."}
                                    </div>
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
                        title={itemsInvalid ? (showManualItems ? "Add at least one material line" : "Select at least one item") : undefined}
                        className="px-6 py-2 bg-red-600 rounded-lg text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed disabled:hover:bg-gray-300"
                    >
                        {isUpdating ? "Updating..." : "Confirm"}
                    </button>
                </div>

            </div>
        </div>
    );
};
