import { UserContext } from "@/utils/auth/UserProvider";
import { formatDate } from "@/utils/FormatDate";
import {
  useFrappeCreateDoc,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc
} from "frappe-react-sdk";
import { MapPin, ChevronDown, ChevronUp, MessagesSquare } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate } from "react-router-dom";
// import ProjectSelect from "@/components/custom-select/project-select";
import ProjectMilestoneSelect from "@/components/custom-select/project-milestone-select";
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
import { toast } from "@/components/ui/use-toast";
import MilestoneReportPDF from "./components/MilestoneReportPDF";
import OverallMilestonesReport from "./components/OverallMilestonesReport"
import { useUserData } from "@/hooks/useUserData";
import { ProgressCircle } from "@/components/ui/ProgressCircle";
import { cn } from '@/lib/utils' // Assuming you have this utility


// Helper function to format date for input type="date" (YYYY-MM-DD)
const formatDateForInput = (date: Date): string => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
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


// Define the required props for your wrapper
interface MilestoneProgressProps {
  milestoneStatus: 'Not Applicable' | 'In Progress' | 'Completed' | string
  value: number // The progress percentage (0-100)
  // Optional size and text size for consistency
  sizeClassName?: string // e.g., "size-[60px]"
  textSizeClassName?: string // e.g., "text-md"
}

const getColorForProgress = (value: number): string => {
  const val = Math.round(value)

  if (val === 0) {
    return 'text-black-500' // Gray for 0%
  }
  if (val < 50) {
    return 'text-red-600' // Red for 1-49%
  }
  if (val < 75) {
    return 'text-yellow-600' // Yellow for 50-74%
  }
  if (val < 100) {
    return 'text-green-600' // Blue for 75-99%
  }
  
  // 100% will be overridden by isComplete check in ProgressCircle
  return 'text-green-500'
}

