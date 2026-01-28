import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ChevronDown, Trash2, Edit2, ChevronRight } from "lucide-react";
import { AddWOCashflowForm } from "./components/AddWOCashflowForm";
import { EditWOCashflowForm } from "./components/EditWOCashflowForm";
import { useUrlParam } from "@/hooks/useUrlParam";
import { safeFormatDate } from "@/lib/utils";

export const WOCashflow = () => {
    const { projectId } = useParams<{ projectId: string }>();
    if (!projectId) return <div className="text-red-500">Project ID missing</div>;
    return <WOCashflowContent projectId={projectId} />;
};

const WOCashflowContent = ({ projectId }: { projectId: string }) => {
    const [showAddForm, setShowAddForm] = useState(false);
    const [expandedPlans, setExpandedPlans] = useState<string[]>([]);
    const [editingPlan, setEditingPlan] = useState<any>(null);
    const { deleteDoc } = useFrappeDeleteDoc();

    // Date Filters
    const activeDurationParam = useUrlParam("planningDuration");
    const startDateParam = useUrlParam("startDate");
    const endDateParam = useUrlParam("endDate");

    const docListFilters = useMemo(() => {
        const filters: any[] = [
            ["project", "=", projectId],
            ["type", "in", ["Existing WO", "New WO"]]
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
        fields: ["name", "type", "id_link", "planned_date", "planned_amount", "vendor","vendor.vendor_name", "remarks", "creation", "estimated_price","items"],
        filters: docListFilters,
        orderBy: { field: "creation", order: "desc" },
        limit: 0
    });

    // We also need vendor names. We can fetch them or map them if `vendor` field is just ID.
    // Usually standard `useFrappeGetDocList` doesn't auto-fetch linked names unless requested `vendor.vendor_name`.
    // Let's optimize by fetching vendor name directly.
    

    const togglePlan = (name: string) => {
        setExpandedPlans(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
    };

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
                            <h3 className="text-xl font-bold text-gray-900">Work Order Plan</h3>
                            {plans && (
                                <Badge className="bg-blue-700 hover:bg-blue-800 text-white rounded-full">
                                    {plans.length}
                                </Badge>
                            )}
                        </div>
                        <p className="text-sm text-gray-500">Create and manage cash flow plans for work orders</p>
                    </div>
                    {/* Add Button - only show if no forms active? logic from PO cashflow */}
                    {!showAddForm && (
                        <Button 
                            onClick={() => setShowAddForm(true)} 
                            className="bg-red-600 hover:bg-red-700 text-white" // Using standard color from image
                        >
                            Add Another Plan
                        </Button>
                    )}
                </div>

                {showAddForm && (
                    <div className="mb-6 animate-in slide-in-from-top-2">
                        <AddWOCashflowForm 
                            projectId={projectId}
                            onClose={() => setShowAddForm(false)}
                            onSuccess={() => {
                                refreshPlans();
                                setShowAddForm(false);
                            }}
                        />
                    </div>
                )}

                {/* List Header */}
                <div className="space-y-2">
                    {isLoading && <div className="text-center py-8 text-gray-500">Loading plans...</div>}
                    {!isLoading && plans?.length === 0 && !showAddForm && (
                         <div className="text-center py-12 bg-gray-50/50 rounded-lg border border-dashed">
                            <p className="text-gray-500 mb-4">No Work Order plans found.</p>
                            <Button onClick={() => setShowAddForm(true)}>Create Your First Plan</Button>
                         </div>
                    )}

                    {plans?.map((plan: any, index: number) => {
                        const isExpanded = expandedPlans.includes(plan.name);
                        const vendorName =plan.vendor_name||"--";
                        
                        // Progress Calculation
                        const total = plan.grand_total || plan.estimated_price || 0;
                        const paid = plan.total_paid || 0;
                        // Avoid division by zero
                        const percentage = total > 0 ? Math.min((paid / total) * 100, 100) : 0;

                        return (
                            <div key={plan.name} className="border rounded-lg bg-white overflow-hidden transition-all hover:shadow-sm">
                                <div className="flex items-center p-4 gap-4">
                                     <button onClick={() => togglePlan(plan.name)} className="text-gray-400 hover:text-gray-600">
                                         {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                                     </button>

                                    {/* Plan ID / Name */}
                                    <div className="w-[200px] shrink-0">
                                        <Badge variant="secondary" className="mb-1 text-[10px] text-blue-700 bg-blue-50 px-1.5 rounded-sm uppercase tracking-wider">
                                            Plan {index + 1}
                                        </Badge>
                                        <div className="font-semibold text-gray-900 text-sm truncate" title={plan.id_link || plan.remarks || "Untitled"}>
                                            {plan.id_link || plan.remarks || "Untitled Plan"}
                                        </div>
                                        {/* Subtext description if new WO */}
                                        {plan.type === "New WO" && plan.remarks && (
                                            <div className="text-xs text-gray-500 truncate">{plan.remarks}</div>
                                        )}
                                    </div>

                                    {/* Type Badge */}
                                    <div className="w-[120px] shrink-0">
                                        <div className="text-[10px] text-gray-500 mb-0.5 font-medium">WO Type</div>
                                        <Badge variant={plan.type === "Existing WO" ? "secondary" : "default"} 
                                            className={plan.type === "Existing WO" ? "bg-blue-100 text-blue-700 hover:bg-blue-200" : "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"}>
                                            {plan.type}
                                        </Badge>
                                    </div>

                                    {/* Planned Amount */}
                                    <div className="w-[120px] shrink-0">
                                        <div className="text-[10px] text-gray-500 mb-0.5 font-medium">Planned Amount</div>
                                        <div className="font-semibold text-gray-900">₹ {plan.planned_amount?.toLocaleString()}</div>
                                    </div>

                                    {/* Planned Date */}
                                    <div className="w-[120px] shrink-0">
                                        <div className="text-[10px] text-gray-500 mb-0.5 font-medium">Planned Date</div>
                                        <div className="font-medium text-gray-900">{safeFormatDate(plan.planned_date)}</div>
                                    </div>

                                     {/* Vendor */}
                                     <div className="w-[180px] shrink-0 flex-1 min-w-0">
                                        <div className="text-[10px] text-gray-500 mb-0.5 font-medium">Vendor</div>
                                        <div className="font-medium text-gray-900 truncate" title={vendorName}>{vendorName}</div>
                                    </div>

                                    {/* Progress / Total */}
                                    <div className="w-[180px] shrink-0 text-right">
                                        <div className="text-sm font-bold text-gray-900">₹ {total.toLocaleString()}</div>
                                        <div className="flex items-center justify-end gap-2 mt-1">
                                            <span className="text-[10px] text-gray-500">Paid: ₹ {paid.toLocaleString()}</span>
                                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-blue-600 rounded-full" style={{ width: `${percentage}%` }}></div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="pl-4 flex items-center gap-1 border-l">
                                         <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-blue-600" onClick={() => setEditingPlan(plan)}>
                                             <Edit2 className="w-4 h-4" />
                                         </Button>
                                         <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600" onClick={() => handleDelete(plan.name)}>
                                             <Trash2 className="w-4 h-4" />
                                         </Button>
                                    </div>
                                </div>
                                
                                {/* Detail Panel for specific breakdowns if needed */}
                                {isExpanded && (
                                    <div className="bg-gray-50/50 border-t p-4 pl-4 md:pl-6 pt-2 pb-6 animate-in slide-in-from-top-2 duration-200">
                                        {(() => {
                                            try {
                                                const itemsData = plan.items ? (typeof plan.items === 'string' ? JSON.parse(plan.items) : plan.items) : { list: [] };
                                                const itemsList = itemsData.list || [];
                                                
                                                if (itemsList.length > 0) {
                                                    return (
                                                        <div className="flex flex-col md:flex-row md:items-start gap-4">
                                                            <span className="text-xs font-bold text-gray-800 shrink-0 mt-1.5">
                                                                Description ({itemsList.length}):
                                                            </span>
                                                            <div className="flex flex-wrap gap-2">
                                                                {itemsList.map((item: any, i: number) => (
                                                                    <div key={i} className="bg-[#EBE9F8] text-gray-700 text-xs px-2.5 py-1 rounded-md font-medium">
                                                                        {item.description}
                                                                        {item.category && <span className="ml-1 text-gray-500 font-normal">({item.category})</span>}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                } else if (plan.remarks) {
                                                     // Fallback if no items but remarks exist
                                                     return (
                                                        <div className="mt-2 text-xs">
                                                            <span className="font-semibold text-gray-700">Description: </span>
                                                            <span className="text-gray-600">{plan.remarks}</span>
                                                        </div>
                                                     );
                                                } else {
                                                    return <div className="italic text-gray-400 text-xs">No details available</div>;
                                                }
                                            } catch (e) {
                                                console.error("Failed to parse items", e);
                                                return plan.remarks ? (
                                                    <div className="mt-2 text-xs">
                                                        <span className="font-semibold text-gray-700">Description: </span>
                                                        <span className="text-gray-600">{plan.remarks}</span>
                                                    </div>
                                                ) : null;
                                            }
                                        })()}
                                        
                                        {/* Show remarks if different from the single item description (optional, but keeping consistent with user request to show remarks too if needed? User snippet showed it. For New WO remarks IS description. Let's show it only if it's NOT New WO or if items list is empty?) 
                                           Actually, user snippet shows remarks at bottom. Let's keep it but maybe we can suppress if it's just duplicating? 
                                           Let's keep it simple and follow the snippet structure, but I will put it inside the Try block flow or after. 
                                           The user snippet had both items loop AND remarks.
                                        */}
                                         {plan.remarks && plan.type !== "New WO" && (
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
            {/* Edit Dialog */}
            <EditWOCashflowForm 
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
