// MilestoneTab.tsx
import { useContext, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { UserContext } from "@/utils/auth/UserProvider";
import {
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeCreateDoc,
} from "frappe-react-sdk";
import CameraCapture from "@/components/CameraCapture"; // Ensure this path is correct
import {Camera, X, MapPin } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarIcon, PlusCircledIcon } from "@radix-ui/react-icons";
import { TailSpin } from "react-loader-spinner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";
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

// Interface for the child table in Project Progress Reports
// UPDATED: Reflects only image_link, location, and remarks
interface ProjectProgressAttachment {
  name?: string; // Frappe document name for the row
  local_id: string; // Temporary ID for local state management (FRONTEND ONLY)
  image_link: string; // The uploaded file_url (MATCHES Frappe field)
  location: string | null; // The combined location string (MATCHES Frappe field)
  remarks: string; // General remarks for the photo (MATCHES Frappe field)
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

// Frappe's expected structure for Manpower child table - now using 'label'
interface FrappeManpowerDetail {
  label: string; // Corrected: This MUST match the backend field name
  count: number;
}

interface LocalMilestoneData {
  name: string;
  work_milestone_name: string;
  work_header: string;
  status: 'Not Started' | 'WIP' | 'N/A' | 'Completed';
  progress: number;
  expected_starting_date?: string;
  expected_completion_date?: string;
  remarks?: string;
  is_updated_for_current_report?: boolean; // New field for frontend validation
}

// Interface for data stored locally and retrieved from previous reports (can contain frontend-only fields)
interface ProjectProgressReportData {
  name?: string;
  project: string;
  report_date: string;
  manpower_remarks?: string;
  manpower?: FrappeManpowerDetail[];
  milestones?: LocalMilestoneData[];
  photos?: ProjectProgressAttachment[]; // Add attachments child table
}

// Frappe's expected payload structure (DOES NOT contain frontend-only fields)
// UPDATED: Attachments now conform to the simplified ProjectProgressAttachment
interface FrappeProjectProgressReportPayload {
  project: string;
  report_date: string;
  manpower_remarks?: string;
  manpower?: FrappeManpowerDetail[];
  milestones?: Omit<LocalMilestoneData, 'is_updated_for_current_report'>[];
  attachments?: Omit<ProjectProgressAttachment, 'local_id'>[]; // Frappe expects ProjectProgressAttachment structure without local_id
}


interface WorkMilestoneFromFrappe {
  name: string;
  work_milestone_name: string;
  status: 'Not Started' | 'WIP' | 'N/A' | 'Completed';
  progress: number;
  expected_starting_date: string;
  expected_completion_date: string;
  work_header: string;
}

// Updated interface for the previous report when fetched with full details
interface FullPreviousProjectProgressReport extends ProjectProgressReportData {
  name: string; // Ensure name is present for the full doc
}
// --- END: Refined Interfaces ---


export const MilestoneTab = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { selectedProject, setSelectedProject } = useContext(UserContext);
  const navigate = useNavigate();
  const {
    data: apiData,
    isLoading: apiDataLoading,
  } = useFrappeGetDoc("Map API", {
    fields: ["*"],
  });

  // console.log("MapAPI",apiData)

  const [activeTabValue, setActiveTabValue] = useState("Work force");

