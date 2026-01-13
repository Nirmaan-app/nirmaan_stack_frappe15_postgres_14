import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronUp, MessagesSquare, Eye, EyeOff, Download } from 'lucide-react';
import { format } from 'date-fns';
import { formatDate } from '@/utils/FormatDate';
import { toast } from "@/components/ui/use-toast";

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

import { ImageBentoGrid } from '@/components/ui/ImageBentoGrid';
import { MilestoneProgress } from './MilestoneProgress';
import { parseWorkPlan, getStatusBadgeClasses } from '../utils/milestoneHelpers';

interface DailyReportViewProps {
  // Report data
  dailyReportDetails: any;
  projectData: any;
  selectedZone: string | null;
  displayDate: Date;

  // Computed data from hook
  workPlanGroups: [string, any[]][];
  milestoneGroups: [string, any[]][];
  totalWorkHeaders: number;
  completedWorksOnReport: number;
  totalManpowerInReport: number;
  workMilestonesList: any[];
  workHeaderOrderMap: Record<string, number>;
}

export const DailyReportView: React.FC<DailyReportViewProps> = ({
  dailyReportDetails,
  projectData,
  selectedZone,
  displayDate,
  workPlanGroups,
  milestoneGroups,
  totalWorkHeaders,
  completedWorksOnReport,
  totalManpowerInReport,
  workMilestonesList,
  workHeaderOrderMap,
}) => {
  // Expand/Collapse state
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);
  const [showPrintHeader, setShowPrintHeader] = useState(true);

  // Initialize expanded sections when data changes
  useEffect(() => {
    if (dailyReportDetails?.milestones) {
      const sections = dailyReportDetails.milestones.reduce((acc: any, milestone: any) => {
        acc[milestone.work_header] = true;
        return acc;
      }, {} as Record<string, boolean>);
      setExpandedSections(sections);
      setAllExpanded(true);
    }
  }, [dailyReportDetails]);

  // Collapse/Expand handlers
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

  // Calculate weighted progress for a header group
  const calculateWeightedProgress = useCallback((header: string, milestones: any[]) => {
    const milestonesWithWeightage = milestones.map(m => {
      const milestoneData = workMilestonesList?.find(
        wm => wm.work_milestone_name === m.work_milestone_name && wm.work_header === header
      );
      const weightage = milestoneData?.weightage || 1.0;
      const effectiveWeightage = m.status !== "Not Applicable" ? weightage : 0;
      return {
        ...m,
        weightage,
        effectiveWeightage,
        progress: Number(m.progress) || 0
      };
    });

    const sumEffectiveWeightages = milestonesWithWeightage.reduce(
      (sum, m) => sum + m.effectiveWeightage,
      0
    );

    if (sumEffectiveWeightages === 0) return 0;

    const overallProgress = milestonesWithWeightage.reduce((sum, m) => {
      const effectiveProgress = (m.effectiveWeightage * 100 / sumEffectiveWeightages) * (m.progress / 100);
      return sum + effectiveProgress;
    }, 0);

    return Math.round(overallProgress);
  }, [workMilestonesList]);

  // PDF Download handler
  const handleDownloadReport = async () => {
    if (!dailyReportDetails?.name) return;

    try {
      toast({ title: "Generating PDF...", description: "Please wait while we prepare your report." });

      const headerParam = showPrintHeader ? '1' : '0';
      const printUrl = `/api/method/frappe.utils.print_format.download_pdf?doctype=Project%20Progress%20Reports&name=${dailyReportDetails.name}&format=Milestone%20Report&no_letterhead=0&show_header=${headerParam}`;

      const response = await fetch(printUrl);
      if (!response.ok) throw new Error("Failed to generate PDF");
      const blob = await response.blob();

      const pName = (projectData?.project_name || "Project").replace(/\s+/g, '_');
      const rDate = dailyReportDetails.report_date ? new Date(dailyReportDetails.report_date) : new Date();
      const dStr = format(rDate, "dd-MMM-yyyy");
      const zoneSuffix = selectedZone ? `${selectedZone.replace(/\s+/g, '_')}` : "";

      const fileName = `${pName}-${zoneSuffix}-${dStr}_DPR.pdf`;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: "Success", description: "Report downloaded successfully.", variant: "success" });

    } catch (e) {
      console.error("PDF Download Error:", e);
      toast({ title: "Error", description: "Failed to download report.", variant: "destructive" });
    }
  };

  if (!dailyReportDetails) {
    return (
      <Card className="mt-4 p-4">
        <CardContent className="text-center flex flex-col items-center gap-4">
          <p className="text-gray-500">No daily report found for {formatDate(displayDate)}.</p>
        </CardContent>
      </Card>
    );
  }

  return (
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
              <div className="mt-2">
                <p className="text-xs text-muted-foreground">Remarks</p>
                <div className="mt-1 p-3 rounded-md bg-gray-50 border border-gray-200 text-gray-800 text-sm whitespace-pre-wrap break-words">
                  {dailyReportDetails.manpower_remarks}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Work Plan Summary */}
      {workPlanGroups.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg md:text-xl font-bold mb-6 border-b">Work Plan</h3>

          {workPlanGroups.map(([header, milestones], groupIdx) => (
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

      {/* Work Milestones Section */}
      {dailyReportDetails.milestones && dailyReportDetails.milestones.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg md:text-xl font-bold mb-6 border-b">Work Milestones</h3>

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

          {milestoneGroups.map(([header, milestones], groupIdx) => {
            const averageProgress = calculateWeightedProgress(header, milestones as any[]);

            return (
              <div key={groupIdx} className="mb-4 last:mb-0 border rounded-md overflow-hidden">
                {/* Collapsible Header */}
                <div
                  className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => toggleSection(header)}
                >
                  <div className="flex items-center gap-4">
                    <h3 className="text-base md:text-lg font-bold">
                      {header} - {(milestones as any[]).length.toString().padStart(2, '0')}
                    </h3>
                  </div>
                  <div className="flex items-center">
                    {(milestones as any[]).length > 0 && (
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
                      {(milestones as any[]).length} milestone{(milestones as any[]).length !== 1 ? 's' : ''}
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
                            <TableHead className="w-[20%] text-center font-semibold text-gray-700 text-sm py-2">Expected Starting/completion Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(milestones as any[]).map((milestone, idx) => (
                            <TableRow key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <TableCell className="py-3 px-4 text-sm">
                                {milestone.work_milestone_name}
                                {milestone.remarks && (
                                  <div className="mt-1">
                                    <p className="flex items-center gap-2 p-1 bg-yellow-100 text-yellow-900 rounded-md break-words text-xs">
                                      <MessagesSquare className="h-4 w-4 flex-shrink-0" />
                                      <span className="flex-grow">{milestone.remarks}</span>
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
                                <MilestoneProgress
                                  milestoneStatus={milestone.status}
                                  value={milestone.progress}
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
                                  <span className="text-green-500 font-medium">
                                    {milestone.expected_completion_date ? formatDate(milestone.expected_completion_date) : 'N/A'}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="md:hidden space-y-3">
                      {(milestones as any[]).map((milestone, idx) => (
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
            );
          })}
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

      {/* Download PDF Button */}
      <div className="mt-8 flex justify-end gap-2">
        {dailyReportDetails && projectData && (
          <>
            <div>
              <span className="mr-3">{showPrintHeader ? "Header Visible" : "Header Invisible"}:</span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowPrintHeader(!showPrintHeader)}
                title={showPrintHeader ? "Header will be printed" : "Header will be hidden"}
              >
                {showPrintHeader ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
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
  );
};

export default DailyReportView;
