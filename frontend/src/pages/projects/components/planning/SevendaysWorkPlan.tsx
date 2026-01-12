// // import React, { useMemo, useState, useEffect } from "react";

// import React, { useMemo, useState, useEffect } from "react";
// import { useFrappeGetCall, useFrappeGetDoc, useFrappeDeleteDoc } from "frappe-react-sdk";
// import { format, addDays, subDays } from "date-fns";
// import { safeFormatDate } from "@/lib/utils";
// import { AlertCircle, Calendar, CheckCircle, Circle, Loader2, ChevronDown, ChevronUp, Pencil, Trash2, Download } from "lucide-react";
// import { ProgressCircle } from "@/components/ui/ProgressCircle";
// import { CreateWorkplantask } from "./CreateWorkplantask";
// import { Badge } from "@/components/ui/badge";
// import { WorkPlanOverview } from "./WorkPlanOverview";

// import { useToast } from "@/components/ui/use-toast";
// import { useUrlParam } from "@/hooks/useUrlParam";
// import { urlStateManager } from "@/utils/urlStateManager";
// import { Button } from "@/components/ui/button";
// import { EditMilestoneDialog } from "./EditMilestoneDialog";
// import {
//     AlertDialog,
//     AlertDialogAction,
//     AlertDialogCancel,
//     AlertDialogContent,
//     AlertDialogDescription,
//     AlertDialogFooter,
//     AlertDialogHeader,
//     AlertDialogTitle,
// } from "@/components/ui/alert-dialog";
// import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
// import { Input } from "@/components/ui/input";
// import { Label } from "@/components/ui/label";
// import { Checkbox } from "@/components/ui/checkbox";
// import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// interface SevendaysWorkPlanProps {
//     projectId: string;
//     startDate: Date | undefined;
//     endDate: Date | undefined;
//     isOverview?: boolean;
//     projectName?: string;
// }

// export interface WorkPlanItem {
//     project: string;
//     zone: string;
//     work_milestone_name: string;
//     work_header: string;
//     status: string;
//     progress: number;
//     expected_starting_date: string;
//     expected_completion_date: string;
//     work_plan_doc?: WorkPlanDoc[];
//     source: string;
//     weightage?: number;
//     dpr_name?: string;
// }

// export interface WorkPlanDoc {
//     name: string;
//     wp_title: string;
//     wp_status: string;
//     wp_start_date: string;
//     wp_end_date: string;
//     wp_description: string;
// }

// export const getColorForProgress = (value: number): string => {
//     const val = Math.round(value);
//     if (isNaN(val)) return "text-gray-500";
//     if (val === 0) return "text-gray-400"; // Using gray-400 for 0 instead of black-500
//     if (val < 50) return "text-red-600";
//     if (val < 75) return "text-yellow-600";
//     if (val < 100) return "text-green-600";
//     return "text-green-500";
// };

// const MilestoneRow = ({ item, onAddTask, onEditTask, onDeleteTask, onEditMilestone, isOverview }: { 
//     item: WorkPlanItem, 
//     onAddTask: (item: WorkPlanItem) => void,
//     onEditTask: (plan: WorkPlanDoc, item: WorkPlanItem) => void,
//     onDeleteTask: (planName: string) => void,
//     onEditMilestone: (item: WorkPlanItem) => void,
//     isOverview?: boolean
// }) => {
//     const [isExpanded, setIsExpanded] = useState(false);
//     const workPlans = item.work_plan_doc || [];
//     const hasWorkPlans = workPlans.length > 0;

//     return (
//         <>
//             <tr className="hover:bg-gray-50/50">
//                 <td className="px-4 py-3 text-gray-700 border-b-0">
//                     <div className="font-medium text-gray-900">{item.work_milestone_name}</div>
//                 </td>
//                 <td className="px-4 py-3 font-medium text-gray-900 border-b-0 text-center">
//                     <span className="inline-flex items-center justify-center h-6 min-w-[100px] w-fit rounded border border-dashed border-gray-300 bg-gray-50 px-3 text-xs text-gray-600 whitespace-nowrap">
//                         {item.zone || "Zone 1"}
//                     </span>
//                 </td>
//                 <td className="px-4 py-3 border-b-0 text-center">
//                         <span
//                         className={`inline-flex items-center justify-center h-6 min-w-[100px] w-fit rounded-full px-3 text-xs font-medium whitespace-nowrap ${
//                             item.status === "Completed"
//                                 ? "bg-green-100 text-green-800 border border-green-200"
//                                 : item.status === "WIP" || item.status === "In Progress"
//                                 ? "bg-orange-100 text-orange-800 border border-orange-200"
//                                 : item.status === "Not Started"
//                                 ? "bg-red-100 text-red-800 border border-red-200"
//                                 : "bg-gray-100 text-gray-800 border border-gray-200"
//                         }`}
//                     >
//                         {item.status}
//                         {!isOverview && (
//                         <button 
//                             className="ml-2 p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50  transition-all inline-flex items-center"
//                             onClick={(e) => {
//                                 e.stopPropagation();
//                                 onEditMilestone(item);
//                             }}
//                             title="Edit Milestone"
//                         >
//                             <Pencil className="h-3 w-3" />
//                         </button>
//                     )}
//                     </span>
                    
//                 </td>

//                 <td className="px-4 py-3 text-gray-700 border-b-0 text-center">
//                     <div className="flex items-center justify-center gap-2">
//                         <ProgressCircle 
//                             value={item.progress} 
//                             className={`size-10 ${getColorForProgress(item.progress)}`}
//                             textSizeClassName="text-[10px]"
//                         />
//                     </div>
//                 </td>
//                 <td className="px-4 py-3 text-xs font-medium text-gray-700 border-b-0 text-center">
//                     {item.expected_starting_date ? (
//                         <span className="text-red-600 font-bold">{safeFormatDate(item.expected_starting_date)}</span>
//                     ) : "NA"}
//                 </td>
//                 <td className="px-4 py-3 text-xs font-medium text-gray-700 border-b-0 text-center">
//                         {item.expected_completion_date ? (
//                         <span className="text-red-600 font-bold">{safeFormatDate(item.expected_completion_date)}</span>
//                     ) : "NA"}
//                 </td>
//                 {!isOverview && (
//                     <td className="px-4 py-3 border-b-0">
//                             <button 
//                             className="flex items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
//                             onClick={() => onAddTask(item)}
//                             >
//                             <span className="mr-1 text-lg leading-none">+</span> Add Task
//                             </button>
//                     </td>
//                 )}
//             </tr>
//             {hasWorkPlans && (
//                 <tr>
//                     <td colSpan={isOverview ? 6 : 7} className=" pb-2 pt-0 m-0 p-0">
//                         <div className="rounded-md border-b bg-blue-50/30">
//                             <button 
//                                 className="flex w-full items-center justify-between px-4 py-2 text-sm text-blue-800 hover:bg-blue-50"
//                                 onClick={() => setIsExpanded(!isExpanded)}
//                             >
//                                 <div className="flex items-center gap-2 font-semibold">
//                                     Planned Activities 
//                                     <Badge className="bg-blue-700 text-white hover:bg-blue-800 h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px]">
//                                         {workPlans.length}
//                                     </Badge>
//                                 </div>
//                                 {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
//                             </button>
                            
//                             {isExpanded && (
//                                 <div className="space-y-3 p-4">
//                                     {workPlans.map((plan) => (
//                                         <div key={plan.name} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-[0_2px_4px_rgba(0,0,0,0.02)] hover:shadow-md transition-shadow">
//                                             {/* Left: Title and Note */}
//                                             <div className="space-y-1.5 w-[300px] shrink-0 pr-4">
//                                                 <div className="font-semibold text-gray-900 text-sm leading-tight truncate" title={plan.wp_title}>{plan.wp_title}</div>
//                                                 {/* {plan.wp_description && (
//                                                     <div className="text-xs italic text-gray-500 line-clamp-2 leading-relaxed">
//                                                         <span className="font-medium text-amber-600 not-italic">Note: </span>
//                                                         {plan.wp_description}
//                                                     </div>
//                                                 )} */}
//                                                  {plan.wp_description && (
//                                             <div className="text-xs text-gray-500 whitespace-normal break-words leading-relaxed" title={plan.wp_description}>
//                                                 <span className="font-semibold text-yellow-600">Note: </span>
//                                                 {plan.wp_description}
//                                             </div>
//                                         )}
//                                             </div>
                                            
