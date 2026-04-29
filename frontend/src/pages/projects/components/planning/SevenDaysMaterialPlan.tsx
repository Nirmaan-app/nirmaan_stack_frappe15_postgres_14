import React, { useState, useMemo } from "react";
import { useProjectDocForMaterialPlan, useMaterialDeliveryPlans } from "@/pages/projects/data/material-plan/useMaterialPlanQueries";
import { useDeleteMaterialDeliveryPlan } from "@/pages/projects/data/material-plan/useMaterialPlanMutations";
import { format, addDays, startOfDay, parseISO } from "date-fns";
import { safeFormatDateDD_MMM_YYYY } from "@/lib/utils";
import { Loader2, ChevronDown, Trash2, Download, Edit2, PlusCircle } from "lucide-react";
import { SevenDayPlanningHeader } from "./SevenDayPlanningHeader";
import { DateRange } from "react-day-picker";
import { useUrlParam } from "@/hooks/useUrlParam";
import { urlStateManager } from "@/utils/urlStateManager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddMaterialPlanForm } from "./AddMaterialPlanForm";
import { EditMaterialPlanForm } from "./EditMaterialPlanForm";
import { WorkPlanReferencePanel } from "./WorkPlanReferencePanel";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { downloadProjectPrintFormatPdf } from "@/pages/projects/data/tab/planning/useProjectPlanningDownloadApi";

