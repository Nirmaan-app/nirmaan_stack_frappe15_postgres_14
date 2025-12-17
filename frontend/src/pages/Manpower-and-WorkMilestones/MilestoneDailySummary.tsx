import React, { useRef, useMemo, useState, useContext, useEffect,useCallback } from 'react';
import { useLocation,useNavigate } from 'react-router-dom'; // Import to read URL parameters

import { formatDate } from '@/utils/FormatDate';
import { MapPin, MessagesSquare, ChevronDown, ChevronUp,CheckCircle2,Clock,XCircle, Printer, Eye, EyeOff, Download } from 'lucide-react';
import { toast } from "@/components/ui/use-toast";
import { format } from "date-fns";

// --- Frappe and Context Imports ---
import { useFrappeGetDoc, useFrappeGetDocList } from 'frappe-react-sdk';
import { UserContext } from "@/utils/auth/UserProvider";
import { useUserData } from "@/hooks/useUserData";

// --- UI Components ---
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from '@/lib/utils'

// --- Utility Imports (Ensure these exist in your project structure) ---
import { DELIMITER, parseWorkPlan, serializeWorkPlan } from "./MilestoneTab"
// import MilestoneReportPDF from "./components/MilestoneReportPDF"; // Deprecated

import OverallMilestonesReport from "./components/OverallMilestonesReport"
import { ProgressCircle } from '@/components/ui/ProgressCircle';
import { ImageBentoGrid } from '@/components/ui/ImageBentoGrid';
import { useWorkHeaderOrder } from "@/hooks/useWorkHeaderOrder";


// --- Shared Types ---
interface ProjectZoneEntry {
    name?: string; 
    zone_name: string;
}
interface ProjectDataWithZones {
    project_zones: ProjectZoneEntry[];
    project_name: string;
    // ... other project fields
}

// --- Helper Functions ---

// Function to get query parameter from URL
const useQuery = () => {
  return new URLSearchParams(useLocation().search);
};

// Helper function to format date for input type="date" (YYYY-MM-DD)
const formatDateForInput = (date: Date): string => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};
// Helper function to get status icon/color for a badge
export const getZoneStatusIndicator = (status: string | null) => {
    switch (status) {
        case "Completed":
            return { icon: <CheckCircle2 className="w-3 h-3 text-green-700" />, color: "bg-green-100 text-green-700" };
       
        case "Draft":
            return { icon: <Clock className="w-3 h-3 text-yellow-700" />, color: "bg-yellow-100 text-yellow-700" };
        case null:
        default:
            return { icon: <XCircle className="w-3 h-3 text-red-700" />, color: "bg-red-100 text-red-700" };
    }
};


// Function to get badge classes based on status
const getStatusBadgeClasses = (status: string) => {
  switch (status) {
    case "Completed":
      return "bg-green-100 text-green-800 hover:bg-green-200";
    case "WIP":
      return "bg-yellow-100 text-yellow-800 hover:bg-yellow-200";
    case "Not Started":
      return "bg-red-100 text-red-800 hover:bg-red-200";
    case "N/A":
      return "bg-gray-100 text-gray-800 hover:bg-gray-200";
    default:
      return "bg-blue-100 text-blue-800 hover:bg-blue-200";
  }
};

// --- ProgressCircle Placeholder (Using the simplified version from your code) ---
const getColorForProgress = (value: number): string => {
  const val = Math.round(value)
  if (isNaN(val)) {
    return 'text-gray-500'
  }
  if (val === 0) {
    return 'text-black-500'
  }
  if (val < 50) {
    return 'text-red-600'
  }
  if (val < 75) {
    return 'text-yellow-600'
  }
  if (val < 100) {
    return 'text-green-600'
  }
  return 'text-green-500'
}

interface MilestoneProgressProps {
  milestoneStatus: 'Not Applicable' | 'In Progress' | 'Completed' | string
  value: number
  sizeClassName?: string
  textSizeClassName?: string
}

export const MilestoneProgress = ({
  milestoneStatus,
  value,
  sizeClassName = "size-[60px]",
  textSizeClassName = "text-md"
}: MilestoneProgressProps) => {

  if (milestoneStatus === "Not Applicable" || value == "N/A") {
    return (
      <div
        className={cn(
          "relative inline-flex items-center justify-center",
          "text-gray-500 font-semibold",
          sizeClassName,
          textSizeClassName
        )}
      >
        N/A
      </div>
    )
  }

  const colorClass = getColorForProgress(value)

  return (
    <ProgressCircle
      value={value}
      className={cn(sizeClassName, colorClass)}
      textSizeClassName={textSizeClassName}
    />
  )
}

// --- Main Component: MilestoneDailySummary ---

export const MilestoneDailySummary = () => {
  const query = useQuery();
  const navigate = useNavigate();
  const location = useLocation();

  const initialProjectId = query.get('project_id') || '';
  const initialDateStr = query.get('report_date'); // YYYY-MM-DD from URL
  const initialZone = query.get('zone') 
  const initialDate = initialDateStr ? new Date(initialDateStr) : new Date();

  const { role } = useUserData();
  
  const selectedProject = initialProjectId;
  
  const [displayDate, setDisplayDate] = useState<Date>(initialDate); 

  // --- ADDED: Report Type state re-introduced ---
  const [reportType, setReportType] = useState<'Daily' | 'Overall'>('Daily'); 
  const [selectedZone, setSelectedZone] = useState<string | null>(initialZone);
  // --- END ADDED ---

  const [reportForDisplayDateName, setReportForDisplayDateName] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);
  const [showPrintHeader, setShowPrintHeader] = useState(true);

  // Fetch Work Components to get order
  const { workHeaderOrderMap } = useWorkHeaderOrder();
  
  // Fetch Work Milestones to get the order for milestones
  const { data: workMilestonesList } = useFrappeGetDocList("Work Milestones", {
      fields: ["work_milestone_name", "work_milestone_order", "work_header"],
      limit: 0
  });

  // Fetch project data
  const {
    data: projectData,
    isLoading: projectLoading,
    error: projectError,
  } = useFrappeGetDoc("Projects", selectedProject, selectedProject ? undefined : null);
// ... (existing code) ...

// ... (existing code for projectProgressReports, allReportsForDate, dailyReportDetails) ...

/* ... Work Plan Grouping ... */


  // Fetch list of Project Progress Reports (used by Daily Report logic)
  const {
    data: projectProgressReports,
    isLoading: projectProgressLoading,
    error: projectProgressError,
  } = useFrappeGetDocList(
    "Project Progress Reports",
    {
      fields: ["name", "report_date", "project","report_zone"],
      limit: 0,
      filters: [
        ["project", "=", selectedProject],
        ["report_zone", "=", selectedZone],
        ["report_status", "=", "Completed"]
      ],
    },
    selectedProject && reportType === 'Daily' ? undefined : null // Only fetch if we're in Daily mode
  );