//                                             {/* Center: Status and Date Metadata */}
//                                             <div className="flex items-center gap-2 shrink-0 mx-4">
//                                                 <div className="flex flex-col items-center gap-1.5 w-[100px]">
//                                                     <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Status</span>
//                                                     <span className={`w-full text-center rounded-md px-2 py-1 text-xs font-semibold border truncate ${
//                                                         plan.wp_status === 'Pending' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
//                                                         plan.wp_status === 'Completed' ? 'bg-green-50 text-green-700 border-green-200' :
//                                                         plan.wp_status === 'In Progress' ? 'bg-orange-50 text-orange-700 border-orange-200' :
//                                                         'bg-gray-50 text-gray-700 border-gray-200'
//                                                     }`}>
//                                                         {plan.wp_status || 'Pending'}
//                                                     </span>
//                                                 </div>

//                                                 <div className="flex flex-col items-center gap-1.5 w-[110px]">
//                                                     <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Start Date</span>
//                                                     <div className="w-full text-center rounded border px-2 py-1 text-xs font-semibold bg-white text-gray-700 shadow-sm truncate">
//                                                         {safeFormatDate(plan.wp_start_date)}
//                                                     </div>
//                                                 </div>

//                                                 <div className="flex flex-col items-center gap-1.5 w-[110px]">
//                                                     <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">End Date</span>
//                                                     <div className="w-full text-center rounded border px-2 py-1 text-xs font-semibold bg-white text-gray-700 shadow-sm truncate">
//                                                         {safeFormatDate(plan.wp_end_date)}
//                                                     </div>
//                                                 </div>
//                                             </div>

//                                             {/* Right: Actions */}
//                                             {!isOverview && (
//                                                 <div className="flex items-center gap-1 pl-4 border-l border-gray-100 h-8">
//                                                     <button 
//                                                         className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all"
//                                                         onClick={() => onEditTask(plan, item)}
//                                                         title="Edit Task"
//                                                     >
//                                                         <Pencil className="h-4 w-4" />
//                                                     </button>
//                                                     <button 
//                                                         className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
//                                                         onClick={() => onDeleteTask(plan.name)}
//                                                         title="Delete Task"
//                                                     >
//                                                         <Trash2 className="h-4 w-4" />
//                                                     </button>
//                                                 </div>
//                                             )}
//                                         </div>
//                                     ))}
//                                 </div>
//                             )}
//                         </div>
//                     </td>
//                 </tr>
//             )}
//         </>
//     );
// };

// export const SevendaysWorkPlan = ({
//     projectId,
//     startDate,
//     endDate,
//     isOverview,
//     projectName
// }: SevendaysWorkPlanProps) => {
    
//     const [isBufferDialogOpen, setIsBufferDialogOpen] = useState(false);
//     const [bufferDays, setBufferDays] = useState<number | string>("");
//     const [addToStart, setAddToStart] = useState<boolean>(true);
//     const [addToEnd, setAddToEnd] = useState<boolean>(true);
//     const [isMainExpanded, setIsMainExpanded] = useState(true);

//     // console.log("Work Plan projectName",projectName)

//     const { toast } = useToast();
//     const { deleteDoc } = useFrappeDeleteDoc();

//     const shouldFetch = projectId;
//     // Response is Record<WorkHeader, WorkPlanItem[]>
//     const { data: result, error, isLoading: loading, mutate } = useFrappeGetCall<{
//         message: {
//             data: Record<string, WorkPlanItem[]>;
//             reason: string | null;
//         }
//     }>(
//         shouldFetch
//             ? "nirmaan_stack.api.seven_days_planning.work_plan_api.get_work_plan"
//             : null,
//         shouldFetch
//             ? {
//                   project: projectId,
//                   start_date: startDate ? format(startDate, "yyyy-MM-dd") : undefined,
//                   end_date: endDate ? format(endDate, "yyyy-MM-dd") : undefined,
//               }
//             : undefined
//     );


//     const { data: projectDoc } = useFrappeGetDoc("Projects", projectId);
//     const zones: string[] = useMemo(() => {
//         if (!projectDoc?.project_zones) return [];
//         // Extract zone_name and sort them if needed
//         return projectDoc.project_zones.map((z: any) => z.zone_name).sort();
//     }, [projectDoc]);

//     const urlZone = useUrlParam("planningZone");
    
//     // Derived state from URL or fallback
//     const [activeZone, setActiveZone] = useState<string>("");

//     // Effect to sync local state with URL and handle defaults
//     useEffect(() => {
//         if (zones.length > 0) {
//             // If URL has valid zone, use it
//             if (urlZone && zones.includes(urlZone)) {
//                 setActiveZone(urlZone);
//             } 
//             // If URL has no zone or invalid zone, default to first zone and update URL
//             else if (!urlZone || !zones.includes(urlZone)) {
//                 const defaultZone = zones[0];
//                 setActiveZone(defaultZone);
//                 // Only update URL if it's different to avoid loops (though urlStateManager might handle this, safer to check)
//                 if (urlZone !== defaultZone) {
//                    urlStateManager.updateParam("planningZone", defaultZone);
//                 }
//             }
//         }
//     }, [zones, urlZone]);

//     const handleZoneChange = (zone: string) => {
//         setActiveZone(zone);
//         urlStateManager.updateParam("planningZone", zone);
//     };

//     const [expandedHeaders, setExpandedHeaders] = useState<Record<string, boolean>>({});

//     const toggleHeader = (header: string) => {
//         setExpandedHeaders((prev) => ({
//             ...prev,
//             [header]: prev[header] === false ? true : false,
//         }));
//     };

//     const [editMilestoneState, setEditMilestoneState] = useState<{
//         isOpen: boolean;
//         item: WorkPlanItem | null;
//     }>({
//         isOpen: false,
//         item: null,
//     });

//     const [createTaskState, setCreateTaskState] = useState<{
//         isOpen: boolean;
//         data: {
//             project: string;
//             zone: string;
//             work_header: string;
//             work_milestone: string;
//         } | null;
//         docName?: string;
//         initialData?: {
//             wp_title: string;
//             wp_status: string;
//             wp_start_date: string;
//             wp_end_date: string;
//             wp_description: string;
//         };
//     }>({
//         isOpen: false,
//         data: null,
//     });

//     const [deleteDialogState, setDeleteDialogState] = useState<{
//         isOpen: boolean;
//         planName: string | null;
//     }>({
//         isOpen: false,
//         planName: null,
//     });

//     const handleAddTask = (item: WorkPlanItem) => {
//         setCreateTaskState({
//             isOpen: true,
//             data: {
//                 project: projectId, // specific field name from props
//                 zone: item.zone,
//                 work_header: item.work_header,
//                 work_milestone: item.work_milestone_name,
//             },
//             docName: undefined,
//             initialData: undefined
//         });
//     };

//     const handleEditTask = (plan: WorkPlanDoc, item: WorkPlanItem) => {
//         setCreateTaskState({
//             isOpen: true,
//             data: {
//                 project: projectId,
//                 zone: item.zone,
//                 work_header: item.work_header,
//                 work_milestone: item.work_milestone_name,
//             },
//             docName: plan.name,
//             initialData: {
//                 wp_title: plan.wp_title,
//                 wp_status: plan.wp_status,
//                 wp_start_date: plan.wp_start_date,
//                 wp_end_date: plan.wp_end_date,
//                 wp_description: plan.wp_description
//             }
//         });
//     };

//     const handleDeleteTask = (planName: string) => {
//         setDeleteDialogState({
//             isOpen: true,
//             planName: planName,
//         });
//     };

//     const handleEditMilestone = (item: WorkPlanItem) => {
//         setEditMilestoneState({
//             isOpen: true,
//             item: item,
//         });
//     };