export const MilestoneProgress = ({
  milestoneStatus,
  value,
  sizeClassName = "size-[60px]",
  textSizeClassName = "text-md"
}: MilestoneProgressProps) => {

  // Handle N/A case
  if (milestoneStatus === "Not Applicable") {
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

  // Get color class based on value
  const colorClass = getColorForProgress(value)

  return (
    <ProgressCircle
      value={value}
      // IMPORTANT: className must include BOTH size AND color
      className={cn(sizeClassName, colorClass)}
      textSizeClassName={textSizeClassName}
    />
  )
}

export const MilestonesSummary = ({ workReport = false, projectIdForWorkReport }) => {
  const { selectedProject, setSelectedProject } = useContext(UserContext);
  const navigate = useNavigate();
  const { role, has_project } = useUserData()


  console.log(selectedProject, projectIdForWorkReport)
  if (workReport) {
    console.log("In work report", projectIdForWorkReport)
    setSelectedProject(projectIdForWorkReport)
  }
  // State for Report Type toggle ('Daily' or 'Overall')
  const [reportType, setReportType] = useState<'Daily' | 'Overall'>('Daily');
  // State for the date selected by the user for displaying reports
  const [displayDate, setDisplayDate] = useState<Date>(new Date()); // Initialize with today's date

  // State to hold the Frappe document name of the Project Progress Report for the selected displayDate
  const [reportForDisplayDateName, setReportForDisplayDateName] = useState<string | null>(null);

  // State for collapsible sections
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);

  // Fetch project data (e.g., project name, work packages)
  const {
    data: projectData,
    isLoading: projectLoading,
    error: projectError,
  } = useFrappeGetDoc("Projects", selectedProject, selectedProject ? undefined : null);

  // Fetch list of Project Progress Reports (to find report names by date)
  const {
    data: projectProgressReports,
    isLoading: projectProgressLoading,
    error: projectProgressError,
  } = useFrappeGetDocList(
    "Project Progress Reports",
    {
      fields: ["name", "report_date", "project"],
      filters: [
        ["project", "=", selectedProject],
        ["report_status", "=", "Completed"]
      ],
    },
    selectedProject ? undefined : null
  );

  // Fetch the detailed Project Progress Report for the determined reportForDisplayDateName
  const {
    data: dailyReportDetails,
    isLoading: dailyReportLoading,
    error: dailyReportError,
  } = useFrappeGetDoc(
    "Project Progress Reports",
    reportForDisplayDateName, // Fetch using the determined report name
    reportForDisplayDateName && reportType === 'Daily' ? undefined : null // Only fetch if a name exists and reportType is Daily
  );

  // Effect to determine reportForDisplayDateName based on selectedProject and displayDate
  useEffect(() => {
    if (projectProgressReports && selectedProject && displayDate) {
      const selectedDateFormatted = formatDate(displayDate); // Assuming formatDate handles Date objects

      const foundReport = projectProgressReports.find(
        (report) => formatDate(report.report_date) === selectedDateFormatted
      );

      if (foundReport) {
        setReportForDisplayDateName(foundReport.name);
      } else {
        setReportForDisplayDateName(null);
      }
    }
  }, [projectProgressReports, selectedProject, displayDate]);

  // Initialize expanded sections when dailyReportDetails changes
  useEffect(() => {
    if (dailyReportDetails?.milestones) {
      const sections = dailyReportDetails.milestones.reduce((acc, milestone) => {
        acc[milestone.work_header] = true; // Default to expanded
        return acc;
      }, {} as Record<string, boolean>);
      setExpandedSections(sections);
      setAllExpanded(true);
    }
  }, [dailyReportDetails]);

  // Toggle individual section
  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Toggle all sections
  const toggleAllSections = () => {
    const newState = !allExpanded;
    setAllExpanded(newState);

    if (dailyReportDetails?.milestones) {
      const sections = dailyReportDetails.milestones.reduce((acc, milestone) => {
        acc[milestone.work_header] = newState;
        return acc;
      }, {} as Record<string, boolean>);
      setExpandedSections(sections);
    }
  };

  // Check if all sections are expanded
  const areAllSectionsExpanded = () => {
    if (!dailyReportDetails?.milestones) return false;
    return Object.values(expandedSections).every(Boolean);
  };

  // Handle project selection change
  const handleChange = (selectedItem: any) => {
    setSelectedProject(selectedItem ? selectedItem.value : null);
    if (selectedItem) {
      sessionStorage.setItem(
        "selectedProject",
        JSON.stringify(selectedItem.value)
      );
    } else {
      sessionStorage.removeItem("selectedProject");
    }
  };

  // Calculate metrics for the Daily Work Report Summary Section
  const totalWorkHeaders = dailyReportDetails?.milestones?.length || 0;
  const completedWorksOnReport = dailyReportDetails?.milestones?.filter(m => m.status === "Completed").length || 0;
  const totalManpowerInReport = dailyReportDetails?.manpower?.reduce((sum, mp) => sum + Number(mp.count || 0), 0) || 0;

  // Loading and Error States
  if (projectLoading || projectProgressLoading || dailyReportLoading) return <h1>Loading</h1>;
  if (projectError) {
    const specificErrorMessage = projectError?.message || "An unexpected issue occurred while fetching data.";

    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 bg-red-50 text-red-800 rounded-lg shadow-md m-4">
        <h3 className="text-2xl font-bold mb-2 text-center text-red-900">
          Failed to Load Data!
        </h3>
        <p className="text-lg text-center text-red-700 mb-4">
          We encountered a problem trying to fetch the necessary project information.
        </p>
        <p className="text-md text-center text-red-600 mb-6">
          Error Details: <span className="font-semibold">{specificErrorMessage}</span>
        </p>
        <Button
          onClick={() => {
            sessionStorage.removeItem('selectedProject'); // ADD THIS LINE
            navigate('/prs&milestones/milestone-report')
          }}
          className="bg-red-600 hover:bg-red-700 text-white text-lg py-3 px-8 rounded-full shadow-lg transition-all duration-300 ease-in-out hover:scale-105"
        >
          Go Back to Reports Overview
        </Button>
      </div>
    );
  }
  // --- End: Improved Generic Global Error Display ---


  return (
    <>
      <div className="flex-1 space-y-4 min-h-[50vh]">
        {/* Project Selector and "Update Milestone" button at the top */}
        {!workReport && (
          <div className="flex items-center gap-2">

            <div className="flex-1">
              <ProjectMilestoneSelect
                onChange={handleChange}
                universal={true} // Or false, depending on if you want to remember the selection
              />
            </div>

            {selectedProject && (
              <Button
                onClick={() => navigate(`${selectedProject}`)}
                className="text-xs"
                disabled={dailyReportDetails || reportType !== "Daily" || !selectedProject}
              >
                {"Add Today's Report"}
              </Button>
            )}
          </div>
        )}


        {selectedProject && (
          <div className="mx-0 px-0 pt-4">
            {/* Report Type and Show By Date section - as per image */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 p-4 shadow-sm border border-gray-300 rounded-md gap-3">
              <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
                {/* 1. Report Type Label */}
                <span className="font-semibold text-gray-700 whitespace-nowrap">Report Type</span>

                {/* 2. Daily/Overall Buttons */}
                <div className="flex rounded-md border border-gray-300 overflow-hidden w-full md:w-auto">
                  <button
                    className={`flex-1 px-4 py-2 text-sm font-medium ${reportType === 'Daily' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'}`}
                    onClick={() => setReportType('Daily')}
                  >
                    Daily
                  </button>
                  {role !== 'Nirmaan Project Manager Profile' && (<button
                    className={`flex-1 px-4 py-2 text-sm font-medium ${reportType === 'Overall' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'}`}
                    onClick={() => setReportType('Overall')}
                  >
                    Overall
                  </button>)}


                </div>
              </div>

              {reportType === 'Daily' && ( // Only show date picker for Daily report type
                <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
                  <span className="font-semibold text-gray-700 whitespace-nowrap">Report Date</span>
                  <div className="relative w-full md:w-auto">
                    <input
                      type="date"
                      value={displayDate ? formatDateForInput(displayDate) : ''}
                      onChange={(e) => setDisplayDate(new Date(e.target.value))}
                      className="pl-3 pr-10 py-2 border border-gray-300 rounded-md text-sm cursor-pointer w-full"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Conditional rendering for Daily Work Report Card or placeholder */}
            {reportType === 'Daily' ? (
              dailyReportDetails ? (
                <div className="bg-white p-3 md:p-4 rounded-lg shadow-sm border border-gray-300">
                  {/* Daily Work Report content - Matching the image */}
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 border-b pb-2 gap-2">
                    <h2 className="text-lg md:text-xl font-bold">Daily Work Report</h2>
                    {/* Display report date from the fetched dailyReportDetails, fallback to displayDate */}
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
                        {dailyReportDetails.manpower.map((mp_detail, idx) => (
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

                  {/* Work Progress Sections (Ducting, FA PA & ACS etc.) */}
                  {dailyReportDetails.milestones && dailyReportDetails.milestones.length > 0 && (
                    <div className="mb-6">
                      {/* Expand/Collapse All Button */}
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

                      {Object.entries(
                        dailyReportDetails.milestones.reduce((acc, milestone) => {
                          (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
                          return acc;
                        }, {})
                      ).map(([header, milestones], groupIdx) => (
                        <div key={groupIdx} className="mb-4 last:mb-0 border rounded-md overflow-hidden">
                          {/* Collapsible Header */}
                          <div
                            className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                            onClick={() => toggleSection(header)}
                          >
                            <h3 className="text-base md:text-lg font-bold">{header} - {milestones.length.toString().padStart(2, '0')}</h3>
                            <div className="flex items-center">
                              <span className="text-xs md:text-sm text-gray-500 mr-2">
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
                      ))}
                    </div>
                  )}

                  {/* Work Images Section */}
                  <div className="mt-6">
                    <h3 className="text-base md:text-lg font-bold mb-3">Work Images</h3>
                    {dailyReportDetails.attachments && dailyReportDetails.attachments.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-3 md:gap-4">
                        {dailyReportDetails.attachments.map((attachment, idx) => (
                          <div
                            key={idx}
                            className="rounded-lg overflow-hidden shadow-md bg-white border border-gray-200" // Card wrapper
                          >
                            {/* Responsive container for image and text details */}
                            {/* Stacks on mobile (flex-col), becomes row on small screens and up (sm:flex-row) */}
                            <div className="flex flex-col sm:flex-row h-full">
                              {/* Image container */}
                              <div className="w-full sm:w-1/2 flex-shrink-0">
                                <img
                                  src={attachment.image_link}
                                  alt={`Work Image ${idx + 1}`}
                                  className="w-full h-[180px] sm:h-full object-cover rounded-t-lg sm:rounded-l-lg sm:rounded-tr-none" // Adjust rounding based on layout
                                />
                              </div>

                              <div className="w-full sm:w-1/2 p-3 flex flex-col justify-between">
                                {/* Location */}
                                <div className="flex items-center text-xs text-gray-700 mb-2">
                                  <MapPin className="h-4 w-4 mr-1 text-red-500 flex-shrink-0" />
                                  <span className="font-medium break-words">
                                    {attachment.location || `Lat: ${attachment.latitude?.toFixed(2)}, Lon: ${attachment.longitude?.toFixed(2)}`}
                                  </span>
                                </div>
                                {/* Remarks - highlighted yellow card style, pushed to bottom if space */}
                                <p className="p-2 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs mt-auto">
                                  <MessagesSquare className="h-4 w-4 inline-block mr-1 flex-shrink-0" />
                                  {attachment.remarks || "No remarks provided."}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="w-full h-32 bg-gray-100 flex items-center justify-center text-gray-500 rounded-lg border-2 border-dashed border-gray-300">
                        <p className="text-base font-medium">No Work Images Available</p>
                      </div>
                    )}
                  </div>
                  {/* Download PDF Button */}
                  <div className="mt-8 flex justify-end">
                    {dailyReportDetails && projectData && (
                      <MilestoneReportPDF
                        dailyReportDetails={dailyReportDetails}
                        projectData={projectData}
                      />
                    )}
                  </div>
                </div>
              ) : (
                // Display when Daily is selected but no report found for the date
                <Card className="mt-4 p-4">
                  <CardContent className="text-center flex flex-col items-center gap-4">
                    <p className="text-gray-500">No daily report found for {formatDate(displayDate)}.</p>
                  </CardContent>
                </Card>
              )
            ) : (
              // Display when Overall is selected (placeholder)
              <Card className="mt-4">
                <CardContent>
                  <OverallMilestonesReport selectedProject={selectedProject} projectData={projectData} />
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
};

// import { UserContext } from "@/utils/auth/UserProvider";
// import { formatDate } from "@/utils/FormatDate";
// // import { Pencil2Icon } from "@radix-ui/react-icons"; // Removed as old manpower editing is gone
// import {
//   useFrappeCreateDoc, // Retained for potentially creating new Daily Reports if navigate target is a form
//   useFrappeGetDoc,
//   useFrappeGetDocList,
//   useFrappeUpdateDoc // Retained for potential editing of Daily Reports if navigate target is a form
// } from "frappe-react-sdk";
// import { MapPin } from "lucide-react"; // MapPin is used for image location
// import { useContext, useEffect, useState } from "react";
// import { TailSpin } from "react-loader-spinner"; // Retained for loading states on forms
// import { useNavigate } from "react-router-dom";
// import ProjectSelect from "@/components/custom-select/project-select";
// import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
// import { Card, CardContent } from "@/components/ui/card";
// // Removed Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger as old manpower editing is gone
// // Removed Sheet, SheetContent as old manpower report creation is gone
// import {
//   Table,
//   TableBody,
//   TableCell,
//   TableHead,
//   TableHeader,
//   TableRow,
// } from "@/components/ui/table";
// import { toast } from "@/components/ui/use-toast";
// // Assuming CalendarIcon if needed for the date picker placeholder, otherwise it's not strictly necessary.
// // import { CalendarIcon } from "@radix-ui/react-icons";


// // Helper function to format date for input type="date" (YYYY-MM-DD)
// const formatDateForInput = (date: Date): string => {
//   const d = new Date(date);
//   const year = d.getFullYear();
//   const month = (d.getMonth() + 1).toString().padStart(2, '0');
//   const day = d.getDate().toString().padStart(2, '0');
//   return `${year}-${month}-${day}`;
// };

// export const MilestonesSummary = () => {
//   const { selectedProject, setSelectedProject } = useContext(UserContext);
//   const navigate = useNavigate();

//   // State for Report Type toggle ('Daily' or 'Overall')
//   const [reportType, setReportType] = useState<'Daily' | 'Overall'>('Daily');
//   // State for the date selected by the user for displaying reports
//   const [displayDate, setDisplayDate] = useState<Date>(new Date()); // Initialize with today's date

//   // State to hold the Frappe document name of the Project Progress Report for the selected displayDate
//   const [reportForDisplayDateName, setReportForDisplayDateName] = useState<string | null>(null);

//   // Fetch project data (e.g., project name, work packages)
//   const {
//     data: projectData,
//     isLoading: projectLoading,
//     error: projectError,
//   } = useFrappeGetDoc("Projects", selectedProject, selectedProject ? undefined : null);

//   // Fetch list of Project Progress Reports (to find report names by date)
//   const {
//     data: projectProgressReports,
//     isLoading: projectProgressLoading,
//     error: projectProgressError,
//   } = useFrappeGetDocList(
//     "Project Progress Reports",
//     {
//       fields: ["name", "report_date", "project"],
//       filters: [
//         ["project", "=", selectedProject],
//       ],
//     },
//     selectedProject ? undefined : null
//   );

//   // Fetch the detailed Project Progress Report for the determined reportForDisplayDateName
//   const {
//     data: dailyReportDetails,
//     isLoading: dailyReportLoading,
//     error: dailyReportError,
//   } = useFrappeGetDoc(
//     "Project Progress Reports",
//     reportForDisplayDateName, // Fetch using the determined report name
//     reportForDisplayDateName && reportType === 'Daily' ? undefined : null // Only fetch if a name exists and reportType is Daily
//   );

//   // Effect to determine reportForDisplayDateName based on selectedProject and displayDate
//   useEffect(() => {
//     if (projectProgressReports && selectedProject && displayDate) {
//       const selectedDateFormatted = formatDate(displayDate); // Assuming formatDate handles Date objects

//       const foundReport = projectProgressReports.find(
//         (report) => formatDate(report.report_date) === selectedDateFormatted
//       );

//       if (foundReport) {
//         setReportForDisplayDateName(foundReport.name);
//       } else {
//         setReportForDisplayDateName(null);
//       }
//     }
//   }, [projectProgressReports, selectedProject, displayDate]);

//   // Handle project selection change
//   const handleChange = (selectedItem: any) => {
//     setSelectedProject(selectedItem ? selectedItem.value : null);
//     if (selectedItem) {
//       sessionStorage.setItem(
//         "selectedProject",
//         JSON.stringify(selectedItem.value)
//       );
//     } else {
//       sessionStorage.removeItem("selectedProject");
//     }
//   };

//   // Calculate metrics for the Daily Work Report Summary Section
//   const totalWorkHeaders = dailyReportDetails?.milestones?.length || 0;
//   const completedWorksOnReport = dailyReportDetails?.milestones?.filter(m => m.status === "Completed").length || 0;
//   const totalManpowerInReport = dailyReportDetails?.manpower?.reduce((sum, mp) => sum + Number(mp.count || 0), 0) || 0;

//   // Loading and Error States
//   if (projectLoading || projectProgressLoading || dailyReportLoading) return <h1>Loading</h1>;
//   if (projectError || projectProgressError || dailyReportError) return <h1>Error</h1>;

//   return (
//     <>
//       <div className="flex-1 space-y-4 min-h-[50vh]">
//         {/* Project Selector and "Update Milestone" button at the top */}
//         <div className="flex items-center gap-2">
//           <div className="flex-1">
//             <ProjectSelect onChange={handleChange} />
//           </div>
//           {selectedProject && (
//             <Button
//               onClick={() => navigate(`${selectedProject}`)}
//               className="text-xs"
//               disabled={dailyReportDetails}
//             >
//               {dailyReportDetails ? "Today's Milestone Updated" : "Update Milestone"}
//             </Button>
//           )}
//         </div>

//         {selectedProject && (
//           <div className="mx-0 px-0 pt-4 ">
//             {/* Report Type and Show By Date section - as per image */}
//             <div className="flex items-center justify-between mb-4 p-4 shadow-sm border border-gray-300 rounded-md">
//               <div className="flex flex-col md:flex-row md:items-center gap-2"> {/* Fix applied here */}
//                 {/* 1. Report Type Label */}
//                 <span className="font-semibold text-gray-700">Report Type</span>

//                 {/* 2. Daily/Overall Buttons */}
//                 <div className="flex rounded-md border border-gray-300 overflow-hidden">
//                   <button
//                     className={`px-4 py-2 text-sm font-medium ${reportType === 'Daily' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'}`}
//                     onClick={() => setReportType('Daily')}
//                   >
//                     Daily
//                   </button>
//                   <button
//                     className={`px-4 py-2 text-sm font-medium ${reportType === 'Overall' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'}`}
//                     onClick={() => setReportType('Overall')}
//                   >
//                     Overall
//                   </button>
//                 </div>
//               </div>

//               {reportType === 'Daily' && ( // Only show date picker for Daily report type
//                 <div className="flex flex-col md:flex-row md:items-center gap-2"> {/* Fix applied here */}
//                   <span className="font-semibold text-gray-700">Show by Date</span>
//                   <div className="relative">
//                     <input
//                       type="date"
//                       value={displayDate ? formatDateForInput(displayDate) : ''}
//                       onChange={(e) => setDisplayDate(new Date(e.target.value))}
//                       className="pl-3 pr-10 py-2 border border-gray-300 rounded-md text-sm cursor-pointer"
//                     />
//                   </div>
//                 </div>
//               )}
//             </div>

//             {/* Conditional rendering for Daily Work Report Card or placeholder */}
//             {reportType === 'Daily' ? (
//               dailyReportDetails ? (
//                 <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-300">
//                   {/* Daily Work Report content - Matching the image */}
//                   <div className="flex justify-between items-center mb-4 border-b pb-2">
//                     <h2 className="text-xl font-bold">Daily Work Report</h2>
//                     {/* Display report date from the fetched dailyReportDetails, fallback to displayDate */}
//                     <span className="text-gray-600">
//                       {dailyReportDetails.report_date ? formatDate(dailyReportDetails.report_date) : formatDate(displayDate)}
//                     </span>
//                   </div>

//                   {/* Summary Metrics */}
//                   <div className="mb-6 space-y-2 text-gray-700">
//                     <div className="flex justify-between">
//                       <span>Total number of works done:</span>
//                       <span className="font-semibold">{completedWorksOnReport.toString().padStart(2, '0')}</span>
//                     </div>
//                     <div className="flex justify-between">
//                       <span>Total of Work Headers:</span>
//                       <span className="font-semibold">{totalWorkHeaders.toString().padStart(2, '0')}</span> {/* Assuming each milestone is a 'package' */}
//                     </div>
//                     <div className="flex justify-between">
//                       <span>Manpower Used:</span>
//                       <span className="font-semibold">{totalManpowerInReport.toString().padStart(2, '0')}</span>
//                     </div>
//                   </div>

//                   {/* Manpower Section */}
//                   {dailyReportDetails.manpower && dailyReportDetails.manpower.length > 0 && (
//                     <div className="mb-6">
//                       <h3 className="text-lg font-bold mb-3">Manpower - {totalManpowerInReport.toString().padStart(2, '0')}</h3>
//                       <div className="space-y-2">
//                         {dailyReportDetails.manpower.map((mp_detail, idx) => (
//                           <div key={idx} className="flex justify-between items-center text-gray-700">
//                             <span className="font-medium">{mp_detail.label}</span>
//                             <span className="font-semibold">{mp_detail.count.toString().padStart(2, '0')}</span>
//                           </div>
//                         ))}
//                       </div>
//                     </div>
//                   )}

//                   {/* Work Progress Sections (Ducting, FA PA & ACS etc.) */}
//                   {dailyReportDetails.milestones && dailyReportDetails.milestones.length > 0 && (
//                     <div className="mb-6">
//                       {Object.entries(
//                         dailyReportDetails.milestones.reduce((acc, milestone) => {
//                           (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
//                           return acc;
//                         }, {})
//                       ).map(([header, milestones], groupIdx) => (
//                         <div key={groupIdx} className="mb-4 last:mb-0">
//                           <h3 className="text-lg font-bold mb-2">{header} - {milestones.length.toString().padStart(2, '0')}</h3>
//                           <Table className="border rounded-md overflow-hidden">
//                             <TableHeader>
//                               <TableRow className="bg-gray-100">
//                                 <TableHead className="w-[40%] font-semibold text-gray-700">Work</TableHead>
//                                 <TableHead className="w-[20%] text-center font-semibold text-gray-700">Status</TableHead>
//                                 <TableHead className="w-[20%] text-center font-semibold text-gray-700">Work Completed</TableHead>
//                                 <TableHead className="w-[20%] text-center font-semibold text-gray-700">Expected Comp. Date</TableHead>
//                               </TableRow>
//                             </TableHeader>
//                             <TableBody>
//                               {milestones.map((milestone, idx) => (
//                                 <TableRow key={idx}>
//                                   <TableCell className="py-2">{milestone.work_milestone_name}</TableCell>
//                                   <TableCell className="text-center py-2">
//                                     <Badge variant={milestone.status === "Completed" ? "default" : "secondary"}>
//                                       {milestone.status}
//                                     </Badge>
//                                   </TableCell>
//                                   <TableCell className="text-center py-2">{milestone.progress}%</TableCell>
//                                   <TableCell className="text-center py-2">
//                                     {milestone.expected_completion_date ? formatDate(milestone.expected_completion_date) : 'N/A'}
//                                   </TableCell>
//                                 </TableRow>
//                               ))}
//                             </TableBody>
//                           </Table>
//                         </div>
//                       ))}
//                     </div>
//                   )}

//                   {/* Work Images Section */}
//                   <div className="mt-6">
//                     <h3 className="text-lg font-bold mb-3">Work Images</h3>
//                     {dailyReportDetails.attachments && dailyReportDetails.attachments.length > 0 ? (
//                       <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
//                         {dailyReportDetails.attachments.map((attachment, idx) => (
//                           <div
//                             key={idx}
//                             className="relative rounded-lg overflow-hidden shadow-md group cursor-pointer aspect-square" // Ensures square images
//                           >
//                             <img
//                               src={attachment.image_link}
//                               alt={`Work Image ${idx + 1}`}
//                               className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
//                             />
//                             {/* Hover Overlay for image details */}
//                             <div className="absolute inset-0 bg-black bg-opacity-70 opacity-0 group-hover:opacity-100 transition-opacity duration-300 p-2 flex flex-col justify-end text-white text-xs">
//                               <div className="flex items-center mb-1">
//                                 <MapPin className="h-3 w-3 mr-1 text-red-400 flex-shrink-0" />
//                                 <span className="font-semibold truncate">
//                                   {attachment.location || `Lat: ${attachment.latitude?.toFixed(2)}, Lon: ${attachment.longitude?.toFixed(2)}`}
//                                 </span>
//                               </div>
//                               <p className="line-clamp-2 text-gray-300">
//                                 {attachment.remarks || "No remarks provided."}
//                               </p>
//                             </div>
//                           </div>
//                         ))}
//                       </div>
//                     ) : (
//                       <div className="w-full h-32 bg-gray-100 flex items-center justify-center text-gray-500 rounded-lg border-2 border-dashed border-gray-300">
//                         <p className="text-base font-medium">No Work Images Available</p>
//                       </div>
//                     )}
//                   </div>

//                   {/* Download PDF Button */}
//                   <div className="mt-8 flex justify-center">
//                     <Button className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg text-lg flex items-center gap-2">
//                       {/* SVG for PDF icon */}
//                       <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
//                         <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375H12a1.125 1.125 0 0 1-1.125-1.125V1.5M19.5 14.25a2.25 2.25 0 0 0 .984-1.952V6.75A2.25 2.25 0 0 0 17.25 4.5H15M19.5 14.25h-4.75a1.125 1.125 0 0 1-1.125-1.125V9.75M19.5 14.25v2.25m0-2.25a1.125 1.125 0 0 1-1.125 1.125H4.5A2.25 2.25 0 0 0 2.25 18V6.75A2.25 0 0 0 4.5 4.5h7.5A2.25 0 0 1 14.25 6.75v2.25" />
//                       </svg>
//                       Download PDF
//                     </Button>
//                   </div>
//                 </div>
//               ) : (
//                 // Display when Daily is selected but no report found for the date
//                 <Card className="mt-4 p-4">
//                   <CardContent className="text-center flex flex-col items-center gap-4">
//                     <p className="text-gray-500">No daily report found for {formatDate(displayDate)}.</p>

//                   </CardContent>
//                 </Card>
//               )
//             ) : (
//               // Display when Overall is selected (placeholder)
//               <Card className="mt-4 p-4">
//                 <CardContent>
//                   <p className="text-center text-gray-500">Overall report summary would be displayed here.</p>
//                 </CardContent>
//               </Card>
//             )}
//           </div>
//         )}
//       </div>
//     </>
//   );
// };