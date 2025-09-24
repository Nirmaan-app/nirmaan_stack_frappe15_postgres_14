import { useContext, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom"; // Import useNavigate
import { UserContext } from "@/utils/auth/UserProvider";
import {
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeCreateDoc,
} from "frappe-react-sdk";

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
  progress: number; // Changed from percentage_completed to progress
  expected_start_date?: string;
  expected_completion_date?: string;
  remarks?: string;
}

interface ProjectProgressReportData {
  name?: string;
  project: string;
  report_date: string;
  manpower_remarks?: string;
  manpower?: FrappeManpowerDetail[]; // Stores FrappeManpowerDetail (with 'label')
  milestones?: LocalMilestoneData[];
}

interface WorkMilestoneFromFrappe {
  name: string;
  work_milestone_name: string;
  status: 'Not Started' | 'WIP' | 'N/A' | 'Completed';
  progress: number; // Changed from percentage_completed to progress
  expected_start_date: string;
  expected_completion_date: string;
  work_header: string;
}

interface FrappeProjectProgressReportPayload {
  project: string;
  report_date: string;
  manpower_remarks?: string;
  manpower?: FrappeManpowerDetail[]; // Child table field name is 'manpower' (with 'label')
  milestones?: LocalMilestoneData[];
}
// --- END: Refined Interfaces ---


