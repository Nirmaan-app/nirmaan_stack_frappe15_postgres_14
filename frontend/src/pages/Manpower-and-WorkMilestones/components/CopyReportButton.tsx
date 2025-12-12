// import { useState, useMemo } from "react";
// import { useNavigate } from "react-router-dom";
// import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
// import { Button } from "@/components/ui/button";
// import {
//   Dialog,
//   DialogContent,
//   DialogDescription,
//   DialogFooter,
//   DialogHeader,
//   DialogTitle
// } from "@/components/ui/dialog";
// import { Badge } from "@/components/ui/badge";
// import { Separator } from "@/components/ui/separator";
// import { toast } from "@/components/ui/use-toast";
// import { Copy, Loader2, AlertCircle, Users, ListTodo } from "lucide-react";
// import { formatDate } from "@/utils/FormatDate";

// // --- Helper Functions & Styles ---

// const formatDateForInput = (date: Date) => {
//   const d = new Date(date);
//   const year = d.getFullYear();
//   const month = (d.getMonth() + 1).toString().padStart(2, '0');
//   const day = d.getDate().toString().padStart(2, '0');
//   return `${year}-${month}-${day}`;
// };

// const getStatusBadgeClasses = (status: string) => {
//   switch (status) {
//     case "Completed": return "bg-green-100 text-green-800 border-green-200";
//     case "WIP": return "bg-yellow-100 text-yellow-800 border-yellow-200";
//     case "Not Started": return "bg-red-100 text-red-800 border-red-200";
//     case "Not Applicable": // Fallthrough
//     case "N/A": return "bg-gray-100 text-gray-800 border-gray-200";
//     default: return "bg-blue-100 text-blue-800 border-blue-200";
//   }
// };

// export const CopyReportButton = ({ selectedProject, selectedZone,dailyReportDetailsDisable }: { selectedProject: string, selectedZone: string,dailyReportDetailsDisable:boolean }) => {
//   const navigate = useNavigate();
//   const [isDialogOpen, setIsDialogOpen] = useState(false);
//   const [isCopying, setIsCopying] = useState(false);

//   // Date Logic
//   const today = new Date();
//   const yesterday = new Date();
//   yesterday.setDate(today.getDate() - 1);

//   const todayStr = formatDateForInput(today);
//   const yesterdayStr = formatDateForInput(yesterday);

//   const { createDoc } = useFrappeCreateDoc();

//   // 1. Check if TODAY's report already exists
//   const { data: todayReportList } = useFrappeGetDocList("Project Progress Reports", {
//     fields: ["name"],
//     filters: [
//       ["project", "=", selectedProject],
//       ["report_zone", "=", selectedZone],
//       ["report_date", "=", todayStr]
//     ],
//     limit: 1
//   }, selectedProject && selectedZone ? undefined : null);

//   // 2. Check if YESTERDAY's report exists
//   const { data: yesterdayReportList } = useFrappeGetDocList("Project Progress Reports", {
//     fields: ["name", "report_status"],
//     filters: [
//       ["project", "=", selectedProject],
//       ["report_zone", "=", selectedZone],
//       ["report_date", "=", yesterdayStr],
//       ["report_status", "=", "Completed"]
//     ],
//     limit: 1
//   }, selectedProject && selectedZone ? undefined : null);

//   const yesterdayReportName = yesterdayReportList?.[0]?.name;
//   const hasTodayReport = todayReportList && todayReportList.length > 0;
//   const canCopy = !hasTodayReport && !!yesterdayReportName;

//   // 3. Fetch full details of Yesterday's report
//   const { data: fullYesterdayReport, isLoading: isLoadingReport } = useFrappeGetDoc(
//     "Project Progress Reports",
//     yesterdayReportName,
//     yesterdayReportName && isDialogOpen ? undefined : null
//   );

//   // Group Milestones for Display
//   const groupedMilestones = useMemo(() => {
//     if (!fullYesterdayReport?.milestones) return {};
    
