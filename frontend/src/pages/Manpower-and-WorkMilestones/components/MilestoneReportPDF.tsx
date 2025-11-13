import React, { useRef, useMemo, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { formatDate } from '@/utils/FormatDate';
import { MapPin, MessagesSquare } from 'lucide-react';
import logo from "@/assets/logo-svg.svg";
import { ProgressCircle } from '@/components/ui/ProgressCircle';
import { MilestoneProgress } from '../MilestonesSummary';
import { useFrappeGetDoc } from 'frappe-react-sdk';
import { DELIMITER, parseWorkPlan, serializeWorkPlan } from '../MilestoneTab';

// --- Type Definitions (Assuming these are correct based on usage) ---
interface MilestoneReportPDFProps {
  dailyReportDetails: any;
  projectData: any;
}

// --- Component: ReportPageHeader (Repeats on every page) ---
const ReportPageHeader = ({ projectData, dailyReportDetails }: any) => (
  <thead className="border-b border-black">
    <tr>
      <th colSpan={4}>
        {/* Company Info/Header Content */}
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
          {/* Add project address/info here if needed */}
        </div>
      </th>
    </tr>
  </thead>
);

// --- Height Constants (Based on A4 page in print setup) ---
const PAGE_APPROX_HEIGHT_PX = 930; // Approximate height of the printable area on an A4 page
const REPEATING_HEADER_HEIGHT_PX = 140; // Height of the ReportPageHeader
const WORK_PLAN_TITLE_HEIGHT_PX = 40; // Height of the "WORK PLAN" h3 title
const WORK_PROGRESS_TITLE_HEIGHT_PX = 50; // Height of the "WORK PROGRESS" h3 title

// Available height for content on subsequent Work Plan pages
const AVAILABLE_HEIGHT_SUBSEQUENT_WP_PAGES = PAGE_APPROX_HEIGHT_PX - REPEATING_HEADER_HEIGHT_PX - WORK_PLAN_TITLE_HEIGHT_PX;
// Available height for content on Work Progress pages
const AVAILABLE_CONTENT_HEIGHT_PER_PAGE_FOR_PROGRESS_GROUPS = PAGE_APPROX_HEIGHT_PX - REPEATING_HEADER_HEIGHT_PX - WORK_PROGRESS_TITLE_HEIGHT_PX;

// --- Height Estimation Functions for Work Plan (Crucial for First Page Calculation) ---

const estimateWorkPlanCardHeight = (milestone: any) => {
  const baseCardHeight = 60; // Base height for name and basic structure
  const workPlanPoints = parseWorkPlan(milestone.work_plan);
  const charsPerLine = 80; // Estimated characters per line for the work plan text
  const lineHeight = 16; // Estimated line height
  let totalHeight = baseCardHeight;

  // Estimate height based on wrapped lines of work plan points
  workPlanPoints.forEach(point => {
    const lines = Math.ceil(point.length / charsPerLine);
    totalHeight += (lines * lineHeight) + 4; // +4 for padding/margin
  });

  return totalHeight + 20; // Extra padding/margin
};

const estimateWorkPlanGroupHeight = (milestones: any[]) => {
  const groupHeaderHeight = 50; // Height of the header div (Work Header - Count)
  const groupPadding = 30; // Margin/padding after the group
  let cardsHeight = 0;

  milestones.forEach(milestone => {
    cardsHeight += estimateWorkPlanCardHeight(milestone);
  });

  return groupHeaderHeight + cardsHeight + groupPadding
};

/**
 * Estimates the height of all content on the first page *before* the Work Plan section.
 * This is CRUCIAL for calculating the available space for the first Work Plan content block.
 */
const estimateFirstPageFixedContentHeight = (dailyReportDetails: any) => {
  const headerHeight = REPEATING_HEADER_HEIGHT_PX; // ReportPageHeader
  const projectDetailsHeight = 70; // Height of the Project Details grid

  let manpowerHeight = 0;
  const filteredManpower = dailyReportDetails?.manpower?.filter((mp: any) => mp.count > 0) || [];

  if (filteredManpower.length > 0) {
    // "MANPOWER DETAILS" title (30) + spacing (15)
    manpowerHeight += 30 + 15;
    // Height for each manpower row
    manpowerHeight += filteredManpower.length * 35;

    if (dailyReportDetails.manpower_remarks) {
      const remarksCharsPerLine = 75;
      const remarksLineHeight = 16;
      const remarksBasePadding = 15;
      // Calculate lines needed for remarks
      const remarksLines = Math.ceil((dailyReportDetails.manpower_remarks.length || 0) / remarksCharsPerLine);
      manpowerHeight += remarksBasePadding + (Math.max(1, remarksLines) * remarksLineHeight)
    }
    manpowerHeight += 10 // bottom padding
  }

  // Total height of the fixed content section
  const totalFixedHeight = headerHeight + projectDetailsHeight + manpowerHeight + 20; // +20 for general spacing/padding

  return totalFixedHeight;
};

// --- Height Estimation Functions for Work Progress ---

const estimateMilestoneRowHeight = (milestone: any) => {
  const baseHeight = 40; // Base height for a single-line milestone
  let estimatedHeight = baseHeight;

  // 1. Account for multi-line Milestone Name
  const nameCharsPerLine = 30;
  const nameLineHeight = 16;
  const nameLines = Math.ceil((milestone.work_milestone_name?.length || 0) / nameCharsPerLine);
  if (nameLines > 1) {
    estimatedHeight += (nameLines - 1) * nameLineHeight
  }

  // 2. Account for Remarks
  if (milestone.remarks) {
    const remarksCharsPerLine = 35;
    const remarksLineHeight = 14;
    const remarksPaddingHeight = 10;
    const remarksLines = Math.ceil((milestone.remarks.length || 0) / remarksCharsPerLine);
    const actualRemarksLines = Math.max(1, remarksLines);
    estimatedHeight += (actualRemarksLines * remarksLineHeight) + remarksPaddingHeight
  }

  estimatedHeight += 5; // Final padding/margin
  return estimatedHeight;
};

const estimateMilestoneGroupHeight = (milestonesInGroup: any[]) => {
  const groupHeaderDivHeight = 60; // Height of the Work Header title div
  const tableHeaderRowHeight = 40; // Height of the <thead> row
  const tableBottomMargin = 4;
  let totalRowsHeight = 0;

  milestonesInGroup.forEach(milestone => {
    totalRowsHeight += estimateMilestoneRowHeight(milestone);
  });

  return groupHeaderDivHeight + tableHeaderRowHeight + totalRowsHeight + tableBottomMargin;
};


// --- Main Component ---

const MilestoneReportPDF = ({ dailyReportDetails, projectData }: MilestoneReportPDFProps) => {
  const componentRef = useRef<HTMLDivElement>(null);
  const defaultFileName = `${projectData?.project_name || 'Project'}_${formatDate(dailyReportDetails?.report_date)}_MilestoneReport`;
  const [pdfFileName, setPdfFileName] = useState(defaultFileName);

  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
    documentTitle: pdfFileName.trim() || `Milestone_Report_${formatDate(new Date())}`,
  });

  const { data: ownerData } = useFrappeGetDoc<{ full_name: string }>('Nirmaan Users', dailyReportDetails?.owner || '');

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Completed": return "#10B981";
      case "WIP": return "#F59E0B";
      case "Not Started": return "#EF4444";
      case "N/A": return "#6B7280";
      default: return "#DC2626";
    }
  };

  // // Group milestones that have a work_plan for the Work Plan section
  // const workPlanGroupedMilestones = useMemo(() => {
  //   if (!dailyReportDetails?.milestones) return {};
  //   return dailyReportDetails.milestones.reduce((acc: any, milestone: any) => {
  //     if (milestone.work_plan && parseWorkPlan(milestone.work_plan).length > 0) {
  //       (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone)
  //     }
  //     return acc
  //   }, {})
  // }, [dailyReportDetails]);

   const workPlanGroupedMilestones = useMemo(() => {
    if (!dailyReportDetails?.milestones) return {};

    return dailyReportDetails.milestones.reduce((acc: any, milestone: any) => {
      // 1. Check if the status is WIP or Not Started
      const isRelevantStatus = milestone.status === "WIP" || milestone.status === "Not Started";
      
      // 2. Check if the milestone explicitly has work plan content
      const hasWorkPlanContent = milestone.work_plan && parseWorkPlan(milestone.work_plan).length > 0;

      // Include the milestone if it has content OR if it has a relevant status
      if (hasWorkPlanContent || isRelevantStatus) {
        (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone)
      }
      return acc
    }, {})
  }, [dailyReportDetails]);

  // Group all non-"Not Applicable" milestones for the Work Progress section
  const milestoneGroups = dailyReportDetails?.milestones
    ?.filter((milestone: any) => milestone.status !== "Not Applicable")
    ?.reduce((acc: any, milestone: any) => {
      (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
      return acc
    }, {}) || {};

  // --- Start of First Page Calculation and Work Plan Pagination ---

  const firstPageFixedHeight = useMemo(() => estimateFirstPageFixedContentHeight(dailyReportDetails), [dailyReportDetails]);


  const paginatedWorkPlanGroups = useMemo(() => {
    const groupEntries = Object.entries(workPlanGroupedMilestones);
    if (groupEntries.length === 0) return [];

    const pages: any[] = [];
    let currentPageGroups: any[] = [];
    let currentPageContentHeight = 0;

    // Available height on the first page, AFTER fixed content (Header, Project Details, Manpower)
    const AVAILABLE_HEIGHT_FIRST_PAGE = PAGE_APPROX_HEIGHT_PX - firstPageFixedHeight - WORK_PLAN_TITLE_HEIGHT_PX;

    groupEntries.forEach(([header, milestones]) => {
      const groupHeight = estimateWorkPlanGroupHeight(milestones as any[]);
      let maxPageHeight;

      // Determine max height based on if this is the start of the first page or a subsequent page
      if (pages.length === 0 && currentPageGroups.length === 0) {
        // First item on the very first page
        maxPageHeight = AVAILABLE_HEIGHT_FIRST_PAGE
      } else {
        // Item on a subsequent page or non-first item on the first page
        maxPageHeight = AVAILABLE_HEIGHT_SUBSEQUENT_WP_PAGES
      }

      if (currentPageContentHeight + groupHeight > maxPageHeight && currentPageGroups.length > 0) {
        // If the new group overflows AND the current page has content, start a new page
        pages.push(currentPageGroups);
        currentPageGroups = [{ header, milestones }];
        currentPageContentHeight = groupHeight;
      } else {
        // Otherwise, add the group to the current page
        currentPageGroups.push({ header, milestones });
        currentPageContentHeight += groupHeight;
      }
    });

    // Push the last remaining page
    if (currentPageGroups.length > 0) {
      pages.push(currentPageGroups)
    }

    return pages
  }, [workPlanGroupedMilestones, firstPageFixedHeight]);

  // --- End of First Page Calculation and Work Plan Pagination ---


  // --- Work Progress Pagination ---

  const paginatedWorkProgressGroups = useMemo(() => {
    if (!milestoneGroups || Object.keys(milestoneGroups).length === 0) return [];

    const pages: any[] = [];
    let currentPageGroups: any[] = [];
    let currentPageContentHeight = 0;
    const groupEntries = Object.entries(milestoneGroups);

    groupEntries.forEach(([header, milestones], index) => {
      const groupHeight = estimateMilestoneGroupHeight(milestones as any[]);
      const maxPageHeight = AVAILABLE_CONTENT_HEIGHT_PER_PAGE_FOR_PROGRESS_GROUPS;

      if (currentPageContentHeight + groupHeight > maxPageHeight && currentPageGroups.length > 0) {
        pages.push(currentPageGroups);
        currentPageGroups = [{ header, milestones }];
        currentPageContentHeight = groupHeight;
      } else {
        currentPageGroups.push({ header, milestones });
        currentPageContentHeight += groupHeight;
      }
    });

    if (currentPageGroups.length > 0) {
      pages.push(currentPageGroups)
    }

    return pages
  }, [milestoneGroups]);

  return (
    <>
      <button onClick={handlePrint} className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg text-lg flex items-center justify-end-safe gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Download PDF
      </button>

      {/* Hidden container for print content */}
      <div style={{ position: "absolute", top: "-9999px", left: "-9999px" }}>
        <div ref={componentRef} className="bg-white">

          {/* --- 1. FIRST PAGE: FIXED CONTENT + FIRST WORK PLAN (if space allows) --- */}
          <div className="page">
            <div className="overflow-x-auto p-4">
              <table className="min-w-full divide-gray-200">
                <ReportPageHeader projectData={projectData} dailyReportDetails={dailyReportDetails} />
                <tbody className="bg-white">
                  {/* Project Details */}
                  <tr className="border-black">
                    <td colSpan={4} className="">
                      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-md mt-4">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">Project :</span>
                          <span className="text-right">{projectData?.project_name || "--"}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">Project Manager :</span>
                          <span className="text-right">{ownerData?.full_name || dailyReportDetails?.owner || "--"}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">Start Date :</span>
                          <span className="text-right">{formatDate(projectData?.project_start_date) || "--"}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">Report Date :</span>
                          <span className="text-right">{formatDate(dailyReportDetails?.report_date) || "--"} </span>
                        </div>
                      </div>
                    </td>
                  </tr>

                  {/* Manpower Details */}
                  {dailyReportDetails.manpower && dailyReportDetails.manpower.length > 0 && (
                    <tr>
                      <td colSpan={4}>
                        <div className="my-6 ">
                          <h3 className="text-lg font-bold mb-3 text-gray-800">MANPOWER DETAILS</h3>
                          <div className="grid grid-cols-1 gap-3">
                            {dailyReportDetails.manpower.filter((mp_detail: any) => mp_detail.count > 0).map((mp_detail: any, idx: number) => (
                              <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border">
                                <span className="font-medium">{mp_detail.label}</span>
                                <span className="font-semibold"> {mp_detail.count.toString().padStart(2, '0')}</span>
                              </div>
                            ))}
                          </div>
                          {dailyReportDetails.manpower_remarks && (
                            <div className={"mt-4"}>
                              <p className="text-xs text-muted-foreground">{"Remarks"}</p>
                              <div className="mt-1 p-3 rounded-md bg-gray-50 border border-gray-200 text-gray-800 text-sm whitespace-pre-wrap break-words">
                                {dailyReportDetails.manpower_remarks}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* --- Work Plan Content for FIRST PAGE (Index 0) --- */}
                  {paginatedWorkPlanGroups.length > 0 && paginatedWorkPlanGroups[0].length > 0 && (
                    <tr>
                      <td colSpan={4}>
                        <h3 className="text-lg font-bold mb-4 text-gray-800 border-b pb-2">
                          WORK PLAN
                        </h3>
                        {paginatedWorkPlanGroups[0].map(({ header, milestones }: any, groupIdx: number) => (
                          <div key={groupIdx} className="mb-6 avoid-page-break-inside">
                            <div className="mb-3 p-3 bg-gray-100 rounded-lg border-l-4 border-blue-600">
                              <h4 className="text-md font-bold">
                                {header} - {(milestones as any[]).length.toString().padStart(2, '0')}
                              </h4>
                            </div>
                            <div className="space-y-3 pl-2">
                              {(milestones as any[]).map((milestone: any, idx: number) => (
                                <div key={idx} className="border rounded-lg p-3 bg-white shadow-sm avoid-page-break-inside">
                                  <div className="mb-2">
                                    <h5 className="font-medium text-sm text-gray-800">{milestone.work_milestone_name}</h5>
                                  </div>
                                  <div className="mt-2">
                                    <div className="p-2 bg-blue-50 border border-blue-200 rounded-md">
                                      <ul className="list-disc list-inside text-xs text-blue-800 space-y-1 ml-2">
                                        {parseWorkPlan(milestone.work_plan).map((point: string, i: number) => (
                                           <>
                              {point.trim() === "" ? (<div className="p-2 bg-red-50 border border-red-200 rounded-md text-center">
                          <span className="text-sm font-semibold text-red-700">No Activity Plan</span>
                        </div>) : (
                           <li key={i} className="break-words whitespace-pre-wrap">
                                {point}
                              </li>
                        )}
                              </>
                                        ))}
                                      </ul>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}

                </tbody>
              </table>
            </div>
          </div>


          {/* --- 2. SUBSEQUENT WORK PLAN PAGES (Index > 0) --- */}
          {/* Start from index 1 for all remaining work plan pages */}
          {paginatedWorkPlanGroups.length > 1 && paginatedWorkPlanGroups.slice(1).map((pageGroups, pageIndex) => {
            // The slice index starts at 0, but the actual page index is (original index + 1)
            const originalPageIndex = pageIndex + 1;
            return (
              <div key={`work-plan-page-${originalPageIndex}`} className="page page-break-before">
                <div className="overflow-x-auto p-4">
                  <table className="min-w-full divide-gray-200">
                    {/* Header MUST repeat on every page after the first */}
                    <ReportPageHeader projectData={projectData} dailyReportDetails={dailyReportDetails} />
                    <tbody className="bg-white">
                      <tr>
                        <td colSpan={4}>
                          <h3 className="text-lg font-bold mb-4 text-gray-800 border-b pb-2">
                            WORK PLAN (Contd.)
                          </h3>
                          {pageGroups.map(({ header, milestones }: any, groupIdx: number) => (
                            <div key={groupIdx} className="mb-6 avoid-page-break-inside">
                              <div className="mb-3 p-3 bg-gray-100 rounded-lg border-l-4 border-blue-600">
                                <h4 className="text-md font-bold">
                                  {header} - {(milestones as any[]).length.toString().padStart(2, '0')}
                                </h4>
                              </div>
                              <div className="space-y-3 pl-2">
                                {(milestones as any[]).map((milestone: any, idx: number) => (
                                  <div key={idx} className="border rounded-lg p-3 bg-white shadow-sm avoid-page-break-inside">
                                    <div className="mb-2">
                                      <h5 className="font-medium text-sm text-gray-800">{milestone.work_milestone_name}</h5>
                                    </div>
                                    <div className="mt-2">
                                      <div className="p-2 bg-blue-50 border border-blue-200 rounded-md">
                                        <ul className="list-disc list-inside text-xs text-blue-800 space-y-1 ml-2">
                                          {parseWorkPlan(milestone.work_plan).map((point: string, i: number) => (
                                           <>
                              {point.trim() === "" ? (<div className="p-2 bg-red-50 border border-red-200 rounded-md text-center">
                          <span className="text-sm font-semibold text-red-700">No Activity Plan</span>
                        </div>) : (
                           <li key={i} className="break-words whitespace-pre-wrap">
                                {point}
                              </li>
                        )}
                              </>
                                        ))}
                                        </ul>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}


          {/* --- 3. WORK PROGRESS PAGES (Paginated) --- */}
          {paginatedWorkProgressGroups.length > 0 && paginatedWorkProgressGroups.map((pageGroups, pageIndex) => (
            <div key={`work-progress-page-${pageIndex}`} className={`page page-break-before`}>
              <div className="overflow-x-auto p-4">
                <table className="min-w-full divide-gray-200">
                  <ReportPageHeader projectData={projectData} dailyReportDetails={dailyReportDetails} />
                  <tbody className="bg-white">
                    <tr>
                      <td colSpan={4}>
                        <h3 className="text-lg font-bold mb-3 text-gray-800">
                          WORK PROGRESS {pageIndex > 0 ? "(Contd.)" : ""}
                        </h3>
                        {pageGroups.map(({ header, milestones }: any, groupIdx: number) => (
                          <div key={groupIdx} className="mb-6 avoid-page-break-inside">
                            {/* Group Header */}
                            <div className="mb-4 p-3 bg-gray-100 rounded-lg border-l-4 border-red-600">
                              <h4 className="text-md font-bold">{header} ({(milestones as any[]).length})</h4>
                            </div>
                            {/* Milestone Progress Table */}
                            <table className="w-full border-collapse mb-6">
                              <thead>
                                <tr className="bg-gray-100">
                                  <th className="border p-2 text-center w-[45%] font-semibold">WORK</th>
                                  <th className="border p-2 text-center w-[15%] font-semibold">STATUS</th>
                                  <th className="border p-2 text-center w-[20%] font-semibold">PROGRESS</th>
                                  <th className="border p-2 text-center w-[20%] font-semibold">Excepted Starting/completion Date</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(milestones as any[]).map((milestone: any, idx: number) => (
                                  <tr key={idx} className="">
                                    {/* Work Name & Remarks */}
                                    <td className="border item-center text-center p-2 align-center">
                                      {milestone.work_milestone_name}
                                      {milestone.remarks && (
                                        <p className="flex items-start p-1 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs mt-1">
                                          <MessagesSquare className="h-4 w-4 flex-shrink-0 mr-1 mt-0.5" />
                                          <span className="flex-grow text-left">
                                            {milestone.remarks}
                                          </span>
                                        </p>
                                      )}
                                    </td>
                                    {/* Status Badge */}
                                    <td className="border p-2 text-center">
                                      <span className="px-2 py-1 rounded text-xs font-medium inline-block"
                                        style={{ backgroundColor: `${getStatusColor(milestone.status)}20`, color: getStatusColor(milestone.status) }}>
                                        {milestone.status}
                                      </span>
                                    </td>
                                    {/* Progress Circle */}
                                    <td className="border p-2 text-center">
                                      <MilestoneProgress
                                        milestoneStatus={milestone.status}
                                        value={milestone.progress}
                                        sizeClassName="size-[60px]"
                                        textSizeClassName="text-md"
                                      />
                                    </td>
                                    {/* Expected Date */}
                                    <td className="border p-2 text-center">
                                      {milestone.status === "Not Started" ? (
                                        <span className="text-red-600 font-medium">
                                          {milestone.expected_starting_date ? formatDate(milestone.expected_starting_date) : 'N/A'}
                                        </span>
                                      ) : (
                                        <span className="text-green-500 font-medium">
                                          {milestone.expected_completion_date ? formatDate(milestone.expected_completion_date) : 'N/A'}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* --- 4. ATTACHMENTS PAGE (Optional) --- */}
          {dailyReportDetails.attachments && dailyReportDetails.attachments.length > 0 && (
            <div className="page page-break-before">
              <div className="overflow-x-auto p-4">
                <table className="min-w-full divide-gray-200">
                  <ReportPageHeader projectData={projectData} dailyReportDetails={dailyReportDetails} />
                  <tbody className="bg-white">
                    <tr>
                      <td colSpan={4}>
                        <h3 className="text-lg font-bold mb-3 text-gray-800">WORK IMAGES</h3>
                        <div className="grid grid-cols-2 gap-4">
                          {dailyReportDetails.attachments.map((attachment: any, idx: number) => (
                            <div key={idx} className="rounded-lg overflow-hidden shadow-md bg-white border border-gray-200">
                              <div className="flex flex-col sm:flex-row h-full">
                                <div className="w-full sm:w-1/2 flex-shrink-0">
                                  {/* Placeholder for the image */}
                                  <img src={attachment.image_link} alt={`Work Image ${idx + 1}`} className="w-full h-[180px] sm:h-full object-cover rounded-t-lg sm:rounded-l-lg sm:rounded-tr-none" />
                                </div>
                                <div className="w-full sm:w-1/2 p-3 flex flex-col justify-between">
                                  {/* Location */}
                                  <div className="flex items-center text-xs text-gray-700 mb-2">
                                    <MapPin className="h-4 w-4 mr-1 text-red-500 flex-shrink-0" />
                                    <span className="font-medium break-words">
                                      {attachment.location || `Lat: ${attachment.latitude?.toFixed(2)}, Lon: ${attachment.longitude?.toFixed(2)}`}
                                    </span>
                                  </div>
                                  {/* Remarks */}
                                  <p className="p-2 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs mt-auto">
                                    <MessagesSquare className="h-4 w-4 inline-block mr-1 flex-shrink-0" />
                                    {attachment.remarks || "No remarks provided."}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Global Print Styles (Crucial for Pagination) */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin:0;
            padding:0.5cm;
          }
          
          .page {
            /* Apply the desired margin as padding on the content container */
            padding: 0.5cm; 
            
            /* Ensure the padding doesn't cause overflow on a div with fixed height */
            box-sizing: border-box; 
            
            page-break-after: always;
          }
          
          .page:last-child {
            page-break-after: auto;
          }
          
          .page-break-before {
            page-break-before: always;
          }
          
          /* Ensure consistent table formatting */
          table {
            table-layout: fixed;
            width: 100%;
            border-collapse: collapse;
          }
          
          th, td {
            word-wrap: break-word;
            overflow-wrap: break-word;
          }
          
          /* Header styling for every page where a new table section starts */
          thead {
            display: table-header-group !important;
          }

          /* Prevent work group (header + table) from splitting across pages */
          .avoid-page-break-inside {
            page-break-inside: avoid !important;
          }
          
          /* Also try to avoid breaking individual table rows */
          table tr {
            page-break-inside: avoid !important;
          }

          /* Ensure h3 and h4 headings stay with their content */
          h3, h4 {
            page-break-after: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </>
  );
};

export default MilestoneReportPDF;



// import React, { useRef, useMemo ,useState} from 'react';
// import { useReactToPrint } from 'react-to-print';
// import { formatDate } from '@/utils/FormatDate';
// import { MapPin, MessagesSquare } from 'lucide-react';
// import logo from "@/assets/logo-svg.svg";
// import { ProgressCircle } from '@/components/ui/ProgressCircle';
// import { MilestoneProgress } from '../MilestonesSummary';
// import {useFrappeGetDoc} from 'frappe-react-sdk';
// import { DELIMITER,parseWorkPlan,serializeWorkPlan} from '../MilestoneTab';

// interface MilestoneReportPDFProps {
//   dailyReportDetails: any;
//   projectData: any;
// }

// // Header Component for reuse across pages that contain tables
// // This header is designed to repeat on each new table section
// const ReportPageHeader = ({ projectData, dailyReportDetails }) => (
//   <thead className="border-b border-black">
//     <tr>
//       <th colSpan={4}> {/* This colSpan should match the max columns in your actual data tables */}
//         <div className="flex text-left justify-between border-gray-600 pb-1">
//           <div className="mt-2 flex justify-start">
//             <div>
//               <img
//                 src={logo}
//                 alt="Nirmaan"
//                 width="180"
//                 height="52"
//               />
//               <div className="pt-2 text-lg font-semibold">
//                 Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
//               </div>
//               <div className="text-sm text-gray-500 mt-0.5">
//                 First floor, 234, 9th Main, 16th Cross Rd, Sector 6, HSR Layout, Bengaluru, Karnataka 560102
//               </div>
//             </div>
//           </div>
//           {/* Right side, currently empty, but could add report number etc. */}
//         </div>
//       </th>
//     </tr>
//   </thead>
// );

// // Helper function to estimate work plan card height
// const estimateWorkPlanCardHeight = (milestone) => {
//   const baseCardHeight = 60; // Base height for card structure (padding, borders, title)
//   const workPlanPoints = parseWorkPlan(milestone.work_plan);
  
//   // Estimate height per work plan point
//   const charsPerLine = 80; // Characters per line in the work plan list
//   const lineHeight = 16; // Approximate line height for text-xs
  
//   let totalHeight = baseCardHeight;
  
//   workPlanPoints.forEach(point => {
//     const lines = Math.ceil(point.length / charsPerLine);
//     totalHeight += (lines * lineHeight) + 4; // 4px for list item spacing
//   });
  
//   return totalHeight + 20; // Add buffer for margins
// };

// // Helper function to estimate work plan group height
// const estimateWorkPlanGroupHeight = (milestones) => {
//   const groupHeaderHeight = 50; // Height for the group header
//   const groupPadding = 30; // Padding and margins
  
//   let cardsHeight = 0;
//   milestones.forEach(milestone => {
//     cardsHeight += estimateWorkPlanCardHeight(milestone);
//   });
  
//   return groupHeaderHeight + cardsHeight + groupPadding;
// };


// // Helper function to estimate height of a single milestone row
// const estimateMilestoneRowHeight = (milestone) => {
//   const baseHeight = 40; // Base height for a simple row (for work_milestone_name and basic row padding)
//   let estimatedHeight = baseHeight;

//   // 1. Estimate height based on work_milestone_name length
//   const nameCharsPerLine = 30; // Approx characters per line for the work_milestone_name
//   const nameLineHeight = 16; // Approx line-height for work_milestone_name text
//   const nameLines = Math.ceil((milestone.work_milestone_name?.length || 0) / nameCharsPerLine);
//   if (nameLines > 1) {
//     estimatedHeight += (nameLines - 1) * nameLineHeight;
//   }

//   // 2. NEW: Estimate height based on remarks length, if present
//   if (milestone.remarks) {
//     const remarksCharsPerLine = 35; // Approx characters per line for the remarks text (may differ due to smaller font)
//     const remarksLineHeight = 14; // Approx line-height for text-xs in remarks
//     const remarksPaddingHeight = 10; // Estimated vertical padding/margin for the yellow remarks box (p-1, etc.)

//     const remarksLines = Math.ceil((milestone.remarks.length || 0) / remarksCharsPerLine);
//     const actualRemarksLines = Math.max(1, remarksLines); // Ensure at least 1 line for the box itself, even if remarks are short
//     estimatedHeight += (actualRemarksLines * remarksLineHeight) + remarksPaddingHeight;
//   }

//   // Add some extra buffer if needed to be safe, especially if there are icons or other elements
//   estimatedHeight += 5; // Small buffer

//   return estimatedHeight;
// };
// // Helper function to estimate height of an entire milestone group (header + table)
// const estimateMilestoneGroupHeight = (milestonesInGroup) => {
//   const groupHeaderDivHeight = 60;
//   const tableHeaderRowHeight = 40;
//   const tableBottomMargin = 4;
//   let totalRowsHeight = 0;
//   milestonesInGroup.forEach(milestone => {
//     totalRowsHeight += estimateMilestoneRowHeight(milestone);
//   });

//   return groupHeaderDivHeight + tableHeaderRowHeight + totalRowsHeight + tableBottomMargin;
// };

// const MilestoneReportPDF = ({ dailyReportDetails, projectData }: MilestoneReportPDFProps) => {
//   const componentRef = useRef<HTMLDivElement>(null);
 
//    // --- NEW STATE for PDF file name ---
//   const defaultFileName = `${projectData?.project_name || 'Project'}_${formatDate(dailyReportDetails?.report_date)}_MilestoneReport`;
//   const [pdfFileName, setPdfFileName] = useState(defaultFileName);
//   // --- END NEW STATE ---

//   const handlePrint = useReactToPrint({
//     content: () => componentRef.current,
//     // --- UPDATED: Use the state variable for document title ---
//     documentTitle: pdfFileName.trim() || `Milestone_Report_${formatDate(new Date())}`,
//     // --- END UPDATED ---
//   });
 

//   // const handlePrint = useReactToPrint({
//   //   content: () => componentRef.current,
//   //   documentTitle: `Milestone Report - ${formatDate(new Date())}`,
//   // });
 
//   const {data:ownerData}= useFrappeGetDoc<{full_name:string}>('Nirmaan Users',dailyReportDetails?.owner || '')
  
//   // Calculate metrics
//   const totalWorkHeaders = dailyReportDetails?.milestones?.length || 0;
//   const completedWorksOnReport = dailyReportDetails?.milestones?.filter(m => m.status === "Completed").length || 0;
//   const totalManpowerInReport = dailyReportDetails?.manpower?.reduce((sum, mp) => sum + Number(mp.count || 0), 0) || 0;

//   // Function to get status color for PDF
//   const getStatusColor = (status: string) => {
//     switch (status) {
//       case "Completed": return "#10B981"; // Green
//       case "WIP": return "#F59E0B"; // Yellow
//       case "Not Started": return "#EF4444"; // Red
//       case "N/A": return "#6B7280"; // Gray
//       default: return "#DC2626"; // Red
//     }
//   };

//   // Group milestones by work header
//   // const milestoneGroups = dailyReportDetails?.milestones?.reduce((acc, milestone) => {
//   //   (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
//   //   return acc;
//   // }, {});
//   // Group milestones by work header
//     // Filter and group work plan milestones
//   const workPlanGroupedMilestones = useMemo(() => {
//     if (!dailyReportDetails?.milestones) return {};
    
//     return dailyReportDetails.milestones.reduce((acc, milestone) => {
//       if (milestone.work_plan && parseWorkPlan(milestone.work_plan).length > 0) {
//         (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
//       }
//       return acc;
//     }, {});
//   }, [dailyReportDetails]);



//   const milestoneGroups = dailyReportDetails?.milestones
//     // --- ADDED: Filter out "Not Applicable" milestones ---
//     ?.filter(milestone => milestone.status !== "Not Applicable")
//     // ----------------------------------------------------
//     ?.reduce((acc, milestone) => {
//       (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
//       return acc;
//     }, {});
//   // Address mapping (kept for context, but not directly used in the repeating page header)
//   const gstAddressMap = {
//     "29ABFCS9095N1Z9": "1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka",
//     "06ABFCS9095N1ZH": "7th Floor, MR1, ALTF Global Business Park Cowarking Space, Mehrauli Gurugram Rd, Tower D, Sikanderpur, Gurugram - 122002, Haryana",
//     "09ABFCS9095N1ZB": "MR1, Plot no. 21 & 21A, AltF 142 Noida, Sector 142, Noida - 201305, Uttar Pradesh"
//   };

//   // --- Smart Pagination Logic for WORK PROGRESS ---
//   // These constants are APPROXIMATE and need to be TWEAKED based on your actual print output.
//   const PAGE_APPROX_HEIGHT_PX = 950; // Roughly an A4 page height minus standard margins
//   const PAGE_HEADER_TABLE_HEIGHT_PX = 150; // Approx height of the ReportPageHeader with logo/address
//   const WORK_PROGRESS_SECTION_TITLE_HEIGHT_PX = 50; // Approx height for "WORK PROGRESS" H3 title

//   // Available height for work groups on a page
//   const AVAILABLE_CONTENT_HEIGHT_PER_PAGE_FOR_GROUPS = PAGE_APPROX_HEIGHT_PX - PAGE_HEADER_TABLE_HEIGHT_PX - WORK_PROGRESS_SECTION_TITLE_HEIGHT_PX;

//    // Paginate Work Plan
//   const paginatedWorkPlanGroups = useMemo(() => {
//     const groupEntries = Object.entries(workPlanGroupedMilestones);
//     if (groupEntries.length === 0) return [];

//     const pages = [];
//     let currentPageGroups = [];
//     let currentPageContentHeight = 0;

//     groupEntries.forEach(([header, milestones]) => {
//       const groupHeight = estimateWorkPlanGroupHeight(milestones as any[]);

//       if (currentPageContentHeight + groupHeight > AVAILABLE_CONTENT_HEIGHT_PER_PAGE_FOR_GROUPS && currentPageGroups.length > 0) {
//         pages.push(currentPageGroups);
//         currentPageGroups = [{ header, milestones }];
//         currentPageContentHeight = groupHeight;
//       } else {
//         currentPageGroups.push({ header, milestones });
//         currentPageContentHeight += groupHeight;
//       }
//     });

//     if (currentPageGroups.length > 0) {
//       pages.push(currentPageGroups);
//     }
    
//     return pages;
//   }, [workPlanGroupedMilestones]);


//   const paginatedWorkProgressGroups = useMemo(() => {
//     if (!milestoneGroups || Object.keys(milestoneGroups).length === 0) return [];

//     const pages = [];
//     let currentPageGroups = [];
//     let currentPageContentHeight = 0; // Tracks height of groups added to current page

//     const groupEntries = Object.entries(milestoneGroups);

//     groupEntries.forEach(([header, milestones], index) => {
//       const groupHeight = estimateMilestoneGroupHeight(milestones as any[]);

//       // If adding this group would exceed available height on current page,
//       // AND we already have groups on this page, then start a new page.
//       if (currentPageContentHeight + groupHeight > AVAILABLE_CONTENT_HEIGHT_PER_PAGE_FOR_GROUPS && currentPageGroups.length > 0) {
//         pages.push(currentPageGroups); // Finalize current page
//         currentPageGroups = [{ header, milestones }]; // Start new page with current group
//         currentPageContentHeight = groupHeight; // Reset height for new page
//       } else {
//         currentPageGroups.push({ header, milestones }); // Add to current page
//         currentPageContentHeight += groupHeight;
//       }
//     });

//     // Add the last page if it has content
//     if (currentPageGroups.length > 0) {
//       pages.push(currentPageGroups);
//     }
//     return pages;
//   }, [milestoneGroups]);


//   return (
//     <>

//       <button
//         onClick={handlePrint}
//         className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg text-lg flex items-center justify-end-safe gap-2"
//       >
//         <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
//           <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
//         </svg>
//         Download PDF
//       </button>



//       {/* Hidden component for PDF generation */}
// <div style={{ position: "absolute", top: "-9999px", left: "-9999px" }}>
//         <div ref={componentRef} className="bg-white">
//           {/* First Page: Summary and Manpower */}
//           <div className="page">
//             <div className="overflow-x-auto p-4">
//               <table className="min-w-full divide-gray-200">
//                 <ReportPageHeader projectData={projectData} dailyReportDetails={dailyReportDetails} />
//                 <tbody className="bg-white">
//                   {/* Project Details (only on first page, as per your current design) */}
//                   <tr className="border-black">
//                     <td colSpan={4} className="">
//                       <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-md mt-4">
//                         <div className="flex justify-between items-center">
//                           <span className="font-semibold">Project :</span>
//                           <span className="text-right">{projectData?.project_name || "--"}</span>
//                         </div>
//                         <div className="flex justify-between items-center">
//                           <span className="font-semibold">Project Manager :</span>
//                           <span className="text-right">{ownerData?.full_name||dailyReportDetails?.owner || "--"}</span>
//                         </div>
//                         <div className="flex justify-between items-center">
//                           <span className="font-semibold">Start Date :</span>
//                           <span className="text-right">{formatDate(projectData?.project_start_date) || "--"}</span>
//                         </div>
//                         <div className="flex justify-between items-center">
//                           <span className="font-semibold">Report Date :</span>
//                           <span className="text-right">{formatDate(dailyReportDetails?.report_date) || "--"} </span>
//                         </div>
//                       </div>
//                     </td>
//                   </tr>

//                   {/* Summary Metrics */}
//                   {/* <tr>
//                     <td colSpan={4}>
//                       <div className="mb-6 p-4 bg-red-50 rounded-lg border border-red-100 mt-4">
//                         <h3 className="text-lg font-bold mb-3 text-red-800">REPORT SUMMARY</h3>
//                         <div className="grid grid-cols-3 gap-4">
//                           <div className="text-center p-3 bg-white rounded-lg shadow-sm border">
//                             <p className="text-sm text-gray-600">TOTAL WORKS</p>
//                             <p className="text-2xl font-bold text-red-700">{totalWorkHeaders.toString().padStart(2, '0')}</p>
//                           </div>
//                           <div className="text-center p-3 bg-white rounded-lg shadow-sm border">
//                             <p className="text-sm text-gray-600">COMPLETED</p>
//                             <p className="text-2xl font-bold text-green-600">{completedWorksOnReport.toString().padStart(2, '0')}</p>
//                           </div>
//                           <div className="text-center p-3 bg-white rounded-lg shadow-sm border">
//                             <p className="text-sm text-gray-600">MANPOWER</p>
//                             <p className="text-2xl font-bold text-red-700">{totalManpowerInReport.toString().padStart(2, '0')}</p>
//                           </div>
//                         </div>
//                       </div>
//                     </td>
//                   </tr> */}

//                   {/* Manpower Section */}
//                   {dailyReportDetails.manpower && dailyReportDetails.manpower.length > 0 && (
//                     <tr>
//                       <td colSpan={4}>
//                         <div className="my-6 ">
//                           <h3 className="text-lg font-bold mb-3 text-gray-800">MANPOWER DETAILS</h3>
//                           <div className="grid grid-cols-1 gap-3">
//                             {dailyReportDetails.manpower
//                               // 1. Filter the array to only include items where 'count' is greater than 0
//                               .filter(mp_detail => mp_detail.count > 0)
//                               // 2. Map over the filtered array
//                               .map((mp_detail, idx) => (
//                                 <div
//                                   key={idx}
//                                   className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border"
//                                 >
//                                   <span className="font-medium">{mp_detail.label}</span>
//                                   {/* 
//         3. Display the count, padded with '0' if it's a single digit.
//            Since we've filtered, we know mp_detail.count is > 0.
//       */}
//                                   <span className="font-semibold">
//                                     {mp_detail.count.toString().padStart(2, '0')}
//                                   </span>
//                                 </div>
//                               ))}
//                           </div>

//                           {dailyReportDetails.manpower_remarks && (

//                             <div className={"mt-4"}>
//                               <p className="text-xs text-muted-foreground">{"Remarks"}</p>

//                               <div className="mt-1 p-3 rounded-md bg-gray-50 border border-gray-200 text-gray-800 text-sm whitespace-pre-wrap break-words">
//                                 {dailyReportDetails.manpower_remarks}
//                               </div>
//                             </div>
//                           )}
//                         </div>
//                       </td>
//                     </tr>
//                   )}
//                 </tbody>
//               </table>
//             </div>
//           </div>
//  {/* Work Plan Section - Starts on first page if space, otherwise new page */}
//           {paginatedWorkPlanGroups.length > 0 && paginatedWorkPlanGroups.map((pageGroups, pageIndex) => {
//             // First page of work plan: try to fit on same page as manpower (no page-break-before)
//             // Subsequent pages: always start on new page
//             const needsPageBreak = pageIndex > 0;
            
//             return pageIndex === 0 ? (
//               // First work plan page - try to continue on same page as manpower
//               <div key={`work-plan-page-${pageIndex}`}>
//                 <div className="overflow-x-auto p-4">
//                   <table className="min-w-full divide-gray-200">
//                     {/* Only show header on first page if it's actually a new page */}
//                     {dailyReportDetails.manpower?.length && (
//                       <ReportPageHeader projectData={projectData} dailyReportDetails={dailyReportDetails} />
//                     )}
//                     <tbody className="bg-white">
//                       <tr>
//                         <td colSpan={4}>
//                           <h3 className="text-lg font-bold mb-4 text-gray-800 border-b pb-2">
//                             WORK PLAN1
//                           </h3>
//                           {pageGroups.map(({ header, milestones }, groupIdx) => (
//                             <div key={groupIdx} className="mb-6 avoid-page-break-inside">
//                               <div className="mb-3 p-3 bg-gray-100 rounded-lg border-l-4 border-blue-600">
//                                 <h4 className="text-md font-bold">
//                                   {header} - {(milestones as any[]).length.toString().padStart(2, '0')}
//                                 </h4>
//                               </div>
//                               <div className="space-y-3 pl-2">
//                                 {(milestones as any[]).map((milestone, idx) => (
//                                   <div key={idx} className="border rounded-lg p-3 bg-white shadow-sm avoid-page-break-inside">
//                                     <div className="mb-2">
//                                       <h5 className="font-medium text-sm text-gray-800">{milestone.work_milestone_name}</h5>
//                                     </div>
//                                     <div className="mt-2">
//                                       <div className="p-2 bg-blue-50 border border-blue-200 rounded-md">
//                                         <ul className="list-disc list-inside text-xs text-blue-800 space-y-1 ml-2">
//                                           {parseWorkPlan(milestone.work_plan).map((point, i) => (
//                                             <li key={i} className="break-words whitespace-pre-wrap">{point}</li>
//                                           ))}
//                                         </ul>
//                                       </div>
//                                     </div>
//                                   </div>
//                                 ))}
//                               </div>
//                             </div>
//                           ))}
//                         </td>
//                       </tr>
//                     </tbody>
//                   </table>
//                 </div>
//               </div>
//             ) : (
//               // Subsequent work plan pages - always start on new page with header
//               <div key={`work-plan-page-${pageIndex}`} className="page page-break-before">
//                 <div className="overflow-x-auto p-4">
//                   <table className="min-w-full divide-gray-200">
//                     <ReportPageHeader projectData={projectData} dailyReportDetails={dailyReportDetails} />
//                     <tbody className="bg-white">
//                       <tr>
//                         <td colSpan={4}>
//                           <h3 className="text-lg font-bold mb-4 text-gray-800 border-b pb-2">
//                             WORK PLAN (Contd.)
//                           </h3>

//                           {pageGroups.map(({ header, milestones }, groupIdx) => (
//                             <div key={groupIdx} className="mb-6 avoid-page-break-inside">
//                               <div className="mb-3 p-3 bg-gray-100 rounded-lg border-l-4 border-blue-600">
//                                 <h4 className="text-md font-bold">
//                                   {header} - {(milestones as any[]).length.toString().padStart(2, '0')}
//                                 </h4>
//                               </div>
//                               <div className="space-y-3 pl-2">
//                                 {(milestones as any[]).map((milestone, idx) => (
//                                   <div key={idx} className="border rounded-lg p-3 bg-white shadow-sm avoid-page-break-inside">
//                                     <div className="mb-2">
//                                       <h5 className="font-medium text-sm text-gray-800">{milestone.work_milestone_name}</h5>
//                                     </div>
//                                     <div className="mt-2">
//                                       <div className="p-2 bg-blue-50 border border-blue-200 rounded-md">
//                                         <ul className="list-disc list-inside text-xs text-blue-800 space-y-1 ml-2">
//                                           {parseWorkPlan(milestone.work_plan).map((point, i) => (
//                                             <li key={i} className="break-words whitespace-pre-wrap">{point}</li>
//                                           ))}
//                                         </ul>
//                                       </div>
//                                     </div>
//                                   </div>
//                                 ))}
//                               </div>
//                             </div>
//                           ))}
//                         </td>
//                       </tr>
//                     </tbody>
//                   </table>
//                 </div>
//               </div>
//             );
//           })}

//           {/* WORK PROGRESS Section - Now paginated */}
//           {paginatedWorkProgressGroups.length > 0 && paginatedWorkProgressGroups.map((pageGroups, pageIndex) => (
//             <div key={`work-progress-page-${pageIndex}`} className={`page ${pageIndex > 0 ? "page-break-before" : ""}`}>
//               <div className="overflow-x-auto p-4">
//                 <table className="min-w-full divide-gray-200">
//                   <ReportPageHeader projectData={projectData} dailyReportDetails={dailyReportDetails} />
//                   <tbody className="bg-white">
//                     <tr>
//                       <td colSpan={4}>
//                         <h3 className="text-lg font-bold mb-3 text-gray-800">
//                           WORK PROGRESS {pageIndex > 0 ? "(Contd.)" : ""}
//                         </h3>

//                         {pageGroups.map(({ header, milestones }, groupIdx) => (
//                           <div key={groupIdx} className="mb-6 avoid-page-break-inside"> {/* Keep group header + table together */}
//                             {/* Milestone Header */}
//                             <div className="mb-4 p-3 bg-gray-100 rounded-lg border-l-4 border-red-600">
//                               <h4 className="text-md font-bold">{header} ({(milestones as any[]).length})</h4>
//                             </div>

//                             {/* Milestone Table */}
//                             <table className="w-full border-collapse mb-6">
//                               <thead>
//                                 <tr className="bg-gray-100">
//                                   <th className="border p-2 text-center w-[45%] font-semibold">WORK</th>
//                                   <th className="border p-2 text-center w-[15%] font-semibold">STATUS</th>
//                                   <th className="border p-2 text-center w-[20%] font-semibold">PROGRESS</th>
//                                   <th className="border p-2 text-center w-[20%] font-semibold">Excepted Starting/completion Date</th>
//                                 </tr>
//                               </thead>
//                               <tbody>
//                                 {(milestones as any[]).map((milestone, idx) => (
//                                   <tr key={idx} className=""> {/* Ensure rows don't break */}
//                                     <td className="border item-center text-center p-2 align-center">
//                                       {milestone.work_milestone_name}
//                                       {milestone.remarks && (
//                                         <p className="flex items-center p-1 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs">
//                                           {/* Icon: Added classes to control size and ensure it's vertically centered */}
//                                           <MessagesSquare className="h-4 w-4 flex-shrink-0" />

//                                           {/* Remarks text */}
//                                           <span className="flex-grow" >
//                                             {milestone.remarks}
//                                           </span>
//                                         </p>
//                                       )}

//                                     </td>
//                                     <td className="border p-2 text-center">
//                                       <span
//                                         className="px-2 py-1 rounded text-xs font-medium inline-block"
//                                         style={{
//                                           backgroundColor: `${getStatusColor(milestone.status)}20`,
//                                           color: getStatusColor(milestone.status)
//                                         }}
//                                       >
//                                         {milestone.status}
//                                       </span>
//                                     </td>
//                                     <td className="border p-2 text-center">
//                                       {/* {milestone.status !== "Not Applicable" ? (
//                                         <div className="flex flex-col items-center">
//                                           <span className="text-sm font-semibold mb-1">{milestone.progress}%</span>
//                                           <div className="w-full max-w-[120px] h-2 bg-gray-200 rounded-full overflow-hidden">
//                                             <div
//                                               className="h-full bg-blue-500 rounded-full"
//                                               style={{ width: `${milestone.progress}%` }}
//                                             ></div>
//                                           </div>
//                                         </div>
//                                       ) : (
//                                         <span className="text-sm font-semibold mb-1">{"N/A"}</span>
//                                       )} */}
//                                          <MilestoneProgress
//                                                                                     // 1. Pass the status for the N/A check
//                                                                                     milestoneStatus={milestone.status}
                                        
//                                                                                     // 2. Pass the progress value for the circle and color logic
//                                                                                     value={milestone.progress}
                                        
//                                                                                     // 3. Set the desired size and text size
//                                                                                     sizeClassName="size-[60px]"
//                                                                                     textSizeClassName="text-md"
//                                                                                   />
//                                       {/* <div className="flex flex-col items-center">
//                                         <span className="mb-1 font-medium">{milestone.progress}%</span>
//                                         <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
//                                           <div 
//                                             className="h-full bg-red-500 rounded-full" 
//                                             style={{ width: `${milestone.progress}%` }}
//                                           ></div>
//                                         </div>
//                                       </div> */}
//                                     </td>
//                                     <td className="border p-2 text-center">
//                                       {milestone.status === "Not Started" ? (
//                                         <span className="text-red-600 font-medium">
//                                           {milestone.expected_starting_date ? formatDate(milestone.expected_starting_date) : 'N/A'}
//                                         </span>
//                                       ) : (
//                                         <span className="text-green-500 font-medium">
//                                           {milestone.expected_completion_date ? formatDate(milestone.expected_completion_date) : 'N/A'}
//                                         </span>

//                                       )}
//                                     </td>
//                                   </tr>
//                                 ))}


//                               </tbody>
//                             </table>
//                           </div>
//                         ))}
//                       </td>
//                     </tr>
//                   </tbody>
//                 </table>
//               </div>
//             </div>
//           ))}

//           {/* Work Images Section - Starts on new page */}
//           {/* {dailyReportDetails.attachments && dailyReportDetails.attachments.length > 0 && (
//             <div className="page page-break-before">
//               <div className="overflow-x-auto p-4">
//                 <table className="min-w-full divide-gray-200">
//                   <ReportPageHeader projectData={projectData} dailyReportDetails={dailyReportDetails} />
//                   <tbody className="bg-white">
//                     <tr>
//                       <td colSpan={4}>
//                         <h3 className="text-lg font-bold mb-3 text-gray-800">WORK IMAGES</h3>
//                         <div className="grid grid-cols-2 gap-4">
//                           {dailyReportDetails.attachments.map((attachment, idx) => (
//                             <div key={idx} className="border rounded-lg overflow-hidden shadow-sm">
//                               <img
//                                 src={attachment.image_link}
//                                 alt={`Work Image ${idx + 1}`}
//                                 className="w-full h-48 object-cover"
//                               />
//                               <div className="p-2 bg-gray-50">
//                                 <div className="flex items-center text-xs text-gray-600 mb-1">
//                                   <MapPin className="h-3 w-3 mr-1 text-red-500" />
//                                   <span className="font-medium truncate">
//                                     {attachment.location || `Lat: ${attachment.latitude?.toFixed(2)}, Lon: ${attachment.longitude?.toFixed(2)}`}
//                                   </span>
//                                 </div>
//                                 <p className="text-xs text-gray-500">
//                                   {attachment.remarks || "No remarks provided."}
//                                 </p>
//                               </div>
//                             </div>
//                           ))}
//                         </div>
//                       </td>
//                     </tr>
//                   </tbody>
//                 </table>
//               </div>
//             </div>
//           )} */}
//           {dailyReportDetails.attachments && dailyReportDetails.attachments.length > 0 && (
//             <div className="page page-break-before">
//               <div className="overflow-x-auto p-4">
//                 <table className="min-w-full divide-gray-200">
//                   <ReportPageHeader projectData={projectData} dailyReportDetails={dailyReportDetails} />
//                   <tbody className="bg-white">
//                     <tr>
//                       <td colSpan={4}>
//                         <h3 className="text-lg font-bold mb-3 text-gray-800">WORK IMAGES</h3>
//                          <div className="grid grid-cols-2 gap-4">
//                               {dailyReportDetails.attachments.map((attachment, idx) => (
//                                                  <div
//                                                    key={idx}
//                                                    className="rounded-lg overflow-hidden shadow-md bg-white border border-gray-200" // Card wrapper
//                                                  >
//                                                    {/* Responsive container for image and text details */}
//                                                    {/* Stacks on mobile (flex-col), becomes row on small screens and up (sm:flex-row) */}
//                                                    <div className="flex flex-col sm:flex-row h-full">
//                                                      {/* Image container */}
//                                                      <div className="w-full sm:w-1/2 flex-shrink-0">
//                                                        <img
//                                                          src={attachment.image_link}
//                                                          alt={`Work Image ${idx + 1}`}
//                                                          className="w-full h-[180px] sm:h-full object-cover rounded-t-lg sm:rounded-l-lg sm:rounded-tr-none" // Adjust rounding based on layout
//                                                        />
//                                                      </div>
                       
//                                                      <div className="w-full sm:w-1/2 p-3 flex flex-col justify-between">
//                                                        {/* Location */}
//                                                        <div className="flex items-center text-xs text-gray-700 mb-2">
//                                                          <MapPin className="h-4 w-4 mr-1 text-red-500 flex-shrink-0" />
//                                                          <span className="font-medium break-words">
//                                                            {attachment.location || `Lat: ${attachment.latitude?.toFixed(2)}, Lon: ${attachment.longitude?.toFixed(2)}`}
//                                                          </span>
//                                                        </div>
//                                                        {/* Remarks - highlighted yellow card style, pushed to bottom if space */}
//                                                        <p className="p-2 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs mt-auto">
//                                                          <MessagesSquare className="h-4 w-4 inline-block mr-1 flex-shrink-0" />
//                                                          {attachment.remarks || "No remarks provided."}
//                                                        </p>
//                                                      </div>
//                                                    </div>
//                                                  </div>
//                                                ))}
//                                              </div>
//                       </td>
//                     </tr>
//                   </tbody>
//                 </table>
//               </div>
//             </div>
//           )}

//         </div>
//       </div>

//       {/* Print-specific styles */}
//       <style jsx global>{`
//         @media print {
//           @page {
//             size: A4;
//             margin:0;
//             padding:0.5cm;
//           }
          
//           .page {
//             /* Apply the desired margin as padding on the content container */
//             padding: 0.5cm; 
            
//             /* Ensure the padding doesn't cause overflow on a div with fixed height */
//             box-sizing: border-box; 
            
//             page-break-after: always;
//           }
          
//           .page:last-child {
//             page-break-after: auto;
//           }
          
//           .page-break-before {
//             page-break-before: always;
//           }
          
//           /* Ensure consistent table formatting */
//           table {
//             table-layout: fixed;
//             width: 100%;
//             border-collapse: collapse;
//           }
          
//           th, td {
//             word-wrap: break-word;
//             overflow-wrap: break-word;
//           }
          
//           /* Header styling for every page where a new table section starts */
//           thead {
//             display: table-header-group !important;
//           }

//           /* Prevent work group (header + table) from splitting across pages */
//           .avoid-page-break-inside {
//             page-break-inside: avoid !important;
//           }
          
//           /* Also try to avoid breaking individual table rows */
//           table tr {
//             page-break-inside: avoid !important;
//           }

//           /* Ensure h3 and h4 headings stay with their content */
//           h3, h4 {
//             page-break-after: avoid;
//             page-break-inside: avoid;
//           }
//         }
//       `}</style>
//     </>
//   );
// };

// export default MilestoneReportPDF;








