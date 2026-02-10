
// MilestoneTab.tsx
import { useContext, useEffect, useRef, useState } from "react";
import { useParams, useNavigate,useLocation } from "react-router-dom";
import { UserContext } from "@/utils/auth/UserProvider";
import {
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeCreateDoc,
  useFrappeUpdateDoc,
  useFrappeDeleteDoc, // ADD THIS
} from "frappe-react-sdk";
import { useWorkHeaderOrder } from "@/hooks/useWorkHeaderOrder";
import CameraCapture from "@/components/CameraCapture";
import { ImageBentoGrid } from "@/components/ui/ImageBentoGrid";
import {Camera, X, MapPin, CheckCircle, FileText } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarIcon, PlusCircledIcon } from "@radix-ui/react-icons";
import { TailSpin } from "react-loader-spinner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { formatDate,formatToLocalDateTimeString } from "@/utils/FormatDate";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogPrimitive
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Label } from "@/components/ui/label";
import PhotoPermissionChecker from "./components/PhotoPermissionChecker"
import {
  addWorkflowBreadcrumb,
  captureWorkflowError,
  isNetworkError,
  startWorkflowTransaction,
} from '@/utils/sentry';
import { ProgressReportErrorBoundary } from '@/components/error-boundaries/ProgressReportErrorBoundary';

// --- START: Refined Interfaces based on your Frappe DocType ---

interface ManpowerRole {
  id: string;
  label: string; // Used for frontend state and display
  count: number;
}

interface ProjectWorkHeaderChildEntry {
  name: string;
  idx: number;
  project_work_header_name: string;
  enabled: string;
}

interface ProjectProgressAttachment {
  name?: string; // Frappe document name for the row
  local_id: string; // Temporary ID for local state management (FRONTEND ONLY)
  image_link: string; // The uploaded file_url (MATCHES Frappe field)
  location: string | null; // The combined location string (MATCHES Frappe field)
  remarks: string; // General remarks for the photo (MATCHES Frappe field)
  attach_type?: 'Work' | 'Site' | 'Drawing'; // NEW FIELD
}

interface ProjectData {
  project_name: string;
  customer?: string;
  project_type?: string;
  project_value?: string;
  project_value_gst?: string;
  project_gst_number?: string;
  project_start_date?: string;
  project_end_date?: string;
  project_address?: string;
  project_city?: string;
  project_state?: string;
  project_employees_section?: any;
  project_lead?: string;
  procurement_lead?: string;
  design_lead?: string;
  project_manager?: string;
  estimates_exec?: string;
  accountant?: string;
  status?: string;
  project_scopes?: string;
  subdivisions?: string;
  subdivision_list?: string;
  project_wp_category_makes?: any[];
  enable_project_milestone_tracking: 0 | 1;
  project_work_header_entries?: ProjectWorkHeaderChildEntry[];
}

interface FrappeManpowerDetail {
  label: string; // Corrected: This MUST match the backend field name
  count: number;
}

interface LocalMilestoneData {
  name: string;
  work_milestone_name: string;
  work_header: string;
  status: 'Not Started' | 'WIP' | 'Not Applicable' | 'Completed';
  progress: number;
  expected_starting_date?: string;
  expected_completion_date?: string;
  remarks?: string;
  is_updated_for_current_report?: boolean; // New field for frontend validation
   // --- NEW FIELD ---
  work_plan?: string; // Stored as long text with $#,,, delimiter
  work_plan_ratio?: 'Plan Not Required' | 'Plan Required'; // NEW: To manage the visibility/requirement of work_plan input
}

// Define the exact structure Frappe expects for a milestone child table entry when submitting a parent doc
interface FrappeMilestoneChildPayload {
  name?: string; // Only present if updating an existing child row; omit for new rows.
  work_milestone_name: string;
  work_header: string;
  status: 'Not Started' | 'WIP' | 'Not Applicable' | 'Completed';
  progress: number;
  expected_starting_date?: string;
  expected_completion_date?: string;
  remarks?: string;
  work_plan?: string; 
  // NO other Frappe system fields like docstatus, parent, doctype, etc.
}

interface ProjectProgressReportData {
  name?: string; // To store the Frappe document name if it exists locally
  project: string;
  report_date: string;
  manpower_remarks?: string;
  manpower?: FrappeManpowerDetail[];
  milestones?: LocalMilestoneData[];
  photos?: ProjectProgressAttachment[];
  report_status?: 'Draft' | 'Completed';
  report_zone?: string; // <-- NEW FIELD
  draft_owner?: string; // ADDED
  draft_last_updated?: string; // ADDED
  drawing_remarks?: string; // NEW: Client/Clearance Issues - Drawing Remarks
  site_remarks?: string; // NEW: Client/Clearance Issues - Site Remarks
  client_clearance_selection?: 'yes' | 'no' | null; // NEW: Persist Tab Selection
}

interface FrappeProjectProgressReportPayload {
  project: string;
  report_date: string;
  manpower_remarks?: string;
  manpower?: FrappeManpowerDetail[];
  milestones?: FrappeMilestoneChildPayload[]; // Now uses the cleaned payload type
  attachments?: Omit<ProjectProgressAttachment, 'local_id'>[];
  report_status: 'Draft' | 'Completed';
  report_zone?: string; // <-- NEW FIELD
  draft_owner?: string; // ADDED
  draft_last_updated?: string; // ADDED
  drawing_remarks?: string; // NEW: Client/Clearance Issues - Drawing Remarks
  site_remarks?: string; // NEW: Client/Clearance Issues - Site Remarks
}

// --- Client/Clearance Issues Tab Data ---
interface ClientClearanceData {
  drawingRemarks: string[]; // Array of drawing remark points
  siteRemarks: string[]; // Array of site remark points
}

interface WorkMilestoneFromFrappe {
  name: string;
  work_milestone_name: string;
  status: 'Not Started' | 'WIP' | 'Not Applicable' | 'Completed';
  progress: number;
  expected_starting_date: string;
  expected_completion_date: string;
  work_header: string;
    work_plan?: string; 
}

interface FullPreviousProjectProgressReport extends ProjectProgressReportData {
  name: string;
  report_status?: 'Draft' | 'Completed';
  draft_owner?: string; // ADDED
  draft_last_updated?: string; // ADDED
}
// --- END: Refined Interfaces ---
// Place these near the top of MilestoneTabInner or outside if preferred

export const DELIMITER = "$#,,,"; // Custom delimiter for work plan points and client/clearance remarks

export const parseWorkPlan = (workPlanString?: string | null): string[] => {
  if (!workPlanString || typeof workPlanString !== 'string' || workPlanString.trim() === '') {
    return [""]; // Start with an empty point
  }
  // Split the string and filter out empty strings resulting from trailing/leading delimiters
  return workPlanString.split(DELIMITER).filter(p => p.trim() !== '');
};

export const serializeWorkPlan = (workPlanPoints: string[]): string => {
  // Filter out empty lines before joining
  return workPlanPoints.filter(p => p.trim() !== '').join(DELIMITER);
};

// --- Client/Clearance Issues Parsing Functions ---
// Parse remarks from backend field - each remark is separated by $#,,,
// Format: remark1$#,,,remark2$#,,,remark3
export const parseClientClearanceRemarks = (remarksString?: string | null): string[] => {
  if (!remarksString || typeof remarksString !== 'string' || remarksString.trim() === '') {
    return [];
  }
  // Split by delimiter and filter out empty entries
  return remarksString.split(DELIMITER).filter(p => p.trim() !== '');
};

// Serialize remarks to backend format
// Format: remark1$#,,,remark2$#,,,remark3
export const serializeClientClearanceRemarks = (remarks: string[]): string => {
  return remarks.filter(r => r.trim() !== '').join(DELIMITER);
};

