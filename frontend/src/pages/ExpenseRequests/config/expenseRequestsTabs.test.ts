// Who gets which tab on /expense/requests, and what the default is.
//
// These two functions ARE the rule -- `ExpenseRequestsPage` only reads them -- and there is
// no DOM test environment here (vitest runs `environment: "node"`, deliberately), so the
// pure pair is exactly what can be pinned. What CANNOT be pinned from here: that the page
// actually renders `tabDefs`, and that `additionalFilters` turns the tab into the right
// query. Both need a live check.

import { describe, expect, it } from "vitest";

import { reviewsExpenseRequests } from "@/constants/roles";

import {
    EXR_RAISED_BY_ME, EXR_STATUS_TABS, getExrStatusTabs,
} from "./expenseRequestsTable.config";

const REVIEWERS = [
    "Nirmaan Admin Profile",
    "Nirmaan Accountant Profile",
    "Nirmaan Accountant Lead Profile",
    "Nirmaan HR Executive Profile",
    "Nirmaan HR Lead Profile",
];

// The rest of the `/expense` sidebar audience (NewSidebar's gate), i.e. everyone who can
// reach the page and is not a reviewer.
const NARROWED = [
    "Nirmaan PMO Executive Profile",
    "Nirmaan Project Manager Profile",
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Procurement Lead Profile",
    "Nirmaan Material Procurement Executive Profile",
    "Nirmaan Service Procurement Executive Profile",
];

describe("reviewsExpenseRequests", () => {
    it.each(REVIEWERS)("admits %s", (role) => {
        expect(reviewsExpenseRequests(role, "someone@nirmaan.app")).toBe(true);
    });

    it.each(NARROWED)("refuses %s", (role) => {
        expect(reviewsExpenseRequests(role, "someone@nirmaan.app")).toBe(false);
    });

    it("admits the Administrator user whatever its role reads as", () => {
        expect(reviewsExpenseRequests("Nirmaan Project Manager Profile", "Administrator")).toBe(true);
        expect(reviewsExpenseRequests(null, "Administrator")).toBe(true);
    });

    // The safe direction: an unrecognised or missing profile is NOT a reviewer, so it falls
    // through to its own rows. `/expense` has no route guard, so this is what a deep link hits.
    it("refuses an unknown or absent profile", () => {
        expect(reviewsExpenseRequests("Nirmaan Some New Profile", "x@nirmaan.app")).toBe(false);
        expect(reviewsExpenseRequests(null, "x@nirmaan.app")).toBe(false);
        expect(reviewsExpenseRequests(undefined, undefined)).toBe(false);
    });
});

describe("getExrStatusTabs", () => {
    it("gives a reviewer all three, review tabs first", () => {
        const tabs = getExrStatusTabs(true);
        expect(tabs.map((t) => t.value)).toEqual(["Pending Approval", "All", EXR_RAISED_BY_ME]);
    });

    it("gives everyone else Raised By Me alone", () => {
        const tabs = getExrStatusTabs(false);
        expect(tabs.map((t) => t.value)).toEqual([EXR_RAISED_BY_ME]);
        expect(tabs[0].label).toBe("Expense Raised By Me");
    });

    // The page seeds `statusTab` from `tabDefs[0]`, so tab ORDER is what decides the default.
    // A reviewer must keep landing on the approval queue; a narrowed role must not land on a
    // tab it cannot see (the bug the old hard-coded `useState("Pending Approval")` would give).
    it("defaults a reviewer to Pending Approval and everyone else to Raised By Me", () => {
        expect(getExrStatusTabs(true)[0].value).toBe("Pending Approval");
        expect(getExrStatusTabs(false)[0].value).toBe(EXR_RAISED_BY_ME);
    });

    it("never returns an empty list, so tabDefs[0] can never be undefined", () => {
        expect(getExrStatusTabs(true).length).toBeGreaterThan(0);
        expect(getExrStatusTabs(false).length).toBeGreaterThan(0);
    });

    // `Raised By Me` is NOT a status. If it ever collided with one, `additionalFilters` would
    // hand it to a `status =` filter and the tab would return an empty table with no error.
    it("keeps Raised By Me distinct from the status tab values", () => {
        const statusValues = EXR_STATUS_TABS
            .filter((t) => t.value !== EXR_RAISED_BY_ME)
            .map((t) => t.value);
        expect(statusValues).not.toContain(EXR_RAISED_BY_ME);
    });
});
