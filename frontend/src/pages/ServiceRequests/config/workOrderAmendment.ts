/**
 * A Work Order under amendment, on the screen (#1540, GLOSSARY "Amendment (of a Work Order)"). The rules
 * themselves are the server's (`services/work_order_lifecycle`): these only show them before the user acts.
 */

/** The statuses the Work Order lists (All WO, the project's Work Order table) show: an amended one stays listed. */
export const LISTED_WORK_ORDER_STATUSES = ["Approved", "Amendment"];

/** A payment at any other status is money in flight, and Amend waits for it. */
const SETTLED_PAYMENT_STATUSES = ["Paid", "Rejected"];

export type WorkOrderBadge = "Finalized" | "Under amendment" | "Approved";

export const workOrderBadge = (wo: { status?: string; is_finalized?: unknown }): WorkOrderBadge => {
  if (wo.status === "Amendment") return "Under amendment";
  return wo.is_finalized ? "Finalized" : "Approved";
};

export const workOrderBadgeVariant = (badge: WorkOrderBadge): "green" | "orange" | "outline" =>
  badge === "Finalized" ? "green" : badge === "Under amendment" ? "orange" : "outline";

/** Why Amend can't start, naming the payments in flight, or null when it may. */
export const amendBlockedReason = (
  payments: ReadonlyArray<{ name: string; status?: string }> | undefined
): string | null => {
  const inFlight = (payments || []).filter((p) => !SETTLED_PAYMENT_STATUSES.includes(p.status || ""));
  if (!inFlight.length) return null;
  return `Can't amend while a payment is neither Paid nor Rejected: ${inFlight
    .map((p) => `${p.name} (${p.status || "no status"})`)
    .join(", ")}.`;
};

export const UNDER_AMENDMENT_PAYMENT_NOTE =
  "This Work Order is under amendment: request the payment once the amendment is accepted or reverted.";

/** The Nirmaan Comments subjects the amend reason has been saved under (the amend sheet's, then an older one). */
export const AMEND_REASON_SUBJECTS = ["amending approved work order", "sr amendment"];
