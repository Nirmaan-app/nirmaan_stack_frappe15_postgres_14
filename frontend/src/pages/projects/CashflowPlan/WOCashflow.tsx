import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ChevronDown, Trash2, Edit2, ChevronRight, CirclePlus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AddWOCashflowForm } from "./components/AddWOCashflowForm";
import { EditWOCashflowForm } from "./components/EditWOCashflowForm";
import { safeFormatDate } from "@/lib/utils";

// ... imports

export const WOCashflow = ({ dateRange, isOverview }: { dateRange?: { from?: Date; to?: Date }; isOverview?: boolean }) => {
    const { projectId } = useParams<{ projectId: string }>();
    if (!projectId) return <div className="text-red-500">Project ID missing</div>;
    return <WOCashflowContent projectId={projectId} dateRange={dateRange} isOverview={isOverview} />;
};

const WOCashflowContent = ({ projectId, dateRange, isOverview = false }: { projectId: string, dateRange?: { from?: Date; to?: Date }, isOverview?: boolean }) => {
    const [showAddForm, setShowAddForm] = useState(false);
    const [expandedPlans, setExpandedPlans] = useState<string[]>([]);
    const [editingPlan, setEditingPlan] = useState<any>(null);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const { deleteDoc } = useFrappeDeleteDoc();

    const docListFilters = useMemo(() => {
        const filters: any[] = [
            ["project", "=", projectId],
            ["type", "in", ["Existing WO", "New WO"]]
        ];

        if (dateRange?.from && dateRange?.to) {
            filters.push([
                "planned_date", 
                "Between", 
                [format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd")]
            ]);
        }
        return filters;
    }, [projectId, dateRange]);

    const { data: plans, isLoading, mutate: refreshPlans } = useFrappeGetDocList("Cashflow Plan", {
        fields: ["name", "type", "id_link", "planned_date", "planned_amount", "vendor","vendor_name", "remarks", "creation", "estimated_price","items"],
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

    const confirmDelete = async () => {
        if (!deleteId) return;
        try {
            await deleteDoc("Cashflow Plan", deleteId);
            refreshPlans();
            setDeleteId(null);
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white shadow-sm p-4 border rounded-lg">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <h3 className="text-xl font-bold text-gray-900">WO Cashflow</h3>
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
                        <div className="w-full md:w-auto">
                            <Button 
                                onClick={() => setShowAddForm(true)} 
                                className="w-full md:w-auto bg-red-600 hover:bg-red-700 text-white" 
                            >
                                <CirclePlus className="w-4 h-4 mr-2" />
                                Add  Plan
                            </Button>
                        </div>
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
                            <Button onClick={() => setShowAddForm(true)}>
                                <CirclePlus className="w-4 h-4 mr-2" />
                                Create Your First Plan
                            </Button>
                         </div>
                    )}

                    {plans?.map((plan: any, index: number) => {
                        const isExpanded = expandedPlans.includes(plan.name);
                        
                        
                        // Progress Calculation
                        const total = plan.grand_total || plan.estimated_price || 0;
                        const paid = plan.total_paid || 0;
                        // Avoid division by zero
                        const percentage = total > 0 ? Math.min((paid / total) * 100, 100) : 0;

                        return (
                            <div key={plan.name} className="border rounded-lg bg-white overflow-hidden transition-all hover:shadow-sm">
                                <div className="flex flex-col xl:flex-row items-start xl:items-center p-3 gap-3">
                                    {/* Section 1: Dot Indicator, Toggle & Plan Info */}
                                    <div className="flex items-start gap-2 w-full xl:w-[22%] shrink-0">
                                        {/* Orange Dot Indicator */}
                                        <div className="w-8 shrink-0 flex justify-center mt-1">
                                            <div className="w-6 h-6 bg-orange-50 rounded-full flex items-center justify-center">
                                                <span className="block w-2 h-2 bg-orange-500 rounded-full"></span>
                                            </div>
                                        </div>
                                         <button onClick={() => togglePlan(plan.name)} className="mt-1 text-gray-400 hover:text-gray-600 shrink-0">
                                             {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                                         </button>
                                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="secondary" className="bg-orange-50 text-orange-700 hover:bg-orange-100 rounded-sm px-1.5 py-0 text-[10px] font-normal uppercase tracking-wider">
                                                    Plan {index + 1}
                                                </Badge>
                                                <Badge variant={plan.type === "Existing WO" ? "secondary" : "default"} 
                                                    className={`px-1.5 py-0 text-[10px] font-normal ${plan.type === "Existing WO" ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-700"}`}>
                                                    {plan.type}
                                                </Badge>
                                            </div>
                                            <div className="font-semibold text-gray-900 text-sm truncate" title={plan.id_link || plan.remarks || "Untitled"}>
                                                {plan.id_link || "--"}
                                            </div>
                                            {plan.type === "New WO" && plan.remarks && (
                                                <div className="text-[11px] text-gray-500 truncate">{plan.remarks}</div>
                                            )}
                                        </div>
                                    </div>


                                    <div className="w-px h-10 bg-gray-200 hidden xl:block mx-1" />

                                    {/* Section 2: Stats Grid */}
                                    <div className={`grid gap-2 w-full xl:flex-1 shrink-0 ${plan.type === "New WO" ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 lg:grid-cols-3"}`}>
                                        
                                        {/* Estimated Amount (New WO Only) */}
                                        {plan.type === "New WO" && (
                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wide">Estimated WO Amount</span>
                                                <span className="font-semibold text-gray-900 text-sm">
                                                    {plan.estimated_price ? `₹ ${Number(plan.estimated_price).toLocaleString()}` : "--"}
                                                </span>
                                            </div>
                                        )}

                                        {/* Planned Amount */}
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wide">Planned Amount</span>
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

                                         {/* Progress (Mobile) - Commented out as per request
                                         <div className="flex flex-col gap-0.5 md:col-span-4 xl:hidden">
                                            <div className="flex justify-between items-baseline">
                                                 <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wide">Total: ₹ {total.toLocaleString()}</span>
                                                 <span className="text-[10px] text-gray-500">Paid: ₹ {paid.toLocaleString()}</span>
                                            </div>
                                            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-blue-600 rounded-full" style={{ width: `${percentage}%` }}></div>
                                            </div>
                                        </div>
                                        */}
                                    </div>

                                    <div className="w-px h-10 bg-gray-200 hidden xl:block mx-1" />

                                    {/* Section 3: Desktop Progress & Actions */}
                                    <div className="flex items-center justify-between w-full xl:w-auto gap-3 min-w-0">
                                         {/* Desktop Only Progress - Commented out as per request
                                        <div className="hidden xl:flex flex-col items-end gap-0.5 min-w-[120px]">
                                            <div className="text-sm font-bold text-gray-900">₹ {total.toLocaleString()}</div>
                                            <div className="flex items-center gap-2 w-full justify-end">
                                                <span className="text-[10px] text-gray-500 whitespace-nowrap">Paid: ₹ {paid.toLocaleString()}</span>
                                                <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden shrink-0">
                                                    <div className="h-full bg-blue-600 rounded-full" style={{ width: `${percentage}%` }}></div>
                                                </div>
                                            </div>
                                        </div>
                                        */}

                                        {/* Actions */}
                                        {!isOverview && (
                                        <div className="flex items-center gap-1 pl-3 xl:border-l border-gray-100 shrink-0 ml-auto xl:ml-0">
                                             <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-blue-600" onClick={() => setEditingPlan(plan)}>
                                                 <Edit2 className="w-4 h-4" />
                                             </Button>
                                             <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600" onClick={() => setDeleteId(plan.name)}>
                                                 <Trash2 className="w-4 h-4" />
                                             </Button>
                                        </div>
                                        )}
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
                                         {/* {plan.remarks && plan.type !== "New WO" && (
                                            <div className="mt-4 text-xs">
                                                <span className="font-semibold text-gray-700">Remarks: </span>
                                                <span className="text-gray-600">{plan.remarks}</span>
                                            </div>
                                        )} */}
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
            <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This delete can't be undone anywhere. Are you sure you want to delete it?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700 text-white">
                            Confirm
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
