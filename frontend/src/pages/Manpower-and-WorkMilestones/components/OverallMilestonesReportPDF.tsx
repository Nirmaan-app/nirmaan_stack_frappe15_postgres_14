// import React, { useMemo, useRef } from 'react';
// import { useReactToPrint } from 'react-to-print';
// import { formatDate } from '@/utils/FormatDate';
// import { Badge } from '@/components/ui/badge';
// import { Button } from '@/components/ui/button';
// import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
// import { Download } from 'lucide-react';
// import { ChevronDown, ChevronUp, AlertCircle, Info ,MapPin,MessagesSquare} from 'lucide-react';
// import logo from "@/assets/logo-svg.svg";

// // Define types
// interface MilestoneSnapshot {
//   work_milestone_name: string;
//   status: string;
//   progress: number;
//   work_header: string;
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
// }

// interface OverallMilestonesReportPDFProps {
//   latestReport: ReportDoc | null;
//   report7DaysAgo: ReportDoc | null;
//   report14DaysAgo: ReportDoc | null;
//   projectData: any;
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

// // Helper function to estimate height of a single manpower row
// const estimateManpowerRowHeight = () => 35; // px, approximate

// // Helper function to estimate height of a single milestone row
// const estimateMilestoneRowHeight = (milestone: MilestoneSnapshot) => {
//   const baseHeight = 40; // px, for a single line
//   const nameLines = Math.ceil((milestone.work_milestone_name?.length || 0) / 25); // Approx chars per line
//   return baseHeight + (nameLines > 1 ? (nameLines - 1) * 16 : 0); // 16px per extra line
// };

// // Helper function to estimate height of a Work Progress Group
// const estimateWorkProgressGroupHeight = (milestones: MilestoneSnapshot[]) => {
//   const groupHeaderHeight = 60; // px, for the collapsible header
//   const tableHeaderHeight = 60; // px, for the table's thead
//   const totalRowsHeight = milestones.reduce((sum, m) => sum + estimateMilestoneRowHeight(m), 0);
//   return groupHeaderHeight + tableHeaderHeight + totalRowsHeight + 20; // + margin/padding
// };

// interface PDFReportHeaderProps {
//   projectData: any;
//   reportDate: string;
// }

// const PDFReportHeader: React.FC<PDFReportHeaderProps> = ({ projectData, reportDate }) => (
//   <thead className="border-b border-black">
//     <tr>
//       <th colSpan={8} className="p-0">
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
//           <div className="text-right pt-2">
//             {/* <div className="text-xl font-semibold">Overall Report Date:</div>
//             <div className="text-lg font-light italic">{formatDate(reportDate)}</div> */}
//           </div>
//         </div>
//         <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-md mt-4 pb-2 border-b border-gray-300">
//           <div className="flex justify-between items-center">
//             <span className="font-semibold">Project :</span>
//             <span className="text-right">{projectData?.project_name || "--"}</span>
//           </div>
//           <div className="flex justify-between items-center">
//             <span className="font-semibold">Project Manager :</span>
//             <span className="text-right">{projectData?.owner || "--"}</span>
//           </div>
//           <div className="flex justify-between items-center">
//             <span className="font-semibold">Start Date :</span>
//             <span className="text-right">{projectData?.project_start_date ? formatDate(projectData.project_start_date) : "--"}</span>
//           </div>
//           <div className="flex justify-between items-center">
//             <span className="font-semibold">Lastest Report Date :</span>
//             <span className="text-right">{formatDate(reportDate) || "--"}</span>
//           </div>
//         </div>
//       </th>
//     </tr>
//   </thead>
// );

// const OverallMilestonesReportPDF: React.FC<OverallMilestonesReportPDFProps> = ({ 
//   latestReport, 
//   report7DaysAgo, 
//   report14DaysAgo,
//   projectData 
// }) => {
//   const componentRef = useRef<HTMLDivElement>(null);

//   const handlePrint = useReactToPrint({
//     content: () => componentRef.current,
//     documentTitle: `Overall Report - ${formatDate(new Date())}`,
//   });

//   // Memoized grouped milestones from the latest report
//   const groupedMilestones = useMemo(() => {
//     if (!latestReport?.milestones) return {};
//     return latestReport.milestones.reduce((acc, milestone) => {
//       (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
//       return acc;
//     }, {} as Record<string, MilestoneSnapshot[]>);
//   }, [latestReport]);

//   // Memoized grouped manpower from all reports
//   const groupedManpower = useMemo(() => {
//     if (!latestReport?.manpower) return {};
    
//     const allManpowerLabels = new Set<string>();
//     latestReport.manpower.forEach(mp => allManpowerLabels.add(mp.label));
//     report7DaysAgo?.manpower?.forEach(mp => allManpowerLabels.add(mp.label));
//     report14DaysAgo?.manpower?.forEach(mp => allManpowerLabels.add(mp.label));
    
//     const groups: Record<string, { current: number, sevenDays: number, fourteenDays: number }> = {};
//     Array.from(allManpowerLabels).forEach(label => {
//       groups[label] = {
//         current: parseInt(latestReport.manpower.find(mp => mp.label === label)?.count || '0', 10), // Ensure it's a number
//         sevenDays: parseInt(report7DaysAgo?.manpower?.find(mp => mp.label === label)?.count || '0', 10),
//         fourteenDays: parseInt(report14DaysAgo?.manpower?.find(mp => mp.label === label)?.count || '0', 10)
//       };
//     });
//     return groups;
//   }, [latestReport, report7DaysAgo, report14DaysAgo]);

//   // Helper to get milestone data
//   const getMilestoneData = (milestoneName: string, workHeader: string, report: ReportDoc | null) => {
//     if (!report || !report.milestones) return { status: "N/A", progress: "N/A" };
    
//     const foundMilestone = report.milestones.find(
//       m => m.work_milestone_name === milestoneName && m.work_header === workHeader
//     );
    