// Helper component for the radio circle indicator
const RadioIndicator: React.FC<{ isActive: boolean, isDisabled: boolean }> = ({ isActive, isDisabled }) => (
    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center mr-2 transition-colors duration-150 flex-shrink-0
        ${isDisabled 
            ? 'border-gray-400 bg-gray-200' 
            : isActive 
                ? 'border-white bg-white' // Active: White fill for the inner circle
                : 'border-gray-500 bg-transparent' // Inactive: Transparent fill
        }`}
    >
        {/* Inner dot for the active state */}
        {isActive && !isDisabled && (
            <div className="w-2 h-2 rounded-full bg-blue-600" /> // Use blue for active dot color
        )}
        {/* If you wanted a checkmark for the active state instead of a dot, you'd use: 
        {isActive && !isDisabled && <Check className="w-3 h-3 text-blue-600" />} */}
    </div>
);




const MilestoneTabInner = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { selectedProject, setSelectedProject, currentUser:user } = useContext(UserContext); // MODIFIED: Destructured `user`
  const navigate = useNavigate();
  const {
    data: apiData,
    isLoading: apiDataLoading,
    isError:isMapError
  } = useFrappeGetDoc("Map API", {
    fields: ["*"],
  });
  const location = useLocation(); // <-- NEW: Hook to get location object

  // Function to get query parameters
  const useQuery = () => {
    return new URLSearchParams(location.search);
  };
  const query = useQuery();
  const initialZone = query.get("zone"); // <-- NEW: Get the 'zone' parameter

  // Use a state/variable for the current report's zone
  // Since this is read-only for the MilestoneTab flow, a simple variable is fine
  const reportZone = initialZone; // <-- NEW

 const zoneKey = reportZone; // Use the zone in the key
  const [activeTabValue, setActiveTabValue] = useState("Work force");
  const [summaryWorkDate, setSummaryWorkDate] = useState<Date>(new Date());

  const [isCaptureDialogOpen, setIsCaptureDialogOpen] = useState(false);
  const [localPhotos, setLocalPhotos] = useState<ProjectProgressAttachment[]>([]);
  const getPhotosStorageKey = (dateString: string) => `project_${projectId}_date_${dateString}_zone_${reportZone}_tab_Photos`;


  const {
    data: projectData,
    isLoading: projectLoading,
    error: projectError,
  } = useFrappeGetDoc<ProjectData>("Projects", projectId, projectId ? undefined : null);

  const {
    data: allFrappeMilestones,
    isLoading: frappeMilestonesLoading,
    error: frappeMilestonesError,
  } = useFrappeGetDocList<WorkMilestoneFromFrappe>("Work Milestones", {
    fields: ["*"],
    limit: 0,
    orderBy: { field: "work_milestone_order", order: "asc" },
    enabled: !!projectId,
  });

  // This hook now specifically fetches the LATEST *COMPLETED* report for the project.
  const {
    data: latestCompletedReportsList,
    isLoading: latestCompletedReportsListLoading,
    error: latestCompletedReportsListError,
  } = useFrappeGetDocList<{ name: string, project: string, report_date: string, report_status: 'Draft' | 'Completed', report_zone?: string }>("Project Progress Reports", {
    fields: ["name", "project", "report_date", "report_status",'report_zone'],
    filters: [
      ["project", "=", projectId],
      ["report_status", "=", "Completed"],
      ["report_zone","=",reportZone]
    ],
    orderBy: { field: "report_date", order: "desc" },
    limit: 1,
    enabled: !!projectId,
  });

  const latestCompletedReportName = latestCompletedReportsList?.[0]?.name;
  console.log("latestCompletedReportName",latestCompletedReportName)

  const todayFormatted = formatDate(new Date());

// Check if the latest completed report date matches today's date
const latestCompletedReportDateIsToday = 
  !latestCompletedReportsListLoading && // Ensure data is loaded
  latestCompletedReportsList && 
  latestCompletedReportsList.length > 0 && 
  formatDate(latestCompletedReportsList?.[0].report_date) == todayFormatted;


  console.log("todayFormatted",todayFormatted,formatDate(latestCompletedReportsList?.[0]?.report_date),latestCompletedReportDateIsToday)

  // This hook now fetches the full details of the LATEST *COMPLETED* report.
  const {
    data: lastCompletedReport,
    isLoading: lastCompletedReportLoading,
    error: lastCompletedReportError,
  } = useFrappeGetDoc<FullPreviousProjectProgressReport>(
    "Project Progress Reports",
    latestCompletedReportName,
    latestCompletedReportName ? undefined : null
  );
  
  const { workHeaderOrderMap } = useWorkHeaderOrder();

  // This hook correctly finds a draft for the *current* date.
  const {
    data: existingDraftReport,
    isLoading: existingDraftReportLoading,
    error: existingDraftReportError,
    mutate: refetchExistingDraftReport,
  } = useFrappeGetDocList<ProjectProgressReportData>("Project Progress Reports", {
    // MODIFIED: Added `draft_owner` and `draft_last_updated`
    fields: ["name", "report_date", "report_status", "manpower_remarks","draft_owner", "draft_last_updated","report_zone"],
    filters: [
      ["project", "=", projectId],
      ["report_date", "=", formatDate(summaryWorkDate)],
      ["report_status", "=", "Draft"],
      ["report_zone",'=',reportZone]
    ],
    limit: 1,
    enabled: !!projectId && !!summaryWorkDate,
  });

  const existingDraftReportName = existingDraftReport?.[0]?.name;
  console.log("existingDraftReport",existingDraftReport)

  console.log("todayFormatted existingDraftReport",todayFormatted,formatDate(latestCompletedReportsList?.[0]?.report_date),existingDraftReport)

  // This hook now fetches the full details of the LATEST *COMPLETED* report.
  const {
    data: DraftReport,
    isLoading: lastDraftReportLoading,
    error: lastDraftReportError,
  } = useFrappeGetDoc<FullPreviousProjectProgressReport>(
    "Project Progress Reports",
    existingDraftReportName,
    existingDraftReportName ? undefined : null
  );


  const { createDoc, isLoading: isCreatingDoc } = useFrappeCreateDoc();
  const { updateDoc, isLoading: isUpdatingDoc } = useFrappeUpdateDoc();
   const { deleteDoc, isLoading: isDeletingDoc } = useFrappeDeleteDoc(); // ADD THIS

  const [currentFrappeReportName, setCurrentFrappeReportName] = useState<string | null>(null);

  const isFrappeOperationLoading = isCreatingDoc || isUpdatingDoc;

  // --- STATE FOR DRAFT OWNERSHIP CHECK ---
  const [isBlockedByDraftOwnership, setIsBlockedByDraftOwnership] = useState(false);
  const [blockingDraftOwnerEmail, setBlockingDraftOwnerEmail] = useState<string | null>(null);
  const [timeRemainingToUnlock, setTimeRemainingToUnlock] = useState<number | null>(null); // In minutes
  const [draftMessage,SetDraftMessage]=useState<string | null>(null);

  // --- STATE FOR MANPOWER TAB ---
  const [dialogManpowerRoles, setDialogManpowerRoles] = useState<ManpowerRole[]>([]);
  const [dialogRemarks, setDialogRemarks] = useState<string>("");
  const [dialogWorkDate, setDialogWorkDate] = useState<Date>(new Date());
  const [isDialogDatePickerOpen, setIsDialogDatePickerOpen] = useState(false);
  const [isUpdateManpowerDialogOpen, setIsUpdateManpowerDialogOpen] = useState(false);
  const [isLocalSaving, setIsLocalSaving] = useState(false);
  const [summaryManpowerRoles, setSummaryManpowerRoles] = useState<ManpowerRole[]>([]);
  const [summaryManpowerRemarks, setSummaryManpowerRemarks] = useState<string>("");
  const [reportsLoading, setReportsLoading] = useState(false);
  const [localDailyReport, setLocalDailyReport] = useState<ProjectProgressReportData | null>(null);

  // --- STATE FOR MILESTONE DIALOG AND LOCAL MANAGEMENT ---
  const [isUpdateMilestoneDialogOpen, setIsUpdateMilestoneDialogOpen] = useState(false);
  const [selectedMilestoneForDialog, setSelectedMilestoneForDialog] = useState<LocalMilestoneData | null>(null);
  const [newStatus, setNewStatus] = useState<'Not Started' | 'WIP' | 'Not Applicable' | 'Completed' | ''>('');
  const [progress, setProgress] = useState<number>(0);
  const [expectedDate, setExpectedDate] = useState<Date | null>(null);
  const [isMilestoneDatePickerOpen, setIsMilestoneDatePickerOpen] = useState(false);
  const [milestoneRemarks, setMilestoneRemarks] = useState('');

// --- NEW STATES FOR WORK PLAN ---
const [workPlanRatio, setWorkPlanRatio] = useState<'Plan Not Required' | 'Plan Required'>('Plan Not Required');
const [workPlanPoints, setWorkPlanPoints] = useState<string[]>([]); // Array of points for the text area
//

// --- STATE FOR CLIENT/CLEARANCE ISSUES TAB ---
const [hasClearanceIssues, setHasClearanceIssues] = useState<'yes' | 'no' | null>(null);
const [drawingRemarksList, setDrawingRemarksList] = useState<string[]>([]);
const [siteRemarksList, setSiteRemarksList] = useState<string[]>([]);
const [newDrawingRemark, setNewDrawingRemark] = useState<string>("");
const [newSiteRemark, setNewSiteRemark] = useState<string>("");
const [currentCaptureType, setCurrentCaptureType] = useState<'Work' | 'Site' | 'Drawing'>('Work'); // NEW STATE
const getClientClearanceStorageKey = (dateString: string) => `project_${projectId}_date_${dateString}_zone_${reportZone}_tab_Client_Clearance_Issues`;
// --- END STATE FOR CLIENT/CLEARANCE ISSUES TAB ---

// --- STATE FOR SAVE AS-IS CONFIRMATION ---
const [isSaveAsIsConfirmOpen, setIsSaveAsIsConfirmOpen] = useState(false);
const [milestoneForSaveAsIs, setMilestoneForSaveAsIs] = useState<LocalMilestoneData | null>(null);
// --- END STATE FOR SAVE AS-IS ---

  const [currentTabMilestones, setCurrentTabMilestones] = useState<LocalMilestoneData[]>([]);

  const fullManpowerDetails: ManpowerRole[] = [
    { id: "mep_engineer", label: "MEP Engineer", count: 0 },
    { id: "safety_engineer", label: "Safety Engineer", count: 0 },
    { id: "electrical_team", label: "Electrical Team", count: 0 },
    { id: "fire_fighting_team", label: "Fire Fighting Team", count: 0 },
    { id: "data_networking_team", label: "Data & Networking Team", count: 0 },
    { id: "hvac_team", label: "HVAC Team", count: 0 },
    { id: "elv_team", label: "ELV Team", count: 0 },
  ];

  // const getManpowerRolesDefault = (): ManpowerRole[] => {
  //   if(DraftReport?.manpower)
  //   return fullManpowerDetails.map(item => ({ ...item }));
  // };

  const getManpowerRolesDefault = (): ManpowerRole[] => {
  const source = DraftReport?.manpower ?? fullManpowerDetails;

  return source.map(item => {
    const label = item.label  // adjust if your key is different
    const count = Number(item.count ?? 0);

    const id = label.toLowerCase().replace(/\s+/g, "_");

    return {
      id,
      label,
      count,
    };
  });
};


  const getAllAvailableTabs = () => {
    const dynamicTabs = (projectData?.enable_project_milestone_tracking === 1 && projectData?.project_work_header_entries)
      ? projectData.project_work_header_entries.filter(entry => entry.enabled === "True")
      : [];

    // 2. Sort the dynamic entries by ORDER first, then by NAME
    dynamicTabs.sort((a, b) => {
        const orderA = workHeaderOrderMap[a.project_work_header_name] ?? 9999;
        const orderB = workHeaderOrderMap[b.project_work_header_name] ?? 9999;

        if (orderA !== orderB) {
            return orderA - orderB;
        }
        return a.project_work_header_name.localeCompare(b.project_work_header_name);
    });

    return [
      { name: "Work force", project_work_header_name: "Work force", enabled: "True" },
      { name: "Client / Clearance Issues", project_work_header_name: "Client / Clearance Issues", enabled: "True" },
      ...dynamicTabs,
      {name:"Photos",project_work_header_name:"Photos",enabled:"True"},
    ];
  };

  const getInheritedMilestones = (workHeader: string): LocalMilestoneData[] => {
    
    const frappeMilestonesForHeader = allFrappeMilestones?.filter(m => m.work_header === workHeader) || [];
    const DraftReportMilestones=DraftReport?.milestones||[];
    const lastCompletedReportMilestones = lastCompletedReport?.milestones || [];

    // 1. Build the initial list based on the latest Base Milestones for this header.
    const initialMilestones: LocalMilestoneData[] = frappeMilestonesForHeader.map(frappeM => ({
      name: frappeM.name,
      work_milestone_name: frappeM.work_milestone_name,
      work_header: frappeM.work_header,
      // Use the default status/progress from the Frappe DocType definition as a fallback
      status: frappeM.status || 'Not Applicable',
      progress: frappeM.progress || 0,
      expected_starting_date: frappeM.expected_starting_date,
      expected_completion_date: frappeM.expected_completion_date,
      remarks: "", // Start with empty remarks for the new report
      is_updated_for_current_report: false,
       work_plan: "", // Default to empty string
       work_plan_ratio: 'Plan Not Required', // Default to Plan Not Required
    }));

    // 2. Overlay the status/progress from the Last Completed Report onto the base list.
    if(DraftReportMilestones.length>0){
      const mergedMilestones = initialMilestones.map(initialM => {
        const matchingCompletedM =DraftReportMilestones.find(
          (draftM) =>
            draftM.work_header === initialM.work_header &&
            draftM.work_milestone_name === initialM.work_milestone_name
        );

        if (matchingCompletedM) {
          // Found a match: overlay the status and progress
            return {
            ...initialM, // Keep base fields like name, work_header, work_milestone_name
            status: matchingCompletedM.status,
            progress: matchingCompletedM.progress,
            expected_starting_date: matchingCompletedM.expected_starting_date,
            expected_completion_date: matchingCompletedM.expected_completion_date,

             // --- NEW FIELDS OVERLAYED ---
            work_plan:matchingCompletedM.work_plan||"",
    // Determine ratio based on whether the plan was present in the last completed report
            work_plan_ratio: matchingCompletedM.work_plan ? 'Plan Required' : 'Plan Not Required',
            // remarks and is_updated_for_current_report remain the default/initial values
          };
        }
        return initialM; // No match found in completed report, keep the Base Milestone's default state
      });
      
      return mergedMilestones;
    }

    if (lastCompletedReportMilestones.length > 0 && !DraftReport) {
      const mergedMilestones = initialMilestones.map(initialM => {
        
        // Find a matching milestone in the last completed report by Name/Header
        const matchingCompletedM = lastCompletedReportMilestones.find(
          (completedM) =>
            completedM.work_header === initialM.work_header &&
            completedM.work_milestone_name === initialM.work_milestone_name
        );

        if (matchingCompletedM) {
          // Found a match: overlay the status and progress
          return {
            ...initialM, // Keep base fields like name, work_header, work_milestone_name
            status: matchingCompletedM.status,
            progress: matchingCompletedM.progress,
            expected_starting_date: matchingCompletedM.expected_starting_date,
            expected_completion_date: matchingCompletedM.expected_completion_date,

             // --- NEW FIELDS OVERLAYED ---
            work_plan:"",
    // Determine ratio based on whether the plan was present in the last completed report
            work_plan_ratio: matchingCompletedM.work_plan ? 'Plan Required' : 'Plan Not Required',
            // remarks and is_updated_for_current_report remain the default/initial values
          };
        }
        return initialM; // No match found in completed report, keep the Base Milestone's default state
      });
      
      return mergedMilestones;
    }

    // 3. If no last completed report, return the list based purely on Base Milestones.
    return initialMilestones;
  };

  const initializeTabStructureInLocalStorage = () => {
    const dateString = formatDate(summaryWorkDate);
   
    const allTabs = getAllAvailableTabs();
    
    const existingDraftOwner = existingDraftReport?.[0]?.draft_owner || null;
    const existingDraftLastUpdated = existingDraftReport?.[0]?.draft_last_updated || null;

    allTabs.forEach(tab => {
      const storageKey = `project_${projectId}_date_${dateString}_zone_${zoneKey}_tab_${tab.project_work_header_name}`;
      const existingData = sessionStorage.getItem(storageKey);
      
      if (!existingData) {
        let initialData: ProjectProgressReportData | Pick<ProjectProgressReportData, 'photos'>;

        if (tab.project_work_header_name === "Work force") {
          initialData = {
            project: projectId,
            report_date: dateString,
            manpower_remarks: existingDraftReport?.[0]?.manpower_remarks || "",
            manpower:getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count })),
            milestones: [],
            photos: [],
            report_status: 'Draft',
            draft_owner: existingDraftOwner,
            draft_last_updated: existingDraftLastUpdated
          };
        } else if (tab.project_work_header_name === "Photos") {
          const backendPhotos = DraftReport?.photos || [];
          // Ensure local_id exists for frontend state (it's stripped on save)
          const photosWithLocalIds = backendPhotos.map((p: any) => ({
            ...p,
            local_id: p.name || `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            attach_type: p.attach_type || 'Work'
          }));
          initialData = { photos: photosWithLocalIds };
        } else if (tab.project_work_header_name === "Client / Clearance Issues") {
          // Initialize Client/Clearance Issues tab with drawing/site remarks from draft
          const backendPhotos = DraftReport?.photos || [];
          // Ensure local_id exists for frontend state (it's stripped on save)
          const photosWithLocalIds = backendPhotos.map((p: any) => ({
            ...p,
            local_id: p.name || `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            attach_type: p.attach_type || 'Work'
          }));

          initialData = {
            project: projectId || "",
            report_date: dateString,
            manpower: [],
            milestones: [],
            photos: photosWithLocalIds, // Store photos in this tab's storage
            report_status: 'Draft',
            report_zone: reportZone,
            draft_owner: existingDraftOwner,
            draft_last_updated: existingDraftLastUpdated,
            drawing_remarks: DraftReport?.drawing_remarks || "",
            site_remarks: DraftReport?.site_remarks || "",
          };
        } else {
          // MODIFIED LOGIC: Use existing draft milestones if present, OR the inherited list
          const existingDraftMilestonesForTab = DraftReport?.milestones?.filter(
            (m: any) => m.work_header === tab.project_work_header_name
          ) || [];
            
          const milestonesToUse = existingDraftMilestonesForTab.length > 0 
            ? existingDraftMilestonesForTab.map((m: any) => ({
                name: m.name, // Use the row name/id
                work_milestone_name: m.work_milestone_name,
                work_header: m.work_header,
                status: m.status,
                progress: m.progress,
                expected_starting_date: m.expected_starting_date,
                expected_completion_date: m.expected_completion_date,
                remarks: m.remarks,
                is_updated_for_current_report: true, // It's from a draft, so it's "updated"
                // Parse work plan if needed
                work_plan_points: m.work_plan ? m.work_plan.split("$#,,,") : [],
                work_plan_ratio: m.work_plan_ratio || "Plan Not Required",
                is_editing_work_plan: false
            }))
            : getInheritedMilestones(tab.project_work_header_name).map(m => ({
                ...m,
                is_updated_for_current_report: m.is_updated_for_current_report ?? false
            }));

          initialData = {
            project: projectId,
            report_date: dateString,
            manpower: [],
            milestones: milestonesToUse, // Use the determined milestones
            photos: [],
            report_status: 'Draft',
            report_zone: reportZone,
            draft_owner: existingDraftOwner,
            draft_last_updated: existingDraftLastUpdated
          };
        }
        sessionStorage.setItem(storageKey, JSON.stringify(initialData));
      } else {
        const parsedData = JSON.parse(existingData) as ProjectProgressReportData;
        if (tab.project_work_header_name !== "Work force" && tab.project_work_header_name !== "Photos" && tab.project_work_header_name !== "Client / Clearance Issues") {
            const milestonesWithUpdatedFlag = (parsedData.milestones || []).map(m => ({
                ...m,
                is_updated_for_current_report: m.is_updated_for_current_report ?? false
            }));
            if (JSON.stringify(milestonesWithUpdatedFlag) !== JSON.stringify(parsedData.milestones)) {
                sessionStorage.setItem(storageKey, JSON.stringify({ ...parsedData, milestones: milestonesWithUpdatedFlag }));
            }
        }
        if (parsedData.report_status === 'Draft' && !parsedData.draft_owner && existingDraftOwner) {
             const updatedParsedData = {
                 ...parsedData,
                 draft_owner: existingDraftOwner,
                 draft_last_updated: existingDraftLastUpdated
             };
             sessionStorage.setItem(storageKey, JSON.stringify(updatedParsedData));
        }
      }
    });
  };

  const loadDailyReport = () => {
    setReportsLoading(true);
    const dateString = formatDate(summaryWorkDate);
    const zoneKey = reportZone; // Use the zone in the key
    const storageKey = `project_${projectId}_date_${dateString}_zone_${zoneKey}_tab_${activeTabValue}`;
    const storedData = sessionStorage.getItem(storageKey);

    if (activeTabValue === "Photos") {
      const parsedData: Pick<ProjectProgressReportData, 'photos'> = storedData ? JSON.parse(storedData) : { photos: [] };
      setLocalPhotos(parsedData.photos || []);
      setReportsLoading(false);
      return;
    }

    // Handle Client / Clearance Issues tab loading
    // REMOVED EARLY RETURN: integrated into main flow below to support re-initialization from draft

    if (storedData) {
      const parsedData: ProjectProgressReportData = JSON.parse(storedData);
      setLocalDailyReport(parsedData);

      if (activeTabValue === "Work force") {
        const fetchedManpower: FrappeManpowerDetail[] = parsedData.manpower || getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count }));
        setDialogManpowerRoles(fetchedManpower.map(item => ({
          id: `dialog_${item.label}`,
          label: item.label,
          count: item.count
        })));
        setDialogRemarks(parsedData.manpower_remarks || "");
      } else if (activeTabValue === "Client / Clearance Issues") {
        // Parse the drawing and site remarks into arrays
        const drawingPoints = parseClientClearanceRemarks(parsedData.drawing_remarks);
        const sitePoints = parseClientClearanceRemarks(parsedData.site_remarks);
        
        console.log("[DEBUG] Loading Clearance tab data:", {
          storageKey,
          "parsedData.drawing_remarks": parsedData.drawing_remarks,
          "parsedData.site_remarks": parsedData.site_remarks,
          drawingPoints,
          sitePoints
        });
        
        
        setDrawingRemarksList(drawingPoints);
        setSiteRemarksList(sitePoints);
          
        // Load photos directly from this tab's storage
        const currentTabPhotos = parsedData.photos || [];
        setLocalPhotos(currentTabPhotos);

        // --- NEW: Initialize hasClearanceIssues state ---
        if (parsedData.client_clearance_selection) {
             setHasClearanceIssues(parsedData.client_clearance_selection);
        } else {
            // Fallback: Check if data exists
            const hasData = drawingPoints.length > 0 || sitePoints.length > 0 || currentTabPhotos.some(p => p.attach_type === 'Site' || p.attach_type === 'Drawing');
            setHasClearanceIssues(hasData ? 'yes' : null);
        }
        // ------------------------------------------------
      }
    } else {
      console.warn(`Local storage key ${storageKey} was unexpectedly empty in loadDailyReport. Re-initializing.`);
      initializeTabStructureInLocalStorage();
      const reReadData = sessionStorage.getItem(storageKey);
      if (reReadData) {
          const parsedData: ProjectProgressReportData = JSON.parse(reReadData);
          setLocalDailyReport(parsedData);
          if (activeTabValue === "Work force") {
              const fetchedManpower: FrappeManpowerDetail[] = parsedData.manpower || getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count }));
              setDialogManpowerRoles(fetchedManpower.map(item => ({
                id: `dialog_${item.label}`,
                label: item.label,
                count: item.count
              })));
              setDialogRemarks(parsedData.manpower_remarks || "");
          } else if (activeTabValue === "Client / Clearance Issues") {
             // Initialize from the freshly re-read data (which should now have draft content)
             const drawingPoints = parseClientClearanceRemarks(parsedData.drawing_remarks);
             const sitePoints = parseClientClearanceRemarks(parsedData.site_remarks);
             setDrawingRemarksList(drawingPoints);
             setSiteRemarksList(sitePoints);
             // Load photos from this tab's storage
             const currentTabPhotos = parsedData.photos || [];
             setLocalPhotos(currentTabPhotos);

             // --- NEW: Initialize hasClearanceIssues state ---
             if (parsedData.client_clearance_selection) {
                setHasClearanceIssues(parsedData.client_clearance_selection);
             } else {
                 const hasData = drawingPoints.length > 0 || sitePoints.length > 0 || currentTabPhotos.some(p => p.attach_type === 'Site' || p.attach_type === 'Drawing');
                 setHasClearanceIssues(hasData ? 'yes' : null);
             }
             // ------------------------------------------------
          } else if (activeTabValue === "Photos") {
             setLocalPhotos((parsedData as Pick<ProjectProgressReportData, 'photos'>).photos || []);
          }
      } else {
          const dateString = formatDate(summaryWorkDate);
          setLocalDailyReport({
            project: projectId,
            report_date: dateString,
            manpower: activeTabValue === "Work force" ? getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count })) : [],
            milestones: activeTabValue !== "Work force" && activeTabValue !== "Photos" ? getInheritedMilestones(activeTabValue) : [],
            photos: [],
            report_status: 'Draft',
            report_zone:reportZone,
            draft_owner: user || null,
            draft_last_updated: new Date()
          });
          if (activeTabValue === "Work force") {
            setDialogManpowerRoles(getManpowerRolesDefault());
            setDialogRemarks("");
          } else if (activeTabValue === "Photos") {
            setLocalPhotos([]);
          }
      }
    }
    setReportsLoading(false);
  };


    const handlePhotoCaptureSuccess = (photoData: ProjectProgressAttachment) => {
        console.log("photoData received from CameraCapture:", photoData);
        // Inject the current capture type
        const newPhotoWithType = { ...photoData, attach_type: currentCaptureType };
        
        const newPhotos = [...localPhotos, newPhotoWithType];
        setLocalPhotos(newPhotos);
        
        const dateString = formatDate(summaryWorkDate);
        // Determine the correct storage key based on active tab
        const storageKey = activeTabValue === "Client / Clearance Issues" 
            ? `project_${projectId}_date_${dateString}_zone_${zoneKey}_tab_Client / Clearance Issues`
            : getPhotosStorageKey(dateString);
        
        // For Clearance tab, we need to preserve remarks and save full payload
        if (activeTabValue === "Client / Clearance Issues") {
            const existingData = sessionStorage.getItem(storageKey);
            const parsedData = existingData ? JSON.parse(existingData) : {};
            sessionStorage.setItem(storageKey, JSON.stringify({ ...parsedData, photos: newPhotos }));
        } else {
            sessionStorage.setItem(storageKey, JSON.stringify({ photos: newPhotos }));
        }

        setIsCaptureDialogOpen(false);
        toast({
            title: "Photo Ready! 📸",
            description: `Photo has been added to the report's attachments.`,
            variant: "default",
        });
    };

    const handlePhotoRemarksChange = (local_id: string, remarks: string) => {
        const updatedPhotos = localPhotos.map(p => 
            p.local_id === local_id ? { ...p, remarks: remarks } : p
        );
        setLocalPhotos(updatedPhotos);
        const dateString = formatDate(summaryWorkDate);
        // Determine the correct storage key based on active tab
        const storageKey = activeTabValue === "Client / Clearance Issues" 
            ? `project_${projectId}_date_${dateString}_zone_${zoneKey}_tab_Client / Clearance Issues`
            : getPhotosStorageKey(dateString);
        
        if (activeTabValue === "Client / Clearance Issues") {
            const existingData = sessionStorage.getItem(storageKey);
            const parsedData = existingData ? JSON.parse(existingData) : {};
            sessionStorage.setItem(storageKey, JSON.stringify({ ...parsedData, photos: updatedPhotos }));
        } else {
            sessionStorage.setItem(storageKey, JSON.stringify({ photos: updatedPhotos }));
        }
    };

    const handleRemovePhoto = (local_id: string) => {
        const updatedPhotos = localPhotos.filter(p => p.local_id !== local_id);
        setLocalPhotos(updatedPhotos);
        
        const dateString = formatDate(summaryWorkDate);
        // Determine the correct storage key based on active tab
        const storageKey = activeTabValue === "Client / Clearance Issues" 
            ? `project_${projectId}_date_${dateString}_zone_${zoneKey}_tab_Client / Clearance Issues`
            : getPhotosStorageKey(dateString);
        
        if (activeTabValue === "Client / Clearance Issues") {
            const existingData = sessionStorage.getItem(storageKey);
            const parsedData = existingData ? JSON.parse(existingData) : {};
            sessionStorage.setItem(storageKey, JSON.stringify({ ...parsedData, photos: updatedPhotos }));
        } else {
            sessionStorage.setItem(storageKey, JSON.stringify({ photos: updatedPhotos }));
        }
        
        toast({
            title: "Photo Removed",
            description: "The photo has been removed from the current report list.",
            variant: "default",
        });
    };


  useEffect(() => {
    if (projectId && selectedProject !== projectId) {
      setSelectedProject(projectId);
      sessionStorage.setItem("selectedProject", JSON.stringify(projectId));
    }
  }, [projectId, selectedProject, setSelectedProject]);

  useEffect(() => {
    // Wait for all data to be loaded before initializing
    // FIXED: Also check that DraftReport data is actually available when existingDraftReportName exists
    const isDraftLoaded = !existingDraftReportName || (!lastDraftReportLoading && DraftReport !== undefined);

    if (
      projectId &&
      !latestCompletedReportsListLoading &&
      !lastCompletedReportLoading &&
      !existingDraftReportLoading &&
      isDraftLoaded &&  // Ensure full draft is loaded if it exists
      allFrappeMilestones &&
      projectData
    ) {
      if (existingDraftReport && existingDraftReport.length > 0) {
        setCurrentFrappeReportName(existingDraftReport[0].name);
        console.log("Found existing draft report for date:", formatDate(summaryWorkDate), "Name:", existingDraftReport[0].name);
      } else {
        setCurrentFrappeReportName(null);
        console.log("No existing draft report found for date:", formatDate(summaryWorkDate));
      }
      
      initializeTabStructureInLocalStorage();
      loadDailyReport();
    }
  }, [
    summaryWorkDate,
    projectId,
    activeTabValue,
    latestCompletedReportsListLoading,
    lastCompletedReportLoading,
    existingDraftReportLoading,
    lastDraftReportLoading, // Added
    existingDraftReportName, // Added
    DraftReport, // ADDED: Ensure we re-run when DraftReport data arrives
    allFrappeMilestones,
    projectData,
    existingDraftReport,
    lastCompletedReport,
    user
  ]);

  // NEW: useEffect for Draft Ownership Check
  useEffect(() => {
    if (existingDraftReport && existingDraftReport.length > 0 && user) {
      const draftReport = existingDraftReport[0];
      const currentLoggedInUserEmail = user;
      const draftOwnerEmail = draftReport.draft_owner;
      const draftLastUpdated = draftReport.draft_last_updated;

      if (draftOwnerEmail && draftOwnerEmail !== currentLoggedInUserEmail) {
        // A different user owns this draft
        const now = new Date();
        // Fallback to 'now' if draftLastUpdated is null/invalid, to prevent immediate "stale" status.
        const lastUpdatedTime = draftLastUpdated ? new Date(draftLastUpdated) : now; 
        const diffMs = now.getTime() - lastUpdatedTime.getTime();
        const diffMinutes = Math.floor(diffMs / (1000 * 60));

        const GRACE_PERIOD_MINUTES = 30; // Define your grace period here

        if (diffMinutes < GRACE_PERIOD_MINUTES) {
          // Still within the grace period, block the current user
          setIsBlockedByDraftOwnership(true);
          setBlockingDraftOwnerEmail(draftOwnerEmail);
          setTimeRemainingToUnlock(GRACE_PERIOD_MINUTES - diffMinutes);
          SetDraftMessage(`Blocked: Draft owned by ${draftOwnerEmail}. Time remaining: ${GRACE_PERIOD_MINUTES - diffMinutes} mins.`);
        } 
        else {
          // Grace period passed, allow the current user to take ownership
          // This implicitly means the current user will now be the draft_owner
         setIsBlockedByDraftOwnership(true);
          
          setTimeRemainingToUnlock(0); // Set to 0 to indicate stale and no remaining time
          // SetDraftMessage(`Allowed: Draft previously owned by ${draftOwnerEmail} is stale (>${GRACE_PERIOD_MINUTES} mins)`);
          SetDraftMessage(`Allowed: Draft  owned by ${draftOwnerEmail}.`);


        }
      } else {
        // No owner, or current user is the owner
        setIsBlockedByDraftOwnership(false);
        setBlockingDraftOwnerEmail(null);
        setTimeRemainingToUnlock(null);
        SetDraftMessage(null);
      }
    } else {
      // No existing draft or no user logged in
      setIsBlockedByDraftOwnership(false);
      setBlockingDraftOwnerEmail(null);
      setTimeRemainingToUnlock(null);
    //  SetDraftMessage("Allowed: No existing draft found or no user logged in.");
    }
  }, [existingDraftReport, user, summaryWorkDate]); // Depend on user to re-evaluate if login state changes


  useEffect(() => {
    if (localDailyReport && activeTabValue === "Work force") {
      const fetchedManpowerDetails: ManpowerRole[] = (localDailyReport.manpower || []).map(item => ({
        id: `summary_${item.label}`,
        label: item.label,
        count: item.count
      }));
      const combinedRoles = getManpowerRolesDefault();
      
      fetchedManpowerDetails.forEach(fetchedRole => {
        const existingRole = combinedRoles.find(r => r.label === fetchedRole.label);
        if (existingRole) {
          existingRole.count = fetchedRole.count;
        } else {
          combinedRoles.push(fetchedRole);
        }
      });

      setSummaryManpowerRoles(combinedRoles);
      setDialogRemarks(localDailyReport.manpower_remarks || "");
      setSummaryManpowerRemarks(localDailyReport.manpower_remarks || "");
      setDialogManpowerRoles(combinedRoles.map(item => ({
        id: `dialog_${item.label}`,
        label: item.label,
        count: item.count
      })));
    } else if (activeTabValue === "Work force") {
      setSummaryManpowerRoles(getManpowerRolesDefault());
      setDialogRemarks("");
      setSummaryManpowerRemarks("");
      setDialogManpowerRoles(getManpowerRolesDefault());
    }
  }, [localDailyReport, summaryWorkDate, activeTabValue]);

  // useEffect(() => {
  //   if (activeTabValue === "Work force" || activeTabValue === "Photos" || !allFrappeMilestones) {
  //     setCurrentTabMilestones([]);
  //     return;
  //   }

  //   // const localMilestonesFlatArray = getInheritedMilestones(activeTabValue) || localDailyReport?.milestones ;

  //   const localMilestonesFlatArray =localDailyReport?.milestones || getInheritedMilestones(activeTabValue);

  //   const milestonesForCurrentTab: LocalMilestoneData[] = [];
  //   localMilestonesFlatArray.forEach(milestone => {
  //     if (milestone.work_header === activeTabValue) {
  //       milestonesForCurrentTab.push(milestone);
  //     }
  //   });

  //   setCurrentTabMilestones(milestonesForCurrentTab);
  // }, [activeTabValue, localDailyReport, allFrappeMilestones, lastCompletedReport]);

  useEffect(() => {
    if (activeTabValue === "Work force" || activeTabValue === "Photos" || !allFrappeMilestones) {
      setCurrentTabMilestones([]);
      return;
    }

    const currentTabWorkHeader = activeTabValue;

    // 1. Prioritize milestones from the localDailyReport state (loaded from session storage)
    let milestonesForCurrentTab: LocalMilestoneData[] = 
        localDailyReport?.milestones?.filter(m => m.work_header === currentTabWorkHeader) || [];
    
    // 2. If localDailyReport did not contain milestones for this tab, 
    //    fall back to the inherited/base milestones.
    if (milestonesForCurrentTab.length === 0) {
        // We call loadDailyReport/initializeTabStructureInLocalStorage 
        // in the main effect, which already ensures the data is in sessionStorage.
        // We re-call getInheritedMilestones here as a final safeguard/to ensure the base structure
        // is used if initialization somehow failed to populate the milestones array correctly.
        milestonesForCurrentTab = getInheritedMilestones(currentTabWorkHeader);
        
        // Safety check: if localDailyReport exists but its milestone array was empty,
        // we should merge the inherited data into the local report state for the next update.
        // This is mainly handled by initializeTabStructureInLocalStorage, but this ensures 
        // the correct list is displayed.
    }

    setCurrentTabMilestones(milestonesForCurrentTab);
  }, [activeTabValue, localDailyReport, allFrappeMilestones, lastCompletedReport]);

  const handleDialogManpowerCountChange = (index: number, value: string) => {
    const updatedRoles = [...dialogManpowerRoles];
    updatedRoles[index].count = Number(value) || 0;
    setDialogManpowerRoles(updatedRoles);
  };

  const handleDialogRoleNameChange = (index: number, value: string) => {
    const updatedRoles = [...dialogManpowerRoles];
    updatedRoles[index].label = value;
    setDialogManpowerRoles(updatedRoles);
  };

  const handleAddManpowerRole = () => {
    setDialogManpowerRoles([...dialogManpowerRoles, { id: `new_role_${Date.now()}`, label: "New Role", count: 0 }]);
  };

  const handleRemoveManpowerRole = (indexToRemove: number) => {
    setDialogManpowerRoles(prevRoles => prevRoles.filter((_, index) => index !== indexToRemove));
    toast({
      title: "Role Removed",
      description: "Manpower role has been removed.",
      variant: "default",
    });
  };

  const openUpdateManpowerDialog = () => {
    setIsUpdateManpowerDialogOpen(true);
  };

  const moveToNextTab = () => {
    const allTabs = getAllAvailableTabs();
    const currentIndex = allTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);
    
    if (currentIndex < allTabs.length - 1) {
      const nextTab = allTabs[currentIndex + 1];
      setActiveTabValue(nextTab.project_work_header_name);
      return false;
    }
    return true;
  };

  const saveCurrentTabData = (milestoneData?: LocalMilestoneData[]) => {
    const dateString = formatDate(summaryWorkDate);
    const storageKey = `project_${projectId}_date_${dateString}_zone_${zoneKey}_tab_${activeTabValue}`;
console.log(user)
    const currentDraftOwner = user || null;
    const currentTimestamp = new Date();

    console.log("currentTimestamp",currentTimestamp,new Date)

    if (activeTabValue === "Work force") {
      const manpowerToSave: FrappeManpowerDetail[] = dialogManpowerRoles.map((item) => ({
        label: item.label,
        count: item.count,
      }));

      const payload: ProjectProgressReportData = {
        project: projectId,
        report_date: dateString,
        manpower_remarks: dialogRemarks,
        manpower: manpowerToSave,
        milestones: [],
        photos: [],
        report_status: 'Draft',
        report_zone: reportZone,
        draft_owner: currentDraftOwner,
        draft_last_updated: currentTimestamp
      };

      sessionStorage.setItem(storageKey, JSON.stringify(payload));
    } else if (activeTabValue === "Photos") {
            const payload: Pick<ProjectProgressReportData, 'photos'> = { photos: localPhotos };
            sessionStorage.setItem(storageKey, JSON.stringify(payload));
    } else if (activeTabValue === "Client / Clearance Issues") {
      // Save Client/Clearance Issues tab data
      let drawingRemarksToSave = "";
      let siteRemarksToSave = "";
      let photosToSave = localPhotos;

      if (hasClearanceIssues === 'yes') {
          drawingRemarksToSave = serializeClientClearanceRemarks(drawingRemarksList);
          siteRemarksToSave = serializeClientClearanceRemarks(siteRemarksList);
          photosToSave = localPhotos;
      } else {
          // If "No", save empty remarks and filter out associated photos
          drawingRemarksToSave = "";
          siteRemarksToSave = "";
          photosToSave = localPhotos.filter(p => p.attach_type !== 'Site' && p.attach_type !== 'Drawing');
      }
      
      const payload: ProjectProgressReportData = {
        project: projectId,
        report_date: dateString,
        manpower: [],
        milestones: [],
        photos: photosToSave, // Save photos directly to this tab's storage
        report_status: 'Draft',
        report_zone: reportZone,
        draft_owner: currentDraftOwner,
        draft_last_updated: currentTimestamp,
        drawing_remarks: drawingRemarksToSave,
        site_remarks: siteRemarksToSave,
        client_clearance_selection: hasClearanceIssues, // Save user selection
      };
      sessionStorage.setItem(storageKey, JSON.stringify(payload));
    } else {
      const payload: ProjectProgressReportData = {
        project: projectId,
        report_date: dateString,
        manpower: [],
        milestones: milestoneData || currentTabMilestones,
        photos: [],
        report_status: 'Draft',
        report_zone: reportZone,
        draft_owner: currentDraftOwner,
        draft_last_updated: currentTimestamp
      };

      sessionStorage.setItem(storageKey, JSON.stringify(payload));
    }
  };

  const collectAllTabData = (status: 'Draft' | 'Completed'): FrappeProjectProgressReportPayload => {
    const dateString = formatDate(summaryWorkDate);
    const allTabs = getAllAvailableTabs();
    let allManpower: FrappeManpowerDetail[] = [];
    let allMilestones: LocalMilestoneData[] = [];
    let allPhotos: ProjectProgressAttachment[] = [];
    let manpowerRemarks = "";
    let clientClearanceDrawingRemarks = "";
    let clientClearanceSiteRemarks = "";

    allTabs.forEach(tab => {

      const storageKey = `project_${projectId}_date_${dateString}_zone_${zoneKey}_tab_${tab.project_work_header_name}`;
      const tabData = sessionStorage.getItem(storageKey);
      
      let parsedData: ProjectProgressReportData | Pick<ProjectProgressReportData, 'photos'> | null = null;
      if (tabData) {
        parsedData = JSON.parse(tabData);
      }

      if (tab.project_work_header_name === "Work force") {
        allManpower = (parsedData as ProjectProgressReportData)?.manpower || [];
        manpowerRemarks = (parsedData as ProjectProgressReportData)?.manpower_remarks || "";
      } else if (tab.project_work_header_name === "Photos") {
        allPhotos.push(...((parsedData as Pick<ProjectProgressReportData, 'photos'>)?.photos || []).filter(p => p.image_link));
      } else if (tab.project_work_header_name === "Client / Clearance Issues") {
        // Collect drawing and site remarks - these will be added to the final payload later
        // We capture them from the parsed data
        clientClearanceDrawingRemarks = (parsedData as ProjectProgressReportData)?.drawing_remarks || "";
        clientClearanceSiteRemarks = (parsedData as ProjectProgressReportData)?.site_remarks || "";
        // FIXED: Collect photos from this tab as well (Site and Drawing photos)
        allPhotos.push(...((parsedData as ProjectProgressReportData)?.photos || []).filter(p => p.image_link));
      } else { // Milestone tabs
        let tabMilestones: LocalMilestoneData[] = [];
        if (parsedData && (parsedData as ProjectProgressReportData).milestones && (parsedData as ProjectProgressReportData).milestones!.length > 0) {
          tabMilestones = (parsedData as ProjectProgressReportData).milestones!;
        } else {
          tabMilestones = getInheritedMilestones(tab.project_work_header_name);
        }
        allMilestones.push(...tabMilestones);
      }
    });

    const cleanedMilestones: FrappeMilestoneChildPayload[] = allMilestones.map(milestone => {
      const payloadEntry: FrappeMilestoneChildPayload = {
        work_milestone_name: milestone.work_milestone_name,
        work_header: milestone.work_header,
        status: milestone.status,
        progress: milestone.progress,
        remarks: milestone.remarks || '',
        // --- NEW FIELD ADDED ---
            work_plan: milestone.work_plan || '', 
            // -----------------------
      };

      if (milestone.expected_starting_date) {
        payloadEntry.expected_starting_date = milestone.expected_starting_date;
      }
      if (milestone.expected_completion_date) {
        payloadEntry.expected_completion_date = milestone.expected_completion_date;
      }
      // if (milestone.name) { 
      //     payloadEntry.name = milestone.name;
      // }

      return payloadEntry;
    });

    const cleanedAttachments: Omit<ProjectProgressAttachment, 'local_id'>[] = allPhotos.map(photo => ({
        image_link: photo.image_link,
        location: photo.location,
        remarks: photo.remarks,
        attach_type: photo.attach_type || 'Work',
    }));

    const finalPayload: FrappeProjectProgressReportPayload = {
      project: projectId,
      report_date: dateString,
      manpower_remarks: manpowerRemarks,
      manpower: allManpower,
      milestones: cleanedMilestones,
      attachments: cleanedAttachments,
      report_status: status,
      report_zone: reportZone || undefined, // Ensure undefined if null
      drawing_remarks: clientClearanceDrawingRemarks, // NEW: Client/Clearance Issues
      site_remarks: clientClearanceSiteRemarks, // NEW: Client/Clearance Issues
    };

    if (status === 'Draft') {
      console.log("user?.email",user,new Date())
      finalPayload.draft_owner = user;
      finalPayload.draft_last_updated = formatToLocalDateTimeString(new Date()); 
    } else {
        finalPayload.draft_owner = undefined;
        finalPayload.draft_last_updated = undefined;
    }

    return finalPayload;
  };

  const clearAllTabData = () => {
    const dateString = formatDate(summaryWorkDate);
    const allTabs = getAllAvailableTabs();
    // sessionStorage.clear();
    
    
    allTabs.forEach(tab => {
      const storageKey = `project_${projectId}_date_${dateString}_zone_${zoneKey}_tab_${tab.project_work_header_name}`;
      console.log("Clear keys",storageKey)
      sessionStorage.removeItem(storageKey);
    });
  };

  const handleSyncAndSubmitAllData = async (isCalledFromManpowerDialog = false) => {
    setIsLocalSaving(true);

    if (activeTabValue !== "Work force" && activeTabValue !== "Photos") {
      const hasUnupdatedMilestones = currentTabMilestones.some(
        (m) => m.is_updated_for_current_report==false
      );

      if (hasUnupdatedMilestones) {
        setIsLocalSaving(false);
        toast({
          title: "Validation Error 🚫",
          description: `Please update all visible milestones in the '${activeTabValue}' tab before continuing.`,
          variant: "destructive",
        });
        return;
      }
    }

    saveCurrentTabData();

    // --- Validation: Manpower Count must be >= 1 ---
    if (isCalledFromManpowerDialog || activeTabValue === "Work force") {
        const totalManpowerCount = dialogManpowerRoles.reduce((sum, item) => sum + (item.count || 0), 0);
        if (totalManpowerCount < 1) {
            setIsLocalSaving(false);
            toast({
                title: "Validation Error 🚫",
                description: "Manpower total count should be at least one.",
                variant: "destructive",
            });
            return;
        }
    }
    // -----------------------------------------------

    const allTabs = getAllAvailableTabs();
    const currentIndex = allTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);
    const isLastTab = currentIndex === allTabs.length - 1;

    let submissionStatus: 'Draft' | 'Completed';
    let successMessage: string;
    let failureMessage: string;
    let operationType: 'create' | 'update';
    let docNameForFrappeOperation: string | null = null;

    if (isLastTab) {
      submissionStatus = 'Completed';
      successMessage = "Final Report Submitted Successfully! ✅";
      failureMessage = "Final Submission Failed ❌";
      operationType = 'update';
      docNameForFrappeOperation = currentFrappeReportName;

      const payloadToCheckPhotos = collectAllTabData('Draft');
      const workPhotosCount = (payloadToCheckPhotos.attachments || []).filter(p => !p.attach_type || p.attach_type === 'Work').length;
      
      if (workPhotosCount < 4) {
        setIsLocalSaving(false);
        toast({
          title: "Submission Validation Error 🚫",
          description: "Please upload at least 4 WORK photos before final submission.",
          variant: "destructive",
        });
        return;
      }

      if (!docNameForFrappeOperation) {
        setIsLocalSaving(false);
        toast({
          title: "Submission Error 🚫",
          description: "No draft report found to finalize. Please ensure you've saved intermediate progress first.",
          variant: "destructive",
        });
        console.error("Attempted final submission without a currentFrappeReportName.");
        return;
      }

    } else {
      submissionStatus = 'Draft';
      successMessage = "Report Data Synced! 🎉";
      failureMessage = "Data Sync Failed ❌";

      if (currentFrappeReportName) {
        operationType = 'update';
        docNameForFrappeOperation = currentFrappeReportName;
      } else {
        operationType = 'create';
      }
    }

    const finalPayload = collectAllTabData(submissionStatus);
    console.log("Submitting to Frappe with status:", submissionStatus, "Operation:", operationType, "Payload:", finalPayload);

    // Start Sentry tracking
    const sentryOperation = isLastTab ? 'final-submission' : 'save-draft';
    const sentryContext = {
      project_id: projectId,
      report_id: currentFrappeReportName || undefined,
      report_date: finalPayload.report_date,
      report_status: submissionStatus,
      active_tab: activeTabValue,
      photo_count: localPhotos.length,
      milestone_count: currentTabMilestones.length,
    };

    const endSpan = startWorkflowTransaction('project-progress-report', sentryOperation, sentryContext);
    const breadcrumbMessage = isLastTab ? 'Final report submission started' : 'Report sync started';
    addWorkflowBreadcrumb('project-progress-report', breadcrumbMessage, sentryContext);

    try {
      let response: any;
      if (operationType === 'create') {
        response = await createDoc("Project Progress Reports", finalPayload);
        setCurrentFrappeReportName(response.name);
        console.log("Frappe create response (Draft):", response);
      } else {
        if (!docNameForFrappeOperation) {
             throw new Error("Cannot update: no document name provided for update operation.");
        }
        response = await updateDoc("Project Progress Reports", docNameForFrappeOperation, finalPayload);
        console.log("Frappe update response:", response);
      }

      toast({
        title: successMessage,
        description: `Project Progress Report for ${finalPayload.report_date} (${submissionStatus}) has been processed.`,
        variant: "default",
      });

      // Success breadcrumb
      const successBreadcrumb = isLastTab ? 'Final report submission successful' : 'Report sync successful';
      addWorkflowBreadcrumb('project-progress-report', successBreadcrumb, {
        report_id: response.name || docNameForFrappeOperation
      });

      if (isLastTab) {
        clearAllTabData();
        console.log("clearrrrr")
        setCurrentFrappeReportName(null);
        navigate(`/prs&milestones/milestone-report?zone=${reportZone}`, { replace: true });

      } else if (isCalledFromManpowerDialog) {
        setIsUpdateManpowerDialogOpen(false);
      } else {
        moveToNextTab();
      }

    } catch (error: any) {
      console.error("Error during Frappe operation:", error);

      // Failure breadcrumb
      const failureBreadcrumb = isLastTab ? 'Final report submission failed' : 'Report sync failed';
      addWorkflowBreadcrumb('project-progress-report', failureBreadcrumb, {
        error: error.message
      });

      // Capture error with Sentry
      captureWorkflowError('project-progress-report', error, sentryContext);

      const description = isNetworkError(error)
        ? "Network error. Please check your connection."
        : error.message || "An unknown error occurred during report processing.";

      toast({
        title: failureMessage,
        description,
        variant: "destructive",
      });
    } finally {
      endSpan();
      setIsLocalSaving(false);
      refetchExistingDraftReport();
    }
  };

  // --- STATE FOR HIGHLIGHTING DATE ERROR ---
  const [highlightInvalidDate, setHighlightInvalidDate] = useState(false);

  const openUpdateMilestoneDialog = (milestone: LocalMilestoneData, hasDateError = false) => {
    setSelectedMilestoneForDialog(milestone || null);
    
    // Set highlight state
    setHighlightInvalidDate(hasDateError);

    setNewStatus(milestone.status);
    setProgress(milestone.progress);
    setExpectedDate(
      milestone.status === 'Not Started' && milestone.expected_starting_date
        ? new Date(milestone.expected_starting_date)
        : (milestone.expected_completion_date ? new Date(milestone.expected_completion_date) : null)
    );
    setMilestoneRemarks(milestone.remarks || '');
     // --- NEW LOGIC: Initialize Work Plan Dialog States ---
    const ratio = milestone.work_plan_ratio || 'Plan Not Required';
    setWorkPlanRatio(ratio);
    setWorkPlanPoints(parseWorkPlan(milestone.work_plan));
    // ---------------------------------------------------
    setIsUpdateMilestoneDialogOpen(true);
  };
  
  const handleUpdateMilestone = async () => {
    if (!selectedMilestoneForDialog || !activeTabValue) return;

    if (!newStatus) {
      toast({
        title: "Validation Error 🚫",
        description: "Please select a status for the milestone.",
        variant: "destructive",
      });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (newStatus === 'Not Started') {
      if (!expectedDate) {
        toast({
          title: "Validation Error 🚫",
          description: "Please provide an expected starting date for 'Not Started' milestones.",
          variant: "destructive",
        });
        setHighlightInvalidDate(true);
        return;
      }
      if (expectedDate < today) {
         toast({
            title: "Validation Error 🚫",
            description: "Expected Starting Date cannot be in the past. Please update the date or change the status.",
            variant: "destructive",
          });
          setHighlightInvalidDate(true);
          return;
      }
    } else if (newStatus === 'WIP') {
      if (progress <= 0 || progress >= 100) {
        toast({
          title: "Validation Error 🚫",
          description: "For 'WIP' milestones, progress must be between 1% and 99%.",
          variant: "destructive",
        });
        return;
      }
      if (progress>75) {
         if(!expectedDate){
            toast({
              title: "Validation Error 🚫",
              description: "Please provide an expected completion date for 'WIP' milestones.",
              variant: "destructive",
            });
            setHighlightInvalidDate(true);
            return;
         }
         if (expectedDate < today) {
            toast({
                title: "Validation Error 🚫",
                description: "Expected Completion Date cannot be in the past. Please update the date or change the status.",
                variant: "destructive",
            });
            setHighlightInvalidDate(true);
            return;
        }
      }
    }

     // --- NEW VALIDATION: Check if work_plan is required but empty ---
    if (newStatus != "Completed" && newStatus != "Not Applicable" && workPlanRatio === 'Plan Required' && workPlanPoints.every(p => p.trim() === '')) {
        toast({
            title: "Validation Error 🚫",
            description: "Work Plan is required for this ratio selection.",
            variant: "destructive",
        });
        return;
    }
    // --------------------------------------------------------------

    const updatedLocalMilestone: LocalMilestoneData = {
      ...selectedMilestoneForDialog,
      name: selectedMilestoneForDialog.name,
      work_milestone_name: selectedMilestoneForDialog.work_milestone_name,
      work_header: selectedMilestoneForDialog.work_header,
      status: newStatus,
      progress:progress,
      remarks: milestoneRemarks,
      is_updated_for_current_report: true,
              // --- NEW FIELDS SAVED ---
        work_plan_ratio: workPlanRatio,
        work_plan: workPlanRatio === 'Plan Required' ? serializeWorkPlan(workPlanPoints) : '', // Save only if required
        // ------------------------

    };

    if (newStatus === 'Not Started') {
      updatedLocalMilestone.expected_starting_date = expectedDate ? formatDate(expectedDate) : undefined;
      // updatedLocalMilestone.expected_completion_date = undefined;
      updatedLocalMilestone.progress = 0;
    } else if (newStatus === 'WIP') {
      if(progress>75){
      updatedLocalMilestone.expected_completion_date = expectedDate ? formatDate(expectedDate) : undefined;
      // updatedLocalMilestone.expected_starting_date = undefined; 
      updatedLocalMilestone.progress = progress;
      }else{
        //  updatedLocalMilestone.expected_completion_date = undefined;
      // updatedLocalMilestone.expected_starting_date = undefined; 
      updatedLocalMilestone.progress = progress;
      } 
    }
    else if(newStatus === 'Completed'){
      // updatedLocalMilestone.expected_completion_date = undefined;
      // updatedLocalMilestone.expected_starting_date = undefined; 
      updatedLocalMilestone.progress = 100;
      updatedLocalMilestone.work_plan="";
      updatedLocalMilestone.work_plan_ratio="Plan Not Required";

    }else if(newStatus==='Not Applicable'){
      updatedLocalMilestone.expected_completion_date = undefined;
      updatedLocalMilestone.expected_starting_date = undefined; 
      updatedLocalMilestone.progress = 0;
      updatedLocalMilestone.work_plan="";
      updatedLocalMilestone.work_plan_ratio="Plan Not Required";
    }

    const updatedMilestonesForCurrentTab = [...currentTabMilestones];
    const existingIndex = updatedMilestonesForCurrentTab.findIndex(m => m.name === updatedLocalMilestone.name && m.work_header === updatedLocalMilestone.work_header);
    
    if (existingIndex !== -1) {
      updatedMilestonesForCurrentTab[existingIndex] = updatedLocalMilestone;
    } else {
      updatedMilestonesForCurrentTab.push(updatedLocalMilestone);
    }
    
    setCurrentTabMilestones(updatedMilestonesForCurrentTab);
    saveCurrentTabData(updatedMilestonesForCurrentTab);
    
    setIsUpdateMilestoneDialogOpen(false);
    toast({
      title: "Success! 🎉",
      description: "Milestone updated successfully.",
      variant: "default",
    });
  };

  // --- SAVE AS-IS HANDLERS ---
  const handleSaveAsIsClick = (milestone: LocalMilestoneData) => {
    // --- DATE VALIDATION ---
    // Use Date objects for comparison instead of strings
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let isDateInvalid = false;
    let invalidMessage = "";

    if (milestone.status === 'Not Started') {
        const startDate = milestone.expected_starting_date ? new Date(milestone.expected_starting_date) : null;
        // Reset time for valid comparison
        if (startDate) startDate.setHours(0,0,0,0);
        
        if (!startDate || startDate < today) {
            isDateInvalid = true;
            invalidMessage = "Expected Start Date is in the past. Please update the date or change the status.";
        }
    } else if (milestone.status === 'WIP' && milestone.progress > 75) {
        const completionDate = milestone.expected_completion_date ? new Date(milestone.expected_completion_date) : null;
        if (completionDate) completionDate.setHours(0,0,0,0);

        if (!completionDate || completionDate < today) {
             isDateInvalid = true;
             invalidMessage = "Expected Completion Date is in the past. Please update the date or change the status.";
        }
    }

    if (isDateInvalid) {
        toast({
            title: "Update Required",
            description: invalidMessage,
            variant: "destructive", // Or "warning"
        });
        openUpdateMilestoneDialog(milestone, true); // Pass true to highlight date
        return;
    }
    // -----------------------

    // Only show confirmation if:
    // 1. Milestone is WIP or Not Started AND
    // 2. Previous milestone had work_plan_ratio === 'Plan Required' OR had existing work_plan
    const isWIPOrNotStarted = milestone.status === 'WIP' || milestone.status === 'Not Started';
    const hadPreviousWorkPlan = milestone.work_plan_ratio === 'Plan Required' || (milestone.work_plan && milestone.work_plan.trim() !== '');
    
    if (isWIPOrNotStarted && hadPreviousWorkPlan) {
      // Open the update milestone dialog instead (so user can review/update activities)
      // Pass false (or true if you want to force highlight, but usually false here if no date error)
      // Actually check date again? No, we already passed validation above.
      openUpdateMilestoneDialog(milestone, false);
    } else {
      // Directly save as-is (no confirmation needed)
      executeSaveAsIs(milestone);
    }
  };

  const executeSaveAsIs = (milestone: LocalMilestoneData) => {
    if (!activeTabValue) return;

    const updatedLocalMilestone: LocalMilestoneData = {
      ...milestone,
      is_updated_for_current_report: true,
      // Keep work_plan_ratio as-is but set to 'Plan Not Required' if empty
      work_plan_ratio: milestone.work_plan_ratio || 'Plan Not Required',
    };

    const updatedMilestonesForCurrentTab = [...currentTabMilestones];
    const existingIndex = updatedMilestonesForCurrentTab.findIndex(
      m => m.name === updatedLocalMilestone.name && m.work_header === updatedLocalMilestone.work_header
    );

    if (existingIndex !== -1) {
      updatedMilestonesForCurrentTab[existingIndex] = updatedLocalMilestone;
    } else {
      updatedMilestonesForCurrentTab.push(updatedLocalMilestone);
    }

    setCurrentTabMilestones(updatedMilestonesForCurrentTab);
    saveCurrentTabData(updatedMilestonesForCurrentTab);

    // Close confirmation if open
    setIsSaveAsIsConfirmOpen(false);
    setMilestoneForSaveAsIs(null);

    toast({
      title: "Saved As-Is ✅",
      description: `${milestone.work_milestone_name} marked as updated with no changes.`,
      variant: "default",
    });
  };

  const handleConfirmSaveAsIs = () => {
    if (milestoneForSaveAsIs) {
      executeSaveAsIs(milestoneForSaveAsIs);
    }
  };

  const handleCancelSaveAsIs = () => {
    setIsSaveAsIsConfirmOpen(false);
    setMilestoneForSaveAsIs(null);
  };
  // --- END SAVE AS-IS HANDLERS ---

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Not Started':
        return 'bg-pink-100 text-pink-700';
      case 'WIP':
        return 'bg-yellow-100 text-yellow-700';
      case 'Completed':
        return 'bg-green-100 text-green-700';
      case 'Not Applicable':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const isGlobalLoading = projectLoading || reportsLoading || frappeMilestonesLoading ||
                          latestCompletedReportsListLoading || lastCompletedReportLoading ||
                          existingDraftReportLoading;
  const isGlobalError = projectError || frappeMilestonesError ||
                        latestCompletedReportsListError || lastCompletedReportError ||
                        existingDraftReportError||isMapError;

  const isGlobalSyncDisabled = isLocalSaving || isFrappeOperationLoading || isBlockedByDraftOwnership; // MODIFIED

  if (isGlobalLoading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <TailSpin color="#6366F1" height={80} width={80} />
      </div>
    );
  }

  if (isGlobalError) {
    return <div className="p-4 text-red-600"><div className="flex flex-col items-center justify-center min-h-[50vh] p-6 bg-red-50 text-red-800 rounded-lg shadow-md m-4">
            <h3 className="text-2xl font-bold mb-2 text-center text-red-900">
              Failed to Load Data!
            </h3>
            <p className="text-lg text-center text-red-700 mb-4">
              We encountered a problem trying to fetch the necessary project information.
            </p>
            <p className="text-md text-center text-red-600 mb-6">
              Error Details: <span className="font-semibold">{isGlobalError}</span>
            </p>
            <Button
              onClick={() =>{
    sessionStorage.removeItem('selectedProject'); // ADD THIS LINE
    navigate('/prs&milestones/milestone-report')
              } }
              className="bg-red-600 hover:bg-red-700 text-white text-lg py-3 px-8 rounded-full shadow-lg transition-all duration-300 ease-in-out hover:scale-105"
            >
              Go Back to Reports Overview
            </Button>
          </div></div>;
  }

  if (!projectId) {
    return <div className="p-4 text-red-600">No Project ID found. Please select a project.</div>;
  }

  const handleClearDraft = async () => {
    if (!currentFrappeReportName || !projectId || !summaryWorkDate) {
      toast({
        title: "Error",
        description: "No draft report identified to clear.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Attempt to delete the Frappe document
      await deleteDoc("Project Progress Reports", currentFrappeReportName);

      toast({
        title: "Draft Cleared! ✅",
        description: `The draft report for ${formatDate(summaryWorkDate)} has been successfully cleared.`,
        variant: "default",
      });

      // Clear local storage for this date/project
      clearAllTabData();

      // Reset relevant states to unblock the UI
      setCurrentFrappeReportName(null);
      setIsBlockedByDraftOwnership(false);
      setBlockingDraftOwnerEmail(null);
      setTimeRemainingToUnlock(null);
      SetDraftMessage(null); // Clear any blocking messages

      // Re-fetch existing drafts to reflect the deletion
      refetchExistingDraftReport();
      navigate(`/prs&milestones/milestone-report?zone=${reportZone}`)
      // Navigate away or force a UI re-initialization if needed
      // navigate('/prs&milestones/milestone-report', { replace: true });

    } catch (error: any) {
      console.error("Error clearing draft report:", error);
      toast({
        title: "Failed to Clear Draft ❌",
        description: error.message || "An unknown error occurred while clearing the draft.",
        variant: "destructive",
      });
    }
  };


 // --- NEW: Render Blocking Message if applicable ---
  if (isBlockedByDraftOwnership) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 bg-red-50 text-red-800 rounded-lg shadow-md m-4">
        <X className="h-16 w-16 text-red-500 mb-4 animate-pulse" /> {/* Added animate-pulse for visual attention */}
        <h3 className="text-2xl font-bold mb-2 text-center text-red-900">Draft Report is Locked!</h3> {/* Clearer, stronger heading */}

        {blockingDraftOwnerEmail && (
          <p className="text-lg text-center text-red-700 mb-2">
            This draft is currently being edited by <span className="font-semibold">{blockingDraftOwnerEmail}</span>.
          </p>
        )}

        {timeRemainingToUnlock !== null && timeRemainingToUnlock > 0 ? (
          <>
            <p className="text-md text-center text-red-600 mb-4">
              It will be available in  {timeRemainingToUnlock} minutes:
            </p>
            <p className="font-bold text-red-800 text-5xl mb-6"> {/* Large, prominent countdown */}
              {timeRemainingToUnlock} 
            </p>
            <p className="text-sm text-center text-gray-600 mb-6">
              Please wait for them to finish or contact the user to coordinate.
            </p>
          </>
        ) : (
          <p className="text-md text-center text-red-700 mb-4">
            The draft is now stale (older than 30 minutes). You can clear it and start a new report.
          </p>
        )}

        {/* Buttons Group */}
        <div className="flex flex-col gap-3 mt-4 w-full max-w-sm"> {/* Group buttons and apply max-width for better layout */}
          {timeRemainingToUnlock !== null && timeRemainingToUnlock <= 0 && ( // Show "Clear Draft" only if stale (time is 0 or less)
            <Button
              onClick={handleClearDraft}
              className="w-full bg-red-600 hover:bg-red-700 text-white text-lg py-3 rounded-full shadow-lg transition-all duration-300 ease-in-out hover:scale-105"
              disabled={isDeletingDoc}
            >
              {isDeletingDoc ? <TailSpin height={20} width={20} color="#fff" /> : "Clear Draft & Take Over"}
            </Button>
          )}
          <Button
            onClick={() => navigate(`/prs&milestones/milestone-report?zone=${reportZone}`)}
            className="w-full bg-gray-600 hover:bg-gray-700 text-white text-lg py-3 rounded-full shadow-lg transition-all duration-200 ease-in-out hover:scale-105"
          >
            Go Back to Reports Overview
          </Button>
        </div>
      </div>
    );
  }
  // --- END NEW: Blocking Message ---


  if (latestCompletedReportDateIsToday) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 bg-green-50 text-green-800 rounded-lg shadow-md m-4">
        <CheckCircle className="h-16 w-16 text-green-500 mb-4 animate-bounce-in" /> {/* Success Icon */}
        <h3 className="text-2xl font-bold mb-2 text-center text-green-900">
          Report for Today is Already Completed!
        </h3>
        <p className="text-lg text-center text-green-700 mb-4">
          A final report for Project <span className="font-semibold">{projectData?.project_name || projectId}</span> on <span className="font-semibold">{latestCompletedReportsList[0].report_date}</span> has already been submitted.
        </p>

        {latestCompletedReportName && (
          <p className="text-md text-center text-green-600 mb-6">
            Report ID: <span className="font-semibold">{latestCompletedReportName}</span>
          </p>
        )}

        <Button
          onClick={() => navigate(`/prs&milestones/milestone-report?zone=${reportZone}`)}
          className="bg-green-600 hover:bg-green-700 text-white text-lg py-3 px-8 rounded-full shadow-lg transition-all duration-300 ease-in-out hover:scale-105"
        >
          Go Back to Reports Overview
        </Button>
      </div>
    );
  }



  const allAvailableTabs = getAllAvailableTabs();
  const currentIndex = allAvailableTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);
  const isLastTab = currentIndex === allAvailableTabs.length - 1;


  const getVisibleTabs = (currentTabValue: string) => {
    const currentIndex = allAvailableTabs.findIndex(tab => tab.project_work_header_name === currentTabValue);
    const visibleTabs = [];

    if (currentIndex !== -1) {
      visibleTabs.push(allAvailableTabs[currentIndex]);
    }

    if (currentIndex > 0) {
      visibleTabs.unshift(allAvailableTabs[currentIndex - 1]);
    }

    if (currentIndex !== -1 && currentIndex < allAvailableTabs.length - 1) {
      visibleTabs.push(allAvailableTabs[currentIndex + 1]);
    }
    
    if (allAvailableTabs.length >= 2) {
      if (visibleTabs.length === 1 && currentIndex === 0) {
        if (allAvailableTabs[1]) visibleTabs.push(allAvailableTabs[1]);
      } else if (visibleTabs.length === 1 && currentIndex === allAvailableTabs.length - 1) {
        if (allAvailableTabs[allAvailableTabs.length - 2]) visibleTabs.unshift(allAvailableTabs[allAvailableTabs.length - 2]);
      } else if (visibleTabs.length === 0 && allAvailableTabs.length > 0) {
        visibleTabs.push(allAvailableTabs[0]);
      }
    }
    return visibleTabs;
  };

  const visibleTabs = getVisibleTabs(activeTabValue);

  // Helper function to get the dynamic header title
  const getHeaderTitle = () => {
    if (activeTabValue === "Work force") {
      return "Manpower";
    } else if (activeTabValue === "Photos") {
      return "Photos";
    } else if (activeTabValue === "Client / Clearance Issues") {
      return "Client / Clearance Issues";
    } else {
      return "Milestones"; // For all other work header tabs
    }
  };
  const headerTitle = getHeaderTitle(); // Call the helper function


  const moveToPreviousTab = () => {
    const allTabs = getAllAvailableTabs();
    const currentIndex = allTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);

    if (currentIndex > 0) { // Only move back if not on the first tab
      const previousTab = allTabs[currentIndex - 1];
      setActiveTabValue(previousTab.project_work_header_name);
      return true;
    }
    return false; // Already on the first tab
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="sticky top-0 w-full bg-gray-100 shadow-sm p-4 z-20">
  <div className="flex justify-between items-center ">
    <div className="flex flex-col">
      {/* Dynamic Step and Title */}
      <span className="text-base font-semibold text-gray-800">
        Step {currentIndex + 1}/{allAvailableTabs.length}: {headerTitle} 
      </span>
      {/* Conditional subtitle for "Work force" tab */}
      {activeTabValue === "Work force" ? (
        <span className="text-sm text-gray-600">Specify the workforce details</span>
      ):(
        activeTabValue ==="Photos"?(
          <span className="text-sm text-gray-600">Specify the Photos Proof</span>
        ):(
          <span className="text-sm text-gray-600">Specify the Milestones details</span>
        )
      )}
      {reportZone && (
        <span className="text-xs text-gray-600">Zone: {reportZone}</span>
      )}
    </div>
    <div className="flex flex-col items-end">
      {/* Dynamic Report Date */}
      <span className="text-base font-semibold text-gray-800">
        {summaryWorkDate && formatDate(summaryWorkDate)}
      </span>
      <span className="text-xs text-gray-500">Report Date</span>
    </div>
  </div>
