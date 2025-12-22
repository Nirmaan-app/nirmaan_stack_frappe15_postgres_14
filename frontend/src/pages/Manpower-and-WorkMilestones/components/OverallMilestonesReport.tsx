import React, { useState, useEffect, useMemo } from 'react';
import { useFrappeGetCall, useFrappeGetDocList } from 'frappe-react-sdk';
import { formatDate } from '@/utils/FormatDate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronUp, AlertCircle, Info ,MapPin,MessagesSquare} from 'lucide-react';
import { TailSpin } from 'react-loader-spinner';
import { Card, CardContent } from '@/components/ui/card';
import OverallMilestonesReportPDF from './OverallMilestonesReportPDF';
import { MilestoneProgress } from '../MilestonesSummary';
import { ImageBentoGrid } from '@/components/ui/ImageBentoGrid';

// import { useWorkHeaderOrder } from '@/hooks/useWorkHeaderOrder'; // Removed as backend sorts now


// Define types
interface MilestoneSnapshot {
  work_milestone_name: string;
  status: string;
  progress: number;
  work_header: string;
  remarks?: string;
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
  attachments?: any[];
}

interface OverallMilestonesReportProps {
  selectedProject: string;
  projectData?: any; 
  selectedZone: string;
}

// Helper function to get badge classes based on status
const getStatusBadgeClasses = (status: string) => {
  switch (status) {
    case "Completed": return "bg-green-100 text-green-800 hover:bg-green-200";
    case "WIP": return "bg-yellow-100 text-yellow-800 hover:bg-yellow-200";
    case "Not Started": return "bg-red-100 text-red-800 hover:bg-red-200";
    case "N/A": 
    case "Not Applicable": return "bg-gray-100 text-gray-800 hover:bg-gray-200";
    default: return "bg-blue-100 text-blue-800 hover:bg-blue-200";
  }
};

