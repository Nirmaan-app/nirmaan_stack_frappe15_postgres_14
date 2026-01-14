import { useState, useMemo, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { UserContext } from "@/utils/auth/UserProvider";
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
import { Copy, Loader2, AlertCircle, Users, ListTodo, X, Camera, AlertTriangle, Pencil, Plus } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";

// --- NEW IMPORTS FOR CAMERA FEATURE ---
import CameraCapture from "@/components/CameraCapture";
import PhotoPermissionChecker from "./PhotoPermissionChecker"; // Adjust path if needed
import { useFrappeGetDoc as useFrappeGetDocForMap } from "frappe-react-sdk"; // Aliased to avoid conflict if needed
import { useWorkHeaderOrder } from "@/hooks/useWorkHeaderOrder";

// --- NEW INTERFACES ---
interface ProjectWorkHeaderChildEntry {
  name: string;
  idx: number;
  project_work_header_name: string;
  enabled: string;
}

interface ProjectData {
  project_name: string;
  enable_project_milestone_tracking: 0 | 1;
  project_work_header_entries?: ProjectWorkHeaderChildEntry[];
}

interface WorkMilestoneFromFrappe {
  name: string;
  work_milestone_name: string;
  work_header: string;
  status: string;
}

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
  console.log(status);
  switch (status) {
    case "Completed": return "bg-green-100 text-green-800 border-green-200";
    case "WIP": return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "Not Started": return "bg-red-100 text-red-800 border-red-200";
    case "Not Applicable": 
    case "N/A": return "bg-gray-100 text-gray-800 border-gray-200";
    default: return "bg-blue-100 text-blue-800 border-blue-200";
  }
};

