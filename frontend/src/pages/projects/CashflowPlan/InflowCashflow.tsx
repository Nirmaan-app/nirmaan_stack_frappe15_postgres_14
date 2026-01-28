import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Trash2, Edit2 } from "lucide-react";
import { AddEditInflowCashflowForm } from "./components/AddEditInflowCashflowForm";
import { useUrlParam } from "@/hooks/useUrlParam";
import { safeFormatDate } from "@/lib/utils";

export const InflowCashflow = () => {
    const { projectId } = useParams<{ projectId: string }>();
    if (!projectId) return <div className="text-red-500">Project ID missing</div>;
    return <InflowCashflowContent projectId={projectId} />;
};

const InflowCashflowContent = ({ projectId }: { projectId: string }) => {
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingPlan, setEditingPlan] = useState<any>(null);
    const { deleteDoc } = useFrappeDeleteDoc();

    // Date Filters
    const activeDurationParam = useUrlParam("planningDuration");
    const startDateParam = useUrlParam("startDate");
    const endDateParam = useUrlParam("endDate");

    const docListFilters = useMemo(() => {
        const filters: any[] = [
            ["project", "=", projectId],
            ["type", "=", "Inflow"]
        ];

        let start = null;
        let end = null;

        if (activeDurationParam && activeDurationParam !== "All") {
             const num = Number(activeDurationParam);
             if (!isNaN(num)) {
                 const today = new Date();
                 start = today;
                 const endDate = new Date(today);
                 endDate.setDate(today.getDate() + num);
                 end = endDate;
             } else if (activeDurationParam === "custom" && startDateParam && endDateParam) {
                 start = new Date(startDateParam);
                 end = new Date(endDateParam);
             }
        }

        if (start && end) {
            filters.push([
                "planned_date", 
                "Between", 
                [format(start, "yyyy-MM-dd"), format(end, "yyyy-MM-dd")]
            ]);
        }
        return filters;
    }, [projectId, activeDurationParam, startDateParam, endDateParam]);

    const { data: plans, isLoading, mutate: refreshPlans } = useFrappeGetDocList("Cashflow Plan", {
        fields: ["name", "remarks", "planned_date", "planned_amount", "creation"],
        filters: docListFilters,
        orderBy: { field: "creation", order: "desc" },
        limit: 0
    });

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
                <div className="flex justify-between items-center mb-6">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <h3 className="text-xl font-bold text-gray-900">Inflow Plan</h3>
                            {plans && (
                                <Badge className="bg-blue-700 hover:bg-blue-800 text-white rounded-full">
                                    {plans.length}
                                </Badge>
                            )}
                        </div>
                        <p className="text-sm text-gray-500">Plan and track incoming funds.</p>
                    </div>
                    {/* Add Button */}
                    {!showAddForm && (
                        <Button 
                            onClick={() => {
                                setEditingPlan(null); // Ensure clean state for new
                                setShowAddForm(true);
                            }} 
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            Add Inflow Plan
                        </Button>
                    )}
                </div>

                <AddEditInflowCashflowForm 
                    isOpen={showAddForm}
                    projectId={projectId}
                    initialData={editingPlan}
                    onClose={() => {
                        setShowAddForm(false);
                        setEditingPlan(null);
                    }}
                    onSuccess={() => {
                        refreshPlans();
                        setShowAddForm(false);
                        setEditingPlan(null);
                    }}
                />

                {/* List Header */}
                <div className="space-y-2">
                    {isLoading && <div className="text-center py-8 text-gray-500">Loading plans...</div>}
                    {!isLoading && plans?.length === 0 && !showAddForm && (
                         <div className="text-center py-12 bg-gray-50/50 rounded-lg border border-dashed">
                            <p className="text-gray-500 mb-4">No Inflow plans found.</p>
                            <Button onClick={() => setShowAddForm(true)}>Create Your First Plan</Button>
                         </div>
                    )}

                    {plans?.map((plan: any, index: number) => {
                        return (
                            <div key={plan.name} className="border rounded-lg bg-white overflow-hidden transition-all hover:shadow-sm">
                                <div className="flex items-center p-4 gap-4">
                                     {/* Toggle Arrow placeholder for alignment if needed, or just padding */}
                                     <div className="w-8 shrink-0 flex justify-center">
                                         <div className="w-6 h-6 bg-gray-100 rounded flex items-center justify-center">
                                             <span className="text-gray-400 text-xs font-medium">
                                                <i className="fa fa-chevron-right opacity-0"></i>
                                                {/* Keeping icon hidden/placeholder or use a simple icon */}
                                                <span className="block w-2 h-2 bg-gray-300 rounded-full"></span>
                                             </span>
                                         </div>
                                     </div>

                                    {/* Plan ID */}
                                    <div className="w-[180px] shrink-0">
                                        <Badge variant="secondary" className="mb-1 text-[10px] text-green-700 bg-green-50 px-1.5 rounded-sm uppercase tracking-wider">
                                            Plan {index + 1}
                                        </Badge>
                                        <div className="font-semibold text-gray-900 text-sm">{plan.name}</div>
                                    </div>

                                    {/* Remarks - Flexible Width */}
                                    <div className="flex-1 min-w-0 pr-4">
                                        <div className="text-[10px] text-gray-500 mb-0.5 font-medium">Remarks</div>
                                        <div className="text-sm text-gray-700 line-clamp-2" title={plan.remarks}>
                                            {plan.remarks || "--"}
                                        </div>
                                    </div>

                                    {/* Planned Amount */}
                                    <div className="w-[150px] shrink-0">
                                        <div className="text-[10px] text-gray-500 mb-0.5 font-medium">Planned Amount</div>
                                        <div className="font-bold text-gray-900">₹ {plan.planned_amount?.toLocaleString() || "0"}</div>
                                    </div>

                                    {/* Planned Date */}
                                    <div className="w-[150px] shrink-0">
                                        <div className="text-[10px] text-gray-500 mb-0.5 font-medium">Planned Date</div>
                                        <div className="font-medium text-gray-900">{safeFormatDate(plan.planned_date)}</div>
                                    </div>

                                    {/* Actions */}
                                    <div className="pl-4 flex items-center gap-1 border-l">
                                         <Button 
                                             variant="ghost" 
                                             size="icon" 
                                             className="h-8 w-8 text-gray-400 hover:text-blue-600"
                                             onClick={() => {
                                                 setEditingPlan(plan);
                                                 setShowAddForm(true);
                                             }}
                                         >
                                             <Edit2 className="w-4 h-4" />
                                         </Button>
                                         <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600" onClick={() => handleDelete(plan.name)}>
                                             <Trash2 className="w-4 h-4" />
                                         </Button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
