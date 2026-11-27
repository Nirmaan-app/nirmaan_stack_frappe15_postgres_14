// The Material Plan's "Plan N" label. A plan is numbered by when it was created, oldest = Plan 1, across EVERY plan
// of the project, so the number stays the same whatever date, status or search filter the list has, and adding a
// plan never renumbers the others. (Plans have hash names, so there is no readable ID to show instead.)
// Pure (F4); `SevenDaysMaterialPlan` feeds it the project's full plan list (names + creation only).

/** The plan fields numbering reads. */
export interface NumberablePlan {
  name: string;
  creation?: string | null;
}

/** Each plan's number, keyed by plan name: oldest creation first; equal creation times break by name. */
export function planNumbersByCreation(plans: NumberablePlan[] | undefined): Map<string, number> {
  const ordered = [...(plans ?? [])].sort(
    (a, b) => (a.creation ?? "").localeCompare(b.creation ?? "") || a.name.localeCompare(b.name),
  );
  return new Map(ordered.map((plan, index) => [plan.name, index + 1]));
}
