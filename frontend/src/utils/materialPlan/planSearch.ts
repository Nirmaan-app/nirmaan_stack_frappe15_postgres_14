// The Material Plan search box: which saved plans a typed search keeps, and which of a plan's materials it hit.
// Pure, so the rule is testable without React (F4); `SevenDaysMaterialPlan` only wires it to the URL
// (`materialSearch`).
//
// The shared rule (`utils/searchWords`): a plan is kept when EVERY word appears somewhere in it: its PO, task,
// sub-category, category, package, remarks, or any of its material names. Case is ignored.

import { hasAllWords } from "@/utils/searchWords";

/** The plan fields a search reads (besides the material names). */
export interface SearchablePlan {
  po_link?: string | null;
  critical_po_task?: string | null;
  critical_po_sub_category?: string | null;
  critical_po_category?: string | null;
  package_name?: string | null;
  remarks?: string | null;
}

/** The material field a search reads. */
export interface SearchableItem {
  item_name?: string | null;
}

const planText = (plan: SearchablePlan): string =>
  [
    plan.po_link,
    plan.critical_po_task,
    plan.critical_po_sub_category,
    plan.critical_po_category,
    plan.package_name,
    plan.remarks,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

const itemText = (item: SearchableItem): string => (item.item_name ?? "").toLowerCase();

/** Whether a plan holds every search word (in its own fields or its material names). No words keeps every plan. */
export function planMatchesSearch(plan: SearchablePlan, items: SearchableItem[], words: string[]): boolean {
  return hasAllWords([planText(plan), ...items.map(itemText)], words);
}

/**
 * The positions of the plan's materials the search hit, to highlight. A material is a hit when its own name holds
 * at least one word and every other word is in its name or in the plan's own fields. So "MCB" marks the MCB
 * materials, "PO-0012 MCB" marks the MCB materials of that PO, and a search for a PO alone marks none.
 */
export function matchedItemIndexes(plan: SearchablePlan, items: SearchableItem[], words: string[]): Set<number> {
  const hits = new Set<number>();
  if (words.length === 0) return hits;
  const ownText = planText(plan);
  items.forEach((item, index) => {
    const name = itemText(item);
    const anyInName = words.some((word) => name.includes(word));
    const allCovered = words.every((word) => name.includes(word) || ownText.includes(word));
    if (anyInName && allCovered) hits.add(index);
  });
  return hits;
}

/** Keep only the plans that hold every search word; no words keeps everything (returns `plans`). */
export function filterPlansBySearch<T extends SearchablePlan>(
  plans: T[] | undefined,
  words: string[],
  itemsOf: (plan: T) => SearchableItem[],
): T[] | undefined {
  if (!plans || words.length === 0) return plans;
  return plans.filter((plan) => planMatchesSearch(plan, itemsOf(plan), words));
}
