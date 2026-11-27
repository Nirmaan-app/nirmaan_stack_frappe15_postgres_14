// The Cashflow Plan search box: which plans a typed search keeps, in whichever tab (PO, WO, Misc., Inflow) is open.
// Pure, so the rule is testable without React (F4); `CashflowPlan` holds the box and the URL (`cashflowSearch`),
// and each tab filters its own list with this.
//
// The shared rule (`utils/searchWords`): a plan is kept when EVERY word appears somewhere in it: its PO/WO number,
// vendor, Critical PO category / task / sub-category, remarks, or any of its items (PO material names, WO
// descriptions). Case is ignored.

import { parseJson } from "@/lib/parseJson";
import { hasAllWords } from "@/utils/searchWords";

/** The plan fields a search reads; `items` is the stored `{ list: [...] }` JSON (text or already parsed). */
export interface SearchableCashflowPlan {
  id_link?: string | null;
  vendor_name?: string | null;
  critical_po_category?: string | null;
  critical_po_task?: string | null;
  critical_po_sub_category?: string | null;
  remarks?: string | null;
  items?: unknown;
}

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** The plan's item texts: a PO item's `item_name`, a WO item's `description`. Unreadable items give none. */
export function cashflowItemTexts(plan: SearchableCashflowPlan): string[] {
  const out: string[] = [];
  for (const item of itemList(plan)) {
    if (!item || typeof item !== "object") continue;
    const name = "item_name" in item ? text(item.item_name) : null;
    const description = "description" in item ? text(item.description) : null;
    if (name) out.push(name);
    if (description) out.push(description);
  }
  return out;
}

/** Whether a plan holds every search word. No words keeps every plan. */
export function cashflowPlanMatchesSearch(plan: SearchableCashflowPlan, words: string[]): boolean {
  return hasAllWords(
    [
      plan.id_link,
      plan.vendor_name,
      plan.critical_po_category,
      plan.critical_po_task,
      plan.critical_po_sub_category,
      plan.remarks,
      ...cashflowItemTexts(plan),
    ],
    words,
  );
}

/** The text one rendered item shows: a PO item's `item_name`, else a WO item's `description`. */
const itemShownText = (item: unknown): string => {
  if (!item || typeof item !== "object") return "";
  const name = "item_name" in item ? text(item.item_name) : null;
  if (name) return name;
  return ("description" in item ? text(item.description) : null) ?? "";
};

/** The plan's item list as the tabs render it (`{ list: [...] }`, or a bare list); unreadable items give []. */
function itemList(plan: SearchableCashflowPlan): unknown[] {
  let parsed: unknown = plan.items;
  if (typeof parsed === "string") {
    try {
      parsed = parsed ? parseJson(parsed) : null;
    } catch {
      return [];
    }
  }
  const list: unknown = parsed && typeof parsed === "object" && "list" in parsed ? parsed.list : parsed;
  return Array.isArray(list) ? (list as unknown[]) : [];
}

/**
 * The positions (in the plan's item list) of the items the search hit, to highlight and to open the card by.
 * Same rule as Material Plan: an item is a hit when its own text holds at least one word and every other word is
 * in its text or in the plan's own fields. So "diffuser" marks the diffuser items, "cosmic diffuser" marks the
 * diffuser items of that vendor's plan, and a search for a vendor alone marks none.
 */
export function cashflowItemHits(plan: SearchableCashflowPlan, words: string[]): Set<number> {
  const hits = new Set<number>();
  if (words.length === 0) return hits;
  const ownText = [
    plan.id_link,
    plan.vendor_name,
    plan.critical_po_category,
    plan.critical_po_task,
    plan.critical_po_sub_category,
    plan.remarks,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  itemList(plan).forEach((item, index) => {
    const shown = itemShownText(item).toLowerCase();
    const anyInItem = words.some((word) => shown.includes(word));
    const allCovered = words.every((word) => shown.includes(word) || ownText.includes(word));
    if (anyInItem && allCovered) hits.add(index);
  });
  return hits;
}

/** Keep only the plans that hold every search word; no words keeps everything (returns `plans`). */
export function filterCashflowPlansBySearch<T extends SearchableCashflowPlan>(
  plans: T[] | undefined,
  words: string[],
): T[] | undefined {
  if (!plans || words.length === 0) return plans;
  return plans.filter((plan) => cashflowPlanMatchesSearch(plan, words));
}