//     const confirmDelete = async () => {
//         if (deleteDialogState.planName) {
//             try {
//                 await deleteDoc("Work Plan", deleteDialogState.planName);
//                 toast({
//                     title: "Success",
//                     description: "Task deleted successfully",
//                     variant: "success",
//                 });
//                 mutate();
//             } catch (error: any) {
//                 toast({
//                     title: "Error",
//                     description: error.message || "Failed to delete task",
//                     variant: "destructive",
//                 });
//             } finally {
//                 setDeleteDialogState({ isOpen: false, planName: null });
//             }
//         }
//     };

//     const [isDownloading, setIsDownloading] = useState(false);
//     const [isBufferDownloading, setIsBufferDownloading] = useState(false);

//     // Refactored download logic to accept dates
//     const performDownload = async (downloadStartDate: Date | undefined, downloadEndDate: Date | undefined, zone: string | undefined) => {
//         setIsDownloading(true);
//         try {
//             const formatName = "Project Work Plan"; 
            
//             const params = new URLSearchParams({
//                 doctype: "Projects",
//                 name: projectId,
//                 format: formatName,
//                 no_letterhead: "0",
//                 _lang: "en",
//             });

//             if (downloadStartDate) {
//                 params.append("start_date", format(downloadStartDate, "yyyy-MM-dd"));
//             }
//             if (downloadEndDate) {
//                 params.append("end_date", format(downloadEndDate, "yyyy-MM-dd"));
//             }
//             if (zone && zone !== "All") {
//                 params.append("zone", zone);
//             }

//             const url = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
            
//             const response = await fetch(url);
//             if (!response.ok) throw new Error("Network response was not ok");
            
//             const blob = await response.blob();
//             const downloadUrl = window.URL.createObjectURL(blob);
//             const link = document.createElement('a');
//             link.href = downloadUrl;

//             const safeProjectName = (projectName || projectId).replace(/ /g, "_");
//             const zoneSuffix = zone ? `_${zone.replace(/ /g, "_")}` : "_All_Zones";
//             link.download = `WorkPlan_${safeProjectName}${zoneSuffix}_${format(new Date(), "dd-MMM-yyyy")}.pdf`;
//             document.body.appendChild(link);
//             link.click();
//             document.body.removeChild(link);
//             window.URL.revokeObjectURL(downloadUrl);
//         } catch (error) {
//             console.error("Download failed:", error);
//             toast({
//                 title: "Download Failed",
//                 description: "Could not download the Work Plan PDF. Please check if the Print Format exists.",
//                 variant: "destructive",
//             });
//         } finally {
//             setIsDownloading(false);
//         }
//     };

//     const handleDownloadAll = (e: React.MouseEvent) => {
//         e.stopPropagation();
//         // Explicitly pass undefined to download all zones regardless of active tab
//         performDownload(startDate, endDate, undefined);
//     };

//     const handleDownloadZone = (e: React.MouseEvent) => {
//         e.stopPropagation();
//         // Pass the current active zone
//         performDownload(startDate, endDate, activeZone);
//     };

//     const handleBufferDownload = async (start: Date | undefined, end: Date | undefined, days: number | string, toStart: boolean, toEnd: boolean) => {
//         setIsBufferDownloading(true);
//         try {
//             const formatName = "Project Work Plan Buffered"; 
            
//             const params = new URLSearchParams({
//                 doctype: "Projects",
//                 name: projectId,
//                 format: formatName,
//                 no_letterhead: "0",
//                 _lang: "en",
//             });

//             if (start) params.append("start_date", format(start, "yyyy-MM-dd"));
//             if (end) params.append("end_date", format(end, "yyyy-MM-dd"));
            
//             if (activeZone && activeZone !== "All") {
//                 params.append("zone", activeZone);
//             }
            
//             // Pass extra parameters for the buffered print format
//             params.append("buffer_days", String(days));
//             params.append("add_to_start", String(toStart));
//             params.append("add_to_end", String(toEnd));

//             const url = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
            
//             const response = await fetch(url);
//             if (!response.ok) throw new Error("Network response was not ok");
            
//             const blob = await response.blob();
//             const downloadUrl = window.URL.createObjectURL(blob);
//             const link = document.createElement('a');
//             link.href = downloadUrl;

//             const safeProjectName = (projectName || projectId).replace(/ /g, "_");
//             link.download = `WorkPlan_${safeProjectName}_${format(new Date(), "dd-MMM-yyyy")}.pdf`;
//             document.body.appendChild(link);
//             link.click();
//             document.body.removeChild(link);
//             window.URL.revokeObjectURL(downloadUrl);
//         } catch (error) {
//             console.error("Buffer download failed:", error);
//             toast({
//                 title: "Download Failed",
//                 description: "Could not download the Buffer Work Plan PDF.",
//                 variant: "destructive",
//             });
//         } finally {
//             setIsBufferDownloading(false);
//             setIsBufferDialogOpen(false);
//         }
//     }

//     const closeCreateTask = () => {
//         setCreateTaskState((prev) => ({ ...prev, isOpen: false }));
//     };



//     if (loading) {
//         return (
//             <div className="flex h-40 w-full items-center justify-center">
//                 <Loader2 className="h-8 w-8 animate-spin text-primary" />
//                 <span className="ml-2 text-sm text-gray-500">Loading work plan...</span>
//             </div>
//         );
//     }

//     if (error) {
//         return (
//             <div className="rounded-md bg-red-50 p-4 text-sm text-red-500">
//                 <div className="flex items-center font-medium">
//                     <AlertCircle className="mr-2 h-4 w-4" />
//                     Error loading work plan
//                 </div>
//                 <div className="mt-1 pl-6">{error.message}</div>
//             </div>
//         );
//     }

//     let workHeaders = result?.message?.data ? Object.keys(result.message.data) : [];
    
//     // Filter headers if isOverview is true
//     if (isOverview && result?.message?.data) {
//         workHeaders = workHeaders.filter(header => {
//             const items = result.message.data[header];
//             // Keep header only if it has at least one item with planned activities
//             return items?.some(item => item.work_plan_doc && item.work_plan_doc.length > 0);
//         });
//     }

//     const hasData = workHeaders.length > 0;

//     let totalPlannedActivities = 0;
//     if (result?.message?.data) {
//         Object.values(result.message.data).forEach((items) => {
//             const filteredItems = activeZone 
//                 ? items.filter(item => item.zone === activeZone) 
//                 : items;
                
//             filteredItems.forEach((item) => {
//                 totalPlannedActivities += item.work_plan_doc?.length || 0;
//             });
//         });
//     }



//     return (
//         <div className="space-y-6">
//              <div className="overflow-hidden bg-white">
//                 {
//                     <div 
//                         className="flex items-center justify-between bg-white py-2"
//                         // onClick={() => setIsMainExpanded(!isMainExpanded)}
//                     >
//                         <div className="flex items-center gap-3">
//                             <h3 className="text-xl font-bold text-gray-900">Work Plan</h3>
//                             <Badge variant="secondary" className="bg-blue-700 text-white hover:bg-blue-800 h-6 w-6 p-0 flex items-center justify-center rounded-full text-[12px]">
//                                  {/* {totalPlannedActivities} */}
//                             </Badge>
//                         </div>
//                     </div>
//                 }
//             </div>