const ADMIN_ROLE = "Nirmaan Admin Profile";
const PROCUREMENT_ROLE = "Nirmaan Procurement Executive Profile";
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

    // --- Role gates ---
    const { role } = useUserData();
    const isAdmin = role === ADMIN_ROLE;
    const canEditPlan = isAdmin || role === PROCUREMENT_ROLE;

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
    const { deleteMaterialPlan } = useDeleteMaterialDeliveryPlan();

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
                await deleteMaterialPlan(deleteDialogState.planName);
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
            await downloadProjectPrintFormatPdf({
                projectId,
                projectName: projectName || projectDoc?.project_name || projectId,
                formatName: "Project Material Plan",
                startDate: startDate ? format(startDate, "yyyy-MM-dd") : undefined,
                endDate: endDate ? format(endDate, "yyyy-MM-dd") : undefined,
                filePrefix: "MaterialPlan",
            });
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
    const { data: projectDoc } = useProjectDocForMaterialPlan(projectId);

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
    const { data: existingPlans, isLoading: isLoadingPlans, mutate: refreshPlans } = useMaterialDeliveryPlans(projectId, docListFilters);

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
                    <div className="flex justify-between items-start mb-2 gap-3">
                        <div className="flex items-center gap-2">
                            <h3 className="text-xl font-bold text-gray-900">Material Plan</h3>
                            {existingPlans && existingPlans.length > 0 && (
                                <Badge variant="secondary" className="bg-blue-700 text-white hover:bg-blue-800 h-6 w-6 p-0 flex items-center justify-center rounded-full text-[12px]">
                                    {existingPlans.length}
                                </Badge>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-2 h-9 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 border bg-white"
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
                            <button
                                onClick={addPlanForm}
                                disabled={materialPlanForms.length > 0}
                                title={materialPlanForms.length > 0 ? "Finish or cancel the current plan first" : undefined}
                                className="inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white font-medium h-9 px-3 rounded transition-colors text-xs disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed disabled:hover:bg-gray-300"
                            >
                                <PlusCircle className="h-3.5 w-3.5" />
                                Add Material Plan
                            </button>
                        </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                        Materials must already exist inside an existing PO. New POs should only be created if materials are not available in existing POs.
                    </p>

                    {/* Reference: Existing Work Plan Tasks for this project */}
                    <WorkPlanReferencePanel projectId={projectId} />
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
                                    {existingPlans.length}
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

            {/* Section Divider — separates Drafts (above) from Saved Plans (below) */}
            {!isOverview && existingPlans && existingPlans.length > 0 && (
                <div className="flex items-center gap-3 pt-2">
                    <div className="flex items-center gap-2 shrink-0">
                        <h4 className="text-sm font-semibold text-gray-700">Saved Material Plans</h4>
                        <Badge variant="secondary" className="bg-gray-200 text-gray-700 hover:bg-gray-200 rounded-full px-2 py-0 text-[10px] font-semibold">
                            {existingPlans.length}
                        </Badge>
                    </div>
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider shrink-0">
                        Sorted by latest
                    </span>
                </div>
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
                    const itemsList = getMaterialItems(plan);
                    const itemsCount = itemsList.length;
                    const planNum = index + 1;
                    const isExpanded = isOverview || expandedPlans.includes(plan.name);
                    const isMissingCriticalInfo = (plan.po_type === "Existing PO" || plan.po_type === "New PO") && (!plan.critical_po_category || !plan.critical_po_task);
                    const isDelivered = plan.delivery_status === "Delivered";
                    const isPartiallyDelivered = plan.delivery_status === "Partially Delivered";

                    return (
                        <div
                            key={plan.name}
                            className={`border rounded-lg bg-white shadow-sm overflow-hidden transition-all hover:shadow-md ${isMissingCriticalInfo ? "border-red-200" : "border-gray-200"
                                }`}
                        >
                            {/* Top Row: Plan Badge + View Material List Toggle */}
                            <div className="flex items-center justify-between px-3 md:px-4 pt-3 pb-2 border-b border-gray-100 bg-gray-50/40">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span className="block w-2 h-2 bg-red-500 rounded-full shrink-0" />
                                    <Badge
                                        variant="secondary"
                                        className="bg-blue-50 text-blue-700 hover:bg-blue-100 rounded px-2 py-0.5 text-[11px] font-medium shrink-0"
                                    >
                                        Plan {planNum}
                                    </Badge>
                                    {isPartiallyDelivered && plan.remarks && (<span className="text-gray-300 shrink-0">|</span>)}
                                    {isPartiallyDelivered && plan.remarks && (
                                        <span
                                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium truncate min-w-0"
                                            title={plan.remarks}
                                        >
                                            <span className="font-semibold text-amber-700 shrink-0">Remarks:</span>
                                            <span className="truncate text-gray-900">{plan.remarks}</span>
                                        </span>
                                    )}
                                </div>
                                {!isOverview && (
                                    <button
                                        onClick={() => togglePlan(plan.name)}
                                        className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                                    >
                                        View material list
                                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                                    </button>
                                )}
                            </div>

                            {/* Data Row: Column Header + Value */}
                            <div className="flex flex-col md:flex-row md:flex-wrap lg:flex-nowrap items-stretch px-3 md:px-4 py-3 gap-x-4 gap-y-3">
                                {/* TASK */}
                                <div className="flex flex-col gap-0.5 w-full md:w-[45%] lg:flex-[2] min-w-0">
                                    <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Task</span>
                                    <span className="font-semibold text-gray-900 text-sm break-words">
                                        {plan.critical_po_task || plan.package_name || "Untitled Task"}
                                        {plan.critical_po_sub_category && (
                                            <span className="text-gray-500 font-normal text-xs ml-1">({plan.critical_po_sub_category})</span>
                                        )}
                                    </span>
                                </div>

                                {/* CATEGORY */}
                                <div className="flex flex-col gap-0.5 w-full md:w-[45%] lg:flex-1 min-w-0">
                                    <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Category</span>
                                    <span className={`text-sm font-medium truncate ${!plan.critical_po_category ? "text-red-500" : "text-gray-700"}`}>
                                        {plan.critical_po_category || "—"}
                                    </span>
                                </div>

                                {/* PO — heading shows the actual PO link */}
                                <div className="flex flex-col gap-1 w-full md:w-[45%] lg:flex-[1.5] min-w-0">
                                    <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider truncate" title={plan.po_link || "--"}>
                                        {plan.po_link || "--"}
                                    </span>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <Badge
                                            variant="outline"
                                            className={`px-1.5 py-0 text-[10px] font-normal ${plan.po_type === "Existing PO"
                                                ? "bg-blue-50 text-blue-700 border-blue-100"
                                                : "bg-yellow-50 text-yellow-700 border-yellow-100"
                                                }`}
                                        >
                                            {plan.po_type || "--"}
                                        </Badge>
                                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-medium bg-gray-50 text-gray-600 border-gray-200">
                                            {itemsCount} Items
                                        </Badge>
                                    </div>
                                </div>

                                {/* DELIVERY DATE */}
                                <div className="flex flex-col gap-0.5 w-full md:w-[45%] lg:flex-1 min-w-0">
                                    <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Delivery Date</span>
                                    <span className="font-semibold text-gray-900 text-sm">
                                        {safeFormatDateDD_MMM_YYYY(plan.delivery_date)}
                                    </span>
                                </div>

                                {/* STATUS */}
                                <div className="flex flex-col gap-0.5 w-full md:w-[45%] lg:flex-1 min-w-0">
                                    <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Status</span>
                                    <span
                                        className={`inline-flex items-center w-fit px-2 py-0.5 rounded text-[11px] font-medium border ${isDelivered
                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                            : isPartiallyDelivered
                                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                                : "bg-red-50 text-red-700 border-red-200"
                                            }`}
                                        title={isPartiallyDelivered && plan.remarks ? plan.remarks : undefined}
                                    >
                                        {plan.delivery_status || "Not Delivered"}
                                    </span>
                                </div>

                                {/* ACTIONS — Edit: Admin + Procurement, Delete: Admin only */}
                                {!isOverview && (canEditPlan || isAdmin) && (
                                    <div className="flex items-center gap-1 shrink-0 self-start lg:self-center w-full md:w-auto justify-end border-t md:border-0 border-gray-100 pt-2 md:pt-0 mt-1 md:mt-0">
                                        <span className="hidden md:block w-px h-6 bg-gray-200 mr-1" aria-hidden="true" />
                                        {canEditPlan && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setEditingPlan(plan); }}
                                                className="p-1.5 text-blue-600 hover:text-blue-700 transition-colors hover:bg-blue-50 rounded-md"
                                                title="Edit Plan"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                        )}
                                        {isAdmin && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setDeleteDialogState({ isOpen: true, planName: plan.name }); }}
                                                className="p-1.5 text-red-600 hover:text-red-700 transition-colors hover:bg-red-50 rounded-md"
                                                title="Delete Plan"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                )}
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
