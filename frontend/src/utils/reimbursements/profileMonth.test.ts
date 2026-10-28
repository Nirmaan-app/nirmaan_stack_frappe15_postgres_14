import { describe, expect, it } from "vitest";

import { ADMIN_PROFILE, ACCOUNTANT_PROFILE, HR_EXECUTIVE_PROFILE } from "@/constants/roles";

import {
    ALL_MONTHS,
    isMonthKey,
    monthFilters,
    monthKey,
    monthOptions,
    profileTotals,
    seesProfileReimbursements,
} from "./profileMonth";

describe("who sees the tab", () => {
    it("Admin and Administrator only", () => {
        expect(seesProfileReimbursements({ role: ADMIN_PROFILE })).toBe(true);
        expect(seesProfileReimbursements({ userId: "Administrator" })).toBe(true);
        expect(seesProfileReimbursements({ role: HR_EXECUTIVE_PROFILE })).toBe(false);
        expect(seesProfileReimbursements({ role: ACCOUNTANT_PROFILE })).toBe(false);
        expect(seesProfileReimbursements({ role: "Nirmaan Project Manager Profile" })).toBe(false);
    });
});

describe("months", () => {
    it("names this month first, eleven before it, then All months", () => {
        const options = monthOptions(new Date(2026, 9, 28));
        expect(options).toHaveLength(13);
        expect(options[0]).toEqual({ value: "2026-10", label: "October 2026" });
        expect(options[10]).toEqual({ value: "2025-12", label: "December 2025" });
        expect(options[11]).toEqual({ value: "2025-11", label: "November 2025" });
        expect(options[12]).toEqual({ value: ALL_MONTHS, label: "All months" });
    });

    it("keeps the month of the 31st and of the last minute of a month", () => {
        expect(monthKey(new Date(2026, 9, 31, 23, 59))).toBe("2026-10");
        expect(monthKey(new Date(2026, 0, 1, 0, 0))).toBe("2026-01");
    });

    it("filters from the first of the month up to, not including, the first of the next", () => {
        expect(monthFilters("2026-10")).toEqual([
            ["creation", ">=", "2026-10-01 00:00:00"],
            ["creation", "<", "2026-11-01 00:00:00"],
        ]);
        expect(monthFilters("2026-12")[1]).toEqual(["creation", "<", "2027-01-01 00:00:00"]);
        expect(monthFilters("2026-02")[1]).toEqual(["creation", "<", "2026-03-01 00:00:00"]);
        expect(monthFilters(ALL_MONTHS)).toEqual([]);
    });

    it("reads only YYYY-MM as a month", () => {
        expect(isMonthKey("2026-10")).toBe(true);
        for (const bad of ["2026-13", "2026-1", "all", "", null, undefined, "2026-10-01"]) {
            expect(isMonthKey(bad)).toBe(false);
        }
    });
});

describe("totals", () => {
    it("the month total is Approved + Paid; Pending and Rejected are shown, never counted", () => {
        const totals = profileTotals([
            { group_key: "Approved", aggregate_value: 1200 },
            { group_key: "Paid", aggregate_value: 500 },
            { group_key: "Rejected", aggregate_value: 900 },
            { group_key: "Pending Approval", aggregate_value: 300 },
        ]);
        expect(totals).toEqual({
            approved: 1200, paid: 500, pending: 300, rejected: 900, monthTotal: 1700, reachesLimit: false,
        });
    });

    it("exactly ₹2,000 of Approved + Paid reaches the limit; none at all is zero", () => {
        expect(profileTotals([{ group_key: "Approved", aggregate_value: 2000 }]).reachesLimit).toBe(true);
        expect(profileTotals([]).monthTotal).toBe(0);
        expect(profileTotals([]).reachesLimit).toBe(false);
    });
});