export const MilestoneTab = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { selectedProject, setSelectedProject } = useContext(UserContext);
  const navigate = useNavigate(); // Initialize useNavigate

  const [activeTabValue, setActiveTabValue] = useState("Work force");

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
  const [selectedMilestoneForDialog, setSelectedMilestoneForDialog] = useState<WorkMilestoneFromFrappe | null>(null);
  const [newStatus, setNewStatus] = useState<'Not Started' | 'WIP' | 'N/A' | 'Completed' | ''>('');
  const [progress, setProgress] = useState<number>(0);
  const [expectedDate, setExpectedDate] = useState<Date | null>(null);
  const [isMilestoneDatePickerOpen, setIsMilestoneDatePickerOpen] = useState(false);
  const [milestoneRemarks, setMilestoneRemarks] = useState('');

  const [currentTabMilestones, setCurrentTabMilestones] = useState<LocalMilestoneData[]>([]);

  // --- Helper to get initial manpower details (if needed for adding new roles) ---
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

  const loadDailyReport = () => {
    setReportsLoading(true);
    const dateString = formatDate(summaryWorkDate);
    const storageKey = `project_${projectId}_date_${dateString}`;
    const storedData = localStorage.getItem(storageKey);

    if (storedData) {
      const parsedData: ProjectProgressReportData = JSON.parse(storedData);
      
      const fetchedManpower: FrappeManpowerDetail[] = parsedData.manpower || getManpowerRolesDefault().map(r => ({ label: r.label, count: r.count }));

      setLocalDailyReport({
        ...parsedData,
        milestones: parsedData.milestones || [],
        manpower: fetchedManpower
      });
      setDialogManpowerRoles(fetchedManpower.map(item => ({
        id: `dialog_${item.label}`,
        label: item.label,
        count: item.count
      })));

    } else {
      setLocalDailyReport(null);
      setDialogManpowerRoles(getManpowerRolesDefault());
    }
    setReportsLoading(false);
  };

  useEffect(() => {
    if (projectId && selectedProject !== projectId) {
      setSelectedProject(projectId);
      sessionStorage.setItem("selectedProject", JSON.stringify(projectId));
    }
  }, [projectId, selectedProject, setSelectedProject]);

  useEffect(() => {
    loadDailyReport();
  }, [summaryWorkDate, projectId]);

  useEffect(() => {
    if (localDailyReport) {
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
      setDialogManpowerRoles(fetchedManpowerDetails); 
    } else {
      setSummaryManpowerRoles(getManpowerRolesDefault());
      setDialogRemarks("");
      setDialogManpowerRoles(getManpowerRolesDefault());
    }
  }, [localDailyReport, summaryWorkDate]);


  useEffect(() => {
    if (activeTabValue === "Work force" || !allFrappeMilestones) {
      setCurrentTabMilestones([]);
      return;
    }

    const milestonesForCurrentTab: LocalMilestoneData[] = [];
    const frappeMilestonesForHeader = allFrappeMilestones.filter(m => m.work_header === activeTabValue);
    const localMilestonesFlatArray = localDailyReport?.milestones || [];

    frappeMilestonesForHeader.forEach(frappeM => {
      const localM = localMilestonesFlatArray.find(lm => lm.name === frappeM.name && lm.work_header === frappeM.work_header);
      
      if (localM) {
        milestonesForCurrentTab.push(localM);
      } else {
        milestonesForCurrentTab.push({
          name: frappeM.name,
          work_milestone_name: frappeM.work_milestone_name,
          work_header: frappeM.work_header,
          status: frappeM.status || 'Not Started',
          progress: frappeM.progress || 0,
          expected_start_date: frappeM.expected_start_date,
          expected_completion_date: frappeM.expected_completion_date,
          remarks: "",
        });
      }
    });
    setCurrentTabMilestones(milestonesForCurrentTab);

  }, [activeTabValue, localDailyReport, allFrappeMilestones]);


  // --- Manpower Dialog Handlers ---
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


  const openUpdateManpowerDialog = () => {
    setIsUpdateManpowerDialogOpen(true);
  };

  const handleSyncAndSubmitAllData = async (isCalledFromManpowerDialog = false) => {
    setIsLocalSaving(true);

    const dateString = formatDate(summaryWorkDate);
    const storageKey = `project_${projectId}_date_${dateString}`;

    const manpowerToSubmitLocalAndFrappe: FrappeManpowerDetail[] = dialogManpowerRoles.map((item) => ({
      label: item.label,
      count: item.count,
    }));

    const allMilestonesForSubmission = localDailyReport?.milestones || [];

    const finalLocalPayload: ProjectProgressReportData = {
      project: projectId,
      report_date: dateString,
      manpower_remarks: dialogRemarks,
      manpower: manpowerToSubmitLocalAndFrappe,
      milestones: allMilestonesForSubmission,
    };

    localStorage.setItem(storageKey, JSON.stringify(finalLocalPayload));
    
    await new Promise(resolve => setTimeout(resolve, 300));
    setIsLocalSaving(false);
    toast({
      title: "Local Data Synced! 🎉",
      description: "All data has been successfully saved to local storage.",
      variant: "default",
    });
    
    if (isCalledFromManpowerDialog) {
        setIsUpdateManpowerDialogOpen(false);
    }

    const allTabs = [
      { name: "Work force", project_work_header_name: "Work force", enabled: "True" },
      ...(projectData?.enable_project_milestone_tracking === 1 && projectData?.project_work_header_entries
        ? projectData.project_work_header_entries.filter(entry => entry.enabled === "True")
        : [])
    ];
    const currentIndex = allTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);
    const isLastTab = currentIndex === allTabs.length - 1;

    if (!isLastTab) {
      loadDailyReport();
      return;
    }

    // --- Frappe Submission Logic (only for the final tab) ---
    console.log("Attempting to submit to Frappe backend...");

    const frappePayload: FrappeProjectProgressReportPayload = {
      project: projectId,
      report_date: dateString,
      manpower_remarks: dialogRemarks,
      manpower: manpowerToSubmitLocalAndFrappe,
      milestones: allMilestonesForSubmission,
    };

    try {
      const response = await createDoc("Project Progress Reports", frappePayload);
      console.log("Frappe submission response:", response);

      toast({
        title: "Frappe Submitted! ✅",
        description: `Project Progress Report for ${dateString} created successfully.`,
        variant: "success",
      });
      
      // *** START: REDIRECTION AND LOCAL STORAGE CLEARING ***
      localStorage.removeItem(storageKey); // Clear local storage for this specific report
      navigate('/prs&milestones/milestone-report'); // Redirect to the milestone report list
      // *** END: REDIRECTION AND LOCAL STORAGE CLEARING ***

    } catch (error: any) {
      console.error("Error submitting to Frappe:", error);
      toast({
        title: "Frappe Submission Failed ❌",
        description: error.message || "An unknown error occurred during submission.",
        variant: "destructive",
      });
    } finally {
      loadDailyReport();
    }
  };


  // --- MILESTONE LOGIC ---

  const openUpdateMilestoneDialog = (milestone: LocalMilestoneData) => {
    const originalFrappeMilestone = allFrappeMilestones?.find(m => m.name === milestone.name && m.work_header === milestone.work_header);
    setSelectedMilestoneForDialog(originalFrappeMilestone || null);

    setNewStatus(milestone.status);
    setProgress(milestone.progress);
    setExpectedDate(
      milestone.status === 'Not Started' && milestone.expected_start_date
        ? new Date(milestone.expected_start_date)
        : (milestone.expected_completion_date ? new Date(milestone.expected_completion_date) : null)
    );
    setMilestoneRemarks(milestone.remarks || '');
    setIsUpdateMilestoneDialogOpen(true);
  };
  
  const handleUpdateMilestone = async () => {
    if (!selectedMilestoneForDialog || !activeTabValue) return;

    const updatedLocalMilestone: LocalMilestoneData = {
      name: selectedMilestoneForDialog.name,
      work_milestone_name: selectedMilestoneForDialog.work_milestone_name,
      work_header: selectedMilestoneForDialog.work_header,
      status: newStatus,
      progress: newStatus === 'Completed' ? 100 : progress,
      remarks: milestoneRemarks,
    };

    if (newStatus === 'Not Started') {
      updatedLocalMilestone.expected_start_date = expectedDate ? formatDate(expectedDate) : undefined;
      updatedLocalMilestone.expected_completion_date = undefined;
    } else if (newStatus === 'WIP' || newStatus === 'Completed') {
      updatedLocalMilestone.expected_completion_date = expectedDate ? formatDate(expectedDate) : undefined;
      updatedLocalMilestone.expected_start_date = undefined;
    }

    const currentDailyReport = localDailyReport || {
      project: projectId,
      report_date: formatDate(summaryWorkDate),
      manpower: [], // Initialize manpower as empty FrappeManpowerDetail array
      milestones: [],
    };

    const updatedMilestones = [...(currentDailyReport.milestones || [])];
    const existingIndex = updatedMilestones.findIndex(m => m.name === updatedLocalMilestone.name && m.work_header === updatedLocalMilestone.work_header);
    
    if (existingIndex !== -1) {
      updatedMilestones[existingIndex] = updatedLocalMilestone;
    } else {
      updatedMilestones.push(updatedLocalMilestone);
    }
    
    const finalPayload: ProjectProgressReportData = {
      ...currentDailyReport,
      milestones: updatedMilestones,
    };

    const dateString = formatDate(summaryWorkDate);
    const storageKey = `project_${projectId}_date_${dateString}`;
    localStorage.setItem(storageKey, JSON.stringify(finalPayload));
    
    setIsUpdateMilestoneDialogOpen(false);
    toast({
      title: "Success! 🎉",
      description: "Milestone updated successfully.",
      variant: "default",
    });

    loadDailyReport();
    
    const allTabs = [
      { name: "Work force", project_work_header_name: "Work force", enabled: "True" },
      ...(projectData?.enable_project_milestone_tracking === 1 && projectData?.project_work_header_entries
        ? projectData.project_work_header_entries.filter(entry => entry.enabled === "True")
        : [])
    ];
    const currentIndex = allTabs.findIndex(tab => tab.project_work_header_name === activeTabValue);
    const isLastTab = currentIndex === allTabs.length - 1;

    if (isLastTab) {
      await handleSyncAndSubmitAllData();
    }
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

  const isGlobalSyncDisabled = isLocalSaving || isCreatingDoc;

  if (projectLoading || reportsLoading || frappeMilestonesLoading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <TailSpin color="#6366F1" height={80} width={80} />
      </div>
    );
  }

  if (projectError) {
    return <div className="p-4 text-red-600">Error loading project data: {projectError.message}</div>;
  }
  
  if (frappeMilestonesError) {
    return <div className="p-4 text-red-600">Error loading milestones data: {frappeMilestonesError.message}</div>;
  }

  if (!projectId) {
    return <div className="p-4 text-red-600">No Project ID found. Please select a project.</div>;
  }

  const allAvailableTabs = [
    { name: "Work force", project_work_header_name: "Work force", enabled: "True" },
    ...(projectData?.enable_project_milestone_tracking === 1 && projectData?.project_work_header_entries
      ? projectData.project_work_header_entries.filter(entry => entry.enabled === "True")
      : []),
  ];

  const getVisibleTabs = (currentTabValue: string) => {
    const currentIndex = allAvailableTabs.findIndex(tab => tab.project_work_header_name === currentTabValue);
    const visibleTabs = [];

    if (currentIndex > 0) {
      visibleTabs.push(allAvailableTabs[currentIndex - 1]);
    }
    if (currentIndex !== -1) {
      visibleTabs.push(allAvailableTabs[currentIndex]);
    }
    if (currentIndex !== -1 && currentIndex < allAvailableTabs.length - 1) {
      visibleTabs.push(allAvailableTabs[currentIndex + 1]);
    }

    if (visibleTabs.length === 1 && currentIndex === 0 && allAvailableTabs.length > 1) {
        visibleTabs.push(allAvailableTabs[1]);
    } else if (visibleTabs.length === 1 && currentIndex === allAvailableTabs.length - 1 && allAvailableTabs.length > 1) {
        visibleTabs.unshift(allAvailableTabs[allAvailableTabs.length - 2]);
    } else if (visibleTabs.length === 0 && allAvailableTabs.length > 0) {
        visibleTabs.push(allAvailableTabs[0]);
    }

    return visibleTabs;
  };

  const visibleTabs = getVisibleTabs(activeTabValue);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      
      <div className="flex-1 overflow-auto">
        <div className="px-4 py-2 bg-white border-b">
          <Tabs value={activeTabValue} className="w-full" onValueChange={setActiveTabValue}>
            <TabsList
              className="flex w-full justify-center p-1 bg-gray-100 rounded-md gap-1"
            >
              {visibleTabs.map((tab) => (
                <TabsTrigger
                  key={tab.name || tab.project_work_header_name}
                  value={tab.project_work_header_name}
                  className="flex-1 data-[state=active]:bg-blue-100 data-[state=active]:text-blue-700"
                >
                  {tab.project_work_header_name}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="Work force" className="mt-4 p-0">
              <Card className="shadow-none border-none">
                <CardHeader className="pt-0">
                  <CardTitle className="text-lg font-semibold text-gray-800">Man power</CardTitle>
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

                  <div className="flex items-center justify-between mt-4">
                    <Popover>
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
                    </Popover>
                    <Button
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={openUpdateManpowerDialog}
                    >
                      UPDATE
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {allAvailableTabs.map((tab) => (
              tab.project_work_header_name !== "Work force" ? (
                <TabsContent key={tab.name || tab.project_work_header_name} value={tab.project_work_header_name} className="mt-4 p-1">
                  <Card>
                    <CardHeader>
                      {/* <CardTitle>{tab.project_work_header_name} Milestones</CardTitle> */}
                    </CardHeader>
                    <CardContent>
                      {currentTabMilestones && currentTabMilestones.length > 0 ? (
                          <div className="space-y-4">
                            {currentTabMilestones.map(milestone => (
                              <div key={milestone.name} className="border p-4 rounded-md shadow-sm">
                                <div className="flex justify-between items-center mb-2">
                                  <h4 className="font-bold text-lg">{milestone.work_milestone_name}</h4>
                                  <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(milestone.status)}`}>
                                    {milestone.status}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600">
                                  <span className="font-semibold">{milestone.progress}%</span> completed
                                </p>
                                <p className="text-sm text-gray-600 mt-1">
                                  Expected date of {milestone.status === 'Not Started' ? 'Starting' : 'completion'}:
                                  <span className="font-semibold ml-1">
                                    {milestone.status === 'Not Started' ? (milestone.expected_start_date || '--') : (milestone.expected_completion_date || '--')}
                                  </span>
                                </p>
                                <div className="flex justify-end mt-4">
                                  <Button onClick={() => openUpdateMilestoneDialog(milestone)}>
                                    UPDATE
                                  </Button>
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

      <div className="sticky bottom-0 w-full p-4 bg-white border-t z-10">
        <Button
          className="w-full bg-blue-600 hover:bg-blue-700 text-white text-lg py-3"
          onClick={() => handleSyncAndSubmitAllData(false)}
          disabled={isGlobalSyncDisabled}
        >
          {isGlobalSyncDisabled ? <TailSpin height={20} width={20} color="#fff" /> : "Sync all data"}
        </Button>
      </div>

      {/* --- Update Manpower Dialog --- */}
      <Dialog open={isUpdateManpowerDialogOpen} onOpenChange={setIsUpdateManpowerDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Update Manpower</DialogTitle>
            <DialogDescription>
              Edit manpower counts, add new roles, and provide remarks for the selected date.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex justify-between items-center text-sm font-medium">
              <span>Project: <span className="text-blue-600">{projectData?.project_name || "N/A"}</span></span>
              <div className="flex items-center gap-2">
                <span>Work Date:</span>
                <Popover open={isDialogDatePickerOpen} onOpenChange={setIsDialogDatePickerOpen}>
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
                </Popover>
              </div>
            </div>

            <div className="space-y-3">
              {dialogManpowerRoles.map((manpowerItem, index) => (
                <div key={manpowerItem.id || index} className="flex items-center gap-2">
                  {manpowerItem.id?.startsWith('new_role_') ? (
                    <Input
                      type="text"
                      value={manpowerItem.label}
                      onChange={(e) => handleDialogRoleNameChange(index, e.target.value)}
                      className="flex-1 text-sm"
                      placeholder="Enter role name"
                    />
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
              className="w-full flex items-center gap-2 text-blue-600 border-blue-600"
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
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => handleSyncAndSubmitAllData(true)}
              disabled={isGlobalSyncDisabled}
            >
              {isGlobalSyncDisabled ? <TailSpin height={20} width={20} color="#fff" /> : "Update & Sync"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>


      {/* --- Update Milestone Dialog --- */}
      <Dialog open={isUpdateMilestoneDialogOpen} onOpenChange={setIsUpdateMilestoneDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Update Work</DialogTitle>
            <DialogDescription className="text-gray-600">
              <span className="font-semibold text-base">{selectedMilestoneForDialog?.work_milestone_name}</span>
              <span className="block text-sm text-gray-500">Package: Ducting</span> 
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex justify-between items-center text-sm font-medium">
              <span>Current Status: <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(selectedMilestoneForDialog?.status || '')}`}>{selectedMilestoneForDialog?.status}</span></span>
              <span>Exp. Completion Date: <span className="font-semibold">{selectedMilestoneForDialog?.expected_completion_date || '--'}</span></span>
            </div>
            
            <div className="flex flex-col">
              <label className="block text-sm font-medium text-gray-700 mb-2">Select New Status</label>
              <div className="grid grid-cols-2 gap-2">
                <Button 
                  variant={newStatus === 'Not Started' ? 'default' : 'outline'} 
                  className={newStatus === 'Not Started' ? 'bg-red-500 text-white hover:bg-red-600' : ''}
                  onClick={() => setNewStatus('Not Started')}>Not Started</Button>
                <Button 
                  variant={newStatus === 'N/A' ? 'default' : 'outline'} 
                  className={newStatus === 'N/A' ? 'bg-gray-500 text-white hover:bg-gray-600' : ''}
                  onClick={() => setNewStatus('N/A')}>N/A</Button>
                <Button 
                  variant={newStatus === 'WIP' ? 'default' : 'outline'} 
                  className={newStatus === 'WIP' ? 'bg-yellow-500 text-white hover:bg-yellow-600' : ''}
                  onClick={() => setNewStatus('WIP')}>WIP</Button>
                <Button 
                  variant={newStatus === 'Completed' ? 'default' : 'outline'} 
                  className={newStatus === 'Completed' ? 'bg-green-500 text-white hover:bg-green-600' : ''}
                  onClick={() => setNewStatus('Completed')}>Completed</Button>
              </div>
            </div>

            {newStatus === 'WIP' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Progress (%)</label>
                <div className="relative">
                  <Input
                    type="number"
                    value={progress}
                    onChange={(e) => setProgress(Math.max(0, Math.min(100, Number(e.target.value))))}
                    min={0}
                    max={100}
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                </div>
              </div>
            )}
            
            {(newStatus === 'Not Started' || newStatus === 'WIP') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected {newStatus === 'Not Started' ? 'Starting' : 'Completion'} Date
                </label>
                <Popover open={isMilestoneDatePickerOpen} onOpenChange={setIsMilestoneDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={"w-full justify-start text-left font-normal"}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {expectedDate ? formatDate(expectedDate) : "Pick a date"}
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
              <Textarea
                value={milestoneRemarks}
                onChange={(e) => setMilestoneRemarks(e.target.value)}
                placeholder="Enter Remarks"
                className="min-h-[80px]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsUpdateMilestoneDialogOpen(false)}>Cancel</Button>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleUpdateMilestone}>Update</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
