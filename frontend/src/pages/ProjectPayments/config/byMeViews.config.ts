/**
 * "Payment Raised By Me" views: All, Paid and Rejected (2026-11-12). Split out of `approvalsTable.config.ts`,
 * which keeps the queue's tabs, columns and filters; this file builds on those and never the other way round.
 */

import {
  APPROVAL_STATUS,
  type ApprovalColumnId,
  TAB_COLUMNS,
  TAB_DEFAULT_SORT,
} from "./approvalsTable.config";
import { PP_TABS } from "./ppTabs.constants";

/**
 * The three views inside "Payment Raised By Me" (2026-11-12): All (the tab as it always was), Paid and
 * Rejected. Still the viewer's own rows only: a view only adds a status to the tab's `raised_by = @me`.
 * The view is the page's `?by_me_view=` param; an unknown or missing one reads as All, so every old link and
 * bookmark of the tab still opens what it did.
 */
export const BY_ME_VIEWS = {
  ALL: "all",
  PAID: "paid",
  REJECTED: "rejected",
} as const;

export type ByMeView = typeof BY_ME_VIEWS[keyof typeof BY_ME_VIEWS];

/** The URL param that holds the view. Named for the tab, not plain `view`, which other pages (Assets) use; it is
 *  cleared when the tab is left (`hooks/useByMeView`), so it never rides along on another tab's link. */
export const BY_ME_VIEW_PARAM = "by_me_view";

export const BY_ME_VIEW_OPTIONS: ReadonlyArray<{ value: ByMeView; label: string; status: string | null }> = [
  { value: BY_ME_VIEWS.ALL, label: "All", status: null },
  { value: BY_ME_VIEWS.PAID, label: "Paid", status: APPROVAL_STATUS.PAID },
  { value: BY_ME_VIEWS.REJECTED, label: "Rejected", status: APPROVAL_STATUS.REJECTED },
];

/** `?view=` read as a view; anything else is All. */
export const parseByMeView = (value?: string | null): ByMeView =>
  BY_ME_VIEW_OPTIONS.find((o) => o.value === value)?.value ?? BY_ME_VIEWS.ALL;

/** The status a view adds to the tab's filter; none for All. */
export const byMeViewFilters = (view: ByMeView): Array<[string, string, string]> => {
  const status = BY_ME_VIEW_OPTIONS.find((o) => o.value === view)?.status;
  return status ? [["status", "=", status]] : [];
};

/**
 * Columns per view. All is the tab's own list. Paid drops Status and the Reason (one value down the page)
 * and keeps the payment's UTR and source. Rejected drops Status and Paid on, and adds the Reason and the date
 * of the reject; its Against cell links to the PO / WO page, where the rejected payment can be deleted to
 * free its term.
 */
export const BY_ME_VIEW_COLUMNS: Record<ByMeView, ApprovalColumnId[]> = {
  [BY_ME_VIEWS.ALL]: TAB_COLUMNS[PP_TABS.PAYMENT_BY_ME],
  [BY_ME_VIEWS.PAID]: [
    "actions", "source", "against", "vendor", "paid_to", "project", "amount", "paid_on", "utr_ref",
    "payment_source", "requested_on",
  ],
  [BY_ME_VIEWS.REJECTED]: [
    "actions", "source", "against", "vendor", "paid_to", "project", "amount", "rejection_reason", "rejected_on",
    "requested_on",
  ],
};

/** Newest first, on each view's own step. */
export const BY_ME_VIEW_SORT: Record<ByMeView, string> = {
  [BY_ME_VIEWS.ALL]: TAB_DEFAULT_SORT[PP_TABS.PAYMENT_BY_ME],
  [BY_ME_VIEWS.PAID]: "paid_on desc",
  [BY_ME_VIEWS.REJECTED]: "modified desc",
};

/** The counts endpoint's "Payment Raised By Me" figures (`get_approval_queue_counts`). */
export interface ByMeCountsMessage {
  by_me?: number;
  by_me_counts?: Record<string, number>;
}

/** Each view's badge: All is the tab's own badge, Paid and Rejected its rows at that status. Undefined until
 *  the counts have loaded, so a badge shows nothing rather than a false 0. */
export const byMeViewCounts = (message?: ByMeCountsMessage | null): Partial<Record<ByMeView, number>> => {
  if (!message) return {};
  const byStatus = message.by_me_counts ?? {};
  return {
    [BY_ME_VIEWS.ALL]: message.by_me ?? Object.values(byStatus).reduce((a, b) => a + b, 0),
    [BY_ME_VIEWS.PAID]: byStatus[APPROVAL_STATUS.PAID] ?? 0,
    [BY_ME_VIEWS.REJECTED]: byStatus[APPROVAL_STATUS.REJECTED] ?? 0,
  };
};

/** The table-state key's tab part: All keeps the tab's own key (saved filters and deep links stay); Paid and
 *  Rejected get their own, so a filter set in one view does not leak into another. */
export const byMeViewStateTab = (tab: string, view: ByMeView): string =>
  view === BY_ME_VIEWS.ALL ? tab : `${tab} ${view}`;
