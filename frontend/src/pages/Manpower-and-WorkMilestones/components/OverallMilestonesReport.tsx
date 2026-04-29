import React, { useState, useEffect, useMemo } from 'react';
import { useFrappeGetCall, useFrappeGetDocList } from 'frappe-react-sdk';
import { formatDate } from '@/utils/FormatDate';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronUp, AlertCircle, Info, MapPin, MessagesSquare, FileText, Download, Eye, EyeOff, Loader2 } from 'lucide-react';
import { TailSpin } from 'react-loader-spinner';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MilestoneProgress } from '../MilestonesSummary';
import { ImageBentoGrid } from '@/components/ui/ImageBentoGrid';
import { useTargetProgress, TargetWorkMilestone } from '../hooks/useTargetProgress';
import { useWorkHeaderOrder } from '@/hooks/useWorkHeaderOrder';


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
  drawing_remarks?: string;
  site_remarks?: string;
}

interface OverallMilestonesReportProps {
  selectedProject: string;
  projectData?: any;
  selectedZone: string;
  isAdmin?: boolean;
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

const OverallMilestonesReport: React.FC<OverallMilestonesReportProps> = ({ selectedProject, projectData, selectedZone, isAdmin = false }) => {
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
    fields: [
      "work_milestone_name", "work_milestone_order", "work_header", "weightage",
      "week_1", "week_2", "week_3", "week_4", "week_5",
      "week_6", "week_7", "week_8", "week_9",
    ],
    limit: 0
  });

  // Header-level weightage map (Work Headers doctype) — used for the
  // zone-level KPI strip below; per-header pcts inside the comparison
  // tables continue to use milestone weightage only.
  const { headerWeightageMap } = useWorkHeaderOrder();

  const [latestReport, setLatestReport] = useState<ReportDoc | null>(null);
  const [report7DaysAgo, setReport7DaysAgo] = useState<ReportDoc | null>(null);
  const [report14DaysAgo, setReport14DaysAgo] = useState<ReportDoc | null>(null);

  // Target progress for each snapshot date (admin only uses these)
  const currentRefDate = useMemo(
    () => (latestReport?.report_date ? new Date(latestReport.report_date) : undefined),
    [latestReport?.report_date],
  );
  const sevenRefDate = useMemo(
    () => (report7DaysAgo?.report_date ? new Date(report7DaysAgo.report_date) : undefined),
    [report7DaysAgo?.report_date],
  );
  const fourteenRefDate = useMemo(
    () => (report14DaysAgo?.report_date ? new Date(report14DaysAgo.report_date) : undefined),
    [report14DaysAgo?.report_date],
  );

  const { milestoneTarget: targetCurrent } = useTargetProgress({
    projectId: isAdmin ? selectedProject : null,
    referenceDate: currentRefDate,
    workMilestonesList: workMilestonesList as TargetWorkMilestone[] | undefined,
  });
  const { milestoneTarget: target7d } = useTargetProgress({
    projectId: isAdmin ? selectedProject : null,
    referenceDate: sevenRefDate,
    workMilestonesList: workMilestonesList as TargetWorkMilestone[] | undefined,
  });
  const { milestoneTarget: target14d } = useTargetProgress({
    projectId: isAdmin ? selectedProject : null,
    referenceDate: fourteenRefDate,
    workMilestonesList: workMilestonesList as TargetWorkMilestone[] | undefined,
  });

  // Weighted header-level target for a given milestone-target map, matching
  // calculateHeaderAverage's weightage logic but substituting target for progress.
  const calculateHeaderTarget = (
    targetMap: Map<string, number>,
    header: string,
    activeMilestones: MilestoneSnapshot[],
  ) => {
    if (!targetMap.size || !activeMilestones.length) return 0;
    let weightedSum = 0;
    let weightTotal = 0;
    for (const m of activeMilestones) {
      if (m.status === 'Not Applicable' || m.status === 'Disabled') continue;
      const wm = workMilestonesList?.find(
        x => x.work_milestone_name === m.work_milestone_name && x.work_header === header,
      );
      const w = wm?.weightage ?? 1.0;
      const t = targetMap.get(m.work_milestone_name);
      if (typeof t !== 'number') continue;
      weightedSum += w * t;
      weightTotal += w;
    }
    return weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  };

  // --- Filter Photos for Specific Comparison Dates ---
  const currentWorkPhotos = useMemo(() => {
    if (!latestReport?.attachments) return [];
    return latestReport.attachments.filter((a: any) => a.attach_type === 'Work');
  }, [latestReport]);

  const sevenDaysAgoWorkPhotos = useMemo(() => {
    if (!report7DaysAgo?.attachments) return [];
    return report7DaysAgo.attachments.filter((a: any) => a.attach_type === 'Work');
  }, [report7DaysAgo]);

  const fourteenDaysAgoWorkPhotos = useMemo(() => {
    if (!report14DaysAgo?.attachments) return [];
    return report14DaysAgo.attachments.filter((a: any) => a.attach_type === 'Work');
  }, [report14DaysAgo]);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);
  const [showPrintHeader, setShowPrintHeader] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showAdminDownloadDialog, setShowAdminDownloadDialog] = useState(false);

  // PDF Download handler
  const handleDownloadReport = async (includeTarget: boolean = false) => {
    if (!selectedProject) return;

    try {
      setIsDownloading(true);

      const headerParam = showPrintHeader ? '1' : '0';
      const adminParam = includeTarget ? '&is_admin=1' : '';
      const printUrl = `/api/method/frappe.utils.print_format.download_pdf?doctype=Projects&name=${encodeURIComponent(selectedProject)}&format=Overall%20Milestones%20Report&no_letterhead=0${selectedZone ? `&zone=${encodeURIComponent(selectedZone)}` : ''}&show_header=${headerParam}${adminParam}`;

      const response = await fetch(printUrl);
      if (!response.ok) throw new Error("Failed to generate PDF");
      const blob = await response.blob();

      const pName = (projectData?.project_name || "Project").replace(/\s+/g, '_');
      const dStr = format(new Date(), "dd-MMM-yyyy");
      const zoneSuffix = selectedZone ? `${selectedZone.replace(/\s+/g, '_')}` : "";

      const fileName = `${pName}-${zoneSuffix}-${dStr}_14Days_Report.pdf`;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(url);

    } catch (e) {
      console.error("PDF Download Error:", e);
      alert("Failed to download report. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

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

  // ---------------------------------------------------------------------------
  // Memoized grouped milestones
  // ---------------------------------------------------------------------------
  const groupedMilestones = useMemo(() => {
    if (!latestReport?.milestones) return {};

    const grouped = latestReport.milestones.reduce((acc, milestone) => {
      // Disabled rows are hidden from the summary entirely (not shown,
      // not counted, not included in any percentage rollup).
      if (milestone.status === 'Disabled') return acc;
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
  // Zone-level Target & Actual per snapshot — same nested rollup as Daily:
  //   per-header pct = milestone-weightage-weighted avg (N/A excluded)
  //   zone pct       = Σ (header_weightage × headerPct) / Σ header_weightage
  // Returns { actual, target } where either may be null when unavailable
  // (no report, or no targets in that snapshot).
  // ---------------------------------------------------------------------------
  const calculateZoneStats = (
    report: ReportDoc | null,
    targetMap: Map<string, number> | undefined,
  ): { actual: number | null; target: number | null } => {
    if (!report?.milestones?.length) return { actual: null, target: null };

    // Group key matches Daily's grouping exactly — uses work_header verbatim so
    // headerWeightageMap lookups don't silently miss on whitespace or fallbacks.
    // Disabled rows are excluded outright; Not Applicable rows are excluded
    // from rollups (but kept visible elsewhere).
    const groups = report.milestones.reduce((acc, m) => {
      if (m.status === 'Disabled') return acc;
      if (m.status === 'Not Applicable') return acc;
      const h = m.work_header;
      (acc[h] = acc[h] || []).push(m);
      return acc;
    }, {} as Record<string, MilestoneSnapshot[]>);

    let progWeightedSum = 0;
    let progHeaderWeight = 0;
    let targetWeightedSum = 0;
    let targetHeaderWeight = 0;

    for (const [header, milestones] of Object.entries(groups)) {
      const hw = headerWeightageMap?.[header] ?? 1;
      if (hw <= 0) continue;

      let pSum = 0, pWeight = 0, tSum = 0, tWeight = 0;
      for (const m of milestones) {
        const wm = workMilestonesList?.find(
          x => x.work_milestone_name === m.work_milestone_name && x.work_header === header,
        );
        const w = wm?.weightage ?? 1.0;
        const pVal = Number(m.progress) || 0;
        pSum += w * pVal;
        pWeight += w;

        if (targetMap) {
          const tVal = targetMap.get(m.work_milestone_name);
          if (typeof tVal === 'number') {
            tSum += w * tVal;
            tWeight += w;
          }
        }
      }

      if (pWeight > 0) {
        progWeightedSum += hw * (pSum / pWeight);
        progHeaderWeight += hw;
      }
      if (tWeight > 0) {
        targetWeightedSum += hw * (tSum / tWeight);
        targetHeaderWeight += hw;
      }
    }

    return {
      actual: progHeaderWeight > 0 ? Math.round(progWeightedSum / progHeaderWeight) : null,
      target: targetHeaderWeight > 0 ? Math.round(targetWeightedSum / targetHeaderWeight) : null,
    };
  };

  const zoneStatsCurrent = useMemo(
    () => calculateZoneStats(latestReport, isAdmin ? targetCurrent : undefined),
    [latestReport, targetCurrent, isAdmin, headerWeightageMap, workMilestonesList],
  );
  const zoneStatsSeven = useMemo(
    () => calculateZoneStats(report7DaysAgo, isAdmin ? target7d : undefined),
    [report7DaysAgo, target7d, isAdmin, headerWeightageMap, workMilestonesList],
  );
  const zoneStatsFourteen = useMemo(
    () => calculateZoneStats(report14DaysAgo, isAdmin ? target14d : undefined),
    [report14DaysAgo, target14d, isAdmin, headerWeightageMap, workMilestonesList],
  );

  const getPctColor = (pct: number) => {
    if (pct < 50) return '#dc2626';
    if (pct < 90) return '#d97706';
    return '#16a34a';
  };

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
      // Both Disabled and Not Applicable contribute 0 weight to the rollup.
      const effectiveWeightage =
        m.status === "Not Applicable" || m.status === "Disabled" ? 0 : weightage;

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
        <h2 className="text-xl font-bold mb-2">14 Days Work Report</h2>
        <div className="grid grid-cols-1 gap-2 mt-4 text-sm md:text-base">
          <p>Overall Completed: <span className="font-semibold">{latestReport.total_completed_works || 0}</span></p>
          <p>Number of packages: <span className="font-semibold">{latestReport.number_of_work_headers || 0}</span></p>
          <p>Total Manpower Used (till date): <span className="font-semibold">{latestReport.total_manpower_used_till_date || 0}</span></p>
        </div>
      </div>

      {/* Zone-level KPI strip — Current / 7 Days Ago / 14 Days Ago.
          Numbers use header_weightage from Work Headers (mirrors Daily Report
          Zone Target / Zone Overall logic). */}
      <div className="mb-6 bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-200">
          {([
            { title: 'CURRENT', report: latestReport, stats: zoneStatsCurrent },
            { title: '7 DAYS AGO', report: report7DaysAgo, stats: zoneStatsSeven },
            { title: '14 DAYS AGO', report: report14DaysAgo, stats: zoneStatsFourteen },
          ] as const).map(({ title, report, stats }) => (
            <div key={title} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{title}</span>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-500">
                  {report?.report_date ? formatDate(report.report_date) : '--'}
                </span>
              </div>
              {report ? (
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1">
                  {isAdmin && (
                    <>
                      <span className="text-sm font-semibold text-gray-600">Target:</span>
                      <span
                        className="text-lg font-extrabold"
                        style={{ color: getPctColor(stats.target ?? 0) }}
                      >
                        {stats.target ?? 0}%
                      </span>
                      <span className="text-gray-300">|</span>
                    </>
                  )}
                  <span className="text-sm font-semibold text-gray-600">Actual:</span>
                  <span
                    className="text-lg font-extrabold"
                    style={{ color: getPctColor(stats.actual ?? 0) }}
                  >
                    {stats.actual ?? 0}%
                  </span>
                </div>
              ) : (
                <div className="text-sm text-gray-400">No report available</div>
              )}
            </div>
          ))}
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

      {/* Client / Clearance Issues Section (Compariso) */}
      <div className="mb-8 space-y-8">
        <h3 className="text-xl font-bold border-b pb-2">Client / Clearance Issues Comparison</h3>

        {/* Helper function to render issues for a specific report */}
        {[
          { report: latestReport, title: "Current Report" },
          { report: report7DaysAgo, title: "7 Days Ago" },
          { report: report14DaysAgo, title: "14 Days Ago" }
        ].map(({ report, title }) => {
          if (!report) return null;

          return (
            <div key={title}>
              <h4 className="font-semibold text-lg text-gray-800 mb-3 flex items-center gap-2">
                {title}
                <span className="text-sm font-normal text-gray-500">
                  ({report.report_date ? formatDate(report.report_date, { month: 'short', day: 'numeric' }) : '--'})
                </span>
              </h4>

              <div className="flex flex-col gap-4">
                {/* Drawing Issues Card */}
                <div className="bg-white rounded-xl shadow-sm border border-orange-200 overflow-hidden flex flex-col h-full">
                  <div className="bg-gradient-to-r from-orange-50 to-orange-100 px-4 py-3 border-b border-orange-200 flex items-center gap-2">
                    <div className="p-1.5 bg-orange-500 rounded-lg">
                      <FileText className="h-4 w-4 text-white" />
                    </div>
                    <h4 className="font-semibold text-orange-900">Drawing Approvals Remarks</h4>
                  </div>

                  <div className="p-4 flex-1 flex flex-col gap-4">
                    {/* Remarks */}
                    <div className="flex-1">
                      {report.drawing_remarks && report.drawing_remarks.trim() !== "" ? (
                        <ul className="space-y-2">
                          {report.drawing_remarks.split("$#,,,").filter((item: string) => item.trim() !== "").map((remark: string, idx: number) => (
                            <li key={`drawing-${idx}`} className="flex items-start gap-2 text-sm text-gray-700 bg-orange-50/50 p-2 rounded-md border border-orange-100">
                              <span className="flex-shrink-0 w-5 h-5 bg-orange-200 text-orange-800 text-xs font-bold rounded-full flex items-center justify-center mt-0.5">
                                {idx + 1}
                              </span>
                              <span className="break-words">{remark.trim()}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-center py-6 px-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                          <p className="text-sm text-gray-400 italic">No drawing issues reported</p>
                        </div>
                      )}
                    </div>

                    {/* Photos */}
                    {report.attachments?.filter((a: any) => a.attach_type === 'Drawing').length > 0 && (
                      <div className="mt-auto pt-4 border-t border-orange-100">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Attached Photos</p>
                        <ImageBentoGrid
                          images={(report.attachments || []).filter((a: any) => a.attach_type === 'Drawing')}
                          forPdf={false}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Site Issues Card */}
                <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden flex flex-col h-full">
                  <div className="bg-gradient-to-r from-red-50 to-red-100 px-4 py-3 border-b border-red-200 flex items-center gap-2">
                    <div className="p-1.5 bg-red-500 rounded-lg">
                      <MapPin className="h-4 w-4 text-white" />
                    </div>
                    <h4 className="font-semibold text-red-900">Site Clearence Remarks</h4>
                  </div>

                  <div className="p-4 flex-1 flex flex-col gap-4">
                    {/* Remarks */}
                    <div className="flex-1">
                      {report.site_remarks && report.site_remarks.trim() !== "" ? (
                        <ul className="space-y-2">
                          {report.site_remarks.split("$#,,,").filter((item: string) => item.trim() !== "").map((remark: string, idx: number) => (
                            <li key={`site-${idx}`} className="flex items-start gap-2 text-sm text-gray-700 bg-red-50/50 p-2 rounded-md border border-red-100">
                              <span className="flex-shrink-0 w-5 h-5 bg-red-200 text-red-800 text-xs font-bold rounded-full flex items-center justify-center mt-0.5">
                                {idx + 1}
                              </span>
                              <span className="break-words">{remark.trim()}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-center py-6 px-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                          <p className="text-sm text-gray-400 italic">No site issues reported</p>
                        </div>
                      )}
                    </div>

                    {/* Photos */}
                    {report.attachments?.filter((a: any) => a.attach_type === 'Site').length > 0 && (
                      <div className="mt-auto pt-4 border-t border-red-100">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Attached Photos</p>
                        <ImageBentoGrid
                          images={(report.attachments || []).filter((a: any) => a.attach_type === 'Site')}
                          forPdf={false}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

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
                <Table className={`w-full ${isAdmin ? 'min-w-[1500px]' : 'min-w-[1200px]'}`}>
                  <TableHeader className="bg-gray-100">

                    {/* 1. TOP HEADER ROW — date headers */}
                    <TableRow>
                      <TableHead
                        className="font-semibold text-gray-700 text-sm py-2 text-left align-bottom"
                        rowSpan={isAdmin ? 3 : 2}
                      >
                        Work
                      </TableHead>
                      <TableHead className="text-center font-semibold text-gray-700 text-sm py-2 border-r" colSpan={isAdmin ? 4 : 3}>
                        Current ({latestReport.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric' }) : '--'})
                      </TableHead>
                      <TableHead className="text-center font-semibold text-gray-700 text-sm py-2 border-r" colSpan={isAdmin ? 4 : 3}>
                        7 Days Ago ({report7DaysAgo?.report_date ? formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'})
                      </TableHead>
                      <TableHead className="text-center font-semibold text-gray-700 text-sm py-2 border-r" colSpan={isAdmin ? 4 : 3}>
                        14 Days Ago ({report14DaysAgo?.report_date ? formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric' }) : '--'})
                      </TableHead>
                    </TableRow>

                    {/* 2. SUB-HEADER ROW — Status | Done | Remarks per snapshot */}
                    <TableRow className="bg-gray-200">
                      {[0, 1, 2].map(i => (
                        <React.Fragment key={i}>
                          <TableHead className="text-center font-semibold text-gray-700 text-sm py-2" rowSpan={isAdmin ? 2 : 1}>Status</TableHead>
                          <TableHead className="text-center font-semibold text-gray-700 text-sm py-2" colSpan={isAdmin ? 2 : 1}>Done</TableHead>
                          <TableHead className="text-center font-semibold text-gray-700 text-sm py-2 border-r" rowSpan={isAdmin ? 2 : 1}>Remarks</TableHead>
                        </React.Fragment>
                      ))}
                    </TableRow>

                    {/* 3. SUB-SUB-HEADER ROW — Target | Actual under Done (admin only) */}
                    {isAdmin && (
                      <TableRow className="bg-gray-300">
                        {[0, 1, 2].map(i => (
                          <React.Fragment key={i}>
                            <TableHead className="text-center font-semibold text-gray-700 text-xs py-1">Target</TableHead>
                            <TableHead className="text-center font-semibold text-gray-700 text-xs py-1">Actual</TableHead>
                          </React.Fragment>
                        ))}
                      </TableRow>
                    )}
                  </TableHeader>

                  {/* TABLE BODY */}
                  <TableBody>

                    {/* --- SUMMARY ROW — Overall Progress (and Target if admin) --- */}
                    {(() => {
                      const currentHeaderTarget = isAdmin ? calculateHeaderTarget(targetCurrent, header, activeMilestones) : 0;
                      const sevenHeaderTarget = isAdmin ? calculateHeaderTarget(target7d, header, activeMilestones) : 0;
                      const fourteenHeaderTarget = isAdmin ? calculateHeaderTarget(target14d, header, activeMilestones) : 0;

                      const renderSummaryCell = (report: ReportDoc | null, target: number, actual: number) => {
                        if (!report) {
                          return (
                            <TableCell colSpan={isAdmin ? 4 : 3} className="py-2 px-2 text-center border-r">
                              <span className="text-gray-400 text-xs">--</span>
                            </TableCell>
                          );
                        }
                        if (!isAdmin) {
                          return (
                            <TableCell colSpan={3} className="py-2 px-2 text-center border-r">
                              <MilestoneProgress
                                milestoneStatus="Completed"
                                value={actual}
                                sizeClassName="size-[44px]"
                                textSizeClassName="text-xs"
                              />
                            </TableCell>
                          );
                        }
                        // Admin: Status (1 col, blank) + Target + Actual + Remarks (1 col, blank)
                        return (
                          <>
                            <TableCell className="py-2 px-2" />
                            <TableCell className="py-2 px-2 text-center">
                              <MilestoneProgress
                                milestoneStatus="In Progress"
                                value={target}
                                sizeClassName="size-[44px]"
                                textSizeClassName="text-xs"
                              />
                            </TableCell>
                            <TableCell className="py-2 px-2 text-center">
                              <MilestoneProgress
                                milestoneStatus="Completed"
                                value={actual}
                                sizeClassName="size-[44px]"
                                textSizeClassName="text-xs"
                              />
                            </TableCell>
                            <TableCell className="py-2 px-2 border-r" />
                          </>
                        );
                      };

                      return (
                        <TableRow className="bg-gray-50 border-b-2 border-gray-100 bg-gray-300 align-middle">
                          <TableCell className="py-2 px-4 text-sm font-bold text-gray-800">
                            Overall Progress
                          </TableCell>
                          {renderSummaryCell(latestReport, currentHeaderTarget, currentAvg)}
                          {renderSummaryCell(report7DaysAgo, sevenHeaderTarget, sevenDaysAvg)}
                          {renderSummaryCell(report14DaysAgo, fourteenHeaderTarget, fourteenDaysAvg)}
                        </TableRow>
                      );
                    })()}

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
                            sizeClassName="size-[40px]"
                            textSizeClassName="text-xs"
                          />
                        </TableCell>
                      );

                      const renderTargetCell = (
                        targetMap: Map<string, number>,
                        status: string,
                      ) => {
                        // N/A milestones don't have a meaningful target — render
                        // N/A like the Actual Progress cell does for the same row.
                        if (status === 'Not Applicable') {
                          return (
                            <TableCell className="text-center py-3 px-2 text-sm font-medium">
                              <MilestoneProgress
                                milestoneStatus="Not Applicable"
                                value={0}
                                sizeClassName="size-[40px]"
                                textSizeClassName="text-md"
                              />
                            </TableCell>
                          );
                        }
                        const t = targetMap.get(milestone.work_milestone_name);
                        return (
                          <TableCell className="text-center py-3 px-2 text-sm font-medium">
                            {typeof t === 'number' ? (
                              <MilestoneProgress
                                milestoneStatus="In Progress"
                                value={Number(t.toFixed(1))}
                                sizeClassName="size-[40px]"
                                textSizeClassName="text-md"
                              />
                            ) : <span className="text-gray-400 text-xs">--</span>}
                          </TableCell>
                        );
                      };

                      return (
                        <TableRow key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} align-middle`}>
                          <TableCell className="py-3 px-4 text-sm break-words">{idx + 1}. {milestone.work_milestone_name}</TableCell>

                          {/* CURRENT */}
                          <TableCell className="text-center py-3 px-2">
                            <Badge variant="secondary" className={`${getStatusBadgeClasses(currentData.status)} text-xs`}>
                              {currentData.status}
                            </Badge>
                          </TableCell>
                          {isAdmin && renderTargetCell(targetCurrent, currentData.status)}
                          {renderProgressCell(currentData)}
                          {renderRemarksCell(currentData.remarks)}

                          {/* 7 DAYS */}
                          <TableCell className="text-center py-3 px-2">
                            {report7DaysAgo ? (
                              <Badge variant="secondary" className={`${getStatusBadgeClasses(sevenDaysAgoData.status)} text-xs`}>{sevenDaysAgoData.status}</Badge>
                            ) : <span className="text-gray-400 text-xs">N/A</span>}
                          </TableCell>
                          {isAdmin && (report7DaysAgo ? renderTargetCell(target7d, sevenDaysAgoData.status) : <TableCell className="text-center text-gray-400 text-xs">--</TableCell>)}
                          {report7DaysAgo ? renderProgressCell(sevenDaysAgoData) : <TableCell className="text-center text-gray-400 text-xs">N/A</TableCell>}
                          {report7DaysAgo ? renderRemarksCell(sevenDaysAgoData.remarks) : <TableCell className="text-center text-gray-400 text-xs border-r">N/A</TableCell>}

                          {/* 14 DAYS */}
                          <TableCell className="text-center py-3 px-2">
                            {report14DaysAgo ? (
                              <Badge variant="secondary" className={`${getStatusBadgeClasses(fourteenDaysAgoData.status)} text-xs`}>{fourteenDaysAgoData.status}</Badge>
                            ) : <span className="text-gray-400 text-xs">N/A</span>}
                          </TableCell>
                          {isAdmin && (report14DaysAgo ? renderTargetCell(target14d, fourteenDaysAgoData.status) : <TableCell className="text-center text-gray-400 text-xs">--</TableCell>)}
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

      <div className="mt-8 space-y-8">
        <h3 className="text-xl font-bold border-b pb-2">Work Images Comparison</h3>

        {/* Current Photos */}
        <div>
          <h4 className="font-semibold text-lg text-gray-800 mb-3 flex items-center gap-2">
            Current Report
            <span className="text-sm font-normal text-gray-500">
              ({latestReport?.report_date ? formatDate(latestReport.report_date, { month: 'short', day: 'numeric' }) : '--'})
            </span>
          </h4>
          {currentWorkPhotos.length > 0 ? (
            <ImageBentoGrid images={currentWorkPhotos} forPdf={false} />
          ) : (
            <div className="text-center py-6 bg-gray-50 border border-dashed rounded text-gray-400 text-sm">No work images for current report</div>
          )}
        </div>

        {/* 7 Days Ago Photos */}
        {report7DaysAgo && (
          <div>
            <h4 className="font-semibold text-lg text-gray-800 mb-3 flex items-center gap-2">
              7 Days Ago
              <span className="text-sm font-normal text-gray-500">
                ({formatDate(report7DaysAgo.report_date, { month: 'short', day: 'numeric' })})
              </span>
            </h4>
            {sevenDaysAgoWorkPhotos.length > 0 ? (
              <ImageBentoGrid images={sevenDaysAgoWorkPhotos} forPdf={false} />
            ) : (
              <div className="text-center py-6 bg-gray-50 border border-dashed rounded text-gray-400 text-sm">No work images for 7 days ago</div>
            )}
          </div>
        )}

        {/* 14 Days Ago Photos */}
        {report14DaysAgo && (
          <div>
            <h4 className="font-semibold text-lg text-gray-800 mb-3 flex items-center gap-2">
              14 Days Ago
              <span className="text-sm font-normal text-gray-500">
                ({formatDate(report14DaysAgo.report_date, { month: 'short', day: 'numeric' })})
              </span>
            </h4>
            {fourteenDaysAgoWorkPhotos.length > 0 ? (
              <ImageBentoGrid images={fourteenDaysAgoWorkPhotos} forPdf={false} />
            ) : (
              <div className="text-center py-6 bg-gray-50 border border-dashed rounded text-gray-400 text-sm">No work images for 14 days ago</div>
            )}
          </div>
        )}
      </div>

      {/* PDF Download Button */}
      <div className="mt-8 flex justify-end gap-2">
        {latestReport && projectData && (
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
              onClick={() => {
                if (isAdmin) {
                  setShowAdminDownloadDialog(true);
                } else {
                  handleDownloadReport(false);
                }
              }}
              disabled={isDownloading}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white disabled:bg-red-400"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating PDF...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Download Report
                </>
              )}
            </Button>
          </>
        )}

        {/* Client-side PDF Download */}
        {/* <OverallMilestonesReportPDF
          latestReport={latestReport}
          report7DaysAgo={report7DaysAgo}
          report14DaysAgo={report14DaysAgo}
          projectData={projectData}
          selectedZone={selectedZone}
        /> */}
      </div>

      {/* Admin: choose whether the PDF should include Target Progress */}
      <AlertDialog open={showAdminDownloadDialog} onOpenChange={setShowAdminDownloadDialog}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-600">
                <Download className="h-4 w-4" />
              </div>
              <AlertDialogTitle className="text-lg">Download 14 Days Report</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm text-slate-600 leading-relaxed">
              Choose a version of the PDF. The admin version splits the{' '}
              <span className="font-semibold text-slate-800">Done</span> column into{' '}
              <span className="font-semibold text-slate-800">Target</span> and{' '}
              <span className="font-semibold text-slate-800">Actual</span> sub-columns for each snapshot.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-2">
            <AlertDialogCancel className="mt-0 sm:mt-0">Cancel</AlertDialogCancel>
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <Button
               
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => {
                  setShowAdminDownloadDialog(false);
                  handleDownloadReport(false);
                }}
              >
                Without Target Progress
              </Button>
              <AlertDialogAction
                onClick={() => {
                  setShowAdminDownloadDialog(false);
                  handleDownloadReport(true);
                }}
                 className="bg-green-600 hover:bg-green-700 text-white"
              >
                With Target Progress
              </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>



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
