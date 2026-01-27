import { useState, useMemo } from "react";
import { useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { format } from "date-fns";
import { safeFormatDate } from "@/lib/utils";
import { Trash2, ChevronDown, Receipt } from "lucide-react"; // Using Receipt icon instead of Package
import { useUrlParam } from "@/hooks/useUrlParam";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AddPOCashflowForm } from "./components/AddPOCashflowForm";

// const EditPOCashflowForm = ({ plan, onClose, onSuccess }: any) => {
//     console.log("Edit form placeholder", plan, onClose, onSuccess);
//     return <div>Edit Form Here</div>;
// };
import { useParams } from "react-router-dom";

export const POCashflow = () => {
    const { projectId } = useParams<{ projectId: string }>();
    
    // Safety check - if no projectId, we can't do much.
    if (!projectId) return <div className="p-4 text-red-500">Project ID missing</div>;

    return <POCashflowContent projectId={projectId} />;
}

interface POCashflowContentProps {
    projectId: string;
}

const POCashflowContent = ({ projectId }: POCashflowContentProps) => {
    const isOverview = false; // We can make this dynamic if needed

    // --- Date/Duration State (Read from URL, same as Material Plan) ---
    const activeDurationParam = useUrlParam("planningDuration");
    const startDateParam = useUrlParam("startDate");
    const endDateParam = useUrlParam("endDate");

    const { docListFilters, activeDuration } = useMemo(() => {
        const filters: any[] = [["project", "=", projectId], ["type", "=", "PO"]]; // Filter by PO type if we use generic Cashflow Plan
        // Wait, does Cashflow Plan have a 'type' field? Yes, I saw it in JSON.
        
        let start = null;
        let end = null;
        let durationVal: any = "All";

        if (activeDurationParam && activeDurationParam !== "All") {
             const num = Number(activeDurationParam);
             if (!isNaN(num)) {
                 durationVal = num;
                 const today = new Date();
                 start = today;
                 const endDate = new Date(today);
                 endDate.setDate(today.getDate() + num);
                 end = endDate;
             } else if (activeDurationParam === "custom") {
                 durationVal = "custom";
                 if (startDateParam && endDateParam) {
                     start = new Date(startDateParam);
                     end = new Date(endDateParam);
                 }
             }
        }

        if (start && end) {
            filters.push([
                "planned_date", 
                "Between", 
                [format(start, "yyyy-MM-dd"), format(end, "yyyy-MM-dd")]
            ]);
        }

        return { docListFilters: filters, activeDuration: durationVal };
    }, [projectId, activeDurationParam, startDateParam, endDateParam]);

    // Fetch Plans
    const { data: existingPlans, isLoading: isLoadingPlans, mutate: refreshPlans } = useFrappeGetDocList("Cashflow Plan", {
        fields: ["name", "id_link", "planned_date", "planned_amount", "creation", "critical_po_category", "critical_po_task", "items", "remarks", "vendor"],
        filters: docListFilters,
        orderBy: { field: "planned_date", order: "asc" }
    });


    const [planForms, setPlanForms] = useState<number[]>([]);
    const [expandedPlans, setExpandedPlans] = useState<string[]>([]);

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
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold text-gray-900">PO Cashflow</h3>
                        {existingPlans && (
                            <Badge className="bg-blue-700 hover:bg-blue-800 text-white rounded-full">
                                {existingPlans.length}
                            </Badge>
                        )}
                    </div>
                </div>

                <div className="flex mb-6">
                     {planForms.length === 0 ? (
                        <Button onClick={addPlanForm} className="bg-red-600 hover:bg-red-700 text-white">
                            Add PO Plan
                        </Button>
                     ) : (
                        <Button onClick={addPlanForm} variant="outline" className="bg-gray-50">
                            Add Another Plan
                        </Button>
                     )}
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
                        
                        return (
                            <div key={plan.name} className="border rounded-lg bg-white shadow-sm overflow-hidden transition-all">
                                <div className="flex flex-col md:flex-row items-center p-4 gap-4">
                                    {/* Toggle & ID */}
                                    <div className="flex items-center gap-3 w-full md:w-auto shrink-0">
                                        <button onClick={() => togglePlan(plan.name)} className="text-gray-400 hover:text-gray-600">
                                            <ChevronDown className={`w-5 h-5 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                                        </button>
                                        <div className="flex items-center gap-2">
                                            <Receipt className="w-5 h-5 text-gray-600" />
                                            <span className="font-semibold text-gray-800">Plan {_index + 1}</span>
                                        </div>
                                        <div className="h-4 w-px bg-gray-300 hidden md:block" />
                                    </div>

                                    {/* Columns */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 w-full text-sm">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-gray-500 uppercase">PO Link</span>
                                            <span className="font-medium text-blue-600 truncate" title={plan.id_link}>{plan.id_link || "--"}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-gray-500 uppercase">Vendor</span>
                                            <span className="font-medium text-gray-800 truncate">{plan.vendor || "--"}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-gray-500 uppercase">Planned Date</span>
                                            <span className="font-medium text-gray-800">{safeFormatDate(plan.planned_date)}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-gray-500 uppercase">Amount</span>
                                            <span className="font-medium text-green-700">
                                                {plan.planned_amount ? `₹${Number(plan.planned_amount).toLocaleString()}` : "--"}
                                            </span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-gray-500 uppercase">Task</span>
                                            <span className="font-medium text-gray-700 truncate">{plan.critical_po_task || "--"}</span>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2 ml-auto">
                                        <button onClick={() => handleDelete(plan.name)} className="text-gray-400 hover:text-red-600 p-2">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Details (Expanded) */}
                                {isExpanded && (
                                    <div className="bg-gray-50 p-4 border-t text-sm">
                                        <div className="mb-2 font-medium text-gray-700">Remarks: {plan.remarks || "None"}</div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                 </div>
            </div>
        </div>
    );
};