//     // Group ALL milestones, regardless of status
//     const groups = fullYesterdayReport.milestones.reduce((acc: any, milestone: any) => {
//         const header = milestone.work_header || "Other"; // Fallback
//         (acc[header] = acc[header] || []).push(milestone);
//         return acc;
//       }, {});

//     // Sort keys alphabetically
//     return Object.keys(groups).sort().reduce((obj: any, key) => {
//       obj[key] = groups[key];
//       return obj;
//     }, {});
//   }, [fullYesterdayReport]);

//   const handleConfirmCopy = async () => {
//     if (!fullYesterdayReport) return;
//     setIsCopying(true);

//     try {
//       // A. Copy Milestones
//       const milestonesPayload = fullYesterdayReport.milestones?.map((m: any) => ({
//         work_milestone_name: m.work_milestone_name,
//         work_header: m.work_header,
//         status: m.status,
//         progress: m.progress,
//         expected_starting_date: m.expected_starting_date,
//         expected_completion_date: m.expected_completion_date,
//         remarks: m.remarks,
//         work_plan: m.work_plan,
//         work_plan_ratio: m.work_plan_ratio
//       })) || [];

//       // B. Copy Manpower
//       const manpowerPayload = fullYesterdayReport.manpower?.map((m: any) => ({
//         label: m.label,
//         count: m.count
//       })) || [];

//       const payload = {
//         project: selectedProject,
//         report_zone: selectedZone,
//         report_date: todayStr, // Set to TODAY
//         report_status: 'Completed',
//         manpower_remarks: fullYesterdayReport.manpower_remarks,
//         milestones: milestonesPayload,
//         manpower: manpowerPayload,
//         attachments: []
//       };

//       await createDoc("Project Progress Reports", payload);

//       toast({
//         title: "Success",
//         description: "Report copied successfully as a Draft for today.",
//         variant: "default", 
//       });

//       setIsDialogOpen(false);
//       navigate(`${selectedProject}?zone=${selectedZone}`);

//     } catch (error: any) {
//       console.error("Copy Error", error);
//       toast({
//         title: "Error",
//         description: error.message || "Failed to copy report.",
//         variant: "destructive"
//       });
//     } finally {
//       setIsCopying(false);
//     }
//   };

//   return (
//     <>
//       <Button
//         variant="outline"
//          className="text-sm w-full md:w-auto md:flex-1 border-blue-600 text-blue-600 hover:bg-blue-50 gap-2"
//         disabled={!canCopy||dailyReportDetailsDisable}
//         onClick={() => setIsDialogOpen(true)}
//       >
//         <Copy className="w-4 h-4" />
//         Copy Yesterday's Report
//       </Button>

//       <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
//         {/* FIX: Added 'min-h-0' to internal containers to allow flex shrinking and scrolling */}
//         <DialogContent className="sm:max-w-2xl w-[95vw] max-h-[85vh] flex flex-col p-0 gap-0 bg-white overflow-hidden">
          
//           {/* Header Area */}
//           <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
//             <DialogTitle className="flex items-center gap-2 text-blue-600">
//               <Copy className="w-5 h-5" /> Copy Report Preview
//             </DialogTitle>
//             <DialogDescription className="mt-1.5">
//               Review the data from <strong>{formatDate(yesterday)}</strong> below.
//               Click confirm to copy this to Today.
//             </DialogDescription>
//           </DialogHeader>

//           {/* Scrollable Content Area 
//               FIX: 'flex-1' takes remaining space. 
//               FIX: 'min-h-0' allows flex child to shrink below content size. 
//               FIX: 'overflow-y-auto' enables native scrolling.
//           */}
//           <div className="flex-1 min-h-0 overflow-y-auto bg-white relative">
//             {isLoadingReport ? (
//               <div className="absolute inset-0 flex items-center justify-center">
//                 <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
//               </div>
//             ) : fullYesterdayReport ? (
//               <div className="px-6 py-4 space-y-6">
                