//             {zones.length > 0 && (
//                 <Tabs value={activeZone || "All"} onValueChange={(val) => handleZoneChange(val === "All" ? "" : val)} className="w-full overflow-x-auto">
//                     <div className="flex items-center justify-between bg-gray-100/50 p-1 rounded-md">
//                         <TabsList className="bg-transparent p-0 h-auto justify-start">
//                             <TabsTrigger value="All" className="px-3 py-1.5 text-xs gap-2">
//                                 All
//                             </TabsTrigger>
//                             {zones.map((zone) => (
//                                 <TabsTrigger key={zone} value={zone} className="px-3 py-1.5 text-xs gap-2">
//                                     {zone}
//                                     {/* {zoneCounts[zone] > 0 && (
//                                         <span className="flex items-center justify-center bg-gray-200 text-gray-700 rounded-full w-4 h-4 text-[9px] font-bold">
//                                             {zoneCounts[zone]}
//                                         </span>
//                                     )} */}
//                                 </TabsTrigger>
//                             ))}
//                         </TabsList>
//                         <div className="flex items-center gap-2">
//                             <Button 
//                                 variant="outline" 
//                                 size="sm" 
//                                 className="h-7 text-[10px] text-gray-600 gap-1.5 px-2 border-gray-300"
//                                 onClick={(e) => { 
//                                     e.stopPropagation(); 
//                                     setBufferDays("");
//                                     setAddToStart(true);
//                                     setAddToEnd(true);
//                                     setIsBufferDialogOpen(true); 
//                                 }}
//                                 disabled={isDownloading}
//                                 title={`Buffer Export ${activeZone || "All"}`}
//                             >
//                                 <Download className="h-3 w-3" />
//                                 Buffer Export {activeZone || "All"}
//                             </Button>
//                             <Button
//                                 variant="ghost"
//                                 size="sm"
//                                 className="h-7 text-[10px] text-gray-600 hover:text-blue-600 gap-1.5 px-2 mr-1"
//                                 onClick={handleDownloadZone}
//                                 disabled={isDownloading}
//                                 title={`Export ${activeZone || "All"} data`}
//                             >
//                                 {isDownloading ? (
//                                     <Loader2 className="h-3 w-3 animate-spin" />
//                                 ) : (
//                                     <Download className="h-3 w-3" />
//                                 )}
//                                 Export {activeZone || "All"}
//                             </Button>
//                         </div>
//                     </div>
//                 </Tabs>
//             )}
                
//                 {isMainExpanded && (
//                     <div className="p-2 space-y-4">
//                         {!hasData ? (
//                             <div className="rounded-lg border bg-gray-50 p-8 text-center text-gray-500">
//                                 {result?.message?.reason || "No work plan items found."}
//                             </div>
//                         ) : (
//                             workHeaders.map((header) => {
//                                 let items = result?.message?.data[header] || [];
                                
//                                 if (isOverview) {
//                                   items = items.filter(item => item.work_plan_doc && item.work_plan_doc.length > 0);
//                                 }

//                                 if(activeZone) {
//                                     items = items.filter(item => item.zone === activeZone);
//                                 }

//                                 if (items.length === 0) return null;

//                                 // Calculate Weighted Progress
//                                 const totalWeightage = items.reduce((sum, item) => sum + (item.weightage || 1.0), 0);
//                                 const totalWeightedProgress = items.reduce((sum, item) => sum + ((item.progress || 0) * (item.weightage || 1.0)), 0);
                                
//                                 const avgProgress = totalWeightage > 0 
//                                     ? Math.round(totalWeightedProgress / totalWeightage)
//                                     : 0;

//                                 const plannedActivitiesCount = items.reduce((acc, item) => acc + (item.work_plan_doc?.length || 0), 0);
//                                 const isExpanded = expandedHeaders[header] !== false;

//                                 if (isOverview) {
//                                     return (
//                                         <WorkPlanOverview 
//                                             key={header}
//                                             header={header}
//                                             items={items}
//                                             getHeaderStats={() => ({ avgProgress, plannedActivitiesCount })}
//                                         />
//                                     );
//                                 }

//                                 return (
//                                     <div key={header} className="overflow-hidden bg-white">
//                                         <div 
//                                             className={`flex cursor-pointer flex-col md:flex-row md:items-center justify-between gap-3 ${isExpanded?"":"border bg-gray-100/50 px-3 py-3 rounded-md"} py-3 transition-colors`}
//                                             onClick={() => toggleHeader(header)}
//                                         >
//                                             <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-3">
//                                                 <h4 className="font-bold text-gray-900 text-base">{`${header} - ${items.length}`}</h4>
//                                                 <span className="rounded-full bg-blue-200 px-2 py-0.5 text-xs font-medium text-gray-900 border border-blue-700 whitespace-nowrap">
//                                                     {plannedActivitiesCount} Planned Activities
//                                                 </span>
//                                             </div>
//                                             <div className="flex items-center justify-between w-full md:w-auto md:gap-4 md:justify-start">
//                                                 <div className="text-sm text-gray-600 flex items-center gap-2">
//                                                     {/* Overall Progress: <span className={`font-bold ${getColorForProgress(avgProgress)}`}>{avgProgress}%</span> */}
//                                                 </div>
//                                                 <div className={`flex h-8 w-8 items-center justify-center ${isExpanded?"":"bg-blue-100 rounded border border-gray-200 shadow-sm"}`}>
//                                                     {isExpanded ? (
//                                                         <ChevronUp className="h-4 w-4 text-gray-500" />
//                                                     ) : (
//                                                         <ChevronDown className="h-4 w-4 text-gray-500" />
//                                                     )}
//                                                 </div>
//                                             </div>
//                                         </div>
//                                         {isExpanded && (
//                                     <div className="overflow-x-auto rounded-lg border bg-white shadow-sm mt-2 mx-2 border-[#D7D7EC]">
//                                         <div className="p-0">
//                                             <table className="w-full text-left text-sm">
//                                                 <thead className="bg-gray-100/50">
//                                                     <tr>
//                                                         <th className="px-4 py-3 font-semibold text-gray-900 w-[300px]">Work</th>
//                                                         <th className="px-4 py-3 font-semibold text-gray-900 w-[140px] text-center">Zone</th>
//                                                         <th className="px-4 py-3 font-semibold text-gray-900 w-[140px] text-center">Status</th>
//                                                         <th className="px-4 py-3 font-semibold text-gray-900 w-[100px] text-center">Progress</th>
//                                                         <th className="px-4 py-3 font-semibold text-gray-900 w-[120px] text-center">Start Date</th>
//                                                         <th className="px-4 py-3 font-semibold text-gray-900 w-[120px] text-center">End Date</th>
//                                                         {!isOverview && (
//                                                             <th className="px-4 py-3 font-semibold text-gray-900 w-[140px]">Admin Actions</th>
//                                                         )}
//                                                     </tr>
//                                                 </thead>
//                                                 <tbody className="divide-y divide-gray-100">
//                                                     {items.map((item, idx) => (
//                                                         <MilestoneRow 
//                                                             key={idx} 
//                                                             item={item} 
//                                                             onAddTask={handleAddTask}
//                                                             onEditTask={handleEditTask}
//                                                             onDeleteTask={handleDeleteTask}
//                                                             onEditMilestone={handleEditMilestone}
//                                                             isOverview={isOverview}
//                                                         />
//                                                     ))}
//                                                 </tbody>
//                                             </table>
//                                         </div>
//                                     </div>
//                                 )}
//                                     </div>
//                                 );
//                             })
//                         )}
//                     </div>
//                 )}

