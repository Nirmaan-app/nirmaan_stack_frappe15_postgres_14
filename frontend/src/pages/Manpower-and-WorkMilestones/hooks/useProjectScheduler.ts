import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall } from 'frappe-react-sdk';
import { useWorkHeaderOrder } from '@/hooks/useWorkHeaderOrder';
import type { ProjectSchedule } from '@/types/NirmaanStack/ProjectSchedule';
import type { ProjectScheduleMilestone } from '@/types/NirmaanStack/ProjectScheduleMilestone';

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
  // Persistence-layer fields. `rowName` is null until ensure_project_schedule
  // has run for this project (e.g. on a freshly-loaded tab before the
  // post-call resolves).
  rowName: string | null;
  editedByUser: string | null;
  changedByUser: boolean;
  /** True when this milestone is marked `Disabled` in the latest completed
   *  Project Progress Report. UI uses this to lock edits and skip in the PDF. */
  disabledByReport: boolean;
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
  refetchSchedule: () => Promise<void>;
  updateMilestoneDates: (rowName: string, startISO: string | null, endISO: string | null) => Promise<void>;
  resetMilestoneDates: (rowName: string) => Promise<void>;
  scheduleDoc: ProjectSchedule | null;
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

  // ── Persistence layer: read-only fetch ─────────────────────────────────
  // The Schedule tab does NOT create the Project Schedule on render. Creation
  // is owned by Projects.after_insert / on_update hooks and the Setup
  // Progress Tracking wizard. If the schedule doesn't exist for this project
  // yet, the grid still renders with formula-derived dates (no overrides,
  // pencil edit disabled).
  const { call: getScheduleCall } = useFrappePostCall(
    'nirmaan_stack.api.milestone.project_schedule.get_project_schedule'
  );
  const { call: updateMilestoneDatesCall } = useFrappePostCall(
    'nirmaan_stack.api.milestone.project_schedule.update_milestone_dates'
  );
  const { call: resetMilestoneDatesCall } = useFrappePostCall(
    'nirmaan_stack.api.milestone.project_schedule.reset_milestone_dates'
  );

  const [scheduleDoc, setScheduleDoc] = useState<ProjectSchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState<boolean>(false);

  const refetchSchedule = useCallback(async () => {
    if (!projectId) return;
    setScheduleLoading(true);
    try {
      const res: any = await getScheduleCall({ project_id: projectId });
      const payload = res?.message ?? res ?? {};
      const schedule = (payload.schedule ?? null) as ProjectSchedule | null;
      const disabled = (payload.disabled_milestones ?? []) as string[];
      // Preserve the disabled list on the doc shape the rest of the hook
      // consumes via overridesByMilestone / disabledMilestoneSet.
      setScheduleDoc(schedule ? { ...schedule, disabled_milestones: disabled } : (
        // No schedule doc — but still expose disabled_milestones so the grid
        // can grey-out / strike-through milestones marked Disabled in the
        // latest Project Progress Report.
        { name: '', project: projectId, milestones: [], disabled_milestones: disabled } as unknown as ProjectSchedule
      ));
    } finally {
      setScheduleLoading(false);
    }
  }, [projectId, getScheduleCall]);

  // Re-ensure whenever the project's enabled-headers set changes, so the
  // schedule's child rows reconcile to match. The call is cheap and
  // idempotent server-side.
  useEffect(() => {
    if (!projectId) {
      setScheduleDoc(null);
      return;
    }
    refetchSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, enabledHeaders.join('|')]);

  const overridesByMilestone = useMemo<Record<string, ProjectScheduleMilestone>>(() => {
    const map: Record<string, ProjectScheduleMilestone> = {};
    (scheduleDoc?.milestones || []).forEach((row) => {
      if (row.work_milestone) map[row.work_milestone] = row;
    });
    return map;
  }, [scheduleDoc]);

  const disabledMilestoneSet = useMemo<Set<string>>(
    () => new Set(scheduleDoc?.disabled_milestones || []),
    [scheduleDoc],
  );

  const updateMilestoneDates = useCallback(
    async (rowName: string, startISO: string | null, endISO: string | null) => {
      if (!projectId) return;
      await updateMilestoneDatesCall({
        project_id: projectId,
        milestone_row_name: rowName,
        start_date: startISO || '',
        end_date: endISO || '',
      });
      await refetchSchedule();
    },
    [projectId, updateMilestoneDatesCall, refetchSchedule]
  );

  const resetMilestoneDates = useCallback(
    async (rowName: string) => {
      if (!projectId) return;
      await resetMilestoneDatesCall({
        project_id: projectId,
        milestone_row_name: rowName,
      });
      await refetchSchedule();
    },
    [projectId, resetMilestoneDatesCall, refetchSchedule]
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

      // Default formula-derived dates
      let startDate: Date | null = null;
      let endDate: Date | null = null;
      let durationDays = 0;
      if (firstWeekIdx !== -1 && projectStartDate && weekSlotDays > 0) {
        startDate = addDays(projectStartDate, Math.round(firstWeekIdx * weekSlotDays));
        endDate = addDays(projectStartDate, Math.round((lastWeekIdx + 1) * weekSlotDays) - 1);
        durationDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      }

      // Apply persisted override if both dates present.
      // Project Schedule.milestones[].work_milestone stores the human-readable
      // `work_milestone_name` (not the master's hash `name`), so look up by that.
      const override = overridesByMilestone[m.work_milestone_name];
      if (override && override.start_date && override.end_date) {
        const oStart = parseDate(override.start_date);
        const oEnd = parseDate(override.end_date);
        if (oStart && oEnd) {
          startDate = oStart;
          endDate = oEnd;
          durationDays = Math.round((oEnd.getTime() - oStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        }
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
        rowName: override?.name ?? null,
        editedByUser: override?.edited_by_user ?? null,
        changedByUser: Boolean(override?.changed_by_user),
        disabledByReport: disabledMilestoneSet.has(m.work_milestone_name),
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
  }, [workMilestonesList, enabledHeaders, projectStartDate, weekSlotDays, workHeaderOrderMap, headerWeightageMap, overridesByMilestone, disabledMilestoneSet]);

  return {
    projectData,
    projectStartDate,
    projectEndDate,
    projectDurationDays,
    weekSlotDays,
    weekSlotBoundaries,
    groups,
    isLoading: projectLoading || workHeadersLoading || milestonesLoading || scheduleLoading,
    error: projectError,
    mutateProject,
    refetchSchedule,
    updateMilestoneDates,
    resetMilestoneDates,
    scheduleDoc,
  };
};
