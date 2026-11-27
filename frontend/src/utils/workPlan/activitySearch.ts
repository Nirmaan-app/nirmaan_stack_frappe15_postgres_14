// The Work Plan's Planned Activities search box: which activities a typed search keeps.
// Pure, so the rule is testable without React (F4); `SevendaysWorkPlan` only wires it to the URL (`planningSearch`).
//
// The shared rule (`utils/searchWords`): an activity is kept when EVERY word appears somewhere in its work header
// (e.g. "HVAC Ducting"), its milestone name, its title, its description or its remarks (the card's Note).

import { hasAllWords } from "@/utils/searchWords";

/** The activity fields a search reads. */
export interface SearchableActivity {
  wp_title?: string | null;
  wp_description?: string | null;
  wp_remarks?: string | null;
}

/** The milestone fields a search reads, and the activities it holds. */
export interface SearchableMilestone<A extends SearchableActivity> {
  work_milestone_name?: string | null;
  work_plan_doc?: A[];
}

/**
 * Keep only the activities that hold every search word; no words keeps everything (returns `data`).
 * Like the Status filter, a milestone whose activities are all filtered out keeps an EMPTY list, so the Planned
 * Activities view and the zone counts hide it exactly as they hide a milestone that never had any.
 */
export function filterActivitiesBySearch<A extends SearchableActivity, T extends SearchableMilestone<A>>(
  data: Record<string, T[]>,
  words: string[],
): Record<string, T[]> {
  if (words.length === 0) return data;
  const out: Record<string, T[]> = {};
  for (const [header, items] of Object.entries(data)) {
    out[header] = items.map((item) =>
      item.work_plan_doc
        ? {
            ...item,
            work_plan_doc: item.work_plan_doc.filter((plan) =>
              hasAllWords(
                [header, item.work_milestone_name, plan.wp_title, plan.wp_description, plan.wp_remarks],
                words,
              ),
            ),
          }
        : item,
    );
  }
  return out;
}