//             {createTaskState.isOpen && createTaskState.data && (
//                 <CreateWorkplantask
//                     isOpen={createTaskState.isOpen}
//                     onClose={closeCreateTask}
//                     onSuccess={() => {
//                          mutate(); 
//                     }}
//                     defaultValues={createTaskState.data}
//                     docName={createTaskState.docName}
//                     initialData={createTaskState.initialData}
//                 />
//             )}
//             {editMilestoneState.isOpen && (
//                 <EditMilestoneDialog
//                     isOpen={editMilestoneState.isOpen}
//                     onClose={() => setEditMilestoneState({ isOpen: false, item: null })}
//                     item={editMilestoneState.item}
//                     onSuccess={() => mutate()}
//                 />
//             )}
//              {/* Buffer Export Dialog */}
//              <Dialog open={isBufferDialogOpen} onOpenChange={setIsBufferDialogOpen}>
//                 <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden">
//                     <DialogHeader className="px-6 pt-6 pb-4 border-b bg-gray-50/50">
//                         <DialogTitle className="text-xl font-bold text-gray-900 leading-none">Client Version Export</DialogTitle>
//                     </DialogHeader>
//                     <div className="grid gap-6 px-6 py-6">
//                         <div className="grid grid-cols-[auto_1fr] items-center gap-4 pt-1">
//                             <Label htmlFor="bufferDays" className="font-semibold whitespace-nowrap">Add Buffer Days:</Label>
//                             <Input
//                                 id="bufferDays"
//                                 type="number"
//                                 value={bufferDays}
//                                 onChange={(e) => setBufferDays(e.target.value === "" ? "" : Number(e.target.value))}
//                                 className="w-full h-9"
//                                 placeholder="Enter days"
//                             />
//                         </div>
//                         <div className="flex gap-6">
//                             <div className="flex items-center space-x-2">
//                                 <Checkbox 
//                                     id="addToStart" 
//                                     checked={addToStart}
//                                     onCheckedChange={(checked) => setAddToStart(checked as boolean)}
//                                 />
//                                 <Label htmlFor="addToStart" className="text-sm font-medium cursor-pointer">
//                                     Add to Start Date
//                                 </Label>
//                             </div>
//                             <div className="flex items-center space-x-2">
//                                 <Checkbox 
//                                     id="addToEnd" 
//                                     checked={addToEnd}
//                                     onCheckedChange={(checked) => setAddToEnd(checked as boolean)}
//                                 />
//                                 <Label htmlFor="addToEnd" className="text-sm font-medium cursor-pointer">
//                                     Add to End Date
//                                 </Label>
//                             </div>
//                         </div>
//                     </div>
//                     <DialogFooter className="px-6 py-4 border-t bg-gray-50/50 flex items-center justify-end gap-3">
//                         <Button 
//                             variant="outline" 
//                             onClick={() => setIsBufferDialogOpen(false)}
//                             disabled={isBufferDownloading}
//                             className="h-9 px-4 text-sm font-medium border-gray-300 hover:bg-gray-100 transition-colors"
//                         >
//                             Cancel
//                         </Button>
//                         <Button 
//                             onClick={() => handleBufferDownload(startDate, endDate, bufferDays, addToStart, addToEnd)}
//                             disabled={(!addToStart && !addToEnd) || isBufferDownloading || bufferDays === ""}
//                             className="h-9 px-4 text-sm font-medium transition-all"
//                         >
//                             {isBufferDownloading ? (
//                                 <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Exporting...</>
//                             ) : (
//                                 "Confirm"
//                             )}
//                         </Button>
//                     </DialogFooter>
//                 </DialogContent>
//             </Dialog>

//              <AlertDialog open={deleteDialogState.isOpen} onOpenChange={(open) => setDeleteDialogState(prev => ({ ...prev, isOpen: open }))}>
//                 <AlertDialogContent>
//                     <AlertDialogHeader>
//                         <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
//                         <AlertDialogDescription>
//                             This action cannot be undone. This will permanently delete the task.
//                         </AlertDialogDescription>
//                     </AlertDialogHeader>
//                     <AlertDialogFooter>
//                         <AlertDialogCancel>Cancel</AlertDialogCancel>
//                         <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
//                             Delete
//                         </AlertDialogAction>
//                     </AlertDialogFooter>
//                 </AlertDialogContent>
//             </AlertDialog>
//         </div>
//     );
// };

import React, { useMemo, useState, useEffect } from "react";
import { useFrappeGetCall, useFrappeGetDoc, useFrappeDeleteDoc } from "frappe-react-sdk";
import { format, addDays, subDays } from "date-fns";
import { safeFormatDate } from "@/lib/utils";
import { AlertCircle, Calendar, CheckCircle, Circle, Loader2, ChevronDown, ChevronUp, Pencil, Trash2, Download } from "lucide-react";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { CreateWorkplantask } from "./CreateWorkplantask";
import { Badge } from "@/components/ui/badge";
import { WorkPlanOverview } from "./WorkPlanOverview";

import { useToast } from "@/components/ui/use-toast";
import { useUrlParam } from "@/hooks/useUrlParam";
import { urlStateManager } from "@/utils/urlStateManager";
import { Button } from "@/components/ui/button";
import { EditMilestoneDialog } from "./EditMilestoneDialog";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SevendaysWorkPlanProps {
    projectId: string;
    startDate: Date | undefined;
    endDate: Date | undefined;
    isOverview?: boolean;
    projectName?: string;
}

export interface WorkPlanItem {
    project: string;
    zone: string;
    work_milestone_name: string;
    work_header: string;
    status: string;
    progress: number;
    expected_starting_date: string;
    expected_completion_date: string;
    work_plan_doc?: WorkPlanDoc[];
    source: string;
    weightage?: number;
    dpr_name?: string;
}

export interface WorkPlanDoc {
    name: string;
    wp_title: string;
    wp_status: string;
    wp_start_date: string;
    wp_end_date: string;
    wp_description: string;
}

export const getColorForProgress = (value: number): string => {
    const val = Math.round(value);
    if (isNaN(val)) return "text-gray-500";
    if (val === 0) return "text-gray-400"; 
    if (val < 50) return "text-red-600";
    if (val < 75) return "text-yellow-600";
    if (val < 100) return "text-green-600";
    return "text-green-500";
};