//                 {/* Alert Box */}
//                 <div className="bg-yellow-50 p-3 rounded-md border border-yellow-200 text-xs text-yellow-800 flex gap-2 items-start">
//                   <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
//                   <span>
//                     This will create a <strong>Draft</strong> report for <strong>{formatDate(today)}</strong>. 
//                     Photos will <strong>NOT</strong> be copied.
//                   </span>
//                 </div>

//                 {/* Manpower Section */}
//                 <div>
//                   <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-3">
//                     <Users className="w-4 h-4" /> Manpower
//                   </h3>
//                   <div className="bg-white rounded-md p-3 border border-gray-200 shadow-sm">
//                     {fullYesterdayReport.manpower && fullYesterdayReport.manpower.length > 0 ? (
//                       <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
//                         {fullYesterdayReport.manpower.map((mp: any, idx: number) => (
//                           <div key={idx} className="flex justify-between text-xs p-2 rounded border bg-gray-50">
//                             <span className="text-gray-600">{mp.label}</span>
//                             <span className="font-bold text-gray-900">{mp.count}</span>
//                           </div>
//                         ))}
//                       </div>
//                     ) : (
//                       <p className="text-xs text-gray-500 italic">No manpower data recorded.</p>
//                     )}
//                     {fullYesterdayReport.manpower_remarks && (
//                       <div className="mt-3 pt-2 border-t border-gray-200">
//                         <p className="text-xs font-semibold text-gray-500">Remarks:</p>
//                         <p className="text-xs text-gray-700 mt-1">{fullYesterdayReport.manpower_remarks}</p>
//                       </div>
//                     )}
//                   </div>
//                 </div>

//                 <Separator />

//                 {/* Milestones Section */}
//                 <div>
//                   <div className="flex justify-between items-center mb-3 sticky top-0 bg-white z-10 py-2">
//                     <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
//                         <ListTodo className="w-4 h-4" /> Work Milestones
//                     </h3>
//                     <Badge variant="outline" className="text-xs">
//                         {fullYesterdayReport.milestones?.length || 0} Total
//                     </Badge>
//                   </div>
                  
//                   {Object.keys(groupedMilestones).length > 0 ? (
//                     <div className="space-y-4">
//                       {Object.entries(groupedMilestones).map(([header, milestones]: any, idx) => (
//                         <div key={idx} className="border rounded-md overflow-hidden bg-white shadow-sm">
//                           <div className="bg-gray-100 px-3 py-2 flex justify-between items-center border-b">
//                             <span className="text-xs font-bold text-gray-700">{header}</span>
//                             <Badge variant="secondary" className="text-[10px]">{milestones.length}</Badge>
//                           </div>
//                           <div className="divide-y divide-gray-100">
//                             {milestones.map((m: any, mIdx: number) => (
//                               <div key={mIdx} className="p-3 text-xs">
//                                 <div className="flex justify-between items-start mb-1">
//                                   <span className="font-medium text-gray-800 w-2/3 break-words">{m.work_milestone_name}</span>
//                                   <Badge variant="outline" className={`text-[10px] font-normal ${getStatusBadgeClasses(m.status)}`}>
//                                     {m.status}
//                                   </Badge>
//                                 </div>
//                                 <div className="flex justify-between text-gray-500 mt-2">
//                                   <span>Progress: <span className="text-gray-900 font-semibold">{m.progress}%</span></span>
//                                   {m.status === 'WIP' && m.expected_completion_date && (
//                                     <span>End: {formatDate(m.expected_completion_date)}</span>
//                                   )}
//                                   {m.status === 'Not Started' && m.expected_starting_date && (
//                                     <span>Start: {formatDate(m.expected_starting_date)}</span>
//                                   )}
//                                 </div>
//                                 {m.remarks && (
//                                   <p className="mt-2 p-1.5 bg-yellow-50 border border-yellow-100 text-yellow-800 rounded text-[10px]">
//                                     {m.remarks}
//                                   </p>
//                                 )}
//                               </div>
//                             ))}
//                           </div>
//                         </div>
//                       ))}
//                     </div>
//                   ) : (
//                     <p className="text-xs text-gray-500 italic text-center py-4 bg-white rounded border border-dashed">
//                       No milestones found.
//                     </p>
//                   )}
//                 </div>

