import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Trash2, Edit2, CirclePlus } from "lucide-react";
import { AddEditInflowCashflowForm } from "./components/AddEditInflowCashflowForm";
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

import { safeFormatDate } from "@/lib/utils";

// ... imports

export const InflowCashflow = ({ dateRange, isOverview }: { dateRange?: { from?: Date; to?: Date }; isOverview?: boolean }) => {
    const { projectId } = useParams<{ projectId: string }>();
    if (!projectId) return <div className="text-red-500">Project ID missing</div>;
    return <InflowCashflowContent projectId={projectId} dateRange={dateRange} isOverview={isOverview} />;
};

const InflowCashflowContent = ({ projectId, dateRange, isOverview = false }: { projectId: string, dateRange?: { from?: Date; to?: Date }, isOverview?: boolean }) => {
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingPlan, setEditingPlan] = useState<any>(null);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const { deleteDoc } = useFrappeDeleteDoc();

    const docListFilters = useMemo(() => {
        const filters: any[] = [
            ["project", "=", projectId],
            ["type", "=", "Inflow"]
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
        fields: ["name", "remarks", "planned_date", "planned_amount", "creation"],
        filters: docListFilters,
        orderBy: { field: "creation", order: "desc" },
        limit: 0
    });

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
                        <div className="w-full md:w-auto">
                            <Button 
                                onClick={() => {
                                    setEditingPlan(null); // Ensure clean state for new
                                    setShowAddForm(true);
                                }} 
                                className="w-full md:w-auto bg-red-600 hover:bg-red-700 text-white"
                            >
                                <CirclePlus className="w-4 h-4 mr-2" />
                                Add Plan
                            </Button>
                        </div>
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
                            <Button onClick={() => setShowAddForm(true)} className="bg-red-600 hover:bg-red-700 text-white">
                                <CirclePlus className="w-4 h-4 mr-2" />
                                Create Your First Plan
                            </Button>
                         </div>
                    )}

                    {plans?.map((plan: any, index: number) => {
                        return (
                            <div key={plan.name} className="border rounded-lg bg-white overflow-hidden transition-all hover:shadow-sm">
                                <div className="flex flex-col xl:flex-row items-start xl:items-center p-3 gap-3">
                                     {/* Section 1: Icon & Plan ID */}
                                     <div className="flex items-center gap-3 w-full xl:w-auto shrink-0">
                                        <div className="w-8 shrink-0 flex justify-center">
                                            <div className="w-6 h-6 bg-green-50 rounded-full flex items-center justify-center">
                                                <span className="block w-2 h-2 bg-green-500 rounded-full"></span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex flex-col gap-0.5 min-w-0">
                                            <Badge variant="secondary" className="w-fit mb-0.5 text-[10px] text-green-700 bg-green-50 px-1.5 rounded-sm uppercase tracking-wider">
                                                Plan {index + 1}
                                            </Badge>
                                            <div className="font-semibold text-gray-900 text-sm truncate">{plan.name}</div>
                                        </div>

                                        {/* Mobile Actions (Top Right) to save space? Or stick to bottom. Let's stick to bottom for consistency across components */}
                                     </div>

                                     <div className="w-px h-10 bg-gray-200 hidden xl:block mx-1" />

                                    {/* Section 2: Remarks */}
                                    <div className="w-full xl:flex-1 min-w-0 pr-4">
                                        <div className="xl:hidden text-[10px] text-gray-500 mb-0.5 font-bold uppercase tracking-wide">Remarks</div>
                                        <div className="text-sm text-gray-700 line-clamp-2 md:line-clamp-1 xl:line-clamp-2" title={plan.remarks}>
                                            {plan.remarks || "--"}
                                        </div>
                                    </div>

                                    <div className="w-px h-10 bg-gray-200 hidden xl:block mx-1" />

                                    {/* Section 3: Stats Grid */}
                                    <div className="grid grid-cols-2 gap-4 w-full xl:w-auto shrink-0">
                                        {/* Planned Amount */}
                                        <div className="flex flex-col gap-0.5 min-w-[120px]">
                                            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wide">Planned Amount</span>
                                            <span className="font-bold text-gray-900 text-sm">
                                                {plan.planned_amount ? `₹ ${Number(plan.planned_amount).toLocaleString()}` : "₹ 0"}
                                            </span>
                                        </div>
    
                                        {/* Planned Date */}
                                        <div className="flex flex-col gap-0.5 min-w-[120px]">
                                            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wide">Planned Date</span>
                                            <span className="font-medium text-gray-900 text-sm">
                                                {safeFormatDate(plan.planned_date)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Section 4: Actions */}
                                    {!isOverview && (
                                    <div className="flex items-center gap-1 w-full xl:w-auto justify-end xl:justify-start xl:pl-3 xl:border-l border-gray-100 shrink-0 mt-2 xl:mt-0 pt-2 xl:pt-0 border-t xl:border-t-0">
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
                                         <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600" onClick={() => setDeleteId(plan.name)}>
                                             <Trash2 className="w-4 h-4" />
                                         </Button>
                                    </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

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