//     return foundMilestone 
//       ? { status: foundMilestone.status, progress: `${foundMilestone.progress}%` }
//       : { status: "N/A", progress: "N/A" };
//   };

//   const hasHistoricalData = report7DaysAgo || report14DaysAgo;

//   // --- Smart Pagination Logic for PDF ---
//   const PAGE_APPROX_HEIGHT_PX = 1000; // A4 height (adjust if needed for precise control)
//   const PAGE_TOP_HEADER_SECTION_HEIGHT_PX = 200; // Estimated height of PDFReportHeader
//   const NEW_OVERALL_REPORT_SECTION_HEIGHT_PX = 120; // Estimated height of Overall Work Report summary
//   const PAGE_REPORT_DATES_HEADER_HEIGHT_PX = 80; // Estimated height of the 4-column date comparison
//   const PAGE_INFO_ALERT_HEIGHT_PX = 70; // Estimated height of the yellow info alert

//   // Calculate static height on the first page
//   const STATIC_HEADER_CONTENT_HEIGHT_PX = 
//     PAGE_TOP_HEADER_SECTION_HEIGHT_PX + 
//     NEW_OVERALL_REPORT_SECTION_HEIGHT_PX + 
//     PAGE_REPORT_DATES_HEADER_HEIGHT_PX +
//     (hasHistoricalData ? 0 : PAGE_INFO_ALERT_HEIGHT_PX) + 
//     50; // Extra padding/margins

//   // Available height for dynamic content (manpower, milestones) on the first page
//   const INITIAL_CONTENT_AVAILABLE_HEIGHT = PAGE_APPROX_HEIGHT_PX - STATIC_HEADER_CONTENT_HEIGHT_PX;


//   // Paginate Manpower Section
//   const paginatedManpower = useMemo(() => {
//     const manpowerEntries = Object.entries(groupedManpower);
//     if (manpowerEntries.length === 0) return [];

//     const pages = [];
//     let currentPage = [];
//     let currentPageHeight = 0;
//     const manpowerSectionTitleHeight = 50; // "Manpower Comparison" title
//     const manpowerTableHeaderHeight = 40; // Table header row

//     // For the first page, we use INITIAL_CONTENT_AVAILABLE_HEIGHT
//     // For subsequent pages, more height is available as header is repeated at top of each page.
//     let currentAvailableHeight = INITIAL_CONTENT_AVAILABLE_HEIGHT;

//     manpowerEntries.forEach(([label, counts], index) => {
//       const rowHeight = estimateManpowerRowHeight();
//       const heightToAdd = (currentPage.length === 0 ? manpowerTableHeaderHeight : 0) + rowHeight;

//       if (currentPageHeight + heightToAdd > currentAvailableHeight && currentPage.length > 0) {
//         pages.push(currentPage);
//         currentPage = [{ label, counts }];
//         currentPageHeight = manpowerTableHeaderHeight + rowHeight;
//         // For subsequent pages, available height is approx full page minus header repetition
//         currentAvailableHeight = PAGE_APPROX_HEIGHT_PX - PAGE_TOP_HEADER_SECTION_HEIGHT_PX - manpowerSectionTitleHeight - 50; 
//       } else {
//         currentPage.push({ label, counts });
//         currentPageHeight += heightToAdd;
//       }
//     });
//     if (currentPage.length > 0) pages.push(currentPage);
//     return pages;
//   }, [groupedManpower, hasHistoricalData]);

//   // Paginate Work Progress Sections
//   const paginatedWorkProgress = useMemo(() => {
//     const workProgressEntries = Object.entries(groupedMilestones);
//     if (workProgressEntries.length === 0) return [];

//     const pages = [];
//     let currentPage = [];
//     let currentPageHeight = 0;
//     const workProgressSectionTitleHeight = 50; // "Work Progress Comparison" title

//     let currentAvailableHeight = PAGE_APPROX_HEIGHT_PX - PAGE_TOP_HEADER_SECTION_HEIGHT_PX - workProgressSectionTitleHeight - 50; // Default for subsequent pages
    
//     // If manpower section fully fit on the first content page, then work progress can start right after it.
//     // If manpower needed multiple pages, then work progress will start on a new page.
//     // Let's assume work progress always starts on a new logical page after manpower to simplify
//     // unless manpower is completely empty.

//     // If there's no manpower, work progress can try to fit on the first page after static headers.
//     if (paginatedManpower.length === 0) {
//         currentAvailableHeight = INITIAL_CONTENT_AVAILABLE_HEIGHT;
//     }


//     workProgressEntries.forEach(([header, milestones], index) => {
//       const groupHeight = estimateWorkProgressGroupHeight(milestones as MilestoneSnapshot[]);

//       if (currentPageHeight + groupHeight > currentAvailableHeight && currentPage.length > 0) {
//         pages.push(currentPage);
//         currentPage = [{ header, milestones }];
//         currentPageHeight = groupHeight;
//         currentAvailableHeight = PAGE_APPROX_HEIGHT_PX - PAGE_TOP_HEADER_SECTION_HEIGHT_PX - workProgressSectionTitleHeight - 50; // Subsequent pages
//       } else {
//         currentPage.push({ header, milestones });
//         currentPageHeight += groupHeight;
//       }
//     });
//     if (currentPage.length > 0) pages.push(currentPage);
//     return pages;
//   }, [groupedMilestones, paginatedManpower, hasHistoricalData]);


//   return (
//     <>
//        <button
//         onClick={handlePrint}
//         className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg text-lg flex items-center gap-2"
//       >
//         <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
//           <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
//         </svg>
//         Download PDF
//       </button>

