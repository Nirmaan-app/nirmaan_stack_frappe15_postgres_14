// src/components/nav/reimbursementNotificationDetails.ts
//
// What the bell shows underneath a REIMBURSEMENT notification (`integrations/controllers/
// reimbursement_notify.py`: Approved, or Rejected with the reason). The card's stock lines (Project /
// Work Package / Action By) are procurement-shaped and a reimbursement sets none of them, so it gets the
// two lines that are true for it. The reason is already the notification's description.
//
// PURE MODULE -- no React, no fetching (ADR-0010 F4).

import type { NotificationDetail } from "./expenseNotificationDetails";

export const REIMBURSEMENT_NOTIFICATION_DOCTYPE = "Reimbursement";

export interface ReimbursementNotificationLike {
    document?: string | null;
    docname?: string | null;
    sender?: string | null;
}

export const isReimbursementNotification = (n: ReimbursementNotificationLike): boolean =>
    n?.document === REIMBURSEMENT_NOTIFICATION_DOCTYPE;

/** The claim and who decided it. A name that hasn't loaded yet falls back to the user id, and a
 *  notification with no sender (an Administrator decision) says so. */
export const reimbursementDetailLines = (
    n: ReimbursementNotificationLike,
    resolveName: (userId: string) => string | undefined,
): NotificationDetail[] => [
    { label: "Claim", value: n.docname || "--" },
    { label: "Decided By", value: n.sender ? resolveName(n.sender) || n.sender : "Administrator" },
];