const MilestoneRow = ({ item, onAddTask, onEditTask, onDeleteTask, onEditMilestone, isOverview }: { 
    item: WorkPlanItem, 
    onAddTask: (item: WorkPlanItem) => void,
    onEditTask: (plan: WorkPlanDoc, item: WorkPlanItem) => void,
    onDeleteTask: (planName: string) => void,
    onEditMilestone: (item: WorkPlanItem) => void,
    isOverview?: boolean
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const workPlans = item.work_plan_doc || [];
    const hasWorkPlans = workPlans.length > 0;

    return (
        <>
            <tr className="hover:bg-gray-50/50">
                <td className="px-4 py-3 text-gray-700 border-b-0">
                    <div className="font-medium text-gray-900">{item.work_milestone_name}</div>
                </td>
                {/* <td className="px-4 py-3 font-medium text-gray-900 border-b-0 text-center">
                    <span className="inline-flex items-center justify-center h-6 min-w-[100px] w-fit rounded border border-dashed border-gray-300 bg-gray-50 px-3 text-xs text-gray-600 whitespace-nowrap">
                        {item.zone || "Zone 1"}
                    </span>
                </td> */}
                <td className="px-4 py-3 border-b-0 text-center">
                        <span
                        className={`inline-flex items-center justify-center h-6 min-w-[100px] w-fit rounded-full px-3 text-xs font-medium whitespace-nowrap ${
                            item.status === "Completed"
                                ? "bg-green-100 text-green-800 border border-green-200"
                                : item.status === "WIP" || item.status === "In Progress"
                                ? "bg-orange-100 text-orange-800 border border-orange-200"
                                : item.status === "Not Started"
                                ? "bg-red-100 text-red-800 border border-red-200"
                                : "bg-gray-100 text-gray-800 border border-gray-200"
                        }`}
                    >
                        {item.status}
                        {!isOverview && (
                        <button 
                            className="ml-2 p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50  transition-all inline-flex items-center"
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditMilestone(item);
                            }}
                            title="Edit Milestone"
                        >
                            <Pencil className="h-3 w-3" />
                        </button>
                    )}
                    </span>
                    
                </td>

                <td className="px-4 py-3 text-gray-700 border-b-0 text-center">
                    <div className="flex items-center justify-center gap-2">
                        <ProgressCircle 
                            value={item.progress} 
                            className={`size-10 ${getColorForProgress(item.progress)}`}
                            textSizeClassName="text-[10px]"
                        />
                    </div>
                </td>
                <td className="px-4 py-3 text-xs font-medium text-gray-700 border-b-0 text-center">
                    {item.expected_starting_date ? (
                        <span className="text-red-600 font-bold">{safeFormatDate(item.expected_starting_date)}</span>
                    ) : "NA"}
                </td>
                <td className="px-4 py-3 text-xs font-medium text-gray-700 border-b-0 text-center">
                        {item.expected_completion_date ? (
                        <span className="text-red-600 font-bold">{safeFormatDate(item.expected_completion_date)}</span>
                    ) : "NA"}
                </td>
                {!isOverview && (
                    <td className="px-4 py-3 border-b-0">
                            <button 
                            className="flex items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
                            onClick={() => onAddTask(item)}
                            >
                            <span className="mr-1 text-lg leading-none">+</span> Add Task
                            </button>
                    </td>
                )}
            </tr>
            {hasWorkPlans && (
                <tr>
                    <td colSpan={isOverview ? 6 : 7} className=" pb-2 pt-0 m-0 p-0">
                        <div className="rounded-md border-b bg-blue-50/30">
                            <button 
                                className="flex w-full items-center justify-between px-4 py-2 text-sm text-blue-800 hover:bg-blue-50"
                                onClick={() => setIsExpanded(!isExpanded)}
                            >
                                <div className="flex items-center gap-2 font-semibold">
                                    Planned Activities 
                                    <Badge className="bg-blue-700 text-white hover:bg-blue-800 h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px]">
                                        {workPlans.length}
                                    </Badge>
                                </div>
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                            
                            {isExpanded && (
                                <div className="space-y-3 p-4">
                                    {workPlans.map((plan) => (
                                        <div key={plan.name} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-[0_2px_4px_rgba(0,0,0,0.02)] hover:shadow-md transition-shadow">
                                            {/* Left: Title and Note */}
                                            <div className="space-y-1.5 w-[300px] shrink-0 pr-4">
                                                <div className="font-semibold text-gray-900 text-sm leading-tight truncate" title={plan.wp_title}>{plan.wp_title}</div>
                                                 {plan.wp_description && (
                                            <div className="text-xs text-gray-500 whitespace-normal break-words leading-relaxed" title={plan.wp_description}>
                                                <span className="font-semibold text-yellow-600">Note: </span>
                                                {plan.wp_description}
                                            </div>
                                        )}
                                            </div>
                                            
                                            {/* Center: Status and Date Metadata */}
                                            <div className="flex items-center gap-2 shrink-0 mx-4">
                                                <div className="flex flex-col items-center gap-1.5 w-[100px]">
                                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Status</span>
                                                    <span className={`w-full text-center rounded-md px-2 py-1 text-xs font-semibold border truncate ${
                                                        plan.wp_status === 'Pending' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                                        plan.wp_status === 'Completed' ? 'bg-green-50 text-green-700 border-green-200' :
                                                        plan.wp_status === 'In Progress' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                                        'bg-gray-50 text-gray-700 border-gray-200'
                                                    }`}>
                                                        {plan.wp_status || 'Pending'}
                                                    </span>
                                                </div>

                                                <div className="flex flex-col items-center gap-1.5 w-[110px]">
                                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Start Date</span>
                                                    <div className="w-full text-center rounded border px-2 py-1 text-xs font-semibold bg-white text-gray-700 shadow-sm truncate">
                                                        {safeFormatDate(plan.wp_start_date)}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col items-center gap-1.5 w-[110px]">
                                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">End Date</span>
                                                    <div className="w-full text-center rounded border px-2 py-1 text-xs font-semibold bg-white text-gray-700 shadow-sm truncate">
                                                        {safeFormatDate(plan.wp_end_date)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right: Actions */}
                                            {!isOverview && (
                                                <div className="flex items-center gap-1 pl-4 border-l border-gray-100 h-8">
                                                    <button 
                                                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                                                        onClick={() => onEditTask(plan, item)}
                                                        title="Edit Task"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </button>
                                                    <button 
                                                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
                                                        onClick={() => onDeleteTask(plan.name)}
                                                        title="Delete Task"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
};

export const SevendaysWorkPlan = ({
    projectId,
    startDate,
    endDate,
    isOverview,
    projectName
}: SevendaysWorkPlanProps) => {
    
    const [isBufferDialogOpen, setIsBufferDialogOpen] = useState(false);
    // Track which zone we are doing the buffer export for (undefined = All, string = specific zone)
    const [bufferTargetZone, setBufferTargetZone] = useState<string | undefined>(undefined);
    
    const [bufferDays, setBufferDays] = useState<number | string>("");
    const [addToStart, setAddToStart] = useState<boolean>(true);
    const [addToEnd, setAddToEnd] = useState<boolean>(true);
    const [isMainExpanded, setIsMainExpanded] = useState(true);

    const { toast } = useToast();
    const { deleteDoc } = useFrappeDeleteDoc();

    const shouldFetch = projectId;
    const { data: result, error, isLoading: loading, mutate } = useFrappeGetCall<{
        message: {
            data: Record<string, WorkPlanItem[]>;
            reason: string | null;
        }
    }>(
        shouldFetch
            ? "nirmaan_stack.api.seven_days_planning.work_plan_api.get_work_plan"
            : null,
        shouldFetch
            ? {
                  project: projectId,
                  start_date: startDate ? format(startDate, "yyyy-MM-dd") : undefined,
                  end_date: endDate ? format(endDate, "yyyy-MM-dd") : undefined,
              }
            : undefined
    );


    const { data: projectDoc } = useFrappeGetDoc("Projects", projectId);
    const zones: string[] = useMemo(() => {
        if (!projectDoc?.project_zones) return [];
        return projectDoc.project_zones.map((z: any) => z.zone_name).sort();
    }, [projectDoc]);

    const urlZone = useUrlParam("planningZone");
    
    // Derived state from URL or fallback
    const [activeZone, setActiveZone] = useState<string>("");

    // Effect to sync local state with URL and handle defaults
    useEffect(() => {
        if (zones.length > 0) {
            // If URL has valid zone, use it
            if (urlZone && zones.includes(urlZone)) {
                setActiveZone(urlZone);
            } 
            // If URL has no zone or invalid zone, default to first zone and update URL
            else if (!urlZone || !zones.includes(urlZone)) {
                const defaultZone = zones[0];
                setActiveZone(defaultZone);
                if (urlZone !== defaultZone) {
                   urlStateManager.updateParam("planningZone", defaultZone);
                }
            }
        }
    }, [zones, urlZone]);

    const handleZoneChange = (zone: string) => {
        setActiveZone(zone);
        urlStateManager.updateParam("planningZone", zone);
    };

    const [expandedHeaders, setExpandedHeaders] = useState<Record<string, boolean>>({});

    const toggleHeader = (header: string) => {
        setExpandedHeaders((prev) => ({
            ...prev,
            [header]: prev[header] === false ? true : false,
        }));
    };

    const [editMilestoneState, setEditMilestoneState] = useState<{
        isOpen: boolean;
        item: WorkPlanItem | null;
    }>({
        isOpen: false,
        item: null,
    });

    const [createTaskState, setCreateTaskState] = useState<{
        isOpen: boolean;
        data: {
            project: string;
            zone: string;
            work_header: string;
            work_milestone: string;
        } | null;
        docName?: string;
        initialData?: {
            wp_title: string;
            wp_status: string;
            wp_start_date: string;
            wp_end_date: string;
            wp_description: string;
        };
    }>({
        isOpen: false,
        data: null,
    });

    const [deleteDialogState, setDeleteDialogState] = useState<{
        isOpen: boolean;
        planName: string | null;
    }>({
        isOpen: false,
        planName: null,
    });

    const handleAddTask = (item: WorkPlanItem) => {
        setCreateTaskState({
            isOpen: true,
            data: {
                project: projectId, // specific field name from props
                zone: item.zone,
                work_header: item.work_header,
                work_milestone: item.work_milestone_name,
            },
            docName: undefined,
            initialData: undefined
        });
    };

    const handleEditTask = (plan: WorkPlanDoc, item: WorkPlanItem) => {
        setCreateTaskState({
            isOpen: true,
            data: {
                project: projectId,
                zone: item.zone,
                work_header: item.work_header,
                work_milestone: item.work_milestone_name,
            },
            docName: plan.name,
            initialData: {
                wp_title: plan.wp_title,
                wp_status: plan.wp_status,
                wp_start_date: plan.wp_start_date,
                wp_end_date: plan.wp_end_date,
                wp_description: plan.wp_description
            }
        });
    };

    const handleDeleteTask = (planName: string) => {
        setDeleteDialogState({
            isOpen: true,
            planName: planName,
        });
    };

    const handleEditMilestone = (item: WorkPlanItem) => {
        setEditMilestoneState({
            isOpen: true,
            item: item,
        });
    };

    const confirmDelete = async () => {
        if (deleteDialogState.planName) {
            try {
                await deleteDoc("Work Plan", deleteDialogState.planName);
                toast({
                    title: "Success",
                    description: "Task deleted successfully",
                    variant: "success",
                });
                mutate();
            } catch (error: any) {
                toast({
                    title: "Error",
                    description: error.message || "Failed to delete task",
                    variant: "destructive",
                });
            } finally {
                setDeleteDialogState({ isOpen: false, planName: null });
            }
        }
    };

    const [isDownloading, setIsDownloading] = useState(false);
    const [isBufferDownloading, setIsBufferDownloading] = useState(false);

    // Refactored download logic to accept dates
    const performDownload = async (downloadStartDate: Date | undefined, downloadEndDate: Date | undefined, zone: string | undefined) => {
        setIsDownloading(true);
        try {
            const formatName = "Project Work Plan"; 
            
            const params = new URLSearchParams({
                doctype: "Projects",
                name: projectId,
                format: formatName,
                no_letterhead: "0",
                _lang: "en",
            });

            if (downloadStartDate) {
                params.append("start_date", format(downloadStartDate, "yyyy-MM-dd"));
            }
            if (downloadEndDate) {
                params.append("end_date", format(downloadEndDate, "yyyy-MM-dd"));
            }
            // Passing undefined or "All" to zone will export all zones (controlled by print format logic)
            if (zone && zone !== "All") {
                params.append("zone", zone);
            }

            const url = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
            
            const response = await fetch(url);
            if (!response.ok) throw new Error("Network response was not ok");
            
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;

            const safeProjectName = (projectName || projectId).replace(/ /g, "_");
            const zoneSuffix = (zone && zone !== "All") ? `_${zone.replace(/ /g, "_")}` : "_All_Zones";
            link.download = `WorkPlan_${safeProjectName}${zoneSuffix}_${format(new Date(), "dd-MMM-yyyy")}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            console.error("Download failed:", error);
            toast({
                title: "Download Failed",
                description: "Could not download the Work Plan PDF. Please check if the Print Format exists.",
                variant: "destructive",
            });
        } finally {
            setIsDownloading(false);
        }
    };

    const handleDownloadAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Export ALL zones
        performDownload(startDate, endDate, undefined);
    };

    const handleDownloadZone = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Export ACTIVE zone
        performDownload(startDate, endDate, activeZone);
    };

    const openBufferDialog = (e: React.MouseEvent, zone: string | undefined) => {
        e.stopPropagation();
        setBufferTargetZone(zone); // Store which zone (or All) we are exporting
        setBufferDays("");
        setAddToStart(true);
        setAddToEnd(true);
        setIsBufferDialogOpen(true);
    };

    const handleBufferDownload = async (start: Date | undefined, end: Date | undefined, days: number | string, toStart: boolean, toEnd: boolean) => {
        setIsBufferDownloading(true);
        try {
            const formatName = "Project Work Plan Buffered"; 
            
            const params = new URLSearchParams({
                doctype: "Projects",
                name: projectId,
                format: formatName,
                no_letterhead: "0",
                _lang: "en",
            });

            if (start) params.append("start_date", format(start, "yyyy-MM-dd"));
            if (end) params.append("end_date", format(end, "yyyy-MM-dd"));
            
            // Use the stored target zone (from when dialog was opened)
            if (bufferTargetZone && bufferTargetZone !== "All") {
                params.append("zone", bufferTargetZone);
            }
            
            // Pass extra parameters for the buffered print format
            params.append("buffer_days", String(days));
            params.append("add_to_start", String(toStart));
            params.append("add_to_end", String(toEnd));

            const url = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
            
            const response = await fetch(url);
            if (!response.ok) throw new Error("Network response was not ok");
            
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;

            const safeProjectName = (projectName || projectId).replace(/ /g, "_");
            const zoneSuffix = (bufferTargetZone && bufferTargetZone !== "All") ? `_${bufferTargetZone.replace(/ /g, "_")}` : "_All_Zones";
            link.download = `WorkPlan_${safeProjectName}${zoneSuffix}_Buffered_${format(new Date(), "dd-MMM-yyyy")}.pdf`;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            console.error("Buffer download failed:", error);
            toast({
                title: "Download Failed",
                description: "Could not download the Buffer Work Plan PDF.",
                variant: "destructive",
            });
        } finally {
            setIsBufferDownloading(false);
            setIsBufferDialogOpen(false);
        }
    }

    const closeCreateTask = () => {
        setCreateTaskState((prev) => ({ ...prev, isOpen: false }));
    };

    if (loading) {
        return (
            <div className="flex h-40 w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-sm text-gray-500">Loading work plan...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-md bg-red-50 p-4 text-sm text-red-500">
                <div className="flex items-center font-medium">
                    <AlertCircle className="mr-2 h-4 w-4" />
                    Error loading work plan
                </div>
                <div className="mt-1 pl-6">{error.message}</div>
            </div>
        );
    }

    let workHeaders = result?.message?.data ? Object.keys(result.message.data) : [];
    
    // Filter headers if isOverview is true
    if (isOverview && result?.message?.data) {
        workHeaders = workHeaders.filter(header => {
            const items = result.message.data[header];
            // Keep header only if it has at least one item with planned activities
            return items?.some(item => item.work_plan_doc && item.work_plan_doc.length > 0);
        });
    }

    const hasData = workHeaders.length > 0;

    let totalPlannedActivities = 0;
    if (result?.message?.data) {
        Object.values(result.message.data).forEach((items) => {
            const filteredItems = activeZone 
                ? items.filter(item => item.zone === activeZone) 
                : items;
                
            filteredItems.forEach((item) => {
                totalPlannedActivities += item.work_plan_doc?.length || 0;
            });
        });
    }

    return (
        <div className="space-y-6">
             <div className="overflow-hidden bg-white">
                {
                    <div 
                        className="flex items-center justify-between bg-white py-2"
                    >
                        <div className="flex items-center gap-3">
                            <h3 className="text-xl font-bold text-gray-900">Work Plan</h3>
                        </div>
                        {/* GLOBAL EXPORT BUTTONS (ALL ZONES) */}
                        <div className="flex items-center gap-2">
                             <Button 
                                variant="outline" 
                                size="sm" 
                                className="gap-2 h-8 text-xs border-gray-300 text-gray-700"
                                onClick={(e) => openBufferDialog(e, undefined)} // Undefined = All Zones
                                disabled={isDownloading}
                                title="Export Buffered plan for ALL zones"
                            >
                                <Download className="h-3.5 w-3.5" />
                                Buffer Export (All)
                            </Button>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="gap-2 h-8 text-xs border-gray-300 text-gray-700"
                                onClick={handleDownloadAll}
                                disabled={isDownloading}
                                title="Export plan for ALL zones"
                            >
                                {isDownloading ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Download className="h-3.5 w-3.5" />
                                )}
                                Export (All)
                            </Button>
                        </div>
                    </div>
                }
            </div>

            {zones.length > 0 && (
                <Tabs value={activeZone} onValueChange={handleZoneChange} className="w-full overflow-x-auto">
                    <div className="flex items-center justify-between bg-gray-100/50 p-1 rounded-md">
                        <TabsList className="bg-transparent p-0 h-auto justify-start">
                            {/* REMOVED "ALL" TAB HERE */}
                            {zones.map((zone) => (
                                <TabsTrigger key={zone} value={zone} className="px-3 py-1.5 text-xs gap-2">
                                    {zone}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        {/* PER-ZONE EXPORT BUTTONS */}
                        <div className="flex items-center gap-2">
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-7 text-[10px] text-gray-600 gap-1.5 px-2 border-gray-300"
                                onClick={(e) => openBufferDialog(e, activeZone)} // Specific Zone
                                disabled={isDownloading}
                                title={`Buffer Export ${activeZone}`}
                            >
                                <Download className="h-3 w-3" />
                                Buffer Export 
                                {/* {activeZone} */}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[10px] text-gray-600 hover:text-blue-600 gap-1.5 px-2 mr-1"
                                onClick={handleDownloadZone}
                                disabled={isDownloading}
                                title={`Export ${activeZone} data`}
                            >
                                {isDownloading ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    <Download className="h-3 w-3" />
                                )}
                                Export 
                                {/* {activeZone} */}
                            </Button>
                        </div>
                    </div>
                </Tabs>
            )}
                
                {isMainExpanded && (
                    <div className="p-2 space-y-4">
                        {!hasData ? (
                            <div className="rounded-lg border bg-gray-50 p-8 text-center text-gray-500">
                                {result?.message?.reason || "No work plan items found."}
                            </div>
                        ) : (
                            workHeaders.map((header) => {
                                let items = result?.message?.data[header] || [];
                                
                                if (isOverview) {
                                  items = items.filter(item => item.work_plan_doc && item.work_plan_doc.length > 0);
                                }

                                // Strict Filtering: Since we removed the "All" tab, activeZone should usually be set.
                                // If for some reason activeZone is empty, this logic implies showing everything (fallback),
                                // but the UI tabs enforce a selection.
                                if(activeZone) {
                                    items = items.filter(item => item.zone === activeZone);
                                }

                                if (items.length === 0) return null;

                                const totalWeightage = items.reduce((sum, item) => sum + (item.weightage || 1.0), 0);
                                const totalWeightedProgress = items.reduce((sum, item) => sum + ((item.progress || 0) * (item.weightage || 1.0)), 0);
                                
                                const avgProgress = totalWeightage > 0 
                                    ? Math.round(totalWeightedProgress / totalWeightage)
                                    : 0;

                                const plannedActivitiesCount = items.reduce((acc, item) => acc + (item.work_plan_doc?.length || 0), 0);
                                const isExpanded = expandedHeaders[header] !== false;

                                if (isOverview) {
                                    return (
                                        <WorkPlanOverview 
                                            key={header}
                                            header={header}
                                            items={items}
                                            getHeaderStats={() => ({ avgProgress, plannedActivitiesCount })}
                                        />
                                    );
                                }

                                return (
                                    <div key={header} className="overflow-hidden bg-white">
                                        <div 
                                            className={`flex cursor-pointer flex-col md:flex-row md:items-center justify-between gap-3 ${isExpanded?"":"border bg-gray-100/50 px-3 py-3 rounded-md"} py-3 transition-colors`}
                                            onClick={() => toggleHeader(header)}
                                        >
                                            <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-3">
                                                <h4 className="font-bold text-gray-900 text-base">{`${header} - ${items.length}`}</h4>
                                                <span className="rounded-full bg-blue-200 px-2 py-0.5 text-xs font-medium text-gray-900 border border-blue-700 whitespace-nowrap">
                                                    {plannedActivitiesCount} Planned Activities
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between w-full md:w-auto md:gap-4 md:justify-start">
                                                <div className="text-sm text-gray-600 flex items-center gap-2">
                                                </div>
                                                <div className={`flex h-8 w-8 items-center justify-center ${isExpanded?"":"bg-blue-100 rounded border border-gray-200 shadow-sm"}`}>
                                                    {isExpanded ? (
                                                        <ChevronUp className="h-4 w-4 text-gray-500" />
                                                    ) : (
                                                        <ChevronDown className="h-4 w-4 text-gray-500" />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        {isExpanded && (
                                    <div className="overflow-x-auto rounded-lg border bg-white shadow-sm mt-2 mx-2 border-[#D7D7EC]">
                                        <div className="p-0">
                                            <table className="w-full text-left text-sm">
                                                <thead className="bg-gray-100/50">
                                                    <tr>
                                                        <th className="px-4 py-3 font-semibold text-gray-900 w-[300px]">Work</th>
                                                        {/* <th className="px-4 py-3 font-semibold text-gray-900 w-[140px] text-center">Zone</th> */}
                                                        <th className="px-4 py-3 font-semibold text-gray-900 w-[140px] text-center">Status</th>
                                                        <th className="px-4 py-3 font-semibold text-gray-900 w-[100px] text-center">Progress</th>
                                                        <th className="px-4 py-3 font-semibold text-gray-900 w-[120px] text-center">Start Date</th>
                                                        <th className="px-4 py-3 font-semibold text-gray-900 w-[120px] text-center">End Date</th>
                                                        {!isOverview && (
                                                            <th className="px-4 py-3 font-semibold text-gray-900 w-[140px]">Admin Actions</th>
                                                        )}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {items.map((item, idx) => (
                                                        <MilestoneRow 
                                                            key={idx} 
                                                            item={item} 
                                                            onAddTask={handleAddTask}
                                                            onEditTask={handleEditTask}
                                                            onDeleteTask={handleDeleteTask}
                                                            onEditMilestone={handleEditMilestone}
                                                            isOverview={isOverview}
                                                        />
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

            {/* Dialogs and Modals */}
            {createTaskState.isOpen && createTaskState.data && (
                <CreateWorkplantask
                    isOpen={createTaskState.isOpen}
                    onClose={closeCreateTask}
                    onSuccess={() => {
                         mutate(); 
                    }}
                    defaultValues={createTaskState.data}
                    docName={createTaskState.docName}
                    initialData={createTaskState.initialData}
                />
            )}
            {editMilestoneState.isOpen && (
                <EditMilestoneDialog
                    isOpen={editMilestoneState.isOpen}
                    onClose={() => setEditMilestoneState({ isOpen: false, item: null })}
                    item={editMilestoneState.item}
                    onSuccess={() => mutate()}
                />
            )}
            
             {/* Buffer Export Dialog */}
             <Dialog open={isBufferDialogOpen} onOpenChange={setIsBufferDialogOpen}>
                <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden">
                    <DialogHeader className="px-6 pt-6 pb-4 border-b bg-gray-50/50">
                        <DialogTitle className="text-xl font-bold text-gray-900 leading-none">
                            Client Version Export 
                            {bufferTargetZone ? ` (${bufferTargetZone === "All" ? "All Zones" : bufferTargetZone})` : ""}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-6 px-6 py-6">
                        <div className="grid grid-cols-[auto_1fr] items-center gap-4 pt-1">
                            <Label htmlFor="bufferDays" className="font-semibold whitespace-nowrap">Add Buffer Days:</Label>
                            <Input
                                id="bufferDays"
                                type="number"
                                value={bufferDays}
                                onChange={(e) => setBufferDays(e.target.value === "" ? "" : Number(e.target.value))}
                                className="w-full h-9"
                                placeholder="Enter days"
                            />
                        </div>
                        <div className="flex gap-6">
                            <div className="flex items-center space-x-2">
                                <Checkbox 
                                    id="addToStart" 
                                    checked={addToStart}
                                    onCheckedChange={(checked) => setAddToStart(checked as boolean)}
                                />
                                <Label htmlFor="addToStart" className="text-sm font-medium cursor-pointer">
                                    Add to Start Date
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Checkbox 
                                    id="addToEnd" 
                                    checked={addToEnd}
                                    onCheckedChange={(checked) => setAddToEnd(checked as boolean)}
                                />
                                <Label htmlFor="addToEnd" className="text-sm font-medium cursor-pointer">
                                    Add to End Date
                                </Label>
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="px-6 py-4 border-t bg-gray-50/50 flex items-center justify-end gap-3">
                        <Button 
                            variant="outline" 
                            onClick={() => setIsBufferDialogOpen(false)}
                            disabled={isBufferDownloading}
                            className="h-9 px-4 text-sm font-medium border-gray-300 hover:bg-gray-100 transition-colors"
                        >
                            Cancel
                        </Button>
                        <Button 
                            onClick={() => handleBufferDownload(startDate, endDate, bufferDays, addToStart, addToEnd)}
                            disabled={(!addToStart && !addToEnd) || isBufferDownloading || bufferDays === ""}
                            className="h-9 px-4 text-sm font-medium transition-all"
                        >
                            {isBufferDownloading ? (
                                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Exporting...</>
                            ) : (
                                "Confirm"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

             <AlertDialog open={deleteDialogState.isOpen} onOpenChange={(open) => setDeleteDialogState(prev => ({ ...prev, isOpen: open }))}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the task.
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