//       <div className="hidden">
//         <div ref={componentRef} className="bg-white p-8">
//           {/* First Page Content Block */}
//           <div className="page">
//             <table className="min-w-full divide-gray-200">
//               <PDFReportHeader projectData={projectData} reportDate={latestReport?.report_date || ''} />
//               <tbody>
//                 <tr>
//                   <td colSpan={8}>
//                     {/* Overall Work Report section (from image) */}
//                     <div className="mb-6 mt-4">
//                       <h2 className="text-2xl font-bold mb-3">Overall Work Report</h2>
//                       <div className="grid grid-cols-1 gap-2 text-lg">
//                         {/* Using nullish coalescing operator ?? for better handling of 0 as valid data */}
//                         <p>Total Completed: <span className="font-semibold">{latestReport?.total_completed_works ?? '--'}</span></p>
//                         <p>Number of packages: <span className="font-semibold">{latestReport?.number_of_work_headers ?? '--'}</span></p>
//                         {/* <p>Total Manpower Used (till date): <span className="font-semibold">{latestReport?.total_manpower_used_till_date ?? '--'}</span></p> */}
//                       </div>
//                     </div>

//                     {/* Report Dates - moved here */}
//                     <div className="grid grid-cols-4 gap-4 mb-8">
//                       <div className="text-center p-3 bg-gray-100 rounded-lg">
//                         <h3 className="font-semibold text-gray-700">Current</h3>
//                         <p className="text-sm text-gray-600 mt-1">
//                           {latestReport?.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric'}) : '--'}
//                         </p>
//                       </div>
//                       <div className="text-center p-3 bg-gray-100 rounded-lg">
//                         <h3 className="font-semibold text-gray-700">7 Days Ago</h3>
//                         <p className="text-sm text-gray-600 mt-1">
//                           {report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'}
//                         </p>
//                       </div>
//                       <div className="text-center p-3 bg-gray-100 rounded-lg">
//                         <h3 className="font-semibold text-gray-700">14 Days Ago</h3>
//                         <p className="text-sm text-gray-600 mt-1">
//                           {report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'}
//                         </p>
//                       </div>
//                       {/* <div className="text-center p-3 bg-gray-100 rounded-lg">
//                         <h3 className="font-semibold text-gray-700">Comparison</h3>
//                         <p className="text-sm text-gray-600 mt-1">Report Data</p>
//                       </div> */}
//                     </div>

//                     {!hasHistoricalData && (
//                       <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded avoid-page-break-inside">
//                         <div className="flex items-start">
//                           <div className="flex-shrink-0">
//                             <svg className="h-5 w-5 text-yellow-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
//                               <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
//                             </svg>
//                           </div>
//                           <div className="ml-3">
//                             <p className="text-sm text-yellow-700">
//                               Limited historical data available. Showing current report data only. 
//                               Create more reports over time to enable comparison features.
//                             </p>
//                           </div>
//                         </div>
//                       </div>
//                     )}

//                     {/* Manpower Comparison Section - First Page (if available) */}
//                     {/* {paginatedManpower.length > 0 && (
//                       <div className="mb-6 avoid-page-break-inside"> 
//                         <h2 className="text-xl font-bold mb-4 mt-4">Manpower Comparison</h2>
//                         <div className="overflow-x-auto">
//                           <Table className="w-full min-w-[600px]">
//                             <TableHeader className="bg-gray-100">
//                               <TableRow>
//                                 <TableHead className="w-[25%] font-semibold text-gray-700 text-sm py-2">Manpower Type</TableHead>
//                                 <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2">Current</TableHead>
//                                 <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2">7 Days Ago</TableHead>
//                                 <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2">14 Days Ago</TableHead>
//                               </TableRow>
//                             </TableHeader>
//                             <TableBody>
//                               {paginatedManpower[0].map(({ label, counts }, idx) => { // Only render the first page of manpower here
//                                 return (
//                                   <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} avoid-page-break-inside`}>
//                                     <TableCell className="py-3 px-4 text-sm font-medium break-words">{label}</TableCell>
//                                     <TableCell className="text-center py-3 px-2 text-sm font-semibold">{counts.current}</TableCell>
//                                     <TableCell className="text-center py-3 px-2 text-sm">
//                                       {report7DaysAgo ? counts.sevenDays : <span className="text-gray-400 text-xs">--</span>}
//                                     </TableCell>
//                                     <TableCell className="text-center py-3 px-2 text-sm">
//                                       {report14DaysAgo ? counts.fourteenDays : <span className="text-gray-400 text-xs">--</span>}
//                                     </TableCell>
//                                   </TableRow>
//                                 );
//                               })}
//                             </TableBody>
//                           </Table>
//                         </div>
//                       </div>
//                     )} */}
//                   </td>
//                 </tr>
//               </tbody>
//             </table>
//           </div>

//           {/* Paginated Manpower Comparison Section - Subsequent Pages */}
//           {/* {paginatedManpower.length > 1 && paginatedManpower.slice(1).map((pageManpower, pageIndex) => ( // Render remaining manpower pages
//             <div key={`manpower-page-${pageIndex + 1}`} className="page page-break-before">
//               <table className="min-w-full divide-gray-200">
//                 <PDFReportHeader projectData={projectData} reportDate={latestReport?.report_date || ''} />
//                 <tbody>
//                   <tr>
//                     <td colSpan={8}>
//                       <h2 className="text-xl font-bold mb-4 mt-4">Manpower Comparison (Contd.)</h2>
//                       <div className="overflow-x-auto">
//                         <Table className="w-full min-w-[600px]">
//                           <TableHeader className="bg-gray-100">
//                             <TableRow>
//                               <TableHead className="w-[25%] font-semibold text-gray-700 text-sm py-2">Manpower Type</TableHead>
//                               <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2">Current</TableHead>
//                               <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2">7 Days Ago</TableHead>
//                               <TableHead className="w-[25%] text-center font-semibold text-gray-700 text-sm py-2">14 Days Ago</TableHead>
//                             </TableRow>
//                           </TableHeader>
//                           <TableBody>
//                             {pageManpower.map(({ label, counts }, idx) => {
//                               return (
//                                 <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} avoid-page-break-inside`}>
//                                   <TableCell className="py-3 px-4 text-sm font-medium break-words">{label}</TableCell>
//                                   <TableCell className="text-center py-3 px-2 text-sm font-semibold">{counts.current}</TableCell>
//                                   <TableCell className="text-center py-3 px-2 text-sm">
//                                     {report7DaysAgo ? counts.sevenDays : <span className="text-gray-400 text-xs">--</span>}
//                                   </TableCell>
//                                   <TableCell className="text-center py-3 px-2 text-sm">
//                                     {report14DaysAgo ? counts.fourteenDays : <span className="text-gray-400 text-xs">--</span>}
//                                   </TableCell>
//                                 </TableRow>
//                               );
//                             })}
//                           </TableBody>
//                         </Table>
//                       </div>
//                     </td>
//                   </tr>
//                 </tbody>
//               </table>
//             </div>
//           ))} */}


