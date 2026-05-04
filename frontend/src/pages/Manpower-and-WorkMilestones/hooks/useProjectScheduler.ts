import { useMemo } from 'react';
import { useFrappeGetDoc, useFrappeGetDocList } from 'frappe-react-sdk';
import { useWorkHeaderOrder } from '@/hooks/useWorkHeaderOrder';

export const NUM_WEEK_SLOTS = 9;

export interface SchedulerMilestoneRow {
  name: string;
  work_milestone_name: string;
  work_header: string;
  work_milestone_order: number;
  weightage: number;
  weeks: number[];
  firstWeekIdx: number;
  lastWeekIdx: number;
  isCompletePlan: boolean;
  startDate: Date | null;
  endDate: Date | null;
  durationDays: number;
}

export interface SchedulerHeaderGroup {
  header: string;
  order: number;
  weightage: number;
  milestones: SchedulerMilestoneRow[];
  earliestStart: Date | null;
  latestEnd: Date | null;
}

interface UseProjectSchedulerResult {
  projectData: any;
  projectStartDate: Date | null;
  projectEndDate: Date | null;
  projectDurationDays: number;
  weekSlotDays: number;
  weekSlotBoundaries: Date[];
  groups: SchedulerHeaderGroup[];
  isLoading: boolean;
  error: any;
  mutateProject: () => Promise<any>;
}

const parseDate = (raw?: string | null): Date | null => {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
};

const addDays = (date: Date, days: number): Date => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

export const useProjectScheduler = (projectId: string | null | undefined): UseProjectSchedulerResult => {
  const {
    data: projectData,
    isLoading: projectLoading,
    error: projectError,
    mutate: mutateProject,
  } = useFrappeGetDoc('Projects', projectId || '', projectId ? undefined : null);

  const { workHeaderOrderMap, headerWeightageMap, workHeadersLoading } = useWorkHeaderOrder();

  const enabledHeaders = useMemo<string[]>(() => {
    const entries = projectData?.project_work_header_entries || [];
    return entries
      .filter((e: any) => e?.enabled)
      .map((e: any) => e.project_work_header_name)
      .filter(Boolean);
  }, [projectData]);

  const {
    data: workMilestonesList,
    isLoading: milestonesLoading,
  } = useFrappeGetDocList(
    'Work Milestones',
    {
      fields: [
        'name',
        'work_milestone_name',
        'work_milestone_order',
        'work_header',
        'weightage',
        'week_1', 'week_2', 'week_3', 'week_4', 'week_5',
        'week_6', 'week_7', 'week_8', 'week_9',
      ],
      filters: enabledHeaders.length > 0 ? [['work_header', 'in', enabledHeaders]] : undefined,
      limit: 0,
    },
    enabledHeaders.length > 0 ? undefined : null
  );

  const projectStartDate = useMemo(() => parseDate(projectData?.project_start_date), [projectData]);
  const projectEndDate = useMemo(() => parseDate(projectData?.project_end_date), [projectData]);

  const projectDurationDays = useMemo(() => {
    if (!projectStartDate || !projectEndDate) return 0;
    const diff = Math.round((projectEndDate.getTime() - projectStartDate.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(diff + 1, 0);
  }, [projectStartDate, projectEndDate]);

  const weekSlotDays = useMemo(() => {
    if (projectDurationDays <= 0) return 0;
    return projectDurationDays / NUM_WEEK_SLOTS;
  }, [projectDurationDays]);

  const weekSlotBoundaries = useMemo<Date[]>(() => {
    if (!projectStartDate || weekSlotDays <= 0) return [];
    const boundaries: Date[] = [];
    for (let i = 0; i <= NUM_WEEK_SLOTS; i++) {
      boundaries.push(addDays(projectStartDate, Math.round(i * weekSlotDays)));
    }
    return boundaries;
  }, [projectStartDate, weekSlotDays]);

  const groups = useMemo<SchedulerHeaderGroup[]>(() => {
    if (!workMilestonesList || enabledHeaders.length === 0) return [];

    const byHeader = new Map<string, SchedulerMilestoneRow[]>();
    enabledHeaders.forEach((h) => byHeader.set(h, []));

    workMilestonesList.forEach((m: any) => {
      const weeks: number[] = [
        m.week_1, m.week_2, m.week_3, m.week_4, m.week_5,
        m.week_6, m.week_7, m.week_8, m.week_9,
      ].map((v) => Number(v) || 0);

      let firstWeekIdx = -1;
      let lastNonZeroIdx = -1;
      let completionWeekIdx = -1;
      for (let i = 0; i < NUM_WEEK_SLOTS; i++) {
        if (weeks[i] > 0) {
          if (firstWeekIdx === -1) firstWeekIdx = i;
          lastNonZeroIdx = i;
        }
        if (completionWeekIdx === -1 && weeks[i] >= 100) {
          completionWeekIdx = i;
        }
      }
      const lastWeekIdx = completionWeekIdx !== -1 ? completionWeekIdx : lastNonZeroIdx;
      const isCompletePlan = completionWeekIdx !== -1;

      let startDate: Date | null = null;
      let endDate: Date | null = null;
      let durationDays = 0;

      if (firstWeekIdx !== -1 && projectStartDate && weekSlotDays > 0) {
        startDate = addDays(projectStartDate, Math.round(firstWeekIdx * weekSlotDays));
        endDate = addDays(projectStartDate, Math.round((lastWeekIdx + 1) * weekSlotDays) - 1);
        durationDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      }

      const row: SchedulerMilestoneRow = {
        name: m.name,
        work_milestone_name: m.work_milestone_name,
        work_header: m.work_header,
        work_milestone_order: Number(m.work_milestone_order ?? 9999),
        weightage: Number(m.weightage ?? 0),
        weeks,
        firstWeekIdx,
        lastWeekIdx,
        isCompletePlan,
        startDate,
        endDate,
        durationDays,
      };

      const list = byHeader.get(m.work_header);
      if (list) list.push(row);
    });

    const result: SchedulerHeaderGroup[] = [];
    byHeader.forEach((milestones, header) => {
      milestones.sort((a, b) => a.work_milestone_order - b.work_milestone_order);

      let earliestStart: Date | null = null;
      let latestEnd: Date | null = null;
      milestones.forEach((m) => {
        if (m.startDate && (!earliestStart || m.startDate < earliestStart)) earliestStart = m.startDate;
        if (m.endDate && (!latestEnd || m.endDate > latestEnd)) latestEnd = m.endDate;
      });

      result.push({
        header,
        order: workHeaderOrderMap[header] ?? 9999,
        weightage: headerWeightageMap[header] ?? 1,
        milestones,
        earliestStart,
        latestEnd,
      });
    });

    result.sort((a, b) => a.order - b.order);
    return result;
  }, [workMilestonesList, enabledHeaders, projectStartDate, weekSlotDays, workHeaderOrderMap, headerWeightageMap]);

  return {
    projectData,
    projectStartDate,
    projectEndDate,
    projectDurationDays,
    weekSlotDays,
    weekSlotBoundaries,
    groups,
    isLoading: projectLoading || workHeadersLoading || milestonesLoading,
    error: projectError,
    mutateProject,
  };
};