  const [isCaptureDialogOpen, setIsCaptureDialogOpen] = useState(false);
  const [localPhotos, setLocalPhotos] = useState<ProjectProgressAttachment[]>([]);
  const getPhotosStorageKey = (dateString: string) => `project_${projectId}_date_${dateString}_tab_Photos`;


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
    enabled: !!projectId,
  });

  const {
    data: previousReportsList,
    isLoading: previousReportsListLoading,
    error: previousReportsListError,
  } = useFrappeGetDocList<{ name: string, project: string, report_date: string }>("Project Progress Reports", {
    fields: ["name", "project", "report_date"],
    filters: [["project", "=", projectId]],
    orderBy: { field: "report_date", order: "desc" },
    limit: 1,
    enabled: !!projectId,
  });

  const latestReportName = previousReportsList?.[0]?.name;

  const {
    data: previousReport,
    isLoading: previousReportLoading,
    error: previousReportError,
  } = useFrappeGetDoc<FullPreviousProjectProgressReport>(
    "Project Progress Reports",
    latestReportName,
    latestReportName ? undefined : null
  );


  const { createDoc, isLoading: isCreatingDoc } = useFrappeCreateDoc();

  // --- STATE FOR MANPOWER TAB ---
  const [dialogManpowerRoles, setDialogManpowerRoles] = useState<ManpowerRole[]>([]);
  const [dialogRemarks, setDialogRemarks] = useState<string>("");
  const [dialogWorkDate, setDialogWorkDate] = useState<Date>(new Date());
  const [isDialogDatePickerOpen, setIsDialogDatePickerOpen] = useState(false);
  const [isUpdateManpowerDialogOpen, setIsUpdateManpowerDialogOpen] = useState(false);
  const [isLocalSaving, setIsLocalSaving] = useState(false);
  const [summaryManpowerRoles, setSummaryManpowerRoles] = useState<ManpowerRole[]>([]);
  const [summaryWorkDate, setSummaryWorkDate] = useState<Date>(new Date());
  const [reportsLoading, setReportsLoading] = useState(false);
  const [localDailyReport, setLocalDailyReport] = useState<ProjectProgressReportData | null>(null);

  // --- STATE FOR MILESTONE DIALOG AND LOCAL MANAGEMENT ---
  const [isUpdateMilestoneDialogOpen, setIsUpdateMilestoneDialogOpen] = useState(false);
  const [selectedMilestoneForDialog, setSelectedMilestoneForDialog] = useState<LocalMilestoneData | null>(null);
  const [newStatus, setNewStatus] = useState<'Not Started' | 'WIP' | 'N/A' | 'Completed' | ''>('');
  const [progress, setProgress] = useState<number>(0);
  const [expectedDate, setExpectedDate] = useState<Date | null>(null);
  const [isMilestoneDatePickerOpen, setIsMilestoneDatePickerOpen] = useState(false);
  const [milestoneRemarks, setMilestoneRemarks] = useState('');

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

  const getManpowerRolesDefault = (): ManpowerRole[] => {
    return fullManpowerDetails.map(item => ({ ...item }));
  };

  const getAllAvailableTabs = () => {
    return [
      { name: "Work force", project_work_header_name: "Work force", enabled: "True" },
      ...(projectData?.enable_project_milestone_tracking === 1 && projectData?.project_work_header_entries
        ? projectData.project_work_header_entries.filter(entry => entry.enabled === "True")
        : []),
          {name:"Photos",project_work_header_name:"Photos",enabled:"True"},
    ];
  };

  const initializeTabStructureInLocalStorage = () => {
    const dateString = formatDate(summaryWorkDate);
    const allTabs = getAllAvailableTabs();
    
    allTabs.forEach(tab => {
      const storageKey = `project_${projectId}_date_${dateString}_tab_${tab.project_work_header_name}`;
      const existingData = localStorage.getItem(storageKey);
      
      if (!existingData) {
        if (tab.project_work_header_name === "Work force") {
          const initialManpowerData: ProjectProgressReportData = {
            project: projectId,
            report_date: dateString,
            manpower_remarks: "",
            manpower: getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count })),
            milestones: [],
            photos: []
          };
          localStorage.setItem(storageKey, JSON.stringify(initialManpowerData));
        } else if (tab.project_work_header_name === "Photos") {
                    const initialPhotoData: Pick<ProjectProgressReportData, 'photos'> = { photos: [] }; 
                    localStorage.setItem(storageKey, JSON.stringify(initialPhotoData));
                }else {
          const inheritedMilestones = getInheritedMilestones(tab.project_work_header_name);
          const initialMilestoneData: ProjectProgressReportData = {
            project: projectId,
            report_date: dateString,
            manpower: [],
            milestones: inheritedMilestones,
            photos: []
          };
          localStorage.setItem(storageKey, JSON.stringify(initialMilestoneData));
        }
      }
    });
  };

    const getInheritedMilestones = (workHeader: string): LocalMilestoneData[] => {
    if (previousReport && previousReport.milestones && previousReport.milestones.length > 0) {
      const previousMilestones = previousReport.milestones.filter(m => {
        return m.work_header === workHeader;
      }) || [];

      if (previousMilestones.length > 0) {
        return previousMilestones.map(milestone => ({
          ...milestone,
          remarks: "",
          is_updated_for_current_report: false,
        }));
      }
    }
    
    const defaultMilestones: LocalMilestoneData[] = [];
    const frappeMilestonesForHeader = allFrappeMilestones?.filter(m => m.work_header === workHeader) || [];
    
    if (frappeMilestonesForHeader.length > 0) {
      frappeMilestonesForHeader.forEach(frappeM => {
        defaultMilestones.push({
          name: frappeM.name,
          work_milestone_name: frappeM.work_milestone_name,
          work_header: frappeM.work_header,
          status: frappeM.status || 'Not Started',
          progress: frappeM.progress || 0,
          expected_starting_date: frappeM.expected_starting_date,
          expected_completion_date: frappeM.expected_completion_date,
          remarks: "",
          is_updated_for_current_report: false,
        });
      });
    }
    return defaultMilestones;
  };

  const loadDailyReport = () => {
    setReportsLoading(true);
    const dateString = formatDate(summaryWorkDate);
    const storageKey = `project_${projectId}_date_${dateString}_tab_${activeTabValue}`;
    const storedData = localStorage.getItem(storageKey);

     if(activeTabValue === "Photos") {
            if (storedData) {
                const parsedData: Pick<ProjectProgressReportData, 'photos'> = JSON.parse(storedData);
                setLocalPhotos(parsedData.photos || []);
            } else {
                setLocalPhotos([]);
            }
            setReportsLoading(false);
            return;
        }

    if (storedData) {
      const parsedData: ProjectProgressReportData = JSON.parse(storedData);
      
      if (activeTabValue === "Work force") {
        const fetchedManpower: FrappeManpowerDetail[] = parsedData.manpower || getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count }));
        
        setLocalDailyReport({
          ...parsedData,
          milestones: parsedData.milestones,
          manpower: fetchedManpower
        });
        setDialogManpowerRoles(fetchedManpower.map(item => ({
          id: `dialog_${item.label}`,
          label: item.label,
          count: item.count
        })));
      } else {
        setLocalDailyReport({
          ...parsedData,
          milestones: parsedData.milestones || getInheritedMilestones(activeTabValue),
          manpower: parsedData.manpower || []
        });
      }
    } else {
      setLocalDailyReport(null);
      if (activeTabValue === "Work force") {
        setDialogManpowerRoles(getManpowerRolesDefault());
      } else {
        setLocalDailyReport({
          project: projectId,
          report_date: dateString,
          manpower: [],
          milestones: getInheritedMilestones(activeTabValue),
          photos: []
        });
      }
    }
    setReportsLoading(false);
  };

   // Photo Handlers (updated handlePhotoRemarksChange)
    const handlePhotoCaptureSuccess = (photoData: ProjectProgressAttachment) => {
        console.log("photoData received from CameraCapture:", photoData);
        const newPhotos = [...localPhotos, photoData];
        setLocalPhotos(newPhotos);
        
        const dateString = formatDate(summaryWorkDate);
        const storageKey = getPhotosStorageKey(dateString);
        localStorage.setItem(storageKey, JSON.stringify({ photos: newPhotos }));

        setIsCaptureDialogOpen(false);
        toast({
            title: "Photo Ready! 📸",
            description: `Photo has been added to the report's attachments.`,
            variant: "default",
        });
    };

    // UPDATED: Now updates the 'remarks' field
    const handlePhotoRemarksChange = (local_id: string, remarks: string) => {
        const updatedPhotos = localPhotos.map(p => 
            p.local_id === local_id ? { ...p, remarks: remarks } : p
        );
        setLocalPhotos(updatedPhotos);
        const dateString = formatDate(summaryWorkDate);
        const storageKey = getPhotosStorageKey(dateString);
        localStorage.setItem(storageKey, JSON.stringify({ photos: updatedPhotos }));
    };

    const handleRemovePhoto = (local_id: string) => {
        const updatedPhotos = localPhotos.filter(p => p.local_id !== local_id);
        setLocalPhotos(updatedPhotos);
        
        const dateString = formatDate(summaryWorkDate);
        const storageKey = getPhotosStorageKey(dateString);
        localStorage.setItem(storageKey, JSON.stringify({ photos: updatedPhotos }));
        
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
    if (projectId && !previousReportsListLoading && !previousReportLoading && allFrappeMilestones && projectData) {
      initializeTabStructureInLocalStorage();
      loadDailyReport();
    }
  }, [summaryWorkDate, projectId, activeTabValue, previousReportsListLoading, previousReportLoading, allFrappeMilestones, projectData]);

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
      setDialogManpowerRoles(combinedRoles.map(item => ({
        id: `dialog_${item.label}`,
        label: item.label,
        count: item.count
      })));
    } else if (activeTabValue === "Work force") {
      setSummaryManpowerRoles(getManpowerRolesDefault());
      setDialogRemarks("");
      setDialogManpowerRoles(getManpowerRolesDefault());
    }
  }, [localDailyReport, summaryWorkDate, activeTabValue]);

  useEffect(() => {
    if (activeTabValue === "Work force" || activeTabValue === "Photos" || !allFrappeMilestones) {
      setCurrentTabMilestones([]);
      return;
    }

    const milestonesForCurrentTab: LocalMilestoneData[] = [];
    const localMilestonesFlatArray = localDailyReport?.milestones || getInheritedMilestones(activeTabValue);

    localMilestonesFlatArray.forEach(milestone => {
      if (milestone.work_header === activeTabValue) {
        milestonesForCurrentTab.push(milestone);
      }
    });

    setCurrentTabMilestones(milestonesForCurrentTab);
  }, [activeTabValue, localDailyReport, allFrappeMilestones,previousReport]);

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

  // --- NEW FUNCTION TO ADD ---
  const handleRemoveManpowerRole = (indexToRemove: number) => {
    setDialogManpowerRoles(prevRoles => prevRoles.filter((_, index) => index !== indexToRemove));
    toast({
      title: "Role Removed",
      description: "Manpower role has been removed.",
      variant: "default",
    });
  };
  // --- END NEW FUNCTION ---

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
    const storageKey = `project_${projectId}_date_${dateString}_tab_${activeTabValue}`;

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
        photos: []
      };

      localStorage.setItem(storageKey, JSON.stringify(payload));
    } else if (activeTabValue === "Photos") {
            const payload: Pick<ProjectProgressReportData, 'photos'> = { photos: localPhotos };
            localStorage.setItem(storageKey, JSON.stringify(payload));
      }else { // Milestone tabs
      const payload: ProjectProgressReportData = {
        project: projectId,
        report_date: dateString,
        manpower: [],
        milestones: milestoneData || currentTabMilestones,
        photos: []
      };

      localStorage.setItem(storageKey, JSON.stringify(payload));
    }
  };

  const collectAllTabData = (): FrappeProjectProgressReportPayload => {
    const dateString = formatDate(summaryWorkDate);
    const allTabs = getAllAvailableTabs();
    let allManpower: FrappeManpowerDetail[] = [];
    let allMilestones: LocalMilestoneData[] = [];
    let allPhotos: ProjectProgressAttachment[] = [];
    let manpowerRemarks = "";

    allTabs.forEach(tab => {
      const storageKey = `project_${projectId}_date_${dateString}_tab_${tab.project_work_header_name}`;
      const tabData = localStorage.getItem(storageKey);
      
      if (tabData) {
        const parsedData: ProjectProgressReportData = JSON.parse(tabData);
        
        if (tab.project_work_header_name === "Work force") {
          allManpower = parsedData.manpower || [];
          manpowerRemarks = parsedData.manpower_remarks || "";
        } else if (tab.project_work_header_name === "Photos" && parsedData.photos && parsedData.photos.length > 0) {
          allPhotos.push(...parsedData.photos);
        }
        
        if (parsedData.milestones && parsedData.milestones.length > 0) {
          allMilestones.push(...parsedData.milestones);
        }
      }
    });

    const cleanedMilestones = allMilestones.map(milestone => {
      const { is_updated_for_current_report, ...rest } = milestone;
      return rest;
    });

    // UPDATED: Prepare cleaned attachments payload to match Frappe's new structure
    const cleanedAttachments: Omit<ProjectProgressAttachment, 'local_id'>[] = allPhotos.map(photo => ({
        image_link: photo.image_link,
        location: photo.location,
        remarks: photo.remarks,
    }));

    return {
      project: projectId,
      report_date: dateString,
      manpower_remarks: manpowerRemarks,
      manpower: allManpower,
      milestones: cleanedMilestones,
      attachments: cleanedAttachments,
    };
  };

  const clearAllTabData = () => {
    const dateString = formatDate(summaryWorkDate);
    const allTabs = getAllAvailableTabs();
    
    allTabs.forEach(tab => {
      const storageKey = `project_${projectId}_date_${dateString}_tab_${tab.project_work_header_name}`;
      localStorage.removeItem(storageKey);
    });
  };

  const handleSyncAndSubmitAllData = async (isCalledFromManpowerDialog = false) => {
    setIsLocalSaving(true);

    if (activeTabValue !== "Work force" && activeTabValue !== "Photos") {
      const hasUnupdatedMilestones = currentTabMilestones.some(
        (m) => !m.is_updated_for_current_report && m.status !== 'N/A'
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

    toast({
      title: "Tab Data Synced! 🎉",
      description: `${activeTabValue} data has been successfully saved.`,
      variant: "default",
    });

    if (isCalledFromManpowerDialog) {
      setIsUpdateManpowerDialogOpen(false);
    }

    const allTabs = getAllAvailableTabs();
    const currentIndex = allTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);
    const isLastTab = currentIndex === allTabs.length - 1;

    if (isLastTab) {
      console.log("Attempting to submit to Frappe backend...");

      const finalPayload = collectAllTabData();
      console.log("FinalPayload",finalPayload)

       const hasPhotos = finalPayload.attachments && finalPayload.attachments.length > 2;
      if (!hasPhotos) {
        setIsLocalSaving(false);
        toast({
          title: "Submission Validation Error 🚫",
          description: "Please upload at least Three photo before final submission.",
          variant: "destructive",
        });
        return;
      }

      try {
        const response = await createDoc("Project Progress Reports", finalPayload);
        console.log("Frappe submission response:", response);

        toast({
          title: "Report Submitted Successfully! ✅",
          description: `Project Progress Report for ${finalPayload.report_date} created successfully.`,
          variant: "default",
        });
        
        clearAllTabData();
        navigate('/prs&milestones/milestone-report', { replace: true });

      } catch (error: any) {
        console.error("Error submitting to Frappe:", error);
        toast({
          title: "Submission Failed ❌",
          description: error.message || "An unknown error occurred during submission.",
          variant: "destructive",
        });
      }
    } else {
      const nextTab = allTabs[currentIndex + 1];
      setActiveTabValue(nextTab.project_work_header_name);
    }

    setIsLocalSaving(false);
  };

  const openUpdateMilestoneDialog = (milestone: LocalMilestoneData) => {
    setSelectedMilestoneForDialog(milestone || null);

    setNewStatus(milestone.status);
    setProgress(milestone.progress);
    setExpectedDate(
      milestone.status === 'Not Started' && milestone.expected_starting_date
        ? new Date(milestone.expected_starting_date)
        : (milestone.expected_completion_date ? new Date(milestone.expected_completion_date) : null)
    );
    setMilestoneRemarks(milestone.remarks || '');
    setIsUpdateMilestoneDialogOpen(true);
  };
  
  const handleUpdateMilestone = async () => {
    if (!selectedMilestoneForDialog || !activeTabValue) return;

        // Milestone form validation starts here
    // Step 1: Validate the `newStatus`
    if (!newStatus) {
      toast({
        title: "Validation Error 🚫",
        description: "Please select a status for the milestone.",
        variant: "destructive",
      });
      return; // Prevent further execution
    }

    // Step 2: Implement validation based on the selected `newStatus`
    if (newStatus === 'Not Started') {
      // If status is 'Not Started', validate that an expected start date is provided.
      if (!expectedDate) {
        toast({
          title: "Validation Error 🚫",
          description: "Please provide an expected starting date for 'Not Started' milestones.",
          variant: "destructive",
        });
        return;
      }
    } else if (newStatus === 'WIP') {
      // If status is 'WIP', validate progress and expected completion date.
      if (progress <= 0 || progress >= 100) {
        toast({
          title: "Validation Error 🚫",
          description: "For 'WIP' milestones, progress must be between 1% and 99%.",
          variant: "destructive",
        });
        return;
      }
      if (!expectedDate) {
        // If WIP and progress is between 1-99, an expected completion date is mandatory.
        toast({
          title: "Validation Error 🚫",
          description: "Please provide an expected completion date for 'WIP' milestones.",
          variant: "destructive",
        });
        return;
      }
    }


    const updatedLocalMilestone: LocalMilestoneData = {
      name: selectedMilestoneForDialog.name,
      work_milestone_name: selectedMilestoneForDialog.work_milestone_name,
      work_header: selectedMilestoneForDialog.work_header,
      status: newStatus,
      progress:progress,
      remarks: milestoneRemarks,
      is_updated_for_current_report: true,
    };

    if (newStatus === 'Not Started') {
      updatedLocalMilestone.expected_starting_date = expectedDate ? formatDate(expectedDate) : undefined;
      updatedLocalMilestone.expected_completion_date = undefined;
      updatedLocalMilestone.progress = 0;
    } else if (newStatus === 'WIP') {
      updatedLocalMilestone.expected_completion_date = expectedDate ? formatDate(expectedDate) : undefined;
      updatedLocalMilestone.expected_starting_date = undefined; 
      updatedLocalMilestone.progress = progress;
    }else if(newStatus === 'Completed'){
      updatedLocalMilestone.expected_completion_date = undefined;
      updatedLocalMilestone.expected_starting_date = undefined; 
      updatedLocalMilestone.progress = 100;
    }else if(newStatus==='N/A'){
      updatedLocalMilestone.expected_completion_date = undefined;
      updatedLocalMilestone.expected_starting_date = undefined; 
      updatedLocalMilestone.progress = 0;
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Not Started':
        return 'bg-pink-100 text-pink-700';
      case 'WIP':
        return 'bg-yellow-100 text-yellow-700';
      case 'Completed':
        return 'bg-green-100 text-green-700';
      case 'N/A':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const isGlobalLoading = projectLoading || reportsLoading || frappeMilestonesLoading || previousReportsListLoading || previousReportLoading;
  const isGlobalError = projectError || frappeMilestonesError || previousReportsListError || previousReportError;

  const isGlobalSyncDisabled = isLocalSaving || isCreatingDoc

  if (isGlobalLoading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <TailSpin color="#6366F1" height={80} width={80} />
      </div>
    );
  }

  if (isGlobalError) {
    return <div className="p-4 text-red-600">Error loading data: {isGlobalError.message}</div>;
  }

  if (!projectId) {
    return <div className="p-4 text-red-600">No Project ID found. Please select a project.</div>;
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

  return (
    <div className="flex flex-col h-full">
      
      <div className="flex-1">
        <div className="px-1  bg-white">
          <Tabs value={activeTabValue} className="w-full" onValueChange={setActiveTabValue}>
            <TabsList
              className="flex w-full justify-evenly p-1 bg-gray-100 rounded-md "
            >

        {visibleTabs.map((tab, index, arr) => {
    // Find the index of the currently active tab within the visibleTabs array
    const currentActiveTabIndex = arr.findIndex(
      (t) => t.project_work_header_name === activeTabValue
    );
    
    const isUpcoming = currentActiveTabIndex !== -1 && index > currentActiveTabIndex;
    return (
      <TabsTrigger
        key={tab.name || tab.project_work_header_name} // Unique key for each tab
        value={tab.project_work_header_name}
        disabled={isUpcoming} // Apply disabled state based on 'isUpcoming'
        className={`
          flex-none                    
          w-auto                        
          max-w-[150px]                 
          truncate overflow-hidden whitespace-nowrap 
          text-xs p-2 rounded-md        
          data-[state=active]:bg-red-100 data-[state=active]:text-red-700
          data-[state=active]:font-semibold 
          
          disabled:opacity-50 disabled:cursor-not-allowed
          disabled:bg-gray-50 disabled:text-gray-500
          
          
          md:flex-1 md:max-w-none md:w-auto
          transition-colors duration-200 ease-in-out
        `}
      >
        {tab.project_work_header_name}
      </TabsTrigger>
    );
  })}
</TabsList>
            

            <TabsContent value="Work force" className="mt-4 p-0">
              <Card className="shadow-none border-none">
                <CardHeader className="pt-0">
                  <CardTitle className="text-base font-semibold text-gray-800">
                    <div className="flex justify-between "><span>Man power </span><span className=" text-sm border border-2 rounded-md p-1"> 
                          Report Date: {summaryWorkDate && formatDate(summaryWorkDate)}</span>
                          </div>

                          </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
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
                    </CardContent>
                  </Card>

                  <div className="flex items-center justify-end mt-4">

                    {/* <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant={"outline"}
                          className={"w-[150px] justify-start text-left font-normal"}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {summaryWorkDate ? formatDate(summaryWorkDate) : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={summaryWorkDate}
                          onSelect={(date) => {
                            if (date) {
                              setSummaryWorkDate(date);
                              setDialogWorkDate(date);
                              loadDailyReport();
                            }
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover> */}
                    <Button
                      className="bg-red-600 hover:bg-red-700 text-white"
                      onClick={openUpdateManpowerDialog}
                    >
                      UPDATE
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            {/* <TabsContent value="Photos" className="mt-4 p-1">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-lg font-semibold text-gray-800">Photos & Attachments ({localPhotos.length})</CardTitle>
                        <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => setIsCaptureDialogOpen(true)}>
                            <Camera className="h-4 w-4 mr-2" /> Capture Photo
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {localPhotos.length > 0 ? (
                            <div className="space-y-4">
                                {localPhotos.map((photo) => (
                                    <div key={photo.local_id} className="flex flex-col md:flex-row border p-3 rounded-md shadow-sm bg-white">
                                        <div className="relative w-full md:w-1/3 aspect-square mb-2 md:mb-0 md:mr-4 flex-shrink-0">
                                            <img 
                                                src={photo.image_link}
                                                alt={`Photo ${photo.local_id}`} 
                                                className="w-full h-full object-cover rounded-md"
                                            />
                                            <Button 
                                                variant="destructive" 
                                                size="sm"
                                                className="absolute top-1 right-1 h-6 w-6 p-0 rounded-full"
                                                onClick={() => handleRemovePhoto(photo.local_id)}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <div className="flex-1 space-y-2">
                                            <div className="flex items-center text-sm text-gray-700">
                                                <MapPin className="h-4 w-4 mr-1 text-red-500" />
                                                <span className="font-semibold">{photo.location || 'Location Not Found'}</span> 
                                            </div>
                                            <Textarea
                                                value={photo.remarks || ''} // Use photo.remarks
                                                onChange={(e) => handlePhotoRemarksChange(photo.local_id, e.target.value)}
                                                placeholder="Enter Remarks (Max 250 chars)"
                                                maxLength={250}
                                                className="min-h-[60px] text-sm"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-gray-500 text-center py-8">
                                No photos attached. Click 'Capture Photo' to add one.
                            </p>
                        )}
                    </CardContent>
                </Card>
            </TabsContent> */}
      <TabsContent value="Photos" className="mt-4 p-1">
      <Card className="border-none shadow-none bg-transparent">
        <CardHeader className="flex flex-col items-center pb-4 pt-0">
          <Button
            className="bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-8 rounded-full shadow-md transition-all duration-200 ease-in-out transform hover:scale-105"
            onClick={() => setIsCaptureDialogOpen(true)}
          >
            ADD PHOTOS
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {localPhotos.length > 0 ? (
            <div className="space-y-4"> {/* Vertical spacing between each photo-remarks pair */}
              {localPhotos.map((photo) => (
                <div 
                  key={photo.local_id} 
                  className="flex items-center gap-4 p-3 bg-white rounded-xl shadow-sm border border-gray-100" // Overall card for the image+remarks row
                >
                  {/* Image Container (Left Side) */}
                  <div className="relative flex-shrink-0 w-[180px] h-[140px] border-2 border-pink-500 rounded-xl overflow-hidden">
                    <img
                      src={photo.image_link}
                      alt={`Photo ${photo.local_id}`}
                      className="w-full h-full object-cover"
                    />
                    {/* Delete Button */}
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-1.5 right-1.5 h-6 w-6 p-0 rounded-full bg-red-500 hover:bg-red-600 z-10"
                      onClick={() => handleRemovePhoto(photo.local_id)}
                    >
                      <X className="h-3 w-3" />
                      <span className="sr-only">Remove Photo</span>
                    </Button>
                  </div>

                  {/* Remarks Textarea (Right Side) */}
                  <div className="flex-grow"> {/* Allows textarea to take remaining space */}
                    <Textarea
                      value={photo.remarks || ''}
                      onChange={(e) => handlePhotoRemarksChange(photo.local_id, e.target.value)}
                      placeholder="Enter Remarks" // Placeholder matches image
                      maxLength={250}
                      className="min-h-[124px] h-[124px] text-sm border-gray-300 rounded-xl resize-none" // Fixed height, rounded corners, no manual resize
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 px-4 bg-white rounded-lg shadow-md border border-dashed border-gray-300">
              
              <p className="text-lg text-gray-600 font-semibold mb-2">No photos captured yet!</p>
              <p className="text-gray-500 text-sm">Click the "ADD PHOTOS" button above to get started.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>

            {allAvailableTabs.map((tab) => (
              tab.project_work_header_name !== "Work force" && tab.project_work_header_name!=="Photos"? (
                <TabsContent key={tab.name || tab.project_work_header_name} value={tab.project_work_header_name} className="p-1">
                  <Card>
                    <CardHeader className="border-b">
                      <CardTitle >{tab.project_work_header_name} Milestones -{currentTabMilestones.length}</CardTitle>
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
                                  {/* <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(milestone.status)}`}>
                                    {milestone.status}
                                  </span> */}
                                </div>
                                <p >
                                  <span className="font-semibold test-md">{milestone.progress}%</span> <span className="test-sm text-gray-600">completed</span>
                                </p>
                                {/* <div className="text-sm text-gray-600 mt-1 flex flex-col items-start">
                                        <span>
                                            Expected date of {milestone.status === 'Not Started' ? 'Starting' : 'completion'}
                                        </span>
                                        
                                        <span className="font-semibold text-gray-800 flex items-center mt-0.5 border-2 p-2 rounded-md">
                                            <CalendarIcon className="h-4 w-4 mr-1 text-gray-500" />
                                            {milestone.status === 'Not Started' ? (milestone.expected_starting_date || '--') : (milestone.expected_completion_date || '--')}
                                        </span>
                                </div>
                                <div className="flex justify-end mt-4">
                                  <Button 
                                    onClick={() => openUpdateMilestoneDialog(milestone)}
                                    variant={milestone.is_updated_for_current_report ? 'default' : 'secondary'}
                                    className={!milestone.is_updated_for_current_report && milestone.status !== 'N/A' ? 'border-red-500 text-red-500 hover:bg-red-50' : ''}
                                  >
                                    {milestone.is_updated_for_current_report ? 'EDITED' : 'UPDATE'}
                                  </Button>
                                </div> */}
                                 <div className="flex justify-between items-end w-full mt-2">
            
                                    {milestone?.status !== 'N/A' && milestone.status!=="Completed" &&( 
                                        <div className="text-sm text-gray-600 flex flex-col items-start">
                                            <span>
                                                Expected date of {milestone.status === 'Not Started' ? 'Starting' : 'completion'}
                                            </span>
                                            
                                            {/* Date Value */}
                                            <span className="font-semibold text-gray-800 flex items-center mt-0.5 border-2 border-gray-300 p-2 rounded-md">
                                                <CalendarIcon className="h-4 w-4 mr-1 text-gray-500" />
                                                {milestone.status === 'Not Started' ? (milestone.expected_starting_date || '--') : (milestone.expected_completion_date || '--')}
                                            </span>
                                        </div>)}
           
            
                                          <div className="flex-shrink-0 ml-auto">
                                            <Button 
                                                                  onClick={() => openUpdateMilestoneDialog(milestone)}
                                                                  variant={milestone.is_updated_for_current_report ? 'default' : 'secondary'}
                                                                  className={!milestone.is_updated_for_current_report && milestone.status !== 'N/A' ? 'border-red-500 text-red-500 hover:bg-red-50' : ''}
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
            ))}
          </Tabs>
        </div>
      </div>

      <div className="sticky bottom-0 w-full p-2 bg-white border-t z-10">
        <Button
          className="w-full bg-red-600 hover:bg-red-700 text-white text-lg py-3"
          onClick={() => handleSyncAndSubmitAllData(false)}
          disabled={isGlobalSyncDisabled}
        >
          {isGlobalSyncDisabled ? (
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
      </div>

      <Dialog open={isUpdateManpowerDialogOpen} onOpenChange={setIsUpdateManpowerDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-xl text-center font-bold text-red-600">Update Manpower</DialogTitle>
            <DialogDescription className="text-sm text-center">
              Edit manpower counts, add new roles, and provide remarks for the selected date.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex justify-between items-center text-sm font-medium">
              <span>Project: <span className="text-red-600">{projectData?.project_name || "N/A"}</span></span>
              <div className="flex items-center gap-2">
                {/* <span>Work Date:</span> */}
                {/* <Popover open={isDialogDatePickerOpen} onOpenChange={setIsDialogDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={"w-[150px] justify-start text-left font-normal"}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dialogWorkDate ? formatDate(dialogWorkDate) : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={dialogWorkDate}
                      onSelect={(date) => {
                        if (date) {
                          setDialogWorkDate(date);
                          setIsDialogDatePickerOpen(false);
                          loadDailyReport(); 
                        }
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover> */}
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
                  />
                  
                </div>
                
              ))}
            </div>

            <Button
              variant="outline"
              className="w-full flex items-center gap-2 text-red-600 border-red-600"
              onClick={handleAddManpowerRole}
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
              disabled={isGlobalSyncDisabled}
            >
              {isGlobalSyncDisabled ? <TailSpin height={20} width={20} color="#fff" /> : "Update & Continue"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>


    <Dialog open={isUpdateMilestoneDialogOpen} onOpenChange={setIsUpdateMilestoneDialogOpen}>
 
    <DialogContent className="sm:max-w-[425px] overflow-hidden">
        
        {/* Custom Header Area to match the red title and close button placement */}
        <DialogHeader className="p-2 pb-4 border-b">
            <div className="flex justify-between items-start">
                {/* Title */}
                <DialogTitle className="text-xl font-bold text-red-600">
                    {/* Assuming the component name is a generic placeholder for the specific work item name */}
                    {selectedMilestoneForDialog?.work_milestone_name || "Marking and placement"}
                </DialogTitle>
                
                {/* Close Button (X icon) */}
                {/* <DialogPrimitive.Close className="h-6 w-6 text-gray-400 hover:text-gray-600">
                    <X className="h-5 w-5" />
                </DialogPrimitive.Close> */}
            </div>
            
            {/* Work and Package Info (as seen below the title) */}
            <div className="flex justify-between text-sm font-medium mt-2">
                <div className="text-left">
                    <p className="text-gray-600">Work</p>
                    <p className="text-sm text-gray-700">{selectedMilestoneForDialog?.work_milestone_name || 'Sprinklers'}</p>
                </div>
                <div className="text-right">
                    <p className="text-gray-600 ">Package</p>
                    <p className="text-sm text-gray-700">{activeTabValue || 'Ducting'}</p> 
                </div>
            </div>
        </DialogHeader>
        
        {/* Dialog Body (Content below the header) */}
        <div className="space-y-2 py-4 px-6">
            
            {/* Current Status and Exp. Completion Date */}
            <div className="flex justify-between items-center text-sm font-medium">
                {/* Current Status Display (Use the red/white styling from the image) */}
                <div className="flex flex-col items-start">
                    <span className="text-gray-900">Current Status</span>
                    <span className="px-2 py-1 rounded-full text-xs font-semibold bg-red-500 text-white mt-1">
                        {selectedMilestoneForDialog?.status || 'Not Started'}
                    </span>
                </div>
                
                {/* Percentage and Exp. Completion Date */}
                <div className="flex flex-col items-end">
                    <span className="text-red-600 font-semibold text-lg">{selectedMilestoneForDialog?.progress || '0%'}</span>
                    <span className="text-gray-700 text-sm">% Completed</span>
                </div>
                
                {/* Exp. Completion Date (Replaced with Percentage completed in image layout) */}
                {/* <div className="flex flex-col items-end">
                    <span className="text-gray-900">Exp. Completion Date</span>
                    <span className="font-semibold">{selectedMilestoneForDialog?.expected_completion_date || '--'}</span>
                </div> */}
            </div>
            
            <hr className="border-gray-200" />
            
            {/* Select New Status */}
            <div className="flex flex-col">
                <label className="block text-base font-semibold text-gray-900 mb-2">Select New Status</label>
                <div className="grid grid-cols-2 gap-3">
                    {/* WIP Button (Styled with Image's Yellow/Gold) */}
                    <Button 
                        // Note: Using the newStatus state from your component
                        className={`py-3 text-sm font-semibold ${newStatus === 'Not Started' ? 'bg-red-700 text-white hover:bg-red-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                        onClick={() => setNewStatus('Not Started')}
                    >
                        Not Started
                    </Button>

                    <Button 
                        // Note: Using the newStatus state from your component
                        className={`py-3 text-sm font-semibold ${newStatus === 'N/A' ? 'bg-gray-700 text-white hover:bg-gray-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                        onClick={() => setNewStatus('N/A')}
                    >
                        N/A
                    </Button>
                    <Button 
                        // Note: Using the newStatus state from your component
                        className={`py-3 text-sm font-semibold ${newStatus === 'WIP' ? 'bg-yellow-400 text-gray-900 hover:bg-yellow-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                        onClick={() => setNewStatus('WIP')}
                    >
                        WIP
                    </Button>
                     
                    {/* Completed Button (Styled with Image's Gray/White) */}
                    <Button 
                        // Note: Using the newStatus state from your component
                        className={`py-3 text-sm font-semibold ${newStatus === 'Completed' ? 'bg-green-400 text-white hover:bg-green-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                        onClick={() => setNewStatus('Completed')}
                    >
                        Completed
                    </Button>
                    {/* Hiding Not Started/N/A buttons as they aren't shown in the main status selector area */}
                </div>
            </div>

            {/* Percentage Completed Input (Visible for WIP, like in the image) */}
            {(newStatus === 'WIP') && (
                <div>
                    <label className="block text-base font-semibold text-gray-900 mb-1">Percentage Completed</label>
                    <div className="relative">
                        <Input
                            type="number"
                            value={progress}
                            onChange={(e) => setProgress(Math.max(0, Math.min(100, Number(e.target.value))))}
                            min={0}
                            max={100}
                            className="pr-8 h-10 text-base"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                    </div>
                </div>
            )}
            
            {/* Expected Completion Date (Visible in the image, separate from status conditional logic) */}
            {(newStatus == 'Not Started' || newStatus == 'WIP')&&(
  <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected {newStatus === 'Not Started' ? 'Starting' : 'Completion'} Date
                </label>
                <Popover open={isMilestoneDatePickerOpen} onOpenChange={setIsMilestoneDatePickerOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant={"outline"}
                            className={"w-full justify-start text-left font-normal h-10 text-base border-gray-300"}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4 text-gray-500" />
                            {expectedDate ? formatDate(expectedDate) : "15/Aug/2025"} {/* Placeholder date for design match */}
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
                        />
                    </PopoverContent>
                </Popover>
            </div>

            )}
          
            {/* Remarks */}
            <div>
                <label className="block text-base font-semibold text-gray-900 mb-1">Remarks</label>
                <Textarea
                    value={milestoneRemarks}
                    onChange={(e) => setMilestoneRemarks(e.target.value)}
                    placeholder="Enter Remarks"
                    className="min-h-[100px] text-base"
                />
            </div>
        </div>
        
        {/* Footer Buttons */}
        <div className="flex justify-between gap-4 p-4">
            {/* Save as it is (Styled with Red Border) */}
            <Button 
                variant="outline" 
                className="w-full border-red-500 text-red-500 hover:bg-red-50 border-2 text-base h-12"
                onClick={handleUpdateMilestone}
            >
                Save as it is
            </Button>
            {/* Update (Styled with Solid Red) */}
            <Button 
                className="w-full bg-red-600 hover:bg-red-700 text-white text-base h-12"
                onClick={handleUpdateMilestone}
            >
                Update
            </Button>
        </div>
    </DialogContent>
</Dialog>

        <Dialog open={isCaptureDialogOpen} onOpenChange={setIsCaptureDialogOpen}>
    <DialogContent className="sm:max-w-[90vw] md:max-w-[600px] p-0 border-none bg-transparent">
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

        />
    </DialogContent>
</Dialog>

    </div>
  );
};

// import { useContext, useEffect, useRef, useState } from "react";
// import { useParams, useNavigate } from "react-router-dom"; // Import useNavigate
// import { UserContext } from "@/utils/auth/UserProvider";
// import {
//   useFrappeGetDoc,
//   useFrappeGetDocList,
//   useFrappeCreateDoc,
// } from "frappe-react-sdk";
// import CameraCapture from "@/components/CameraCapture";
// import {Camera} from "lucide-react"

// import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Button } from "@/components/ui/button";
// import { CalendarIcon, PlusCircledIcon } from "@radix-ui/react-icons";
// import { TailSpin } from "react-loader-spinner";
// import { Input } from "@/components/ui/input";
// import { Textarea } from "@/components/ui/textarea";
// import { toast } from "@/components/ui/use-toast";
// import { formatDate } from "@/utils/FormatDate";
// import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
// import { Calendar } from "@/components/ui/calendar";
// import {
//   Dialog,
//   DialogContent,
//   DialogHeader,
//   DialogTitle,
//   DialogDescription,
//   DialogClose,
// } from "@/components/ui/dialog";

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

// // Interface for the child table in Project Progress Reports
// interface ProjectProgressAttachment {
//   name?: string; // Frappe document name for the row
//   local_id: string; // Temporary ID for local state management
//   image_link: string; // The uploaded file_url
//   latitude: number | null;
//   longitude: number | null;
//   city_name: string | null;
//   photo_remarks: string; // Use 'photo_remarks' to differentiate from 'manpower_remarks'
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

// // Frappe's expected structure for Manpower child table - now using 'label'
// interface FrappeManpowerDetail {
//   label: string; // Corrected: This MUST match the backend field name
//   count: number;
// }

// interface LocalMilestoneData {
//   name: string;
//   work_milestone_name: string;
//   work_header: string;
//   status: 'Not Started' | 'WIP' | 'N/A' | 'Completed';
//   progress: number; // Changed from percentage_completed to progress
//   expected_starting_date?: string;
//   expected_completion_date?: string;
//   remarks?: string;
//   // --- START: Frontend-only field for validation ---
//   is_updated_for_current_report?: boolean; // New field for frontend validation
//   // --- END: Frontend-only field for validation ---
// }

// // Interface for data stored locally and retrieved from previous reports (can contain frontend-only fields)
// interface ProjectProgressReportData {
//   name?: string;
//   project: string;
//   report_date: string;
//   manpower_remarks?: string;
//   manpower?: FrappeManpowerDetail[]; // Stores FrappeManpowerDetail (with 'label')
//   milestones?: LocalMilestoneData[]; // Can contain frontend-only fields
//   photos?: ProjectProgressAttachment[]; // Add attachments child table
// }

// // Frappe's expected payload structure (DOES NOT contain frontend-only fields)
// interface FrappeProjectProgressReportPayload {
//   project: string;
//   report_date: string;
//   manpower_remarks?: string;
//   manpower?: FrappeManpowerDetail[];
//   milestones?: Omit<LocalMilestoneData, 'is_updated_for_current_report'>[]; // Omit the frontend-only field
//   attachments?: Omit<ProjectProgressAttachment, 'local_id'>[]; // Add the attachments child table
// }


// interface WorkMilestoneFromFrappe {
//   name: string;
//   work_milestone_name: string;
//   status: 'Not Started' | 'WIP' | 'N/A' | 'Completed';
//   progress: number; // Changed from percentage_completed to progress
//   expected_starting_date: string;
//   expected_completion_date: string;
//   work_header: string;
// }

// // Updated interface for the previous report when fetched with full details
// interface FullPreviousProjectProgressReport extends ProjectProgressReportData {
//   name: string; // Ensure name is present for the full doc
// }
// // --- END: Refined Interfaces ---


// export const MilestoneTab = () => {
//   const { projectId } = useParams<{ projectId: string }>();
//   const { selectedProject, setSelectedProject } = useContext(UserContext);
//   const navigate = useNavigate(); // Initialize useNavigate

//   const [activeTabValue, setActiveTabValue] = useState("Work force");

//     // NEW: Get the Photos tab storage key

//     const [isCaptureDialogOpen, setIsCaptureDialogOpen] = useState(false);
//     const [localPhotos, setLocalPhotos] = useState<ProjectProgressAttachment[]>([]);
//     const getPhotosStorageKey = (dateString: string) => `project_${projectId}_date_${dateString}_tab_Photos`;
//     // NEW: Get the Photos tab storage key


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
//     enabled: !!projectId,
//   });

//   // --- START MODIFICATION FOR PREVIOUS REPORTS ---

//   // Step 1: Fetch list of previous reports (only main fields) to get the latest report name
//   const {
//     data: previousReportsList,
//     isLoading: previousReportsListLoading,
//     error: previousReportsListError,
//   } = useFrappeGetDocList<{ name: string, project: string, report_date: string }>("Project Progress Reports", {
//     fields: ["name", "project", "report_date"],
//     filters: [["project", "=", projectId]],
//     orderBy: { field: "report_date", order: "desc" },
//     limit: 1, // Get only the latest report's name
//     enabled: !!projectId,
//   });

//   // Extract the name of the latest previous report
//   const latestReportName = previousReportsList?.[0]?.name;

//   // Step 2: Use that name to fetch the complete document with child tables
//   const {
//     data: previousReport, // This will now hold the full document with milestones
//     isLoading: previousReportLoading,
//     error: previousReportError,
//   } = useFrappeGetDoc<FullPreviousProjectProgressReport>(
//     "Project Progress Reports",
//     latestReportName,
//     latestReportName ? undefined : null // Only enable if we have a name
//   );
//   // --- END MODIFICATION FOR PREVIOUS REPORTS ---


//   const { createDoc, isLoading: isCreatingDoc } = useFrappeCreateDoc();

//   // --- STATE FOR MANPOWER TAB ---
//   const [dialogManpowerRoles, setDialogManpowerRoles] = useState<ManpowerRole[]>([]);
//   const [dialogRemarks, setDialogRemarks] = useState<string>("");
//   const [dialogWorkDate, setDialogWorkDate] = useState<Date>(new Date());
//   const [isDialogDatePickerOpen, setIsDialogDatePickerOpen] = useState(false);
//   const [isUpdateManpowerDialogOpen, setIsUpdateManpowerDialogOpen] = useState(false);
//   const [isLocalSaving, setIsLocalSaving] = useState(false);
//   const [summaryManpowerRoles, setSummaryManpowerRoles] = useState<ManpowerRole[]>([]);
//   const [summaryWorkDate, setSummaryWorkDate] = useState<Date>(new Date());
//   const [reportsLoading, setReportsLoading] = useState(false);
//   const [localDailyReport, setLocalDailyReport] = useState<ProjectProgressReportData | null>(null);

//   // --- STATE FOR MILESTONE DIALOG AND LOCAL MANAGEMENT ---
//   const [isUpdateMilestoneDialogOpen, setIsUpdateMilestoneDialogOpen] = useState(false);
//   const [selectedMilestoneForDialog, setSelectedMilestoneForDialog] = useState<LocalMilestoneData | null>(null); // Changed type to LocalMilestoneData
//   const [newStatus, setNewStatus] = useState<'Not Started' | 'WIP' | 'N/A' | 'Completed' | ''>('');
//   const [progress, setProgress] = useState<number>(0);
//   const [expectedDate, setExpectedDate] = useState<Date | null>(null);
//   const [isMilestoneDatePickerOpen, setIsMilestoneDatePickerOpen] = useState(false);
//   const [milestoneRemarks, setMilestoneRemarks] = useState('');

//   const [currentTabMilestones, setCurrentTabMilestones] = useState<LocalMilestoneData[]>([]);

//   // --- Helper to get initial manpower details (if needed for adding new roles) ---
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

//   // Get all available tabs
//   const getAllAvailableTabs = () => {
//     return [
//       { name: "Work force", project_work_header_name: "Work force", enabled: "True" },
//       ...(projectData?.enable_project_milestone_tracking === 1 && projectData?.project_work_header_entries
//         ? projectData.project_work_header_entries.filter(entry => entry.enabled === "True")
//         : []),
//           {name:"Photos",project_work_header_name:"Photos",enabled:"True"},
//     ];
//   };

//   // Initialize tab structure in localStorage for the current date
//   const initializeTabStructureInLocalStorage = () => {
//     const dateString = formatDate(summaryWorkDate);
//     const allTabs = getAllAvailableTabs();
    
//     allTabs.forEach(tab => {
//       const storageKey = `project_${projectId}_date_${dateString}_tab_${tab.project_work_header_name}`;
//       const existingData = localStorage.getItem(storageKey);
      
//       if (!existingData) {
//         if (tab.project_work_header_name === "Work force") {
//           // Initialize manpower tab
//           const initialManpowerData: ProjectProgressReportData = {
//             project: projectId,
//             report_date: dateString,
//             manpower_remarks: "",
//             manpower: getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count })),
//             milestones: [],
//           };
//           localStorage.setItem(storageKey, JSON.stringify(initialManpowerData));
//         } else if (tab.project_work_header_name === "Photos") {
//                     // Initialize Photos tab data
//                     const initialPhotoData: Pick<ProjectProgressReportData, 'photos'> = { photos: [] }; 
//                     localStorage.setItem(storageKey, JSON.stringify(initialPhotoData));
//                 }else {
//           // Initialize milestone tabs with inherited data or default data
//           const inheritedMilestones = getInheritedMilestones(tab.project_work_header_name);
//           const initialMilestoneData: ProjectProgressReportData = {
//             project: projectId,
//             report_date: dateString,
//             manpower: [],
//             milestones: inheritedMilestones,
//           };
//           localStorage.setItem(storageKey, JSON.stringify(initialMilestoneData));
//         }
//       }
//     });
//   };

//     const getInheritedMilestones = (workHeader: string): LocalMilestoneData[] => {
//     console.log(`DEBUG_INHERIT: Called for workHeader: "${workHeader}"`);
//     console.log(`DEBUG_INHERIT:   Current previousReport state:`, previousReport);
//     console.log(`DEBUG_INHERIT:   Current allFrappeMilestones state (defaults):`, allFrappeMilestones);


//     // Check if we have a previous full report and it has milestones
//     if (previousReport && previousReport.milestones && previousReport.milestones.length > 0) {
//       console.log(`DEBUG_INHERIT:   previousReport EXISTS and has ${previousReport.milestones.length} total milestones.`);
      
//       // Get milestones from the latest previous report for this work header
//       const previousMilestones = previousReport.milestones.filter(m => {
//         // CRITICAL CHECK: Log the work_header from the previous report's milestone
//         console.log(`DEBUG_INHERIT:     Comparing previous milestone header "${m.work_header}" with target "${workHeader}"`);
//         return m.work_header === workHeader;
//       }) || []; // Ensure it's always an array

//       console.log(`DEBUG_INHERIT:   Filtered previousMilestones for "${workHeader}":`, previousMilestones);

//       if (previousMilestones.length > 0) {
//         console.log(`DEBUG_INHERIT:   INHERITING ${previousMilestones.length} milestones from previous report for "${workHeader}".`);
//         // Inherit previous milestone data as base for new report
//         return previousMilestones.map(milestone => ({
//           ...milestone,
//           remarks: "", // Clear remarks for new report
//           // --- START: Set frontend-only flag ---
//           is_updated_for_current_report: false, // Not updated yet for *this* report
//           // --- END: Set frontend-only flag ---
//         }));
//       } else {
//         console.log(`DEBUG_INHERIT:   No specific milestones found in previousReport for header: "${workHeader}".`);
//       }
//     } else {
//       console.log(`DEBUG_INHERIT:   previousReport is null/empty or has no milestones. Falling back.`);
//     }
    
//     // If no previous full report, or no relevant milestones in it, use default milestones from Frappe (master data)
//     console.log(`DEBUG_INHERIT:   Falling back to default Frappe Work Milestones for header: "${workHeader}".`);
//     const defaultMilestones: LocalMilestoneData[] = [];
//     const frappeMilestonesForHeader = allFrappeMilestones?.filter(m => m.work_header === workHeader) || [];
    
//     if (frappeMilestonesForHeader.length > 0) {
//       frappeMilestonesForHeader.forEach(frappeM => {
//         defaultMilestones.push({
//           name: frappeM.name,
//           work_milestone_name: frappeM.work_milestone_name,
//           work_header: frappeM.work_header,
//           status: frappeM.status || 'Not Started',
//           progress: frappeM.progress || 0,
//           expected_starting_date: frappeM.expected_starting_date,
//           expected_completion_date: frappeM.expected_completion_date,
//           remarks: "",
//           // --- START: Set frontend-only flag ---
//           is_updated_for_current_report: false, // Default not updated
//           // --- END: Set frontend-only flag ---
//         });
//       });
//       console.log(`DEBUG_INHERIT:   Loaded ${defaultMilestones.length} default milestones for "${workHeader}".`);
//     } else {
//       console.log(`DEBUG_INHERIT:   No default Frappe Work Milestones found for header: "${workHeader}".`);
//     }
    
//     return defaultMilestones;
//   };

//   const loadDailyReport = () => {
//     setReportsLoading(true);
//     const dateString = formatDate(summaryWorkDate);
//     const storageKey = `project_${projectId}_date_${dateString}_tab_${activeTabValue}`;
//     const storedData = localStorage.getItem(storageKey);

//      if(activeTabValue === "Photos") {
//             if (storedData) {
//                 const parsedData: Pick<ProjectProgressReportData, 'photos'> = JSON.parse(storedData);
//                 setLocalPhotos(parsedData.photos || []);
//             } else {
//                 setLocalPhotos([]);
//             }
//             setReportsLoading(false);
//             return;
//         }

//     if (storedData) {
//       const parsedData: ProjectProgressReportData = JSON.parse(storedData);
      
//       if (activeTabValue === "Work force") {
//         const fetchedManpower: FrappeManpowerDetail[] = parsedData.manpower || getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count }));
        
//         setLocalDailyReport({
//           ...parsedData,
//           milestones: parsedData.milestones, // Milestones should be empty for manpower tab in its local storage
//           manpower: fetchedManpower
//         });
//         setDialogManpowerRoles(fetchedManpower.map(item => ({
//           id: `dialog_${item.label}`,
//           label: item.label,
//           count: item.count
//         })));
//       } else {
//         setLocalDailyReport({
//           ...parsedData,
//           milestones: parsedData.milestones || getInheritedMilestones(activeTabValue),
//           manpower: parsedData.manpower || [] // Manpower should be empty for milestone tabs in their local storage
//         });
//       }
//     } else {
//       setLocalDailyReport(null);
//       if (activeTabValue === "Work force") {
//         setDialogManpowerRoles(getManpowerRolesDefault());
//       } else {
//         // If no stored data for a milestone tab, initialize with inherited/default milestones
//         setLocalDailyReport({
//           project: projectId,
//           report_date: dateString,
//           manpower: [],
//           milestones: getInheritedMilestones(activeTabValue),
//         });
//       }
//     }
//     setReportsLoading(false);
//   };

//    // NEW Photo Handlers
//     const handlePhotoCaptureSuccess = (photoData: ProjectProgressAttachment) => {
//         // 1. Add the new photo to local state
//         console.log("photoData",photoData)
//         const newPhotos = [...localPhotos, photoData];
//         setLocalPhotos(newPhotos);
        
//         // 2. Save the updated list to local storage
//         const dateString = formatDate(summaryWorkDate);
//         const storageKey = getPhotosStorageKey(dateString);
//         localStorage.setItem(storageKey, JSON.stringify({ photos: newPhotos }));

//         // 3. Close the dialog
//         setIsCaptureDialogOpen(false);
//         toast({
//             title: "Photo Ready! 📸",
//             description: `Photo has been added to the report's attachments.`,
//             variant: "default",
//         });
//     };

//     const handlePhotoRemarksChange = (local_id: string, remarks: string) => {
//         const updatedPhotos = localPhotos.map(p => 
//             p.local_id === local_id ? { ...p, photo_remarks: remarks, remarks: remarks } : p
//         );
//         setLocalPhotos(updatedPhotos);
//         // Persist change immediately
//         const dateString = formatDate(summaryWorkDate);
//         const storageKey = getPhotosStorageKey(dateString);
//         localStorage.setItem(storageKey, JSON.stringify({ photos: updatedPhotos }));
//     };

//     const handleRemovePhoto = (local_id: string) => {
//         const updatedPhotos = localPhotos.filter(p => p.local_id !== local_id);
//         setLocalPhotos(updatedPhotos);
        
//         // Persist change immediately
//         const dateString = formatDate(summaryWorkDate);
//         const storageKey = getPhotosStorageKey(dateString);
//         localStorage.setItem(storageKey, JSON.stringify({ photos: updatedPhotos }));
        
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
//     // Only initialize and load if all necessary data is available
//     if (projectId && !previousReportsListLoading && !previousReportLoading && allFrappeMilestones && projectData) {
//       initializeTabStructureInLocalStorage();
//       loadDailyReport();
//     }
//   }, [summaryWorkDate, projectId, activeTabValue, previousReportsListLoading, previousReportLoading, allFrappeMilestones, projectData]); // Added projectData to dependencies

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
//       setDialogManpowerRoles(fetchedManpowerDetails); 
//     } else if (activeTabValue === "Work force") {
//       setSummaryManpowerRoles(getManpowerRolesDefault());
//       setDialogRemarks("");
//       setDialogManpowerRoles(getManpowerRolesDefault());
//     }
//   }, [localDailyReport, summaryWorkDate, activeTabValue]);

//   useEffect(() => {
//     if (activeTabValue === "Work force" || !allFrappeMilestones) {
//       setCurrentTabMilestones([]);
//       return;
//     }

//     const milestonesForCurrentTab: LocalMilestoneData[] = [];
//     // Ensure that if localDailyReport has milestones for this tab, they are prioritized
//     const localMilestonesFlatArray = localDailyReport?.milestones || getInheritedMilestones(activeTabValue);

//     localMilestonesFlatArray.forEach(milestone => {
//       if (milestone.work_header === activeTabValue) {
//         milestonesForCurrentTab.push(milestone);
//       }
//     });

//     setCurrentTabMilestones(milestonesForCurrentTab);
//   }, [activeTabValue, localDailyReport, allFrappeMilestones,previousReport]);

//   // --- Manpower Dialog Handlers ---
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

//   const openUpdateManpowerDialog = () => {
//     setIsUpdateManpowerDialogOpen(true);
//   };

//   // Move to next tab
//   const moveToNextTab = () => {
//     const allTabs = getAllAvailableTabs();
//     const currentIndex = allTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);
    
//     if (currentIndex < allTabs.length - 1) {
//       const nextTab = allTabs[currentIndex + 1];
//       setActiveTabValue(nextTab.project_work_header_name);
//       return false; // Not the last tab
//     }
//     return true; // Is the last tab
//   };

//   // Save current tab data to localStorage
//   const saveCurrentTabData = (milestoneData?: LocalMilestoneData[]) => {
//     const dateString = formatDate(summaryWorkDate);
//     const storageKey = `project_${projectId}_date_${dateString}_tab_${activeTabValue}`;

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
//         milestones: [], // Manpower tab does not store milestones directly in its local storage entry
//       };

//       localStorage.setItem(storageKey, JSON.stringify(payload));
//     } else if (activeTabValue === "Photos") {
//             // Save local photos state
//             const payload: Pick<ProjectProgressReportData, 'photos'> = { photos: localPhotos };
//             localStorage.setItem(storageKey, JSON.stringify(payload));
//       }else {
//       const payload: ProjectProgressReportData = {
//         project: projectId,
//         report_date: dateString,
//         manpower: [], // Milestone tabs do not store manpower directly in their local storage entry
//         milestones: milestoneData || currentTabMilestones,
//       };

//       localStorage.setItem(storageKey, JSON.stringify(payload));
//     }
//   };

//   // Collect all tab data for final submission
//   const collectAllTabData = (): FrappeProjectProgressReportPayload => {
//     const dateString = formatDate(summaryWorkDate);
//     const allTabs = getAllAvailableTabs();
//     let allManpower: FrappeManpowerDetail[] = [];
//     let allMilestones: LocalMilestoneData[] = []; // Still LocalMilestoneData to read from localStorage
//     let allPhotos: ProjectProgressAttachment[] = []; // NEW
//     let manpowerRemarks = "";

//     allTabs.forEach(tab => {
//       const storageKey = `project_${projectId}_date_${dateString}_tab_${tab.project_work_header_name}`;
//       const tabData = localStorage.getItem(storageKey);
      
//       if (tabData) {
//         const parsedData: ProjectProgressReportData = JSON.parse(tabData);
        
//         if (tab.project_work_header_name === "Work force") {
//           allManpower = parsedData.manpower || [];
//           manpowerRemarks = parsedData.manpower_remarks || "";
//         }
//          if(tab.project_work_header_name==="Photos" && parsedData.photos && parsedData.photos.length > 0){
//                     allPhotos.push(...parsedData.photos);
//                 }
        
//         // Accumulate milestones from all tabs (only milestone tabs should have them)
//         if (parsedData.milestones && parsedData.milestones.length > 0) {
//           allMilestones.push(...parsedData.milestones);
//         }
//       }
//     });

//     // --- START: Remove frontend-only field before sending to backend ---
//     const cleanedMilestones = allMilestones.map(milestone => {
//       // Destructure and omit 'is_updated_for_current_report'
//       const { is_updated_for_current_report, ...rest } = milestone;
//       return rest; // Returns an object without 'is_updated_for_current_report'
//     });
//     // --- END: Remove frontend-only field before sending to backend ---
//      // Prepare cleaned attachments payload
//         const cleanedAttachments: Omit<ProjectProgressAttachment, 'local_id'>[] = allPhotos.map(photo => ({
//             image_link: photo.image_url,
          
//             location: photo.city_name,
//             remarks: photo.remarks || photo.photo_remarks, // Use remarks field
//         }));

//     return {
//       project: projectId,
//       report_date: dateString,
//       manpower_remarks: manpowerRemarks,
//       manpower: allManpower,
//       milestones: cleanedMilestones, // Use the cleaned array
//       attachments: cleanedAttachments, // ADD ATTACHMENTS
//     };
//   };

//   // Clear all tab data for the current date
//   const clearAllTabData = () => {
//     const dateString = formatDate(summaryWorkDate);
//     const allTabs = getAllAvailableTabs();
    
//     allTabs.forEach(tab => {
//       const storageKey = `project_${projectId}_date_${dateString}_tab_${tab.project_work_header_name}`;
//       localStorage.removeItem(storageKey);
//     });
//   };

//   const handleSyncAndSubmitAllData = async (isCalledFromManpowerDialog = false) => {
//     setIsLocalSaving(true);

//     // --- START: Validation Logic for Milestones ---
//     if (activeTabValue !== "Work force") { // Only apply this validation to milestone tabs
//       const hasUnupdatedMilestones = currentTabMilestones.some(
//         (m) => !m.is_updated_for_current_report && m.status !== 'N/A' // Don't block if N/A, assuming N/A means it doesn't need explicit 'updating'
//       );

//       if (hasUnupdatedMilestones) {
//         setIsLocalSaving(false);
//         toast({
//           title: "Validation Error 🚫",
//           description: `Please update all visible milestones in the '${activeTabValue}' tab before continuing.`,
//           variant: "destructive",
//         });
//         return; // Prevent saving, tab switch, or submission
//       }
//     }
//     // --- END: Validation Logic for Milestones ---


//     // Save current tab data before proceeding (this includes `is_updated_for_current_report` to local storage, which is fine)
//     saveCurrentTabData();

//     // Show sync success message
//     toast({
//       title: "Tab Data Synced! 🎉",
//       description: `${activeTabValue} data has been successfully saved.`,
//       variant: "default",
//     });

//     if (isCalledFromManpowerDialog) {
//       setIsUpdateManpowerDialogOpen(false);
//     }

//     // Determine if it's the last tab and move to next if not
//     const allTabs = getAllAvailableTabs();
//     const currentIndex = allTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);
//     const isLastTab = currentIndex === allTabs.length - 1;

//     if (isLastTab) {
//       // --- Final Frappe Submission Logic ---
//       console.log("Attempting to submit to Frappe backend...");

//       const finalPayload = collectAllTabData(); // This is where the frontend-only flag is removed!

//       try {
//         const response = await createDoc("Project Progress Reports", finalPayload);
//         console.log("Frappe submission response:", response);

//         toast({
//           title: "Report Submitted Successfully! ✅",
//           description: `Project Progress Report for ${finalPayload.report_date} created successfully.`,
//           variant: "default",
//         });
        
//         // Clear all tab data and redirect
//         clearAllTabData();
//         navigate('/prs&milestones/milestone-report');

//       } catch (error: any) {
//         console.error("Error submitting to Frappe:", error);
//         toast({
//           title: "Submission Failed ❌",
//           description: error.message || "An unknown error occurred during submission.",
//           variant: "destructive",
//         });
//       }
//     } else {
//       // If it's not the last tab, just save locally and move to the next tab
//       // The loadDailyReport() will be triggered by activeTabValue change in useEffect
//       const nextTab = allTabs[currentIndex + 1];
//       setActiveTabValue(nextTab.project_work_header_name);
//     }

//     setIsLocalSaving(false);
//   };

//   // --- MILESTONE LOGIC ---

//   const openUpdateMilestoneDialog = (milestone: LocalMilestoneData) => {
//     setSelectedMilestoneForDialog(milestone || null);

//     // Populate dialog state with the *current local state* of the milestone
//     setNewStatus(milestone.status);
//     setProgress(milestone.progress);
//     // Use the milestone's stored expected dates first, fallback to Frappe defaults for start date if applicable
//     setExpectedDate(
//       milestone.status === 'Not Started' && milestone.expected_starting_date
//         ? new Date(milestone.expected_starting_date)
//         : (milestone.expected_completion_date ? new Date(milestone.expected_completion_date) : null)
//     );
//     setMilestoneRemarks(milestone.remarks || '');
//     setIsUpdateMilestoneDialogOpen(true);
//   };
  
//   const handleUpdateMilestone = async () => {
//     if (!selectedMilestoneForDialog || !activeTabValue) return;

//     const updatedLocalMilestone: LocalMilestoneData = {
//       name: selectedMilestoneForDialog.name,
//       work_milestone_name: selectedMilestoneForDialog.work_milestone_name,
//       work_header: selectedMilestoneForDialog.work_header,
//       status: newStatus,
//       progress:progress,
//       remarks: milestoneRemarks,
//       // --- START: Set frontend-only flag ---
//       is_updated_for_current_report: true, // Mark as updated for the current report
//       // --- END: Set frontend-only flag ---
//     };

//     if (newStatus === 'Not Started') {
//       updatedLocalMilestone.expected_starting_date = expectedDate ? formatDate(expectedDate) : undefined;
//       updatedLocalMilestone.expected_completion_date = undefined;
//       updatedLocalMilestone.progress = 0; // Reset progress if Not Started
//     } else if (newStatus === 'WIP') {
//       updatedLocalMilestone.expected_completion_date = expectedDate ? formatDate(expectedDate) : undefined;
//       updatedLocalMilestone.expected_starting_date = undefined; 
//       updatedLocalMilestone.progress = progress; // Use input progress if WIP
//     }else if(newStatus === 'Completed'){
//       updatedLocalMilestone.expected_completion_date = undefined;
//       updatedLocalMilestone.expected_starting_date = undefined; 
//       updatedLocalMilestone.progress = 100; // Set progress to 100% if Completed
//     }else if(newStatus==='N/A'){
//       updatedLocalMilestone.expected_completion_date = undefined;
//       updatedLocalMilestone.expected_starting_date = undefined; 
//       updatedLocalMilestone.progress = 0; // Reset progress if N/A
//     }

//     const updatedMilestonesForCurrentTab = [...currentTabMilestones];
//     const existingIndex = updatedMilestonesForCurrentTab.findIndex(m => m.name === updatedLocalMilestone.name && m.work_header === updatedLocalMilestone.work_header);
    
//     if (existingIndex !== -1) {
//       updatedMilestonesForCurrentTab[existingIndex] = updatedLocalMilestone;
//     } else {
//       updatedMilestonesForCurrentTab.push(updatedLocalMilestone);
//     }
    
//     setCurrentTabMilestones(updatedMilestonesForCurrentTab);
//     saveCurrentTabData(updatedMilestonesForCurrentTab); // Save immediately to local storage for this tab
    
//     setIsUpdateMilestoneDialogOpen(false);
//     toast({
//       title: "Success! 🎉",
//       description: "Milestone updated successfully.",
//       variant: "default",
//     });

//     // loadDailyReport(); // No need to reload, state and local storage are already updated.
//   };

//   const getStatusColor = (status: string) => {
//     switch (status) {
//       case 'Not Started':
//         return 'bg-pink-100 text-pink-700';
//       case 'WIP':
//         return 'bg-yellow-100 text-yellow-700';
//       case 'Completed':
//         return 'bg-green-100 text-green-700';
//       case 'N/A':
//         return 'bg-gray-100 text-gray-700';
//       default:
//         return 'bg-gray-100 text-gray-700';
//     }
//   };

//   // Combine all loading states
//   const isGlobalLoading = projectLoading || reportsLoading || frappeMilestonesLoading || previousReportsListLoading || previousReportLoading;
//   const isGlobalError = projectError || frappeMilestonesError || previousReportsListError || previousReportError;



//   const isGlobalSyncDisabled = isLocalSaving || isCreatingDoc

// console.log("currentDetails",currentTabMilestones)

//   if (isGlobalLoading) {
//     return (
//       <div className="flex justify-center items-center min-h-[50vh]">
//         <TailSpin color="#6366F1" height={80} width={80} />
//       </div>
//     );
//   }

//   if (isGlobalError) {
//     return <div className="p-4 text-red-600">Error loading data: {isGlobalError.message}</div>;
//   }

//   if (!projectId) {
//     return <div className="p-4 text-red-600">No Project ID found. Please select a project.</div>;
//   }

//   const allAvailableTabs = getAllAvailableTabs();
//   const currentIndex = allAvailableTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);
//   const isLastTab = currentIndex === allAvailableTabs.length - 1;


//   const getVisibleTabs = (currentTabValue: string) => {
//     const currentIndex = allAvailableTabs.findIndex(tab => tab.project_work_header_name === currentTabValue);
//     const visibleTabs = [];

//     // Always show the current tab
//     if (currentIndex !== -1) {
//       visibleTabs.push(allAvailableTabs[currentIndex]);
//     }

//     // Show previous tab if available
//     if (currentIndex > 0) {
//       visibleTabs.unshift(allAvailableTabs[currentIndex - 1]); // Add to the beginning
//     }

//     // Show next tab if available
//     if (currentIndex !== -1 && currentIndex < allAvailableTabs.length - 1) {
//       visibleTabs.push(allAvailableTabs[currentIndex + 1]);
//     }
    
//     // Ensure at least two tabs are visible if possible, especially at boundaries
//     if (allAvailableTabs.length >= 2) {
//       if (visibleTabs.length === 1 && currentIndex === 0) { // Only current tab, and it's the first
//         if (allAvailableTabs[1]) visibleTabs.push(allAvailableTabs[1]);
//       } else if (visibleTabs.length === 1 && currentIndex === allAvailableTabs.length - 1) { // Only current tab, and it's the last
//         if (allAvailableTabs[allAvailableTabs.length - 2]) visibleTabs.unshift(allAvailableTabs[allAvailableTabs.length - 2]);
//       } else if (visibleTabs.length === 0 && allAvailableTabs.length > 0) { // Fallback if somehow no tabs are visible (shouldn't happen with current logic)
//         visibleTabs.push(allAvailableTabs[0]);
//       }
//     }


//     return visibleTabs;
//   };

//   const visibleTabs = getVisibleTabs(activeTabValue);

//   return (
//     <div className="flex flex-col h-full bg-gray-50">
      
//       <div className="flex-1 overflow-auto">
//         <div className="px-4 py-2 bg-white border-b">
//           <Tabs value={activeTabValue} className="w-full" onValueChange={setActiveTabValue}>
//             <TabsList
//               className="flex w-full justify-center p-1 bg-gray-100 rounded-md gap-1"
//             >
//               {visibleTabs.map((tab) => (
//                 <TabsTrigger
//                   key={tab.name || tab.project_work_header_name}
//                   value={tab.project_work_header_name}
//                   className="flex-1 data-[state=active]:bg-red-100 data-[state=active]:text-red-700"
//                 >
//                   {tab.project_work_header_name}
//                 </TabsTrigger>
//               ))}
//             </TabsList>

//             <TabsContent value="Work force" className="mt-4 p-0">
//               <Card className="shadow-none border-none">
//                 <CardHeader className="pt-0">
//                   <CardTitle className="text-lg font-semibold text-gray-800">Man power</CardTitle>
//                 </CardHeader>
//                 <CardContent className="space-y-4">
//                   <Card className="bg-white p-4 shadow-sm rounded-lg">
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
//                   </Card>

//                   <div className="flex items-center justify-between mt-4">
//                     <Popover>
//                       <PopoverTrigger asChild>
//                         <Button
//                           variant={"outline"}
//                           className={"w-[150px] justify-start text-left font-normal"}
//                         >
//                           <CalendarIcon className="mr-2 h-4 w-4" />
//                           {summaryWorkDate ? formatDate(summaryWorkDate) : "Pick a date"}
//                         </Button>
//                       </PopoverTrigger>
//                       <PopoverContent className="w-auto p-0">
//                         <Calendar
//                           mode="single"
//                           selected={summaryWorkDate}
//                           onSelect={(date) => {
//                             if (date) {
//                               setSummaryWorkDate(date);
//                               setDialogWorkDate(date);
//                               loadDailyReport();
//                             }
//                           }}
//                           initialFocus
//                         />
//                       </PopoverContent>
//                     </Popover>
//                     <Button
//                       className="bg-red-600 hover:bg-red-700 text-white"
//                       onClick={openUpdateManpowerDialog}
//                     >
//                       UPDATE
//                     </Button>
//                   </div>
//                 </CardContent>
//               </Card>
//             </TabsContent>
//             <TabsContent value="Photos" className="mt-4 p-1">
//                 <Card>
//                     <CardHeader className="flex flex-row items-center justify-between">
//                         <CardTitle className="text-lg font-semibold text-gray-800">Photos & Attachments ({localPhotos.length})</CardTitle>
//                         <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => setIsCaptureDialogOpen(true)}>
//                             <Camera className="h-4 w-4 mr-2" /> Capture Photo
//                         </Button>
//                     </CardHeader>
//                     <CardContent>
//                         {localPhotos.length > 0 ? (
//                             <div className="space-y-4">
//                                 {localPhotos.map((photo) => (
//                                     <div key={photo.local_id} className="flex flex-col md:flex-row border p-3 rounded-md shadow-sm bg-white">
//                                         <div className="relative w-full md:w-1/3 aspect-square mb-2 md:mb-0 md:mr-4 flex-shrink-0">
//                                             <img 
//                                                 src={photo.image_link} 
//                                                 alt={`Photo ${photo.local_id}`} 
//                                                 className="w-full h-full object-cover rounded-md"
//                                             />
//                                             <Button 
//                                                 variant="destructive" 
//                                                 size="sm"
//                                                 className="absolute top-1 right-1 h-6 w-6 p-0 rounded-full"
//                                                 onClick={() => handleRemovePhoto(photo.local_id)}
//                                             >
//                                                 <X className="h-4 w-4" />
//                                             </Button>
//                                         </div>
//                                         <div className="flex-1 space-y-2">
//                                             <div className="flex items-center text-sm text-gray-700">
//                                                 <MapPin className="h-4 w-4 mr-1 text-red-500" />
//                                                 <span className="font-semibold">{photo.city_name || 'Location Not Found'}</span>
//                                             </div>
//                                             <Textarea
//                                                 value={photo.remarks || photo.photo_remarks || ''}
//                                                 onChange={(e) => handlePhotoRemarksChange(photo.local_id, e.target.value)}
//                                                 placeholder="Enter Remarks (Max 250 chars)"
//                                                 maxLength={250}
//                                                 className="min-h-[60px] text-sm"
//                                             />
//                                         </div>
//                                     </div>
//                                 ))}
//                             </div>
//                         ) : (
//                             <p className="text-gray-500 text-center py-8">
//                                 No photos attached. Click 'Capture Photo' to add one.
//                             </p>
//                         )}
//                     </CardContent>
//                 </Card>
//             </TabsContent>

//             {allAvailableTabs.map((tab) => (
//               tab.project_work_header_name !== "Work force" && tab.project_work_header_name!=="Photos"? (
//                 <TabsContent key={tab.name || tab.project_work_header_name} value={tab.project_work_header_name} className="mt-4 p-1">
//                   <Card>
//                     <CardHeader>
//                       {/* <CardTitle>{tab.project_work_header_name} Milestones</CardTitle> */}
//                     </CardHeader>
//                     <CardContent>
//                       {currentTabMilestones && currentTabMilestones.length > 0 ? (
//                           <div className="space-y-4">
//                             {currentTabMilestones.map(milestone => (
//                               <div key={milestone.name} className="border p-4 rounded-md shadow-sm">
//                                 <div className="flex justify-between items-center mb-2">
//                                   <h4 className="font-bold text-lg">{milestone.work_milestone_name}</h4>
//                                   <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(milestone.status)}`}>
//                                     {milestone.status}
//                                   </span>
//                                 </div>
//                                 <p className="text-sm text-gray-600">
//                                   <span className="font-semibold">{milestone.progress}%</span> completed
//                                 </p>
//                                 <p className="text-sm text-gray-600 mt-1">
//                                   Expected date of {milestone.status === 'Not Started' ? 'Starting' : 'completion'}:
//                                   <span className="font-semibold ml-1">
//                                     {milestone.status === 'Not Started' ? (milestone.expected_starting_date || '--') : (milestone.expected_completion_date || '--')}
//                                   </span>
//                                 </p>
//                                 <div className="flex justify-end mt-4">
//                                   <Button 
//                                     onClick={() => openUpdateMilestoneDialog(milestone)}
//                                     // Optionally, visually indicate if a milestone hasn't been updated
//                                     variant={milestone.is_updated_for_current_report ? 'default' : 'secondary'}
//                                     className={!milestone.is_updated_for_current_report && milestone.status !== 'N/A' ? 'border-red-500 text-red-500 hover:bg-red-50' : ''}
//                                   >
//                                     {milestone.is_updated_for_current_report ? 'EDITED' : 'UPDATE'}
//                                   </Button>
//                                 </div>
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
//             ))}
//           </Tabs>
//         </div>
//       </div>

//       <div className="sticky bottom-0 w-full p-4 bg-white border-t z-10">
//         <Button
//           className="w-full bg-red-600 hover:bg-red-700 text-white text-lg py-3"
//           onClick={() => handleSyncAndSubmitAllData(false)}
//           disabled={isGlobalSyncDisabled}
//         >
//           {isGlobalSyncDisabled ? (
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
//       </div>

//       {/* --- Update Manpower Dialog --- */}
//       <Dialog open={isUpdateManpowerDialogOpen} onOpenChange={setIsUpdateManpowerDialogOpen}>
//         <DialogContent className="sm:max-w-[425px]">
//           <DialogHeader>
//             <DialogTitle>Update Manpower</DialogTitle>
//             <DialogDescription>
//               Edit manpower counts, add new roles, and provide remarks for the selected date.
//             </DialogDescription>
//           </DialogHeader>
//           <div className="grid gap-4 py-4">
//             <div className="flex justify-between items-center text-sm font-medium">
//               <span>Project: <span className="text-red-600">{projectData?.project_name || "N/A"}</span></span>
//               <div className="flex items-center gap-2">
//                 <span>Work Date:</span>
//                 <Popover open={isDialogDatePickerOpen} onOpenChange={setIsDialogDatePickerOpen}>
//                   <PopoverTrigger asChild>
//                     <Button
//                       variant={"outline"}
//                       className={"w-[150px] justify-start text-left font-normal"}
//                     >
//                       <CalendarIcon className="mr-2 h-4 w-4" />
//                       {dialogWorkDate ? formatDate(dialogWorkDate) : "Pick a date"}
//                     </Button>
//                   </PopoverTrigger>
//                   <PopoverContent className="w-auto p-0">
//                     <Calendar
//                       mode="single"
//                       selected={dialogWorkDate}
//                       onSelect={(date) => {
//                         if (date) {
//                           setDialogWorkDate(date);
//                           setIsDialogDatePickerOpen(false);
//                           loadDailyReport(); 
//                         }
//                       }}
//                       initialFocus
//                     />
//                   </PopoverContent>
//                 </Popover>
//               </div>
//             </div>

//             <div className="space-y-3">
//               {dialogManpowerRoles.map((manpowerItem, index) => (
//                 <div key={manpowerItem.id || index} className="flex items-center gap-2">
//                   {manpowerItem.id?.startsWith('new_role_') ? (
//                     <Input
//                       type="text"
//                       value={manpowerItem.label}
//                       onChange={(e) => handleDialogRoleNameChange(index, e.target.value)}
//                       className="flex-1 text-sm"
//                       placeholder="Enter role name"
//                     />
//                   ) : (
//                     <label className="flex-1 text-sm">{manpowerItem.label}</label>
//                   )}
//                   <Input
//                     type="number"
//                     value={manpowerItem.count.toString()}
//                     onChange={(e) => handleDialogManpowerCountChange(index, e.target.value)}
//                     className="w-20 text-center"
//                   />
//                 </div>
//               ))}
//             </div>

//             <Button
//               variant="outline"
//               className="w-full flex items-center gap-2 text-red-600 border-red-600"
//               onClick={handleAddManpowerRole}
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
//               disabled={isGlobalSyncDisabled}
//             >
//               {isGlobalSyncDisabled ? <TailSpin height={20} width={20} color="#fff" /> : "Update & Continue"}
//             </Button>
//           </div>
//         </DialogContent>
//       </Dialog>


//       {/* --- Update Milestone Dialog --- */}
//       <Dialog open={isUpdateMilestoneDialogOpen} onOpenChange={setIsUpdateMilestoneDialogOpen}>
//         <DialogContent className="sm:max-w-[425px]">
//           <DialogHeader>
//             <DialogTitle>Update Work</DialogTitle>
//             <DialogDescription className="text-gray-600">
//               <span className="font-semibold text-base">{selectedMilestoneForDialog?.work_milestone_name}</span>
//               <span className="block text-sm text-gray-500">Package: {activeTabValue}</span> 
//             </DialogDescription>
//           </DialogHeader>
//           <div className="space-y-4 py-4">
//             <div className="flex justify-between items-center text-sm font-medium">
//               <span>Current Status: <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(selectedMilestoneForDialog?.status || '')}`}>{selectedMilestoneForDialog?.status}</span></span>
//               <span>Exp. Completion Date: <span className="font-semibold">{selectedMilestoneForDialog?.expected_completion_date || '--'}</span></span>
//             </div>
            
//             <div className="flex flex-col">
//               <label className="block text-sm font-medium text-gray-700 mb-2">Select New Status</label>
//               <div className="grid grid-cols-2 gap-2">
//                 <Button 
//                   variant={newStatus === 'Not Started' ? 'default' : 'outline'} 
//                   className={newStatus === 'Not Started' ? 'bg-red-500 text-white hover:bg-red-600' : ''}
//                   onClick={() => setNewStatus('Not Started')}>Not Started</Button>
//                 <Button 
//                   variant={newStatus === 'N/A' ? 'default' : 'outline'} 
//                   className={newStatus === 'N/A' ? 'bg-gray-500 text-white hover:bg-gray-600' : ''}
//                   onClick={() => setNewStatus('N/A')}>N/A</Button>
//                 <Button 
//                   variant={newStatus === 'WIP' ? 'default' : 'outline'} 
//                   className={newStatus === 'WIP' ? 'bg-yellow-500 text-white hover:bg-yellow-600' : ''}
//                   onClick={() => setNewStatus('WIP')}>WIP</Button>
//                 <Button 
//                   variant={newStatus === 'Completed' ? 'default' : 'outline'} 
//                   className={newStatus === 'Completed' ? 'bg-green-500 text-white hover:bg-green-600' : ''}
//                   onClick={() => setNewStatus('Completed')}>Completed</Button>
//               </div>
//             </div>

//             {newStatus === 'WIP' && (
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">Progress (%)</label>
//                 <div className="relative">
//                   <Input
//                     type="number"
//                     value={progress}
//                     onChange={(e) => setProgress(Math.max(0, Math.min(100, Number(e.target.value))))}
//                     min={0}
//                     max={100}
//                     className="pr-8"
//                   />
//                   <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
//                 </div>
//               </div>
//             )}
            
//             {(newStatus === 'Not Started' || newStatus === 'WIP') && (
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Expected {newStatus === 'Not Started' ? 'Starting' : 'Completion'} Date
//                 </label>
//                 <Popover open={isMilestoneDatePickerOpen} onOpenChange={setIsMilestoneDatePickerOpen}>
//                   <PopoverTrigger asChild>
//                     <Button
//                       variant={"outline"}
//                       className={"w-full justify-start text-left font-normal"}
//                     >
//                       <CalendarIcon className="mr-2 h-4 w-4" />
//                       {expectedDate ? formatDate(expectedDate) : "Pick a date"}
//                     </Button>
//                   </PopoverTrigger>
//                   <PopoverContent className="w-auto p-0">
//                     <Calendar
//                       mode="single"
//                       selected={expectedDate || undefined}
//                       onSelect={(date) => {
//                         setExpectedDate(date || null);
//                         setIsMilestoneDatePickerOpen(false);
//                       }}
//                       initialFocus
//                     />
//                   </PopoverContent>
//                 </Popover>
//               </div>
//             )}

//             <div>
//               <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
//               <Textarea
//                 value={milestoneRemarks}
//                 onChange={(e) => setMilestoneRemarks(e.target.value)}
//                 placeholder="Enter Remarks"
//                 className="min-h-[80px]"
//               />
//             </div>
//           </div>
//           <div className="flex justify-end gap-2">
//             <Button variant="outline" onClick={() => setIsUpdateMilestoneDialogOpen(false)}>Cancel</Button>
//             <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleUpdateMilestone}>Update</Button>
//           </div>
//         </DialogContent>
//       </Dialog>

//               {/* --- NEW CAMERA CAPTURE DIALOG --- */}
//         <Dialog open={isCaptureDialogOpen} onOpenChange={setIsCaptureDialogOpen}>
//     {/* Add DialogHeader with Title and Description for accessibility */}
//     <DialogContent className="sm:max-w-[90vw] md:max-w-[600px] p-0 border-none bg-transparent">
//         <DialogHeader className="sr-only"> {/* sr-only hides it visually but keeps it for screen readers */}
//             <DialogTitle>Project Photo Capture</DialogTitle>
//             <DialogDescription>Use the camera to capture a new site image and add remarks.</DialogDescription>
//         </DialogHeader>
//         <CameraCapture
//             project_id={projectId}
//             report_date={formatDate(summaryWorkDate)}
//             onCaptureSuccess={handlePhotoCaptureSuccess}
//             onCancel={() => setIsCaptureDialogOpen(false)}
//         />
//     </DialogContent>
// </Dialog>
//         {/* --- END NEW CAMERA CAPTURE DIALOG --- */}

//     </div>
//   );
// };