//           {/* Paginated Work Progress Comparison Section */}
//           {paginatedWorkProgress.length > 0 && paginatedWorkProgress.map((pageGroups, pageIndex) => (
//             <div key={`work-progress-page-${pageIndex}`} className={`page ${
//                 (pageIndex === 0 && paginatedManpower.length === 0) ? 'mt-0' : 'page-break-before' 
//                 // If no manpower, first work progress page can be on the "first content page".
//                 // Otherwise, it must start on a new page after manpower.
//             }`}>
//               <table className="min-w-full divide-gray-200">
//                 <PDFReportHeader projectData={projectData} reportDate={latestReport?.report_date || ''} />
//                 <tbody>
//                   <tr>
//                     <td colSpan={8}>
//                       <h2 className="text-xl font-bold mb-4 mt-4">Work Progress Comparison {pageIndex > 0 ? "(Contd.)" : ""}</h2>
//                       {pageGroups.map(({ header, milestones }, groupIdx) => (
//                         <div key={groupIdx} className="mb-6 avoid-page-break-inside">
//                           <h3 className="text-lg font-bold mb-3">{header} ({milestones.length})</h3>
//                           <div className="overflow-x-auto">
//                             <Table className="w-full min-w-[700px]">
//                               <TableHeader className="bg-gray-100">
//                               <TableRow>
//                                 <TableHead className="w-[30%] font-semibold text-gray-700 text-sm py-2">Work</TableHead>
//                                 <TableHead className="w-[14%] text-center font-semibold text-gray-700 text-sm py-2">Status<br/>(Current)</TableHead>
//                                 <TableHead className="w-[14%] text-center font-semibold text-gray-700 text-sm py-2">% Done<br/>(Current)</TableHead>
//                                 {/* Modified the date formatting for -7 Days report */}
//                                 <TableHead className="w-[14%] text-center font-semibold text-gray-700 text-sm py-2">
//                                   Status<br/>
//                                   {report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'}
//                                 </TableHead>
//                                 <TableHead className="w-[14%] text-center font-semibold text-gray-700 text-sm py-2">
//                                   % Done<br/>
//                                   {report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'}
//                                 </TableHead>
//                                 {/* Modified the date formatting for -14 Days report */}
//                                 <TableHead className="w-[14%] text-center font-semibold text-gray-700 text-sm py-2">
//                                   Status<br/>
//                                   {report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'}
//                                 </TableHead>
//                                 <TableHead className="w-[14%] text-center font-semibold text-gray-700 text-sm py-2">
//                                   % Done<br/>
//                                   {report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'}
//                                 </TableHead>
//                               </TableRow>
//                               </TableHeader>
//                               <TableBody>
//                                 {(milestones as MilestoneSnapshot[]).map((milestone, idx) => {
//                                   const currentData = getMilestoneData(milestone.work_milestone_name, milestone.work_header, latestReport);
//                                   const sevenDaysAgoData = getMilestoneData(milestone.work_milestone_name, milestone.work_header, report7DaysAgo);
//                                   const fourteenDaysAgoData = getMilestoneData(milestone.work_milestone_name, milestone.work_header, report14DaysAgo);

//                                   return (
//                                     <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} avoid-page-break-inside`}>
//                                       <TableCell className="py-3 px-4 text-sm break-words">{idx + 1}. {milestone.work_milestone_name}</TableCell>
                                      
//                                       <TableCell className="text-center py-3 px-2">
//                                         <Badge variant="secondary" className={`${getStatusBadgeClasses(currentData.status)} text-xs`}>
//                                           {currentData.status}
//                                         </Badge>
//                                       </TableCell>
//                                       <TableCell className="text-center py-3 px-2 text-sm font-medium">{currentData.progress}</TableCell>
                                      
//                                       <TableCell className="text-center py-3 px-2">
//                                         {report7DaysAgo ? (
//                                           <Badge variant="secondary" className={`${getStatusBadgeClasses(sevenDaysAgoData.status)} text-xs`}>
//                                             {sevenDaysAgoData.status}
//                                           </Badge>
//                                         ) : (
//                                           <span className="text-gray-400 text-xs">--</span>
//                                         )}
//                                       </TableCell>
//                                       <TableCell className="text-center py-3 px-2 text-sm">
//                                         {report7DaysAgo ? sevenDaysAgoData.progress : <span className="text-gray-400 text-xs">--</span>}
//                                       </TableCell>

//                                       <TableCell className="text-center py-3 px-2">
//                                         {report14DaysAgo ? (
//                                           <Badge variant="secondary" className={`${getStatusBadgeClasses(fourteenDaysAgoData.status)} text-xs`}>
//                                             {fourteenDaysAgoData.status}
//                                           </Badge>
//                                         ) : (
//                                           <span className="text-gray-400 text-xs">--</span>
//                                         )}
//                                       </TableCell>
//                                       <TableCell className="text-center py-3 px-2 text-sm">
//                                         {report14DaysAgo ? fourteenDaysAgoData.progress : <span className="text-gray-400 text-xs">--</span>}
//                                       </TableCell>
//                                     </TableRow>
//                                   );
//                                 })}
//                               </TableBody>
//                             </Table>
//                           </div>
//                         </div>
//                       ))}
//                     </td>
//                   </tr>
//                 </tbody>
//               </table>
//             </div>
//           ))}
           