export const CopyReportButton = ({ selectedProject, selectedZone,dailyReportDetailsDisable,GEO_API }: { selectedProject: string, selectedZone: string,dailyReportDetailsDisable:boolean,GEO_API: string | undefined }) => {
  const navigate = useNavigate();
  const { currentUser: user } = useContext(UserContext);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  // --- 1. STATE FOR CAMERA ---
  const [isCaptureDialogOpen, setIsCaptureDialogOpen] = useState(false);
  const [localPhotos, setLocalPhotos] = useState<ProjectProgressAttachment[]>([]);

  // --- 2. STATE FOR MILESTONE CHECK ---
  const [isNewMilestonesWarningOpen, setIsNewMilestonesWarningOpen] = useState(false);
  const [newMilestoneCount, setNewMilestoneCount] = useState(0);

  // --- 3. NEW EDITABLE STATES ---
  const [editableMilestones, setEditableMilestones] = useState<any[]>([]);
  const [editableManpower, setEditableManpower] = useState<any[]>([]);
  
  // Manpower remarks as single string
  const [editableManpowerRemarks, setEditableManpowerRemarks] = useState("");
  
  // Drawing/Site remarks as arrays of points (split by $#,,,)
  const [drawingRemarkPoints, setDrawingRemarkPoints] = useState<string[]>([]);
  const [siteRemarkPoints, setSiteRemarkPoints] = useState<string[]>([]);
  
  // New point input fields (for drawing/site only)
  const [newDrawingRemark, setNewDrawingRemark] = useState("");
  const [newSiteRemark, setNewSiteRemark] = useState("");
  
  // Edit mode toggles (for drawing/site only)
  const [editingDrawingRemarks, setEditingDrawingRemarks] = useState(false);
  const [editingSiteRemarks, setEditingSiteRemarks] = useState(false);
  
  const [hasChanges, setHasChanges] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  // Delimiter for remarks
  const REMARKS_DELIMITER = "$#,,,";

  // Fetch Map API Key (Needed for PhotoPermissionChecker/CameraCapture)
  const { data: apiData } = useFrappeGetDocForMap("Map API", { fields: ["*"] });

  // --- 3. FETCH PROJECT DATA ---
  const { data: projectData, isLoading: projectDataLoading } = useFrappeGetDoc<ProjectData>(
    "Projects",
    selectedProject,
    selectedProject ? undefined : null
  );

  // --- 4. FETCH ALL WORK MILESTONES ---
  const { data: allWorkMilestones, isLoading: milestonesLoading } = useFrappeGetDocList<WorkMilestoneFromFrappe>(
    "Work Milestones",
    {
      fields: ["name", "work_milestone_name", "work_header"],
      limit: 0
    }
    // Always fetch - no conditional fetching needed since this is master data
  );

  // Date Logic
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const todayStr = formatDateForInput(today);
  const yesterdayStr = formatDateForInput(yesterday);

  const { createDoc } = useFrappeCreateDoc();
  const { updateDoc } = useFrappeUpdateDoc();

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
    yesterdayReportName ? undefined : null  // ← FIXED: Fetch as soon as report name is available (not waiting for dialog)
  );

  // --- 5. CALCULATE TODAY'S APPLICABLE MILESTONES ---
  const todaysApplicableMilestones = useMemo(() => {
    if (!projectData || !allWorkMilestones) {
      return [];
    }

    // Get enabled work headers
    const enabledHeaders = projectData.enable_project_milestone_tracking === 1 && projectData.project_work_header_entries
      ? projectData.project_work_header_entries
          .filter(entry => entry.enabled === "True")
          .map(entry => entry.project_work_header_name)
      : [];

    // Filter milestones by enabled headers
    return allWorkMilestones.filter(milestone =>
      enabledHeaders.includes(milestone.work_header)
    );
  }, [projectData, allWorkMilestones]);

  // --- 6. CHECK IF NEW MILESTONES WERE ADDED ---
  useEffect(() => {
    if (fullYesterdayReport?.milestones && todaysApplicableMilestones.length > 0) {
      const yesterdayCount = fullYesterdayReport.milestones.length;
      const todayCount = todaysApplicableMilestones.length;

      if (todayCount > yesterdayCount) {
        const diff = todayCount - yesterdayCount;
        setNewMilestoneCount(diff);
      } else {
        setNewMilestoneCount(0);
      }
    }
  }, [fullYesterdayReport, todaysApplicableMilestones]);

  // --- 7. INITIALIZE EDITABLE DATA WHEN DIALOG OPENS ---
  useEffect(() => {
    if (isDialogOpen && fullYesterdayReport) {
      // Initialize editable milestones from yesterday's report
      setEditableMilestones(
        fullYesterdayReport.milestones?.map((m: any) => ({
          work_milestone_name: m.work_milestone_name,
          work_header: m.work_header,
          status: m.status,
          progress: m.progress,
          expected_starting_date: m.expected_starting_date,
          expected_completion_date: m.expected_completion_date,
          remarks: m.remarks || "",
          // Deserialize work_plan array for point-based editing
          work_plan_points: m.work_plan ? m.work_plan.split(REMARKS_DELIMITER).filter((p:string) => p.trim() !== '') : [],
          work_plan_ratio: m.work_plan_ratio,
          // UI state for editing
          is_editing_work_plan: false,
          new_work_plan_input: "" 
        })) || []
      );

      // Initialize editable manpower from yesterday's report
      setEditableManpower(
        fullYesterdayReport.manpower?.map((m: any) => ({
          label: m.label,
          count: m.count,
        })) || []
      );

      // Initialize remarks
      setEditableManpowerRemarks(fullYesterdayReport.manpower_remarks || "");
      
      const parseRemarks = (remarkStr: string | null | undefined): string[] => {
        if (!remarkStr || remarkStr.trim() === '') return [];
        return remarkStr.split(REMARKS_DELIMITER).filter(r => r.trim() !== '');
      };
      
      setDrawingRemarkPoints(parseRemarks(fullYesterdayReport.drawing_remarks));
      setSiteRemarkPoints(parseRemarks(fullYesterdayReport.site_remarks));

      // Reset new remark inputs
      setNewDrawingRemark("");
      setNewSiteRemark("");
      
      // Reset edit modes
      setEditingDrawingRemarks(false);
      setEditingSiteRemarks(false);

      // Reset changes tracking
      setHasChanges(false);
      setLocalPhotos([]);
    }
  }, [isDialogOpen, fullYesterdayReport, REMARKS_DELIMITER]);

  // Group editable milestones for display
  const groupedMilestones = useMemo(() => {
    if (!editableMilestones || editableMilestones.length === 0) return {};
    const groups = editableMilestones.reduce((acc: any, milestone: any) => {
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
  }, [editableMilestones, workHeaderOrderMap]);

  // --- 8. BUTTON CLICK HANDLER WITH MILESTONE CHECK ---
  const handleCopyButtonClick = () => {
    if (newMilestoneCount > 0) {
      // Show warning dialog for new milestones
      setIsNewMilestonesWarningOpen(true);
    } else {
      // Proceed with copy dialog
      setIsDialogOpen(true);
    }
  };

  // --- 9. HANDLER TO CREATE NEW REPORT ---
  const handleCreateNewReport = () => {
    setIsNewMilestonesWarningOpen(false);
    // Navigate to MilestoneTab to start new report creation
    navigate(`/prs&milestones/milestone-report/${selectedProject}?zone=${selectedZone}`);
  };

  // --- 10. CAMERA HANDLERS ---
  const handlePhotoCaptureSuccess = (photoData: ProjectProgressAttachment) => {
    setLocalPhotos((prev) => [...prev, photoData]);
    setIsCaptureDialogOpen(false);
    setHasChanges(true); // Mark as changed
    toast({
        title: "Photo Added",
        description: "New photo ready for today's report.",
        variant: "default",
    });
  };

  const handleRemovePhoto = (local_id: string) => {
    setLocalPhotos((prev) => prev.filter((p) => p.local_id !== local_id));
    setHasChanges(true);
  };

  const handlePhotoRemarksChange = (local_id: string, remarks: string) => {
    setLocalPhotos((prev) => prev.map(p => p.local_id === local_id ? { ...p, remarks } : p));
    setHasChanges(true);
  };

  // --- 11. MILESTONE EDIT HANDLERS ---
  
  // Work Plan Point Handlers
  const handleToggleWorkPlanEdit = (milestoneName: string) => {
    setEditableMilestones(prev => prev.map(m => 
      m.work_milestone_name === milestoneName 
        ? { ...m, is_editing_work_plan: !m.is_editing_work_plan } 
        : m
    ));
  };

  const handleWorkPlanInputChange = (milestoneName: string, value: string) => {
    setEditableMilestones(prev => prev.map(m => 
        m.work_milestone_name === milestoneName 
          ? { ...m, new_work_plan_input: value } 
          : m
    ));
  };

  const handleAddWorkPlanPoint = (milestoneName: string) => {
    setEditableMilestones(prev => prev.map(m => {
      if (m.work_milestone_name === milestoneName && m.new_work_plan_input.trim()) {
        return { 
          ...m, 
          work_plan_points: [...(m.work_plan_points || []), m.new_work_plan_input.trim()], 
          new_work_plan_input: "" 
        };
      }
      return m;
    }));
    setHasChanges(true);
  };

  const handleEditWorkPlanPoint = (milestoneName: string, index: number, value: string) => {
    setEditableMilestones(prev => prev.map(m => {
        if (m.work_milestone_name === milestoneName) {
            const newPoints = [...(m.work_plan_points || [])];
            newPoints[index] = value;
            return { ...m, work_plan_points: newPoints };
        }
        return m;
    }));
    setHasChanges(true);
  };

  const handleRemoveWorkPlanPoint = (milestoneName: string, index: number) => {
    setEditableMilestones(prev => prev.map(m => {
        if (m.work_milestone_name === milestoneName) {
            return { ...m, work_plan_points: (m.work_plan_points || []).filter((_:any, i:number) => i !== index) };
        }
        return m;
    }));
    setHasChanges(true);
  };

  const handleMilestoneChange = (milestoneName: string, field: string, value: any) => {
    setEditableMilestones((prev) =>
      prev.map((m) => {
        if (m.work_milestone_name !== milestoneName) return m;
        
        // Handle status changes with proper logic
        if (field === 'status') {
          const newStatus = value;
          let updatedMilestone = { ...m, status: newStatus };
          
          if (newStatus === 'Completed') {
            updatedMilestone.progress = 100;
            // Clear work plan points if needed, or keep for record? keeping for now
             updatedMilestone.work_plan_points = []; 
             updatedMilestone.work_plan_ratio = "Plan Not Required";
          } else if (newStatus === 'Not Started') {
            updatedMilestone.progress = 0;
          } else if (newStatus === 'Not Applicable') {
            updatedMilestone.progress = 0;
            updatedMilestone.expected_starting_date = undefined;
            updatedMilestone.expected_completion_date = undefined;
             updatedMilestone.work_plan_points = [];
             updatedMilestone.work_plan_ratio = "Plan Not Required";
          }
          // WIP keeps current progress and allows editing
          
          return updatedMilestone;
        }
        
        // Handle progress changes
        if (field === 'progress') {
          const newProgress = parseInt(value) || 0;
          let updatedMilestone = { ...m, progress: newProgress };
          
          // If progress is 100, auto-set status to Completed
          if (newProgress >= 100) {
            updatedMilestone.status = 'Completed';
            updatedMilestone.progress = 100;
          }
          // If progress > 0 and status is Not Started, switch to WIP
          else if (newProgress > 0 && m.status === 'Not Started') {
            updatedMilestone.status = 'WIP';
          }
          
          return updatedMilestone;
        }
        
        // Default: just update the field
        return { ...m, [field]: value };
      })
    );
    setHasChanges(true);
  };

  // --- 12. MANPOWER EDIT HANDLERS ---
  const handleManpowerChange = (label: string, count: number) => {
    setEditableManpower((prev) =>
      prev.map((m) => (m.label === label ? { ...m, count } : m))
    );
    setHasChanges(true);
  };

  // --- 13. REMARKS HANDLERS ---
  
  // Simple handler for Manpower Remarks (Single String)
  const handleManpowerRemarksChange = (value: string) => {
    setEditableManpowerRemarks(value);
    setHasChanges(true);
  };

  // Serialize arrays back to strings for Drawing/Site
  const serializeRemarks = (points: string[]): string => {
    return points.filter(p => p.trim() !== '').join(REMARKS_DELIMITER);
  };
  
  // --- Drawing/Site Point Handlers (Keep these) ---

  const handleAddDrawingRemark = () => {
    if (newDrawingRemark.trim()) {
      setDrawingRemarkPoints(prev => [...prev, newDrawingRemark.trim()]);
      setNewDrawingRemark("");
      setHasChanges(true);
    }
  };

  const handleAddSiteRemark = () => {
    if (newSiteRemark.trim()) {
      setSiteRemarkPoints(prev => [...prev, newSiteRemark.trim()]);
      setNewSiteRemark("");
      setHasChanges(true);
    }
  };

  const handleEditDrawingRemark = (index: number, value: string) => {
    setDrawingRemarkPoints(prev => prev.map((p, i) => i === index ? value : p));
    setHasChanges(true);
  };

  const handleEditSiteRemark = (index: number, value: string) => {
    setSiteRemarkPoints(prev => prev.map((p, i) => i === index ? value : p));
    setHasChanges(true);
  };

  const handleRemoveSiteRemark = (index: number) => {
    setSiteRemarkPoints(prev => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  // --- 14. SAVE AS DRAFT ---
  const handleSaveDraft = async () => {
    if (!hasChanges && localPhotos.length === 0) {
      // No changes to save
      setIsDialogOpen(false);
      return;
    }

    setIsSavingDraft(true);
    try {
      const attachmentsPayload = localPhotos.map(p => ({
        image_link: p.image_link,
        location: p.location,
        remarks: p.remarks
      }));

      const serializeMilestones = (milestones: any[]) => {
        return milestones.map(m => ({
          ...m,
          // Serialize work_plan array back to delimiter format
          work_plan: (m.work_plan_points && m.work_plan_points.length > 0) 
            ? m.work_plan_points.join(REMARKS_DELIMITER) 
            : ""
        }));
      };


      const payload = {
        project: selectedProject,
        report_zone: selectedZone,
        report_date: todayStr,
        report_status: 'Draft',
        draft_owner: user || null, // Use user from context
        manpower_remarks: editableManpowerRemarks,
        milestones: serializeMilestones(editableMilestones),
        manpower: editableManpower,
        attachments: attachmentsPayload,
        drawing_remarks: serializeRemarks(drawingRemarkPoints),
        site_remarks: serializeRemarks(siteRemarkPoints),
      };

      // CHECK IF REPORT ALREADY EXISTS FOR TODAY
      const existingReportId = todayReportList?.[0]?.name;

      if (existingReportId) {
          // UPDATE Existing Report
          await updateDoc("Project Progress Reports", existingReportId, payload);
          toast({
            title: "Draft Updated 💾",
            description: "Existing draft for today has been updated.",
            variant: "default",
          });
      } else {
          // CREATE New Report
          await createDoc("Project Progress Reports", payload);
          toast({
            title: "Draft Saved 💾",
            description: "Report copied and saved as draft. You can continue editing.",
            variant: "default",
          });
      }

      setIsSavingDraft(false); // Stop loading, keep dialog open
      // setIsDialogOpen(false); // Do not close dialog

    } catch (error: any) {
      console.error("Error saving draft:", error);
      toast({
        title: "Error Saving Draft ❌",
        description: error.message || "Failed to save draft. Please try again.",
        variant: "destructive",
      });
      setIsSavingDraft(false);
    }
  };

  // --- 15. DIALOG CLOSE HANDLER ---
  const handleDialogClose = async (open: boolean) => {
    if (!open && hasChanges) {
      // Auto-save as draft when closing with unsaved changes
      await handleSaveDraft();
    } else if (!open) {
      // No changes, just close
      setIsDialogOpen(false);
      setLocalPhotos([]);
    } else {
      setIsDialogOpen(open);
    }
  };

  // --- 16. SUBMIT FINAL REPORT ---
  const handleConfirmCopy = async () => {
    if (editableMilestones.length === 0) return;
    setIsCopying(true);

    try {
      // Validate photos
      if (localPhotos.length < 3) {
        toast({
          title: "Photos Required 📷",
          description: `You have added ${localPhotos.length} photos. Please add at least 3 photos to proceed.`,
          variant: "destructive",
        });
        setIsCopying(false);
        return;
      }

      const attachmentsPayload = localPhotos.map(p => ({
        image_link: p.image_link,
        location: p.location,
        remarks: p.remarks
      }));

      const serializeMilestones = (milestones: any[]) => {
        return milestones.map(m => ({
          ...m,
          // Serialize work_plan array back to delimiter format
          work_plan: (m.work_plan_points && m.work_plan_points.length > 0) 
            ? m.work_plan_points.join(REMARKS_DELIMITER) 
            : ""
        }));
      };

      const payload = {
        project: selectedProject,
        report_zone: selectedZone,
        report_date: todayStr,
        report_status: 'Completed', // Final submission
        draft_owner: user || null, // Use user from context
        manpower_remarks: editableManpowerRemarks,
        milestones: serializeMilestones(editableMilestones),
        manpower: editableManpower,
        attachments: attachmentsPayload,
        drawing_remarks: serializeRemarks(drawingRemarkPoints),
        site_remarks: serializeRemarks(siteRemarkPoints),
      };

      // CHECK IF REPORT ALREADY EXISTS FOR TODAY
      const existingReportId = todayReportList?.[0]?.name;

      if (existingReportId) {
           // UPDATE Existing Report
           await updateDoc("Project Progress Reports", existingReportId, payload);
           toast({
             title: "Report Updated ✅",
             description: "Existing report for today has been updated to Completed.",
             variant: "default",
           });
       } else {
           // CREATE New Report
           await createDoc("Project Progress Reports", payload);
           toast({
             title: "Report Copied ✅",
             description: "Report copied successfully for today.",
             variant: "default",
           });
       }

      setIsDialogOpen(false);
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
        disabled={!canCopy || dailyReportDetailsDisable || projectDataLoading || milestonesLoading || isLoadingReport}
        onClick={handleCopyButtonClick}
      >
        {(projectDataLoading || milestonesLoading || isLoadingReport) ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking...
          </>
        ) : (
          <>
            <Copy className="w-4 h-4" />
            Copy Yesterday's Report
          </>
        )}
      </Button>

      {/* --- NEW MILESTONES WARNING DIALOG --- */}
      <Dialog open={isNewMilestonesWarningOpen} onOpenChange={setIsNewMilestonesWarningOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <AlertTriangle className="w-5 h-5" />
              New Milestones Detected
            </DialogTitle>
            <DialogDescription className="pt-4">
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  <strong>{newMilestoneCount}</strong> new milestone{newMilestoneCount !== 1 ? 's have' : ' has'} been added to the project since yesterday's report.
                </p>
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <p className="text-xs text-yellow-800">
                    <strong>Note:</strong> Copy Yesterday's Report is not available when new milestones are added.
                    Please create a new report to include all current milestones.
                  </p>
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsNewMilestonesWarningOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateNewReport}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Create New Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MAIN COPY PREVIEW DIALOG */}
      <Dialog open={isDialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent className="sm:max-w-3xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0 bg-white overflow-hidden">
          
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-blue-600">
              <Copy className="w-5 h-5" /> Copy Yesterday's Report
              {hasChanges && <Badge variant="outline" className="ml-2 text-orange-600 border-orange-300">Unsaved Changes</Badge>}
            </DialogTitle>
            <DialogDescription className="mt-1.5">
              Edit the data below for today's report. Changes will be auto-saved as draft if you close this dialog.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto bg-white relative">
            {isLoadingReport ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : editableMilestones.length > 0 ? (
              <div className="px-6 py-4 space-y-6">
                
                <div className="bg-blue-50 p-3 rounded-md border border-blue-200 text-xs text-blue-800 flex gap-2 items-start">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    Creating report for <strong>{formatDate(today)}</strong>. 
                    All data is editable. Yesterday's photos are not copied.
                  </span>
                </div>

                {/* --- PHOTOS SECTION --- */}
                <div>
                    <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-3">
                      <Camera className="w-4 h-4" /> Work Images (Required: 3+)
                    </h3>
                    
                    <div className="mb-4">
                        <PhotoPermissionChecker
                            isBlockedByDraftOwnership={false}
                            onAddPhotosClick={() => setIsCaptureDialogOpen(true)}
                        />
                    </div>

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
                            <p className="text-xs text-gray-500">No photos added for today yet. Add at least 3 photos.</p>
                        </div>
                    )}
                </div>

                <Separator />

                {/* --- MANPOWER SECTION (EDITABLE) --- */}
                <div>
                  <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-3">
                    <Users className="w-4 h-4" /> Manpower (Editable)
                  </h3>
                  <div className="bg-white rounded-md p-3 border border-gray-200 shadow-sm">
                    {editableManpower.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {editableManpower.map((mp: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between text-xs p-2 rounded border bg-gray-50">
                            <span className="text-gray-600">{mp.label}</span>
                            <input
                              type="number"
                              value={mp.count}
                              onChange={(e) => handleManpowerChange(mp.label, parseInt(e.target.value) || 0)}
                              className="w-16 text-right font-bold text-gray-900 border rounded px-2 py-1"
                              min="0"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 italic">No manpower data recorded.</p>
                    )}
                    
                    {/* Manpower Remarks - Single String */}
                    <div className="mt-3 pt-3 border-t">
                      <label className="text-xs font-medium text-gray-600 block mb-1">Manpower Remarks</label>
                      <Textarea
                        value={editableManpowerRemarks}
                        onChange={(e) => handleManpowerRemarksChange(e.target.value)}
                        placeholder="Add manpower remarks..."
                        className="min-h-[60px] text-xs"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* --- CLIENT/CLEARANCE ISSUES SECTION --- */}
                <div>
                  <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-orange-600" /> Client / Clearance Issues
                  </h3>
                  <div className="space-y-4">
                    
                    {/* Drawing Remarks */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-gray-600">Drawing Remarks</label>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setEditingDrawingRemarks(!editingDrawingRemarks)}
                          className="h-6 px-2 text-xs text-orange-600"
                        >
                          <Pencil className="w-3 h-3 mr-1" /> {editingDrawingRemarks ? 'Done' : 'Edit'}
                        </Button>
                      </div>
                      
                      {drawingRemarkPoints.length > 0 ? (
                        <div className="space-y-2">
                          {drawingRemarkPoints.map((point, idx) => (
                            <div key={idx} className="flex items-start gap-2 p-2 bg-orange-50 rounded border border-orange-200">
                              <span className="text-orange-400 text-xs">•</span>
                              {editingDrawingRemarks ? (
                                <>
                                  <input
                                    type="text"
                                    value={point}
                                    onChange={(e) => handleEditDrawingRemark(idx, e.target.value)}
                                    className="flex-1 text-xs bg-white border rounded px-2 py-1"
                                  />
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-6 w-6 text-red-500"
                                    onClick={() => handleRemoveDrawingRemark(idx)}
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </>
                              ) : (
                                <span className="flex-1 text-xs text-gray-700">{point}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No drawing remarks.</p>
                      )}
                      
                      {editingDrawingRemarks && (
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="text"
                            value={newDrawingRemark}
                            onChange={(e) => setNewDrawingRemark(e.target.value)}
                            placeholder="Add drawing remark..."
                            className="flex-1 text-xs border rounded px-2 py-1"
                            onKeyDown={(e) => e.key === 'Enter' && handleAddDrawingRemark()}
                          />
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 px-2 text-xs"
                            onClick={handleAddDrawingRemark}
                          >
                            <Plus className="w-3 h-3 mr-1" /> Add
                          </Button>
                        </div>
                      )}
                    </div>
                    
                    {/* Site Remarks */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-gray-600">Site Remarks</label>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setEditingSiteRemarks(!editingSiteRemarks)}
                          className="h-6 px-2 text-xs text-red-600"
                        >
                          <Pencil className="w-3 h-3 mr-1" /> {editingSiteRemarks ? 'Done' : 'Edit'}
                        </Button>
                      </div>
                      
                      {siteRemarkPoints.length > 0 ? (
                        <div className="space-y-2">
                          {siteRemarkPoints.map((point, idx) => (
                            <div key={idx} className="flex items-start gap-2 p-2 bg-red-50 rounded border border-red-200">
                              <span className="text-red-400 text-xs">•</span>
                              {editingSiteRemarks ? (
                                <>
                                  <input
                                    type="text"
                                    value={point}
                                    onChange={(e) => handleEditSiteRemark(idx, e.target.value)}
                                    className="flex-1 text-xs bg-white border rounded px-2 py-1"
                                  />
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-6 w-6 text-red-500"
                                    onClick={() => handleRemoveSiteRemark(idx)}
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </>
                              ) : (
                                <span className="flex-1 text-xs text-gray-700">{point}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No site remarks.</p>
                      )}
                      
                      {editingSiteRemarks && (
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="text"
                            value={newSiteRemark}
                            onChange={(e) => setNewSiteRemark(e.target.value)}
                            placeholder="Add site remark..."
                            className="flex-1 text-xs border rounded px-2 py-1"
                            onKeyDown={(e) => e.key === 'Enter' && handleAddSiteRemark()}
                          />
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 px-2 text-xs"
                            onClick={handleAddSiteRemark}
                          >
                            <Plus className="w-3 h-3 mr-1" /> Add
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <Separator />

                {/* --- MILESTONES SECTION (EDITABLE STATUS/PROGRESS/REMARKS) --- */}
                <div>
                  <div className="flex justify-between items-center mb-3 sticky top-0 bg-white z-10 py-2">
                    <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                        <ListTodo className="w-4 h-4" /> Work Milestones (Editable)
                    </h3>
                    <Badge variant="outline" className="text-xs">
                        {editableMilestones.length} Total
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
                              <div key={mIdx} className="p-3 text-xs space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="font-medium text-gray-800 break-words flex-1 pr-2">{m.work_milestone_name}</span>
                                  <select
                                    value={m.status}
                                    onChange={(e) => handleMilestoneChange(m.work_milestone_name, 'status', e.target.value)}
                                    className={`text-[10px] px-2 py-1 rounded border ${getStatusBadgeClasses(m.status)}`}
                                  >
                                    <option value="Not Started">Not Started</option>
                                    <option value="WIP">WIP</option>
                                    <option value="Completed">Completed</option>
                                    <option value="Not Applicable">Not Applicable</option>
                                  </select>
                                </div>
                                
                                {/* Progress Bar - Only editable for WIP status */}
                                <div className="flex items-center gap-3">
                                  <span className="text-gray-500">Progress:</span>
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={m.progress}
                                    onChange={(e) => handleMilestoneChange(m.work_milestone_name, 'progress', parseInt(e.target.value))}
                                    className="flex-1"
                                    disabled={m.status === 'Completed' || m.status === 'Not Started' || m.status === 'Not Applicable'}
                                  />
                                  <span className="font-bold w-10 text-right">{m.progress}%</span>
                                </div>
                                
                                {/* Date Fields based on Status */}
                                {m.status === 'Not Started' && (
                                  <div className="flex items-center gap-2 bg-gray-50 p-2 rounded">
                                    <span className="text-gray-500">Expected Start:</span>
                                    <input
                                      type="date"
                                      value={m.expected_starting_date || ''}
                                      onChange={(e) => handleMilestoneChange(m.work_milestone_name, 'expected_starting_date', e.target.value)}
                                      className="text-xs border rounded px-2 py-1"
                                    />
                                  </div>
                                )}
                                
                                {m.status === 'WIP' && m.progress > 75 && (
                                  <div className="flex items-center gap-2 bg-blue-50 p-2 rounded border border-blue-200">
                                    <span className="text-blue-600">Expected Completion:</span>
                                    <input
                                      type="date"
                                      value={m.expected_completion_date || ''}
                                      onChange={(e) => handleMilestoneChange(m.work_milestone_name, 'expected_completion_date', e.target.value)}
                                      className="text-xs border rounded px-2 py-1"
                                    />
                                  </div>
                                )}
                                
                                <Textarea
                                  value={m.remarks || ''}
                                  onChange={(e) => handleMilestoneChange(m.work_milestone_name, 'remarks', e.target.value)}
                                  placeholder="Remarks..."
                                  className="min-h-[40px] text-[10px]"
                                />
                                
                                {/* Work Plan - Point Based */}
                                <div className="mt-2 pt-2 border-t border-gray-100">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] font-medium text-gray-500">Work Plan</span>
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      onClick={() => handleToggleWorkPlanEdit(m.work_milestone_name)}
                                      className="h-5 px-1.5 text-[10px] text-blue-600"
                                    >
                                      <Pencil className="w-2.5 h-2.5 mr-1" /> {m.is_editing_work_plan ? 'Done' : 'Edit'}
                                    </Button>
                                  </div>

                                  {/* List of Work Plan Points */}
                                  {m.work_plan_points && m.work_plan_points.length > 0 ? (
                                    <div className="space-y-1.5 mb-2">
                                      {m.work_plan_points.map((point: string, pIdx: number) => (
                                        <div key={pIdx} className="flex items-start gap-1.5 p-1.5 bg-blue-50/50 rounded border border-blue-100">
                                          <span className="text-blue-400 text-[10px] mt-0.5">•</span>
                                          {m.is_editing_work_plan ? (
                                            <>
                                              <input
                                                type="text"
                                                value={point}
                                                onChange={(e) => handleEditWorkPlanPoint(m.work_milestone_name, pIdx, e.target.value)}
                                                className="flex-1 text-[10px] bg-white border rounded px-1.5 py-0.5"
                                              />
                                              <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-5 w-5 text-red-500 hover:bg-red-50"
                                                onClick={() => handleRemoveWorkPlanPoint(m.work_milestone_name, pIdx)}
                                              >
                                                <X className="w-2.5 h-2.5" />
                                              </Button>
                                            </>
                                          ) : (
                                            <span className="flex-1 text-[10px] text-gray-700">{point}</span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    !m.is_editing_work_plan && (
                                        <p className="text-[10px] text-gray-400 italic pl-1">No work plan added.</p>
                                    )
                                  )}

                                  {/* Add New Point Input */}
                                  {m.is_editing_work_plan && (
                                    <div className="flex items-center gap-1.5 mt-1">
                                      <input
                                        type="text"
                                        value={m.new_work_plan_input || ""}
                                        onChange={(e) => handleWorkPlanInputChange(m.work_milestone_name, e.target.value)}
                                        placeholder="Add plan point..."
                                        className="flex-1 text-[10px] border rounded px-1.5 py-1"
                                        onKeyDown={(e) => e.key === 'Enter' && handleAddWorkPlanPoint(m.work_milestone_name)}
                                      />
                                      <Button 
                                        variant="outline" 
                                        size="sm" 
                                        className="h-6 px-2 text-[10px] border-blue-200 text-blue-600 hover:bg-blue-50"
                                        onClick={() => handleAddWorkPlanPoint(m.work_milestone_name)}
                                      >
                                        <Plus className="w-3 h-3 mr-0.5" /> Add
                                      </Button>
                                    </div>
                                  )}
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

          <DialogFooter className="px-6 py-4 border-t bg-gray-50 flex-shrink-0 gap-2">
            <Button 
              variant="outline" 
              onClick={() => handleDialogClose(false)} 
              disabled={isCopying || isSavingDraft}
            >
              Cancel
            </Button>
            <Button 
              variant="outline"
              onClick={handleSaveDraft} 
              disabled={isCopying || isSavingDraft || !hasChanges}
              className="border-orange-300 text-orange-600 hover:bg-orange-50"
            >
              {isSavingDraft ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save as Draft"
              )}
            </Button>
            <Button 
              onClick={handleConfirmCopy} 
              disabled={isCopying || isSavingDraft || editableMilestones.length === 0} 
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isCopying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Submit Report"
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