import { useState, useMemo } from "react";
import { useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { format } from "date-fns";
import { safeFormatDate } from "@/lib/utils";
import { Trash2, ChevronDown, Receipt, Package, Edit2 } from "lucide-react"; // Using Receipt icon instead of Package

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AddPOCashflowForm } from "./components/AddPOCashflowForm";
import { FromMaterialPlanDialog } from "./components/FromMaterialPlanDialog";
import { EditPOCashflowForm } from "./components/EditPOCashflowForm";

// const EditPOCashflowForm = ({ plan, onClose, onSuccess }: any) => {
//     console.log("Edit form placeholder", plan, onClose, onSuccess);
//     return <div>Edit Form Here</div>;
// };
import { useParams } from "react-router-dom";


// Helper to safely parse items
const cashFlowJsonToArray = (plan: any): any[] => {
    console.log("plan",plan)
    try {
        const rawItems = plan.items;
         if (!rawItems) return [];
        const parsed = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
        const list = parsed?.list || parsed;
        return Array.isArray(list) ? list : (Array.isArray(parsed) ? parsed : []);
    } catch (e) {
        console.error("Failed to parse items for plan:", plan.name, e);
        return [];
    }
};

interface POCashflowContentProps {
    projectId: string;
    dateRange?: { from?: Date; to?: Date };
    isOverview?: boolean;
}

export const POCashflow = ({ dateRange, isOverview }: { dateRange?: { from?: Date; to?: Date }; isOverview?: boolean }) => {
    const { projectId } = useParams<{ projectId: string }>();
    if (!projectId) return <div className="p-4 text-red-500">Project ID missing</div>;
    return <POCashflowContent projectId={projectId} dateRange={dateRange} isOverview={isOverview} />;
}

