// The Work Plan's Planned Activities status filter: which activities a status selection keeps.
// Pure, so the rule is testable without React (F4); `SevendaysWorkPlan` only wires it to the URL
// (`planningStatus`, read and written through `utils/statusFilterParam`).

/** The four activity statuses, in the order the Status filter lists them. */
export const WORK_PLAN_STATUSES = ["Not Started", "In Progress", "On Hold", "Completed"] as const;

/** An activity's status as the filter reads it: empty, and the legacy "Pending", count as Not Started. */
export const activityStatus = (wpStatus: string | null | undefined): string =>
  !wpStatus || wpStatus === "Pending" ? "Not Started" : wpStatus;

/**
 * Keep only the activities whose status is selected; an empty selection keeps everything (returns `data`).
 * A milestone whose activities are all filtered out keeps an EMPTY list, so the Planned Activities view hides
 * it exactly as it hides a milestone that never had any.
 */
export function filterActivitiesByStatus<T extends { work_plan_doc?: { wp_status?: string | null }[] }>(
  data: Record<string, T[]>,
  selected: ReadonlySet<string>,
): Record<string, T[]> {
  if (selected.size === 0) return data;
  const out: Record<string, T[]> = {};
  for (const [header, items] of Object.entries(data)) {
    out[header] = items.map((item) =>
      item.work_plan_doc
        ? { ...item, work_plan_doc: item.work_plan_doc.filter((plan) => selected.has(activityStatus(plan.wp_status))) }
        : item,
    );
  }
  return out;
}

/** True when Completed is picked while a date range is set: the server drops Completed activities for any range. */
export const completedNeedsAllTime = (selected: ReadonlySet<string>, hasDateRange: boolean): boolean =>
  hasDateRange && selected.has("Completed");
