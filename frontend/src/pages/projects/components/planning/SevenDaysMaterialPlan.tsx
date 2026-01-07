import React, { useState, useMemo } from "react";
import { useFrappeGetCall, useFrappeGetDoc, useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { format } from "date-fns";
import { safeFormatDate } from "@/lib/utils";
import { Loader2, AlertCircle, ChevronDown, ChevronUp, Package, Calendar, Trash2, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    startDate?: Date;
    endDate?: Date;
    isOverview?: boolean;
    projectName?: string;
}

// Helper to safely parse mp_items
const getMaterialItems = (plan: any): any[] => {
    try {
        const rawItems = plan.mp_items;
        if (!rawItems) return [];
        const parsed = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
        const list = parsed?.list || parsed;
        return Array.isArray(list) ? list : (Array.isArray(parsed) ? parsed : []);
    } catch (e) {
        console.error("Failed to parse material items for plan:", plan.name, e);
        return [];
    }
};


export const SevenDaysMaterialPlan = ({ projectId, startDate, endDate, isOverview, projectName }: SevenDaysMaterialPlanProps) => {
    
    // State for Material Plans Form
    const [materialPlanForms, setMaterialPlanForms] = useState<number[]>([]);
    const [editingPlan, setEditingPlan] = useState<any>(null); // State for Edit Modal
    const [expandedPlans, setExpandedPlans] = useState<string[]>([]); // State for Collapsible Rows

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

    const togglePlan = (planName: string) => {
        setExpandedPlans(prev => 
            prev.includes(planName) 
                ? prev.filter(p => p !== planName) 
                : [...prev, planName]
        );
    };

    const [isDownloading, setIsDownloading] = useState(false);

    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsDownloading(true);
        try {
            const formatName = "Project Material Plan"; 
            
            const params = new URLSearchParams({
                doctype: "Projects",
                name: projectId,
                format: formatName,
                no_letterhead: "0",
                _lang: "en",
            });

            if (startDate) {
                params.append("start_date", format(startDate, "yyyy-MM-dd"));
            }
            if (endDate) {
                params.append("end_date", format(endDate, "yyyy-MM-dd"));
            }

            const url = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
            
            const response = await fetch(url);
            if (!response.ok) throw new Error("Network response was not ok");
        
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            const safeProjectName = (projectName || projectDoc?.project_name || projectId).replace(/ /g, "_");
            link.download = `MaterialPlan_${safeProjectName}_${format(new Date(), "dd-MMM-yyyy")}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            console.error("Download failed:", error);
            toast({
                title: "Download Failed",
                description: "Could not download the Material Plan PDF. Please check if the Print Format exists.",
                variant: "destructive",
            });
        } finally {
            setIsDownloading(false);
        }
    };

    // 1. Fetch Project Document
    const { data: projectDoc } = useFrappeGetDoc("Projects", projectId);

    const docListFilters = useMemo(() => {
        const filters: any[] = [["project", "=", projectId]];
        
        if (startDate && endDate) {
            filters.push([
                "delivery_date", 
                "Between", 
                [format(startDate, "yyyy-MM-dd"), format(endDate, "yyyy-MM-dd")]
            ]);
        }
        
        return filters;
    }, [projectId, startDate, endDate]);

    // 2. Fetch Existing Material Delivery Plans
    const { data: existingPlans, isLoading: isLoadingPlans, mutate: refreshPlans } = useFrappeGetDocList("Material Delivery Plan", {
        fields: ["name", "po_link", "package_name", "delivery_date", "mp_items", "creation", "po_type"],
        filters: docListFilters,
        orderBy: { field: "creation", order: "desc" }
    });

    // Extract unique packages from child table for Options
    const projectPackages = useMemo(() => {
        if (!projectDoc?.project_wp_category_makes) return [];
        const pkgs = new Set<string>();
        projectDoc.project_wp_category_makes.forEach((row: any) => {
            if (row.procurement_package) pkgs.add(row.procurement_package);
        });
        pkgs.add("Custom");
        return Array.from(pkgs).sort();
    }, [projectDoc]);

    return (
        <div className="space-y-6">
             {/* Material Plan Intro / Actions Header */}
            {/* Material Plan Intro / Actions Header */}
            {!isOverview ? (
                <div className="border border-blue-100 rounded-lg p-6 bg-white shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold text-gray-900">Material Plan</h3>
                        {existingPlans && existingPlans.length > 0 && (
                            <Badge variant="secondary" className="bg-blue-700 text-white hover:bg-blue-800 h-6 w-6 p-0 flex items-center justify-center rounded-full text-[12px]">
                                {existingPlans.length }
                            </Badge>
                        )}
                     </div>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="gap-2 h-8 text-xs border-gray-300 text-gray-700"
                            onClick={handleDownload}
                            disabled={isDownloading}
                        >
                            {isDownloading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Download className="h-3.5 w-3.5" />
                            )}
                            {isDownloading ? "Exporting..." : "Export"}
                        </Button>
                    </div>
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
            ) : (
                <div className="flex items-center justify-between mb-4 mt-4">
                     <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold text-gray-900">Material Plan</h3>
                        {existingPlans && existingPlans.length > 0 && (
                            <Badge variant="secondary" className="bg-blue-700 text-white hover:bg-blue-800 h-6 w-6 p-0 flex items-center justify-center rounded-full text-[12px]">
                                {existingPlans.length }
                            </Badge>
                        )}
                     </div>
                     <Button 
                        variant="outline" 
                        size="sm" 
                        className="gap-2 h-8 text-xs border-gray-300 text-gray-700"
                        onClick={handleDownload}
                        disabled={isDownloading}
                    >
                        {isDownloading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Download className="h-3.5 w-3.5" />
                        )}
                        {isDownloading ? "Exporting..." : "Export"}
                    </Button>
                </div>
            )}
            
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
                    const itemsList = getMaterialItems(plan);
                    const itemsCount = itemsList.length;

                    // Calculate Plan Number (Oldest is Plan 1 if we sort desc)
                    const planNum = existingPlans.length - index;
                    const isExpanded = isOverview || expandedPlans.includes(plan.name);

                    // Parse items for display in expanded view
                    // const itemsList = getMaterialItems(plan); // Already parsed above
                    // Re-using itemsList from above scope if I can, but wait it's in the same scope?
                    // Yes, I defined itemsList in the first replacement chunk. So I can just remove this block.

                    return (
                        <div key={plan.name} className="border border-gray-100 rounded-lg overflow-hidden shadow-sm transition-all bg-[#F5F7F9]">
                            {/* Main Row */}
                            <div className={`flex flex-col md:flex-row items-center p-3 gap-4 md:gap-0 ${!isOverview ? "min-h-[4.5rem]" : ""}`}>
                                
                                {/* Left Section: Toggle + Plan ID */}
                                <div className="w-full md:w-auto flex items-center gap-4 md:pr-6 shrink-0">
                                    {!isOverview && (
                                        <button 
                                            onClick={() => togglePlan(plan.name)}
                                            className={`h-9 w-9 flex items-center justify-center rounded bg-white border border-gray-200 shadow-sm transition-colors hover:bg-gray-50 shrink-0 ${isExpanded ? "text-gray-900" : "text-gray-400"}`}
                                        >
                                            <ChevronDown className={`h-5 w-5 transition-transform duration-200 ${isExpanded ? "rotate-0" : "-rotate-90"}`} />
                                        </button>
                                    )}
                                    
                                    <div className="flex items-center gap-3">
                                        <Package className="h-5 w-5 text-gray-700" />
                                        <span className="font-semibold text-gray-800 text-base whitespace-nowrap">Plan {planNum}</span>
                                    </div>

                                    {/* Vertical Separator */}
                                    <div className="hidden md:block h-6 w-[2px] bg-red-400 mx-2"></div>
                                </div>

                                {/* Right Section: Grid Details */}
                                <div className="w-full grid grid-cols-2 md:grid-cols-12 items-center gap-y-4 gap-x-4">
                                    <div className="col-span-2 md:col-span-3 flex flex-col justify-center">
                                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Work Package</span>
                                        <span className="text-sm font-semibold text-gray-800 break-words leading-tight">{plan.package_name}</span>
                                    </div>
                                    <div className="col-span-1 md:col-span-2 flex flex-col justify-center">
                                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">PO ID</span>
                                        <span className="text-sm text-gray-700 truncate font-medium" title={plan.po_link}>
                                            {plan.po_link || "--"}
                                        </span>
                                    </div>
                                    <div className="col-span-1 md:col-span-2 flex flex-col justify-center">
                                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">PO Type</span>
                                        <span className="text-sm text-gray-700 whitespace-nowrap font-medium">
                                            {plan.po_type}
                                        </span>
                                    </div>
                                    <div className="col-span-1 md:col-span-2 flex flex-col justify-center items-center">
                                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Materials</span>
                                        <div className="bg-white border border-gray-200 rounded-full px-3 py-0.5 text-xs font-bold text-gray-700 shadow-sm min-w-[4rem] text-center">
                                            {itemsCount} Items
                                        </div>
                                    </div>
                                    <div className={`${isOverview ? "col-span-1 md:col-span-3" : "col-span-1 md:col-span-2"} flex flex-col justify-center`}>
                                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Delivery Date</span>
                                        <span className="text-sm font-medium text-gray-800 whitespace-nowrap">
                                            {safeFormatDate(plan.delivery_date)}
                                        </span>
                                    </div>
                                    {!isOverview && (
                                        <div className="col-span-2 md:col-span-1 flex md:flex-col justify-center items-end gap-1">
                                            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide md:mb-1">Action</span>
                                            <div className="flex items-center gap-2">
                                                <button 
                                                        onClick={(e) => { e.stopPropagation(); setEditingPlan(plan); }}
                                                        className="text-gray-400 hover:text-blue-600 p-1"
                                                >
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                                </button>
                                                <button 
                                                        className="text-gray-400 hover:text-red-600 p-1"
                                                        onClick={(e) => { e.stopPropagation(); setDeleteDialogState({ isOpen: true, planName: plan.name }); }}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Expanded Content: Materials List */}
                            {isExpanded && (
                                <div className="p-4 pl-4 md:pl-6 pt-2 pb-6 flex flex-col md:flex-row md:items-start gap-4">
                                     <span className="text-xs font-bold text-gray-800 shrink-0 mt-1.5">
                                         Materials ({itemsCount}):
                                     </span>
                                     <div className="flex flex-wrap gap-2">
                                         {itemsList.map((item: any, i: number) => (
                                             <div key={i} className="bg-[#EBE9F8] text-gray-700 text-xs px-2.5 py-1 rounded-md font-medium">
                                                 {item.item_name}
                                             </div>
                                         ))}
                                     </div>
                                </div>
                            )}
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