//               </div>
//             ) : (
//               <div className="flex h-full items-center justify-center text-red-500 text-sm">
//                 Could not load yesterday's report details.
//               </div>
//             )}
//           </div>

//           {/* Footer Area */}
//           <DialogFooter className="px-6 py-4 border-t bg-gray-50 sm:justify-end flex-shrink-0">
//             <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCopying}>
//               Cancel
//             </Button>
//             <Button 
//               onClick={handleConfirmCopy} 
//               disabled={isCopying || !fullYesterdayReport} 
//               className="bg-blue-600 hover:bg-blue-700 text-white"
//             >
//               {isCopying ? (
//                 <>
//                   <Loader2 className="mr-2 h-4 w-4 animate-spin" />
//                   Copying...
//                 </>
//               ) : (
//                 "Confirm Copy"
//               )}
//             </Button>
//           </DialogFooter>

//         </DialogContent>
//       </Dialog>
//     </>
//   );
// };


import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose // Imported for the camera dialog close button
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea"; // For photo remarks
import { toast } from "@/components/ui/use-toast";
import { Copy, Loader2, AlertCircle, Users, ListTodo, X, Camera } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";

// --- NEW IMPORTS FOR CAMERA FEATURE ---
import CameraCapture from "@/components/CameraCapture";
import PhotoPermissionChecker from "./PhotoPermissionChecker"; // Adjust path if needed
import { useFrappeGetDoc as useFrappeGetDocForMap } from "frappe-react-sdk"; // Aliased to avoid conflict if needed
import { useWorkHeaderOrder } from "@/hooks/useWorkHeaderOrder";


// --- Interface for Photos ---
interface ProjectProgressAttachment {
  local_id: string;
  image_link: string;
  location: string | null;
  remarks: string;
}

