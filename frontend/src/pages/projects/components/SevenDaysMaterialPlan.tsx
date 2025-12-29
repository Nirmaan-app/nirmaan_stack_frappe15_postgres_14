import React, { useState, useMemo } from "react";
import { useFrappeGetCall, useFrappeGetDoc, useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { format } from "date-fns";
import { Loader2, AlertCircle, ChevronDown, ChevronUp, Package, Calendar, Trash2 } from "lucide-react";
// import { Badge } from "@/components/ui/badge"; // Commented out as unused in snippet
import { AddMaterialPlanForm } from "./AddMaterialPlanForm";
import { EditMaterialPlanForm } from "./EditMaterialPlanForm";
import { useToast } from "@/components/ui/use-toast";
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

interface SevenDaysMaterialPlanProps {
    projectId: string;
}


export const SevenDaysMaterialPlan = ({ projectId }: SevenDaysMaterialPlanProps) => {
    
    // State for Material Plans Form
    const [materialPlanForms, setMaterialPlanForms] = useState<number[]>([]);
    const [editingPlan, setEditingPlan] = useState<any>(null); // State for Edit Modal

    const { toast } = useToast();
    const { deleteDoc } = useFrappeDeleteDoc();

    const [deleteDialogState, setDeleteDialogState] = useState<{
        isOpen: boolean;
        planName: string | null;
    }>({
        isOpen: false,
        planName: null,
    });

    const confirmDelete = async () => {
        if (deleteDialogState.planName) {
            try {
                await deleteDoc("Material Delivery Plan", deleteDialogState.planName);
                toast({
                    title: "Success",
                    description: "Plan deleted successfully",
                    variant: "default", // Using default as successful green variant might not be defined in toast types
                });
                refreshPlans();
            } catch (error: any) {
                toast({
                    title: "Error",
                    description: error.message || "Failed to delete plan",
                    variant: "destructive",
                });
            } finally {
                setDeleteDialogState({ isOpen: false, planName: null });
            }
        }
    };

    const addPlanForm = () => {
        setMaterialPlanForms(prev => [...prev, Date.now()]);
    };

    const removePlanForm = (id: number) => {
        setMaterialPlanForms(prev => prev.filter(formId => formId !== id));
    };

    // 1. Fetch Project Document
    const { data: projectDoc } = useFrappeGetDoc("Projects", projectId);

    // 2. Fetch Existing Material Delivery Plans
    const { data: existingPlans, isLoading: isLoadingPlans, mutate: refreshPlans } = useFrappeGetDocList("Material Delivery Plan", {
        fields: ["name", "po_link", "package_name", "delivery_date", "mp_items", "creation"],
        filters: [["project", "=", projectId]],
        orderBy: { field: "creation", order: "desc" }
    });

    // Extract unique packages from child table for Options
    const projectPackages = useMemo(() => {
        if (!projectDoc?.project_wp_category_makes) return [];
        const pkgs = new Set<string>();
        projectDoc.project_wp_category_makes.forEach((row: any) => {
            if (row.procurement_package) pkgs.add(row.procurement_package);
        });
        return Array.from(pkgs).sort();
    }, [projectDoc]);

    return (
        <div className="space-y-6">
             {/* Material Plan Intro / Actions Header */}
            <div className="border border-blue-100 rounded-lg p-6 bg-white shadow-sm">
                <h2 className="text-lg font-bold text-gray-900 mb-2">Material Plan</h2>
                <p className="text-sm text-gray-600 mb-4">
                    Materials must already exist inside an existing PO. New POs should only be created if materials are not available in existing POs.
                </p>
                <div className="flex">
                    {materialPlanForms.length === 0 ? (
                        <button 
                            onClick={addPlanForm}
                            className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded transition-colors text-sm"
                        >
                            Add Material Plan
                        </button>
                    ) : (
                        <button 
                            onClick={addPlanForm}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 px-4 rounded transition-colors text-sm border border-gray-300"
                        >
                            Add Another Plan
                        </button>
                    )}
                </div>
            </div>
            
            {/* Render Active Forms */}
            {materialPlanForms.length > 0 && (
                <div className="space-y-4">
                     {materialPlanForms.map((id, index) => (
                        <AddMaterialPlanForm 
                            key={id} 
                            planNumber={index + 1} 
                            projectId={projectId}
                            projectPackages={projectPackages}
                            onClose={() => {
                                removePlanForm(id);
                                refreshPlans(); // Refresh list after closing/submitting
                            }} 
                        />
                    ))}
                </div>
            )}

            {/* Render Edit Form Modal */}
            {editingPlan && (
                <EditMaterialPlanForm 
                    plan={editingPlan}
                    onClose={() => setEditingPlan(null)}
                    onSuccess={() => {
                        refreshPlans();
                        // setEditingPlan(null); // Closed by onClose already
                    }}
                />
            )}

            {/* List Existing Plans */}
            <div className="space-y-3">
                
                {isLoadingPlans && (
                    <div className="text-gray-500 text-sm">Loading plans...</div>
                )}
                
                {!isLoadingPlans && (!existingPlans || existingPlans.length === 0) && (
                    <div className="text-gray-500 text-sm italic">No material delivery plans found.</div>
                )}

                {existingPlans?.map((plan: any, index: number) => {
                    // Parse mp_items safely to get count
                    let itemsCount = 0;
                    try {
                        const rawItems = plan.mp_items;
                        const parsed = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
                        const items = parsed?.list || parsed; 
                        if (Array.isArray(items)) itemsCount = items.length;
                    } catch (e) {
                         // ignore errors
                    }

                    // Calculate Plan Number (Oldest is Plan 1 if we sort desc)
                    // existingPlans is sorted desc by creation. So:
                    // Index 0 = Plan (Length)
                    // Index Last = Plan 1
                    const planNum = existingPlans.length - index;

                    return (
                        <div key={plan.name} className="flex border border-gray-200 rounded-lg bg-white overflow-hidden shadow-sm h-24">
                            {/* Left: Plan Number Block */}
                            <div className="w-24 bg-indigo-50 flex flex-col items-center justify-center border-r border-indigo-100 shrink-0">
                                <Package className="h-6 w-6 text-gray-700 mb-1" />
                                <span className="font-semibold text-gray-700 text-lg">Plan {planNum}</span>
                            </div>

                            {/* Right: Details Grid */}
                            <div className="flex-1 grid grid-cols-12 items-center px-4 gap-4">
                                <div className="col-span-3 flex flex-col justify-center">
                                    <span className="text-xs font-bold text-gray-900">Work Package</span>
                                    <span className="text-sm text-gray-700 truncate" title={plan.package_name}>{plan.package_name}</span>
                                </div>
                                <div className="col-span-2 flex flex-col justify-center">
                                    <span className="text-xs font-bold text-gray-900">PO ID</span>
                                    <span className="text-sm text-gray-700 truncate" title={plan.po_link}>{plan.po_link}</span>
                                </div>
                                <div className="col-span-2 flex flex-col justify-center">
                                    <span className="text-xs font-bold text-gray-900">PO Type</span>
                                    <span className="text-sm text-gray-700">Existing PO</span>
                                </div>
                                <div className="col-span-2 flex flex-col justify-center items-start">
                                    <span className="text-xs font-bold text-gray-900 mb-1">Materials</span>
                                    <div className="bg-blue-100 text-blue-700 text-xs font-medium px-3 py-1 rounded-full border border-blue-200">
                                        {itemsCount} Items
                                    </div>
                                </div>
                                <div className="col-span-2 flex flex-col justify-center">
                                    <span className="text-xs font-bold text-gray-900">Delivery Date</span>
                                    <span className="text-sm text-gray-700">
                                        {plan.delivery_date ? format(new Date(plan.delivery_date), "dd/MM/yyyy") : "-"}
                                    </span>
                                </div>
                                <div className="col-span-1 flex flex-col justify-center items-center">
                                    <span className="text-xs font-bold text-gray-900 mb-1">Action</span>
                                    <div className="flex items-center gap-2 text-gray-400">
                                       <button 
                                            onClick={() => setEditingPlan(plan)}
                                            className="hover:text-gray-600"
                                       >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                       </button>
                                       <button 
                                            className="hover:text-red-600"
                                            onClick={() => setDeleteDialogState({ isOpen: true, planName: plan.name })}
                                       >
                                           <Trash2 className="w-4 h-4" />
                                       </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            
            <AlertDialog open={deleteDialogState.isOpen} onOpenChange={(open) => setDeleteDialogState(prev => ({ ...prev, isOpen: open }))}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the Material Plan.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};