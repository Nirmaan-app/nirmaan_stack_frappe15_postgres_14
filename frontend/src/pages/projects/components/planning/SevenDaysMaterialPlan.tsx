import React, { useState, useMemo } from "react";
import { useFrappeGetCall, useFrappeGetDoc, useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { format, addDays, startOfDay, parseISO } from "date-fns";
import { safeFormatDateDD_MMM_YYYY } from "@/lib/utils";
import { Loader2, AlertCircle, ChevronDown, ChevronUp, Package, Calendar, Trash2, Download, Edit2 } from "lucide-react";
import { SevenDayPlanningHeader } from "./SevenDayPlanningHeader";
import { DateRange } from "react-day-picker";
import { useUrlParam } from "@/hooks/useUrlParam";
import { urlStateManager } from "@/utils/urlStateManager";
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


export const SevenDaysMaterialPlan = ({ projectId, isOverview, projectName }: SevenDaysMaterialPlanProps) => {
    
    // --- Date/Duration State (Local) ---
    const activeDurationParam = useUrlParam("planningDuration");
    
    const activeDuration = useMemo(() => {
        if (activeDurationParam === "All") return "All";
        const num = Number(activeDurationParam);
        if (!isNaN(num) && [3, 7, 14].includes(num)) return num;
        if (activeDurationParam === "custom") return "custom";
        return "All"; 
    }, [activeDurationParam]);

    const startDateParam = useUrlParam("startDate");
    const endDateParam = useUrlParam("endDate");

    const dateRange = useMemo<DateRange | undefined>(() => {
        const today = startOfDay(new Date());

        if (activeDuration === "All") return undefined;
        
        if (typeof activeDuration === 'number') {
             return { from: today, to: addDays(today, activeDuration) };
        }

        if (activeDuration === 'custom') {
            if (startDateParam && endDateParam) {
                return { from: parseISO(startDateParam), to: parseISO(endDateParam) };
            }
             return undefined;
        }
        return undefined;
    }, [activeDuration, startDateParam, endDateParam]);

    const setDaysRange = (days: number | "All" | "custom", customRange?: DateRange) => {
        urlStateManager.updateParam("planningDuration", days.toString());
        if (days === "custom" && customRange?.from && customRange?.to) {
            urlStateManager.updateParam("startDate", format(customRange.from, 'yyyy-MM-dd'));
            urlStateManager.updateParam("endDate", format(customRange.to, 'yyyy-MM-dd'));
        } else {
            urlStateManager.updateParam("startDate", null);
            urlStateManager.updateParam("endDate", null);
        }
    };

    const startDate = dateRange?.from;
    const endDate = dateRange?.to;
    
    // console.log("Material Plan Project Name ",projectName)
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
        fields: ["name", "po_link", "package_name", "critical_po_category", "critical_po_task", "critical_po_sub_category", "delivery_date", "mp_items", "creation", "po_type"],
        filters: docListFilters,
        orderBy: { field: "creation", order: "desc" },
        limit:0
    });

    // console.log("existingPlans",existingPlans)
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

            {!isOverview ? (
                <div className="bg-white shadow-sm">
                     {/* Header Section */}
                     {setDaysRange && activeDuration && (
                        <div className="mb-6">
                            <SevenDayPlanningHeader
                                isOverview={isOverview}
                                dateRange={dateRange}
                                activeDuration={activeDuration}
                                setDaysRange={setDaysRange}
                            />
                        </div>
                    )}
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
                            className="gap-2 h-8 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 border bg-white"
                            onClick={handleDownload}
                            disabled={isDownloading}
                        >
                            {isDownloading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Download className="h-3.5 w-3.5" />
                            )}
                            {isDownloading ? "Downloading..." : "Download"}
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
                <>
                     {setDaysRange && activeDuration && (
                        <div className="mb-6">
                            <SevenDayPlanningHeader
                                isOverview={isOverview}
                                dateRange={dateRange}
                                activeDuration={activeDuration}
                                setDaysRange={setDaysRange}
                            />
                        </div>
                    )}
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
                            className="gap-2 h-8 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 border bg-white"
                            onClick={handleDownload}
                            disabled={isDownloading}
                        >
                            {isDownloading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Download className="h-3.5 w-3.5" />
                            )}
                            {isDownloading ? "Downloading..." : "Download"}
                        </Button>
                    </div>
                </>
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
                    const planNum = index+1;
                    const isExpanded = isOverview || expandedPlans.includes(plan.name);

                    // Parse items for display in expanded view
                    // const itemsList = getMaterialItems(plan); // Already parsed above
                    
                    const isMissingCriticalInfo = (plan.po_type === "Existing PO" || plan.po_type === "New PO") && (!plan.critical_po_category || !plan.critical_po_task);

                    return (
                        <div key={plan.name} className={`border rounded-lg bg-blue-50/50 shadow-sm overflow-hidden transition-all hover:shadow-md ${
                                isMissingCriticalInfo ? "border-red-200 bg-red-50/30" : "border-gray-200"
                            }`}>
                                <div className="flex flex-col md:flex-row md:flex-wrap lg:flex-nowrap items-start lg:items-center p-3 gap-3">
                                    
                                    {/* Section 1: Task Info */}
                                    <div className="flex items-start gap-2 w-full md:w-[45%] lg:w-[25%] shrink-0">
                                        {/* Dot Indicator (Placeholder if needed, or matching POCashflow's w-8 flex-center) */}
                                        <div className="hidden md:flex w-8 shrink-0 justify-center mt-1">
                                            <div className="w-6 h-6 bg-red-50 rounded-full flex items-center justify-center">
                                                <span className="block w-2 h-2 bg-red-500 rounded-full"></span>
                                            </div>
                                        </div>

                                        {/* Toggle button */}
                                        {!isOverview && (
                                            <button 
                                                onClick={() => togglePlan(plan.name)}
                                                className="mt-1 text-gray-400 hover:text-gray-600 shrink-0"
                                            >
                                                <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? "" : "-rotate-90"}`} />
                                            </button>
                                        )}
                                        
                                        <div className="flex flex-col gap-0.5 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-sm px-1.5 py-0 text-[10px] font-normal uppercase tracking-wider">
                                                    Plan {planNum}
                                                </Badge>
                                            </div>
                                            
                                            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wide">Task</span>
                                            <h4 className="font-semibold text-gray-900 leading-tight text-sm break-words">
                                                {plan.critical_po_task || plan.package_name || "Untitled Task"}
                                                {plan.critical_po_sub_category && (
                                                    <span className="text-gray-500 font-normal text-xs ml-1">({plan.critical_po_sub_category})</span>
                                                )}
                                            </h4>
                                        </div>
                                    </div>

                                    <div className="hidden lg:block w-px h-10 bg-gray-200 mx-1" />

                                    {/* Section 1.5: Category Info */}
                                    <div className="flex flex-col gap-0.5 w-full md:w-[45%] lg:w-[15%] shrink-0 min-w-0">
                                        <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wide">Category</span>
                                        <span className={`text-[11px] font-medium truncate ${!plan.critical_po_category ? "text-red-500" : "text-gray-500"}`}>
                                            {plan.critical_po_category || "Category Undefined"}
                                        </span>
                                    </div>

                                    <div className="hidden lg:block w-px h-10 bg-gray-200 mx-1" />

                                    {/* Section 2: PO Info */}
                                    <div className="flex flex-col gap-1 w-full md:w-[45%] lg:w-[20%] shrink-0 min-w-0">
                                        <div className="font-medium text-gray-900 text-sm truncate" title={plan.po_link}>
                                            {plan.po_link || "--"}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <Badge variant="outline" className={`px-1.5 py-0 text-[10px] font-normal ${plan.po_type === "Existing PO" ? "bg-blue-50 text-blue-700 border-blue-100" : "bg-yellow-50 text-yellow-700 border-yellow-100"}`}>
                                                {plan.po_type || "--"}
                                            </Badge>
                                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-medium bg-gray-50 text-gray-600 border-gray-200">
                                                {itemsCount} Items
                                            </Badge>
                                        </div>
                                    </div>

                                    <div className="hidden lg:block w-px h-10 bg-gray-200 mx-1" />

                                    {/* Section 3: Delivery Date */}
                                    <div className="flex flex-col gap-0.5 w-full md:w-[45%] lg:flex-1 shrink-0">
                                        <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wide">Delivery Date</span>
                                        <span className="font-semibold text-gray-900 text-sm">
                                            {safeFormatDateDD_MMM_YYYY(plan.delivery_date)}
                                        </span>
                                    </div>

                                    <div className="hidden lg:block w-px h-10 bg-gray-200 mx-1" />

                                    {/* Section 4: Actions */}
                                    <div className="flex items-center justify-between w-full md:w-full lg:w-auto gap-3 min-w-0 border-t border-gray-100 pt-2 lg:border-0 lg:pt-0 mt-1 lg:mt-0">
                                        {!isOverview && (
                                            <div className="flex items-center gap-1 pl-0 lg:pl-3 lg:border-l border-gray-100 shrink-0 ml-auto">
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); setEditingPlan(plan); }}
                                                    className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors hover:bg-blue-50 rounded-md"
                                                    title="Edit Plan"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); setDeleteDialogState({ isOpen: true, planName: plan.name }); }}
                                                    className="p-1.5 text-gray-400 hover:text-red-600 transition-colors hover:bg-red-50 rounded-md"
                                                    title="Delete Plan"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Expanded Content: Materials List */}
                                {isExpanded && (
                                    <div className="bg-gray-50/50 border-t p-4 pl-4 md:pl-6 pt-2 pb-6 flex flex-col md:flex-row md:items-start gap-4 animate-in slide-in-from-top-2 duration-200">
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