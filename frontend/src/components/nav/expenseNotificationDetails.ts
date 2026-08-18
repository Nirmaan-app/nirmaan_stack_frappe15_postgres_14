// src/components/nav/expenseNotificationDetails.ts
//
// What the bell shows underneath an EXPENSE notification.
//
// The card's three stock lines (Project / Work Package / Action By) are procurement-shaped:
// an expense notification sets none of them, so it rendered three blanks and one
// "Administrator". These build the lines that are actually true for an expense instead.
//
// PURE MODULE -- no React, no fetching (ADR-0010 F4), so the mapping is unit-testable and the
// component stays a renderer.

export const EXPENSE_REQUEST_DOCTYPE = "Expense Request";

/** One label/value row under a notification. */
export interface NotificationDetail {
    label: string;
    value: string;
}

/** The subset of `Expense Request` these lines need. */
export interface ExpenseNotificationRequest {
    name: string;
    type?: string | null;
    /** Set => Project expense. Blank => Non-Project. There is no `expense_kind` field. */
    projects?: string | null;
    reviewed_by?: string | null;
}

export interface ExpenseNotificationLike {
    document?: string | null;
    docname?: string | null;
    sender?: string | null;
    event_id?: string | null;
}

/** The bell discriminates on the doctype it was raised against, not on the wording. */
export const isExpenseNotification = (n: ExpenseNotificationLike): boolean =>
    n?.document === EXPENSE_REQUEST_DOCTYPE;

/** Which ledger the request became.
 *
 *  MIRRORS the backend's `convert.target_doctype`: the PRESENCE of a project is the whole
 *  rule -- there is no `expense_kind` field on either side. Kept in step by construction
 *  rather than by comment: both read the same one field. */
export const ledgerLabelFor = (projects?: string | null): string =>
    projects ? "Project Expenses" : "Non Project Expenses";

const PAID_EVENT = "expense_request:paid";

/** The detail lines for one expense notification.
 *
 *  `resolveName` turns a user id into a display name; it may return nothing while the user
 *  list is still loading, so every value falls back to the id rather than to an empty row --
 *  a labelled blank reads as missing data, which is what this replaced.
 *
 *  A REJECTED notification deliberately gets fewer lines: there is no ledger row and no
 *  approver, so rendering "Expense: Non Project Expenses" would state something untrue. The
 *  reason itself is already the notification's description and is not repeated here.
 *
 *  An ABSENT request (still fetching, or deleted) still yields the lines the notification can
 *  answer on its own. Never returns an empty list, so the card never collapses. */
export const expenseDetailLines = (
    notification: ExpenseNotificationLike,
    request: ExpenseNotificationRequest | undefined,
    resolveName: (userId: string) => string | undefined,
): NotificationDetail[] => {
    const named = (userId?: string | null) =>
        userId ? resolveName(userId) || userId : "--";

    const isPaid = notification?.event_id === PAID_EVENT;
    const lines: NotificationDetail[] = [];

    lines.push({ label: "Request", value: notification?.docname || "--" });

    if (isPaid && request) {
        lines.push({ label: "Expense", value: ledgerLabelFor(request.projects) });
    }
    if (request?.type) {
        lines.push({ label: "Expense Type", value: request.type });
    }

    // `sender` is whoever performed the action this notification reports -- the same field the
    // old card labelled "Action By", which said nothing about WHICH action.
    lines.push({
        label: isPaid ? "Paid By" : "Rejected By",
        value: named(notification?.sender),
    });

    if (isPaid && request?.reviewed_by) {
        lines.push({ label: "Approved By", value: named(request.reviewed_by) });
    }

    return lines;
};

/** The request names a batch of notifications needs, deduped. Empty => skip the fetch. */
export const expenseRequestNamesIn = (notifications: ExpenseNotificationLike[]): string[] => {
    const names = new Set<string>();
    (notifications || []).forEach((n) => {
        if (isExpenseNotification(n) && n.docname) names.add(n.docname);
    });
    return [...names];
};
