import { useMemo } from 'react';
import { useFrappeGetDoc } from 'frappe-react-sdk';

const MS_PER_DAY = 86_400_000;

export interface TargetWorkMilestone {
  name?: string;
  work_milestone_name: string;
  work_header?: string;
  weightage?: number;
  week_1?: number;
  week_2?: number;
  week_3?: number;
  week_4?: number;
  week_5?: number;
  week_6?: number;
  week_7?: number;
  week_8?: number;
  week_9?: number;
}

interface UseTargetProgressParams {
  projectId: string | null;
  referenceDate?: Date;
  workMilestonesList: TargetWorkMilestone[] | undefined;
}

export interface UseTargetProgressResult {
  milestoneTarget: Map<string, number>;
  headerTarget: Map<string, number>;
  anchorDays: number[];
  elapsedDays: number | null;
  totalDays: number | null;
  projectStartDate: Date | null;
  projectEndDate: Date | null;
  isLoading: boolean;
}

const startOfUtcDay = (d: Date) =>
  Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

const daysBetween = (from: Date, to: Date) =>
  Math.floor((startOfUtcDay(to) - startOfUtcDay(from)) / MS_PER_DAY);

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const readWeek = (m: TargetWorkMilestone, idx: number): number => {
  if (idx === 0) return 0;
  const key = `week_${idx}` as keyof TargetWorkMilestone;
  const raw = m[key];
  return typeof raw === 'number' ? raw : 0;
};

const emptyResult = (isLoading: boolean): UseTargetProgressResult => ({
  milestoneTarget: new Map(),
  headerTarget: new Map(),
  anchorDays: [],
  elapsedDays: null,
  totalDays: null,
  projectStartDate: null,
  projectEndDate: null,
  isLoading,
});

export const useTargetProgress = ({
  projectId,
  referenceDate,
  workMilestonesList,
}: UseTargetProgressParams): UseTargetProgressResult => {
  const { data: projectDoc, isLoading: projectLoading } = useFrappeGetDoc(
    'Projects',
    projectId || '',
    projectId ? undefined : null,
  );

  const referenceTime = referenceDate ? referenceDate.getTime() : null;

  return useMemo(() => {
    if (!projectId) return emptyResult(false);
    if (projectLoading) return emptyResult(true);
    if (!projectDoc?.project_start_date || !projectDoc?.project_end_date) {
      return emptyResult(false);
    }

    const start = new Date(projectDoc.project_start_date);
    const end = new Date(projectDoc.project_end_date);
    const ref = referenceTime != null ? new Date(referenceTime) : new Date();

    const totalDays = daysBetween(start, end) + 1;
    if (!Number.isFinite(totalDays) || totalDays <= 0) {
      return {
        ...emptyResult(false),
        projectStartDate: start,
        projectEndDate: end,
      };
    }

    const k = totalDays / 63;
    const anchorDays = Array.from({ length: 10 }, (_, i) => i * 7 * k);
    const elapsedDays = clamp(daysBetween(start, ref), 0, totalDays);

    // Find bucket i such that anchorDays[i] ≤ elapsedDays ≤ anchorDays[i+1].
    let bucket = 8;
    for (let i = 0; i < 9; i++) {
      if (elapsedDays <= anchorDays[i + 1]) {
        bucket = i;
        break;
      }
    }
    const anchorLow = anchorDays[bucket];
    const anchorHigh = anchorDays[bucket + 1];
    const span = anchorHigh - anchorLow;
    const frac = span > 0 ? (elapsedDays - anchorLow) / span : 0;

    const milestoneTarget = new Map<string, number>();
    const headerAccum = new Map<string, { weighted: number; weightSum: number }>();

    // eslint-disable-next-line no-console
    console.log('[useTargetProgress]', {
      projectId,
      totalDays,
      elapsedDays,
      bucket,
      frac,
      milestoneCount: workMilestonesList?.length ?? 0,
      sampleMilestone: workMilestonesList?.[0],
    });

    for (const m of workMilestonesList ?? []) {
      if (!m?.work_milestone_name) continue;

      const lowerW = readWeek(m, bucket);
      const upperW = readWeek(m, bucket + 1);
      const raw = lowerW + (upperW - lowerW) * frac;
      const target = clamp(raw, 0, 100);
      milestoneTarget.set(m.work_milestone_name, target);

      if (m.work_header) {
        const w = typeof m.weightage === 'number' ? m.weightage : 0;
        const entry =
          headerAccum.get(m.work_header) ?? { weighted: 0, weightSum: 0 };
        entry.weighted += w * target;
        entry.weightSum += w;
        headerAccum.set(m.work_header, entry);
      }
    }

    const headerTarget = new Map<string, number>();
    for (const [header, { weighted, weightSum }] of headerAccum) {
      headerTarget.set(header, weightSum > 0 ? weighted / weightSum : 0);
    }

    return {
      milestoneTarget,
      headerTarget,
      anchorDays,
      elapsedDays,
      totalDays,
      projectStartDate: start,
      projectEndDate: end,
      isLoading: false,
    };
  }, [
    projectId,
    projectLoading,
    projectDoc?.project_start_date,
    projectDoc?.project_end_date,
    workMilestonesList,
    referenceTime,
  ]);
};