// --- Helper Functions & Styles ---
const formatDateForInput = (date: Date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getStatusBadgeClasses = (status: string) => {
  switch (status) {
    case "Completed": return "bg-green-100 text-green-800 border-green-200";
    case "WIP": return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "Not Started": return "bg-red-100 text-red-800 border-red-200";
    case "Not Applicable": 
    case "N/A": return "bg-gray-100 text-gray-800 border-gray-200";
    default: return "bg-blue-100 text-blue-800 border-blue-200";
  }
};

export const CopyReportButton = ({ selectedProject, selectedZone, dailyReportDetailsDisable }: { selectedProject: string, selectedZone: string, dailyReportDetailsDisable: boolean }) => {
  const navigate = useNavigate();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  // --- 1. NEW STATE FOR CAMERA ---
  const [isCaptureDialogOpen, setIsCaptureDialogOpen] = useState(false);
  const [localPhotos, setLocalPhotos] = useState<ProjectProgressAttachment[]>([]);

  // Fetch Map API Key (Needed for PhotoPermissionChecker/CameraCapture)
  const { data: apiData } = useFrappeGetDocForMap("Map API", { fields: ["*"] });

  // Date Logic
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const todayStr = formatDateForInput(today);
  const yesterdayStr = formatDateForInput(yesterday);

  const { createDoc } = useFrappeCreateDoc();

  // Checks for existing reports (Logic remains same)
  const { data: todayReportList } = useFrappeGetDocList("Project Progress Reports", {
    fields: ["name"],
    filters: [
      ["project", "=", selectedProject],
      ["report_zone", "=", selectedZone],
      ["report_date", "=", todayStr]
    ],
    limit: 1
  }, selectedProject && selectedZone ? undefined : null);

  const { data: yesterdayReportList } = useFrappeGetDocList("Project Progress Reports", {
    fields: ["name", "report_status"],
    filters: [
      ["project", "=", selectedProject],
      ["report_zone", "=", selectedZone],
      ["report_date", "=", yesterdayStr],
      ["report_status", "=", "Completed"]
    ],
    limit: 1
  }, selectedProject && selectedZone ? undefined : null);

  const yesterdayReportName = yesterdayReportList?.[0]?.name;
  const hasTodayReport = todayReportList && todayReportList.length > 0;
  const canCopy = !hasTodayReport && !!yesterdayReportName;

  const { workHeaderOrderMap } = useWorkHeaderOrder();

  const { data: fullYesterdayReport, isLoading: isLoadingReport } = useFrappeGetDoc(
    "Project Progress Reports",
    yesterdayReportName,
    yesterdayReportName && isDialogOpen ? undefined : null
  );

  const groupedMilestones = useMemo(() => {
    if (!fullYesterdayReport?.milestones) return {};
    const groups = fullYesterdayReport.milestones.reduce((acc: any, milestone: any) => {
        const header = milestone.work_header || "Other";
        (acc[header] = acc[header] || []).push(milestone);
        return acc;
      }, {});
    
    // Sort keys based on workHeaderOrderMap, then alphabetically as fallback
    return Object.keys(groups).sort((a, b) => {
        const orderA = workHeaderOrderMap[a] ?? 9999;
        const orderB = workHeaderOrderMap[b] ?? 9999;
        if (orderA !== orderB) return orderA - orderB;
        return a.localeCompare(b);
    }).reduce((obj: any, key) => {
      obj[key] = groups[key];
      return obj;
    }, {});
  }, [fullYesterdayReport, workHeaderOrderMap]);

  // --- 2. CAMERA HANDLERS ---
  const handlePhotoCaptureSuccess = (photoData: ProjectProgressAttachment) => {
    setLocalPhotos((prev) => [...prev, photoData]);
    setIsCaptureDialogOpen(false);
    toast({
        title: "Photo Added",
        description: "New photo ready for today's report.",
        variant: "default",
    });
  };

  const handleRemovePhoto = (local_id: string) => {
    setLocalPhotos((prev) => prev.filter((p) => p.local_id !== local_id));
  };

  const handlePhotoRemarksChange = (local_id: string, remarks: string) => {
    setLocalPhotos((prev) => prev.map(p => p.local_id === local_id ? { ...p, remarks } : p));
  };

  const handleConfirmCopy = async () => {
    if (!fullYesterdayReport) return;
    setIsCopying(true);

    try {
      const milestonesPayload = fullYesterdayReport.milestones?.map((m: any) => ({
        work_milestone_name: m.work_milestone_name,
        work_header: m.work_header,
        status: m.status,
        progress: m.progress,
        expected_starting_date: m.expected_starting_date,
        expected_completion_date: m.expected_completion_date,
        remarks: m.remarks,
        work_plan: m.work_plan,
        work_plan_ratio: m.work_plan_ratio
      })) || [];

      const manpowerPayload = fullYesterdayReport.manpower?.map((m: any) => ({
        label: m.label,
        count: m.count
      })) || [];

      // --- 3. INCLUDE PHOTOS IN PAYLOAD ---
      // Map local photos to the structure Frappe expects (removing local_id)
      if (localPhotos.length < 3) {
      toast({
        title: "Photos Required 📷",
        description: `You have added ${localPhotos.length} photos. Please add at least 3 photos to proceed.`,
        variant: "destructive",
      });
      return; // Stop execution here
    }
      const attachmentsPayload = localPhotos.map(p => ({
        image_link: p.image_link,
        location: p.location,
        remarks: p.remarks
      }));

      const payload = {
        project: selectedProject,
        report_zone: selectedZone,
        report_date: todayStr, 
        report_status: 'Completed', // Keep as Draft to allow editing
        manpower_remarks: fullYesterdayReport.manpower_remarks,
        milestones: milestonesPayload,
        manpower: manpowerPayload,
        attachments: attachmentsPayload // Attach the new photos
      };

      await createDoc("Project Progress Reports", payload);

      toast({
        title: "Success",
        description: "Report copied with new photos created successfully.",
        variant: "default", 
      });

      setIsDialogOpen(false);
      setLocalPhotos([]); // Reset photos
      navigate(`${selectedProject}?zone=${selectedZone}`);

    } catch (error: any) {
      console.error("Copy Error", error);
      toast({
        title: "Error",
        description: error.message || "Failed to copy report.",
        variant: "destructive"
      });
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        className="text-sm w-full  border-blue-600 text-blue-600 hover:bg-blue-50 gap-2"
        disabled={!canCopy || dailyReportDetailsDisable}
        onClick={() => setIsDialogOpen(true)}
      >
        <Copy className="w-4 h-4" />
        Copy Yesterday's Report
      </Button>

      {/* MAIN COPY PREVIEW DIALOG */}
      <Dialog open={isDialogOpen} onOpenChange={(val) => {
          setIsDialogOpen(val);
          if(!val) setLocalPhotos([]); // Clear photos if cancelled
      }}>
        <DialogContent className="sm:max-w-2xl w-[95vw] max-h-[85vh] flex flex-col p-0 gap-0 bg-white overflow-hidden">
          
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-blue-600">
              <Copy className="w-5 h-5" /> Copy Report Preview
            </DialogTitle>
            <DialogDescription className="mt-1.5">
              Review yesterday's data. <strong>You can add new photos for today below.</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto bg-white relative">
            {isLoadingReport ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : fullYesterdayReport ? (
              <div className="px-6 py-4 space-y-6">
                
                <div className="bg-yellow-50 p-3 rounded-md border border-yellow-200 text-xs text-yellow-800 flex gap-2 items-start">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    Creating a <strong>Report</strong> for <strong>{formatDate(today)}</strong>. 
                    Milestone/Manpower data is copied. Old photos are removed. 
                  </span>
                </div>

                {/* --- 4. NEW PHOTOS SECTION --- */}
                <div>
                    <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-3">
                      <Camera className="w-4 h-4" /> Work Images (For Today)
                    </h3>
                    
                    {/* Permission Checker & Add Button */}
                    <div className="mb-4">
                        <PhotoPermissionChecker
                            isBlockedByDraftOwnership={false} // Always allow in this context
                            onAddPhotosClick={() => setIsCaptureDialogOpen(true)}
                            GEO_API={apiData?.api_key}
                        />
                    </div>

                    {/* Photo Grid Preview */}
                    {localPhotos.length > 0 ? (
                         <div className="space-y-4">
                         {localPhotos.map((photo) => (
                           <div 
                             key={photo.local_id} 
                             className="flex flex-col sm:flex-row sm:items-center gap-3 p-2 bg-gray-50 rounded-md border border-gray-200"
                           >
                             <div className="relative flex-shrink-0 w-full h-[140px] sm:w-[120px] sm:h-[100px] rounded-md overflow-hidden border border-gray-300">
                               <img
                                 src={photo.image_link}
                                 alt="New Capture"
                                 className="w-full h-full object-cover"
                               />
                               <Button
                                 variant="destructive"
                                 size="icon"
                                 className="absolute top-1 right-1 h-6 w-6 rounded-full"
                                 onClick={() => handleRemovePhoto(photo.local_id)}
                               >
                                 <X className="h-3 w-3" />
                               </Button>
                             </div>
           
                             <div className="flex-grow w-full">
                               <Textarea
                                 value={photo.remarks || ''}
                                 onChange={(e) => handlePhotoRemarksChange(photo.local_id, e.target.value)}
                                 placeholder="Add remarks for this photo..."
                                 className="min-h-[80px] text-xs bg-white resize-none"
                               />
                             </div>
                           </div>
                         ))}
                       </div>
                    ) : (
                        <div className="text-center py-6 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
                            <p className="text-xs text-gray-500">No photos added for today yet.</p>
                        </div>
                    )}
                </div>

                <Separator />

                {/* Manpower Section (Read Only Preview) */}
                <div>
                  <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-3">
                    <Users className="w-4 h-4" /> Manpower (Copied)
                  </h3>
                  <div className="bg-white rounded-md p-3 border border-gray-200 shadow-sm">
                    {fullYesterdayReport.manpower && fullYesterdayReport.manpower.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {fullYesterdayReport.manpower.map((mp: any, idx: number) => (
                          <div key={idx} className="flex justify-between text-xs p-2 rounded border bg-gray-50">
                            <span className="text-gray-600">{mp.label}</span>
                            <span className="font-bold text-gray-900">{mp.count}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 italic">No manpower data recorded.</p>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Milestones Section (Read Only Preview) */}
                <div>
                  <div className="flex justify-between items-center mb-3 sticky top-0 bg-white z-10 py-2">
                    <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                        <ListTodo className="w-4 h-4" /> Work Milestones (Copied)
                    </h3>
                    <Badge variant="outline" className="text-xs">
                        {fullYesterdayReport.milestones?.length || 0} Total
                    </Badge>
                  </div>
                  
                  {Object.keys(groupedMilestones).length > 0 ? (
                    <div className="space-y-4">
                      {Object.entries(groupedMilestones).map(([header, milestones]: any, idx) => (
                        <div key={idx} className="border rounded-md overflow-hidden bg-white shadow-sm">
                          <div className="bg-gray-100 px-3 py-2 flex justify-between items-center border-b">
                            <span className="text-xs font-bold text-gray-700">{header}</span>
                            <Badge variant="secondary" className="text-[10px]">{milestones.length}</Badge>
                          </div>
                          <div className="divide-y divide-gray-100">
                            {milestones.map((m: any, mIdx: number) => (
                              <div key={mIdx} className="p-3 text-xs">
                                <div className="flex justify-between items-start mb-1">
                                  <span className="font-medium text-gray-800 w-2/3 break-words">{m.work_milestone_name}</span>
                                  <Badge variant="outline" className={`text-[10px] font-normal ${getStatusBadgeClasses(m.status)}`}>
                                    {m.status}
                                  </Badge>
                                </div>
                                <div className="flex justify-between text-gray-500 mt-2">
                                  <span>Progress: <span className="text-gray-900 font-semibold">{m.progress}%</span></span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 italic text-center py-4 bg-white rounded border border-dashed">
                      No milestones found.
                    </p>
                  )}
                </div>

              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-red-500 text-sm">
                Could not load yesterday's report details.
              </div>
            )}
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-gray-50 sm:justify-end flex-shrink-0">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCopying}>
              Cancel
            </Button>
            <Button 
              onClick={handleConfirmCopy} 
              disabled={isCopying || !fullYesterdayReport} 
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isCopying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Confirm & Create Report"
              )}
            </Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>

      {/* --- 5. CAMERA CAPTURE DIALOG (Rendered outside the main dialog to overlay) --- */}
      <Dialog open={isCaptureDialogOpen} onOpenChange={setIsCaptureDialogOpen}>
        <DialogContent className="max-w-[70vh] w-[90vw] p-0 border-none bg-transparent">
             <DialogClose className="absolute right-4 top-4 h-8 w-8 rounded-full flex items-center justify-center bg-white/10 text-white transition-colors duration-200 hover:bg-white/20 z-30">
                <X className="h-5 w-5" />
                <span className="sr-only">Close</span>
            </DialogClose>

            <DialogHeader className="sr-only">
                <DialogTitle>Capture Photo</DialogTitle>
            </DialogHeader>
            
            <CameraCapture
                project_id={selectedProject}
                report_date={formatDate(today)}
                onCaptureSuccess={handlePhotoCaptureSuccess}
                onCancel={() => setIsCaptureDialogOpen(false)}
                GEO_API={apiData?.api_key}
                disabled={false}
            />
        </DialogContent>
      </Dialog>

    </>
  );
};