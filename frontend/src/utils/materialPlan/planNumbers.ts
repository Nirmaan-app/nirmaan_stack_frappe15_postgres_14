// The "Plan N" label on Material Plan and every Cashflow tab. Plans have hash names, so there is no readable ID to
// show instead. Pure (F4); `SevenDaysMaterialPlan` and `useCashflowTabPlans` feed it their lists.

/**
 * Each plan's "Plan N" as develop counts it, and as the Material Plan / Cashflow PDFs print it: its position in the
 * list (newest first), from 1. Callers pass the list after the date and status filters but before the search, so
 * searching only hides cards and never renumbers them, and the numbers match a PDF downloaded with the same filters.
 */
export function planNumbersByPosition(plans: { name: string }[] | undefined): Map<string, number> {
  return new Map((plans ?? []).map((plan, index) => [plan.name, index + 1]));
}