//           {/* Footer */}

//            {latestReport?.attachments && latestReport.attachments.length > 0 && (
//                       <div className="page page-break-before">
//                         <div className="overflow-x-auto p-4">
//                           <table className="w-full divide-gray-200">
//                              <PDFReportHeader projectData={projectData} reportDate={latestReport?.report_date || ''} />
//                             <tbody className="bg-white">
//                               <tr>
//                                 <td colSpan={4}>
//                                   <h3 className="text-lg font-bold mb-3 text-gray-800">WORK IMAGES</h3>
//                                   <div className="grid grid-cols-2 gap-4"> {/* Two cards per row */}
//                                     {latestReport?.attachments.map((attachment, idx) => (
//                                       <div key={idx} className="border rounded-lg overflow-hidden shadow-sm avoid-page-break-inside"> {/* Each card */}
//                                         {/* Image at the top of the card */}
//                                         <img
//                                           src={attachment.image_link}
//                                           alt={`Work Image ${idx + 1}`}
//                                           className="w-full h-[200px] object-cover rounded-t" // Fills card width, fixed height, top corners rounded
//                                         />
//                                         {/* Remarks and Location underneath the image */}
//                                         <div className="p-2 bg-gray-50">
//                                           <div className="flex items-center text-xs text-gray-600 mb-1">
//                                             <MapPin className="h-3 w-3 mr-1 text-red-500 flex-shrink-0" />
//                                             <span className="font-medium text-gray-700 break-words">
//                                               {attachment.location || `Lat: ${attachment.latitude?.toFixed(2)}, Lon: ${attachment.longitude?.toFixed(2)}`}
//                                             </span>
//                                           </div>
//                                           {/* HIGHLIGHTED REMARKS HERE */}
//                                           <p className="p-2 mt-2 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs">
//                                             {attachment.remarks || "No remarks provided."}
//                                           </p>
//                                         </div>
//                                       </div>
//                                     ))}
//                                   </div>
//                                 </td>
//                               </tr>
//                             </tbody>
//                           </table>
//                         </div>
//                       </div>
//                     )}
          
//         </div>
           
//       </div>

//       {/* Print-specific styles */}
//       <style jsx global>{`
//         @media print {
//           @page {
//             size: A4;
//             margin: 0.5cm;
//           }
          
//           .page {
//             page-break-after: always;
//           }
          
//           .page:last-child {
//             page-break-after: auto;
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
          
//           thead {
//             display: table-header-group !important;
//           }

//           .avoid-page-break-inside {
//             page-break-inside: avoid !important;
//           }
          
//           h2, h3, h4 {
//             page-break-after: avoid;
//             page-break-inside: avoid;
//           }
//         }
//       `}</style>
//     </>
//   );
// };

// export default OverallMilestonesReportPDF;


