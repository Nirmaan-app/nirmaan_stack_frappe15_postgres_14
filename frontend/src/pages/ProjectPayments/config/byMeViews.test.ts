/**
 * "Payment Raised By Me" → All / Paid / Rejected (2026-11-12): each view only adds a status to the tab's own
 * `raised_by = @me`, so a view can never show someone else's rows; All is the tab exactly as before.
 */
import { describe, expect, it } from "vitest";

import {
    BY_ME_VIEW_COLUMNS,
    BY_ME_VIEW_SORT,
    BY_ME_VIEWS,
    byMeViewCounts,
    byMeViewFilters,
    byMeViewStateTab,
    CURRENT_USER_TOKEN,
    getApprovalsStaticFilters,
    parseByMeView,
    TAB_COLUMNS,
    TAB_DEFAULT_SORT,
} from "./approvalsTable.config";
import { getProjectPaymentsStaticFilters } from "./projectPaymentsTable.config";
import { PP_TABS } from "./ppTabs.constants";

describe("parseByMeView", () => {
    it("reads the three views", () => {
        expect(parseByMeView("all")).toBe(BY_ME_VIEWS.ALL);
        expect(parseByMeView("paid")).toBe(BY_ME_VIEWS.PAID);
        expect(parseByMeView("rejected")).toBe(BY_ME_VIEWS.REJECTED);
    });

    it("reads anything else, or nothing, as All (old links and hand-edited URLs)", () => {
        for (const value of [null, undefined, "", "Rejected", "PAID", "deleted", "rejected "]) {
            expect(parseByMeView(value as string | null | undefined)).toBe(BY_ME_VIEWS.ALL);
        }
    });
});

describe("byMeViewFilters", () => {
    it("adds nothing for All", () => {
        expect(byMeViewFilters(BY_ME_VIEWS.ALL)).toEqual([]);
    });

    it("adds exactly one status for Paid and Rejected", () => {
        expect(byMeViewFilters(BY_ME_VIEWS.PAID)).toEqual([["status", "=", "Paid"]]);
        expect(byMeViewFilters(BY_ME_VIEWS.REJECTED)).toEqual([["status", "=", "Rejected"]]);
    });

    it("never drops the tab's own-rows filter: the tab still sends raised_by = @me", () => {
        const tab = getProjectPaymentsStaticFilters(PP_TABS.PAYMENT_BY_ME);
        expect(tab).toEqual([["raised_by", "=", CURRENT_USER_TOKEN]]);
        expect(getApprovalsStaticFilters(PP_TABS.PAYMENT_BY_ME)).toEqual([["raised_by", "=", CURRENT_USER_TOKEN]]);
        for (const view of Object.values(BY_ME_VIEWS)) {
            expect(byMeViewFilters(view).some(([field]) => field === "raised_by")).toBe(false);
        }
    });
});

describe("columns", () => {
    it("All is the tab's own list, which now carries the Reason", () => {
        expect(BY_ME_VIEW_COLUMNS[BY_ME_VIEWS.ALL]).toBe(TAB_COLUMNS[PP_TABS.PAYMENT_BY_ME]);
        expect(TAB_COLUMNS[PP_TABS.PAYMENT_BY_ME]).toContain("rejection_reason");
    });

    it("All Payments carries the Reason, right after Status", () => {
        const ids = TAB_COLUMNS[PP_TABS.ALL_PAYMENTS];
        expect(ids.indexOf("rejection_reason")).toBe(ids.indexOf("status") + 1);
    });

    it("Rejected shows the Reason and the reject date, and no Status or Paid on (one value down the page)", () => {
        const ids = BY_ME_VIEW_COLUMNS[BY_ME_VIEWS.REJECTED];
        expect(ids).toEqual(expect.arrayContaining(["actions", "against", "rejection_reason", "rejected_on"]));
        expect(ids).not.toContain("status");
        expect(ids).not.toContain("paid_on");
    });

    it("Paid keeps Paid on, UTR and Payment Source, and drops Status and Reason", () => {
        const ids = BY_ME_VIEW_COLUMNS[BY_ME_VIEWS.PAID];
        expect(ids).toEqual(expect.arrayContaining(["paid_on", "utr_ref", "payment_source"]));
        expect(ids).not.toContain("status");
        expect(ids).not.toContain("rejection_reason");
    });

    it("keeps Actions first in every view (the Delete on a rejected row, the invoice upload on a paid one)", () => {
        for (const view of Object.values(BY_ME_VIEWS)) {
            expect(BY_ME_VIEW_COLUMNS[view][0]).toBe("actions");
        }
    });

    it("no other tab grew a Reason column", () => {
        for (const tab of [PP_TABS.APPROVE_PAYMENTS, PP_TABS.CEO_PENDING, PP_TABS.NEW_PAYMENTS,
            PP_TABS.RECONCILIATION_PENDING, PP_TABS.PAYMENTS_DONE, PP_TABS.PAYMENTS_PENDING, PP_TABS.PO_WISE] as const) {
            expect(TAB_COLUMNS[tab]).not.toContain("rejection_reason");
        }
    });
});

describe("sort and table-state key", () => {
    it("sorts each view newest-first on its own step", () => {
        expect(BY_ME_VIEW_SORT[BY_ME_VIEWS.ALL]).toBe(TAB_DEFAULT_SORT[PP_TABS.PAYMENT_BY_ME]);
        expect(BY_ME_VIEW_SORT[BY_ME_VIEWS.PAID]).toBe("paid_on desc");
        expect(BY_ME_VIEW_SORT[BY_ME_VIEWS.REJECTED]).toBe("modified desc");
    });

    it("keeps All's saved state key, and gives Paid and Rejected their own", () => {
        const tab = PP_TABS.PAYMENT_BY_ME;
        expect(byMeViewStateTab(tab, BY_ME_VIEWS.ALL)).toBe(tab);
        const keys = new Set(Object.values(BY_ME_VIEWS).map((v) => byMeViewStateTab(tab, v)));
        expect(keys.size).toBe(3);
    });
});

describe("byMeViewCounts", () => {
    it("is empty before the counts load, so no badge shows a false 0", () => {
        expect(byMeViewCounts(undefined)).toEqual({});
        expect(byMeViewCounts(null)).toEqual({});
    });

    it("reads All from the tab badge and Paid / Rejected from the by-status counts", () => {
        expect(byMeViewCounts({ by_me: 9, by_me_counts: { Paid: 5, Rejected: 2, Requested: 2 } })).toEqual({
            all: 9, paid: 5, rejected: 2,
        });
    });

    it("reads 0 for a status the user has none of", () => {
        expect(byMeViewCounts({ by_me: 3, by_me_counts: { Requested: 3 } })).toEqual({ all: 3, paid: 0, rejected: 0 });
    });

    it("sums the statuses for All on an older server that sends no by_me", () => {
        expect(byMeViewCounts({ by_me_counts: { Paid: 1, Rejected: 4 } }).all).toBe(5);
    });
});
