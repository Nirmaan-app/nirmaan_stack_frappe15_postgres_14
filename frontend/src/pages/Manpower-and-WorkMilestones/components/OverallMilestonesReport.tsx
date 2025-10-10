import React, { useState, useEffect, useMemo } from 'react';
import { useFrappeGetCall } from 'frappe-react-sdk';
import { formatDate } from '@/utils/FormatDate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronUp, AlertCircle, Info ,MapPin,MessagesSquare} from 'lucide-react';
import { TailSpin } from 'react-loader-spinner';
import { Card, CardContent } from '@/components/ui/card';
import OverallMilestonesReportPDF from './OverallMilestonesReportPDF';
import { MilestoneProgress } from '../MilestonesSummary';
// Define types
interface MilestoneSnapshot {
  work_milestone_name: string;
  status: string;
  progress: number;
  work_header: string;
}

interface ManpowerSnapshot {
  label: string;
  count: number;
}

interface ReportDoc {
  name: string;
  report_date: string;
  milestones: MilestoneSnapshot[];
  manpower: ManpowerSnapshot[];
  total_completed_works: number;
  number_of_work_headers: number;
  total_manpower_used_till_date: number;
}

interface OverallMilestonesReportProps {
  selectedProject: string;
  projectData?: any; // Added projectData prop
}

// Helper function to get badge classes based on status
const getStatusBadgeClasses = (status: string) => {
  switch (status) {
    case "Completed": return "bg-green-100 text-green-800 hover:bg-green-200";
    case "WIP": return "bg-yellow-100 text-yellow-800 hover:bg-yellow-200";
    case "Not Started": return "bg-red-100 text-red-800 hover:bg-red-200";
    case "N/A": return "bg-gray-100 text-gray-800 hover:bg-gray-200";
    default: return "bg-blue-100 text-blue-800 hover:bg-blue-200";
  }
};

