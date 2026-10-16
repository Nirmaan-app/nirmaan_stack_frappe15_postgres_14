// The Material Plan's delivery status filter: which saved plans a status selection keeps.
// Pure, so the rule is testable without React (F4); `SevenDaysMaterialPlan` only wires it to the URL
// (`materialStatus`, read and written through `utils/statusFilterParam`).

/** The three `Material Delivery Plan.delivery_status` options, in the order the Status filter lists them. */
export const DELIVERY_STATUSES = ["Not Delivered", "Partially Delivered", "Delivered"] as const;

/** A plan's delivery status as the screen shows it: empty counts as Not Delivered (the field's default). */
export const deliveryStatus = (status: string | null | undefined): string => status || "Not Delivered";

/** Keep only the plans whose delivery status is selected; an empty selection keeps everything (returns `plans`). */
export function filterPlansByDeliveryStatus<T extends { delivery_status?: string | null }>(
  plans: T[] | undefined,
  selected: ReadonlySet<string>,
): T[] | undefined {
  if (!plans || selected.size === 0) return plans;
  return plans.filter((plan) => selected.has(deliveryStatus(plan.delivery_status)));
}