</div>
      {draftMessage&&<div className="text-center text-sm bg-red-400 border p-1 rounded-md mb-2">
        {draftMessage}
        </div>}
      
      <div className="flex-1 mt-1">
        <div className="px-1 bg-white">
          <Tabs value={activeTabValue} className="w-full" onValueChange={(val) => {
            saveCurrentTabData();
            setActiveTabValue(val);
          }}>
            <TabsList
              className="flex w-full justify-evenly p-1 bg-gray-100 rounded-md "
            >

        {visibleTabs.map((tab, index, arr) => {
    const currentActiveTabIndex = arr.findIndex(
      (t) => t.project_work_header_name === activeTabValue
    );
    
    const isUpcoming = currentActiveTabIndex !== -1 && index > currentActiveTabIndex;
    return (
      <TabsTrigger
        key={tab.name || tab.project_work_header_name}
        value={tab.project_work_header_name}
        disabled={isUpcoming || isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
        className={`
          flex-none                    
          w-auto                        
          max-w-[150px]                 
          truncate overflow-hidden whitespace-nowrap 
          text-xs p-2 rounded-md   
          font-semibold     
          data-[state=active]:bg-white data-[state=active]:text-red-500
          data-[state=active]:font-bold 
          
          disabled:opacity-50 disabled:cursor-not-allowed
          disabled:bg-gray-50 disabled:text-gray-700
          
          
          md:flex-1 md:max-w-none md:w-auto
          transition-colors duration-200 ease-in-out
        `}
      >
        {tab.project_work_header_name =="Work force"?"Manpower":tab.project_work_header_name}
      </TabsTrigger>
    );
  })}
</TabsList>
            

            <TabsContent value="Work force" className="mt-4 p-0">
              {/* <Card className="shadow-none border-none"> */}
                   {/*<CardHeader className="pt-0">
                <CardTitle className="text-base font-semibold text-gray-800">
                    <div className="flex justify-between "><span>Man power </span><span className=" text-sm border border-2 rounded-md p-1"> 
                          Report Date: {summaryWorkDate && formatDate(summaryWorkDate)}</span>
                          </div>

                          </CardTitle>
                </CardHeader> */}
                {/* <CardContent className="space-y-4"> */}
                {
                  summaryManpowerRoles.reduce((sum, item) => sum + item.count, 0).toString().padStart(2, "0") >0 ?(


                    <Card className="bg-white p-4 shadow-sm rounded-lg">
                    <CardContent className="p-0">
                      <div className="flex justify-between font-semibold text-sm mb-2 border-b pb-2">
                        <span>Team /Roles</span>
                        <span>
                          Count ({summaryManpowerRoles.reduce((sum, item) => sum + item.count, 0).toString().padStart(2, "0")})
                        </span>
                      </div>
                      <div className="space-y-2">
                        {summaryManpowerRoles.length > 0 ? (
                          summaryManpowerRoles
                            .map((role, index) => (
                              <div key={role.id || index} className="flex justify-between text-sm text-gray-700">
                                <span>
                                  {index + 1}. {role.label}
                                </span>
                                <span>{role.count.toString().padStart(2, "0")}</span>
                              </div>
                            ))
                        ) : (
                          fullManpowerDetails.map((role, index) => (
                            <div key={role.id} className="flex justify-between text-sm text-gray-700">
                              <span>
                                {index + 1}. {role.label}
                              </span>
                              <span>0</span>
                            </div>
                          ))
                        )}
                      </div>
                      
                      {summaryManpowerRemarks && (
                        <div className="mt-4 p-3 bg-gray-50 rounded-md border text-sm text-gray-700">
                          <span className="font-semibold block mb-1 text-gray-900">Remarks:</span>
                          {summaryManpowerRemarks}
                        </div>
                      )}
                    </CardContent>
                  {/* <div className="flex items-center justify-between mt-4 gap-20"> 
    <Button
      className="bg-gray-600 hover:bg-gray-700"
      onClick={openUpdateManpowerDialog}
      disabled={isBlockedByDraftOwnership}
    >
      Edit
    </Button>

    <Button
      className="bg-red-600 hover:bg-red-700 text-white"
       onClick={() => handleSyncAndSubmitAllData(false)}
      disabled={isBlockedByDraftOwnership}
    >
      Continue
    </Button>
</div> */}
<div className="flex items-center mt-4 gap-4 w-full"> 

    <Button
      // Removed w-1/2. Added flex-1.
         variant="outline"
      className="flex-1 text-red-600 border-red-600"
      onClick={openUpdateManpowerDialog}
      disabled={isBlockedByDraftOwnership}
    >
      Edit
    </Button>

    <Button
      // Removed w-1/2. Added flex-1.
      className="bg-red-600 hover:bg-red-700 flex-1 text-white" 
    
       onClick={() => handleSyncAndSubmitAllData(false)}
      disabled={isBlockedByDraftOwnership}
    >
      Continue
    </Button>
</div>


                </Card>
               
                  

                  ):(
                    <div className="flex items-center justify-center mt-4">

                    {/* <Button
                      className="bg-red-600 hover:bg-red-700 text-white"
                      onClick={openUpdateManpowerDialog}
                      disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
                    >
                         Add Manpower 
                    </Button> */}
                     <Button
              variant="outline"
              className="flex items-center gap-2 text-red-600 border-red-600"
              onClick={openUpdateManpowerDialog}
                      disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
            >
              <PlusCircledIcon className="h-4 w-4" /> Add Manpower Details
            </Button>
                  </div>
                  )
                }
                  
                {/* </CardContent> */}
              {/* </Card> */}
            </TabsContent>

            {/* --- CLIENT / CLEARANCE ISSUES TAB --- */}
            <TabsContent value="Client / Clearance Issues" className="mt-4 p-1">
              <div className="space-y-6">

                  {/* --- NEW: Selection for Clearance Issues --- */}
                  <div className="flex flex-col items-center justify-center p-6 bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
                      <h3 className="text-lg font-semibold text-gray-800 mb-4">Do you want to add Site or Drawing Issues / Remarks?</h3>
                      <div className="flex gap-4">
                        <RadioGroup 
                          value={hasClearanceIssues || ""} 
                          onValueChange={(val: "yes" | "no") => {
                              setHasClearanceIssues(val);
                              // We NO LONGER clear data immediately on "no".
                              // This allows the user to switch back to "yes" and see their data.
                              // Data cleansing happens during SAVE if state is "no".
                          }}
                          className="flex gap-6"
                          disabled={isBlockedByDraftOwnership}
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="yes" id="r-yes" />
                            <Label htmlFor="r-yes" className="text-base font-medium">Yes</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="no" id="r-no" />
                            <Label htmlFor="r-no" className="text-base font-medium">No</Label>
                          </div>
                        </RadioGroup>
                      </div>
                       {hasClearanceIssues === 'no' && (
                          <div className="mt-4 text-green-600 font-medium">
                            No issues to report. You can proceed With Save & Continue.
                          </div>
                      )}
                  </div>
                  
                {/* Gate content behind 'yes' selection */}
                {hasClearanceIssues === 'yes' && (
                  <>
                {/* Drawing Section - Orange Theme */}
                <div className="bg-white rounded-xl shadow-sm border border-orange-200 overflow-hidden">
                  {/* Header */}
                  <div className="bg-gradient-to-r from-orange-50 to-orange-100 px-4 py-3 border-b border-orange-200">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-orange-500 rounded-lg">
                        <FileText className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-orange-900">Drawing Issues</h3>
                        <p className="text-xs text-orange-700">Drawings, approvals & documentation</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Content */}
                  <div className="p-4 space-y-4">
                    {/* Add Remark Input */}
                    <div className="flex gap-2">
                      <Textarea
                        value={newDrawingRemark}
                        onChange={(e) => setNewDrawingRemark(e.target.value)}
                        placeholder="Describe the drawing-related issue..."
                        className="flex-1 min-h-[70px] text-sm resize-none border-orange-200 focus:border-orange-400 focus:ring-orange-400"
                        disabled={isBlockedByDraftOwnership}
                      />
                      <Button
                        className="flex-shrink-0 bg-orange-500 hover:bg-orange-600 text-white shadow-sm"
                        onClick={() => {
                          if (newDrawingRemark.trim()) {
                            setDrawingRemarksList(prev => [...prev, newDrawingRemark.trim()]);
                            setNewDrawingRemark("");
                            toast({ title: "Added! ✅", description: "Drawing remark added.", variant: "default" });
                          }
                        }}
                        disabled={isBlockedByDraftOwnership || !newDrawingRemark.trim()}
                      >
                        <PlusCircledIcon className="h-4 w-4 mr-1" /> Add
                      </Button>
                    </div>

                    {/* Remarks List */}
                    {drawingRemarksList.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                          Remarks ({drawingRemarksList.length})
                        </p>
                        <div className="space-y-2">
                          {drawingRemarksList.map((remark, index) => (
                            <div 
                              key={`drawing-${index}`}
                              className="flex items-start gap-3 p-3 bg-orange-50 rounded-lg border-l-4 border-orange-400"
                            >
                              <span className="flex-shrink-0 w-6 h-6 bg-orange-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                {index + 1}
                              </span>
                              <p className="flex-1 text-sm text-gray-700 break-words">{remark}</p>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 flex-shrink-0 text-orange-600 hover:text-orange-700 hover:bg-orange-100"
                                onClick={() => {
                                  setDrawingRemarksList(prev => prev.filter((_, i) => i !== index));
                                  toast({ title: "Removed", description: "Drawing remark removed.", variant: "default" });
                                }}
                                disabled={isBlockedByDraftOwnership}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-6 bg-orange-50/50 rounded-lg border border-dashed border-orange-200">
                        <FileText className="h-8 w-8 text-orange-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">No drawing issues reported</p>
                        <p className="text-xs text-gray-400">Add any drawing-related blockers above</p>
                      </div>
                    )}

                    {/* Drawing Photos */}
                    {drawingRemarksList.length > 0 && (
                     <div className="pt-3 border-t border-orange-100">
                      <div className="flex flex-col items-start gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          {/* <Camera className="h-4 w-4 text-orange-500" /> */}
                          {/* <h4 className="text-sm font-semibold text-gray-700">Drawing Photos</h4> */}
                          {localPhotos.filter(p => p.attach_type === 'Drawing').length > 0 && (
                            <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">
                              {localPhotos.filter(p => p.attach_type === 'Drawing').length}
                            </span>
                          )}
                        </div>
                        <div className="w-full">
                            <PhotoPermissionChecker
                            isBlockedByDraftOwnership={isBlockedByDraftOwnership}
                            onAddPhotosClick={() => {
                                setCurrentCaptureType('Drawing');
                                setIsCaptureDialogOpen(true);
                            }}
                            GEO_API={apiData?.api_key}
                            triggerLabel="Add Photo"
                            />
                        </div>
                      </div>
                      
                      {localPhotos.filter(p => p.attach_type === 'Drawing').length > 0 ? (
                        <ImageBentoGrid
                            images={localPhotos.filter(p => p.attach_type === 'Drawing').map(p => ({
                                image_link: p.image_link,
                                location: p.location || undefined,
                                remarks: p.remarks,
                                local_id: p.local_id
                            }))}
                            onRemove={handleRemovePhoto}
                            onRemarkChange={(id, val) => handlePhotoRemarksChange(id, val)}
                            isEditable={!isBlockedByDraftOwnership}
                            />
                      ) : (
                        <div className="text-center py-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                          <Camera className="h-6 w-6 text-gray-300 mx-auto mb-1" />
                          <p className="text-xs text-gray-400">No photos attached</p>
                        </div>
                      )}
                    </div>
                   )}
                  </div>
                </div>

                {/* Site Section - Red Theme */}
                <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
                  {/* Header */}
                  <div className="bg-gradient-to-r from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-red-500 rounded-lg">
                        <MapPin className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-red-900">Site Issues</h3>
                        <p className="text-xs text-red-700">Access, clearances & on-ground blockers</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Content */}
                  <div className="p-4 space-y-4">
                    {/* Add Remark Input */}
                    <div className="flex gap-2">
                      <Textarea
                        value={newSiteRemark}
                        onChange={(e) => setNewSiteRemark(e.target.value)}
                        placeholder="Describe the site-related issue..."
                        className="flex-1 min-h-[70px] text-sm resize-none border-red-200 focus:border-red-400 focus:ring-red-400"
                        disabled={isBlockedByDraftOwnership}
                      />
                      <Button
                        className="flex-shrink-0 bg-red-500 hover:bg-red-600 text-white shadow-sm"
                        onClick={() => {
                          if (newSiteRemark.trim()) {
                            setSiteRemarksList(prev => [...prev, newSiteRemark.trim()]);
                            setNewSiteRemark("");
                            toast({ title: "Added! ✅", description: "Site remark added.", variant: "default" });
                          }
                        }}
                        disabled={isBlockedByDraftOwnership || !newSiteRemark.trim()}
                      >
                        <PlusCircledIcon className="h-4 w-4 mr-1" /> Add
                      </Button>
                    </div>

                    {/* Remarks List */}
                    {siteRemarksList.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                          Remarks ({siteRemarksList.length})
                        </p>
                        <div className="space-y-2">
                          {siteRemarksList.map((remark, index) => (
                            <div 
                              key={`site-${index}`}
                              className="flex items-start gap-3 p-3 bg-red-50 rounded-lg border-l-4 border-red-400"
                            >
                              <span className="flex-shrink-0 w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                {index + 1}
                              </span>
                              <p className="flex-1 text-sm text-gray-700 break-words">{remark}</p>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 flex-shrink-0 text-red-600 hover:text-red-700 hover:bg-red-100"
                                onClick={() => {
                                  setSiteRemarksList(prev => prev.filter((_, i) => i !== index));
                                  toast({ title: "Removed", description: "Site remark removed.", variant: "default" });
                                }}
                                disabled={isBlockedByDraftOwnership}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-6 bg-red-50/50 rounded-lg border border-dashed border-red-200">
                        <MapPin className="h-8 w-8 text-red-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">No site issues reported</p>
                        <p className="text-xs text-gray-400">Add any site-related blockers above</p>
                      </div>
                    )}

                    {/* Site Photos */}
                    {siteRemarksList.length > 0 && (
                     <div className="pt-3 border-t border-red-100">
                      <div className="flex flex-col items-start gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          {/* <Camera className="h-4 w-4 text-red-500" /> */}
                          {/* <h4 className="text-sm font-semibold text-gray-700"> Photos</h4> */}
                          {localPhotos.filter(p => p.attach_type === 'Site').length > 0 && (
                            <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                              {localPhotos.filter(p => p.attach_type === 'Site').length}
                            </span>
                          )}
                        </div>
                        <div className="w-full">
                            <PhotoPermissionChecker
                            isBlockedByDraftOwnership={isBlockedByDraftOwnership}
                            onAddPhotosClick={() => {
                                setCurrentCaptureType('Site');
                                setIsCaptureDialogOpen(true);
                            }}
                            GEO_API={apiData?.api_key}
                            triggerLabel="Add Photo"
                            />
                        </div>
                      </div>

                    {localPhotos.filter(p => p.attach_type === 'Site').length > 0 ? (
                        <ImageBentoGrid
                            images={localPhotos.filter(p => p.attach_type === 'Site').map(p => ({
                                image_link: p.image_link,
                                location: p.location || undefined,
                                remarks: p.remarks,
                                local_id: p.local_id
                            }))}
                            onRemove={handleRemovePhoto}
                            onRemarkChange={(id, val) => handlePhotoRemarksChange(id, val)}
                            isEditable={!isBlockedByDraftOwnership}
                            />
                      ) : (
                        <div className="text-center py-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                          <Camera className="h-6 w-6 text-gray-300 mx-auto mb-1" />
                          <p className="text-xs text-gray-400">No photos attached</p>
                        </div>
                      )}
                    </div>
                   )}
                  </div>
                </div>
                  </>
                )}

              </div>
            </TabsContent>
            {/* --- END CLIENT / CLEARANCE ISSUES TAB --- */}
            
      <TabsContent value="Photos" className="mt-4 p-1">
      <Card className="border-none shadow-none bg-transparent">
        <CardHeader className="flex flex-col items-center pb-4 pt-0">
          {/* <Button
            className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-8 rounded-full shadow-md transition-all duration-200 ease-in-out transform hover:scale-105 "
            onClick={() => setIsCaptureDialogOpen(true)}
            disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
          >
          <PlusCircledIcon className="h-5 w-5 mr-2" />
              <span> ADD PHOTOS</span>
          </Button> */}
           <PhotoPermissionChecker
            isBlockedByDraftOwnership={isBlockedByDraftOwnership}
            onAddPhotosClick={() => {
                setCurrentCaptureType('Work');
                setIsCaptureDialogOpen(true);
            }}
            GEO_API={apiData?.api_key}
          />
        </CardHeader>
        <CardContent className="pt-0">
           {localPhotos.filter(p => !p.attach_type || p.attach_type === 'Work').length < 4 && (
             <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-md mb-4 text-sm font-medium border border-blue-200 w-full text-center">
               ℹ️ At least 4 photos are required for the final submission.
            </div>
           )}
          {localPhotos.filter(p => !p.attach_type || p.attach_type === 'Work').length > 0 ? (
             <ImageBentoGrid
              images={localPhotos.filter(p => !p.attach_type || p.attach_type === 'Work').map(p => ({
                image_link: p.image_link,
                location: p.location || undefined,
                remarks: p.remarks,
                local_id: p.local_id
              }))}
              isEditable={true}
              onRemove={handleRemovePhoto}
              onRemarkChange={handlePhotoRemarksChange}
              disabled={isBlockedByDraftOwnership}
              forPdf={false}
            />
          ) : (
            <div className="text-center py-12 px-4 bg-white rounded-lg shadow-md border border-dashed border-gray-300">
              
              <p className="text-lg text-gray-600 font-semibold mb-2">No photos captured yet!</p>
              <p className="text-gray-500 text-sm">Click the "ADD PHOTOS" button above to get started.</p>
            </div>
          )}
        </CardContent>
      </Card>
      
    </TabsContent>
{/* 
            {allAvailableTabs.map((tab) => (
              tab.project_work_header_name !== "Work force" && tab.project_work_header_name!=="Photos"? (
                <TabsContent key={tab.name || tab.project_work_header_name} value={tab.project_work_header_name} className="p-1">
                  <Card>
                    <CardHeader className="border-b">
                      <CardTitle >{tab.project_work_header_name} {currentTabMilestones.length}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {currentTabMilestones && currentTabMilestones.length > 0 ? (
                          <div className="">
                            {currentTabMilestones.map(milestone => (
                              <div key={milestone.name} className="py-2 border-b">
                                 <p className={`w-fit px-2 py-0.5 text-sm font-semibold rounded ${getStatusColor(milestone.status)}`}>
                                    {milestone.status}
                                </p>
                                <div className="flex justify-between items-center mb-2">
                                  <h4 className="font-bold text-lg">{milestone.work_milestone_name}</h4>
                                </div>
                                <p >
                                  <span className="font-semibold test-md">{milestone.progress}%</span> <span className="test-sm text-gray-600">completed</span>
                                </p>
                                 <div className="flex justify-between items-end w-full mt-2">
            
                                    {milestone?.status !== 'Not Applicable' && milestone.status!=="Completed" &&( 
                                        <div className="text-sm text-gray-600 flex flex-col items-start">
                                            <span>
                                                Expected date of {milestone.status === 'Not Started' ? 'Starting' : 'completion'}
                                            </span>
                                            
                                            <span className="font-semibold text-gray-800 flex items-center mt-0.5 border-2 border-gray-300 p-2 rounded-md">
                                                <CalendarIcon className="h-4 w-4 mr-1 text-gray-500" />
                                                {milestone.status === 'Not Started' ? (milestone.expected_starting_date || '--') : (milestone.expected_completion_date || '--')}
                                            </span>
                                        </div>)}
           
            
                                          <div className="flex-shrink-0 ml-auto">
                                            <Button 
                                                                  onClick={() => openUpdateMilestoneDialog(milestone)}
                                                                  variant={milestone.is_updated_for_current_report ? 'default' : 'secondary'}
                                                                  className={!milestone.is_updated_for_current_report && milestone.status !== 'Not Applicable' ? 'border-red-500 text-red-500 hover:bg-red-50' : ''}
                                                                  disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
                                                                >
                                                                  {milestone.is_updated_for_current_report ? 'EDITED' : 'UPDATE'}
                                                                </Button>
                                          </div>
                                 </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-gray-500">No milestones found for this section.</p>
                        )
                      }
                    </CardContent>
                  </Card>
                </TabsContent>


              ) : null
            ))} */}

{allAvailableTabs.map((tab) => {
              if (tab.project_work_header_name !== "Work force" && tab.project_work_header_name !== "Photos" && tab.project_work_header_name !== "Client / Clearance Issues") {
                // --- Start of new calculation for this specific tab ---
                // const dateString = formatDate(summaryWorkDate);
                // const storageKey = `project_${projectId}_date_${dateString}_tab_${tab.project_work_header_name}`;
                // const storedTabData = sessionStorage.getItem(storageKey);

                // let milestonesForThisTab: LocalMilestoneData[] = [];

                // if (storedTabData) {
                //   const parsedTabData: ProjectProgressReportData = JSON.parse(storedTabData);
                //   milestonesForThisTab = parsedTabData.milestones || [];
                // }

                // // If no local data or local data has no milestones, fallback to inherited
                // if (milestonesForThisTab.length === 0) {
                //     milestonesForThisTab = getInheritedMilestones(tab.project_work_header_name);
                // }

                const updatedMilestonesCount = currentTabMilestones.filter(m => m.is_updated_for_current_report).length;
                const totalMilestonesCount =  currentTabMilestones.length;
                // --- End of new calculation for this specific tab ---
                const colorCount=totalMilestonesCount==updatedMilestonesCount

                return (
                  <TabsContent key={tab.name || tab.project_work_header_name} value={tab.project_work_header_name} className="p-1">
                    <Card>
                      <CardHeader className="border-b">
                        <CardTitle >
                          {tab.project_work_header_name}
                        </CardTitle>
                        {/* NEW LINE: Displaying the updated milestones count */}
                        {totalMilestonesCount > 0 && ( // Only show this line if there are milestones to count
                          <p className={`text-sm ${colorCount?"text-green-500":"text-red-500"} mt-1`}>
                             {updatedMilestonesCount}/{totalMilestonesCount} milestones updated
                          </p>
                        )}
                      </CardHeader>
                      <CardContent>
                        {currentTabMilestones && currentTabMilestones.length > 0 ? (
                            <div className="">
                              {currentTabMilestones.map(milestone => (
                                <div key={milestone.name} className="py-2 border-b">
                                   <p className={`w-fit px-2 py-0.5 text-sm font-semibold rounded ${getStatusColor(milestone.status)}`}>
                                      {milestone.status}
                                  </p>
                                  <div className="flex justify-between items-center mb-2">
                                    <h4 className="font-bold text-lg">{milestone.work_milestone_name}</h4>
                                  </div>
                                  <p >
                                    <span className="font-semibold test-md">{milestone.progress}%</span> <span className="test-sm text-gray-600">completed</span>
                                  </p>
                                   <div className="flex flex-col w-full mt-2 gap-3">
                                    {/* Expected Date Row */}
                                    {milestone?.status !== 'Not Applicable' && milestone.status!=="Completed" &&( 
                                        <div className="text-sm text-gray-600 flex flex-col items-start">
                                            <span>
                                                Expected date of {milestone.status === 'Not Started' ? 'Starting' : 'completion'}
                                            </span>
                                            
                                            <span className="font-semibold text-gray-800 flex items-center mt-0.5 border-2 border-gray-300 p-2 rounded-md">
                                                <CalendarIcon className="h-4 w-4 mr-1 text-gray-500" />
                                                {milestone.status === 'Not Started' ? (milestone.expected_starting_date || '--') : (milestone.expected_completion_date || '--')}
                                            </span>
                                        </div>)}
                                        
                                    {/* Buttons Row */}
                                    <div className="flex items-center justify-end gap-2 w-full">
  {milestone.is_updated_for_current_report ? (
    // Button for 'EDIT' (when milestone is updated)
    <Button
      onClick={() => openUpdateMilestoneDialog(milestone)}
      className="bg-gray-200 text-gray-800 hover:bg-gray-300 flex items-center gap-1"
      disabled={isBlockedByDraftOwnership}
    >
      <CheckCircle className="h-4 w-4 text-green-700 mr-1" />
      EDIT
    </Button>
  ) : (
    // Buttons for 'UPDATE' and 'SAME AS BEFORE' (when milestone is not updated)
    <>
      <Button
        onClick={() => handleSaveAsIsClick(milestone)}
        variant="outline"
        className="bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300 text-sm px-4 py-2"
        disabled={isBlockedByDraftOwnership}
      >
        Same As Before
      </Button>
      <Button
        onClick={() => openUpdateMilestoneDialog(milestone)}
        className="bg-red-600 text-white border border-gray-300 hover:bg-red-700 text-sm px-4 py-2"
        disabled={isBlockedByDraftOwnership}
      >
        UPDATE
      </Button>
    </>
  )}
</div>
                                   </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-gray-500">No milestones found for this section.</p>
                          )
                        }
                      </CardContent>
                    </Card>
                  </TabsContent>
                );
              }
              return null;
            })}

          </Tabs>
        </div>
      </div>

      {/* <div className="sticky bottom-0 w-full p-2 bg-white border-t z-10">
        <Button
          className="w-full bg-red-600 hover:bg-red-700 text-white text-lg py-3"
          onClick={() => handleSyncAndSubmitAllData(false)}
          disabled={isGlobalSyncDisabled} // MODIFIED: Uses combined disabled state
        >
          {isGlobalSyncDisabled && isFrappeOperationLoading ? ( // Only show spinner if actually loading
            <TailSpin height={20} width={20} color="#fff" />
          ) : isLastTab ? (
            "Submit Final Report"
          ) : (
            `Save & Continue to Next Tab`
          )}
        </Button>
        <div className="text-center mt-2 text-sm text-gray-500">
          Tab {currentIndex + 1} of {allAvailableTabs.length}
        </div>
      </div> */}
      <div className="sticky bottom-0 w-full p-2 bg-white border-t z-10">
        <div className="flex items-center gap-4"> {/* Flex container for both buttons */}
          {currentIndex > 0 && ( // Show 'Back' button only if not on the first tab
            <Button
             variant="outline"
              className="flex-1 text-red-600 border-red-600  text-lg py-3 "
              onClick={() => moveToPreviousTab()}
              disabled={isGlobalSyncDisabled}
            >
              Back
            </Button>
          )}

          <Button
            // Use flex-1 to make it take available space.
            // If 'Back' is present, they share. If not, it expands.
            className="flex-1 bg-red-600 hover:bg-red-700 text-white text-lg py-3"
            onClick={() => handleSyncAndSubmitAllData(false)}
            disabled={isGlobalSyncDisabled || (activeTabValue === "Client / Clearance Issues" && hasClearanceIssues === null)}
          >
            {isGlobalSyncDisabled && isFrappeOperationLoading ? (
              <TailSpin height={20} width={20} color="#fff" />
            ) : isLastTab ? (
              "Submit Final Report"
            ) : (
              `Save & Continue` // Simplified text
            )}
          </Button>
        </div>
        {/* Removed the old Tab X of X display as it's now in the header */}
      </div>

      <Dialog open={isUpdateManpowerDialogOpen} onOpenChange={setIsUpdateManpowerDialogOpen}>
        <DialogContent className="max-w-[425px] max-h-[70vh] overflow-y-auto lg:max-w-[425px] lg:max-h-[90vh] lg:overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl text-center font-bold text-red-600">Update Manpower</DialogTitle>
            <DialogDescription className="text-sm text-center">
              Edit manpower counts, add new roles, and provide remarks for the selected date.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex justify-between items-center text-sm font-medium">
              <span>Project: <span className="text-red-600">{projectData?.project_name || "Not Applicable"}</span></span>
              <div className="flex items-center gap-2">
              </div>
            </div>

            <div className="space-y-3">
              {dialogManpowerRoles.map((manpowerItem, index) => (
                <div key={manpowerItem.id || index} className="flex items-center gap-2">
                  {manpowerItem.id?.startsWith('new_role_') ? (
                    <>
                    {![
  "MEP Engineer",
  "Safety Engineer",
  "Electrical Team",
  "Fire Fighting Team",
  "Data & Networking Team",
  "HVAC Team",
  "ELV Team",
].includes(manpowerItem.label) && (
      <Button
        variant="destructive"
        className="h-8 w-8 p-0"
        onClick={() => handleRemoveManpowerRole(index)}
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Remove Role</span>
      </Button>
    )}
    <Input
                      type="text"
                      value={manpowerItem.label}
                      onChange={(e) => handleDialogRoleNameChange(index, e.target.value)}
                      className="flex-1 text-sm"
                      placeholder="Enter role name"
                      disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
                    />
                    </>
                    
                  ) : (
                    <label className="flex-1 text-sm">{manpowerItem.label}</label>
                  )}
                  
                  <Input
                    type="number"
                    value={manpowerItem.count.toString()}
                    onChange={(e) => handleDialogManpowerCountChange(index, e.target.value)}
                    className="w-20 text-center"
                    disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
                  />
                  
                </div>
                
              ))}
            </div>

            <Button
              variant="outline"
              className="w-full flex items-center gap-2 text-red-600 border-red-600"
              onClick={handleAddManpowerRole}
              disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
            >
              <PlusCircledIcon className="h-4 w-4" /> Add Manpower
            </Button>

            <div>
              <label htmlFor="dialog-remarks" className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
              <Textarea
                id="dialog-remarks"
                value={dialogRemarks}
                onChange={(e) => setDialogRemarks(e.target.value)}
                placeholder="Enter Remarks"
                className="min-h-[80px]"
                disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => handleSyncAndSubmitAllData(true)}
              disabled={isGlobalSyncDisabled} // MODIFIED: Uses combined disabled state
            >
              {isGlobalSyncDisabled && isFrappeOperationLoading ? <TailSpin height={20} width={20} color="#fff" /> : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>


    <Dialog open={isUpdateMilestoneDialogOpen} onOpenChange={setIsUpdateMilestoneDialogOpen}>
 
    <DialogContent className="max-w-[425px] max-h-[70vh] overflow-y-auto lg:max-w-[425px] lg:max-h-[70vh] lg:overflow-y-auto">
        
        <DialogHeader className="p-2 pb-4 border-b">
            <div className="flex justify-center items-center">
                <DialogTitle className="text-xl font-bold text-red-600">
                    {/* {selectedMilestoneForDialog?.work_milestone_name || "Milestones Update"} */}
                    {"Milestones Update"}
                </DialogTitle>
                
            </div>
            
            <div className="flex justify-between text-sm font-medium mt-2">
                <div className="text-left">
                    <p className="font-semibold">Work</p>
                    <p className="text-sm text-gray-700">{selectedMilestoneForDialog?.work_milestone_name || 'Sprinklers'}</p>
                </div>
                <div className="text-right">
                    <p className="font-semibold">Package</p>
                    <p className="text-sm text-gray-700">{activeTabValue || 'Ducting'}</p> 
                </div>
            </div>
        </DialogHeader>
        
        <div className="space-y-2 py-4 px-6">
            
            <div className="flex justify-between items-center text-sm font-medium">
                <div className="flex flex-col items-start">
                    <span className="text-gray-900">Pervious Status</span>
                    <span className="px-2 py-1 rounded-full text-xs font-semibold bg-red-500 text-white mt-1">
                        {selectedMilestoneForDialog?.status || 'Not Applicable'}
                    </span>
                </div>
                
                <div className="flex flex-col items-end">
                    <span className="text-red-600 font-semibold text-lg">{selectedMilestoneForDialog?.progress || '0%'}</span>
                    <span className="text-gray-700 text-sm">% Completed</span>
                </div>
                
            </div>
            
            <hr className="border-gray-200" />
            
            <div className="flex flex-col">
                <label className="block text-base font-semibold text-gray-900 mb-2">Select New Status</label>
                <div className="grid grid-cols-2 gap-3">
                  <Button 
                        className={`py-3 text-sm font-semibold ${newStatus === 'Not Applicable' ? 'bg-gray-700 text-white hover:bg-gray-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                        onClick={() => setNewStatus('Not Applicable')}
                        disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
                    >
                        Not Applicable
                    </Button>

                    <Button 
                        className={`py-3 text-sm font-semibold ${newStatus === 'Not Started' ? 'bg-red-700 text-white hover:bg-red-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                        onClick={() => setNewStatus('Not Started')}
                        disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
                    >
                        Not Started
                    </Button>

                    
                    <Button 
                        className={`py-3 text-sm font-semibold ${newStatus === 'WIP' ? 'bg-yellow-400 text-gray-900 hover:bg-yellow-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                        onClick={() => setNewStatus('WIP')}
                        disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
                    >
                        WIP
                    </Button>
                     
                    <Button 
                        className={`py-3 text-sm font-semibold ${newStatus === 'Completed' ? 'bg-green-400 text-white hover:bg-green-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                        onClick={() => setNewStatus('Completed')}
                        disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
                    >
                        Completed
                    </Button>
                </div>
            </div>

            {(newStatus === 'WIP') && (
                <div>
                    <label className="block text-base font-semibold text-gray-900 mb-1">Percentage Completed</label>
                    <div className="relative">
                        <Input
                            type="number"
                            value={progress||null}
                            onChange={(e) => setProgress(Math.max(0, Math.min(99, Number(e.target.value))))}
                            min={0}
                            max={100}
                            className="pr-8 h-10 text-base"
                            disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                    </div>
                </div>
            )}
            
            {/* {(newStatus == 'Not Started' || newStatus == 'WIP')&&(
  <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected {newStatus === 'Not Started' ? 'Starting' : 'Completion'} Date
                </label>
                <Popover open={isMilestoneDatePickerOpen} onOpenChange={setIsMilestoneDatePickerOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant={"outline"}
                            className={"w-full justify-start text-left font-normal h-10 text-base border-gray-300"}
                            disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
                        >
                            <CalendarIcon className="mr-2 h-4 w-4 text-gray-500" />
                            {expectedDate ? formatDate(expectedDate) : ""}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                        <Calendar
                            mode="single"
                            selected={expectedDate || undefined}
                            onSelect={(date) => {
                                setExpectedDate(date || null);
                                setIsMilestoneDatePickerOpen(false);
                            }}
                            initialFocus
                            disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        />
                    </PopoverContent>
                </Popover>
            </div>

            )} */}

            {/* Conditional Date Picker for 'Not Started' */}
            {newStatus === 'Not Started' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected Starting Date
                </label>
                <Popover open={isMilestoneDatePickerOpen} onOpenChange={setIsMilestoneDatePickerOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant={"outline"}
                            className={`w-full justify-start text-left font-normal h-10 text-base border-gray-300 ${highlightInvalidDate ? "ring-2 ring-red-500 border-red-500 bg-red-50 text-red-900" : ""}`}
                            disabled={isBlockedByDraftOwnership}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4 text-gray-500" />
                            {expectedDate ? formatDate(expectedDate) : "Select starting date"}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                        <Calendar
                            mode="single"
                            selected={expectedDate || undefined}
                            onSelect={(date) => {
                                setExpectedDate(date || null);
                                setHighlightInvalidDate(false); // Clear error
                                setIsMilestoneDatePickerOpen(false);
                            }}
                            initialFocus
                            disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        />
                    </PopoverContent>
                </Popover>
              </div>
            )}

            {/* Conditional Date Picker for 'WIP' */}
            {(newStatus === 'WIP' && progress>75) && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected Completion Date
                </label>
                <Popover open={isMilestoneDatePickerOpen} onOpenChange={setIsMilestoneDatePickerOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant={"outline"}
                            className={`w-full justify-start text-left font-normal h-10 text-base border-gray-300 ${highlightInvalidDate ? "ring-2 ring-red-500 border-red-500 bg-red-50 text-red-900" : ""}`}
                            disabled={isBlockedByDraftOwnership}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4 text-gray-500" />
                            {expectedDate ? formatDate(expectedDate) : "Select completion date"}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                        <Calendar
                            mode="single"
                            selected={expectedDate || undefined}
                            onSelect={(date) => {
                                setExpectedDate(date || null);
                                setHighlightInvalidDate(false); // Clear error
                                setIsMilestoneDatePickerOpen(false);
                            }}
                            initialFocus
                            disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        />
                    </PopoverContent>
                </Popover>
              </div>
            )}
          
          
           {
            (newStatus === 'WIP' ||newStatus === 'Not Started') && (
<>
  {/* --- NEW SECTION: Work Plan Ratio Toggle --- */}
    <div className="flex flex-col">
        <label className="block text-base font-semibold text-gray-900 mb-2">Activities Planned for Today </label>
        <div className="grid grid-cols-2 gap-3">
            {/* <Button 
                className={`py-3 text-sm font-semibold ${workPlanRatio === 'Plan Not Required' ? 'bg-gray-700 text-white hover:bg-gray-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                onClick={() => {
                    setWorkPlanRatio('Plan Not Required');
                    // Optionally clear points when plan is not required
                    setWorkPlanPoints([""]); 
                }}
                disabled={isBlockedByDraftOwnership}
            >
                Nothing
            </Button>
            <Button 
                className={`py-3 text-sm font-semibold ${workPlanRatio === 'Plan Required' ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                onClick={() => setWorkPlanRatio('Plan Required')}
                disabled={isBlockedByDraftOwnership}
            >
                Record Activities 
            </Button> */}
            <Button 
            className={`py-3 text-sm font-semibold flex items-center justify-center 
                ${workPlanRatio === 'Plan Not Required' 
                    ? 'bg-gray-700 text-white hover:bg-gray-500' 
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            onClick={() => {
                setWorkPlanRatio('Plan Not Required');
                // Optionally clear points when plan is not required
                setWorkPlanPoints([""]); 
            }}
            disabled={isBlockedByDraftOwnership}
        >
            <RadioIndicator 
                isActive={workPlanRatio === 'Plan Not Required'} 
                isDisabled={isBlockedByDraftOwnership} 
            />
            Nothing
        </Button>
        
        {/* Button 2: Plan Required (Record Activities) */}
        <Button 
            className={`py-3 text-sm font-semibold flex items-center justify-center 
                ${workPlanRatio === 'Plan Required' 
                    ? 'bg-blue-600 text-white hover:bg-blue-500' 
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            onClick={() => setWorkPlanRatio('Plan Required')}
            disabled={isBlockedByDraftOwnership}
        >
            <RadioIndicator 
                isActive={workPlanRatio === 'Plan Required'} 
                isDisabled={isBlockedByDraftOwnership} 
            />
            Record Activities 
        </Button>
        </div>
    </div>
    {/* --- END NEW SECTION --- */}
     {workPlanRatio === 'Plan Required' && (
        <div className="space-y-3 p-2 border border-blue-200 rounded-lg bg-blue-50">
            <label className="block text-base font-semibold text-gray-900 mb-1 flex items-center justify-between">
                <span>Activity Details</span><span className='text-xs font-normal text-gray-600 ml-2'> <Button
                variant="outline"
                className="w-full flex items-center gap-2 text-blue-600 border-blue-600"
                onClick={() => setWorkPlanPoints(prev => [...prev, ""])}
                disabled={isBlockedByDraftOwnership}
            >
                <PlusCircledIcon className="h-4 w-4" /> New Point
            </Button></span>
            </label>
            <div className="space-y-2">
                {workPlanPoints.map((point, index) => (
                    <div key={index} className="flex items-start gap-2">
                        {workPlanPoints.length > 1 && (
                            <Button
                                variant="destructive"
                                size="icon"
                                className="h-7 w-7 p-0 flex-shrink-0 mt-0.5"
                                onClick={() => setWorkPlanPoints(prev => prev.filter((_, i) => i !== index))}
                                disabled={isBlockedByDraftOwnership}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                        <Textarea
                            value={point}
                            onChange={(e) => {
                                const newPoints = [...workPlanPoints];
                                newPoints[index] = e.target.value;
                                setWorkPlanPoints(newPoints);
                            }}
                            placeholder={`Point ${index + 1}...`}
                            className="flex-grow min-h-[40px] text-sm"
                            rows={1}
                            disabled={isBlockedByDraftOwnership}
                        />
                    </div>
                ))}
            </div>
            {/* <Button
                variant="outline"
                className="w-full flex items-center gap-2 text-blue-600 border-blue-600"
                onClick={() => setWorkPlanPoints(prev => [...prev, ""])}
                disabled={isBlockedByDraftOwnership}
            >
                <PlusCircledIcon className="h-4 w-4" /> Add New Point
            </Button> */}
        </div>
    )}
    {/* --- END NEW SECTION --- */}
</>
            )
           }
          


   
            <div>
                <label className="block text-base font-semibold text-gray-900 mb-1">Remarks</label>
                <Textarea
                    value={milestoneRemarks}
                    onChange={(e) => setMilestoneRemarks(e.target.value)}
                    placeholder="Enter Remarks"
                    className="min-h-[100px] text-base"
                    disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
                />
            </div>
        </div>
        
        <div className="flex justify-between gap-4 p-4">
            <Button 
                variant="outline" 
                className="w-full border-red-500 text-red-500 hover:bg-red-50 border-2 text-base h-12"
                onClick={handleUpdateMilestone}
                disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
            >
                Save as it is
            </Button>
            <Button 
                className="w-full bg-red-600 hover:bg-red-700 text-white text-base h-12"
                onClick={handleUpdateMilestone}
                disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
            >
                Update
            </Button>
        </div>
    </DialogContent>
</Dialog>

{/* --- SAVE AS-IS CONFIRMATION DIALOG --- */}
<Dialog open={isSaveAsIsConfirmOpen} onOpenChange={setIsSaveAsIsConfirmOpen}>
  <DialogContent className="max-w-[350px]">
    <DialogHeader>
      <DialogTitle className="text-lg font-bold text-gray-900">Confirm Save As-Is</DialogTitle>
      <DialogDescription className="text-sm text-gray-600">
        This milestone ({milestoneForSaveAsIs?.work_milestone_name}) is marked as <span className="font-semibold">{milestoneForSaveAsIs?.status}</span>.
      </DialogDescription>
    </DialogHeader>
    <div className="py-4">
      <p className="text-sm text-gray-700">
        Are you sure you want to save this milestone <span className="font-semibold">without recording any activities planned for today</span>?
      </p>
    </div>
    <div className="flex justify-end gap-3">
      <Button
        variant="outline"
        onClick={handleCancelSaveAsIs}
        className="border-gray-300"
      >
        Cancel
      </Button>
      <Button
        onClick={handleConfirmSaveAsIs}
        className="bg-red-600 hover:bg-red-700 text-white"
      >
        Yes, Save As-Is
      </Button>
    </div>
  </DialogContent>
</Dialog>
{/* --- END SAVE AS-IS CONFIRMATION DIALOG --- */}

        <Dialog open={isCaptureDialogOpen} onOpenChange={setIsCaptureDialogOpen}>
    <DialogContent className=" max-w-[70vh] max-w-[600px] lg:max-w-[90vw] lg:max-w-[600px] p-0 border-none bg-transparent">
               <DialogClose className="absolute right-4 top-4 h-8 w-8 rounded-full flex items-center justify-center bg-white/10 text-white transition-colors duration-200 hover:bg-white/20 focus:outline-none  z-30">
            <X className="h-5 w-5" /> {/* Smaller X for better fit in 8x8 circle */}
            <span className="sr-only">Close</span>
        </DialogClose>

        <DialogHeader className="sr-only">
            <DialogTitle>Project Photo Capture</DialogTitle>
            <DialogDescription>Use the camera to capture a new site image and add remarks.</DialogDescription>
        </DialogHeader>
        <CameraCapture
            project_id={projectId}
            report_date={formatDate(summaryWorkDate)}
            onCaptureSuccess={handlePhotoCaptureSuccess}
            onCancel={() => setIsCaptureDialogOpen(false)}
            GEO_API={apiData?.api_key}
            disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
        />
    </DialogContent>
</Dialog>

    </div>
  );
};

// Wrap the component with Error Boundary
export const MilestoneTab = () => {
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <ProgressReportErrorBoundary projectId={projectId}>
      <MilestoneTabInner />
    </ProgressReportErrorBoundary>
  );
};


// // MilestoneTab.tsx
// import { useContext, useEffect, useRef, useState } from "react";
// import { useParams, useNavigate,useLocation } from "react-router-dom";
// import { UserContext } from "@/utils/auth/UserProvider";
// import {
//   useFrappeGetDoc,
//   useFrappeGetDocList,
//   useFrappeCreateDoc,
//   useFrappeUpdateDoc,
//   useFrappeDeleteDoc, // ADD THIS
// } from "frappe-react-sdk";
// import CameraCapture from "@/components/CameraCapture";
// import {Camera, X, MapPin,CheckCircle } from "lucide-react"

// import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Button } from "@/components/ui/button";
// import { CalendarIcon, PlusCircledIcon } from "@radix-ui/react-icons";
// import { TailSpin } from "react-loader-spinner";
// import { Input } from "@/components/ui/input";
// import { Textarea } from "@/components/ui/textarea";
// import { toast } from "@/components/ui/use-toast";
// import { formatDate,formatToLocalDateTimeString } from "@/utils/FormatDate";
// import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
// import { Calendar } from "@/components/ui/calendar";
// import {
//   Dialog,
//   DialogContent,
//   DialogHeader,
//   DialogTitle,
//   DialogDescription,
//   DialogClose,
//   DialogPrimitive
// } from "@/components/ui/dialog";
// import PhotoPermissionChecker from "./components/PhotoPermissionChecker"
// import {
//   addWorkflowBreadcrumb,
//   captureWorkflowError,
//   isNetworkError,
//   startWorkflowTransaction,
// } from '@/utils/sentry';
// import { ProgressReportErrorBoundary } from '@/components/error-boundaries/ProgressReportErrorBoundary';

// // --- START: Refined Interfaces based on your Frappe DocType ---

// interface ManpowerRole {
//   id: string;
//   label: string; // Used for frontend state and display
//   count: number;
// }

// interface ProjectWorkHeaderChildEntry {
//   name: string;
//   idx: number;
//   project_work_header_name: string;
//   enabled: string;
// }

// interface ProjectProgressAttachment {
//   name?: string; // Frappe document name for the row
//   local_id: string; // Temporary ID for local state management (FRONTEND ONLY)
//   image_link: string; // The uploaded file_url (MATCHES Frappe field)
//   location: string | null; // The combined location string (MATCHES Frappe field)
//   remarks: string; // General remarks for the photo (MATCHES Frappe field)
// }

// interface ProjectData {
//   project_name: string;
//   customer?: string;
//   project_type?: string;
//   project_value?: string;
//   project_value_gst?: string;
//   project_gst_number?: string;
//   project_start_date?: string;
//   project_end_date?: string;
//   project_address?: string;
//   project_city?: string;
//   project_state?: string;
//   project_employees_section?: any;
//   project_lead?: string;
//   procurement_lead?: string;
//   design_lead?: string;
//   project_manager?: string;
//   estimates_exec?: string;
//   accountant?: string;
//   status?: string;
//   project_scopes?: string;
//   subdivisions?: string;
//   subdivision_list?: string;
//   project_wp_category_makes?: any[];
//   enable_project_milestone_tracking: 0 | 1;
//   project_work_header_entries?: ProjectWorkHeaderChildEntry[];
// }

// interface FrappeManpowerDetail {
//   label: string; // Corrected: This MUST match the backend field name
//   count: number;
// }

// interface LocalMilestoneData {
//   name: string;
//   work_milestone_name: string;
//   work_header: string;
//   status: 'Not Started' | 'WIP' | 'Not Applicable' | 'Completed';
//   progress: number;
//   expected_starting_date?: string;
//   expected_completion_date?: string;
//   remarks?: string;
//   is_updated_for_current_report?: boolean; // New field for frontend validation
//    // --- NEW FIELD ---
//   work_plan?: string; // Stored as long text with $#,,, delimiter
//   work_plan_ratio?: 'Plan Not Required' | 'Plan Required'; // NEW: To manage the visibility/requirement of work_plan input
// }

// // Define the exact structure Frappe expects for a milestone child table entry when submitting a parent doc
// interface FrappeMilestoneChildPayload {
//   name?: string; // Only present if updating an existing child row; omit for new rows.
//   work_milestone_name: string;
//   work_header: string;
//   status: 'Not Started' | 'WIP' | 'Not Applicable' | 'Completed';
//   progress: number;
//   expected_starting_date?: string;
//   expected_completion_date?: string;
//   remarks?: string;
//   work_plan?: string; 
//   // NO other Frappe system fields like docstatus, parent, doctype, etc.
// }

// interface ProjectProgressReportData {
//   name?: string; // To store the Frappe document name if it exists locally
//   project: string;
//   report_date: string;
//   manpower_remarks?: string;
//   manpower?: FrappeManpowerDetail[];
//   milestones?: LocalMilestoneData[];
//   photos?: ProjectProgressAttachment[];
//   report_status?: 'Draft' | 'Completed';
//   report_zone?: string; // <-- NEW FIELD
//   draft_owner?: string; // ADDED
//   draft_last_updated?: string; // ADDED
// }

// interface FrappeProjectProgressReportPayload {
//   project: string;
//   report_date: string;
//   manpower_remarks?: string;
//   manpower?: FrappeManpowerDetail[];
//   milestones?: FrappeMilestoneChildPayload[]; // Now uses the cleaned payload type
//   attachments?: Omit<ProjectProgressAttachment, 'local_id'>[];
//   report_status: 'Draft' | 'Completed';
//   report_zone?: string; // <-- NEW FIELD
//   draft_owner?: string; // ADDED
//   draft_last_updated?: string; // ADDED
// }

// interface WorkMilestoneFromFrappe {
//   name: string;
//   work_milestone_name: string;
//   status: 'Not Started' | 'WIP' | 'Not Applicable' | 'Completed';
//   progress: number;
//   expected_starting_date: string;
//   expected_completion_date: string;
//   work_header: string;
//     work_plan?: string; 
// }

// interface FullPreviousProjectProgressReport extends ProjectProgressReportData {
//   name: string;
//   report_status?: 'Draft' | 'Completed';
//   draft_owner?: string; // ADDED
//   draft_last_updated?: string; // ADDED
// }
// // --- END: Refined Interfaces ---
// // Place these near the top of MilestoneTabInner or outside if preferred

// export const DELIMITER = "$#,,,"; // Custom delimiter for work plan points

// export const parseWorkPlan = (workPlanString?: string | null): string[] => {
//   if (!workPlanString || typeof workPlanString !== 'string' || workPlanString.trim() === '') {
//     return [""]; // Start with an empty point
//   }
//   // Split the string and filter out empty strings resulting from trailing/leading delimiters
//   return workPlanString.split(DELIMITER).filter(p => p.trim() !== '');
// };

// export const serializeWorkPlan = (workPlanPoints: string[]): string => {
//   // Filter out empty lines before joining
//   return workPlanPoints.filter(p => p.trim() !== '').join(DELIMITER);
// };

// // Helper component for the radio circle indicator
// const RadioIndicator: React.FC<{ isActive: boolean, isDisabled: boolean }> = ({ isActive, isDisabled }) => (
//     <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center mr-2 transition-colors duration-150 flex-shrink-0
//         ${isDisabled 
//             ? 'border-gray-400 bg-gray-200' 
//             : isActive 
//                 ? 'border-white bg-white' // Active: White fill for the inner circle
//                 : 'border-gray-500 bg-transparent' // Inactive: Transparent fill
//         }`}
//     >
//         {/* Inner dot for the active state */}
//         {isActive && !isDisabled && (
//             <div className="w-2 h-2 rounded-full bg-blue-600" /> // Use blue for active dot color
//         )}
//         {/* If you wanted a checkmark for the active state instead of a dot, you'd use: 
//         {isActive && !isDisabled && <Check className="w-3 h-3 text-blue-600" />} */}
//     </div>
// );




// const MilestoneTabInner = () => {
//   const { projectId } = useParams<{ projectId: string }>();
//   const { selectedProject, setSelectedProject, currentUser:user } = useContext(UserContext); // MODIFIED: Destructured `user`
//   const navigate = useNavigate();
//   const {
//     data: apiData,
//     isLoading: apiDataLoading,
//     isError:isMapError
//   } = useFrappeGetDoc("Map API", {
//     fields: ["*"],
//   });
//   const location = useLocation(); // <-- NEW: Hook to get location object

//   // Function to get query parameters
//   const useQuery = () => {
//     return new URLSearchParams(location.search);
//   };
//   const query = useQuery();
//   const initialZone = query.get("zone"); // <-- NEW: Get the 'zone' parameter

//   // Use a state/variable for the current report's zone
//   // Since this is read-only for the MilestoneTab flow, a simple variable is fine
//   const reportZone = initialZone; // <-- NEW

//  const zoneKey = reportZone; // Use the zone in the key
//   const [activeTabValue, setActiveTabValue] = useState("Work force");
//   const [summaryWorkDate, setSummaryWorkDate] = useState<Date>(new Date());

//   const [isCaptureDialogOpen, setIsCaptureDialogOpen] = useState(false);
//   const [localPhotos, setLocalPhotos] = useState<ProjectProgressAttachment[]>([]);
//   const getPhotosStorageKey = (dateString: string) => `project_${projectId}_date_${dateString}_zone_${reportZone}_tab_Photos`;


//   const {
//     data: projectData,
//     isLoading: projectLoading,
//     error: projectError,
//   } = useFrappeGetDoc<ProjectData>("Projects", projectId, projectId ? undefined : null);

//   const {
//     data: allFrappeMilestones,
//     isLoading: frappeMilestonesLoading,
//     error: frappeMilestonesError,
//   } = useFrappeGetDocList<WorkMilestoneFromFrappe>("Work Milestones", {
//     fields: ["*"],
//     limit:0,
//     enabled: !!projectId,
//   });

//   // This hook now specifically fetches the LATEST *COMPLETED* report for the project.
//   const {
//     data: latestCompletedReportsList,
//     isLoading: latestCompletedReportsListLoading,
//     error: latestCompletedReportsListError,
//   } = useFrappeGetDocList<{ name: string, project: string, report_date: string, report_status: 'Draft' | 'Completed' }>("Project Progress Reports", {
//     fields: ["name", "project", "report_date", "report_status",'report_zone'],
//     filters: [
//       ["project", "=", projectId],
//       ["report_status", "=", "Completed"],
//       ["report_zone","=",reportZone]
//     ],
//     orderBy: { field: "report_date", order: "desc" },
//     limit: 1,
//     enabled: !!projectId,
//   });

//   const latestCompletedReportName = latestCompletedReportsList?.[0]?.name;
//   console.log("latestCompletedReportName",latestCompletedReportName)

//   const todayFormatted = formatDate(new Date());

// // Check if the latest completed report date matches today's date
// const latestCompletedReportDateIsToday = 
//   !latestCompletedReportsListLoading && // Ensure data is loaded
//   latestCompletedReportsList && 
//   latestCompletedReportsList.length > 0 && 
//   formatDate(latestCompletedReportsList?.[0].report_date) == todayFormatted;


//   console.log("todayFormatted",todayFormatted,formatDate(latestCompletedReportsList?.[0]?.report_date),latestCompletedReportDateIsToday)

//   // This hook now fetches the full details of the LATEST *COMPLETED* report.
//   const {
//     data: lastCompletedReport,
//     isLoading: lastCompletedReportLoading,
//     error: lastCompletedReportError,
//   } = useFrappeGetDoc<FullPreviousProjectProgressReport>(
//     "Project Progress Reports",
//     latestCompletedReportName,
//     latestCompletedReportName ? undefined : null
//   );

//   // This hook correctly finds a draft for the *current* date.
//   const {
//     data: existingDraftReport,
//     isLoading: existingDraftReportLoading,
//     error: existingDraftReportError,
//     mutate: refetchExistingDraftReport,
//   } = useFrappeGetDocList<ProjectProgressReportData>("Project Progress Reports", {
//     // MODIFIED: Added `draft_owner` and `draft_last_updated`
//     fields: ["name", "report_date", "report_status", "manpower_remarks","draft_owner", "draft_last_updated","report_zone"],
//     filters: [
//       ["project", "=", projectId],
//       ["report_date", "=", formatDate(summaryWorkDate)],
//       ["report_status", "=", "Draft"],
//       ["report_zone",'=',reportZone]
//     ],
//     limit: 1,
//     enabled: !!projectId && !!summaryWorkDate,
//   });

//   const { createDoc, isLoading: isCreatingDoc } = useFrappeCreateDoc();
//   const { updateDoc, isLoading: isUpdatingDoc } = useFrappeUpdateDoc();
//    const { deleteDoc, isLoading: isDeletingDoc } = useFrappeDeleteDoc(); // ADD THIS

//   const [currentFrappeReportName, setCurrentFrappeReportName] = useState<string | null>(null);

//   const isFrappeOperationLoading = isCreatingDoc || isUpdatingDoc;

//   // --- STATE FOR DRAFT OWNERSHIP CHECK ---
//   const [isBlockedByDraftOwnership, setIsBlockedByDraftOwnership] = useState(false);
//   const [blockingDraftOwnerEmail, setBlockingDraftOwnerEmail] = useState<string | null>(null);
//   const [timeRemainingToUnlock, setTimeRemainingToUnlock] = useState<number | null>(null); // In minutes
//   const [draftMessage,SetDraftMessage]=useState<string | null>(null);

//   // --- STATE FOR MANPOWER TAB ---
//   const [dialogManpowerRoles, setDialogManpowerRoles] = useState<ManpowerRole[]>([]);
//   const [dialogRemarks, setDialogRemarks] = useState<string>("");
//   const [dialogWorkDate, setDialogWorkDate] = useState<Date>(new Date());
//   const [isDialogDatePickerOpen, setIsDialogDatePickerOpen] = useState(false);
//   const [isUpdateManpowerDialogOpen, setIsUpdateManpowerDialogOpen] = useState(false);
//   const [isLocalSaving, setIsLocalSaving] = useState(false);
//   const [summaryManpowerRoles, setSummaryManpowerRoles] = useState<ManpowerRole[]>([]);
//   const [reportsLoading, setReportsLoading] = useState(false);
//   const [localDailyReport, setLocalDailyReport] = useState<ProjectProgressReportData | null>(null);

//   // --- STATE FOR MILESTONE DIALOG AND LOCAL MANAGEMENT ---
//   const [isUpdateMilestoneDialogOpen, setIsUpdateMilestoneDialogOpen] = useState(false);
//   const [selectedMilestoneForDialog, setSelectedMilestoneForDialog] = useState<LocalMilestoneData | null>(null);
//   const [newStatus, setNewStatus] = useState<'Not Started' | 'WIP' | 'Not Applicable' | 'Completed' | ''>('');
//   const [progress, setProgress] = useState<number>(0);
//   const [expectedDate, setExpectedDate] = useState<Date | null>(null);
//   const [isMilestoneDatePickerOpen, setIsMilestoneDatePickerOpen] = useState(false);
//   const [milestoneRemarks, setMilestoneRemarks] = useState('');

//   // --- NEW STATES FOR WORK PLAN ---
// const [workPlanRatio, setWorkPlanRatio] = useState<'Plan Not Required' | 'Plan Required'>('Plan Not Required');
// const [workPlanPoints, setWorkPlanPoints] = useState<string[]>([]); // Array of points for the text area
// //

//   const [currentTabMilestones, setCurrentTabMilestones] = useState<LocalMilestoneData[]>([]);

//   const fullManpowerDetails: ManpowerRole[] = [
//     { id: "mep_engineer", label: "MEP Engineer", count: 0 },
//     { id: "safety_engineer", label: "Safety Engineer", count: 0 },
//     { id: "electrical_team", label: "Electrical Team", count: 0 },
//     { id: "fire_fighting_team", label: "Fire Fighting Team", count: 0 },
//     { id: "data_networking_team", label: "Data & Networking Team", count: 0 },
//     { id: "hvac_team", label: "HVAC Team", count: 0 },
//     { id: "elv_team", label: "ELV Team", count: 0 },
//   ];

//   const getManpowerRolesDefault = (): ManpowerRole[] => {
//     return fullManpowerDetails.map(item => ({ ...item }));
//   };

//   const getAllAvailableTabs = () => {
//     const dynamicTabs = (projectData?.enable_project_milestone_tracking === 1 && projectData?.project_work_header_entries)
//       ? projectData.project_work_header_entries.filter(entry => entry.enabled === "True")
//       : [];

//     // 2. Sort the dynamic entries by project_work_header_name
//     dynamicTabs.sort((a, b) => 
//       a.project_work_header_name.localeCompare(b.project_work_header_name)
//     );
//     return [
//       { name: "Work force", project_work_header_name: "Work force", enabled: "True" },
//       // ...(projectData?.enable_project_milestone_tracking === 1 && projectData?.project_work_header_entries
//       //   ? projectData.project_work_header_entries.filter(entry => entry.enabled === "True")
//       //   : []),
//       ...dynamicTabs,
//           {name:"Photos",project_work_header_name:"Photos",enabled:"True"},
//     ];
//   };

//   // const getInheritedMilestones = (workHeader: string): LocalMilestoneData[] => {
//   //   // 1. Prioritize milestones from the `lastCompletedReport` if available.
//   //   if (lastCompletedReport && lastCompletedReport.milestones && lastCompletedReport.milestones.length > 0) {
//   //     const previousCompletedMilestones = lastCompletedReport.milestones.filter(m => {
//   //       return m.work_header === workHeader;
//   //     }) || [];

//   //     if (previousCompletedMilestones.length > 0) {
//   //       return previousCompletedMilestones.map(milestone => ({
//   //         ...milestone,
//   //         remarks: "",
//   //         is_updated_for_current_report: false,
//   //       }));
//   //     }
//   //   }
    
//   //   // 2. Fallback to default Frappe Work Milestones
//   //   const defaultMilestones: LocalMilestoneData[] = [];
//   //   const frappeMilestonesForHeader = allFrappeMilestones?.filter(m => m.work_header === workHeader) || [];
    
//   //   if (frappeMilestonesForHeader.length > 0) {
//   //     frappeMilestonesForHeader.forEach(frappeM => {
//   //       defaultMilestones.push({
//   //         name: frappeM.name,
//   //         work_milestone_name: frappeM.work_milestone_name,
//   //         work_header: frappeM.work_header,
//   //         status: frappeM.status || 'Not Applicable',
//   //         progress: frappeM.progress || 0,
//   //         expected_starting_date: frappeM.expected_starting_date,
//   //         expected_completion_date: frappeM.expected_completion_date,
//   //         remarks: "",
//   //         is_updated_for_current_report: false,
//   //       });
//   //     });
//   //   }
//   //   return defaultMilestones;
//   // };

//   const getInheritedMilestones = (workHeader: string): LocalMilestoneData[] => {
    
//     const frappeMilestonesForHeader = allFrappeMilestones?.filter(m => m.work_header === workHeader) || [];
//     const lastCompletedReportMilestones = lastCompletedReport?.milestones || [];

//     // 1. Build the initial list based on the latest Base Milestones for this header.
//     const initialMilestones: LocalMilestoneData[] = frappeMilestonesForHeader.map(frappeM => ({
//       name: frappeM.name,
//       work_milestone_name: frappeM.work_milestone_name,
//       work_header: frappeM.work_header,
//       // Use the default status/progress from the Frappe DocType definition as a fallback
//       status: frappeM.status || 'Not Applicable',
//       progress: frappeM.progress || 0,
//       expected_starting_date: frappeM.expected_starting_date,
//       expected_completion_date: frappeM.expected_completion_date,
//       remarks: "", // Start with empty remarks for the new report
//       is_updated_for_current_report: false,
//        work_plan: "", // Default to empty string
//        work_plan_ratio: 'Plan Not Required', // Default to Plan Not Required
//     }));

//     // 2. Overlay the status/progress from the Last Completed Report onto the base list.
//     if (lastCompletedReportMilestones.length > 0) {
//       const mergedMilestones = initialMilestones.map(initialM => {
        
//         // Find a matching milestone in the last completed report by Name/Header
//         const matchingCompletedM = lastCompletedReportMilestones.find(
//           (completedM) =>
//             completedM.work_header === initialM.work_header &&
//             completedM.work_milestone_name === initialM.work_milestone_name
//         );

//         if (matchingCompletedM) {
//           // Found a match: overlay the status and progress
//           return {
//             ...initialM, // Keep base fields like name, work_header, work_milestone_name
//             status: matchingCompletedM.status,
//             progress: matchingCompletedM.progress,
//             expected_starting_date: matchingCompletedM.expected_starting_date,
//             expected_completion_date: matchingCompletedM.expected_completion_date,

//              // --- NEW FIELDS OVERLAYED ---
//             work_plan:"",
//     // Determine ratio based on whether the plan was present in the last completed report
//             work_plan_ratio: matchingCompletedM.work_plan ? 'Plan Required' : 'Plan Not Required',
//             // remarks and is_updated_for_current_report remain the default/initial values
//           };
//         }
//         return initialM; // No match found in completed report, keep the Base Milestone's default state
//       });
      
//       return mergedMilestones;
//     }

//     // 3. If no last completed report, return the list based purely on Base Milestones.
//     return initialMilestones;
//   };

//   const initializeTabStructureInLocalStorage = () => {
//     const dateString = formatDate(summaryWorkDate);
   
//     const allTabs = getAllAvailableTabs();
    
//     const existingDraftOwner = existingDraftReport?.[0]?.draft_owner || null;
//     const existingDraftLastUpdated = existingDraftReport?.[0]?.draft_last_updated || null;

//     allTabs.forEach(tab => {
//       const storageKey = `project_${projectId}_date_${dateString}_zone_${zoneKey}_tab_${tab.project_work_header_name}`;
//       const existingData = sessionStorage.getItem(storageKey);
      
//       if (!existingData) {
//         let initialData: ProjectProgressReportData | Pick<ProjectProgressReportData, 'photos'>;

//         if (tab.project_work_header_name === "Work force") {
//           initialData = {
//             project: projectId,
//             report_date: dateString,
//             manpower_remarks: existingDraftReport?.[0]?.manpower_remarks || "",
//             manpower: existingDraftReport?.[0]?.manpower || getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count })),
//             milestones: [],
//             photos: [],
//             report_status: 'Draft',
//             draft_owner: existingDraftOwner,
//             draft_last_updated: existingDraftLastUpdated
//           };
//         } else if (tab.project_work_header_name === "Photos") {
//           initialData = { photos: existingDraftReport?.[0]?.photos || [] };
//         } else {
//           // MODIFIED LOGIC HERE: Use existing draft milestones, OR the inherited list
//           // if no existing draft milestones are present for this header.
//           const existingDraftMilestonesForTab = existingDraftReport?.[0]?.milestones?.filter(
//             m => m.work_header === tab.project_work_header_name
//           ) || [];
            
//           const inheritedMilestones = existingDraftMilestonesForTab.length > 0 
//             ? existingDraftMilestonesForTab 
//             : getInheritedMilestones(tab.project_work_header_name);

//           initialData = {
//             project: projectId,
//             report_date: dateString,
//             manpower: [],
//             milestones: inheritedMilestones.map(m => ({
//                 ...m,
//                 is_updated_for_current_report: m.is_updated_for_current_report ?? false
//             })),
//             photos: [],
//             report_status: 'Draft',
//             report_zone: reportZone,
//             draft_owner: existingDraftOwner,
//             draft_last_updated: existingDraftLastUpdated
//           };
//         }
//         sessionStorage.setItem(storageKey, JSON.stringify(initialData));
//       } else {
//         const parsedData = JSON.parse(existingData) as ProjectProgressReportData;
//         if (tab.project_work_header_name !== "Work force" && tab.project_work_header_name !== "Photos") {
//             const milestonesWithUpdatedFlag = (parsedData.milestones || []).map(m => ({
//                 ...m,
//                 is_updated_for_current_report: m.is_updated_for_current_report ?? false
//             }));
//             if (JSON.stringify(milestonesWithUpdatedFlag) !== JSON.stringify(parsedData.milestones)) {
//                 sessionStorage.setItem(storageKey, JSON.stringify({ ...parsedData, milestones: milestonesWithUpdatedFlag }));
//             }
//         }
//         if (parsedData.report_status === 'Draft' && !parsedData.draft_owner && existingDraftOwner) {
//              const updatedParsedData = {
//                  ...parsedData,
//                  draft_owner: existingDraftOwner,
//                  draft_last_updated: existingDraftLastUpdated
//              };
//              sessionStorage.setItem(storageKey, JSON.stringify(updatedParsedData));
//         }
//       }
//     });
//   };

//   const loadDailyReport = () => {
//     setReportsLoading(true);
//     const dateString = formatDate(summaryWorkDate);
//     const zoneKey = reportZone; // Use the zone in the key
//     const storageKey = `project_${projectId}_date_${dateString}_zone_${zoneKey}_tab_${activeTabValue}`;
//     const storedData = sessionStorage.getItem(storageKey);

//     if (activeTabValue === "Photos") {
//       const parsedData: Pick<ProjectProgressReportData, 'photos'> = storedData ? JSON.parse(storedData) : { photos: [] };
//       setLocalPhotos(parsedData.photos || []);
//       setReportsLoading(false);
//       return;
//     }

//     if (storedData) {
//       const parsedData: ProjectProgressReportData = JSON.parse(storedData);
//       setLocalDailyReport(parsedData);

//       if (activeTabValue === "Work force") {
//         const fetchedManpower: FrappeManpowerDetail[] = parsedData.manpower || getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count }));
//         setDialogManpowerRoles(fetchedManpower.map(item => ({
//           id: `dialog_${item.label}`,
//           label: item.label,
//           count: item.count
//         })));
//         setDialogRemarks(parsedData.manpower_remarks || "");
//       }
//     } else {
//       console.warn(`Local storage key ${storageKey} was unexpectedly empty in loadDailyReport. Re-initializing.`);
//       initializeTabStructureInLocalStorage();
//       const reReadData = sessionStorage.getItem(storageKey);
//       if (reReadData) {
//           const parsedData: ProjectProgressReportData = JSON.parse(reReadData);
//           setLocalDailyReport(parsedData);
//           if (activeTabValue === "Work force") {
//               const fetchedManpower: FrappeManpowerDetail[] = parsedData.manpower || getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count }));
//               setDialogManpowerRoles(fetchedManpower.map(item => ({
//                 id: `dialog_${item.label}`,
//                 label: item.label,
//                 count: item.count
//               })));
//               setDialogRemarks(parsedData.manpower_remarks || "");
//           }
//           if (activeTabValue === "Photos") {
//              setLocalPhotos((parsedData as Pick<ProjectProgressReportData, 'photos'>).photos || []);
//           }
//       } else {
//           const dateString = formatDate(summaryWorkDate);
//           setLocalDailyReport({
//             project: projectId,
//             report_date: dateString,
//             manpower: activeTabValue === "Work force" ? getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count })) : [],
//             milestones: activeTabValue !== "Work force" && activeTabValue !== "Photos" ? getInheritedMilestones(activeTabValue) : [],
//             photos: [],
//             report_status: 'Draft',
//             report_zone:reportZone,
//             draft_owner: user || null,
//             draft_last_updated: new Date()
//           });
//           if (activeTabValue === "Work force") {
//             setDialogManpowerRoles(getManpowerRolesDefault());
//             setDialogRemarks("");
//           } else if (activeTabValue === "Photos") {
//             setLocalPhotos([]);
//           }
//       }
//     }
//     setReportsLoading(false);
//   };


//     const handlePhotoCaptureSuccess = (photoData: ProjectProgressAttachment) => {
//         console.log("photoData received from CameraCapture:", photoData);
//         const newPhotos = [...localPhotos, photoData];
//         setLocalPhotos(newPhotos);
        
//         const dateString = formatDate(summaryWorkDate);
//         const storageKey = getPhotosStorageKey(dateString);
//         sessionStorage.setItem(storageKey, JSON.stringify({ photos: newPhotos }));

//         setIsCaptureDialogOpen(false);
//         toast({
//             title: "Photo Ready! 📸",
//             description: `Photo has been added to the report's attachments.`,
//             variant: "default",
//         });
//     };

//     const handlePhotoRemarksChange = (local_id: string, remarks: string) => {
//         const updatedPhotos = localPhotos.map(p => 
//             p.local_id === local_id ? { ...p, remarks: remarks } : p
//         );
//         setLocalPhotos(updatedPhotos);
//         const dateString = formatDate(summaryWorkDate);
//         const storageKey = getPhotosStorageKey(dateString);
//         sessionStorage.setItem(storageKey, JSON.stringify({ photos: updatedPhotos }));
//     };

//     const handleRemovePhoto = (local_id: string) => {
//         const updatedPhotos = localPhotos.filter(p => p.local_id !== local_id);
//         setLocalPhotos(updatedPhotos);
        
//         const dateString = formatDate(summaryWorkDate);
//         const storageKey = getPhotosStorageKey(dateString);
//         sessionStorage.setItem(storageKey, JSON.stringify({ photos: updatedPhotos }));
        
//         toast({
//             title: "Photo Removed",
//             description: "The photo has been removed from the current report list.",
//             variant: "default",
//         });
//     };


//   useEffect(() => {
//     if (projectId && selectedProject !== projectId) {
//       setSelectedProject(projectId);
//       sessionStorage.setItem("selectedProject", JSON.stringify(projectId));
//     }
//   }, [projectId, selectedProject, setSelectedProject]);

//   useEffect(() => {
//     if (
//       projectId &&
//       !latestCompletedReportsListLoading &&
//       !lastCompletedReportLoading &&
//       !existingDraftReportLoading &&
//       allFrappeMilestones &&
//       projectData
//     ) {
//       if (existingDraftReport && existingDraftReport.length > 0) {
//         setCurrentFrappeReportName(existingDraftReport[0].name);
//         console.log("Found existing draft report for date:", formatDate(summaryWorkDate), "Name:", existingDraftReport[0].name);
//       } else {
//         setCurrentFrappeReportName(null);
//         console.log("No existing draft report found for date:", formatDate(summaryWorkDate));
//       }
      
//       initializeTabStructureInLocalStorage();
//       loadDailyReport();
//     }
//   }, [
//     summaryWorkDate,
//     projectId,
//     activeTabValue,
//     latestCompletedReportsListLoading,
//     lastCompletedReportLoading,
//     existingDraftReportLoading,
//     allFrappeMilestones,
//     projectData,
//     existingDraftReport,
//     lastCompletedReport,
//     user // ADDED: user dependency for draft_owner logic
//   ]);

//   // NEW: useEffect for Draft Ownership Check
//   useEffect(() => {
//     if (existingDraftReport && existingDraftReport.length > 0 && user) {
//       const draftReport = existingDraftReport[0];
//       const currentLoggedInUserEmail = user;
//       const draftOwnerEmail = draftReport.draft_owner;
//       const draftLastUpdated = draftReport.draft_last_updated;

//       if (draftOwnerEmail && draftOwnerEmail !== currentLoggedInUserEmail) {
//         // A different user owns this draft
//         const now = new Date();
//         // Fallback to 'now' if draftLastUpdated is null/invalid, to prevent immediate "stale" status.
//         const lastUpdatedTime = draftLastUpdated ? new Date(draftLastUpdated) : now; 
//         const diffMs = now.getTime() - lastUpdatedTime.getTime();
//         const diffMinutes = Math.floor(diffMs / (1000 * 60));

//         const GRACE_PERIOD_MINUTES = 30; // Define your grace period here

//         if (diffMinutes < GRACE_PERIOD_MINUTES) {
//           // Still within the grace period, block the current user
//           setIsBlockedByDraftOwnership(true);
//           setBlockingDraftOwnerEmail(draftOwnerEmail);
//           setTimeRemainingToUnlock(GRACE_PERIOD_MINUTES - diffMinutes);
//           SetDraftMessage(`Blocked: Draft owned by ${draftOwnerEmail}. Time remaining: ${GRACE_PERIOD_MINUTES - diffMinutes} mins.`);
//         } 
//         else {
//           // Grace period passed, allow the current user to take ownership
//           // This implicitly means the current user will now be the draft_owner
//          setIsBlockedByDraftOwnership(true);
          
//           setTimeRemainingToUnlock(0); // Set to 0 to indicate stale and no remaining time
//           // SetDraftMessage(`Allowed: Draft previously owned by ${draftOwnerEmail} is stale (>${GRACE_PERIOD_MINUTES} mins)`);
//           SetDraftMessage(`Allowed: Draft  owned by ${draftOwnerEmail}.`);


//         }
//       } else {
//         // No owner, or current user is the owner
//         setIsBlockedByDraftOwnership(false);
//         setBlockingDraftOwnerEmail(null);
//         setTimeRemainingToUnlock(null);
//         SetDraftMessage(null);
//       }
//     } else {
//       // No existing draft or no user logged in
//       setIsBlockedByDraftOwnership(false);
//       setBlockingDraftOwnerEmail(null);
//       setTimeRemainingToUnlock(null);
//     //  SetDraftMessage("Allowed: No existing draft found or no user logged in.");
//     }
//   }, [existingDraftReport, user, summaryWorkDate]); // Depend on user to re-evaluate if login state changes


//   useEffect(() => {
//     if (localDailyReport && activeTabValue === "Work force") {
//       const fetchedManpowerDetails: ManpowerRole[] = (localDailyReport.manpower || []).map(item => ({
//         id: `summary_${item.label}`,
//         label: item.label,
//         count: item.count
//       }));
//       const combinedRoles = getManpowerRolesDefault();
      
//       fetchedManpowerDetails.forEach(fetchedRole => {
//         const existingRole = combinedRoles.find(r => r.label === fetchedRole.label);
//         if (existingRole) {
//           existingRole.count = fetchedRole.count;
//         } else {
//           combinedRoles.push(fetchedRole);
//         }
//       });

//       setSummaryManpowerRoles(combinedRoles);
//       setDialogRemarks(localDailyReport.manpower_remarks || "");
//       setDialogManpowerRoles(combinedRoles.map(item => ({
//         id: `dialog_${item.label}`,
//         label: item.label,
//         count: item.count
//       })));
//     } else if (activeTabValue === "Work force") {
//       setSummaryManpowerRoles(getManpowerRolesDefault());
//       setDialogRemarks("");
//       setDialogManpowerRoles(getManpowerRolesDefault());
//     }
//   }, [localDailyReport, summaryWorkDate, activeTabValue]);

//   // useEffect(() => {
//   //   if (activeTabValue === "Work force" || activeTabValue === "Photos" || !allFrappeMilestones) {
//   //     setCurrentTabMilestones([]);
//   //     return;
//   //   }

//   //   // const localMilestonesFlatArray = getInheritedMilestones(activeTabValue) || localDailyReport?.milestones ;

//   //   const localMilestonesFlatArray =localDailyReport?.milestones || getInheritedMilestones(activeTabValue);

//   //   const milestonesForCurrentTab: LocalMilestoneData[] = [];
//   //   localMilestonesFlatArray.forEach(milestone => {
//   //     if (milestone.work_header === activeTabValue) {
//   //       milestonesForCurrentTab.push(milestone);
//   //     }
//   //   });

//   //   setCurrentTabMilestones(milestonesForCurrentTab);
//   // }, [activeTabValue, localDailyReport, allFrappeMilestones, lastCompletedReport]);

//   useEffect(() => {
//     if (activeTabValue === "Work force" || activeTabValue === "Photos" || !allFrappeMilestones) {
//       setCurrentTabMilestones([]);
//       return;
//     }

//     const currentTabWorkHeader = activeTabValue;

//     // 1. Prioritize milestones from the localDailyReport state (loaded from session storage)
//     let milestonesForCurrentTab: LocalMilestoneData[] = 
//         localDailyReport?.milestones?.filter(m => m.work_header === currentTabWorkHeader) || [];
    
//     // 2. If localDailyReport did not contain milestones for this tab, 
//     //    fall back to the inherited/base milestones.
//     if (milestonesForCurrentTab.length === 0) {
//         // We call loadDailyReport/initializeTabStructureInLocalStorage 
//         // in the main effect, which already ensures the data is in sessionStorage.
//         // We re-call getInheritedMilestones here as a final safeguard/to ensure the base structure
//         // is used if initialization somehow failed to populate the milestones array correctly.
//         milestonesForCurrentTab = getInheritedMilestones(currentTabWorkHeader);
        
//         // Safety check: if localDailyReport exists but its milestone array was empty,
//         // we should merge the inherited data into the local report state for the next update.
//         // This is mainly handled by initializeTabStructureInLocalStorage, but this ensures 
//         // the correct list is displayed.
//     }

//     setCurrentTabMilestones(milestonesForCurrentTab);
//   }, [activeTabValue, localDailyReport, allFrappeMilestones, lastCompletedReport]);

//   const handleDialogManpowerCountChange = (index: number, value: string) => {
//     const updatedRoles = [...dialogManpowerRoles];
//     updatedRoles[index].count = Number(value) || 0;
//     setDialogManpowerRoles(updatedRoles);
//   };

//   const handleDialogRoleNameChange = (index: number, value: string) => {
//     const updatedRoles = [...dialogManpowerRoles];
//     updatedRoles[index].label = value;
//     setDialogManpowerRoles(updatedRoles);
//   };

//   const handleAddManpowerRole = () => {
//     setDialogManpowerRoles([...dialogManpowerRoles, { id: `new_role_${Date.now()}`, label: "New Role", count: 0 }]);
//   };

//   const handleRemoveManpowerRole = (indexToRemove: number) => {
//     setDialogManpowerRoles(prevRoles => prevRoles.filter((_, index) => index !== indexToRemove));
//     toast({
//       title: "Role Removed",
//       description: "Manpower role has been removed.",
//       variant: "default",
//     });
//   };

//   const openUpdateManpowerDialog = () => {
//     setIsUpdateManpowerDialogOpen(true);
//   };

//   const moveToNextTab = () => {
//     const allTabs = getAllAvailableTabs();
//     const currentIndex = allTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);
    
//     if (currentIndex < allTabs.length - 1) {
//       const nextTab = allTabs[currentIndex + 1];
//       setActiveTabValue(nextTab.project_work_header_name);
//       return false;
//     }
//     return true;
//   };

//   const saveCurrentTabData = (milestoneData?: LocalMilestoneData[]) => {
//     const dateString = formatDate(summaryWorkDate);
//     const storageKey = `project_${projectId}_date_${dateString}_zone_${zoneKey}_tab_${activeTabValue}`;
// console.log(user)
//     const currentDraftOwner = user || null;
//     const currentTimestamp = new Date();

//     console.log("currentTimestamp",currentTimestamp,new Date)

//     if (activeTabValue === "Work force") {
//       const manpowerToSave: FrappeManpowerDetail[] = dialogManpowerRoles.map((item) => ({
//         label: item.label,
//         count: item.count,
//       }));

//       const payload: ProjectProgressReportData = {
//         project: projectId,
//         report_date: dateString,
//         manpower_remarks: dialogRemarks,
//         manpower: manpowerToSave,
//         milestones: [],
//         photos: [],
//         report_status: 'Draft',
//         report_zone: reportZone,
//         draft_owner: currentDraftOwner,
//         draft_last_updated: currentTimestamp
//       };

//       sessionStorage.setItem(storageKey, JSON.stringify(payload));
//     } else if (activeTabValue === "Photos") {
//             const payload: Pick<ProjectProgressReportData, 'photos'> = { photos: localPhotos };
//             sessionStorage.setItem(storageKey, JSON.stringify(payload));
//       }else {
//       const payload: ProjectProgressReportData = {
//         project: projectId,
//         report_date: dateString,
//         manpower: [],
//         milestones: milestoneData || currentTabMilestones,
//         photos: [],
//         report_status: 'Draft',
//         report_zone: reportZone,
//         draft_owner: currentDraftOwner,
//         draft_last_updated: currentTimestamp
//       };

//       sessionStorage.setItem(storageKey, JSON.stringify(payload));
//     }
//   };

//   const collectAllTabData = (status: 'Draft' | 'Completed'): FrappeProjectProgressReportPayload => {
//     const dateString = formatDate(summaryWorkDate);
//     const allTabs = getAllAvailableTabs();
//     let allManpower: FrappeManpowerDetail[] = [];
//     let allMilestones: LocalMilestoneData[] = [];
//     let allPhotos: ProjectProgressAttachment[] = [];
//     let manpowerRemarks = "";

//     allTabs.forEach(tab => {

//       const storageKey = `project_${projectId}_date_${dateString}_zone_${zoneKey}_tab_${tab.project_work_header_name}`;
//       const tabData = sessionStorage.getItem(storageKey);
      
//       let parsedData: ProjectProgressReportData | Pick<ProjectProgressReportData, 'photos'> | null = null;
//       if (tabData) {
//         parsedData = JSON.parse(tabData);
//       }

//       if (tab.project_work_header_name === "Work force") {
//         allManpower = (parsedData as ProjectProgressReportData)?.manpower || [];
//         manpowerRemarks = (parsedData as ProjectProgressReportData)?.manpower_remarks || "";
//       } else if (tab.project_work_header_name === "Photos") {
//         allPhotos.push(...((parsedData as Pick<ProjectProgressReportData, 'photos'>)?.photos || []).filter(p => p.image_link));
//       } else { // Milestone tabs
//         let tabMilestones: LocalMilestoneData[] = [];
//         if (parsedData && (parsedData as ProjectProgressReportData).milestones && (parsedData as ProjectProgressReportData).milestones!.length > 0) {
//           tabMilestones = (parsedData as ProjectProgressReportData).milestones!;
//         } else {
//           tabMilestones = getInheritedMilestones(tab.project_work_header_name);
//         }
//         allMilestones.push(...tabMilestones);
//       }
//     });

//     const cleanedMilestones: FrappeMilestoneChildPayload[] = allMilestones.map(milestone => {
//       const payloadEntry: FrappeMilestoneChildPayload = {
//         work_milestone_name: milestone.work_milestone_name,
//         work_header: milestone.work_header,
//         status: milestone.status,
//         progress: milestone.progress,
//         remarks: milestone.remarks || '',
//         // --- NEW FIELD ADDED ---
//             work_plan: milestone.work_plan || '', 
//             // -----------------------
//       };

//       if (milestone.expected_starting_date) {
//         payloadEntry.expected_starting_date = milestone.expected_starting_date;
//       }
//       if (milestone.expected_completion_date) {
//         payloadEntry.expected_completion_date = milestone.expected_completion_date;
//       }
//       // if (milestone.name) { 
//       //     payloadEntry.name = milestone.name;
//       // }

//       return payloadEntry;
//     });

//     const cleanedAttachments: Omit<ProjectProgressAttachment, 'local_id'>[] = allPhotos.map(photo => ({
//         image_link: photo.image_link,
//         location: photo.location,
//         remarks: photo.remarks,
//     }));

//     const finalPayload: FrappeProjectProgressReportPayload = {
//       project: projectId,
//       report_date: dateString,
//       manpower_remarks: manpowerRemarks,
//       manpower: allManpower,
//       milestones: cleanedMilestones,
//       attachments: cleanedAttachments,
//       report_status: status,
//       report_zone: reportZone, // <-- NEW: Add the zone to the payload

//     };

//     if (status === 'Draft') {
//       console.log("user?.email",user,new Date())
//       finalPayload.draft_owner = user;
//       finalPayload.draft_last_updated = formatToLocalDateTimeString(new Date()); 
//     } else {
//         finalPayload.draft_owner = undefined;
//         finalPayload.draft_last_updated = undefined;
//     }

//     return finalPayload;
//   };

//   const clearAllTabData = () => {
//     const dateString = formatDate(summaryWorkDate);
//     const allTabs = getAllAvailableTabs();
    
//     allTabs.forEach(tab => {
//       const storageKey = `project_${projectId}_date_${dateString}_zone${zoneKey}_tab_${tab.project_work_header_name}`;
//       sessionStorage.removeItem(storageKey);
//     });
//   };

//   const handleSyncAndSubmitAllData = async (isCalledFromManpowerDialog = false) => {
//     setIsLocalSaving(true);

//     if (activeTabValue !== "Work force" && activeTabValue !== "Photos") {
//       const hasUnupdatedMilestones = currentTabMilestones.some(
//         (m) => m.is_updated_for_current_report==false
//       );

//       if (hasUnupdatedMilestones) {
//         setIsLocalSaving(false);
//         toast({
//           title: "Validation Error 🚫",
//           description: `Please update all visible milestones in the '${activeTabValue}' tab before continuing.`,
//           variant: "destructive",
//         });
//         return;
//       }
//     }

//     saveCurrentTabData();

//     const allTabs = getAllAvailableTabs();
//     const currentIndex = allTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);
//     const isLastTab = currentIndex === allTabs.length - 1;

//     let submissionStatus: 'Draft' | 'Completed';
//     let successMessage: string;
//     let failureMessage: string;
//     let operationType: 'create' | 'update';
//     let docNameForFrappeOperation: string | null = null;

//     if (isLastTab) {
//       submissionStatus = 'Completed';
//       successMessage = "Final Report Submitted Successfully! ✅";
//       failureMessage = "Final Submission Failed ❌";
//       operationType = 'update';
//       docNameForFrappeOperation = currentFrappeReportName;

//       const payloadToCheckPhotos = collectAllTabData('Draft');
//       if (!payloadToCheckPhotos.attachments || payloadToCheckPhotos.attachments.length < 3) {
//         setIsLocalSaving(false);
//         toast({
//           title: "Submission Validation Error 🚫",
//           description: "Please upload at least Three photos before final submission.",
//           variant: "destructive",
//         });
//         return;
//       }

//       if (!docNameForFrappeOperation) {
//         setIsLocalSaving(false);
//         toast({
//           title: "Submission Error 🚫",
//           description: "No draft report found to finalize. Please ensure you've saved intermediate progress first.",
//           variant: "destructive",
//         });
//         console.error("Attempted final submission without a currentFrappeReportName.");
//         return;
//       }

//     } else {
//       submissionStatus = 'Draft';
//       successMessage = "Report Data Synced! 🎉";
//       failureMessage = "Data Sync Failed ❌";

//       if (currentFrappeReportName) {
//         operationType = 'update';
//         docNameForFrappeOperation = currentFrappeReportName;
//       } else {
//         operationType = 'create';
//       }
//     }

//     const finalPayload = collectAllTabData(submissionStatus);
//     console.log("Submitting to Frappe with status:", submissionStatus, "Operation:", operationType, "Payload:", finalPayload);

//     // Start Sentry tracking
//     const sentryOperation = isLastTab ? 'final-submission' : 'save-draft';
//     const sentryContext = {
//       project_id: projectId,
//       report_id: currentFrappeReportName || undefined,
//       report_date: finalPayload.report_date,
//       report_status: submissionStatus,
//       active_tab: activeTabValue,
//       photo_count: localPhotos.length,
//       milestone_count: currentTabMilestones.length,
//     };

//     const endSpan = startWorkflowTransaction('project-progress-report', sentryOperation, sentryContext);
//     const breadcrumbMessage = isLastTab ? 'Final report submission started' : 'Report sync started';
//     addWorkflowBreadcrumb('project-progress-report', breadcrumbMessage, sentryContext);

//     try {
//       let response: any;
//       if (operationType === 'create') {
//         response = await createDoc("Project Progress Reports", finalPayload);
//         setCurrentFrappeReportName(response.name);
//         console.log("Frappe create response (Draft):", response);
//       } else {
//         if (!docNameForFrappeOperation) {
//              throw new Error("Cannot update: no document name provided for update operation.");
//         }
//         response = await updateDoc("Project Progress Reports", docNameForFrappeOperation, finalPayload);
//         console.log("Frappe update response:", response);
//       }

//       toast({
//         title: successMessage,
//         description: `Project Progress Report for ${finalPayload.report_date} (${submissionStatus}) has been processed.`,
//         variant: "default",
//       });

//       // Success breadcrumb
//       const successBreadcrumb = isLastTab ? 'Final report submission successful' : 'Report sync successful';
//       addWorkflowBreadcrumb('project-progress-report', successBreadcrumb, {
//         report_id: response.name || docNameForFrappeOperation
//       });

//       if (isLastTab) {
//         clearAllTabData();
//         setCurrentFrappeReportName(null);
//         navigate('/prs&milestones/milestone-report', { replace: true });

//       } else if (isCalledFromManpowerDialog) {
//         setIsUpdateManpowerDialogOpen(false);
//       } else {
//         moveToNextTab();
//       }

//     } catch (error: any) {
//       console.error("Error during Frappe operation:", error);

//       // Failure breadcrumb
//       const failureBreadcrumb = isLastTab ? 'Final report submission failed' : 'Report sync failed';
//       addWorkflowBreadcrumb('project-progress-report', failureBreadcrumb, {
//         error: error.message
//       });

//       // Capture error with Sentry
//       captureWorkflowError('project-progress-report', error, sentryContext);

//       const description = isNetworkError(error)
//         ? "Network error. Please check your connection."
//         : error.message || "An unknown error occurred during report processing.";

//       toast({
//         title: failureMessage,
//         description,
//         variant: "destructive",
//       });
//     } finally {
//       endSpan();
//       setIsLocalSaving(false);
//       refetchExistingDraftReport();
//     }
//   };

//   const openUpdateMilestoneDialog = (milestone: LocalMilestoneData) => {
//     setSelectedMilestoneForDialog(milestone || null);

//     setNewStatus(milestone.status);
//     setProgress(milestone.progress);
//     setExpectedDate(
//       milestone.status === 'Not Started' && milestone.expected_starting_date
//         ? new Date(milestone.expected_starting_date)
//         : (milestone.expected_completion_date ? new Date(milestone.expected_completion_date) : null)
//     );
//     setMilestoneRemarks(milestone.remarks || '');
//      // --- NEW LOGIC: Initialize Work Plan Dialog States ---
//     const ratio = milestone.work_plan_ratio || 'Plan Not Required';
//     setWorkPlanRatio(ratio);
//     setWorkPlanPoints(parseWorkPlan(milestone.work_plan));
//     // ---------------------------------------------------
//     setIsUpdateMilestoneDialogOpen(true);
//   };
  
//   const handleUpdateMilestone = async () => {
//     if (!selectedMilestoneForDialog || !activeTabValue) return;

//     if (!newStatus) {
//       toast({
//         title: "Validation Error 🚫",
//         description: "Please select a status for the milestone.",
//         variant: "destructive",
//       });
//       return;
//     }

//     if (newStatus === 'Not Started') {
//       if (!expectedDate) {
//         toast({
//           title: "Validation Error 🚫",
//           description: "Please provide an expected starting date for 'Not Started' milestones.",
//           variant: "destructive",
//         });
//         return;
//       }
//     } else if (newStatus === 'WIP') {
//       if (progress <= 0 || progress >= 100) {
//         toast({
//           title: "Validation Error 🚫",
//           description: "For 'WIP' milestones, progress must be between 1% and 99%.",
//           variant: "destructive",
//         });
//         return;
//       }
//       if (progress>75 && !expectedDate) {
//         toast({
//           title: "Validation Error 🚫",
//           description: "Please provide an expected completion date for 'WIP' milestones.",
//           variant: "destructive",
//         });
//         return;
//       }
//     }

//      // --- NEW VALIDATION: Check if work_plan is required but empty ---
//     if (newStatus != "Completed" && newStatus != "Not Applicable" && workPlanRatio === 'Plan Required' && workPlanPoints.every(p => p.trim() === '')) {
//         toast({
//             title: "Validation Error 🚫",
//             description: "Work Plan is required for this ratio selection.",
//             variant: "destructive",
//         });
//         return;
//     }
//     // --------------------------------------------------------------

//     const updatedLocalMilestone: LocalMilestoneData = {
//       name: selectedMilestoneForDialog.name,
//       work_milestone_name: selectedMilestoneForDialog.work_milestone_name,
//       work_header: selectedMilestoneForDialog.work_header,
//       status: newStatus,
//       progress:progress,
//       remarks: milestoneRemarks,
//       is_updated_for_current_report: true,
//               // --- NEW FIELDS SAVED ---
//         work_plan_ratio: workPlanRatio,
//         work_plan: workPlanRatio === 'Plan Required' ? serializeWorkPlan(workPlanPoints) : '', // Save only if required
//         // ------------------------

//     };

//     if (newStatus === 'Not Started') {
//       updatedLocalMilestone.expected_starting_date = expectedDate ? formatDate(expectedDate) : undefined;
//       updatedLocalMilestone.expected_completion_date = undefined;
//       updatedLocalMilestone.progress = 0;
//     } else if (newStatus === 'WIP') {
//       if(progress>75){
//       updatedLocalMilestone.expected_completion_date = expectedDate ? formatDate(expectedDate) : undefined;
//       updatedLocalMilestone.expected_starting_date = undefined; 
//       updatedLocalMilestone.progress = progress;
//       }else{
//          updatedLocalMilestone.expected_completion_date = undefined;
//       updatedLocalMilestone.expected_starting_date = undefined; 
//       updatedLocalMilestone.progress = progress;
//       } 
//     }
//     else if(newStatus === 'Completed'){
//       updatedLocalMilestone.expected_completion_date = undefined;
//       updatedLocalMilestone.expected_starting_date = undefined; 
//       updatedLocalMilestone.progress = 100;
//       updatedLocalMilestone.work_plan="";
//       updatedLocalMilestone.work_plan_ratio="Plan Not Required";

//     }else if(newStatus==='Not Applicable'){
//       updatedLocalMilestone.expected_completion_date = undefined;
//       updatedLocalMilestone.expected_starting_date = undefined; 
//       updatedLocalMilestone.progress = 0;
//       updatedLocalMilestone.work_plan="";
//       updatedLocalMilestone.work_plan_ratio="Plan Not Required";
//     }

//     const updatedMilestonesForCurrentTab = [...currentTabMilestones];
//     const existingIndex = updatedMilestonesForCurrentTab.findIndex(m => m.name === updatedLocalMilestone.name && m.work_header === updatedLocalMilestone.work_header);
    
//     if (existingIndex !== -1) {
//       updatedMilestonesForCurrentTab[existingIndex] = updatedLocalMilestone;
//     } else {
//       updatedMilestonesForCurrentTab.push(updatedLocalMilestone);
//     }
    
//     setCurrentTabMilestones(updatedMilestonesForCurrentTab);
//     saveCurrentTabData(updatedMilestonesForCurrentTab);
    
//     setIsUpdateMilestoneDialogOpen(false);
//     toast({
//       title: "Success! 🎉",
//       description: "Milestone updated successfully.",
//       variant: "default",
//     });
//   };

//   const getStatusColor = (status: string) => {
//     switch (status) {
//       case 'Not Started':
//         return 'bg-pink-100 text-pink-700';
//       case 'WIP':
//         return 'bg-yellow-100 text-yellow-700';
//       case 'Completed':
//         return 'bg-green-100 text-green-700';
//       case 'Not Applicable':
//         return 'bg-gray-100 text-gray-700';
//       default:
//         return 'bg-gray-100 text-gray-700';
//     }
//   };

//   const isGlobalLoading = projectLoading || reportsLoading || frappeMilestonesLoading ||
//                           latestCompletedReportsListLoading || lastCompletedReportLoading ||
//                           existingDraftReportLoading;
//   const isGlobalError = projectError || frappeMilestonesError ||
//                         latestCompletedReportsListError || lastCompletedReportError ||
//                         existingDraftReportError||isMapError;

//   const isGlobalSyncDisabled = isLocalSaving || isFrappeOperationLoading || isBlockedByDraftOwnership; // MODIFIED

//   if (isGlobalLoading) {
//     return (
//       <div className="flex justify-center items-center min-h-[50vh]">
//         <TailSpin color="#6366F1" height={80} width={80} />
//       </div>
//     );
//   }

//   if (isGlobalError) {
//     return <div className="p-4 text-red-600"><div className="flex flex-col items-center justify-center min-h-[50vh] p-6 bg-red-50 text-red-800 rounded-lg shadow-md m-4">
//             <h3 className="text-2xl font-bold mb-2 text-center text-red-900">
//               Failed to Load Data!
//             </h3>
//             <p className="text-lg text-center text-red-700 mb-4">
//               We encountered a problem trying to fetch the necessary project information.
//             </p>
//             <p className="text-md text-center text-red-600 mb-6">
//               Error Details: <span className="font-semibold">{isGlobalError}</span>
//             </p>
//             <Button
//               onClick={() =>{
//     sessionStorage.removeItem('selectedProject'); // ADD THIS LINE
//     navigate('/prs&milestones/milestone-report')
//               } }
//               className="bg-red-600 hover:bg-red-700 text-white text-lg py-3 px-8 rounded-full shadow-lg transition-all duration-300 ease-in-out hover:scale-105"
//             >
//               Go Back to Reports Overview
//             </Button>
//           </div></div>;
//   }

//   if (!projectId) {
//     return <div className="p-4 text-red-600">No Project ID found. Please select a project.</div>;
//   }

//   const handleClearDraft = async () => {
//     if (!currentFrappeReportName || !projectId || !summaryWorkDate) {
//       toast({
//         title: "Error",
//         description: "No draft report identified to clear.",
//         variant: "destructive",
//       });
//       return;
//     }

//     try {
//       // Attempt to delete the Frappe document
//       await deleteDoc("Project Progress Reports", currentFrappeReportName);

//       toast({
//         title: "Draft Cleared! ✅",
//         description: `The draft report for ${formatDate(summaryWorkDate)} has been successfully cleared.`,
//         variant: "default",
//       });

//       // Clear local storage for this date/project
//       clearAllTabData();

//       // Reset relevant states to unblock the UI
//       setCurrentFrappeReportName(null);
//       setIsBlockedByDraftOwnership(false);
//       setBlockingDraftOwnerEmail(null);
//       setTimeRemainingToUnlock(null);
//       SetDraftMessage(null); // Clear any blocking messages

//       // Re-fetch existing drafts to reflect the deletion
//       refetchExistingDraftReport();
//       navigate('/prs&milestones/milestone-report')
//       // Navigate away or force a UI re-initialization if needed
//       // navigate('/prs&milestones/milestone-report', { replace: true });

//     } catch (error: any) {
//       console.error("Error clearing draft report:", error);
//       toast({
//         title: "Failed to Clear Draft ❌",
//         description: error.message || "An unknown error occurred while clearing the draft.",
//         variant: "destructive",
//       });
//     }
//   };


//  // --- NEW: Render Blocking Message if applicable ---
//   if (isBlockedByDraftOwnership) {
//     return (
//       <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 bg-red-50 text-red-800 rounded-lg shadow-md m-4">
//         <X className="h-16 w-16 text-red-500 mb-4 animate-pulse" /> {/* Added animate-pulse for visual attention */}
//         <h3 className="text-2xl font-bold mb-2 text-center text-red-900">Draft Report is Locked!</h3> {/* Clearer, stronger heading */}

//         {blockingDraftOwnerEmail && (
//           <p className="text-lg text-center text-red-700 mb-2">
//             This draft is currently being edited by <span className="font-semibold">{blockingDraftOwnerEmail}</span>.
//           </p>
//         )}

//         {timeRemainingToUnlock !== null && timeRemainingToUnlock > 0 ? (
//           <>
//             <p className="text-md text-center text-red-600 mb-4">
//               It will be available in  {timeRemainingToUnlock} minutes:
//             </p>
//             <p className="font-bold text-red-800 text-5xl mb-6"> {/* Large, prominent countdown */}
//               {timeRemainingToUnlock} 
//             </p>
//             <p className="text-sm text-center text-gray-600 mb-6">
//               Please wait for them to finish or contact the user to coordinate.
//             </p>
//           </>
//         ) : (
//           <p className="text-md text-center text-red-700 mb-4">
//             The draft is now stale (older than 30 minutes). You can clear it and start a new report.
//           </p>
//         )}

//         {/* Buttons Group */}
//         <div className="flex flex-col gap-3 mt-4 w-full max-w-sm"> {/* Group buttons and apply max-width for better layout */}
//           {timeRemainingToUnlock !== null && timeRemainingToUnlock <= 0 && ( // Show "Clear Draft" only if stale (time is 0 or less)
//             <Button
//               onClick={handleClearDraft}
//               className="w-full bg-red-600 hover:bg-red-700 text-white text-lg py-3 rounded-full shadow-lg transition-all duration-300 ease-in-out hover:scale-105"
//               disabled={isDeletingDoc}
//             >
//               {isDeletingDoc ? <TailSpin height={20} width={20} color="#fff" /> : "Clear Draft & Take Over"}
//             </Button>
//           )}
//           <Button
//             onClick={() => navigate('/prs&milestones/milestone-report')}
//             className="w-full bg-gray-600 hover:bg-gray-700 text-white text-lg py-3 rounded-full shadow-lg transition-all duration-200 ease-in-out hover:scale-105"
//           >
//             Go Back to Reports Overview
//           </Button>
//         </div>
//       </div>
//     );
//   }
//   // --- END NEW: Blocking Message ---


//   if (latestCompletedReportDateIsToday) {
//     return (
//       <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 bg-green-50 text-green-800 rounded-lg shadow-md m-4">
//         <CheckCircle className="h-16 w-16 text-green-500 mb-4 animate-bounce-in" /> {/* Success Icon */}
//         <h3 className="text-2xl font-bold mb-2 text-center text-green-900">
//           Report for Today is Already Completed!
//         </h3>
//         <p className="text-lg text-center text-green-700 mb-4">
//           A final report for Project <span className="font-semibold">{projectData?.project_name || projectId}</span> on <span className="font-semibold">{latestCompletedReportsList[0].report_date}</span> has already been submitted.
//         </p>

//         {latestCompletedReportName && (
//           <p className="text-md text-center text-green-600 mb-6">
//             Report ID: <span className="font-semibold">{latestCompletedReportName}</span>
//           </p>
//         )}

//         <Button
//           onClick={() => navigate('/prs&milestones/milestone-report')}
//           className="bg-green-600 hover:bg-green-700 text-white text-lg py-3 px-8 rounded-full shadow-lg transition-all duration-300 ease-in-out hover:scale-105"
//         >
//           Go Back to Reports Overview
//         </Button>
//       </div>
//     );
//   }



//   const allAvailableTabs = getAllAvailableTabs();
//   const currentIndex = allAvailableTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);
//   const isLastTab = currentIndex === allAvailableTabs.length - 1;


//   const getVisibleTabs = (currentTabValue: string) => {
//     const currentIndex = allAvailableTabs.findIndex(tab => tab.project_work_header_name === currentTabValue);
//     const visibleTabs = [];

//     if (currentIndex !== -1) {
//       visibleTabs.push(allAvailableTabs[currentIndex]);
//     }

//     if (currentIndex > 0) {
//       visibleTabs.unshift(allAvailableTabs[currentIndex - 1]);
//     }

//     if (currentIndex !== -1 && currentIndex < allAvailableTabs.length - 1) {
//       visibleTabs.push(allAvailableTabs[currentIndex + 1]);
//     }
    
//     if (allAvailableTabs.length >= 2) {
//       if (visibleTabs.length === 1 && currentIndex === 0) {
//         if (allAvailableTabs[1]) visibleTabs.push(allAvailableTabs[1]);
//       } else if (visibleTabs.length === 1 && currentIndex === allAvailableTabs.length - 1) {
//         if (allAvailableTabs[allAvailableTabs.length - 2]) visibleTabs.unshift(allAvailableTabs[allAvailableTabs.length - 2]);
//       } else if (visibleTabs.length === 0 && allAvailableTabs.length > 0) {
//         visibleTabs.push(allAvailableTabs[0]);
//       }
//     }
//     return visibleTabs;
//   };

//   const visibleTabs = getVisibleTabs(activeTabValue);

//   // Helper function to get the dynamic header title
//   const getHeaderTitle = () => {
//     if (activeTabValue === "Work force") {
//       return "Manpower";
//     } else if (activeTabValue === "Photos") {
//       return "Photos";
//     } else {
//       return "Milestones"; // For all other work header tabs
//     }
//   };
//   const headerTitle = getHeaderTitle(); // Call the helper function


//   const moveToPreviousTab = () => {
//     const allTabs = getAllAvailableTabs();
//     const currentIndex = allTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);

//     if (currentIndex > 0) { // Only move back if not on the first tab
//       const previousTab = allTabs[currentIndex - 1];
//       setActiveTabValue(previousTab.project_work_header_name);
//       return true;
//     }
//     return false; // Already on the first tab
//   };

//   return (
//     <div className="flex flex-col h-full overflow-y-auto">
//       <div className="sticky top-0 w-full bg-gray-100 shadow-sm p-4 z-20">
//   <div className="flex justify-between items-center ">
//     <div className="flex flex-col">
//       {/* Dynamic Step and Title */}
//       <span className="text-base font-semibold text-gray-800">
//         Step {currentIndex + 1}/{allAvailableTabs.length}: {headerTitle} 
//       </span>
//       {/* Conditional subtitle for "Work force" tab */}
//       {activeTabValue === "Work force" ? (
//         <span className="text-sm text-gray-600">Specify the workforce details</span>
//       ):(
//         activeTabValue ==="Photos"?(
//           <span className="text-sm text-gray-600">Specify the Photos Proof</span>
//         ):(
//           <span className="text-sm text-gray-600">Specify the Milestones details</span>
//         )
//       )}
//       {reportZone && (
//         <span className="text-xs text-gray-600">Zone: {reportZone}</span>
//       )}
//     </div>
//     <div className="flex flex-col items-end">
//       {/* Dynamic Report Date */}
//       <span className="text-base font-semibold text-gray-800">
//         {summaryWorkDate && formatDate(summaryWorkDate)}
//       </span>
//       <span className="text-xs text-gray-500">Report Date</span>
//     </div>
//   </div>
// </div>
//       {draftMessage&&<div className="text-center text-sm bg-red-400 border p-1 rounded-md mb-2">
//         {draftMessage}
//         </div>}
      
//       <div className="flex-1 mt-1">
//         <div className="px-1 bg-white">
//           <Tabs value={activeTabValue} className="w-full" onValueChange={setActiveTabValue}>
//             <TabsList
//               className="flex w-full justify-evenly p-1 bg-gray-100 rounded-md "
//             >

//         {visibleTabs.map((tab, index, arr) => {
//     const currentActiveTabIndex = arr.findIndex(
//       (t) => t.project_work_header_name === activeTabValue
//     );
    
//     const isUpcoming = currentActiveTabIndex !== -1 && index > currentActiveTabIndex;
//     return (
//       <TabsTrigger
//         key={tab.name || tab.project_work_header_name}
//         value={tab.project_work_header_name}
//         disabled={isUpcoming || isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//         className={`
//           flex-none                    
//           w-auto                        
//           max-w-[150px]                 
//           truncate overflow-hidden whitespace-nowrap 
//           text-xs p-2 rounded-md   
//           font-semibold     
//           data-[state=active]:bg-white data-[state=active]:text-red-500
//           data-[state=active]:font-bold 
          
//           disabled:opacity-50 disabled:cursor-not-allowed
//           disabled:bg-gray-50 disabled:text-gray-700
          
          
//           md:flex-1 md:max-w-none md:w-auto
//           transition-colors duration-200 ease-in-out
//         `}
//       >
//         {tab.project_work_header_name =="Work force"?"Manpower":tab.project_work_header_name}
//       </TabsTrigger>
//     );
//   })}
// </TabsList>
            

//             <TabsContent value="Work force" className="mt-4 p-0">
//               {/* <Card className="shadow-none border-none"> */}
//                    {/*<CardHeader className="pt-0">
//                 <CardTitle className="text-base font-semibold text-gray-800">
//                     <div className="flex justify-between "><span>Man power </span><span className=" text-sm border border-2 rounded-md p-1"> 
//                           Report Date: {summaryWorkDate && formatDate(summaryWorkDate)}</span>
//                           </div>

//                           </CardTitle>
//                 </CardHeader> */}
//                 {/* <CardContent className="space-y-4"> */}
//                 {
//                   summaryManpowerRoles.reduce((sum, item) => sum + item.count, 0).toString().padStart(2, "0") >0 ?(


//                     <Card className="bg-white p-4 shadow-sm rounded-lg">
//                     <CardContent className="p-0">
//                       <div className="flex justify-between font-semibold text-sm mb-2 border-b pb-2">
//                         <span>Team /Roles</span>
//                         <span>
//                           Count ({summaryManpowerRoles.reduce((sum, item) => sum + item.count, 0).toString().padStart(2, "0")})
//                         </span>
//                       </div>
//                       <div className="space-y-2">
//                         {summaryManpowerRoles.length > 0 ? (
//                           summaryManpowerRoles
//                             .map((role, index) => (
//                               <div key={role.id || index} className="flex justify-between text-sm text-gray-700">
//                                 <span>
//                                   {index + 1}. {role.label}
//                                 </span>
//                                 <span>{role.count.toString().padStart(2, "0")}</span>
//                               </div>
//                             ))
//                         ) : (
//                           fullManpowerDetails.map((role, index) => (
//                             <div key={role.id} className="flex justify-between text-sm text-gray-700">
//                               <span>
//                                 {index + 1}. {role.label}
//                               </span>
//                               <span>0</span>
//                             </div>
//                           ))
//                         )}
//                       </div>
//                     </CardContent>
//                   {/* <div className="flex items-center justify-between mt-4 gap-20"> 
//     <Button
//       className="bg-gray-600 hover:bg-gray-700"
//       onClick={openUpdateManpowerDialog}
//       disabled={isBlockedByDraftOwnership}
//     >
//       Edit
//     </Button>

//     <Button
//       className="bg-red-600 hover:bg-red-700 text-white"
//        onClick={() => handleSyncAndSubmitAllData(false)}
//       disabled={isBlockedByDraftOwnership}
//     >
//       Continue
//     </Button>
// </div> */}
// <div className="flex items-center mt-4 gap-4 w-full"> 

//     <Button
//       // Removed w-1/2. Added flex-1.
//          variant="outline"
//       className="flex-1 text-red-600 border-red-600"
//       onClick={openUpdateManpowerDialog}
//       disabled={isBlockedByDraftOwnership}
//     >
//       Edit
//     </Button>

//     <Button
//       // Removed w-1/2. Added flex-1.
//       className="bg-red-600 hover:bg-red-700 flex-1 text-white" 
    
//        onClick={() => handleSyncAndSubmitAllData(false)}
//       disabled={isBlockedByDraftOwnership}
//     >
//       Continue
//     </Button>
// </div>


//                 </Card>
               
                  

//                   ):(
//                     <div className="flex items-center justify-center mt-4">

//                     {/* <Button
//                       className="bg-red-600 hover:bg-red-700 text-white"
//                       onClick={openUpdateManpowerDialog}
//                       disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//                     >
//                          Add Manpower 
//                     </Button> */}
//                      <Button
//               variant="outline"
//               className="flex items-center gap-2 text-red-600 border-red-600"
//               onClick={openUpdateManpowerDialog}
//                       disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//             >
//               <PlusCircledIcon className="h-4 w-4" /> Add Manpower Details
//             </Button>
//                   </div>
//                   )
//                 }
                  
//                 {/* </CardContent> */}
//               {/* </Card> */}
//             </TabsContent>
            
//       <TabsContent value="Photos" className="mt-4 p-1">
//       <Card className="border-none shadow-none bg-transparent">
//         <CardHeader className="flex flex-col items-center pb-4 pt-0">
//           {/* <Button
//             className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-8 rounded-full shadow-md transition-all duration-200 ease-in-out transform hover:scale-105 "
//             onClick={() => setIsCaptureDialogOpen(true)}
//             disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//           >
//           <PlusCircledIcon className="h-5 w-5 mr-2" />
//               <span> ADD PHOTOS</span>
//           </Button> */}
//            <PhotoPermissionChecker

      
//     </TabsContent>
// {/* 
//             {allAvailableTabs.map((tab) => (
//               tab.project_work_header_name !== "Work force" && tab.project_work_header_name!=="Photos"? (
//                 <TabsContent key={tab.name || tab.project_work_header_name} value={tab.project_work_header_name} className="p-1">
//                   <Card>
//                     <CardHeader className="border-b">
//                       <CardTitle >{tab.project_work_header_name} {currentTabMilestones.length}</CardTitle>
//                     </CardHeader>
//                     <CardContent>
//                       {currentTabMilestones && currentTabMilestones.length > 0 ? (
//                           <div className="">
//                             {currentTabMilestones.map(milestone => (
//                               <div key={milestone.name} className="py-2 border-b">
//                                  <p className={`w-fit px-2 py-0.5 text-sm font-semibold rounded ${getStatusColor(milestone.status)}`}>
//                                     {milestone.status}
//                                 </p>
//                                 <div className="flex justify-between items-center mb-2">
//                                   <h4 className="font-bold text-lg">{milestone.work_milestone_name}</h4>
//                                 </div>
//                                 <p >
//                                   <span className="font-semibold test-md">{milestone.progress}%</span> <span className="test-sm text-gray-600">completed</span>
//                                 </p>
//                                  <div className="flex justify-between items-end w-full mt-2">
            
//                                     {milestone?.status !== 'Not Applicable' && milestone.status!=="Completed" &&( 
//                                         <div className="text-sm text-gray-600 flex flex-col items-start">
//                                             <span>
//                                                 Expected date of {milestone.status === 'Not Started' ? 'Starting' : 'completion'}
//                                             </span>
                                            
//                                             <span className="font-semibold text-gray-800 flex items-center mt-0.5 border-2 border-gray-300 p-2 rounded-md">
//                                                 <CalendarIcon className="h-4 w-4 mr-1 text-gray-500" />
//                                                 {milestone.status === 'Not Started' ? (milestone.expected_starting_date || '--') : (milestone.expected_completion_date || '--')}
//                                             </span>
//                                         </div>)}
           
            
//                                           <div className="flex-shrink-0 ml-auto">
//                                             <Button 
//                                                                   onClick={() => openUpdateMilestoneDialog(milestone)}
//                                                                   variant={milestone.is_updated_for_current_report ? 'default' : 'secondary'}
//                                                                   className={!milestone.is_updated_for_current_report && milestone.status !== 'Not Applicable' ? 'border-red-500 text-red-500 hover:bg-red-50' : ''}
//                                                                   disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//                                                                 >
//                                                                   {milestone.is_updated_for_current_report ? 'EDITED' : 'UPDATE'}
//                                                                 </Button>
//                                           </div>
//                                  </div>
//                               </div>
//                             ))}
//                           </div>
//                         ) : (
//                           <p className="text-gray-500">No milestones found for this section.</p>
//                         )
//                       }
//                     </CardContent>
//                   </Card>
//                 </TabsContent>


//               ) : null
//             ))} */}

// {allAvailableTabs.map((tab) => {
//               if (tab.project_work_header_name !== "Work force" && tab.project_work_header_name !== "Photos") {
//                 // --- Start of new calculation for this specific tab ---
//                 // const dateString = formatDate(summaryWorkDate);
//                 // const storageKey = `project_${projectId}_date_${dateString}_tab_${tab.project_work_header_name}`;
//                 // const storedTabData = sessionStorage.getItem(storageKey);

//                 // let milestonesForThisTab: LocalMilestoneData[] = [];

//                 // if (storedTabData) {
//                 //   const parsedTabData: ProjectProgressReportData = JSON.parse(storedTabData);
//                 //   milestonesForThisTab = parsedTabData.milestones || [];
//                 // }

//                 // // If no local data or local data has no milestones, fallback to inherited
//                 // if (milestonesForThisTab.length === 0) {
//                 //     milestonesForThisTab = getInheritedMilestones(tab.project_work_header_name);
//                 // }

//                 const updatedMilestonesCount = currentTabMilestones.filter(m => m.is_updated_for_current_report).length;
//                 const totalMilestonesCount =  currentTabMilestones.length;
//                 // --- End of new calculation for this specific tab ---
//                 const colorCount=totalMilestonesCount==updatedMilestonesCount

//                 return (
//                   <TabsContent key={tab.name || tab.project_work_header_name} value={tab.project_work_header_name} className="p-1">
//                     <Card>
//                       <CardHeader className="border-b">
//                         <CardTitle >
//                           {tab.project_work_header_name}
//                         </CardTitle>
//                         {/* NEW LINE: Displaying the updated milestones count */}
//                         {totalMilestonesCount > 0 && ( // Only show this line if there are milestones to count
//                           <p className={`text-sm ${colorCount?"text-green-500":"text-red-500"} mt-1`}>
//                              {updatedMilestonesCount}/{totalMilestonesCount} milestones updated
//                           </p>
//                         )}
//                       </CardHeader>
//                       <CardContent>
//                         {currentTabMilestones && currentTabMilestones.length > 0 ? (
//                             <div className="">
//                               {currentTabMilestones.map(milestone => (
//                                 <div key={milestone.name} className="py-2 border-b">
//                                    <p className={`w-fit px-2 py-0.5 text-sm font-semibold rounded ${getStatusColor(milestone.status)}`}>
//                                       {milestone.status}
//                                   </p>
//                                   <div className="flex justify-between items-center mb-2">
//                                     <h4 className="font-bold text-lg">{milestone.work_milestone_name}</h4>
//                                   </div>
//                                   <p >
//                                     <span className="font-semibold test-md">{milestone.progress}%</span> <span className="test-sm text-gray-600">completed</span>
//                                   </p>
//                                    <div className="flex justify-between items-end w-full mt-2">
              
//                                       {milestone?.status !== 'Not Applicable' && milestone.status!=="Completed" &&( 
//                                           <div className="text-sm text-gray-600 flex flex-col items-start">
//                                               <span>
//                                                   Expected date of {milestone.status === 'Not Started' ? 'Starting' : 'completion'}
//                                               </span>
                                              
//                                               <span className="font-semibold text-gray-800 flex items-center mt-0.5 border-2 border-gray-300 p-2 rounded-md">
//                                                   <CalendarIcon className="h-4 w-4 mr-1 text-gray-500" />
//                                                   {milestone.status === 'Not Started' ? (milestone.expected_starting_date || '--') : (milestone.expected_completion_date || '--')}
//                                               </span>
//                                           </div>)}
             
              
//                                             {/* <div className="flex-shrink-0 ml-auto">
//                                               <Button 
//                                                                     onClick={() => openUpdateMilestoneDialog(milestone)}
//                                                                     variant={milestone.is_updated_for_current_report ? 'default' : 'secondary'}
//                                                                     className={!milestone.is_updated_for_current_report && milestone.status !== 'Not Applicable' ? 'border-red-500 text-red-500 hover:bg-red-50' : ''}
//                                                                     disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//                                                                   >
//                                                                     {milestone.is_updated_for_current_report ? 'EDIT' : 'UPDATE'}
//                                                                   </Button>
//                                             </div> */}
//                                             <div className="flex-shrink-0 ml-auto">
//   {milestone.is_updated_for_current_report ? (
//     // Button for 'EDIT' (when milestone is updated)
//     <Button
//       onClick={() => openUpdateMilestoneDialog(milestone)}
//       className="bg-gray-200 text-gray-800 hover:bg-gray-300 flex items-center gap-1" // Gray background, dark text, hover, and flex for icon
//       disabled={isBlockedByDraftOwnership}
//     >
//       <CheckCircle className="h-4 w-4 text-green-700 mr-1" /> {/* Green tick icon */}
//       EDIT
//     </Button>
//   ) : (
//     // Button for 'UPDATE' (when milestone is not updated)
//     <Button
//       onClick={() => openUpdateMilestoneDialog(milestone)}
//       className="bg-red-600 text-white border border-gray-300 hover:bg-red-700" // Red background, white text, gray border, hover
//       disabled={isBlockedByDraftOwnership}
//     >
//       UPDATE
//     </Button>
//   )}
// </div>
//                                    </div>
//                                 </div>
//                               ))}
//                             </div>
//                           ) : (
//                             <p className="text-gray-500">No milestones found for this section.</p>
//                           )
//                         }
//                       </CardContent>
//                     </Card>
//                   </TabsContent>
//                 );
//               }
//               return null;
//             })}

//           </Tabs>
//         </div>
//       </div>

//       {/* <div className="sticky bottom-0 w-full p-2 bg-white border-t z-10">
//         <Button
//           className="w-full bg-red-600 hover:bg-red-700 text-white text-lg py-3"
//           onClick={() => handleSyncAndSubmitAllData(false)}
//           disabled={isGlobalSyncDisabled} // MODIFIED: Uses combined disabled state
//         >
//           {isGlobalSyncDisabled && isFrappeOperationLoading ? ( // Only show spinner if actually loading
//             <TailSpin height={20} width={20} color="#fff" />
//           ) : isLastTab ? (
//             "Submit Final Report"
//           ) : (
//             `Save & Continue to Next Tab`
//           )}
//         </Button>
//         <div className="text-center mt-2 text-sm text-gray-500">
//           Tab {currentIndex + 1} of {allAvailableTabs.length}
//         </div>
//       </div> */}
//       <div className="sticky bottom-0 w-full p-2 bg-white border-t z-10">
//         <div className="flex items-center gap-4"> {/* Flex container for both buttons */}
//           {currentIndex > 0 && ( // Show 'Back' button only if not on the first tab
//             <Button
//              variant="outline"
//               className="flex-1 text-red-600 border-red-600  text-lg py-3 "
//               onClick={() => moveToPreviousTab()}
//               disabled={isGlobalSyncDisabled}
//             >
//               Back
//             </Button>
//           )}

//           <Button
//             // Use flex-1 to make it take available space.
//             // If 'Back' is present, they share. If not, it expands.
//             className="flex-1 bg-red-600 hover:bg-red-700 text-white text-lg py-3"
//             onClick={() => handleSyncAndSubmitAllData(false)}
//             disabled={isGlobalSyncDisabled}
//           >
//             {isGlobalSyncDisabled && isFrappeOperationLoading ? (
//               <TailSpin height={20} width={20} color="#fff" />
//             ) : isLastTab ? (
//               "Submit Final Report"
//             ) : (
//               `Save & Continue` // Simplified text
//             )}
//           </Button>
//         </div>
//         {/* Removed the old Tab X of X display as it's now in the header */}
//       </div>

//       <Dialog open={isUpdateManpowerDialogOpen} onOpenChange={setIsUpdateManpowerDialogOpen}>
//         <DialogContent className="max-w-[425px] max-h-[70vh] overflow-y-auto lg:max-w-[425px] lg:max-h-[90vh] lg:overflow-y-auto">
//           <DialogHeader>
//             <DialogTitle className="text-xl text-center font-bold text-red-600">Update Manpower</DialogTitle>
//             <DialogDescription className="text-sm text-center">
//               Edit manpower counts, add new roles, and provide remarks for the selected date.
//             </DialogDescription>
//           </DialogHeader>
//           <div className="grid gap-4 py-4">
//             <div className="flex justify-between items-center text-sm font-medium">
//               <span>Project: <span className="text-red-600">{projectData?.project_name || "Not Applicable"}</span></span>
//               <div className="flex items-center gap-2">
//               </div>
//             </div>

//             <div className="space-y-3">
//               {dialogManpowerRoles.map((manpowerItem, index) => (
//                 <div key={manpowerItem.id || index} className="flex items-center gap-2">
//                   {manpowerItem.id?.startsWith('new_role_') ? (
//                     <>
//                     {![
//   "MEP Engineer",
//   "Safety Engineer",
//   "Electrical Team",
//   "Fire Fighting Team",
//   "Data & Networking Team",
//   "HVAC Team",
//   "ELV Team",
// ].includes(manpowerItem.label) && (
//       <Button
//         variant="destructive"
//         className="h-8 w-8 p-0"
//         onClick={() => handleRemoveManpowerRole(index)}
//       >
//         <X className="h-4 w-4" />
//         <span className="sr-only">Remove Role</span>
//       </Button>
//     )}
//     <Input
//                       type="text"
//                       value={manpowerItem.label}
//                       onChange={(e) => handleDialogRoleNameChange(index, e.target.value)}
//                       className="flex-1 text-sm"
//                       placeholder="Enter role name"
//                       disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//                     />
//                     </>
                    
//                   ) : (
//                     <label className="flex-1 text-sm">{manpowerItem.label}</label>
//                   )}
                  
//                   <Input
//                     type="number"
//                     value={manpowerItem.count.toString()}
//                     onChange={(e) => handleDialogManpowerCountChange(index, e.target.value)}
//                     className="w-20 text-center"
//                     disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//                   />
                  
//                 </div>
                
//               ))}
//             </div>

//             <Button
//               variant="outline"
//               className="w-full flex items-center gap-2 text-red-600 border-red-600"
//               onClick={handleAddManpowerRole}
//               disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//             >
//               <PlusCircledIcon className="h-4 w-4" /> Add Manpower
//             </Button>

//             <div>
//               <label htmlFor="dialog-remarks" className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
//               <Textarea
//                 id="dialog-remarks"
//                 value={dialogRemarks}
//                 onChange={(e) => setDialogRemarks(e.target.value)}
//                 placeholder="Enter Remarks"
//                 className="min-h-[80px]"
//                 disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//               />
//             </div>
//           </div>
//           <div className="flex justify-end gap-2">
//             <DialogClose asChild>
//               <Button variant="outline">Cancel</Button>
//             </DialogClose>
//             <Button
//               className="bg-red-600 hover:bg-red-700 text-white"
//               onClick={() => handleSyncAndSubmitAllData(true)}
//               disabled={isGlobalSyncDisabled} // MODIFIED: Uses combined disabled state
//             >
//               {isGlobalSyncDisabled && isFrappeOperationLoading ? <TailSpin height={20} width={20} color="#fff" /> : "Save"}
//             </Button>
//           </div>
//         </DialogContent>
//       </Dialog>


//     <Dialog open={isUpdateMilestoneDialogOpen} onOpenChange={setIsUpdateMilestoneDialogOpen}>
 
//     <DialogContent className="max-w-[425px] max-h-[70vh] overflow-y-auto lg:max-w-[425px] lg:max-h-[70vh] lg:overflow-y-auto">
        
//         <DialogHeader className="p-2 pb-4 border-b">
//             <div className="flex justify-center items-center">
//                 <DialogTitle className="text-xl font-bold text-red-600">
//                     {/* {selectedMilestoneForDialog?.work_milestone_name || "Milestones Update"} */}
//                     {"Milestones Update"}
//                 </DialogTitle>
                
//             </div>
            
//             <div className="flex justify-between text-sm font-medium mt-2">
//                 <div className="text-left">
//                     <p className="font-semibold">Work</p>
//                     <p className="text-sm text-gray-700">{selectedMilestoneForDialog?.work_milestone_name || 'Sprinklers'}</p>
//                 </div>
//                 <div className="text-right">
//                     <p className="font-semibold">Package</p>
//                     <p className="text-sm text-gray-700">{activeTabValue || 'Ducting'}</p> 
//                 </div>
//             </div>
//         </DialogHeader>
        
//         <div className="space-y-2 py-4 px-6">
            
//             <div className="flex justify-between items-center text-sm font-medium">
//                 <div className="flex flex-col items-start">
//                     <span className="text-gray-900">Pervious Status</span>
//                     <span className="px-2 py-1 rounded-full text-xs font-semibold bg-red-500 text-white mt-1">
//                         {selectedMilestoneForDialog?.status || 'Not Applicable'}
//                     </span>
//                 </div>
                
//                 <div className="flex flex-col items-end">
//                     <span className="text-red-600 font-semibold text-lg">{selectedMilestoneForDialog?.progress || '0%'}</span>
//                     <span className="text-gray-700 text-sm">% Completed</span>
//                 </div>
                
//             </div>
            
//             <hr className="border-gray-200" />
            
//             <div className="flex flex-col">
//                 <label className="block text-base font-semibold text-gray-900 mb-2">Select New Status</label>
//                 <div className="grid grid-cols-2 gap-3">
//                   <Button 
//                         className={`py-3 text-sm font-semibold ${newStatus === 'Not Applicable' ? 'bg-gray-700 text-white hover:bg-gray-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
//                         onClick={() => setNewStatus('Not Applicable')}
//                         disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//                     >
//                         Not Applicable
//                     </Button>

//                     <Button 
//                         className={`py-3 text-sm font-semibold ${newStatus === 'Not Started' ? 'bg-red-700 text-white hover:bg-red-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
//                         onClick={() => setNewStatus('Not Started')}
//                         disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//                     >
//                         Not Started
//                     </Button>

                    
//                     <Button 
//                         className={`py-3 text-sm font-semibold ${newStatus === 'WIP' ? 'bg-yellow-400 text-gray-900 hover:bg-yellow-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
//                         onClick={() => setNewStatus('WIP')}
//                         disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//                     >
//                         WIP
//                     </Button>
                     
//                     <Button 
//                         className={`py-3 text-sm font-semibold ${newStatus === 'Completed' ? 'bg-green-400 text-white hover:bg-green-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
//                         onClick={() => setNewStatus('Completed')}
//                         disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//                     >
//                         Completed
//                     </Button>
//                 </div>
//             </div>

//             {(newStatus === 'WIP') && (
//                 <div>
//                     <label className="block text-base font-semibold text-gray-900 mb-1">Percentage Completed</label>
//                     <div className="relative">
//                         <Input
//                             type="number"
//                             value={progress||null}
//                             onChange={(e) => setProgress(Math.max(0, Math.min(99, Number(e.target.value))))}
//                             min={0}
//                             max={100}
//                             className="pr-8 h-10 text-base"
//                             disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//                         />
//                         <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
//                     </div>
//                 </div>
//             )}
            
//             {/* {(newStatus == 'Not Started' || newStatus == 'WIP')&&(
//   <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Expected {newStatus === 'Not Started' ? 'Starting' : 'Completion'} Date
//                 </label>
//                 <Popover open={isMilestoneDatePickerOpen} onOpenChange={setIsMilestoneDatePickerOpen}>
//                     <PopoverTrigger asChild>
//                         <Button
//                             variant={"outline"}
//                             className={"w-full justify-start text-left font-normal h-10 text-base border-gray-300"}
//                             disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//                         >
//                             <CalendarIcon className="mr-2 h-4 w-4 text-gray-500" />
//                             {expectedDate ? formatDate(expectedDate) : ""}
//                         </Button>
//                     </PopoverTrigger>
//                     <PopoverContent className="w-auto p-0">
//                         <Calendar
//                             mode="single"
//                             selected={expectedDate || undefined}
//                             onSelect={(date) => {
//                                 setExpectedDate(date || null);
//                                 setIsMilestoneDatePickerOpen(false);
//                             }}
//                             initialFocus
//                         />
//                     </PopoverContent>
//                 </Popover>
//             </div>

//             )} */}

//             {/* Conditional Date Picker for 'Not Started' */}
//             {newStatus === 'Not Started' && (
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Expected Starting Date
//                 </label>
//                 <Popover open={isMilestoneDatePickerOpen} onOpenChange={setIsMilestoneDatePickerOpen}>
//                     <PopoverTrigger asChild>
//                         <Button
//                             variant={"outline"}
//                             className={"w-full justify-start text-left font-normal h-10 text-base border-gray-300"}
//                             disabled={isBlockedByDraftOwnership}
//                         >
//                             <CalendarIcon className="mr-2 h-4 w-4 text-gray-500" />
//                             {expectedDate ? formatDate(expectedDate) : "Select starting date"} {/* Changed placeholder */}
//                         </Button>
//                     </PopoverTrigger>
//                     <PopoverContent className="w-auto p-0">
//                         <Calendar
//                             mode="single"
//                             selected={expectedDate || undefined}
//                             onSelect={(date) => {
//                                 setExpectedDate(date || null);
//                                 setIsMilestoneDatePickerOpen(false);
//                             }}
//                             initialFocus
//                         />
//                     </PopoverContent>
//                 </Popover>
//               </div>
//             )}

//             {/* Conditional Date Picker for 'WIP' */}
//             {(newStatus === 'WIP' && progress>75) && (
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Expected Completion Date
//                 </label>
//                 <Popover open={isMilestoneDatePickerOpen} onOpenChange={setIsMilestoneDatePickerOpen}>
//                     <PopoverTrigger asChild>
//                         <Button
//                             variant={"outline"}
//                             className={"w-full justify-start text-left font-normal h-10 text-base border-gray-300"}
//                             disabled={isBlockedByDraftOwnership}
//                         >
//                             <CalendarIcon className="mr-2 h-4 w-4 text-gray-500" />
//                             {expectedDate ? formatDate(expectedDate) : "Select completion date"} {/* Changed placeholder */}
//                         </Button>
//                     </PopoverTrigger>
//                     <PopoverContent className="w-auto p-0">
//                         <Calendar
//                             mode="single"
//                             selected={expectedDate || undefined}
//                             onSelect={(date) => {
//                                 setExpectedDate(date || null);
//                                 setIsMilestoneDatePickerOpen(false);
//                             }}
//                             initialFocus
//                         />
//                     </PopoverContent>
//                 </Popover>
//               </div>
//             )}
          
          
//            {
//             (newStatus === 'WIP' ||newStatus === 'Not Started') && (
// <>
//   {/* --- NEW SECTION: Work Plan Ratio Toggle --- */}
//     <div className="flex flex-col">
//         <label className="block text-base font-semibold text-gray-900 mb-2">Activities Planned for Today </label>
//         <div className="grid grid-cols-2 gap-3">
//             {/* <Button 
//                 className={`py-3 text-sm font-semibold ${workPlanRatio === 'Plan Not Required' ? 'bg-gray-700 text-white hover:bg-gray-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
//                 onClick={() => {
//                     setWorkPlanRatio('Plan Not Required');
//                     // Optionally clear points when plan is not required
//                     setWorkPlanPoints([""]); 
//                 }}
//                 disabled={isBlockedByDraftOwnership}
//             >
//                 Nothing
//             </Button>
//             <Button 
//                 className={`py-3 text-sm font-semibold ${workPlanRatio === 'Plan Required' ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
//                 onClick={() => setWorkPlanRatio('Plan Required')}
//                 disabled={isBlockedByDraftOwnership}
//             >
//                 Record Activities 
//             </Button> */}
//             <Button 
//             className={`py-3 text-sm font-semibold flex items-center justify-center 
//                 ${workPlanRatio === 'Plan Not Required' 
//                     ? 'bg-gray-700 text-white hover:bg-gray-500' 
//                     : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
//             onClick={() => {
//                 setWorkPlanRatio('Plan Not Required');
//                 // Optionally clear points when plan is not required
//                 setWorkPlanPoints([""]); 
//             }}
//             disabled={isBlockedByDraftOwnership}
//         >
//             <RadioIndicator 
//                 isActive={workPlanRatio === 'Plan Not Required'} 
//                 isDisabled={isBlockedByDraftOwnership} 
//             />
//             Nothing
//         </Button>
        
//         {/* Button 2: Plan Required (Record Activities) */}
//         <Button 
//             className={`py-3 text-sm font-semibold flex items-center justify-center 
//                 ${workPlanRatio === 'Plan Required' 
//                     ? 'bg-blue-600 text-white hover:bg-blue-500' 
//                     : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
//             onClick={() => setWorkPlanRatio('Plan Required')}
//             disabled={isBlockedByDraftOwnership}
//         >
//             <RadioIndicator 
//                 isActive={workPlanRatio === 'Plan Required'} 
//                 isDisabled={isBlockedByDraftOwnership} 
//             />
//             Record Activities 
//         </Button>
//         </div>
//     </div>
//     {/* --- END NEW SECTION --- */}
//      {workPlanRatio === 'Plan Required' && (
//         <div className="space-y-3 p-2 border border-blue-200 rounded-lg bg-blue-50">
//             <label className="block text-base font-semibold text-gray-900 mb-1 flex items-center justify-between">
//                 <span>Activity Details</span><span className='text-xs font-normal text-gray-600 ml-2'> <Button
//                 variant="outline"
//                 className="w-full flex items-center gap-2 text-blue-600 border-blue-600"
//                 onClick={() => setWorkPlanPoints(prev => [...prev, ""])}
//                 disabled={isBlockedByDraftOwnership}
//             >
//                 <PlusCircledIcon className="h-4 w-4" /> New Point
//             </Button></span>
//             </label>
//             <div className="space-y-2">
//                 {workPlanPoints.map((point, index) => (
//                     <div key={index} className="flex items-start gap-2">
//                         {workPlanPoints.length > 1 && (
//                             <Button
//                                 variant="destructive"
//                                 size="icon"
//                                 className="h-7 w-7 p-0 flex-shrink-0 mt-0.5"
//                                 onClick={() => setWorkPlanPoints(prev => prev.filter((_, i) => i !== index))}
//                                 disabled={isBlockedByDraftOwnership}
//                             >
//                                 <X className="h-4 w-4" />
//                             </Button>
//                         )}
//                         <Textarea
//                             value={point}
//                             onChange={(e) => {
//                                 const newPoints = [...workPlanPoints];
//                                 newPoints[index] = e.target.value;
//                                 setWorkPlanPoints(newPoints);
//                             }}
//                             placeholder={`Point ${index + 1}...`}
//                             className="flex-grow min-h-[40px] text-sm"
//                             rows={1}
//                             disabled={isBlockedByDraftOwnership}
//                         />
//                     </div>
//                 ))}
//             </div>
//             {/* <Button
//                 variant="outline"
//                 className="w-full flex items-center gap-2 text-blue-600 border-blue-600"
//                 onClick={() => setWorkPlanPoints(prev => [...prev, ""])}
//                 disabled={isBlockedByDraftOwnership}
//             >
//                 <PlusCircledIcon className="h-4 w-4" /> Add New Point
//             </Button> */}
//         </div>
//     )}
//     {/* --- END NEW SECTION --- */}
// </>
//             )
//            }
          


   
//             <div>
//                 <label className="block text-base font-semibold text-gray-900 mb-1">Remarks</label>
//                 <Textarea
//                     value={milestoneRemarks}
//                     onChange={(e) => setMilestoneRemarks(e.target.value)}
//                     placeholder="Enter Remarks"
//                     className="min-h-[100px] text-base"
//                     disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//                 />
//             </div>
//         </div>
        
//         <div className="flex justify-between gap-4 p-4">
//             <Button 
//                 variant="outline" 
//                 className="w-full border-red-500 text-red-500 hover:bg-red-50 border-2 text-base h-12"
//                 onClick={handleUpdateMilestone}
//                 disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//             >
//                 Save as it is
//             </Button>
//             <Button 
//                 className="w-full bg-red-600 hover:bg-red-700 text-white text-base h-12"
//                 onClick={handleUpdateMilestone}
//                 disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//             >
//                 Update
//             </Button>
//         </div>
//     </DialogContent>
// </Dialog>

//         <Dialog open={isCaptureDialogOpen} onOpenChange={setIsCaptureDialogOpen}>
//     <DialogContent className=" max-w-[70vh] max-w-[600px] lg:max-w-[90vw] lg:max-w-[600px] p-0 border-none bg-transparent">
//                <DialogClose className="absolute right-4 top-4 h-8 w-8 rounded-full flex items-center justify-center bg-white/10 text-white transition-colors duration-200 hover:bg-white/20 focus:outline-none  z-30">
//             <X className="h-5 w-5" /> {/* Smaller X for better fit in 8x8 circle */}
//             <span className="sr-only">Close</span>
//         </DialogClose>

//         <DialogHeader className="sr-only">
//             <DialogTitle>Project Photo Capture</DialogTitle>
//             <DialogDescription>Use the camera to capture a new site image and add remarks.</DialogDescription>
//         </DialogHeader>
//         <CameraCapture
//             project_id={projectId}
//             report_date={formatDate(summaryWorkDate)}
//             onCaptureSuccess={handlePhotoCaptureSuccess}
//             onCancel={() => setIsCaptureDialogOpen(false)}
//             GEO_API={apiData?.api_key}
//             disabled={isBlockedByDraftOwnership} // MODIFIED: Disable if blocked
//         />
//     </DialogContent>
// </Dialog>

//     </div>
//   );
// };

// // Wrap the component with Error Boundary
// export const MilestoneTab = () => {
//   const { projectId } = useParams<{ projectId: string }>();

//   return (
//     <ProgressReportErrorBoundary projectId={projectId}>
//       <MilestoneTabInner />
//     </ProgressReportErrorBoundary>
//   );
// };
