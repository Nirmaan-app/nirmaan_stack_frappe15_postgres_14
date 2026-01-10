import { useMemo, useState, useEffect } from 'react';
import { useFrappeGetDoc, useFrappeGetDocList } from 'frappe-react-sdk';
import { useWorkHeaderOrder } from '@/hooks/useWorkHeaderOrder';
import { formatDateForInput, parseWorkPlan } from '../utils/milestoneHelpers';

// --- Types ---
interface ProjectZoneEntry {
  name?: string;
  zone_name: string;
}

interface UseMilestoneReportDataProps {
  projectId: string | null;
  selectedZone: string | null;
  displayDate: Date;
  reportType: 'Daily' | 'Overall';
}

interface UseMilestoneReportDataReturn {
  // Data
  projectData: any;
  dailyReportDetails: any;
  workPlanGroups: [string, any[]][];
  milestoneGroups: [string, any[]][];
  validationZoneProgress: Map<string, { status: string; name: string }>;

  // Metrics
  totalWorkHeaders: number;
  completedWorksOnReport: number;
  totalManpowerInReport: number;

  // Loading states
  isLoading: boolean;
  projectLoading: boolean;
  reportLoading: boolean;

  // Errors
  projectError: any;

  // Report state
  reportForDisplayDateName: string | null;

  // Mutate functions (for refetch after delete)
  mutateProgressReports: (() => void) | undefined;
  mutateAllReportsForDate: (() => void) | undefined;

  // Helpers
  workHeaderOrderMap: Record<string, number>;
  workMilestonesList: any[];
}

