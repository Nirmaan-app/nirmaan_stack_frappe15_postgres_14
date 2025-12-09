import React, { useMemo, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { formatDate } from '@/utils/FormatDate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Truck, Info, Eye, EyeOff } from 'lucide-react';
import logo from "@/assets/logo-svg.svg";
import { MilestoneProgress } from '../MilestonesSummary';
import { useFrappeGetDoc } from 'frappe-react-sdk';
import { PDFImageGrid } from '@/components/ui/PDFImageGrid';
import { Label } from '@/components/ui/label'; 

// --- Types ---
interface MilestoneSnapshot {
  work_milestone_name: string;
  status: string;
  progress: number;
  work_header: string;
  remarks: string;
}
interface ManpowerSnapshot { label: string; count: number; }
interface ProjectProgressAttachment { image_link: string; location: string | null; remarks: string; }
interface ReportDoc {
  name: string; report_date: string; milestones: MilestoneSnapshot[]; manpower: ManpowerSnapshot[];
  total_completed_works: number; number_of_work_headers: number; total_manpower_used_till_date: number;
  attachments?: ProjectProgressAttachment[]; owner?: string;
}
interface OverallMilestonesReportPDFProps {
  latestReport: ReportDoc | null; report7DaysAgo: ReportDoc | null; report14DaysAgo: ReportDoc | null; projectData: any; selectedZone: string | null;
}

// --- Data Interface for Grouped Data ---
interface GroupedHeaderData {
  milestones: MilestoneSnapshot[];
  averages: {
    current: number;
    sevenDays: number;
    fourteenDays: number;
  }
}

// Helper function to get badge classes based on status
const getStatusBadgeClasses = (status: string) => {
  switch (status) {
    case "Completed": return "bg-green-100 text-green-800";
    case "WIP": return "bg-yellow-100 text-yellow-800";
    case "Not Started": return "bg-red-100 text-red-800";
    case "N/A": return "bg-gray-100 text-gray-800";
    default: return "bg-blue-100 text-blue-800";
  }
};

interface PDFReportHeaderProps {
  projectData: any; reportDate: string; projectlastUpdateBy: string
}

// --- NON-REPEATING HEADER COMPONENT ---
const PDFReportHeaderContent: React.FC<PDFReportHeaderProps> = ({ projectData, reportDate, projectlastUpdateBy, showHeader }) => {
  if (!showHeader) return null;
  return (
    <div className="border-b border-black pb-4 mb-4 avoid-page-break-inside">
      <div className="flex text-left justify-between border-gray-600 pb-1">
        <div className="mt-2 flex justify-start">
          <div>
            <img src={logo} alt="Nirmaan" width="180" height="52" />
            <div className="pt-2 text-lg font-semibold">
              Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
            </div>
            <div className="text-sm text-gray-500 mt-0.5">
              First floor, 234, 9th Main, 16th Cross Rd, Sector 6, HSR Layout, Bengaluru, Karnataka 560102
            </div>
          </div>
        </div>
      </div>
    </div>
  )
};

const OverallMilestonesReportPDF: React.FC<OverallMilestonesReportPDFProps> = ({
  latestReport,
  report7DaysAgo,
  report14DaysAgo,
  projectData,
  selectedZone
}) => {
  const componentRef = useRef<HTMLDivElement>(null);

  const defaultFileName = `${projectData?.project_name || 'Project'}_${formatDate(latestReport?.report_date)}_OverallMilestone_Report`;
  const [pdfFileName, setPdfFileName] = useState(defaultFileName);
  const [showHeaderOnPrint, setShowHeaderOnPrint] = useState(true);

  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
    documentTitle: pdfFileName.trim() || `Milestone_Report_${formatDate(new Date())}`,
    pageStyle: `@page { size: A4 landscape; margin: 0.5cm; }`
  });

  const { data: ownerData } = useFrappeGetDoc<{ full_name: string }>('Nirmaan Users', latestReport?.owner || '')

  // --- 1. SMART GROUPING AND CALCULATION LOGIC (Milestones) ---
  const groupedMilestones = useMemo(() => {
    if (!latestReport?.milestones) return {};

    const activeMilestones = latestReport.milestones.filter(m => m.status !== 'Not Applicable');

    const rawGroups = activeMilestones.reduce((acc, milestone) => {
      (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
      return acc;
    }, {} as Record<string, MilestoneSnapshot[]>);

    const result: Record<string, GroupedHeaderData> = {};
    const sortedHeaders = Object.keys(rawGroups).sort((a, b) => a.localeCompare(b));

    sortedHeaders.forEach(header => {
      const milestones = rawGroups[header];

      const calculateAverage = (targetReport: ReportDoc | null) => {
        if (!targetReport) return 0;
        
        let totalProgress = 0;
        let count = 0;

        milestones.forEach(m => {
          const historicalMilestone = targetReport.milestones.find(
            hm => hm.work_milestone_name === m.work_milestone_name && hm.work_header === m.work_header
          );

          if (historicalMilestone) {
            const val = Number(historicalMilestone.progress) || 0;
            totalProgress += val;
            count++;
          } else {
            count++; 
          }
        });

        return count > 0 ? Math.round(totalProgress / count) : 0;
      };

      result[header] = {
        milestones: milestones,
        averages: {
          current: calculateAverage(latestReport),
          sevenDays: calculateAverage(report7DaysAgo),
          fourteenDays: calculateAverage(report14DaysAgo)
        }
      };
    });

    return result;
  }, [latestReport, report7DaysAgo, report14DaysAgo]);


  // --- 2. GROUPED MANPOWER WITH ZERO-CHECK FILTERING ---
  const groupedManpower = useMemo(() => {
    if (!latestReport?.manpower) return {};
    
    // Collect all labels
    const allManpowerLabels = new Set<string>();
    latestReport.manpower.forEach(mp => allManpowerLabels.add(mp.label));
    report7DaysAgo?.manpower?.forEach(mp => allManpowerLabels.add(mp.label));
    report14DaysAgo?.manpower?.forEach(mp => allManpowerLabels.add(mp.label));

    const groups: Record<string, { current: number, sevenDays: number, fourteenDays: number }> = {};
    
    Array.from(allManpowerLabels).forEach(label => {
      // Get counts (default to 0)
      const current = parseInt(latestReport.manpower.find(mp => mp.label === label)?.count.toString() || '0', 10);
      const sevenDays = parseInt(report7DaysAgo?.manpower?.find(mp => mp.label === label)?.count.toString() || '0', 10);
      const fourteenDays = parseInt(report14DaysAgo?.manpower?.find(mp => mp.label === label)?.count.toString() || '0', 10);

      // FILTER: Only add if at least one value is > 0
      if (current > 0 || sevenDays > 0 || fourteenDays > 0) {
        groups[label] = {
          current,
          sevenDays,
          fourteenDays
        };
      }
    });
    return groups;
  }, [latestReport, report7DaysAgo, report14DaysAgo]);

  // Helper to get full milestone data
  const getFullMilestoneData = (milestoneName: string, workHeader: string, report: ReportDoc | null) => {
    const defaultData = { status: "N/A", progress: "N/A", remarks: "" };
    if (!report || !report.milestones) return defaultData;

    const foundMilestone = report.milestones.find(
      m => m.work_milestone_name === milestoneName && m.work_header === workHeader
    );

    return foundMilestone
      ? { status: foundMilestone.status, progress: foundMilestone.progress, remarks: foundMilestone.remarks }
      : defaultData;
  };

  // --- Render Helpers ---
  const renderRemarksCell = (remarks: string) => (
    <TableCell className="text-center py-3 px-2 text-sm border-r">
      {remarks ? (
        <p className="text-[10px] text-gray-700" title={remarks}>
          {remarks}
        </p>
      ) : (
        <span className="text-gray-400 text-xs">--</span>
      )}
    </TableCell>
  );

  const renderProgressCell = (data: { status: string, progress: string | number }) => (
    <TableCell className="text-center py-3 text-sm font-medium">
      <MilestoneProgress
        milestoneStatus={data.status}
        value={data.progress}
        sizeClassName="size-[40px]"
        textSizeClassName="text-sm"
      />
    </TableCell>
  );

  return (
    <>
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <Label htmlFor="pdf-header-switch" className="text-sm font-medium flex items-center space-x-1 cursor-pointer">
            <span className="hidden sm:inline">PDF Header</span>
          </Label>
          <Button
            variant="outline"
            size="sm"
            className="p-1 h-auto"
            onClick={() => setShowHeaderOnPrint(prev => !prev)}
          >
            {showHeaderOnPrint ?
              <Eye className="w-4 h-4 text-green-600" title="Header is Visible" />
              :
              <EyeOff className="w-4 h-4 text-red-600" title="Header is Hidden" />
            }
          </Button>
        </div>
        <button onClick={handlePrint} className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg text-lg flex items-center justify-end-safe gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download PDF
        </button>
      </div>

      {/* Hidden container for print content */}
      <div className="hidden">
        <div ref={componentRef} className="bg-white p-8">

          {/* 1. NON-REPEATING HEADER */}
          <PDFReportHeaderContent
            projectData={projectData}
            reportDate={latestReport?.report_date || ''}
            projectlastUpdateBy={ownerData?.full_name || latestReport?.owner || '--'}
            showHeader={showHeaderOnPrint}
          />
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-md mt-4 pb-2 border-b border-gray-300">
            <div className="flex justify-between items-center">
              <span className="font-semibold">Project {`${selectedZone ? "+ Zone" : ""}`}:</span>
              <span className="text-right">{projectData?.project_name || "--"}{`${selectedZone ? ` (${selectedZone})` : ""}`}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold">Last Updated By :</span>
              <span className="text-right">{ownerData?.full_name || latestReport?.owner || '--'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold">Start Date :</span>
              <span className="text-right">{projectData?.project_start_date ? formatDate(projectData.project_start_date) : "--"}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold">Lastest Report Date :</span>
              <span className="text-right">{formatDate(latestReport?.report_date || '') || "--"}</span>
            </div>
          </div>

          {/* Manpower Comparison Section */}
          {Object.keys(groupedManpower).length > 0 && (
            <div className="mb-6 avoid-page-break-inside">
              <h2 className="text-xl font-bold mb-4 mt-4 flex items-center gap-2">
                <Truck className="h-5 w-5" /> Manpower Comparison
              </h2>
              <Table className="w-full min-w-[600px] border border-gray-300">
                <TableHeader className="bg-gray-100">
                  <TableRow>
                    <TableHead className="w-[25%] font-semibold text-gray-700 text-sm py-2">Manpower Type</TableHead>
                    <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r"> <h3 className="font-semibold text-gray-700">Current</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {latestReport?.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric' }) : '--'}
                      </p></TableHead>
                    <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r"> <h3 className="font-semibold text-gray-700">7 Days Ago</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'}
                      </p></TableHead>
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
                      <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} avoid-page-break-inside`}>
                        <TableCell className="py-3 px-4 text-sm font-medium break-words border-r">{label}</TableCell>
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
          )}


          {/* Work Progress Comparison Section */}
          {Object.entries(groupedMilestones).length > 0 && (
            <div className="mb-6 avoid-page-break-inside">
              <PDFReportHeaderContent
                projectData={projectData}
                reportDate={latestReport?.report_date || ''}
                projectlastUpdateBy={ownerData?.full_name || latestReport?.owner || '--'}
              />
              <h2 className="text-xl font-bold mb-4 mt-4">Work Progress Comparison</h2>
              
              <Table className="w-full min-w-[1000px]">
                <TableHeader className="bg-gray-100">
                  {/* 1. TOP HEADER ROW */}
                  <TableRow>
                    <TableHead className="w-[10%] font-semibold text-gray-700 text-sm py-2 text-left align-bottom" rowSpan={2}>Work</TableHead>
                    <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r" colSpan={3}>
                      Current ({latestReport?.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric' }) : '--'})
                    </TableHead>
                    <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r" colSpan={3}>
                      7 Days Ago ({report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'})
                    </TableHead>
                    <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r" colSpan={3}>
                      14 Days Ago ({report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'})
                    </TableHead>
                  </TableRow>

                  {/* 2. BOTTOM HEADER ROW */}
                  <TableRow className="bg-gray-200">
                    {/* Current */}
                    <TableHead className="w-[5%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
                    <TableHead className="w-[8%] text-center font-semibold text-gray-700 text-sm py-2">Done %</TableHead>
                    <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2  border-r">Remarks</TableHead>
                    {/* 7 Days */}
                    <TableHead className="w-[5%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
                    <TableHead className="w-[8%] text-center font-semibold text-gray-700 text-sm py-2">Done %</TableHead>
                    <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2  border-r">Remarks</TableHead>
                    {/* 14 Days */}
                    <TableHead className="w-[5%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
                    <TableHead className="w-[8%] text-center font-semibold text-gray-700 text-sm py-2">Done %</TableHead>
                    <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2  border-r">Remarks</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {Object.entries(groupedMilestones).map(([header, data], groupIdx) => (
                    <React.Fragment key={header}>
                      {/* --- 2. SUB-HEADER ROW WITH OVERALL PROGRESS --- */}
                      <TableRow className="bg-gray-300">
                        {/* Group Name */}
                        <TableCell className="py-2 px-4 text-sm font-bold border-r text-gray-900">
                          {header} ({data.milestones.length})
                        </TableCell>

                        {/* Current Average */}
                        <TableCell colSpan={3} className="py-2 px-4 text-center border-r">
                          <div className="flex items-center justify-center space-x-2">
                            <span className="text-xs font-bold text-gray-700">Overall:</span>
                            <MilestoneProgress
                              milestoneStatus="Completed"
                              value={data.averages.current}
                              sizeClassName="size-[30px]"
                              textSizeClassName="text-[10px]"
                            />
                          </div>
                        </TableCell>

                        {/* 7 Days Average */}
                        <TableCell colSpan={3} className="py-2 px-4 text-center border-r">
                          {report7DaysAgo && (
                            <div className="flex items-center justify-center space-x-2">
                              <span className="text-xs font-bold text-gray-700">Overall:</span>
                              <MilestoneProgress
                                milestoneStatus="Completed"
                                value={data.averages.sevenDays}
                                sizeClassName="size-[30px]"
                                textSizeClassName="text-[10px]"
                              />
                            </div>
                          )}
                        </TableCell>

                        {/* 14 Days Average */}
                        <TableCell colSpan={3} className="py-2 px-4 text-center border-r">
                          {report14DaysAgo && (
                            <div className="flex items-center justify-center space-x-2">
                              <span className="text-xs font-bold text-gray-700">Overall:</span>
                              <MilestoneProgress
                                milestoneStatus="Completed"
                                value={data.averages.fourteenDays}
                                sizeClassName="size-[30px]"
                                textSizeClassName="text-[10px]"
                              />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>

                      {/* Milestone Rows */}
                      {data.milestones.map((milestone, idx) => {
                        const currentData = getFullMilestoneData(milestone.work_milestone_name, milestone.work_header, latestReport);
                        const sevenDaysAgoData = getFullMilestoneData(milestone.work_milestone_name, milestone.work_header, report7DaysAgo);
                        const fourteenDaysAgoData = getFullMilestoneData(milestone.work_milestone_name, milestone.work_header, report14DaysAgo);

                        return (
                          <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} avoid-page-break-inside align-middle`}>
                            {/* 1. Work Name */}
                            <TableCell className="py-3 px-4 text-sm break-words border-r font-medium text-gray-800">{idx + 1}. {milestone.work_milestone_name}</TableCell>

                            {/* CURRENT REPORT METRICS */}
                            <TableCell className="text-center py-3 px-2">
                              <Badge variant="secondary" className={`${getStatusBadgeClasses(currentData.status)} text-xs`}>
                                {currentData.status}
                              </Badge>
                            </TableCell>
                            {renderProgressCell(currentData)}
                            {renderRemarksCell(currentData.remarks)}

                            {/* -7 DAYS AGO METRICS */}
                            <TableCell className="text-center py-3 px-2">
                              {report7DaysAgo ? (
                                <Badge variant="secondary" className={`${getStatusBadgeClasses(sevenDaysAgoData.status)} text-xs`}>
                                  {sevenDaysAgoData.status}
                                </Badge>
                              ) : (
                                <span className="text-gray-400 text-xs">N/A</span>
                              )}
                            </TableCell>
                            {report7DaysAgo ? renderProgressCell(sevenDaysAgoData) : <TableCell className="text-center text-gray-400 text-xs">N/A</TableCell>}
                            {report7DaysAgo ? renderRemarksCell(sevenDaysAgoData.remarks) : <TableCell className="text-center text-gray-400 text-xs border-r">N/A</TableCell>}

                            {/* -14 DAYS AGO METRICS */}
                            <TableCell className="text-center py-3 px-2">
                              {report14DaysAgo ? (
                                <Badge variant="secondary" className={`${getStatusBadgeClasses(fourteenDaysAgoData.status)} text-xs`}>
                                  {fourteenDaysAgoData.status}
                                </Badge>
                              ) : (
                                <span className="text-gray-400 text-xs">N/A</span>
                              )}
                            </TableCell>
                            {report14DaysAgo ? renderProgressCell(fourteenDaysAgoData) : <TableCell className="text-center text-gray-400 text-xs">N/A</TableCell>}
                            {report14DaysAgo ? renderRemarksCell(fourteenDaysAgoData.remarks) : <TableCell className="text-center text-gray-400 text-xs border-r">N/A</TableCell>}

                          </TableRow>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Work Images Section */}
          {latestReport?.attachments && latestReport.attachments.length > 0 && (
            <div className="page-break-before pt-8 avoid-page-break-inside">
              <PDFReportHeaderContent
                projectData={projectData}
                reportDate={latestReport?.report_date || ''}
                projectlastUpdateBy={ownerData?.full_name || latestReport?.owner || '--'}
              />
              <h3 className="text-2xl font-bold mb-3 text-gray-800">Most Recent WORK IMAGES</h3>
              <PDFImageGrid
                images={latestReport.attachments}
                maxImagesPerPage={4}
              />
            </div>
          )}

        </div>
      </div>

      {/* Print-specific styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 landscape;
            padding: 0.5cm;
          }
          
          .page-break-before {
            page-break-before: always;
          }
          
          table {
            table-layout: fixed;
            width: 100%;
            border-collapse: collapse;
          }
          
          th, td {
            word-wrap: break-word;
            overflow-wrap: break-word;
          }
          
          thead {
            display: table-header-group !important;
          }

          .avoid-page-break-inside {
            page-break-inside: avoid !important;
          }
          
          .grid-cols-2 {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 1rem !important;
          }
          
           h2, h3, h4 {
            page-break-after: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </>
  );
};

export default OverallMilestonesReportPDF;


// import React, { useMemo, useRef, useState } from 'react';
// import { useReactToPrint } from 'react-to-print';
// import { formatDate } from '@/utils/FormatDate';
// import { Badge } from '@/components/ui/badge';
// import { Button } from '@/components/ui/button';
// // Retain ShadCN Table components for the comparison tables
// import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
// import { Download, Truck, Info, Eye, EyeOff } from 'lucide-react';
// import logo from "@/assets/logo-svg.svg";
// import { MilestoneProgress } from '../MilestonesSummary';
// import { useFrappeGetDoc } from 'frappe-react-sdk';
// import { PDFImageGrid } from '@/components/ui/PDFImageGrid';
// import { Label } from '@/components/ui/label'; // Ensure Label is imported




// // Define types (retained for context and functionality)
// interface MilestoneSnapshot {
//   work_milestone_name: string;
//   status: string;
//   progress: number;
//   work_header: string;
//   remarks: string;
// }
// interface ManpowerSnapshot { label: string; count: number; }
// interface ProjectProgressAttachment { image_link: string; location: string | null; remarks: string; }
// interface ReportDoc {
//   name: string; report_date: string; milestones: MilestoneSnapshot[]; manpower: ManpowerSnapshot[];
//   total_completed_works: number; number_of_work_headers: number; total_manpower_used_till_date: number;
//   attachments?: ProjectProgressAttachment[]; owner?: string;
// }
// interface OverallMilestonesReportPDFProps {
//   latestReport: ReportDoc | null; report7DaysAgo: ReportDoc | null; report14DaysAgo: ReportDoc | null; projectData: any; selectedZone: string | null;
// }

// // Helper function to get badge classes based on status
// const getStatusBadgeClasses = (status: string) => {
//   switch (status) {
//     case "Completed": return "bg-green-100 text-green-800";
//     case "WIP": return "bg-yellow-100 text-yellow-800";
//     case "Not Started": return "bg-red-100 text-red-800";
//     case "N/A": return "bg-gray-100 text-gray-800";
//     default: return "bg-blue-100 text-blue-800";
//   }
// };

// interface PDFReportHeaderProps {
//   projectData: any; reportDate: string; projectlastUpdateBy: string
// }

// // --- NON-REPEATING HEADER COMPONENT (Just a div) ---
// const PDFReportHeaderContent: React.FC<PDFReportHeaderProps> = ({ projectData, reportDate, projectlastUpdateBy, showHeader }) => {
//   if (!showHeader) return null;
//   return (
//     <div className="border-b border-black pb-4 mb-4 avoid-page-break-inside">
//       <div className="flex text-left justify-between border-gray-600 pb-1">
//         <div className="mt-2 flex justify-start">
//           <div>
//             <img
//               src={logo}
//               alt="Nirmaan"
//               width="180"
//               height="52"
//             />
//             <div className="pt-2 text-lg font-semibold">
//               Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
//             </div>
//             <div className="text-sm text-gray-500 mt-0.5">
//               First floor, 234, 9th Main, 16th Cross Rd, Sector 6, HSR Layout, Bengaluru, Karnataka 560102
//             </div>
//           </div>
//         </div>
//       </div>
//       {/* <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-md mt-4 pb-2 border-b border-gray-300">
//       <div className="flex justify-between items-center">
//         <span className="font-semibold">Project :</span>
//         <span className="text-right">{projectData?.project_name || "--"}</span>
//       </div>
//       <div className="flex justify-between items-center">
//         <span className="font-semibold">Last Updated By :</span>
//         <span className="text-right">{projectlastUpdateBy || "--"}</span>
//       </div>
//       <div className="flex justify-between items-center">
//         <span className="font-semibold">Start Date :</span>
//         <span className="text-right">{projectData?.project_start_date ? formatDate(projectData.project_start_date) : "--"}</span>
//       </div>
//       <div className="flex justify-between items-center">
//         <span className="font-semibold">Lastest Report Date :</span>
//         <span className="text-right">{formatDate(reportDate) || "--"}</span>
//       </div>
//     </div> */}
//     </div>
//   )
// };

// const OverallMilestonesReportPDF: React.FC<OverallMilestonesReportPDFProps> = ({
//   latestReport,
//   report7DaysAgo,
//   report14DaysAgo,
//   projectData,
//   selectedZone
// }) => {
//   const componentRef = useRef<HTMLDivElement>(null);

//   const defaultFileName = `${projectData?.project_name || 'Project'}_${formatDate(latestReport?.report_date)}_OverallMilestone_Report`;
//   const [pdfFileName, setPdfFileName] = useState(defaultFileName);
//   const [showHeaderOnPrint, setShowHeaderOnPrint] = useState(true); // NEW STATE for toggle

//   const handlePrint = useReactToPrint({
//     content: () => componentRef.current,
//     documentTitle: pdfFileName.trim() || `Milestone_Report_${formatDate(new Date())}`,
//     pageStyle: `@page { size: A4 landscape; margin: 0.5cm; }`
//   });

//   const { data: ownerData } = useFrappeGetDoc<{ full_name: string }>('Nirmaan Users', latestReport?.owner || '')

//   // Memoized grouped milestones (with sorting)
//   const groupedMilestones = useMemo(() => {
//     if (!latestReport?.milestones) return {};
//     return Object.entries(latestReport.milestones.reduce((acc, milestone) => {
//       (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
//       return acc;
//     }, {} as Record<string, MilestoneSnapshot[]>))
//       .sort(([headerA], [headerB]) => headerA.localeCompare(headerB))
//       .reduce((acc, [header, milestones]) => {
//         acc[header] = milestones;
//         return acc;
//       }, {} as Record<string, MilestoneSnapshot[]>);

//   }, [latestReport]);

//   // Memoized grouped manpower
//   const groupedManpower = useMemo(() => {
//     if (!latestReport?.manpower) return {};
//     const allManpowerLabels = new Set<string>();
//     latestReport.manpower.forEach(mp => allManpowerLabels.add(mp.label));
//     report7DaysAgo?.manpower?.forEach(mp => allManpowerLabels.add(mp.label));
//     report14DaysAgo?.manpower?.forEach(mp => allManpowerLabels.add(mp.label));

//     const groups: Record<string, { current: number, sevenDays: number, fourteenDays: number }> = {};
//     Array.from(allManpowerLabels).forEach(label => {
//       groups[label] = {
//         current: parseInt(latestReport.manpower.find(mp => mp.label === label)?.count.toString() || '0', 10),
//         sevenDays: parseInt(report7DaysAgo?.manpower?.find(mp => mp.label === label)?.count.toString() || '0', 10),
//         fourteenDays: parseInt(report14DaysAgo?.manpower?.find(mp => mp.label === label)?.count.toString() || '0', 10)
//       };
//     });
//     return groups;
//   }, [latestReport, report7DaysAgo, report14DaysAgo]);

//   // Helper to get full milestone data (including remarks)
//   const getFullMilestoneData = (milestoneName: string, workHeader: string, report: ReportDoc | null) => {
//     const defaultData = { status: "N/A", progress: "N/A", remarks: "" };
//     if (!report || !report.milestones) return defaultData;

//     const foundMilestone = report.milestones.find(
//       m => m.work_milestone_name === milestoneName && m.work_header === workHeader
//     );

//     return foundMilestone
//       ? { status: foundMilestone.status, progress: foundMilestone.progress, remarks: foundMilestone.remarks }
//       : defaultData;
//   };

//   const hasHistoricalData = report7DaysAgo || report14DaysAgo;

//   // --- Render Helpers ---

//   // Helper to render Remarks
//   const renderRemarksCell = (remarks: string) => (
//     <TableCell className="text-center py-3 px-2 text-sm  border-r">
//       {remarks ? (
//         <p className="text-[10px] text-gray-700 " title={remarks}>
//           {remarks}
//         </p>
//       ) : (
//         <span className="text-gray-400 text-xs">--</span>
//       )}
//     </TableCell>
//   );

//   // Helper to render Progress
//   const renderProgressCell = (data: { status: string, progress: string | number }) => (
//     <TableCell className="text-center py-3  text-sm font-medium">
//       <MilestoneProgress
//         milestoneStatus={data.status}
//         value={data.progress}
//         sizeClassName="size-[40px]"
//         textSizeClassName="text-sm"
//       />
//     </TableCell>
//   );

//   // --- END Render Helpers ---


//   return (
//     <>
//       <div className="flex items-center space-x-4">
//         <div className="flex items-center space-x-2">
//           <Label htmlFor="pdf-header-switch" className="text-sm font-medium flex items-center space-x-1 cursor-pointer">
//             <span className="hidden sm:inline">PDF Header</span>
//           </Label>
//           {/* Using a custom button/toggle */}
//           <Button
//             variant="outline"
//             size="sm"
//             className="p-1 h-auto"
//             onClick={() => setShowHeaderOnPrint(prev => !prev)}
//           >
//             {/* Visual indicator for the toggle */}
//             {showHeaderOnPrint ?
//               <Eye className="w-4 h-4 text-green-600" title="Header is Visible" />
//               :
//               <EyeOff className="w-4 h-4 text-red-600" title="Header is Hidden" />
//             }
//           </Button>
//         </div>
//         <button onClick={handlePrint} className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg text-lg flex items-center justify-end-safe gap-2">
//           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
//             <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
//           </svg>
//           Download PDF
//         </button>
//       </div>

//       {/* Hidden container for print content - Single Flow Document */}
//       <div className="hidden">
//         {/* Main Content Wrapper (Reference Point for Printing) */}
//         <div ref={componentRef} className="bg-white p-8">

//           {/* 1. NON-REPEATING HEADER */}
//           <PDFReportHeaderContent
//             projectData={projectData}
//             reportDate={latestReport?.report_date || ''}
//             projectlastUpdateBy={ownerData?.full_name || latestReport?.owner || '--'}
//             showHeader={showHeaderOnPrint}
//           />
//           <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-md mt-4 pb-2 border-b border-gray-300">
//             <div className="flex justify-between items-center">
//               <span className="font-semibold">Project {`${selectedZone ? "+ Zone" : ""}`}:</span>
//               <span className="text-right">{projectData?.project_name || "--"}{`${selectedZone ? ` (${selectedZone})` : ""}`}</span>
//             </div>
//             <div className="flex justify-between items-center">
//               <span className="font-semibold">Last Updated By :</span>
//               <span className="text-right">{ownerData?.full_name || latestReport?.owner || '--'}</span>
//             </div>
//             <div className="flex justify-between items-center">
//               <span className="font-semibold">Start Date :</span>
//               <span className="text-right">{projectData?.project_start_date ? formatDate(projectData.project_start_date) : "--"}</span>
//             </div>
//             <div className="flex justify-between items-center">
//               <span className="font-semibold">Lastest Report Date :</span>
//               <span className="text-right">{formatDate(latestReport?.report_date || '') || "--"}</span>
//             </div>
//           </div>

//           {/* --- START REPORT CONTENT FLOW --- */}

//           {/* Overall Work Report section */}
//           {/* <div className="mb-6 mt-4 avoid-page-break-inside">
//             <h2 className="text-2xl font-bold mb-3">Overall Work Report</h2>
//             <div className="grid grid-cols-1 gap-2 text-lg">
//               <p>Total Completed: <span className="font-semibold">{latestReport?.total_completed_works ?? '--'}</span></p>
//               <p>Number of packages: <span className="font-semibold">{latestReport?.number_of_work_headers ?? '--'}</span></p>
//               <p>Total Manpower Used (till date): <span className="font-semibold">{latestReport?.total_manpower_used_till_date ?? '--'}</span></p>
//             </div>
//           </div> */}

//           {/* Report Dates Summary */}
//           {/* <div className="grid grid-cols-4 gap-4 mb-8 avoid-page-break-inside">
//             <div className="text-center p-3 bg-gray-100 rounded-lg">
//               <h3 className="font-semibold text-gray-700">Current</h3>
//               <p className="text-sm text-gray-600 mt-1">
//                 {latestReport?.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric' }) : '--'}
//               </p>
//             </div>
//             <div className="text-center p-3 bg-gray-100 rounded-lg">
//               <h3 className="font-semibold text-gray-700">7 Days Ago</h3>
//               <p className="text-sm text-gray-600 mt-1">
//                 {report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'}
//               </p>
//             </div>
//             <div className="text-center p-3 bg-gray-100 rounded-lg">
//               <h3 className="font-semibold text-gray-700">14 Days Ago</h3>
//               <p className="text-sm text-gray-600 mt-1">
//                 {report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'}
//               </p>
//             </div>
//           </div> */}

//           {/* {!hasHistoricalData && (
//             <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded avoid-page-break-inside">
//               <div className="flex items-start">
//                 <div className="flex-shrink-0">
//                   <Info className="h-5 w-5 text-yellow-400" />
//                 </div>
//                 <div className="ml-3">
//                   <p className="text-sm text-yellow-700">
//                     Limited historical data available. Showing current report data only.
//                     Create more reports over time to enable comparison features.
//                   </p>
//                 </div>
//               </div>
//             </div>
//           )} */}

//           {/* Manpower Comparison Section */}
//           {Object.keys(groupedManpower).length > 0 && (
//             <div className="mb-6 avoid-page-break-inside">
//               <h2 className="text-xl font-bold mb-4 mt-4 flex items-center gap-2">
//                 <Truck className="h-5 w-5" /> Manpower Comparison
//               </h2>
//               <Table className="w-full min-w-[600px] border border-gray-300">
//                 <TableHeader className="bg-gray-100">
//                   <TableRow>
//                     <TableHead className="w-[25%] font-semibold text-gray-700 text-sm py-2">Manpower Type</TableHead>
//                     <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r"> <h3 className="font-semibold text-gray-700">Current</h3>
//                       <p className="text-sm text-gray-600 mt-1">
//                         {latestReport?.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric' }) : '--'}
//                       </p></TableHead>
//                     <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r"> <h3 className="font-semibold text-gray-700">7 Days Ago</h3>
//                       <p className="text-sm text-gray-600 mt-1">
//                         {report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'}
//                       </p></TableHead>
//                     <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r">
//                       <h3 className="font-semibold text-gray-700">14 Days Ago</h3>
//                       <p className="text-sm text-gray-600 mt-1">
//                         {report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'}
//                       </p>
//                     </TableHead>
//                   </TableRow>
//                 </TableHeader>
//                 <TableBody>
//                   {Object.entries(groupedManpower).map(([label, counts], idx) => {
//                     return (
//                       <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} avoid-page-break-inside`}>
//                         <TableCell className="py-3 px-4 text-sm font-medium break-words border-r">{label}</TableCell>
//                         <TableCell className="text-center py-3 px-2 text-sm font-semibold border-r">{counts.current}</TableCell>
//                         <TableCell className="text-center py-3 px-2 text-sm border-r">
//                           {report7DaysAgo ? counts.sevenDays : <span className="text-gray-400 text-xs">--</span>}
//                         </TableCell>
//                         <TableCell className="text-center py-3 px-2 text-sm border-r">
//                           {report14DaysAgo ? counts.fourteenDays : <span className="text-gray-400 text-xs">--</span>}
//                         </TableCell>
//                       </TableRow>
//                     );
//                   })}
//                 </TableBody>
//               </Table>
//             </div>
//           )}


//           {/* Work Progress Comparison Section (Main Content) */}
//           {Object.entries(groupedMilestones).length > 0 && (
//             <div className="mb-6 avoid-page-break-inside">
//               <PDFReportHeaderContent
//                 projectData={projectData}
//                 reportDate={latestReport?.report_date || ''}
//                 projectlastUpdateBy={ownerData?.full_name || latestReport?.owner || '--'}
//               />
//               <h2 className="text-xl font-bold mb-4 mt-4">Work Progress Comparison</h2>
//               {/* Main comparison table starts here */}
//               <Table className="w-full min-w-[1000px]">
//                 <TableHeader className="bg-gray-100">
//                   {/* 1. TOP HEADER ROW (Dates - uses colSpan) */}
//                   <TableRow>
//                     {/* Work - Not Spanned - uses rowSpan=2 */}
//                     <TableHead
//                       className="w-[10%] font-semibold text-gray-700 text-sm py-2 text-left align-bottom"
//                       rowSpan={2}
//                     >
//                       Work
//                     </TableHead>

//                     {/* Current Report (Spans 3 columns: Status + % Done + Remarks) */}
//                     <TableHead
//                       className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r"
//                       colSpan={3}
//                     >
//                       Current ({latestReport?.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric' }) : '--'})
//                     </TableHead>

//                     {/* -7 Days Report (Spans 3 columns) */}
//                     <TableHead
//                       className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r"
//                       colSpan={3}
//                     >
//                       7 Days Ago ({report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'})
//                     </TableHead>

//                     {/* -14 Days Report (Spans 3 columns) */}
//                     <TableHead
//                       className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2 border-r"
//                       colSpan={3}
//                     >
//                       14 Days Ago ({report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'})
//                     </TableHead>
//                   </TableRow>

//                   {/* 2. BOTTOM HEADER ROW (Metrics - 3x Status, Done, Remarks) */}
//                   <TableRow className="bg-gray-200">
//                     {/* Current Metrics */}
//                     <TableHead className="w-[5%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
//                     <TableHead className="w-[8%] text-center font-semibold text-gray-700 text-sm py-2">Done %</TableHead>
//                     <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2  border-r">Remarks</TableHead>

//                     {/* -7 Days Metrics */}
//                     <TableHead className="w-[5%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
//                     <TableHead className="w-[8%] text-center font-semibold text-gray-700 text-sm py-2">Done %</TableHead>
//                     <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2  border-r">Remarks</TableHead>

//                     {/* -14 Days Metrics */}
//                     <TableHead className="w-[5%] text-center font-semibold text-gray-700 text-sm py-2">Status</TableHead>
//                     <TableHead className="w-[8%] text-center font-semibold text-gray-700 text-sm py-2">Done %</TableHead>
//                     <TableHead className="w-[10%] text-center font-semibold text-gray-700 text-sm py-2  border-r">Remarks</TableHead>
//                   </TableRow>
//                 </TableHeader>

//                 <TableBody>
//                   {/* Loop through sorted work headers and then milestones */}
//                   {Object.entries(groupedMilestones).map(([header, milestones], groupIdx) => (
//                     <>
//                       {/* Sub-header row for Work Header */}
//                       <TableRow key={header} className="bg-gray-300">
//                         <TableCell colSpan={10} className="py-2 px-4 text-sm font-bold">
//                           {header} ({milestones.length})
//                         </TableCell>
//                       </TableRow>

//                       {/* Milestone Rows */}
//                       {milestones.map((milestone, idx) => {
//                         const currentData = getFullMilestoneData(milestone.work_milestone_name, milestone.work_header, latestReport);
//                         const sevenDaysAgoData = getFullMilestoneData(milestone.work_milestone_name, milestone.work_header, report7DaysAgo);
//                         const fourteenDaysAgoData = getFullMilestoneData(milestone.work_milestone_name, milestone.work_header, report14DaysAgo);

//                         return (
//                           <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} avoid-page-break-inside align-middle`}>
//                             {/* 1. Work Name */}
//                             <TableCell className="py-3 px-4 text-sm break-words">{idx + 1}. {milestone.work_milestone_name}</TableCell>

//                             {/* CURRENT REPORT METRICS (Status, % Done, Remarks) */}
//                             <TableCell className="text-center py-3 px-2">
//                               <Badge variant="secondary" className={`${getStatusBadgeClasses(currentData.status)} text-xs`}>
//                                 {currentData.status}
//                               </Badge>
//                             </TableCell>
//                             {renderProgressCell(currentData)}
//                             {renderRemarksCell(currentData.remarks)}

//                             {/* -7 DAYS AGO METRICS (Status, % Done, Remarks) */}
//                             <TableCell className="text-center py-3 px-2">
//                               {report7DaysAgo ? (
//                                 <Badge variant="secondary" className={`${getStatusBadgeClasses(sevenDaysAgoData.status)} text-xs`}>
//                                   {sevenDaysAgoData.status}
//                                 </Badge>
//                               ) : (
//                                 <span className="text-gray-400 text-xs">N/A</span>
//                               )}
//                             </TableCell>
//                             {report7DaysAgo ? renderProgressCell(sevenDaysAgoData) : <TableCell className="text-center text-gray-400 text-xs">N/A</TableCell>}
//                             {report7DaysAgo ? renderRemarksCell(sevenDaysAgoData.remarks) : <TableCell className="text-center text-gray-400 text-xs  border-r">N/A</TableCell>}


//                             {/* -14 DAYS AGO METRICS (Status, % Done, Remarks) */}
//                             <TableCell className="text-center py-3 px-2">
//                               {report14DaysAgo ? (
//                                 <Badge variant="secondary" className={`${getStatusBadgeClasses(fourteenDaysAgoData.status)} text-xs`}>
//                                   {fourteenDaysAgoData.status}
//                                 </Badge>
//                               ) : (
//                                 <span className="text-gray-400 text-xs">N/A</span>
//                               )}
//                             </TableCell>
//                             {report14DaysAgo ? renderProgressCell(fourteenDaysAgoData) : <TableCell className="text-center text-gray-400 text-xs">N/A</TableCell>}
//                             {report14DaysAgo ? renderRemarksCell(fourteenDaysAgoData.remarks) : <TableCell className="text-center text-gray-400 text-xs  border-r">N/A</TableCell>}

//                           </TableRow>
//                         );
//                       })}
//                     </>
//                   ))}
//                 </TableBody>
//               </Table>
//             </div>
//           )}
//           {/* End Work Progress Comparison Section */}


//           {/* Work Images Section (Starts on a new page) */}
//           {latestReport?.attachments && latestReport.attachments.length > 0 && (
//             <div className="page-break-before pt-8 avoid-page-break-inside">
//               <PDFReportHeaderContent
//                 projectData={projectData}
//                 reportDate={latestReport?.report_date || ''}
//                 projectlastUpdateBy={ownerData?.full_name || latestReport?.owner || '--'}
//               />
//               <h3 className="text-2xl font-bold mb-3 text-gray-800">Most Recent WORK IMAGES</h3>
//               <PDFImageGrid
//                 images={latestReport.attachments}
//                 maxImagesPerPage={4}
//               />
//             </div>
//           )}
//           {/* End Work Images Section */}

//         </div>

//       </div>

//       {/* Print-specific styles (Essential for native pagination) */}
//       <style jsx global>{`
//         @media print {
//           @page {
//             size: A4 landscape; /* Landscape orientation */
//             padding: 0.5cm;
//           }
          
//           .page-break-before {
//             page-break-before: always;
//           }
          
//           table {
//             table-layout: fixed;
//             width: 100%;
//             border-collapse: collapse;
//           }
          
//           th, td {
//             word-wrap: break-word;
//             overflow-wrap: break-word;
//           }
          
//           /* CRUCIAL: Forces thead to repeat on every page */
//           thead {
//             display: table-header-group !important;
//           }

//           /* Prevents content blocks from splitting */
//           .avoid-page-break-inside {
//             page-break-inside: avoid !important;
//           }
          
//           /* Ensures grid works correctly in print (for Work Images) */
//           .grid-cols-2 {
//             display: grid !important;
//             grid-template-columns: 1fr 1fr !important;
//             gap: 1rem !important;
//           }
          
//           /* Prevent header/title break */
//            h2, h3, h4 {
//             page-break-after: avoid;
//             page-break-inside: avoid;
//           }
//         }
//       `}</style>
//     </>
//   );
// };

// export default OverallMilestonesReportPDF;