import React, { useMemo, useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { formatDate } from '@/utils/FormatDate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download } from 'lucide-react';
import { ChevronDown, ChevronUp, AlertCircle, Info ,MapPin,MessagesSquare} from 'lucide-react';
import logo from "@/assets/logo-svg.svg";
import { MilestoneProgress } from '../MilestonesSummary';
import {useFrappeGetDoc} from 'frappe-react-sdk';


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

interface ProjectProgressAttachment { // Assuming this structure for attachments
  image_link: string;
  location: string | null;
  latitude?: number; // Optional, if you store these separately
  longitude?: number; // Optional, if you store these separately
  remarks: string;
}


interface ReportDoc {
  name: string;
  report_date: string;
  milestones: MilestoneSnapshot[];
  manpower: ManpowerSnapshot[];
  total_completed_works: number;
  number_of_work_headers: number;
  total_manpower_used_till_date: number;
  attachments?: ProjectProgressAttachment[]; // Added attachments
}

interface OverallMilestonesReportPDFProps {
  latestReport: ReportDoc | null;
  report7DaysAgo: ReportDoc | null;
  report14DaysAgo: ReportDoc | null;
  projectData: any;
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

// Helper function to estimate height of a single manpower row
const estimateManpowerRowHeight = () => 35; // px, approximate

// Helper function to estimate height of a single milestone row
const estimateMilestoneRowHeight = (milestone: MilestoneSnapshot) => {
  const baseHeight = 40; // px, for a single line
  const nameLines = Math.ceil((milestone.work_milestone_name?.length || 0) / 25); // Approx chars per line
  return baseHeight + (nameLines > 1 ? (nameLines - 1) * 16 : 0); // 16px per extra line
};

// Helper function to estimate height of a Work Progress Group
const estimateWorkProgressGroupHeight = (milestones: MilestoneSnapshot[]) => {
  const groupHeaderHeight = 60; // px, for the collapsible header
  const tableHeaderHeight = 60; // px, for the table's thead
  const totalRowsHeight = milestones.reduce((sum, m) => sum + estimateMilestoneRowHeight(m), 0);
  return groupHeaderHeight + tableHeaderHeight + totalRowsHeight + 20; // + margin/padding
};

interface PDFReportHeaderProps {
  projectData: any;
  reportDate: string;
  projectlastUpdateBy:string
}

const PDFReportHeader: React.FC<PDFReportHeaderProps> = ({ projectData, reportDate ,projectlastUpdateBy}) => (
  <thead className="border-b border-black">
    <tr>
      {/* colSpan is 8 for the overall table structure */}
      <th colSpan={8} className="p-0"> 
        <div className="flex text-left justify-between border-gray-600 pb-1">
          <div className="mt-2 flex justify-start">
            <div>
              <img
                src={logo}
                alt="Nirmaan"
                width="180"
                height="52"
              />
              <div className="pt-2 text-lg font-semibold">
                Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
              </div>
              <div className="text-sm text-gray-500 mt-0.5">
                First floor, 234, 9th Main, 16th Cross Rd, Sector 6, HSR Layout, Bengaluru, Karnataka 560102
              </div>
            </div>
          </div>
          <div className="text-right pt-2">
            {/* <div className="text-xl font-semibold">Overall Report Date:</div>
            <div className="text-lg font-light italic">{formatDate(reportDate)}</div> */}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-md mt-4 pb-2 border-b border-gray-300">
          <div className="flex justify-between items-center">
            <span className="font-semibold">Project :</span>
            <span className="text-right">{projectData?.project_name || "--"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-semibold">Last Updated By :</span>
            <span className="text-right">{projectlastUpdateBy || "--"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-semibold">Start Date :</span>
            <span className="text-right">{projectData?.project_start_date ? formatDate(projectData.project_start_date) : "--"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-semibold">Lastest Report Date :</span>
            <span className="text-right">{formatDate(reportDate) || "--"}</span>
          </div>
        </div>
      </th>
    </tr>
  </thead>
);

const OverallMilestonesReportPDF: React.FC<OverallMilestonesReportPDFProps> = ({ 
  latestReport, 
  report7DaysAgo, 
  report14DaysAgo,
  projectData 
}) => {
  const componentRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
    documentTitle: `Overall Report - ${formatDate(new Date())}`,
  });

  // Memoized grouped milestones from the latest report
  const groupedMilestones = useMemo(() => {
    if (!latestReport?.milestones) return {};
    return latestReport.milestones.reduce((acc, milestone) => {
      (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
      return acc;
    }, {} as Record<string, MilestoneSnapshot[]>);
  }, [latestReport]);

  const {data:ownerData}= useFrappeGetDoc<{full_name:string}>('Nirmaan Users',latestReport?.owner || '')

  // Memoized grouped manpower from all reports
  const groupedManpower = useMemo(() => {
    if (!latestReport?.manpower) return {};
    
    const allManpowerLabels = new Set<string>();
    latestReport.manpower.forEach(mp => allManpowerLabels.add(mp.label));
    report7DaysAgo?.manpower?.forEach(mp => allManpowerLabels.add(mp.label));
    report14DaysAgo?.manpower?.forEach(mp => allManpowerLabels.add(mp.label));
    
    const groups: Record<string, { current: number, sevenDays: number, fourteenDays: number }> = {};
    Array.from(allManpowerLabels).forEach(label => {
      groups[label] = {
        current: parseInt(latestReport.manpower.find(mp => mp.label === label)?.count.toString() || '0', 10), // Ensure it's a number
        sevenDays: parseInt(report7DaysAgo?.manpower?.find(mp => mp.label === label)?.count.toString() || '0', 10),
        fourteenDays: parseInt(report14DaysAgo?.manpower?.find(mp => mp.label === label)?.count.toString() || '0', 10)
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

  const hasHistoricalData = report7DaysAgo || report14DaysAgo;

  // --- Smart Pagination Logic for PDF ---
  const PAGE_APPROX_HEIGHT_PX = 1000; // A4 height (adjust if needed for precise control)
  const PAGE_TOP_HEADER_SECTION_HEIGHT_PX = 200; // Estimated height of PDFReportHeader
  const NEW_OVERALL_REPORT_SECTION_HEIGHT_PX = 120; // Estimated height of Overall Work Report summary
  const PAGE_REPORT_DATES_HEADER_HEIGHT_PX = 80; // Estimated height of the 4-column date comparison
  const PAGE_INFO_ALERT_HEIGHT_PX = 70; // Estimated height of the yellow info alert

  // Calculate static height on the first page
  const STATIC_HEADER_CONTENT_HEIGHT_PX = 
    PAGE_TOP_HEADER_SECTION_HEIGHT_PX + 
    NEW_OVERALL_REPORT_SECTION_HEIGHT_PX + 
    PAGE_REPORT_DATES_HEADER_HEIGHT_PX +
    (hasHistoricalData ? 0 : PAGE_INFO_ALERT_HEIGHT_PX) + 
    50; // Extra padding/margins

  // Available height for dynamic content (manpower, milestones) on the first page
  const INITIAL_CONTENT_AVAILABLE_HEIGHT = PAGE_APPROX_HEIGHT_PX - STATIC_HEADER_CONTENT_HEIGHT_PX;


  // Paginate Manpower Section
  const paginatedManpower = useMemo(() => {
    const manpowerEntries = Object.entries(groupedManpower);
    if (manpowerEntries.length === 0) return [];

    const pages = [];
    let currentPage = [];
    let currentPageHeight = 0;
    const manpowerSectionTitleHeight = 50; // "Manpower Comparison" title
    const manpowerTableHeaderHeight = 40; // Table header row

    // For the first page, we use INITIAL_CONTENT_AVAILABLE_HEIGHT
    // For subsequent pages, more height is available as header is repeated at top of each page.
    let currentAvailableHeight = INITIAL_CONTENT_AVAILABLE_HEIGHT;

    manpowerEntries.forEach(([label, counts], index) => {
      const rowHeight = estimateManpowerRowHeight();
      const heightToAdd = (currentPage.length === 0 ? manpowerTableHeaderHeight : 0) + rowHeight;

      if (currentPageHeight + heightToAdd > currentAvailableHeight && currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [{ label, counts }];
        currentPageHeight = manpowerTableHeaderHeight + rowHeight;
        // For subsequent pages, available height is approx full page minus header repetition
        currentAvailableHeight = PAGE_APPROX_HEIGHT_PX - PAGE_TOP_HEADER_SECTION_HEIGHT_PX - manpowerSectionTitleHeight - 50; 
      } else {
        currentPage.push({ label, counts });
        currentPageHeight += heightToAdd;
      }
    });
    if (currentPage.length > 0) pages.push(currentPage);
    return pages;
  }, [groupedManpower, hasHistoricalData]);

  // Paginate Work Progress Sections
  const paginatedWorkProgress = useMemo(() => {
    const workProgressEntries = Object.entries(groupedMilestones);
    if (workProgressEntries.length === 0) return [];

    const pages = [];
    let currentPage = [];
    let currentPageHeight = 0;
    const workProgressSectionTitleHeight = 50; // "Work Progress Comparison" title

    let currentAvailableHeight = PAGE_APPROX_HEIGHT_PX - PAGE_TOP_HEADER_SECTION_HEIGHT_PX - workProgressSectionTitleHeight - 50; // Default for subsequent pages
    
    // If manpower section fully fit on the first content page, then work progress can start right after it.
    // If manpower needed multiple pages, then work progress will start on a new page.
    // Let's assume work progress always starts on a new logical page after manpower to simplify
    // unless manpower is completely empty.

    // If there's no manpower, work progress can try to fit on the first page after static headers.
    if (paginatedManpower.length === 0) {
        currentAvailableHeight = INITIAL_CONTENT_AVAILABLE_HEIGHT;
    }


    workProgressEntries.forEach(([header, milestones], index) => {
      const groupHeight = estimateWorkProgressGroupHeight(milestones as MilestoneSnapshot[]);

      if (currentPageHeight + groupHeight > currentAvailableHeight && currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [{ header, milestones }];
        currentPageHeight = groupHeight;
        currentAvailableHeight = PAGE_APPROX_HEIGHT_PX - PAGE_TOP_HEADER_SECTION_HEIGHT_PX - workProgressSectionTitleHeight - 50; // Subsequent pages
      } else {
        currentPage.push({ header, milestones });
        currentPageHeight += groupHeight;
      }
    });
    if (currentPage.length > 0) pages.push(currentPage);
    return pages;
  }, [groupedMilestones, paginatedManpower, hasHistoricalData]);


  return (
    <>
       <button
        onClick={handlePrint}
        className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg text-lg flex items-center gap-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Download PDF
      </button>

      <div className="hidden">
        <div ref={componentRef} className="bg-white p-8">
          {/* First Page Content Block */}
          <div className="page">
            <table className="min-w-full divide-gray-200">
              <PDFReportHeader projectData={projectData} reportDate={latestReport?.report_date || ''} projectlastUpdateBy={ownerData?.full_name} />
              <tbody>
                <tr>
                  <td colSpan={8}>
                    {/* Overall Work Report section (from image) */}
                    <div className="mb-6 mt-4">
                      <h2 className="text-2xl font-bold mb-3">Overall Work Report</h2>
                      <div className="grid grid-cols-1 gap-2 text-lg">
                        {/* Using nullish coalescing operator ?? for better handling of 0 as valid data */}
                        <p>Total Completed: <span className="font-semibold">{latestReport?.total_completed_works ?? '--'}</span></p>
                        <p>Number of packages: <span className="font-semibold">{latestReport?.number_of_work_headers ?? '--'}</span></p>
                        {/* <p>Total Manpower Used (till date): <span className="font-semibold">{latestReport?.total_manpower_used_till_date ?? '--'}</span></p> */}
                      </div>
                    </div>

                    {/* Report Dates - moved here */}
                    <div className="grid grid-cols-4 gap-4 mb-8">
                      <div className="text-center p-3 bg-gray-100 rounded-lg">
                        <h3 className="font-semibold text-gray-700">Current</h3>
                        <p className="text-sm text-gray-600 mt-1">
                          {latestReport?.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric'}) : '--'}
                        </p>
                      </div>
                      <div className="text-center p-3 bg-gray-100 rounded-lg">
                        <h3 className="font-semibold text-gray-700">7 Days Ago</h3>
                        <p className="text-sm text-gray-600 mt-1">
                          {report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'}
                        </p>
                      </div>
                      <div className="text-center p-3 bg-gray-100 rounded-lg">
                        <h3 className="font-semibold text-gray-700">14 Days Ago</h3>
                        <p className="text-sm text-gray-600 mt-1">
                          {report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric'}) : '--'}
                        </p>
                      </div>
                      {/* <div className="text-center p-3 bg-gray-100 rounded-lg">
                        <h3 className="font-semibold text-gray-700">Comparison</h3>
                        <p className="text-sm text-gray-600 mt-1">Report Data</p>
                      </div> */}
                    </div>

                    {!hasHistoricalData && (
                      <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded avoid-page-break-inside">
                        <div className="flex items-start">
                          <div className="flex-shrink-0">
                            <svg className="h-5 w-5 text-yellow-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
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

                    {/* Manpower Comparison Section - First Page (if available) */}
                    {/* {paginatedManpower.length > 0 && (
                      <div className="mb-6 avoid-page-break-inside"> 
                        <h2 className="text-xl font-bold mb-4 mt-4">Manpower Comparison</h2>
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
                              {paginatedManpower[0].map(({ label, counts }, idx) => { // Only render the first page of manpower here
                                return (
                                  <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} avoid-page-break-inside`}>
                                    <TableCell className="py-3 px-4 text-sm font-medium break-words">{label}</TableCell>
                                    <TableCell className="text-center py-3 px-2 text-sm font-semibold">{counts.current}</TableCell>
                                    <TableCell className="text-center py-3 px-2 text-sm">
                                      {report7DaysAgo ? counts.sevenDays : <span className="text-gray-400 text-xs">--</span>}
                                    </TableCell>
                                    <TableCell className="text-center py-3 px-2 text-sm">
                                      {report14DaysAgo ? counts.fourteenDays : <span className="text-gray-400 text-xs">--</span>}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )} */}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Paginated Manpower Comparison Section - Subsequent Pages */}
          {/* {paginatedManpower.length > 1 && paginatedManpower.slice(1).map((pageManpower, pageIndex) => ( // Render remaining manpower pages
            <div key={`manpower-page-${pageIndex + 1}`} className="page page-break-before">
              <table className="min-w-full divide-gray-200">
                <PDFReportHeader projectData={projectData} reportDate={latestReport?.report_date || ''} />
                <tbody>
                  <tr>
                    <td colSpan={8}>
                      <h2 className="text-xl font-bold mb-4 mt-4">Manpower Comparison (Contd.)</h2>
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
                            {pageManpower.map(({ label, counts }, idx) => {
                              return (
                                <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} avoid-page-break-inside`}>
                                  <TableCell className="py-3 px-4 text-sm font-medium break-words">{label}</TableCell>
                                  <TableCell className="text-center py-3 px-2 text-sm font-semibold">{counts.current}</TableCell>
                                  <TableCell className="text-center py-3 px-2 text-sm">
                                    {report7DaysAgo ? counts.sevenDays : <span className="text-gray-400 text-xs">--</span>}
                                  </TableCell>
                                  <TableCell className="text-center py-3 px-2 text-sm">
                                    {report14DaysAgo ? counts.fourteenDays : <span className="text-gray-400 text-xs">--</span>}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))} */}


          {/* Paginated Work Progress Comparison Section */}
          {paginatedWorkProgress.length > 0 && paginatedWorkProgress.map((pageGroups, pageIndex) => (
            <div key={`work-progress-page-${pageIndex}`} className={`page ${
                (pageIndex === 0 && paginatedManpower.length === 0) ? 'mt-0' : 'page-break-before' 
                // If no manpower, first work progress page can be on the "first content page".
                // Otherwise, it must start on a new page after manpower.
            }`}>
              <table className="min-w-full divide-gray-200">
                <PDFReportHeader projectData={projectData} reportDate={latestReport?.report_date || ''} />
                <tbody>
                  <tr>
                    <td colSpan={8}>
                      <h2 className="text-xl font-bold mb-4 mt-4">Work Progress Comparison {pageIndex > 0 ? "(Contd.)" : ""}</h2>
                      {pageGroups.map(({ header, milestones }, groupIdx) => (
                        <div key={groupIdx} className="mb-6 avoid-page-break-inside">
                          <h3 className="text-lg font-bold mb-3">{header} ({milestones.length})</h3>
                          <div className="overflow-x-auto">
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
                                    <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} avoid-page-break-inside`}>
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
                                          <span className="text-gray-400 text-xs">--</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-center py-3 px-2 text-sm">
                                        {report7DaysAgo ? sevenDaysAgoData.progress : <span className="text-gray-400 text-xs">--</span>}
                                      </TableCell>

                                      <TableCell className="text-center py-3 px-2">
                                        {report14DaysAgo ? (
                                          <Badge variant="secondary" className={`${getStatusBadgeClasses(fourteenDaysAgoData.status)} text-xs`}>
                                            {fourteenDaysAgoData.status}
                                          </Badge>
                                        ) : (
                                          <span className="text-gray-400 text-xs">--</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-center py-3 px-2 text-sm">
                                        {report14DaysAgo ? fourteenDaysAgoData.progress : <span className="text-gray-400 text-xs">--</span>}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      ))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
           

          {/* Footer */}

           {latestReport?.attachments && latestReport.attachments.length > 0 && (
                      <div className="page page-break-before">
                        <div className="overflow-x-auto p-4">
                          <table className="w-full divide-gray-200">
                             <PDFReportHeader projectData={projectData} reportDate={latestReport?.report_date || ''} />
                            <tbody className="bg-white">
                              <tr>
                                {/* FIXED: Changed colSpan from 4 to 8 to occupy full table width */}
                                <td colSpan={8}> 
                                  <h3 className="text-lg font-bold mb-3 text-gray-800">WORK IMAGES</h3>
                                  <div className="grid grid-cols-2 gap-4"> {/* Two cards per row */}
                                    {latestReport?.attachments.map((attachment, idx) => (
                                      <div key={idx} className="border rounded-lg overflow-hidden shadow-sm avoid-page-break-inside"> {/* Each card */}
                                        {/* Image at the top of the card */}
                                        <img
                                          src={attachment.image_link}
                                          alt={`Work Image ${idx + 1}`}
                                          className="w-full h-[200px] object-cover rounded-t" // Fills card width, fixed height, top corners rounded
                                        />
                                        {/* Remarks and Location underneath the image */}
                                        <div className="p-2 bg-gray-50">
                                          <div className="flex items-center text-xs text-gray-600 mb-1">
                                            <MapPin className="h-3 w-3 mr-1 text-red-500 flex-shrink-0" />
                                            <span className="font-medium text-gray-700 break-words">
                                              {/* Safely display location, checking for `null` */}
                                              {attachment.location || 
                                               (attachment.latitude !== undefined && attachment.longitude !== undefined 
                                                ? `Lat: ${attachment.latitude?.toFixed(2)}, Lon: ${attachment.longitude?.toFixed(2)}` 
                                                : 'Location Not Provided')}
                                            </span>
                                          </div>
                                          {/* HIGHLIGHTED REMARKS HERE */}
                                          <p className="p-2 mt-2 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs">
                                            {attachment.remarks || "No remarks provided."}
                                          </p>
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

      {/* Print-specific styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 0.5cm;
          }
          
          .page {
            page-break-after: always;
          }
          
          .page:last-child {
            page-break-after: auto;
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
          
          h2, h3, h4 {
            page-break-after: avoid;
            page-break-inside: avoid;
          }

          /* NEW: Ensure grid works correctly in print */
          .grid-cols-2 {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important; /* Forces two equal columns */
            gap: 1rem !important; /* Re-applies gap, or adjust as needed */
          }
        }
      `}</style>
    </>
  );
};

export default OverallMilestonesReportPDF;