const POCashflowContent = ({ projectId, dateRange, isOverview = false }: POCashflowContentProps) => { 

    const { docListFilters } = useMemo(() => {
        const filters: any[] = [["project", "=", projectId], ["type", "in", ["Existing PO","New PO"]]];

        if (dateRange?.from && dateRange?.to) {
            filters.push([
                "planned_date", 
                "Between", 
                [format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd")]
            ]);
        }

        return { docListFilters: filters };
    }, [projectId, dateRange]);

    // Fetch Plans
    const { data: existingPlans, isLoading: isLoadingPlans, mutate: refreshPlans } = useFrappeGetDocList("Cashflow Plan", {
        fields: ["name", "id_link","type", "planned_date", "planned_amount", "creation", "critical_po_category", "critical_po_task", "items", "remarks", "vendor.vendor_name", "estimated_price"],
        filters: docListFilters,
        orderBy: { field: "creation", order: "desc" },
        limit:0
    });


    const [planForms, setPlanForms] = useState<number[]>([]);
    const [expandedPlans, setExpandedPlans] = useState<string[]>([]);
    const [showMaterialDialog, setShowMaterialDialog] = useState(false);
    const [editingPlan, setEditingPlan] = useState<any>(null); // State for editing

    const addPlanForm = () => {
        setPlanForms(prev => [...prev, Date.now()]);
    };

    const removePlanForm = (id: number) => {
        setPlanForms(prev => prev.filter(formId => formId !== id));
    };

    const togglePlan = (name: string) => {
        setExpandedPlans(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
    };

    const { deleteDoc } = useFrappeDeleteDoc();

    const handleDelete = async (name: string) => {
        if (!confirm("Are you sure you want to delete this plan?")) return;
        try {
            await deleteDoc("Cashflow Plan", name);
            refreshPlans();
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white shadow-sm p-4 border rounded-lg">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
                    <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold text-gray-900">PO Cashflow</h3>
                        {existingPlans && (
                            <Badge className="bg-blue-700 hover:bg-blue-800 text-white rounded-full">
                                {existingPlans.length}
                            </Badge>
                        )}
                    </div>
                    <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
                        <Button onClick={() => setShowMaterialDialog(true)} variant="outline" className="w-full md:w-auto bg-gray-50 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700">
                            From Material Plan
                        </Button>
                     {planForms.length === 0 ? (
                        <Button onClick={addPlanForm} className="w-full md:w-auto bg-red-600 hover:bg-red-700 text-white">
                            Add PO Plan
                        </Button>
                     ) : (
                        <Button onClick={addPlanForm} variant="outline" className="w-full md:w-auto bg-gray-50">
                            Add Another Plan
                        </Button>
                     )}
                </div>
                </div>

                

                {/* Render Active Forms Inline */}
                {planForms.length > 0 && (
                    <div className="space-y-4 mb-6">
                        {planForms.map((id, index) => (
                            <AddPOCashflowForm 
                                key={id}
                                projectId={projectId}
                                onClose={() => removePlanForm(id)}
                                onSuccess={() => {
                                    refreshPlans();
                                    removePlanForm(id);
                                }}
                            />
                        ))}
                    </div>
                )}
            
                 {/* List */}
                 <div className="space-y-3">
                    {isLoadingPlans && <div className="text-gray-500 text-center py-4">Loading plans...</div>}
                    {!isLoadingPlans && existingPlans?.length === 0 && (
                        <div className="text-gray-500 text-center py-10 bg-gray-50 rounded-lg border border-dashed">
                            No cashflow plans found for this period.
                        </div>
                    )}

                    {existingPlans?.map((plan: any, _index: number) => {
                        const isExpanded = expandedPlans.includes(plan.name);
                        
                        const itemsList = cashFlowJsonToArray(plan);

                        return (
                            <div key={plan.name} className="border rounded-lg bg-white shadow-sm overflow-hidden transition-all hover:shadow-md">
                                <div className="flex flex-col xl:flex-row items-start xl:items-center p-3 gap-3">
                                    {/* Section 1: Dot Indicator, Toggle & Plan Info */}
                                    <div className="flex items-start gap-2 w-full xl:w-[22%] shrink-0">
                                        {/* Purple Dot Indicator */}
                                        <div className="w-8 shrink-0 flex justify-center mt-1">
                                            <div className="w-6 h-6 bg-blue-50 rounded-full flex items-center justify-center">
                                                <span className="block w-2 h-2 bg-blue-500 rounded-full"></span>
                                            </div>
                                        </div>
                                        <button onClick={() => togglePlan(plan.name)} className="mt-1 text-gray-400 hover:text-gray-600">
                                            <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? "" : "-rotate-90"}`} />
                                        </button>
                                        <div className="flex flex-col gap-0.5 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-sm px-1.5 py-0 text-[10px] font-normal uppercase tracking-wider">
                                                    Plan {_index + 1}
                                                </Badge>
                                                
                                            </div>
                                            <h4 className="font-semibold text-gray-900 leading-tight text-sm truncate" title={plan.critical_po_task}>
                                                {plan.critical_po_task || "Untitled Task"}
                                            </h4>
                                            <span className="text-[11px] text-gray-500 font-medium truncate" title={plan.critical_po_category}>
                                                {plan.critical_po_category || "Uncategorized"}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="w-px h-10 bg-gray-200 hidden xl:block mx-1" />

                                    {/* Section 2: PO Info */}
                                    <div className="flex flex-col gap-1 w-full xl:w-[18%] shrink-0 min-w-0">
                                        <div className="font-medium text-gray-900 text-sm truncate" title={plan.id_link}>
                                           {plan.id_link || "--"}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <Badge variant={plan.type === "Existing PO" ? "secondary" : "default"} 
                                                    className={`px-1.5 py-0 text-[10px] font-normal ${plan.type === "Existing PO" ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-700"}`}>
                                                    {plan.type}
                                                </Badge>
                                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-medium bg-gray-50 text-gray-600 border-gray-200">
                                                {itemsList.length} Items
                                            </Badge>
                                        </div>
                                    </div>

                                    <div className="w-px h-10 bg-gray-200 hidden xl:block mx-1" />

                                    {/* Section 3: Planned Stats */}
                                    <div className={`grid gap-2 w-full xl:flex-1 shrink-0 ${plan.type === "New PO" ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 lg:grid-cols-3"}`}>
                                        
                                        {/* Estimated Amount (New PO Only) */}
                                        {plan.type === "New PO" && (
                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wide">Estimated Amount</span>
                                                <span className="font-semibold text-gray-900 text-sm">
                                                    {plan.estimated_price ? `₹ ${Number(plan.estimated_price).toLocaleString()}` : "--"}
                                                </span>
                                            </div>
                                        )}

                                        {/* Planned Amount */}
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wide">
                                                Planned Amount
                                            </span>
                                            <span className="font-semibold text-gray-900 text-sm">
                                                {plan.planned_amount ? `₹ ${Number(plan.planned_amount).toLocaleString()}` : "--"}
                                            </span>
                                        </div>

                                        {/* Planned Date */}
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wide">Planned Date</span>
                                            <span className="font-semibold text-gray-900 text-sm">
                                                {safeFormatDate(plan.planned_date)}
                                            </span>
                                        </div>

                                        {/* Vendor */}
                                        <div className="flex flex-col gap-0.5 min-w-0">
                                            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wide">Vendor</span>
                                            <span className="font-medium text-gray-900 text-xs truncate" title={plan.vendor_name}>
                                                {plan.vendor_name || "--"}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="w-px h-10 bg-gray-200 hidden xl:block mx-1" />

                                    {/* Section 4: Total & Actions */}
                                    <div className="flex items-center justify-between w-full xl:w-auto gap-3 min-w-0">
                                        {/* Paid Details - Commented out as per request
                                        <div className="flex flex-col items-end gap-0.5 ml-auto xl:ml-0 min-w-0 flex-1">
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-[10px] text-gray-500">Paid:</span>
                                                <span className="text-xs font-medium">₹ 0</span>
                                            </div>
                                            <div className="w-full max-w-[100px] h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-blue-600 w-[0%]" />
                                            </div>
                                        </div>
                                        */}
                                        
                                        {!isOverview && (
                                        <div className="flex items-center gap-1 pl-3 border-l border-gray-100 shrink-0 ml-auto">

                                            <button 
                                                onClick={() => setEditingPlan(plan)} 
                                                className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors hover:bg-blue-50 rounded-md"
                                                title="Edit Plan"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button 
                                                onClick={() => handleDelete(plan.name)} 
                                                className="p-1.5 text-gray-400 hover:text-red-600 transition-colors hover:bg-red-50 rounded-md"
                                                title="Delete Plan"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                        )}
                                    </div>
                                </div>

                                {/* Details (Expanded) - Materials Chips */}
                                {isExpanded && (
                                    <div className="bg-gray-50/50 border-t p-4 pl-4 md:pl-6 pt-2 pb-6 animate-in slide-in-from-top-2 duration-200">
                                        <div className="flex flex-col md:flex-row md:items-start gap-4">
                                            <span className="text-xs font-bold text-gray-800 shrink-0 mt-1.5">
                                                Materials ({itemsList.length}):
                                            </span>
                                            <div className="flex flex-wrap gap-2">
                                                {itemsList.map((item: any, i: number) => (
                                                    <div key={i} className="bg-[#EBE9F8] text-gray-700 text-xs px-2.5 py-1 rounded-md font-medium">
                                                        {item.item_name}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        
                                        {plan.remarks && (
                                            <div className="mt-4 text-xs">
                                                <span className="font-semibold text-gray-700">Remarks: </span>
                                                <span className="text-gray-600">{plan.remarks}</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                 </div>
            </div>

            <FromMaterialPlanDialog 
                isOpen={showMaterialDialog} 
                onClose={() => setShowMaterialDialog(false)}
                projectId={projectId}
                onSuccess={() => {
                    refreshPlans();
                    setShowMaterialDialog(false);
                }}
            />

            <EditPOCashflowForm 
                isOpen={!!editingPlan}
                projectId={projectId}
                plan={editingPlan}
                onClose={() => setEditingPlan(null)}
                onSuccess={() => {
                    refreshPlans();
                    setEditingPlan(null);
                }}
            />
        </div>
    );
};