//-------Validation tab--------
   const {
    data: allReportsForDate,
    isLoading: allReportsLoading,
  } = useFrappeGetDocList(
      "Project Progress Reports",
      {
          fields: ["name", "report_zone", "report_status"],
          limit: 0,
          filters: [
              ["project", "=", selectedProject],
              // Filter by the current date being viewed
              ["report_date", "=", formatDateForInput(displayDate)], 
          ]
      },
      selectedProject  && displayDate ? undefined : null
  );
  console.log("All Reports for Date:", allReportsForDate);
  //-------Validation tab--------
  // Fetch the detailed Daily Report
  const {
    data: dailyReportDetails,
    isLoading: dailyReportLoading,
    error: dailyReportError,
  } = useFrappeGetDoc(
    "Project Progress Reports",
    reportForDisplayDateName,
    reportForDisplayDateName && reportType === 'Daily' ? undefined : null // Only fetch if we're in Daily mode AND have a report name
  );

  // --- Work Plan Grouping (Daily Only) ---
  const workPlanGroupedMilestones = useMemo(() => {
    if (!dailyReportDetails?.milestones || reportType !== 'Daily') return {};

    const grouped = dailyReportDetails.milestones.reduce((acc: any, milestone: any) => {
      const isRelevantStatus = milestone.status === "WIP" || milestone.status === "Not Started";
      const hasWorkPlanContent = milestone.work_plan && parseWorkPlan(milestone.work_plan).length > 0;

      if (hasWorkPlanContent || isRelevantStatus) {
        (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
      }
      return acc;
    }, {});
    
    // Sort milestones within each group based on work_milestone_order
    Object.keys(grouped).forEach(header => {
        grouped[header].sort((a: any, b: any) => {
             const orderA = workMilestonesList?.find(m => m.work_milestone_name === a.work_milestone_name && m.work_header === header)?.work_milestone_order ?? 9999;
             const orderB = workMilestonesList?.find(m => m.work_milestone_name === b.work_milestone_name && m.work_header === header)?.work_milestone_order ?? 9999;
             return orderA - orderB;
        });
    });

    return Object.entries(grouped)
        .sort(([headerA], [headerB]) => {
            const orderA = workHeaderOrderMap[headerA] ?? 9999;
            const orderB = workHeaderOrderMap[headerB] ?? 9999;
            return orderA - orderB;
        })
        .reduce((acc: any, [header, milestones]) => {
            acc[header] = milestones;
            return acc;
        }, {});

  }, [dailyReportDetails, reportType, workHeaderOrderMap, workMilestonesList]);
  
  // --- NEW: Main Milestones Grouping (Memoized) ---
  const milestoneGroups = useMemo(() => {
    if (!dailyReportDetails?.milestones) return [];

    const grouped = dailyReportDetails.milestones
      .filter((milestone: any) => milestone.status !== "Not Applicable")
      .reduce((acc: any, milestone: any) => {
        (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
        return acc;
      }, {});

    // Sort milestones within each group based on work_milestone_order
    Object.keys(grouped).forEach(header => {
        grouped[header].sort((a: any, b: any) => {
             const orderA = workMilestonesList?.find(m => m.work_milestone_name === a.work_milestone_name && m.work_header === header)?.work_milestone_order ?? 9999;
             const orderB = workMilestonesList?.find(m => m.work_milestone_name === b.work_milestone_name && m.work_header === header)?.work_milestone_order ?? 9999;
             return orderA - orderB;
        });
    });
    
    // Convert to entries and sort by header order
    return Object.entries(grouped)
      .sort(([headerA], [headerB]) => {
        const orderA = workHeaderOrderMap[headerA] ?? 9999;
        const orderB = workHeaderOrderMap[headerB] ?? 9999;
        return orderA - orderB;
      });
  }, [dailyReportDetails, workHeaderOrderMap, workMilestonesList]);

  // --- End Work Plan Grouping ---

  // Handler for Zone Tab Click
  const handleZoneChange = useCallback((zoneName: string) => {
    setSelectedZone(zoneName);

    // 1. Update URL query parameter
    const params = new URLSearchParams(location.search);
    params.set('zone', zoneName);
    
    // 2. Navigate to the current path with the new query string
    // navigate(`${location.pathname}?${params.toString()}`);
    navigate(`?${params.toString()}`);
  }, [location.search, location.pathname]);


  // Handler for Date Change
  const handleDateChange = useCallback((newDate: Date) => {
    setDisplayDate(newDate);

    // 1. Update URL query parameter
    const params = new URLSearchParams(location.search);
    params.set('report_date', formatDateForInput(newDate));
    
    // 2. Navigate
    // navigate(`${location.pathname}?${params.toString()}`);
    navigate(`?${params.toString()}`);
  }, [location.search, location.pathname]);


  // Effect to determine reportForDisplayDateName based on selectedProject and displayDate
  useEffect(() => {
    if (projectProgressReports && displayDate && reportType === 'Daily') {
      const selectedDateFormatted = formatDate(displayDate); 

      const foundReport = projectProgressReports.find(
        (report: any) => formatDate(report.report_date) === selectedDateFormatted
      );

      setReportForDisplayDateName(foundReport ? foundReport.name : null);
    } else if (reportType === 'Overall') {
        setReportForDisplayDateName(null); // Clear daily report name when switching to Overall
    }
  }, [projectProgressReports, displayDate, reportType]);

  // Initialize expanded sections when dailyReportDetails changes
  useEffect(() => {
    if (dailyReportDetails?.milestones && reportType === 'Daily') {
      const sections = dailyReportDetails.milestones.reduce((acc: any, milestone: any) => {
        acc[milestone.work_header] = true; 
        return acc;
      }, {} as Record<string, boolean>);
      setExpandedSections(sections);
      setAllExpanded(true);
    }
  }, [dailyReportDetails, reportType]);


  // --- Collapse/Expand Logic ---
  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleAllSections = () => {
    const newState = !allExpanded;
    setAllExpanded(newState);
    if (dailyReportDetails?.milestones) {
      const sections = dailyReportDetails.milestones.reduce((acc: any, milestone: any) => {
        acc[milestone.work_header] = newState;
        return acc;
      }, {} as Record<string, boolean>);
      setExpandedSections(sections);
    }
  };

  const areAllSectionsExpanded = () => {
    if (!dailyReportDetails?.milestones) return false;
    return Object.values(expandedSections).every(Boolean);
  };
  // --- End Collapse/Expand Logic ---



 // --- NEW: Zone Progress Validation/Status Calculation ---
  const validationZoneProgress = useMemo(() => {
    if (!projectData?.project_zones || !allReportsForDate) {
        // Return null/empty map if data is not ready
        return new Map<string, { status: string, name: string }>(); 
    }
    
    // Map fetched reports by zone for quick lookup
    const reportStatusMap = new Map<string, { status: string, name: string }>();
    allReportsForDate.forEach((report: any) => {
        reportStatusMap.set(report.report_zone, { status: report.report_status, name: report.name });
    });

    return reportStatusMap;
  }, [projectData?.project_zones, allReportsForDate,reportType]);
  // --- END NEW: Zone Progress Validation/Status Calculation ---


  // Calculate metrics for the Daily Work Report Summary Section
  const totalWorkHeaders = dailyReportDetails?.milestones?.length || 0;
  const completedWorksOnReport = dailyReportDetails?.milestones?.filter((m: any) => m.status === "Completed").length || 0;
  const totalManpowerInReport = dailyReportDetails?.manpower?.reduce((sum: number, mp: any) => sum + Number(mp.count || 0), 0) || 0;

    // --- NEW: Print Handler ---
    const handleDownloadReport = async () => {
      if (!dailyReportDetails?.name) return;
  
      try {
        toast({ title: "Generating PDF...", description: "Please wait while we prepare your report." });
  
        // 1. Construct URL
        const headerParam = showPrintHeader ? '1' : '0';
        const printUrl = `/api/method/frappe.utils.print_format.download_pdf?doctype=Project%20Progress%20Reports&name=${dailyReportDetails.name}&format=Milestone%20Report&no_letterhead=0&show_header=${headerParam}`;
  
        // 2. Fetch Blob
        const response = await fetch(printUrl);
        if (!response.ok) throw new Error("Failed to generate PDF");
        const blob = await response.blob();
  
        // 3. Construct Filename: ProjectName_Date_Zone.pdf
        const pName = (projectData?.project_name || "Project").replace(/\s+/g, '_');
        // Ensure valid date conversion
        const rDate = dailyReportDetails.report_date ? new Date(dailyReportDetails.report_date) : new Date();
        const dStr = format(rDate, "dd-MM-yyyy");
        const zoneSuffix = selectedZone ? `_${selectedZone.replace(/\s+/g, '_')}` : "";
  
        const fileName = `${pName}_${zoneSuffix}_${dStr}_DPR.pdf`;
  
        // 4. Trigger Download
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
  
        // 5. Cleanup
        link.remove();
        window.URL.revokeObjectURL(url);
        toast({ title: "Success", description: "Report downloaded successfully.", variant: "success" });
  
      } catch (e) {
        console.error("PDF Download Error:", e);
        toast({ title: "Error", description: "Failed to download report.", variant: "destructive" });
      }
    };




  // --- Loading and Error States ---
  if (!selectedProject) return <h1>No Project ID found in URL.</h1>;
  if (projectLoading || (reportType === 'Daily' && (projectProgressLoading || dailyReportLoading))) return <h1>Loading...</h1>;
  if (projectError || projectProgressError) return <h1>Error loading project data.</h1>;

  
  return (
    <>
      <div className="flex-1 space-y-4 min-h-[50vh]">

        {/* --- Main Content --- */}
        <div className="mx-0 px-0 pt-4">
          
          {/* Report Type and Show By Date section (Simplified) */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 p-4 shadow-sm border border-gray-300 rounded-md gap-3">
            
            {/* Project Name (Fixed) */}
            <div className="font-bold text-lg text-gray-800 flex items-center gap-2">
               <span className="font-semibold text-gray-700 whitespace-nowrap">Project:</span>
                {projectData?.project_name || "Daily Report Summary"}
            </div>
            {/* 2. Zone Tabs */}
            {/* <div>
            {projectData?.project_zones?.length > 0 && (
                <div className="flex flex-row md:items-center gap-2 overflow-x-auto pb-1 flex-shrink-0">
                    <span className="font-semibold text-gray-700 whitespace-nowrap flex-shrink-0">Zone:</span>
                    <div className="flex rounded-md border border-gray-300 overflow-hidden flex-shrink-0">
                        {projectData.project_zones.map((zone) => (
                            <button
                                key={zone.zone_name}
                                  className={`px-2 py-1 text-xs font-medium transition-colors md:text-sm md:px-3 md:py-1.5 ${
                                        selectedZone === zone.zone_name 
                                            ? 'bg-blue-600 text-white shadow-inner' 
                                            : 'bg-white text-blue-600 hover:bg-blue-50'
                                    }`}
                                onClick={() => handleZoneChange(zone.zone_name)} 
                            >
                                {zone.zone_name}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div> */}
          {/* 2. Zone Tabs (Includes Status Badge) */}
            <div>
            {projectData?.project_zones?.length > 0 && (
                <div className="flex flex-row md:items-center gap-2 overflow-x-auto pb-1 flex-shrink-0">
                    <span className="font-semibold text-gray-700 whitespace-nowrap flex-shrink-0 hidden md:block
                    ">Zone:</span>
                    <div className="flex rounded-md border border-gray-300 overflow-hidden flex-shrink-0">
                        {projectData.project_zones.map((zone: ProjectZoneEntry) => {
                            const zoneStatus = validationZoneProgress.get(zone.zone_name);
                            const statusData = getZoneStatusIndicator(zoneStatus ? zoneStatus.status : null);
                            
                            return (
                                <button
                                    key={zone.zone_name}
                                   className={`px-2 py-1 text-xs font-medium transition-colors md:text-sm md:px-3 md:py-1.5 ${
                                        selectedZone === zone.zone_name 
                                            ? 'bg-blue-600 text-white shadow-inner' 
                                            : 'bg-white text-blue-600 hover:bg-blue-50'
                                    }`}
                                    onClick={() => handleZoneChange(zone.zone_name)} 
                                >
                                    <span className='text-xs md:text-sm'>{zone.zone_name}</span>
                                    <Badge 
                                        variant="secondary" 
                                        className={`p-0 ${statusData.color}`}
                                    >
                                        {statusData.icon}
                                    </Badge>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
        {/* --- End Top Control Bar --- */}

        {/* --- End Top Control Bar --- */}


            <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
                 {/* Report Type Toggle */}
                 {reportType === 'Daily' && (
                  <>
                    <span className="font-semibold text-gray-700 whitespace-nowrap">Report Date</span>
                    <div className="relative w-full md:w-auto">
                      <input
                        type="date"
                        value={displayDate ? formatDateForInput(displayDate) : ''}
                        onChange={(e) => handleDateChange(new Date(e.target.value))}
                        className="pl-3 pr-10 py-2 border border-gray-300 rounded-md text-sm cursor-pointer w-full"
                      />
                    </div>
                  </>
                )}
                
                <div className="flex rounded-md border border-gray-300 overflow-hidden w-full md:w-auto">
                    <button
                        className={`flex-1 px-4 py-2 text-sm font-medium ${reportType === 'Daily' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'}`}
                        onClick={() => setReportType('Daily')}
                    >
                        Daily
                    </button>
                    {/* Assuming only Nirmaan Project Manager Profile role can't see overall */}
                    {role !== 'Nirmaan Project Manager Profile' && ( 
                        <button
                            className={`flex-1 px-4 py-2 text-sm font-medium ${reportType === 'Overall' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'}`}
                            onClick={() => setReportType('Overall')}
                        >
                            Overall
                        </button>
                    )}
                </div>

                {/* Date Picker (Only for Daily report type) */}
                
            </div>
          </div>

          {/* Conditional rendering based on Report Type */}
          {reportType === 'Daily' ? (
            
            dailyReportDetails ? (
            <div className="bg-white p-3 md:p-4 rounded-lg shadow-sm border border-gray-300">
              
              {/* Report Header */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 border-b pb-2 gap-2">
                <h2 className="text-lg md:text-xl font-bold">Daily Work Report</h2>
                <span className="text-gray-600 text-sm md:text-base">
                  {dailyReportDetails.report_date ? formatDate(dailyReportDetails.report_date) : formatDate(displayDate)}
                </span>
              </div>

              {/* Summary Metrics */}
              <div className="mb-6 space-y-2 text-gray-700">
                <div className="flex justify-between text-sm">
                  <span>Total numbers of work Done:</span>
                  <span className="font-semibold">{completedWorksOnReport.toString().padStart(2, '0')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Total numbers of Work:</span>
                  <span className="font-semibold">{totalWorkHeaders.toString().padStart(2, '0')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Manpower Used:</span>
                  <span className="font-semibold">{totalManpowerInReport.toString().padStart(2, '0')}</span>
                </div>
              </div>

              {/* Manpower Section */}
              {dailyReportDetails.manpower && dailyReportDetails.manpower.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-base md:text-lg font-bold mb-3">Manpower - {totalManpowerInReport.toString().padStart(2, '0')}</h3>
                  <div className="space-y-2">
                    {dailyReportDetails.manpower.map((mp_detail: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center text-gray-700 text-sm">
                        <span className="font-medium">{mp_detail.label}</span>
                        <span className="font-semibold">{mp_detail.count.toString().padStart(2, '0')}</span>
                      </div>
                    ))}
                    {dailyReportDetails.manpower_remarks && (
                      <div className={"mt-2"}>
                        <p className="text-xs text-muted-foreground">{"Remarks"}</p>
                        <div className="mt-1 p-3 rounded-md bg-gray-50 border border-gray-200 text-gray-800 text-sm whitespace-pre-wrap break-words">
                          {dailyReportDetails.manpower_remarks}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}


              {/* --- Work Plan Summary (Using workPlanGroupedMilestones) --- */}
              {Object.entries(workPlanGroupedMilestones).length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg md:text-xl font-bold mb-6 border-b">Work Plan</h3>
                  
                  {Object.entries(workPlanGroupedMilestones).map(([header, milestones], groupIdx) => (
                    <div key={groupIdx} className="mb-4 last:mb-0 rounded-md overflow-hidden">
                      {/* Header */}
                      <div className="p-3 bg-gray-50">
                        <h3 className="text-base md:text-lg font-bold">
                          {header} - {(milestones as any[]).length.toString().padStart(2, '0')}
                        </h3>
                      </div>

                      {/* Content */}
                      <div className="p-3">
                        <div className="space-y-3">
                          {(milestones as any[]).map((milestone: any, idx: number) => {
                            const milestoneWorkPlan = parseWorkPlan(milestone.work_plan);
                            // Check for any non-empty item in the work plan array
                            const hasValidPoints = milestoneWorkPlan.some((point: string) => point.trim() !== "");

                            return (
                              <div key={idx} className="border rounded-lg p-3 bg-white shadow-sm">
                                <div className="mb-2">
                                  <h4 className="font-medium text-sm text-gray-800">
                                    {milestone.work_milestone_name}
                                  </h4>
                                </div>
                                
                                <div className="mt-3">
                                  {hasValidPoints ? (
                                    // Case 1: Work plan exists, render the list
                                    <div className="p-2 bg-blue-50 border border-blue-200 rounded-md">
                                      <ul className="list-disc list-inside text-xs text-blue-800 space-y-0.5 ml-2">
                                        {milestoneWorkPlan.map((point: string, i: number) => (
                                          point.trim() !== "" ? (
                                            <li key={i} className="break-words whitespace-pre-wrap">
                                              {point}
                                            </li>
                                          ) : null
                                        ))}
                                      </ul>
                                    </div>
                                  ) : (
                                    // Case 2: No valid work plan, render "Nothing" in red
                                    <div className="p-2 bg-red-50 border border-red-200 rounded-md text-center">
                                      <span className="text-sm font-semibold text-red-700">Nothing</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* --- End Work Plan Summary --- */}



              {/* Work Progress Sections (Ducting, FA PA & ACS etc.) */}
             
                               {/* Work Progress Sections (Ducting, FA PA & ACS etc.) */}
                               {dailyReportDetails.milestones && dailyReportDetails.milestones.length > 0 && (
                                 <div className="mb-6">
                                   {/* Expand/Collapse All Button */}
                                   <h3 className="text-lg md:text-xl font-bold mb-6 border-b">Work Milestones</h3>
                                   <div className="flex justify-end mb-3">
                                     <Button
                                       variant="outline"
                                       size="sm"
                                       onClick={toggleAllSections}
                                       className="flex items-center gap-1 text-xs md:text-sm"
                                     >
                                       {areAllSectionsExpanded() ? (
                                         <>
                                           <ChevronUp className="h-4 w-4" />
                                           Collapse All
                                         </>
                                       ) : (
                                         <>
                                           <ChevronDown className="h-4 w-4" />
                                           Expand All
                                         </>
                                       )}
                                     </Button>
                                   </div>
             
                                    {milestoneGroups.map(([header, milestones], groupIdx) => { 
                                     const totalProgress = (milestones as any[]).reduce((sum, m) => sum + (Number(m.progress) || 0), 0);
                 const averageProgress = (milestones as any[]).length > 0 
                     ? Math.round(totalProgress / (milestones as any[]).length) 
                     : 0;
                                     return(
                                     <div key={groupIdx} className="mb-4 last:mb-0 border rounded-md overflow-hidden">
                                       {/* Collapsible Header */}
                                       <div
                                         className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                                         onClick={() => toggleSection(header)}
                                       >
                                        <div className="flex items-center  gap-4">
                                               <h3 className="text-base md:text-lg font-bold">
                                                 {header} - {milestones.length.toString().padStart(2, '0')}
                                               </h3>
                                         </div>
                                         <div className="flex items-center">
                                           {milestones.length > 0 && (
                                                 <div className="flex items-center text-end gap-2">
                                                   <span className="text-xs text-gray-500 font-medium hidden sm:inline">Overall:</span>
                                                   <MilestoneProgress
                                                     milestoneStatus="Completed"
                                                     value={averageProgress}
                                                     sizeClassName="size-[40px]"
                                                     textSizeClassName="text-[10px]"
                                                   />
                                                 </div>
                                               )}
                                           <span className="text-xs md:text-sm text-gray-500 mx-2">
                                             {milestones.length} milestone{milestones.length !== 1 ? 's' : ''}
                                           </span>
                                           {expandedSections[header] ? (
                                             <ChevronUp className="h-5 w-5 text-gray-600" />
                                           ) : (
                                             <ChevronDown className="h-5 w-5 text-gray-600" />
                                           )}
                                         </div>
                                       </div>
             
                                       {/* Collapsible Content */}
                                       {expandedSections[header] && (
                                         <div className="p-3">
                                           {/* Desktop Table View */}
                                           <div className="hidden md:block">
                                             <Table className="w-full">
                                               <TableHeader>
                                                 <TableRow className="bg-gray-100">
                                                   <TableHead className="w-[40%] font-semibold text-gray-700 text-sm py-2">Work</TableHead>
                                                   <TableHead className="w-[20%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
                                                   <TableHead className="w-[20%] text-center font-semibold text-gray-700 text-sm py-2">Progress</TableHead>
                                                   <TableHead className="w-[20%] text-center font-semibold text-gray-700 text-sm py-2">Excepted Starting/completion Date</TableHead>
             
                                                 </TableRow>
             
                                               </TableHeader>
                                               <TableBody>
                                                 {milestones.map((milestone, idx) => (
                                                   <TableRow key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                                     <TableCell className="py-3 px-4 text-sm">{milestone.work_milestone_name}
                                                       {milestone.remarks && (
                                                         <div className="mt-1">
                                                           <p className="flex items-center gap-2 p-1 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs">
                                                             {/* Icon: Added classes to control size and ensure it's vertically centered */}
                                                             <MessagesSquare className="h-4 w-4 flex-shrink-0" />
             
                                                             {/* Remarks text */}
                                                             <span className="flex-grow">
                                                               {milestone.remarks}
                                                             </span>
                                                           </p>
                                                         </div>
                                                       )}
                                                     </TableCell>
                                                     <TableCell className="text-center py-3 px-4">
                                                       <Badge
                                                         variant="secondary"
                                                         className={`${getStatusBadgeClasses(milestone.status)} text-xs`}
                                                       >
                                                         {milestone.status}
                                                       </Badge>
                                                     </TableCell>
             
                                                     <TableCell className="text-center py-3 px-4 font-medium">
                                                       {/* {milestone.status !== "Not Applicable" ? (
                                                         <div className="flex flex-col items-center">
                                                           <span className="text-sm font-semibold mb-1">{milestone.progress}%</span>
                                                           <div className="w-full max-w-[120px] h-2 bg-gray-200 rounded-full overflow-hidden">
                                                             <div
                                                               className="h-full bg-blue-500 rounded-full"
                                                               style={{ width: `${milestone.progress}%` }}
                                                             ></div>
                                                           </div>
                                                         </div>
                                                       ) : (
                                                         <span className="text-sm font-semibold mb-1">{"N/A"}</span>
                                                       )} */}
                                                       <MilestoneProgress
                                                         // 1. Pass the status for the N/A check
                                                         milestoneStatus={milestone.status}
             
                                                         // 2. Pass the progress value for the circle and color logic
                                                         value={milestone.progress}
             
                                                         // 3. Set the desired size and text size
                                                         sizeClassName="size-[60px]"
                                                         textSizeClassName="text-md"
                                                       />
             
                                                     </TableCell>
                                                     <TableCell className="text-center py-3 px-4 text-sm">
                                                       {milestone.status === "Not Started" ? (
                                                         <span className="text-red-600 font-medium">
                                                           {milestone.expected_starting_date ? formatDate(milestone.expected_starting_date) : 'N/A'}
                                                         </span>
                                                       ) : (
                                                         <span className="text-green-500 font-medium">{ milestone.expected_completion_date ? formatDate(milestone.expected_completion_date) : 'N/A'}</span>
                                                        
                                                       )}
                                                     </TableCell>
                                                     {/* New Remarks Table Cell */}
             
                                                   </TableRow>
                                                 ))}
                                               </TableBody>
                                             </Table>
                                           </div>
             
                                           {/* Mobile Card View */}
                                           <div className="md:hidden space-y-3">
                                             {milestones.map((milestone, idx) => (
                                               <div key={idx} className="border rounded-lg p-3 bg-white shadow-sm">
                                                 <div className="mb-2">
                                                   <h4 className="font-medium text-sm text-gray-800">{milestone.work_milestone_name}</h4>
             
                                                 </div>
                                                 <div className="grid grid-cols-2 gap-3">
                                                   <div>
                                                     <p className="text-xs text-gray-500 mb-1">Status</p>
                                                     <Badge
                                                       variant="secondary"
                                                       className={`${getStatusBadgeClasses(milestone.status)} text-xs`}
                                                     >
                                                       {milestone.status}
                                                     </Badge>
                                                   </div>
                                                   <div>
                                                     {milestone.status === "Not Started" ? (
                                                       <>
                                                         <p className="text-xs text-gray-500 mb-1">Expected Start</p>
                                                         <p className="text-sm font-medium text-red-600">
                                                           {milestone.expected_starting_date ? formatDate(milestone.expected_starting_date) : 'N/A'}
                                                         </p>
                                                       </>
                                                     ) : (
                                                       <>
                                                         <p className="text-xs text-gray-500 mb-1">Expected Date</p>
                                                         <p className="text-sm font-medium">
                                                           {milestone.expected_completion_date ? formatDate(milestone.expected_completion_date) : 'N/A'}
                                                         </p>
                                                       </>
                                                     )}
                                                   </div>
                                                 </div>
                                                 <div className="mt-3">
                                                   <div className="flex justify-between items-center mb-1">
                                                     <p className="text-xs text-gray-500">Progress</p>
                                                     <span className="text-sm font-semibold">{milestone.progress}%</span>
                                                   </div>
                                                   <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                                                     <div
                                                       className="h-full bg-blue-500 rounded-full"
                                                       style={{ width: `${milestone.progress}%` }}
                                                     ></div>
                                                   </div>
                                                 </div>
                                                 {/* Milestone Remarks for Mobile */}
                                                 {milestone.remarks && (
                                                   <div className="mt-3">
                                                     <p className="text-xs text-gray-500 mb-1">Remarks</p>
                                                     <p className="p-2 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs">
                                                       {milestone.remarks}
                                                     </p>
                                                   </div>
                                                 )}
                                               </div>
                                             ))}
                                           </div>
                                         </div>
                                       )}
                                     </div>
             
                                   )})}
                                 </div>
                               )}
              {/* Work Images Section */}
              <div className="mt-6">
                <h3 className="text-base md:text-lg font-bold mb-3">Work Images</h3>
                <ImageBentoGrid
                  images={dailyReportDetails.attachments || []}
                  forPdf={false}
                />
              </div>
              
              {/* Download PDF Button (Server-Side) */}
              <div className="mt-8 flex justify-end gap-2">
                {dailyReportDetails && projectData && (
                  <>
                  <div> <span className="mr-3"> {showPrintHeader ?"Header Visible" : "Header Invisible"}:</span>
                     <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowPrintHeader(!showPrintHeader)}
                      title={showPrintHeader ? "Header will be printed" : "Header will be hidden"}
                    >
                     
                      {showPrintHeader ? <Eye className="w-4 h-4" />  : <EyeOff className="w-4 h-4 text-gray-400" />}
                    </Button>
                  </div>
                   
                    <Button
                      onClick={handleDownloadReport}
                      className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white"
                    >
                      <Download className="w-4 h-4" />
                      Download Report
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            // Display when no daily report found for the date
            <Card className="mt-4 p-4">
              <CardContent className="text-center flex flex-col items-center gap-4">
                <p className="text-gray-500">No daily report found for {formatDate(displayDate)}.</p>
              </CardContent>
            </Card>
          )
          ) : (
              // --- Overall Report Section ---
              <Card className="mt-4">
                <CardContent>
                    {/* Assuming OverallMilestonesReport takes projectData and selectedProject */}
                    <OverallMilestonesReport 
                        selectedProject={selectedProject} 
                        projectData={projectData}
                        selectedZone={selectedZone}
                    />
                </CardContent>
              </Card>
          )}
        </div>
      </div>
    </>
  );
};

export default MilestoneDailySummary;


// import React, { useRef, useMemo, useState, useContext, useEffect } from 'react';
// import { useLocation } from 'react-router-dom'; // Import to read URL parameters
// import { useReactToPrint } from 'react-to-print';
// import { formatDate } from '@/utils/FormatDate';
// import { MapPin, MessagesSquare, ChevronDown, ChevronUp } from 'lucide-react';

// // --- Frappe and Context Imports ---
// import { useFrappeGetDoc, useFrappeGetDocList } from 'frappe-react-sdk';
// import { UserContext } from "@/utils/auth/UserProvider"; 
// import { useUserData } from "@/hooks/useUserData"; 

// // --- UI Components ---
// import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
// import { Card, CardContent } from "@/components/ui/card";
// import {
//   Table,
//   TableBody,
//   TableCell,
//   TableHead,
//   TableHeader,
//   TableRow,
// } from "@/components/ui/table";
// import { cn } from '@/lib/utils'

// // --- Utility Imports (Ensure these exist in your project structure) ---
// import { DELIMITER, parseWorkPlan, serializeWorkPlan } from "./MilestoneTab"
// // Assuming MilestoneReportPDF is also imported or mocked
// import MilestoneReportPDF from "./components/MilestoneReportPDF";
// import { ProgressCircle } from '@/components/ui/ProgressCircle';


// // --- Helper Functions (Retained from original file) ---

// // Function to get query parameter from URL
// const useQuery = () => {
//   return new URLSearchParams(useLocation().search);
// };

// // Helper function to format date for input type="date" (YYYY-MM-DD)
// const formatDateForInput = (date: Date): string => {
//   const d = new Date(date);
//   const year = d.getFullYear();
//   const month = (d.getMonth() + 1).toString().padStart(2, '0');
//   const day = d.getDate().toString().padStart(2, '0');
//   return `${year}-${month}-${day}`;
// };

// // Function to get badge classes based on status
// const getStatusBadgeClasses = (status: string) => {
//   switch (status) {
//     case "Completed":
//       return "bg-green-100 text-green-800 hover:bg-green-200";
//     case "WIP":
//       return "bg-yellow-100 text-yellow-800 hover:bg-yellow-200";
//     case "Not Started":
//       return "bg-red-100 text-red-800 hover:bg-red-200";
//     case "N/A":
//       return "bg-gray-100 text-gray-800 hover:bg-gray-200";
//     default:
//       return "bg-blue-100 text-blue-800 hover:bg-blue-200";
//   }
// };

// // --- ProgressCircle Placeholder (Using the simplified version from your code) ---
// // Note: You must ensure the real ProgressCircle component is imported if this is production code.
// // The provided ProgressCircle logic is kept here for completeness.

// const getColorForProgress = (value: number): string => {
//   const val = Math.round(value)
//   if (isNaN(val)) {
//     return 'text-gray-500'
//   }
//   if (val === 0) {
//     return 'text-black-500'
//   }
//   if (val < 50) {
//     return 'text-red-600'
//   }
//   if (val < 75) {
//     return 'text-yellow-600'
//   }
//   if (val < 100) {
//     return 'text-green-600'
//   }
//   return 'text-green-500'
// }

// interface MilestoneProgressProps {
//   milestoneStatus: 'Not Applicable' | 'In Progress' | 'Completed' | string
//   value: number
//   sizeClassName?: string
//   textSizeClassName?: string
// }

// export const MilestoneProgress = ({
//   milestoneStatus,
//   value,
//   sizeClassName = "size-[60px]",
//   textSizeClassName = "text-md"
// }: MilestoneProgressProps) => {

//   if (milestoneStatus === "Not Applicable" || value == "N/A") {
//     return (
//       <div
//         className={cn(
//           "relative inline-flex items-center justify-center",
//           "text-gray-500 font-semibold",
//           sizeClassName,
//           textSizeClassName
//         )}
//       >
//         N/A
//       </div>
//     )
//   }

//   const colorClass = getColorForProgress(value)

//   return (
//     <ProgressCircle
//       value={value}
//       className={cn(sizeClassName, colorClass)}
//       textSizeClassName={textSizeClassName}
//     />
//   )
// }

// // --- Main Component: MilestoneDailySummary ---

// // The component no longer needs props, as it reads from the URL
// export const MilestoneDailySummary = () => {
//   const query = useQuery();
//   const initialProjectId = query.get('project_id') || '';
//   const initialDateStr = query.get('report_date'); // YYYY-MM-DD from URL
//   const initialDate = initialDateStr ? new Date(initialDateStr) : new Date();

//   const { role } = useUserData();
  
//   // Project is fixed from URL parameter
//   const selectedProject = initialProjectId;
  
//   // Date state initialized from URL, but can be changed by user
//   const [displayDate, setDisplayDate] = useState<Date>(initialDate); 

//   // Report type is fixed to 'Daily'
//   const reportType = 'Daily'; 

//   const [reportForDisplayDateName, setReportForDisplayDateName] = useState<string | null>(null);
//   const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
//   const [allExpanded, setAllExpanded] = useState(false);

//   // Fetch project data
//   const {
//     data: projectData,
//     isLoading: projectLoading,
//     error: projectError,
//   } = useFrappeGetDoc("Projects", selectedProject, selectedProject ? undefined : null);

//   // Fetch list of Project Progress Reports
//   const {
//     data: projectProgressReports,
//     isLoading: projectProgressLoading,
//     error: projectProgressError,
//   } = useFrappeGetDocList(
//     "Project Progress Reports",
//     {
//       fields: ["name", "report_date", "project"],
//       limit: 0,
//       filters: [
//         ["project", "=", selectedProject],
//         ["report_status", "=", "Completed"]
//       ],
//     },
//     selectedProject ? undefined : null
//   );

//   // Fetch the detailed Daily Report
//   const {
//     data: dailyReportDetails,
//     isLoading: dailyReportLoading,
//     error: dailyReportError,
//   } = useFrappeGetDoc(
//     "Project Progress Reports",
//     reportForDisplayDateName,
//     reportForDisplayDateName ? undefined : null
//   );

//   // Effect to determine reportForDisplayDateName based on selectedProject and displayDate
//   useEffect(() => {
//     if (projectProgressReports && displayDate) { // Fixed: removed undefined variable selectedReportDate
//       const selectedDateFormatted = formatDate(displayDate); 

//       const foundReport = projectProgressReports.find(
//         (report: any) => formatDate(report.report_date) === selectedDateFormatted
//       );

//       setReportForDisplayDateName(foundReport ? foundReport.name : null);
//     }
//   }, [projectProgressReports, displayDate]);

//   // Initialize expanded sections when dailyReportDetails changes
//   useEffect(() => {
//     if (dailyReportDetails?.milestones) {
//       const sections = dailyReportDetails.milestones.reduce((acc: any, milestone: any) => {
//         acc[milestone.work_header] = true; 
//         return acc;
//       }, {} as Record<string, boolean>);
//       setExpandedSections(sections);
//       setAllExpanded(true);
//     }
//   }, [dailyReportDetails]);


//   // --- Collapse/Expand Logic ---
//   const toggleSection = (section: string) => {
//     setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
//   };

//   const toggleAllSections = () => {
//     const newState = !allExpanded;
//     setAllExpanded(newState);
//     if (dailyReportDetails?.milestones) {
//       const sections = dailyReportDetails.milestones.reduce((acc: any, milestone: any) => {
//         acc[milestone.work_header] = newState;
//         return acc;
//       }, {} as Record<string, boolean>);
//       setExpandedSections(sections);
//     }
//   };

//   const areAllSectionsExpanded = () => {
//     if (!dailyReportDetails?.milestones) return false;
//     return Object.values(expandedSections).every(Boolean);
//   };
//   // --- End Collapse/Expand Logic ---


//   // --- Work Plan Grouping (Incorporating WIP/Not Started) ---
//   const workPlanGroupedMilestones = useMemo(() => {
//     if (!dailyReportDetails?.milestones) return {};

//     return dailyReportDetails.milestones.reduce((acc: any, milestone: any) => {
//       const isRelevantStatus = milestone.status === "WIP" || milestone.status === "Not Started";
//       const hasWorkPlanContent = milestone.work_plan && parseWorkPlan(milestone.work_plan).length > 0;

//       if (hasWorkPlanContent || isRelevantStatus) {
//         (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
//       }
//       return acc;
//     }, {});
//   }, [dailyReportDetails]);
//   // --- End Work Plan Grouping ---


//   // Calculate metrics for the Daily Work Report Summary Section
//   const totalWorkHeaders = dailyReportDetails?.milestones?.length || 0;
//   const completedWorksOnReport = dailyReportDetails?.milestones?.filter((m: any) => m.status === "Completed").length || 0;
//   const totalManpowerInReport = dailyReportDetails?.manpower?.reduce((sum: number, mp: any) => sum + Number(mp.count || 0), 0) || 0;

//   // --- Loading and Error States ---
//   if (!selectedProject) return <h1>No Project ID found in URL.</h1>;
//   if (projectLoading || projectProgressLoading || dailyReportLoading) return <h1>Loading...</h1>;
//   if (projectError || projectProgressError) return <h1>Error loading project data.</h1>;

  
//   return (
//     <>
//       <div className="flex-1 space-y-4 min-h-[50vh]">

//         {/* --- Main Content --- */}
//         <div className="mx-0 px-0 pt-4">
          
//           {/* Report Type and Show By Date section (Simplified) */}
//           <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 p-4 shadow-sm border border-gray-300 rounded-md gap-3">
            
//             {/* Project Name (Fixed) */}
//             <div className="font-bold text-lg text-gray-800">
//                <span className="font-semibold text-gray-700 whitespace-nowrap">Project Name : </span>
//                 {projectData?.project_name || "Daily Report Summary"}
//             </div>

//             {/* Date Picker (Editable) */}
//             <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
//               <span className="font-semibold text-gray-700 whitespace-nowrap">Report Date</span>
//               <div className="relative w-full md:w-auto">
//                 <input
//                   type="date"
//                   value={displayDate ? formatDateForInput(displayDate) : ''}
//                   onChange={(e) => setDisplayDate(new Date(e.target.value))}
//                   className="pl-3 pr-10 py-2 border border-gray-300 rounded-md text-sm cursor-pointer w-full"
//                 />
//               </div>
//             </div>
//           </div>

//           {/* Conditional rendering for Daily Work Report Card or placeholder */}
//           {dailyReportDetails ? (
//             <div className="bg-white p-3 md:p-4 rounded-lg shadow-sm border border-gray-300">
              
//               {/* Report Header */}
//               <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 border-b pb-2 gap-2">
//                 <h2 className="text-lg md:text-xl font-bold">Daily Work Report</h2>
//                 <span className="text-gray-600 text-sm md:text-base">
//                   {dailyReportDetails.report_date ? formatDate(dailyReportDetails.report_date) : formatDate(displayDate)}
//                 </span>
//               </div>

//               {/* Summary Metrics */}
//               <div className="mb-6 space-y-2 text-gray-700">
//                 <div className="flex justify-between text-sm">
//                   <span>Total numbers of work Done:</span>
//                   <span className="font-semibold">{completedWorksOnReport.toString().padStart(2, '0')}</span>
//                 </div>
//                 <div className="flex justify-between text-sm">
//                   <span>Total numbers of Work:</span>
//                   <span className="font-semibold">{totalWorkHeaders.toString().padStart(2, '0')}</span>
//                 </div>
//                 <div className="flex justify-between text-sm">
//                   <span>Manpower Used:</span>
//                   <span className="font-semibold">{totalManpowerInReport.toString().padStart(2, '0')}</span>
//                 </div>
//               </div>

//               {/* Manpower Section */}
//               {dailyReportDetails.manpower && dailyReportDetails.manpower.length > 0 && (
//                 <div className="mb-6">
//                   <h3 className="text-base md:text-lg font-bold mb-3">Manpower - {totalManpowerInReport.toString().padStart(2, '0')}</h3>
//                   <div className="space-y-2">
//                     {dailyReportDetails.manpower.map((mp_detail: any, idx: number) => (
//                       <div key={idx} className="flex justify-between items-center text-gray-700 text-sm">
//                         <span className="font-medium">{mp_detail.label}</span>
//                         <span className="font-semibold">{mp_detail.count.toString().padStart(2, '0')}</span>
//                       </div>
//                     ))}
//                     {dailyReportDetails.manpower_remarks && (
//                       <div className={"mt-2"}>
//                         <p className="text-xs text-muted-foreground">{"Remarks"}</p>
//                         <div className="mt-1 p-3 rounded-md bg-gray-50 border border-gray-200 text-gray-800 text-sm whitespace-pre-wrap break-words">
//                           {dailyReportDetails.manpower_remarks}
//                         </div>
//                       </div>
//                     )}
//                   </div>
//                 </div>
//               )}


//               {/* --- Work Plan Summary (Using workPlanGroupedMilestones) --- */}
//               {Object.entries(workPlanGroupedMilestones).length > 0 && (
//                 <div className="mb-6">
//                   <h3 className="text-lg md:text-xl font-bold mb-6 border-b">Work Plan</h3>
                  
//                   {Object.entries(workPlanGroupedMilestones).map(([header, milestones], groupIdx) => (
//                     <div key={groupIdx} className="mb-4 last:mb-0 rounded-md overflow-hidden">
//                       {/* Header */}
//                       <div className="p-3 bg-gray-50">
//                         <h3 className="text-base md:text-lg font-bold">
//                           {header} - {(milestones as any[]).length.toString().padStart(2, '0')}
//                         </h3>
//                       </div>

//                       {/* Content */}
//                       <div className="p-3">
//                         <div className="space-y-3">
//                           {(milestones as any[]).map((milestone: any, idx: number) => {
//                             const milestoneWorkPlan = parseWorkPlan(milestone.work_plan);
//                             // Check for any non-empty item in the work plan array
//                             const hasValidPoints = milestoneWorkPlan.some((point: string) => point.trim() !== "");

//                             return (
//                               <div key={idx} className="border rounded-lg p-3 bg-white shadow-sm">
//                                 <div className="mb-2">
//                                   <h4 className="font-medium text-sm text-gray-800">
//                                     {milestone.work_milestone_name}
//                                   </h4>
//                                 </div>
                                
//                                 <div className="mt-3">
//                                   {hasValidPoints ? (
//                                     // Case 1: Work plan exists, render the list
//                                     <div className="p-2 bg-blue-50 border border-blue-200 rounded-md">
//                                       <ul className="list-disc list-inside text-xs text-blue-800 space-y-0.5 ml-2">
//                                         {milestoneWorkPlan.map((point: string, i: number) => (
//                                           point.trim() !== "" ? (
//                                             <li key={i} className="break-words whitespace-pre-wrap">
//                                               {point}
//                                             </li>
//                                           ) : null
//                                         ))}
//                                       </ul>
//                                     </div>
//                                   ) : (
//                                     // Case 2: No valid work plan, render "Nothing" in red
//                                     <div className="p-2 bg-red-50 border border-red-200 rounded-md text-center">
//                                       <span className="text-sm font-semibold text-red-700">Nothing</span>
//                                     </div>
//                                   )}
//                                 </div>
//                               </div>
//                             );
//                           })}
//                         </div>
//                       </div>
//                     </div>
//                   ))}
//                 </div>
//               )}
//               {/* --- End Work Plan Summary --- */}



//               {/* Work Progress Sections (Ducting, FA PA & ACS etc.) */}
//               {dailyReportDetails.milestones && dailyReportDetails.milestones.length > 0 && (
//                 <div className="mb-6">
//                   {/* Expand/Collapse All Button */}
//                   <h3 className="text-lg md:text-xl font-bold mb-6 border-b">Work Milestones</h3>
//                   <div className="flex justify-end mb-3">
//                     <Button
//                       variant="outline"
//                       size="sm"
//                       onClick={toggleAllSections}
//                       className="flex items-center gap-1 text-xs md:text-sm"
//                     >
//                       {areAllSectionsExpanded() ? (
//                         <>
//                           <ChevronUp className="h-4 w-4" />
//                           Collapse All
//                         </>
//                       ) : (
//                         <>
//                           <ChevronDown className="h-4 w-4" />
//                           Expand All
//                         </>
//                       )}
//                     </Button>
//                   </div>

//                   {Object.entries(
//                     dailyReportDetails.milestones.reduce((acc: any, milestone: any) => {
//                       (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
//                       return acc;
//                     }, {})
//                   ).map(([header, milestones], groupIdx) => (
//                     <div key={groupIdx} className="mb-4 last:mb-0 border rounded-md overflow-hidden">
//                       {/* Collapsible Header */}
//                       <div
//                         className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
//                         onClick={() => toggleSection(header)}
//                       >
//                         <h3 className="text-base md:text-lg font-bold">{header} - {(milestones as any[]).length.toString().padStart(2, '0')}</h3>
//                         <div className="flex items-center">
//                           <span className="text-xs md:text-sm text-gray-500 mr-2">
//                             {(milestones as any[]).length} milestone{(milestones as any[]).length !== 1 ? 's' : ''}
//                           </span>
//                           {expandedSections[header] ? (
//                             <ChevronUp className="h-5 w-5 text-gray-600" />
//                           ) : (
//                             <ChevronDown className="h-5 w-5 text-gray-600" />
//                           )}
//                         </div>
//                       </div>

//                       {/* Collapsible Content */}
//                       {expandedSections[header] && (
//                         <div className="p-3">
//                           {/* Desktop Table View */}
//                           <div className="hidden md:block">
//                             <Table className="w-full">
//                               <TableHeader>
//                                 <TableRow className="bg-gray-100">
//                                   <TableHead className="w-[40%] font-semibold text-gray-700 text-sm py-2">Work</TableHead>
//                                   <TableHead className="w-[20%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
//                                   <TableHead className="w-[20%] text-center font-semibold text-gray-700 text-sm py-2">Progress</TableHead>
//                                   <TableHead className="w-[20%] text-center font-semibold text-gray-700 text-sm py-2">Excepted Starting/completion Date</TableHead>

//                                 </TableRow>

//                               </TableHeader>
//                               <TableBody>
//                                 {(milestones as any[]).map((milestone: any, idx: number) => (
//                                   <TableRow key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
//                                     <TableCell className="py-3 px-4 text-sm">{milestone.work_milestone_name}
//                                       {milestone.remarks && (
//                                         <div className="mt-1">
//                                           <p className="flex items-center gap-2 p-1 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs">
//                                             <MessagesSquare className="h-4 w-4 flex-shrink-0" />
//                                             <span className="flex-grow">
//                                               {milestone.remarks}
//                                             </span>
//                                           </p>
//                                         </div>
//                                       )}
//                                     </TableCell>
//                                     <TableCell className="text-center py-3 px-4">
//                                       <Badge
//                                         variant="secondary"
//                                         className={`${getStatusBadgeClasses(milestone.status)} text-xs`}
//                                       >
//                                         {milestone.status}
//                                       </Badge>
//                                     </TableCell>

//                                     <TableCell className="text-center py-3 px-4 font-medium">
//                                       <MilestoneProgress
//                                         milestoneStatus={milestone.status}
//                                         value={milestone.progress}
//                                         sizeClassName="size-[60px]"
//                                         textSizeClassName="text-md"
//                                       />

//                                     </TableCell>
//                                     <TableCell className="text-center py-3 px-4 text-sm">
//                                       {milestone.status === "Not Started" ? (
//                                         <span className="text-red-600 font-medium">
//                                           {milestone.expected_starting_date ? formatDate(milestone.expected_starting_date) : 'N/A'}
//                                         </span>
//                                       ) : (
//                                         <span className="text-green-500 font-medium">{milestone.expected_completion_date ? formatDate(milestone.expected_completion_date) : 'N/A'}</span>

//                                       )}
//                                     </TableCell>
//                                   </TableRow>
//                                 ))}
//                               </TableBody>
//                             </Table>
//                           </div>

//                           {/* Mobile Card View */}
//                           <div className="md:hidden space-y-3">
//                             {(milestones as any[]).map((milestone: any, idx: number) => (
//                               <div key={idx} className="border rounded-lg p-3 bg-white shadow-sm">
//                                 <div className="mb-2">
//                                   <h4 className="font-medium text-sm text-gray-800">{milestone.work_milestone_name}</h4>

//                                 </div>
//                                 <div className="grid grid-cols-2 gap-3">
//                                   <div>
//                                     <p className="text-xs text-gray-500 mb-1">Status</p>
//                                     <Badge
//                                       variant="secondary"
//                                       className={`${getStatusBadgeClasses(milestone.status)} text-xs`}
//                                     >
//                                       {milestone.status}
//                                     </Badge>
//                                   </div>
//                                   <div>
//                                     {milestone.status === "Not Started" ? (
//                                       <>
//                                         <p className="text-xs text-gray-500 mb-1">Expected Start</p>
//                                         <p className="text-sm font-medium text-red-600">
//                                           {milestone.expected_starting_date ? formatDate(milestone.expected_starting_date) : 'N/A'}
//                                         </p>
//                                       </>
//                                     ) : (
//                                       <>
//                                         <p className="text-xs text-gray-500 mb-1">Expected Date</p>
//                                         <p className="text-sm font-medium">
//                                           {milestone.expected_completion_date ? formatDate(milestone.expected_completion_date) : 'N/A'}
//                                         </p>
//                                       </>
//                                     )}
//                                   </div>
//                                 </div>
//                                 <div className="mt-3">
//                                   <div className="flex justify-between items-center mb-1">
//                                     <p className="text-xs text-gray-500">Progress</p>
//                                     <span className="text-sm font-semibold">{milestone.progress}%</span>
//                                   </div>
//                                   <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
//                                     <div
//                                       className="h-full bg-blue-500 rounded-full"
//                                       style={{ width: `${milestone.progress}%` }}
//                                     ></div>
//                                   </div>
//                                 </div>
//                                 {/* Milestone Remarks for Mobile */}
//                                 {milestone.remarks && (
//                                   <div className="mt-3">
//                                     <p className="text-xs text-gray-500 mb-1">Remarks</p>
//                                     <p className="p-2 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs">
//                                       {milestone.remarks}
//                                     </p>
//                                   </div>
//                                 )}
//                               </div>
//                             ))}
//                           </div>
//                         </div>
//                       )}
//                     </div>
//                   ))}
//                 </div>
//               )}

//               {/* Work Images Section */}
//               <div className="mt-6">
//                 <h3 className="text-base md:text-lg font-bold mb-3">Work Images</h3>
//                 {dailyReportDetails.attachments && dailyReportDetails.attachments.length > 0 ? (
//                   <div className="grid grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-3 md:gap-4">
//                     {dailyReportDetails.attachments.map((attachment: any, idx: number) => (
//                       <div
//                         key={idx}
//                         className="rounded-lg overflow-hidden shadow-md bg-white border border-gray-200" // Card wrapper
//                       >
//                         {/* Responsive container for image and text details */}
//                         {/* Stacks on mobile (flex-col), becomes row on small screens and up (sm:flex-row) */}
//                         <div className="flex flex-col sm:flex-row h-full">
//                           {/* Image container */}
//                           <div className="w-full sm:w-1/2 flex-shrink-0">
//                             <img
//                               src={attachment.image_link}
//                               alt={`Work Image ${idx + 1}`}
//                               className="w-full h-[180px] sm:h-full object-cover rounded-t-lg sm:rounded-l-lg sm:rounded-tr-none" // Adjust rounding based on layout
//                             />
//                           </div>

//                           <div className="w-full sm:w-1/2 p-3 flex flex-col justify-between">
//                             {/* Location */}
//                             <div className="flex items-center text-xs text-gray-700 mb-2">
//                               <MapPin className="h-4 w-4 mr-1 text-red-500 flex-shrink-0" />
//                               <span className="font-medium break-words">
//                                 {attachment.location || `Lat: ${attachment.latitude?.toFixed(2)}, Lon: ${attachment.longitude?.toFixed(2)}`}
//                               </span>
//                             </div>
//                             {/* Remarks - highlighted yellow card style, pushed to bottom if space */}
//                             <p className="p-2 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs mt-auto">
//                               <MessagesSquare className="h-4 w-4 inline-block mr-1 flex-shrink-0" />
//                               {attachment.remarks || "No remarks provided."}
//                             </p>
//                           </div>
//                         </div>
//                       </div>
//                     ))}
//                   </div>
//                 ) : (
//                   <div className="w-full h-32 bg-gray-100 flex items-center justify-center text-gray-500 rounded-lg border-2 border-dashed border-gray-300">
//                     <p className="text-base font-medium">No Work Images Available</p>
//                   </div>
//                 )}
//               </div>
              
//               {/* Download PDF Button */}
//               <div className="mt-8 flex justify-end">
//                 {dailyReportDetails && projectData && (
//                   <MilestoneReportPDF
//                     dailyReportDetails={dailyReportDetails}
//                     projectData={projectData}
//                   />
//                 )}
//               </div>
//             </div>
//           ) : (
//             // Display when no report found for the date
//             <Card className="mt-4 p-4">
//               <CardContent className="text-center flex flex-col items-center gap-4">
//                 <p className="text-gray-500">No daily report found for {formatDate(displayDate)}.</p>
//               </CardContent>
//             </Card>
//           )}
//         </div>
//       </div>
//     </>
//   );
// };

// export default MilestoneDailySummary;