const OverallMilestonesReport: React.FC<OverallMilestonesReportProps> = ({ selectedProject, projectData }) => {
  const {
    data: reportsData,
    isLoading: isReportsLoading,
    error: reportsError
  } = useFrappeGetCall(
    "nirmaan_stack.api.get_project_reports.get_project_progress_reports_comparison",
    { project: selectedProject },
    selectedProject ? undefined : null
  );

  const [latestReport, setLatestReport] = useState<ReportDoc | null>(null);
  const [report7DaysAgo, setReport7DaysAgo] = useState<ReportDoc | null>(null);
  const [report14DaysAgo, setReport14DaysAgo] = useState<ReportDoc | null>(null);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);

  // Effect to process the API response
  useEffect(() => {
    if (reportsData?.message) {
      const { current, seven_days, fourteen_days } = reportsData.message;
      
      setLatestReport(current);
      setReport7DaysAgo(seven_days);
      setReport14DaysAgo(fourteen_days);

      if (current?.milestones) {
        const initialExpandedState = current.milestones.reduce((acc, m) => {
          acc[m.work_header] = true;
          return acc;
        }, {} as Record<string, boolean>);
        setExpandedSections(initialExpandedState);
        setAllExpanded(true);
      }
    } else {
      setLatestReport(null);
      setReport7DaysAgo(null);
      setReport14DaysAgo(null);
      setExpandedSections({});
      setAllExpanded(false);
    }
  }, [reportsData]);

  // Memoized grouped milestones from the latest report
  const groupedMilestones = useMemo(() => {
    if (!latestReport?.milestones) return {};
    return latestReport.milestones.reduce((acc, milestone) => {
      (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
      return acc;
    }, {} as Record<string, MilestoneSnapshot[]>);
  }, [latestReport]);

  // Memoized grouped manpower from all reports
  const groupedManpower = useMemo(() => {
    if (!latestReport?.manpower) return {};
    
    const allManpower = new Set<string>();
    latestReport.manpower.forEach(mp => allManpower.add(mp.label));
    report7DaysAgo?.manpower?.forEach(mp => allManpower.add(mp.label));
    report14DaysAgo?.manpower?.forEach(mp => allManpower.add(mp.label));
    
    const groups: Record<string, { current: number, sevenDays: number, fourteenDays: number }> = {};
    Array.from(allManpower).forEach(label => {
      groups[label] = {
        current: latestReport.manpower.find(mp => mp.label === label)?.count || 0,
        sevenDays: report7DaysAgo?.manpower?.find(mp => mp.label === label)?.count || 0,
        fourteenDays: report14DaysAgo?.manpower?.find(mp => mp.label === label)?.count || 0
      };
    });
    
    return groups;
  }, [latestReport, report7DaysAgo, report14DaysAgo]);

  // Helper to get milestone data
  const getMilestoneData = (milestoneName: string, workHeader: string, report: ReportDoc | null) => {
    if (!report || !report.milestones) return { status: "N/A", progress: "N/A" };
    
    const foundMilestone = report.milestones.find(
      m => m.work_milestone_name === milestoneName && m.work_header === workHeader
    );
    
    return foundMilestone 
      ? { status: foundMilestone.status, progress: `${foundMilestone.progress}` }
      : { status: "N/A", progress: "N/A" };
  };

  // Collapsible section logic
  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleAllSections = () => {
    const newState = !allExpanded;
    setAllExpanded(newState);
    if (latestReport?.milestones) {
      const sections = latestReport.milestones.reduce((acc, milestone) => {
        acc[milestone.work_header] = newState;
        return acc;
      }, {} as Record<string, boolean>);
      setExpandedSections(sections);
    }
  };
  
  const areAllSectionsExpanded = useMemo(() => {
    if (!latestReport?.milestones || Object.keys(expandedSections).length === 0) return false;
    return Object.values(expandedSections).every(Boolean);
  }, [expandedSections, latestReport]);

  // Loading and Error States
  if (isReportsLoading) {
    return (
      <Card className="bg-white p-6 rounded-lg shadow-sm border border-gray-300">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <TailSpin color="#3B82F6" height={60} width={60} />
          <p className="mt-4 text-gray-600">Loading project reports comparison...</p>
        </CardContent>
      </Card>
    );
  }

  if (reportsError) {
    return (
      <Card className="bg-white p-6 rounded-lg shadow-sm border border-gray-300">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <h3 className="text-lg font-semibold text-red-700 mb-2">Error Loading Reports</h3>
          <p className="text-gray-600 text-center mb-4">
            {reportsError.message || "Failed to load project reports. Please try again later."}
          </p>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            className="mt-2"
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!latestReport) {
    return (
      <Card className="bg-white p-6 rounded-lg shadow-sm border border-gray-300">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Info className="h-12 w-12 text-blue-500 mb-4" />
          <h3 className="text-lg font-semibold text-gray-800 mb-2">No Reports Available</h3>
          <p className="text-gray-600 text-center max-w-md">
            No project reports found for comparison. Please create at least one project report to see the comparison data.
          </p>
          
        </CardContent>
      </Card>
    );
  }

  // Check if we have enough reports for meaningful comparison
  const hasHistoricalData = report7DaysAgo || report14DaysAgo;
  
  return (
    <div className="bg-white ">
      {/* Overall Report Summary Header */}
      {/* Modified to match the "Overall Work Report" section in the image */}
      <div className="p-4 rounded-t-lg mb-4">
        <h2 className="text-xl font-bold mb-2">Overall Work Report</h2>
        <div className="grid grid-cols-1 gap-2 mt-4 text-sm md:text-base">
          <p>Overall Completed: <span className="font-semibold">{latestReport.total_completed_works || 0}</span></p>
          <p>Number of packages: <span className="font-semibold">{latestReport.number_of_work_headers || 0}</span></p>
          <p>Total Manpower Used (till date): <span className="font-semibold">{latestReport.total_manpower_used_till_date || 0}</span></p>
        </div>
      </div>

      {/* Report Date Headers
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-100">
          <h3 className="font-semibold text-blue-700">Current</h3>
          <p className="text-sm text-blue-600 mt-1">
            {latestReport.report_date ? formatDate(latestReport.report_date) : 'N/A'}
          </p>
        </div>
        <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-100">
          <h3 className="font-semibold text-blue-700">7 Days Ago</h3>
          <p className="text-sm text-blue-600 mt-1">
            {report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date) : 'No Data'}
          </p>
        </div>
        <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-100">
          <h3 className="font-semibold text-blue-700">14 Days Ago</h3>
          <p className="text-sm text-blue-600 mt-1">
            {report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date) : 'No Data'}
          </p>
        </div>
        <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-100">
          <h3 className="font-semibold text-blue-700">Comparison</h3>
          <p className="text-sm text-blue-600 mt-1">Report Data</p>
        </div>
      </div> */}

      {!hasHistoricalData && (
        <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <Info className="h-5 w-5 text-yellow-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                Limited historical data available. Showing current report data only. 
                Create more reports over time to enable comparison features.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Manpower Comparison Section */}
      {/* <div className="mb-6">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-bold">Manpower Comparison</h3>
        </div>
        <div className="overflow-x-auto">
          <Table className="w-full min-w-[600px]">
            <TableHeader className="bg-gray-100">
              <TableRow>
                <TableHead className="w-[25%] font-semibold text-gray-700 text-sm py-2">Manpower Type</TableHead>
                <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2">Current</TableHead>
                <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2">7 Days Ago</TableHead>
                <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2">14 Days Ago</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(groupedManpower).map(([label, counts], idx) => {
                return (
                  <TableRow key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <TableCell className="py-3 px-4 text-sm font-medium">{label}</TableCell>
                    <TableCell className="text-center py-3 px-2 text-sm font-semibold">{counts.current}</TableCell>
                    <TableCell className="text-center py-3 px-2 text-sm">
                      {report7DaysAgo ? counts.sevenDays : <span className="text-gray-400 text-xs">N/A</span>}
                    </TableCell>
                    <TableCell className="text-center py-3 px-2 text-sm">
                      {report14DaysAgo ? counts.fourteenDays : <span className="text-gray-400 text-xs">N/A</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div> */}

      {/* Expand/Collapse All Button */}
      {latestReport.milestones && latestReport.milestones.length > 0 && (
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-bold">Work Progress Comparison</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleAllSections}
            className="flex items-center gap-1 text-xs md:text-sm"
          >
            {areAllSectionsExpanded ? (
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
      )}

      {/* Render each work header as a collapsible section */}
      {Object.entries(groupedMilestones).map(([header, milestones], groupIdx) => (
        <div key={groupIdx} className="mb-4 last:mb-0 border rounded-md overflow-hidden shadow-sm">
          {/* Collapsible Header */}
          <div
            className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
            onClick={() => toggleSection(header)}
          >
            <h3 className="text-base md:text-lg font-bold">{header} - {(milestones as MilestoneSnapshot[]).length.toString().padStart(2, '0')}</h3>
            <div className="flex items-center">
              <span className="text-xs md:text-sm text-gray-500 mr-2">
                {(milestones as MilestoneSnapshot[]).length} milestone{(milestones as MilestoneSnapshot[]).length !== 1 ? 's' : ''}
              </span>
              {expandedSections[header] ? (
                <ChevronUp className="h-5 w-5 text-gray-600" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-600" />
              )}
            </div>
          </div>

          {/* Collapsible Content - Comparison Table */}
          {expandedSections[header] && (
            <div className="p-0 overflow-x-auto">
              <Table className="w-full min-w-[700px]">
                <TableHeader className="bg-gray-100">
                 <TableRow>
                    <TableHead className="w-[30%] font-semibold text-gray-700 text-sm py-2">Work</TableHead>
                    <TableHead className="w-[14%] text-center font-semibold text-gray-700 text-sm py-2">Status<br/>(Current)</TableHead>
                    <TableHead className="w-[14%] text-center font-semibold text-gray-700 text-sm py-2">% Done<br/>(Current)</TableHead>
                    {/* Modified the date formatting for -7 Days report */}
                    <TableHead className="w-[14%] text-center font-semibold text-gray-700 text-sm py-2">
                      Status<br/>
                      {report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'}
                    </TableHead>
                    <TableHead className="w-[14%] text-center font-semibold text-gray-700 text-sm py-2">
                      % Done<br/>
                      {report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'}
                    </TableHead>
                    {/* Modified the date formatting for -14 Days report */}
                    <TableHead className="w-[14%] text-center font-semibold text-gray-700 text-sm py-2">
                      Status<br/>
                      {report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'}
                    </TableHead>
                    <TableHead className="w-[14%] text-center font-semibold text-gray-700 text-sm py-2">
                      % Done<br/>
                      {report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(milestones as MilestoneSnapshot[]).map((milestone, idx) => {
                    const currentData = getMilestoneData(milestone.work_milestone_name, milestone.work_header, latestReport);
                    const sevenDaysAgoData = getMilestoneData(milestone.work_milestone_name, milestone.work_header, report7DaysAgo);
                    const fourteenDaysAgoData = getMilestoneData(milestone.work_milestone_name, milestone.work_header, report14DaysAgo);

                    return (
                      <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                        <TableCell className="py-3 px-4 text-sm break-words">{idx + 1}. {milestone.work_milestone_name}</TableCell>
                        
                        <TableCell className="text-center py-3 px-2">
                          <Badge variant="secondary" className={`${getStatusBadgeClasses(currentData.status)} text-xs`}>
                            {currentData.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center py-3 px-2 text-sm font-medium">
                            <MilestoneProgress
                                                                      // 1. Pass the status for the N/A check
                                                                      milestoneStatus={currentData.status}
                          
                                                                      // 2. Pass the progress value for the circle and color logic
                                                                      value={currentData.progress}
                          
                                                                      // 3. Set the desired size and text size
                                                                      sizeClassName="size-[60px]"
                                                                      textSizeClassName="text-md"
                                                                    />
                         </TableCell>
                        
                        <TableCell className="text-center py-3 px-2">
                          {report7DaysAgo ? (
                            <Badge variant="secondary" className={`${getStatusBadgeClasses(sevenDaysAgoData.status)} text-xs`}>
                              {sevenDaysAgoData.status}
                            </Badge>
                          ) : (
                            <span className="text-gray-400 text-xs">N/A</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center py-3 px-2 text-sm">
                          {report7DaysAgo ? sevenDaysAgoData.progress : <span className="text-gray-400 text-xs">N/A</span>}
                        </TableCell>

                        <TableCell className="text-center py-3 px-2">
                          {report14DaysAgo ? (
                            <Badge variant="secondary" className={`${getStatusBadgeClasses(fourteenDaysAgoData.status)} text-xs`}>
                              {fourteenDaysAgoData.status}
                            </Badge>
                          ) : (
                            <span className="text-gray-400 text-xs">N/A</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center py-3 px-2 text-sm">
                          {report14DaysAgo ? fourteenDaysAgoData.progress : <span className="text-gray-400 text-xs">N/A</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ))}
       
 <div className="mt-6">
                    <h3 className="text-base md:text-lg font-bold mb-3">Work Images</h3>
                    {latestReport.attachments && latestReport.attachments.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-3 md:gap-4">
                        {latestReport.attachments.map((attachment, idx) => (
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
      {/* PDF Download Button */}
      <div className="mt-6 flex justify-end">
        <OverallMilestonesReportPDF
          latestReport={latestReport}
          report7DaysAgo={report7DaysAgo}
          report14DaysAgo={report14DaysAgo}
          projectData={projectData}
        />
      </div>

      {!latestReport.milestones || latestReport.milestones.length === 0 ? (
        <Card className="bg-white p-6 rounded-lg shadow-sm border border-gray-300 mt-4">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Info className="h-10 w-10 text-blue-500 mb-3" />
            <h3 className="text-lg font-semibold text-gray-800 mb-2">No Milestone Data</h3>
            <p className="text-gray-600 text-center max-w-md">
              The current report doesn't contain any milestone data. Please update the report with milestone information to see the comparison.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export default OverallMilestonesReport;