export const useMilestoneReportData = ({
  projectId,
  selectedZone,
  displayDate,
  reportType,
}: UseMilestoneReportDataProps): UseMilestoneReportDataReturn => {
  // State to hold the matched report name
  const [reportForDisplayDateName, setReportForDisplayDateName] = useState<string | null>(null);

  // --- Data Fetching ---

  // Fetch project data
  const {
    data: projectData,
    isLoading: projectLoading,
    error: projectError,
  } = useFrappeGetDoc('Projects', projectId || '', projectId ? undefined : null);

  // Fetch Work Headers ordering
  const { workHeaderOrderMap } = useWorkHeaderOrder();

  // Fetch Work Milestones for ordering and weightage
  const { data: workMilestonesList } = useFrappeGetDocList('Work Milestones', {
    fields: ['work_milestone_name', 'work_milestone_order', 'work_header', 'weightage'],
    limit: 0,
  });

  // Fetch list of completed Project Progress Reports for the zone
  const {
    data: projectProgressReports,
    isLoading: projectProgressLoading,
    mutate: mutateProgressReports,
  } = useFrappeGetDocList(
    'Project Progress Reports',
    {
      fields: ['name', 'report_date', 'project', 'report_zone'],
      limit: 0,
      filters: [
        ['project', '=', projectId],
        ['report_zone', '=', selectedZone],
        ['report_status', '=', 'Completed'],
      ],
    },
    projectId && selectedZone && reportType === 'Daily' ? undefined : null
  );

  // Fetch all reports for the specific date (for zone status validation)
  const {
    data: allReportsForDate,
    isLoading: allReportsLoading,
    mutate: mutateAllReportsForDate,
  } = useFrappeGetDocList(
    'Project Progress Reports',
    {
      fields: ['name', 'report_zone', 'report_status'],
      limit: 0,
      filters: [
        ['project', '=', projectId],
        ['report_date', '=', formatDateForInput(displayDate)],
      ],
    },
    projectId && displayDate ? undefined : null
  );

  // Fetch the detailed daily report
  const {
    data: dailyReportDetails,
    isLoading: dailyReportLoading,
  } = useFrappeGetDoc(
    'Project Progress Reports',
    reportForDisplayDateName || '',
    reportForDisplayDateName && reportType === 'Daily' ? undefined : null
  );

  // --- Effects ---

  // Effect to determine reportForDisplayDateName based on project, zone, and date
  useEffect(() => {
    if (projectProgressReports && projectId && displayDate && selectedZone && reportType === 'Daily') {
      const selectedDateFormatted = formatDateForInput(displayDate);

      const foundReport = projectProgressReports.find(
        (report: any) =>
          formatDateForInput(new Date(report.report_date)) === selectedDateFormatted &&
          report.report_zone === selectedZone
      );

      setReportForDisplayDateName(foundReport ? foundReport.name : null);
    } else if (reportType === 'Overall') {
      setReportForDisplayDateName(null);
    } else {
      setReportForDisplayDateName(null);
    }
  }, [projectProgressReports, projectId, displayDate, selectedZone, reportType]);

  // --- Memoized Computations ---

  // Work Plan Groups (WIP/Not Started milestones with work plan content)
  const workPlanGroups = useMemo(() => {
    if (!dailyReportDetails?.milestones || reportType !== 'Daily') return [];

    const grouped = dailyReportDetails.milestones.reduce((acc: any, milestone: any) => {
      const isWIPOrNotStarted = milestone.status === 'WIP' || milestone.status === 'Not Started';
      const hasWorkPlanContent = milestone.work_plan && parseWorkPlan(milestone.work_plan).length > 0;

      if (hasWorkPlanContent || isWIPOrNotStarted) {
        (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
      }
      return acc;
    }, {});

    // Sort milestones within each group
    Object.keys(grouped).forEach((header) => {
      grouped[header].sort((a: any, b: any) => {
        const orderA =
          workMilestonesList?.find(
            (m) => m.work_milestone_name === a.work_milestone_name && m.work_header === header
          )?.work_milestone_order ?? 9999;
        const orderB =
          workMilestonesList?.find(
            (m) => m.work_milestone_name === b.work_milestone_name && m.work_header === header
          )?.work_milestone_order ?? 9999;
        return orderA - orderB;
      });
    });

    // Sort headers and return as entries
    return Object.entries(grouped)
      .filter(([_, milestones]) => (milestones as any[]).length > 0)
      .sort(([headerA], [headerB]) => {
        const orderA = workHeaderOrderMap[headerA] ?? 9999;
        const orderB = workHeaderOrderMap[headerB] ?? 9999;
        return orderA - orderB;
      }) as [string, any[]][];
  }, [dailyReportDetails, reportType, workHeaderOrderMap, workMilestonesList]);

  // Milestone Groups (all milestones grouped by header)
  const milestoneGroups = useMemo(() => {
    if (!dailyReportDetails?.milestones) return [];

    const grouped = dailyReportDetails.milestones.reduce((acc: any, milestone: any) => {
      (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
      return acc;
    }, {});

    // Sort milestones within each group
    Object.keys(grouped).forEach((header) => {
      grouped[header].sort((a: any, b: any) => {
        const orderA =
          workMilestonesList?.find(
            (m) => m.work_milestone_name === a.work_milestone_name && m.work_header === header
          )?.work_milestone_order ?? 9999;
        const orderB =
          workMilestonesList?.find(
            (m) => m.work_milestone_name === b.work_milestone_name && m.work_header === header
          )?.work_milestone_order ?? 9999;
        return orderA - orderB;
      });
    });

    // Sort headers and return as entries
    return Object.entries(grouped).sort(([headerA], [headerB]) => {
      const orderA = workHeaderOrderMap[headerA] ?? 9999;
      const orderB = workHeaderOrderMap[headerB] ?? 9999;
      return orderA - orderB;
    }) as [string, any[]][];
  }, [dailyReportDetails, workHeaderOrderMap, workMilestonesList]);

  // Zone validation progress map
  const validationZoneProgress = useMemo(() => {
    if (!projectData?.project_zones || !allReportsForDate) {
      return new Map<string, { status: string; name: string }>();
    }

    const reportStatusMap = new Map<string, { status: string; name: string }>();
    allReportsForDate.forEach((report: any) => {
      reportStatusMap.set(report.report_zone, { status: report.report_status, name: report.name });
    });

    return reportStatusMap;
  }, [projectData?.project_zones, allReportsForDate]);

  // --- Metrics ---
  const totalWorkHeaders = dailyReportDetails?.milestones?.length || 0;
  const completedWorksOnReport =
    dailyReportDetails?.milestones?.filter((m: any) => m.status === 'Completed').length || 0;
  const totalManpowerInReport =
    dailyReportDetails?.manpower?.reduce((sum: number, mp: any) => sum + Number(mp.count || 0), 0) || 0;

  // --- Loading State ---
  const isLoading = projectLoading || projectProgressLoading || dailyReportLoading || allReportsLoading;
  const reportLoading = dailyReportLoading;

  return {
    // Data
    projectData,
    dailyReportDetails,
    workPlanGroups,
    milestoneGroups,
    validationZoneProgress,

    // Metrics
    totalWorkHeaders,
    completedWorksOnReport,
    totalManpowerInReport,

    // Loading states
    isLoading,
    projectLoading,
    reportLoading,

    // Errors
    projectError,

    // Report state
    reportForDisplayDateName,

    // Mutate functions
    mutateProgressReports,
    mutateAllReportsForDate,

    // Helpers
    workHeaderOrderMap,
    workMilestonesList: workMilestonesList || [],
  };
};