const OverallMilestonesReport: React.FC<OverallMilestonesReportProps> = ({ selectedProject, projectData, selectedZone }) => {
  const {
    data: reportsData,
    isLoading: isReportsLoading,
    error: reportsError
  } = useFrappeGetCall(
    "nirmaan_stack.api.get_project_reports.get_project_progress_reports_comparison",
    { project: selectedProject, report_zone: selectedZone },
    selectedProject ? undefined : null
  );

  // Fetch Work Milestones to get the order and weightage for milestones
  const { data: workMilestonesList } = useFrappeGetDocList("Work Milestones", {
      fields: ["work_milestone_name", "work_milestone_order", "work_header", "weightage"],
      limit: 0
  });

  // const { workHeaderOrderMap } = useWorkHeaderOrder(); // Removed

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
        // Initialize expanded state based on the raw data
        const initialExpandedState = current.milestones.reduce((acc: Record<string, boolean>, m: MilestoneSnapshot) => {
          if (m.status !== "Not Applicable" && m.status !== "N/A") {
             acc[m.work_header] = true;
          }
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

  // ---------------------------------------------------------------------------
  // Memoized grouped milestones
  // ---------------------------------------------------------------------------
  const groupedMilestones = useMemo(() => {
    if (!latestReport?.milestones) return {};

    const relevantMilestones = latestReport.milestones.filter(milestone => 
      milestone.status !== "Not Applicable" && milestone.status !== "N/A"
    );

    const grouped = relevantMilestones.reduce((acc, milestone) => {
      (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
      return acc;
    }, {} as Record<string, MilestoneSnapshot[]>);
    
    // Sort milestones
    Object.keys(grouped).forEach(header => {
        grouped[header].sort((a, b) => {
             const orderA = workMilestonesList?.find(m => m.work_milestone_name === a.work_milestone_name && m.work_header === header)?.work_milestone_order ?? 9999;
             const orderB = workMilestonesList?.find(m => m.work_milestone_name === b.work_milestone_name && m.work_header === header)?.work_milestone_order ?? 9999;
             return orderA - orderB;
        });
    });

    return grouped;
  }, [latestReport, workMilestonesList]);



  // Removed sortedGroupedMilestones as backend provides sorted data and Object.keys/entries preserves insertion order for non-integer keys (mostly)



  // ---------------------------------------------------------------------------
  // Memoized grouped manpower (Logic: Exclude if all 0)
  // ---------------------------------------------------------------------------
  const groupedManpower = useMemo(() => {
    if (!latestReport?.manpower) return {};
    
    const allManpower = new Set<string>();
    latestReport.manpower.forEach(mp => allManpower.add(mp.label));
    report7DaysAgo?.manpower?.forEach(mp => allManpower.add(mp.label));
    report14DaysAgo?.manpower?.forEach(mp => allManpower.add(mp.label));
    
    const groups: Record<string, { current: number, sevenDays: number, fourteenDays: number }> = {};
    
    Array.from(allManpower).forEach(label => {
      const currentCount = latestReport.manpower.find(mp => mp.label === label)?.count || 0;
      const sevenDaysCount = report7DaysAgo?.manpower?.find(mp => mp.label === label)?.count || 0;
      const fourteenDaysCount = report14DaysAgo?.manpower?.find(mp => mp.label === label)?.count || 0;

      if (currentCount > 0 || sevenDaysCount > 0 || fourteenDaysCount > 0) {
        groups[label] = {
          current: currentCount,
          sevenDays: sevenDaysCount,
          fourteenDays: fourteenDaysCount
        };
      }
    });
    
    return groups;
  }, [latestReport, report7DaysAgo, report14DaysAgo]);

  // ---------------------------------------------------------------------------
  // Helper: Calculate Weighted Header Average
  // ---------------------------------------------------------------------------
  const calculateHeaderAverage = (targetReport: ReportDoc | null, header: string, activeMilestones: MilestoneSnapshot[]) => {
    if (!targetReport || !activeMilestones.length) return 0;

    // Step 1: Calculate effective weightage for each milestone
    const milestonesWithWeightage = activeMilestones.map(m => {
      const milestoneData = workMilestonesList?.find(
        wm => wm.work_milestone_name === m.work_milestone_name && wm.work_header === header
      );
      const weightage = milestoneData?.weightage || 1.0;
      const effectiveWeightage = m.status !== "Not Applicable" ? weightage : 0;

      // Find progress from target report
      const historicalMilestone = targetReport.milestones.find(
        hm => hm.work_milestone_name === m.work_milestone_name && hm.work_header === header
      );
      const progress = Number(historicalMilestone?.progress) || 0;

      return {
        ...m,
        weightage,
        effectiveWeightage,
        progress
      };
    });

    // Step 2: Calculate sum of all effective weightages
    const sumEffectiveWeightages = milestonesWithWeightage.reduce(
      (sum, m) => sum + m.effectiveWeightage,
      0
    );

    // If no effective weightage, return 0
    if (sumEffectiveWeightages === 0) return 0;

    // Step 3: Calculate effective progress for each milestone and sum them
    const overallProgress = milestonesWithWeightage.reduce((sum, m) => {
      const effectiveProgress = (m.effectiveWeightage * 100 / sumEffectiveWeightages) * (m.progress / 100);
      return sum + effectiveProgress;
    }, 0);

    return Math.round(overallProgress);
  };


  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleAllSections = () => {
    const newState = !allExpanded;
    setAllExpanded(newState);
    const sections = Object.keys(groupedMilestones).reduce((acc, header) => {
      acc[header] = newState;
      return acc;
    }, {} as Record<string, boolean>);
    setExpandedSections(sections);
  };
  
  const areAllSectionsExpanded = useMemo(() => {
    const visibleHeaders = Object.keys(groupedMilestones);
    if (visibleHeaders.length === 0) return false;
    return visibleHeaders.every(header => expandedSections[header]);
  }, [expandedSections, groupedMilestones]);

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

  const hasHistoricalData = report7DaysAgo || report14DaysAgo;
  
  return (
    <div className="bg-white ">
      {/* Overall Report Summary Header */}
      <div className="p-4 rounded-t-lg mb-4">
        <h2 className="text-xl font-bold mb-2">Overall Work Report</h2>
        <div className="grid grid-cols-1 gap-2 mt-4 text-sm md:text-base">
          <p>Overall Completed: <span className="font-semibold">{latestReport.total_completed_works || 0}</span></p>
          <p>Number of packages: <span className="font-semibold">{latestReport.number_of_work_headers || 0}</span></p>
          <p>Total Manpower Used (till date): <span className="font-semibold">{latestReport.total_manpower_used_till_date || 0}</span></p>
        </div>
      </div>

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
      {Object.keys(groupedManpower).length > 0 && (
        <div className="mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-bold">Manpower Comparison</h3>
          </div>
          <div className="overflow-x-auto">
            <Table className="w-full min-w-[600px] border border-gray-300">
              <TableHeader className="bg-gray-100">
                <TableRow>
                  <TableHead className="w-[25%] font-semibold text-gray-700 text-sm py-2 border-r">Manpower Type</TableHead>
                  <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r"> 
                    <h3 className="font-semibold text-gray-700">Current</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {latestReport?.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric' }) : '--'}
                    </p>
                  </TableHead>
                  <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r"> 
                    <h3 className="font-semibold text-gray-700">7 Days Ago</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'}
                    </p>
                  </TableHead>
                  <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r">
                    <h3 className="font-semibold text-gray-700">14 Days Ago</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'}
                    </p>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(groupedManpower).map(([label, counts], idx) => {
                  return (
                    <TableRow key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <TableCell className="py-3 px-4 text-sm font-medium border-r">{label}</TableCell>
                      <TableCell className="text-center py-3 px-2 text-sm font-semibold border-r">{counts.current}</TableCell>
                      <TableCell className="text-center py-3 px-2 text-sm border-r">
                        {report7DaysAgo ? counts.sevenDays : <span className="text-gray-400 text-xs">--</span>}
                      </TableCell>
                      <TableCell className="text-center py-3 px-2 text-sm border-r">
                        {report14DaysAgo ? counts.fourteenDays : <span className="text-gray-400 text-xs">--</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Expand/Collapse All Button */}
      {Object.keys(groupedMilestones).length > 0 && (
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
      {Object.entries(groupedMilestones).map(([header, milestones], groupIdx) => {
        // --- Calculate Average Percentages for the Header ---
        const activeMilestones = milestones as MilestoneSnapshot[];
        const currentAvg = calculateHeaderAverage(latestReport, header, activeMilestones);
        const sevenDaysAvg = calculateHeaderAverage(report7DaysAgo, header, activeMilestones);
        const fourteenDaysAvg = calculateHeaderAverage(report14DaysAgo, header, activeMilestones);

        return (
          <div key={groupIdx} className="mb-4 last:mb-0 border rounded-md overflow-hidden shadow-sm">
            {/* Collapsible Header - Simplified to just Name and Count (Percentages removed from here) */}
            <div
              className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
              onClick={() => toggleSection(header)}
            >
              <h3 className="text-base md:text-lg font-bold">{header} - {activeMilestones.length.toString().padStart(2, '0')}</h3>

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
              {/* <div className="flex items-center">
                {expandedSections[header] ? (
                  <ChevronUp className="h-5 w-5 text-gray-600" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-gray-600" />
                )}
              </div> */}
            </div>

            {/* Collapsible Content - Comparison Table */}
            {expandedSections[header] && (
              <div className="p-0 overflow-x-auto">
                <Table className="w-full min-w-[1200px]"> 
                  <TableHeader className="bg-gray-100">
                  
                  {/* 1. TOP HEADER ROW */}
                  <TableRow>
                      <TableHead 
                          className="w-[15%] font-semibold text-gray-700 text-sm py-2 text-left align-bottom"
                          rowSpan={2} 
                      >
                          Work
                      </TableHead> 
                      <TableHead className="w-[28%] text-center font-semibold text-gray-700 text-sm py-2 border-r" colSpan={3}>
                          Current ({latestReport.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric'}) : '--'})
                      </TableHead>
                      <TableHead className="w-[28%] text-center font-semibold text-gray-700 text-sm py-2 border-r" colSpan={3}>
                          7 Days Ago ({report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'})
                      </TableHead>
                      <TableHead className="w-[28%] text-center font-semibold text-gray-700 text-sm py-2 border-r" colSpan={3}>
                          14 Days Ago ({report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'})
                      </TableHead>
                    </TableRow>
                    
                    {/* 2. BOTTOM HEADER ROW */}
                    <TableRow className="bg-gray-200">
                      <TableHead className="w-[8%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
                      <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2">Done %</TableHead>
                      <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2 border-r">Remarks</TableHead>
                      
                      <TableHead className="w-[8%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
                      <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2">Done %</TableHead>
                      <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2 border-r">Remarks</TableHead>
                      
                      <TableHead className="w-[8%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
                      <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2">Done %</TableHead>
                      <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2 border-r">Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  
                  {/* TABLE BODY */}
                  <TableBody>
                    
                    {/* --- NEW SUMMARY ROW (Matching PDF Layout) --- */}
                    <TableRow className="bg-gray-50 border-b-2 border-gray-100 bg-gray-300 align-middle">
                       <TableCell className="py-2 px-4 text-sm font-bold text-gray-800">
                          Overall Progress
                       </TableCell>
                       
                       {/* Current Overall */}
                       <TableCell colSpan={3} className="py-2 px-2 text-center border-r">
                           <div className="flex items-center justify-center gap-2">
                             <span className="text-xs font-bold text-gray-700">Overall:</span>
                             <MilestoneProgress
                                milestoneStatus="Completed" // Always show color for avg
                                value={currentAvg}
                                sizeClassName="size-[36px]"
                                textSizeClassName="text-xs"
                             />
                           </div>
                       </TableCell>

                       {/* 7 Days Overall */}
                       <TableCell colSpan={3} className="py-2 px-2 text-center border-r">
                           {report7DaysAgo ? (
                             <div className="flex items-center justify-center gap-2">
                               <span className="text-xs font-bold text-gray-700">Overall:</span>
                               <MilestoneProgress
                                  milestoneStatus="Completed"
                                  value={sevenDaysAvg}
                                  sizeClassName="size-[36px]"
                                  textSizeClassName="text-xs"
                               />
                             </div>
                           ) : <span className="text-gray-400 text-xs">--</span>}
                       </TableCell>

                       {/* 14 Days Overall */}
                       <TableCell colSpan={3} className="py-2 px-2 text-center border-r">
                           {report14DaysAgo ? (
                             <div className="flex items-center justify-center gap-2">
                               <span className="text-xs font-bold text-gray-700">Overall:</span>
                               <MilestoneProgress
                                  milestoneStatus="Completed"
                                  value={fourteenDaysAvg}
                                  sizeClassName="size-[36px]"
                                  textSizeClassName="text-xs"
                               />
                             </div>
                           ) : <span className="text-gray-400 text-xs">--</span>}
                       </TableCell>
                    </TableRow>

                    {/* --- INDIVIDUAL MILESTONES --- */}
                    {(milestones as MilestoneSnapshot[]).map((milestone, idx) => {
                      
                      // Helper to get full data (including remarks)
                      const getFullMilestoneData = (report: ReportDoc | null) => {
                          const defaultData = { status: "N/A", progress: "N/A", remarks: "" };
                          if (!report || !report.milestones) return defaultData;
                          const foundMilestone = report.milestones.find(
                              m => m.work_milestone_name === milestone.work_milestone_name && m.work_header === milestone.work_header
                          );
                          return foundMilestone 
                              ? { status: foundMilestone.status, progress: foundMilestone.progress, remarks: foundMilestone.remarks }
                              : defaultData;
                      };
                      
                      const currentData = getFullMilestoneData(latestReport);
                      const sevenDaysAgoData = getFullMilestoneData(report7DaysAgo);
                      const fourteenDaysAgoData = getFullMilestoneData(report14DaysAgo);

                      const renderRemarksCell = (remarks: string | undefined) => (
                          <TableCell className="text-center py-3 px-2 text-sm overflow-hidden border-r">
                              {remarks ? <p className="text-[10px] text-gray-700 " title={remarks}>{remarks}</p> : <span className="text-gray-400 text-xs">--</span>}
                          </TableCell>
                      );
                      
                      const renderProgressCell = (data: any) => (
                          <TableCell className="text-center py-3 px-2 text-sm font-medium ">
                              <MilestoneProgress
                                  milestoneStatus={data.status}
                                  value={data.progress}
                                  sizeClassName="size-[60px]"
                                  textSizeClassName="text-md"
                              />
                          </TableCell>
                      );

                      return (
                        <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} align-middle`}>
                          <TableCell className="py-3 px-4 text-sm break-words">{idx + 1}. {milestone.work_milestone_name}</TableCell>
                          
                          {/* CURRENT */}
                          <TableCell className="text-center py-3 px-2">
                            <Badge variant="secondary" className={`${getStatusBadgeClasses(currentData.status)} text-xs`}>
                              {currentData.status}
                            </Badge>
                          </TableCell>
                          {renderProgressCell(currentData)}
                          {renderRemarksCell(currentData.remarks)}
                          
                          {/* 7 DAYS */}
                          <TableCell className="text-center py-3 px-2">
                            {report7DaysAgo ? (
                              <Badge variant="secondary" className={`${getStatusBadgeClasses(sevenDaysAgoData.status)} text-xs`}>{sevenDaysAgoData.status}</Badge>
                            ) : <span className="text-gray-400 text-xs">N/A</span>}
                          </TableCell>
                          {report7DaysAgo ? renderProgressCell(sevenDaysAgoData) : <TableCell className="text-center text-gray-400 text-xs">N/A</TableCell>}
                          {report7DaysAgo ? renderRemarksCell(sevenDaysAgoData.remarks) : <TableCell className="text-center text-gray-400 text-xs border-r">N/A</TableCell>}

                          {/* 14 DAYS */}
                          <TableCell className="text-center py-3 px-2">
                            {report14DaysAgo ? (
                              <Badge variant="secondary" className={`${getStatusBadgeClasses(fourteenDaysAgoData.status)} text-xs`}>{fourteenDaysAgoData.status}</Badge>
                            ) : <span className="text-gray-400 text-xs">N/A</span>}
                          </TableCell>
                          {report14DaysAgo ? renderProgressCell(fourteenDaysAgoData) : <TableCell className="text-center text-gray-400 text-xs">N/A</TableCell>}
                          {report14DaysAgo ? renderRemarksCell(fourteenDaysAgoData.remarks) : <TableCell className="text-center text-gray-400 text-xs border-r">N/A</TableCell>}

                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        );
      })}
       
      <div className="mt-6">
        <h3 className="text-base md:text-lg font-bold mb-3">Most recent Work Images</h3>
        <ImageBentoGrid
            images={latestReport.attachments || []}
            forPdf={false}
        />
      </div>
      
      {/* PDF Download Button */}
      <div className="mt-6 flex justify-end">
        <OverallMilestonesReportPDF
          latestReport={latestReport}
          report7DaysAgo={report7DaysAgo}
          report14DaysAgo={report14DaysAgo}
          projectData={projectData}
          selectedZone={selectedZone}
        />
      </div>



      {Object.keys(groupedMilestones).length === 0 ? (
        <Card className="bg-white p-6 rounded-lg shadow-sm border border-gray-300 mt-4">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Info className="h-10 w-10 text-blue-500 mb-3" />
            <h3 className="text-lg font-semibold text-gray-800 mb-2">No Applicable Data</h3>
            <p className="text-gray-600 text-center max-w-md">
              The current report contains data, but all statuses are marked as "Not Applicable".
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );

};

export default OverallMilestonesReport;
// import React, { useState, useEffect, useMemo } from 'react';
// import { useFrappeGetCall } from 'frappe-react-sdk';
// import { formatDate } from '@/utils/FormatDate';
// import { Badge } from '@/components/ui/badge';
// import { Button } from '@/components/ui/button';
// import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
// import { ChevronDown, ChevronUp, AlertCircle, Info ,MapPin,MessagesSquare} from 'lucide-react';
// import { TailSpin } from 'react-loader-spinner';
// import { Card, CardContent } from '@/components/ui/card';
// import OverallMilestonesReportPDF from './OverallMilestonesReportPDF';
// import { MilestoneProgress } from '../MilestonesSummary';
// import { ImageBentoGrid } from '@/components/ui/ImageBentoGrid';

// // Define types
// interface MilestoneSnapshot {
//   work_milestone_name: string;
//   status: string;
//   progress: number;
//   work_header: string;
//   remarks?: string;
// }

// interface ManpowerSnapshot {
//   label: string;
//   count: number;
// }

// interface ReportDoc {
//   name: string;
//   report_date: string;
//   milestones: MilestoneSnapshot[];
//   manpower: ManpowerSnapshot[];
//   total_completed_works: number;
//   number_of_work_headers: number;
//   total_manpower_used_till_date: number;
//   attachments?: any[];
// }

// interface OverallMilestonesReportProps {
//   selectedProject: string;
//   projectData?: any; 
//   selectedZone: string;
// }

// // Helper function to get badge classes based on status
// const getStatusBadgeClasses = (status: string) => {
//   switch (status) {
//     case "Completed": return "bg-green-100 text-green-800 hover:bg-green-200";
//     case "WIP": return "bg-yellow-100 text-yellow-800 hover:bg-yellow-200";
//     case "Not Started": return "bg-red-100 text-red-800 hover:bg-red-200";
//     case "N/A": 
//     case "Not Applicable": return "bg-gray-100 text-gray-800 hover:bg-gray-200";
//     default: return "bg-blue-100 text-blue-800 hover:bg-blue-200";
//   }
// };

// const OverallMilestonesReport: React.FC<OverallMilestonesReportProps> = ({ selectedProject, projectData, selectedZone }) => {
//   const {
//     data: reportsData,
//     isLoading: isReportsLoading,
//     error: reportsError
//   } = useFrappeGetCall(
//     "nirmaan_stack.api.get_project_reports.get_project_progress_reports_comparison",
//     { project: selectedProject, report_zone: selectedZone },
//     selectedProject ? undefined : null
//   );

//   const [latestReport, setLatestReport] = useState<ReportDoc | null>(null);
//   const [report7DaysAgo, setReport7DaysAgo] = useState<ReportDoc | null>(null);
//   const [report14DaysAgo, setReport14DaysAgo] = useState<ReportDoc | null>(null);

//   const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
//   const [allExpanded, setAllExpanded] = useState(false);

//   // Effect to process the API response
//   useEffect(() => {
//     if (reportsData?.message) {
//       const { current, seven_days, fourteen_days } = reportsData.message;
      
//       setLatestReport(current);
//       setReport7DaysAgo(seven_days);
//       setReport14DaysAgo(fourteen_days);

//       if (current?.milestones) {
//         // Initialize expanded state based on the raw data
//         const initialExpandedState = current.milestones.reduce((acc: Record<string, boolean>, m: MilestoneSnapshot) => {
//           // Only expand if status is not Not Applicable (optional optimization)
//           if (m.status !== "Not Applicable" && m.status !== "N/A") {
//              acc[m.work_header] = true;
//           }
//           return acc;
//         }, {} as Record<string, boolean>);
//         setExpandedSections(initialExpandedState);
//         setAllExpanded(true);
//       }
//     } else {
//       setLatestReport(null);
//       setReport7DaysAgo(null);
//       setReport14DaysAgo(null);
//       setExpandedSections({});
//       setAllExpanded(false);
//     }
//   }, [reportsData]);

//   // ---------------------------------------------------------------------------
//   // UPDATED SECTION: Memoized grouped milestones
//   // ---------------------------------------------------------------------------
//   const groupedMilestones = useMemo(() => {
//     if (!latestReport?.milestones) return {};

//     // 1. Filter the milestones first
//     // We exclude milestones where the CURRENT status is "Not Applicable" or "N/A".
//     const relevantMilestones = latestReport.milestones.filter(milestone => 
//       milestone.status !== "Not Applicable" && milestone.status !== "N/A"
//     );

//     // 2. Group the filtered milestones
//     return relevantMilestones.reduce((acc, milestone) => {
//       (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
//       return acc;
//     }, {} as Record<string, MilestoneSnapshot[]>);
//   }, [latestReport]);
//   // ---------------------------------------------------------------------------

//   // Memoized grouped manpower from all reports
//   const groupedManpower = useMemo(() => {
//     if (!latestReport?.manpower) return {};
    
//     const allManpower = new Set<string>();
//     latestReport.manpower.forEach(mp => allManpower.add(mp.label));
//     report7DaysAgo?.manpower?.forEach(mp => allManpower.add(mp.label));
//     report14DaysAgo?.manpower?.forEach(mp => allManpower.add(mp.label));
    
//     const groups: Record<string, { current: number, sevenDays: number, fourteenDays: number }> = {};
//     Array.from(allManpower).forEach(label => {
//       groups[label] = {
//         current: latestReport.manpower.find(mp => mp.label === label)?.count || 0,
//         sevenDays: report7DaysAgo?.manpower?.find(mp => mp.label === label)?.count || 0,
//         fourteenDays: report14DaysAgo?.manpower?.find(mp => mp.label === label)?.count || 0
//       };
//     });
    
//     return groups;
//   }, [latestReport, report7DaysAgo, report14DaysAgo]);

//   // Collapsible section logic
//   const toggleSection = (section: string) => {
//     setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
//   };

//   const toggleAllSections = () => {
//     const newState = !allExpanded;
//     setAllExpanded(newState);
//     // Use groupedMilestones keys ensures we only toggle visible sections
//     const sections = Object.keys(groupedMilestones).reduce((acc, header) => {
//       acc[header] = newState;
//       return acc;
//     }, {} as Record<string, boolean>);
//     setExpandedSections(sections);
//   };
  
//   const areAllSectionsExpanded = useMemo(() => {
//     const visibleHeaders = Object.keys(groupedMilestones);
//     if (visibleHeaders.length === 0) return false;
//     // Check if all visible headers are true in expandedSections
//     return visibleHeaders.every(header => expandedSections[header]);
//   }, [expandedSections, groupedMilestones]);

//   // Loading and Error States
//   if (isReportsLoading) {
//     return (
//       <Card className="bg-white p-6 rounded-lg shadow-sm border border-gray-300">
//         <CardContent className="flex flex-col items-center justify-center py-12">
//           <TailSpin color="#3B82F6" height={60} width={60} />
//           <p className="mt-4 text-gray-600">Loading project reports comparison...</p>
//         </CardContent>
//       </Card>
//     );
//   }

//   if (reportsError) {
//     return (
//       <Card className="bg-white p-6 rounded-lg shadow-sm border border-gray-300">
//         <CardContent className="flex flex-col items-center justify-center py-12">
//           <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
//           <h3 className="text-lg font-semibold text-red-700 mb-2">Error Loading Reports</h3>
//           <p className="text-gray-600 text-center mb-4">
//             {reportsError.message || "Failed to load project reports. Please try again later."}
//           </p>
//           <Button
//             variant="outline"
//             onClick={() => window.location.reload()}
//             className="mt-2"
//           >
//             Retry
//           </Button>
//         </CardContent>
//       </Card>
//     );
//   }

//   if (!latestReport) {
//     return (
//       <Card className="bg-white p-6 rounded-lg shadow-sm border border-gray-300">
//         <CardContent className="flex flex-col items-center justify-center py-12">
//           <Info className="h-12 w-12 text-blue-500 mb-4" />
//           <h3 className="text-lg font-semibold text-gray-800 mb-2">No Reports Available</h3>
//           <p className="text-gray-600 text-center max-w-md">
//             No project reports found for comparison. Please create at least one project report to see the comparison data.
//           </p>
//         </CardContent>
//       </Card>
//     );
//   }

//   const hasHistoricalData = report7DaysAgo || report14DaysAgo;
  
//   return (
//     <div className="bg-white ">
//       {/* Overall Report Summary Header */}
//       <div className="p-4 rounded-t-lg mb-4">
//         <h2 className="text-xl font-bold mb-2">Overall Work Report</h2>
//         <div className="grid grid-cols-1 gap-2 mt-4 text-sm md:text-base">
//           <p>Overall Completed: <span className="font-semibold">{latestReport.total_completed_works || 0}</span></p>
//           <p>Number of packages: <span className="font-semibold">{latestReport.number_of_work_headers || 0}</span></p>
//           <p>Total Manpower Used (till date): <span className="font-semibold">{latestReport.total_manpower_used_till_date || 0}</span></p>
//         </div>
//       </div>

//       {!hasHistoricalData && (
//         <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
//           <div className="flex items-start">
//             <div className="flex-shrink-0">
//               <Info className="h-5 w-5 text-yellow-400" />
//             </div>
//             <div className="ml-3">
//               <p className="text-sm text-yellow-700">
//                 Limited historical data available. Showing current report data only. 
//                 Create more reports over time to enable comparison features.
//               </p>
//             </div>
//           </div>
//         </div>
//       )}

//       {/* Manpower Comparison Section */}
//       <div className="mb-6">
//         <div className="flex justify-between items-center mb-3">
//           <h3 className="text-lg font-bold">Manpower Comparison</h3>
//         </div>
//         <div className="overflow-x-auto">
//           <Table className="w-full min-w-[600px] border border-gray-300">
//             <TableHeader className="bg-gray-100">
//               <TableRow>
//                 <TableHead className="w-[25%] font-semibold text-gray-700 text-sm py-2 border-r">Manpower Type</TableHead>
//                 <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r"> 
//                   <h3 className="font-semibold text-gray-700">Current</h3>
//                   <p className="text-sm text-gray-600 mt-1">
//                     {latestReport?.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric' }) : '--'}
//                   </p>
//                 </TableHead>
//                 <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r"> 
//                   <h3 className="font-semibold text-gray-700">7 Days Ago</h3>
//                   <p className="text-sm text-gray-600 mt-1">
//                     {report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'}
//                   </p>
//                 </TableHead>
//                 <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r">
//                   <h3 className="font-semibold text-gray-700">14 Days Ago</h3>
//                   <p className="text-sm text-gray-600 mt-1">
//                     {report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'}
//                   </p>
//                 </TableHead>
//               </TableRow>
//             </TableHeader>
//             <TableBody>
//               {Object.entries(groupedManpower).map(([label, counts], idx) => {
//                 return (
//                   <TableRow key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
//                     <TableCell className="py-3 px-4 text-sm font-medium border-r">{label}</TableCell>
//                     <TableCell className="text-center py-3 px-2 text-sm font-semibold border-r">{counts.current}</TableCell>
//                     <TableCell className="text-center py-3 px-2 text-sm border-r">
//                       {report7DaysAgo ? counts.sevenDays : <span className="text-gray-400 text-xs">N/A</span>}
//                     </TableCell>
//                     <TableCell className="text-center py-3 px-2 text-sm border-r">
//                       {report14DaysAgo ? counts.fourteenDays : <span className="text-gray-400 text-xs">N/A</span>}
//                     </TableCell>
//                   </TableRow>
//                 );
//               })}
//             </TableBody>
//           </Table>
//         </div>
//       </div>

//       {/* Expand/Collapse All Button */}
//       {Object.keys(groupedMilestones).length > 0 && (
//         <div className="flex justify-between items-center mb-3">
//           <h3 className="text-lg font-bold">Work Progress Comparison</h3>
//           <Button
//             variant="outline"
//             size="sm"
//             onClick={toggleAllSections}
//             className="flex items-center gap-1 text-xs md:text-sm"
//           >
//             {areAllSectionsExpanded ? (
//               <>
//                 <ChevronUp className="h-4 w-4" />
//                 Collapse All
//               </>
//             ) : (
//               <>
//                 <ChevronDown className="h-4 w-4" />
//                 Expand All
//               </>
//             )}
//           </Button>
//         </div>
//       )}

//       {/* Render each work header as a collapsible section */}
//       {Object.entries(groupedMilestones).map(([header, milestones], groupIdx) => (
//         <div key={groupIdx} className="mb-4 last:mb-0 border rounded-md overflow-hidden shadow-sm">
//           {/* Collapsible Header */}
//           <div
//             className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
//             onClick={() => toggleSection(header)}
//           >
//             <h3 className="text-base md:text-lg font-bold">{header} - {(milestones as MilestoneSnapshot[]).length.toString().padStart(2, '0')}</h3>
//             <div className="flex items-center">
//               <span className="text-xs md:text-sm text-gray-500 mr-2">
//                 {(milestones as MilestoneSnapshot[]).length} milestone{(milestones as MilestoneSnapshot[]).length !== 1 ? 's' : ''}
//               </span>
//               {expandedSections[header] ? (
//                 <ChevronUp className="h-5 w-5 text-gray-600" />
//               ) : (
//                 <ChevronDown className="h-5 w-5 text-gray-600" />
//               )}
//             </div>
//           </div>

//            {/* Collapsible Content - Comparison Table */}
//           {expandedSections[header] && (
//             <div className="p-0 overflow-x-auto">
//               {/* min-width must accommodate 10 columns */}
//               <Table className="w-full min-w-[1200px]"> 
//                 <TableHeader className="bg-gray-100">
                 
//                  {/* 1. TOP HEADER ROW */}
//                  <TableRow>
//                     <TableHead 
//                         className="w-[15%] font-semibold text-gray-700 text-sm py-2 text-left align-bottom"
//                         rowSpan={2} 
//                     >
//                         Work
//                     </TableHead> 

//                     {/* Current Report */}
//                     <TableHead 
//                         className="w-[28%] text-center font-semibold text-gray-700 text-sm py-2 border-r"
//                         colSpan={3}
//                     >
//                         Current ({latestReport.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric'}) : '--'})
//                     </TableHead>

//                     {/* -7 Days Report */}
//                     <TableHead 
//                         className="w-[28%] text-center font-semibold text-gray-700 text-sm py-2 border-r"
//                         colSpan={3}
//                     >
//                         7 Days Ago ({report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'})
//                     </TableHead>

//                     {/* -14 Days Report */}
//                     <TableHead 
//                         className="w-[28%] text-center font-semibold text-gray-700 text-sm py-2 border-r"
//                         colSpan={3}
//                     >
//                         14 Days Ago ({report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'})
//                     </TableHead>
//                   </TableRow>
                  
//                   {/* 2. BOTTOM HEADER ROW */}
//                  <TableRow className="bg-gray-200">
//                     {/* Current Metrics */}
//                     <TableHead className="w-[8%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
//                     <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2">Done %</TableHead>
//                     <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2 border-r">Remarks</TableHead>
                    
//                     {/* -7 Days Metrics */}
//                     <TableHead className="w-[8%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
//                     <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2">Done %</TableHead>
//                     <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2 border-r">Remarks</TableHead>
                    
//                     {/* -14 Days Metrics */}
//                     <TableHead className="w-[8%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
//                     <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2">Done %</TableHead>
//                     <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2 border-r">Remarks</TableHead>
//                   </TableRow>
//                 </TableHeader>
                
//                 {/* TABLE BODY */}
//                 <TableBody>
//                   {(milestones as MilestoneSnapshot[]).map((milestone, idx) => {
                    
//                     // Helper to get full data (including remarks)
//                     const getFullMilestoneData = (report: ReportDoc | null) => {
//                         const defaultData = { status: "N/A", progress: "N/A", remarks: "" };
//                         if (!report || !report.milestones) return defaultData;
                        
//                         // We look up the milestone in history based on the name from the filtered current list
//                         const foundMilestone = report.milestones.find(
//                             m => m.work_milestone_name === milestone.work_milestone_name && m.work_header === milestone.work_header
//                         );
                        
//                         return foundMilestone 
//                             ? { status: foundMilestone.status, progress: foundMilestone.progress, remarks: foundMilestone.remarks }
//                             : defaultData;
//                     };
                    
//                     const currentData = getFullMilestoneData(latestReport);
//                     const sevenDaysAgoData = getFullMilestoneData(report7DaysAgo);
//                     const fourteenDaysAgoData = getFullMilestoneData(report14DaysAgo);

//                     // Helper to render Remarks
//                     const renderRemarksCell = (remarks: string | undefined) => (
//                         <TableCell className="text-center py-3 px-2 text-sm overflow-hidden border-r">
//                             {remarks ? (
//                                 <p className="text-[10px] text-gray-700 " title={remarks}>
//                                     {remarks}
//                                 </p>
//                             ) : (
//                                 <span className="text-gray-400 text-xs">--</span>
//                             )}
//                         </TableCell>
//                     );
                    
//                     // Helper to render Progress
//                     const renderProgressCell = (data: any) => (
//                          <TableCell className="text-center py-3 px-2 text-sm font-medium ">
//                             <MilestoneProgress
//                                 milestoneStatus={data.status}
//                                 value={data.progress}
//                                 sizeClassName="size-[60px]"
//                                 textSizeClassName="text-md"
//                             />
//                          </TableCell>
//                     );

//                     return (
//                       <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} align-middle`}>
//                         {/* 1. Work Name */}
//                         <TableCell className="py-3 px-4 text-sm break-words">{idx + 1}. {milestone.work_milestone_name}</TableCell>
                        
//                         {/* CURRENT REPORT METRICS */}
//                         <TableCell className="text-center py-3 px-2">
//                           <Badge variant="secondary" className={`${getStatusBadgeClasses(currentData.status)} text-xs`}>
//                             {currentData.status}
//                           </Badge>
//                         </TableCell>
//                         {renderProgressCell(currentData)}
//                         {renderRemarksCell(currentData.remarks)}
                        
//                         {/* -7 DAYS AGO METRICS */}
//                         <TableCell className="text-center py-3 px-2">
//                           {report7DaysAgo ? (
//                             <Badge variant="secondary" className={`${getStatusBadgeClasses(sevenDaysAgoData.status)} text-xs`}>
//                               {sevenDaysAgoData.status}
//                             </Badge>
//                           ) : (
//                             <span className="text-gray-400 text-xs">N/A</span>
//                           )}
//                         </TableCell>
//                         {report7DaysAgo ? renderProgressCell(sevenDaysAgoData) : <TableCell className="text-center text-gray-400 text-xs">N/A</TableCell>}
//                         {report7DaysAgo ? renderRemarksCell(sevenDaysAgoData.remarks) : <TableCell className="text-center text-gray-400 text-xs border-r">N/A</TableCell>}

//                         {/* -14 DAYS AGO METRICS */}
//                         <TableCell className="text-center py-3 px-2">
//                           {report14DaysAgo ? (
//                             <Badge variant="secondary" className={`${getStatusBadgeClasses(fourteenDaysAgoData.status)} text-xs`}>
//                               {fourteenDaysAgoData.status}
//                             </Badge>
//                           ) : (
//                             <span className="text-gray-400 text-xs">N/A</span>
//                           )}
//                         </TableCell>
//                         {report14DaysAgo ? renderProgressCell(fourteenDaysAgoData) : <TableCell className="text-center text-gray-400 text-xs">N/A</TableCell>}
//                         {report14DaysAgo ? renderRemarksCell(fourteenDaysAgoData.remarks) : <TableCell className="text-center text-gray-400 text-xs border-r">N/A</TableCell>}

//                       </TableRow>
//                     );
//                   })}
//                 </TableBody>
//               </Table>
//             </div>
//           )}
//         </div>
//       ))}
       
//       <div className="mt-6">
//         <h3 className="text-base md:text-lg font-bold mb-3">Most recent Work Images</h3>
//         <ImageBentoGrid
//             images={latestReport.attachments || []}
//             forPdf={false}
//         />
//       </div>
      
//       {/* PDF Download Button */}
//       <div className="mt-6 flex justify-end">
//         <OverallMilestonesReportPDF
//           latestReport={latestReport}
//           report7DaysAgo={report7DaysAgo}
//           report14DaysAgo={report14DaysAgo}
//           projectData={projectData}
//           selectedZone={selectedZone}
//         />
//       </div>

//       {Object.keys(groupedMilestones).length === 0 ? (
//         <Card className="bg-white p-6 rounded-lg shadow-sm border border-gray-300 mt-4">
//           <CardContent className="flex flex-col items-center justify-center py-8">
//             <Info className="h-10 w-10 text-blue-500 mb-3" />
//             <h3 className="text-lg font-semibold text-gray-800 mb-2">No Applicable Data</h3>
//             <p className="text-gray-600 text-center max-w-md">
//               The current report contains data, but all statuses are marked as "Not Applicable".
//             </p>
//           </CardContent>
//         </Card>
//       ) : null}
//     </div>
//   );
// };

// export default OverallMilestonesReport;

