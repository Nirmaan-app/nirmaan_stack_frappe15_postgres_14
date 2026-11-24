import { describe, expect, it } from "vitest";

import { ACCOUNTANT_PROFILE, ADMIN_PROFILE, HR_EXECUTIVE_PROFILE } from "@/constants/roles";

import {
    ALL_MONTHS,
    currentMonth,
    defaultMonth,
    filtersByMonth,
    isMonth,
    joinMonth,
    lastMonth,
    monthFigures,
    splitMonth,
    monthTitle,
    monthHeading,
    resolveMonth,
    shiftMonth,
    shortMonth,
} from "./claimMonth";
import { TAB_ALL, TAB_APPROVED, TAB_MINE, TAB_PAID, TAB_PENDING } from "./rules";

const NOV_19 = new Date(2026, 10, 19);

describe("claimMonth", () => {
    it("reads the current month in local time", () => {
        expect(currentMonth(NOV_19)).toBe("2026-11");
        expect(currentMonth(new Date(2027, 0, 1))).toBe("2027-01");
    });

    it("moves across year ends", () => {
        expect(shiftMonth("2026-01", -1)).toBe("2025-12");
        expect(shiftMonth("2026-12", 1)).toBe("2027-01");
        expect(shiftMonth("2026-11", 0)).toBe("2026-11");
    });

    it("keeps a month or 'all' from the address, else opens on the tab's default", () => {
        for (const tab of [TAB_APPROVED, TAB_PAID, TAB_ALL] as const) {
            expect(resolveMonth("2026-09", tab, NOV_19)).toBe("2026-09");
            expect(resolveMonth(ALL_MONTHS, tab, NOV_19)).toBe(ALL_MONTHS);
        }
        for (const bad of [null, "", "2026-13", "Nov 2026", "2026-9"]) {
            expect(resolveMonth(bad, TAB_APPROVED, NOV_19)).toBe("2026-11");
            expect(resolveMonth(bad, TAB_PAID, NOV_19)).toBe(ALL_MONTHS);
            expect(resolveMonth(bad, TAB_ALL, NOV_19)).toBe(ALL_MONTHS);
        }
        expect(isMonth("2026-00")).toBe(false);
    });

    it("opens Payment need to be paid on this month, Paid and All on all months", () => {
        expect(defaultMonth(TAB_APPROVED, NOV_19)).toBe("2026-11");
        expect(defaultMonth(TAB_PAID, NOV_19)).toBe(ALL_MONTHS);
        expect(defaultMonth(TAB_ALL, NOV_19)).toBe(ALL_MONTHS);
    });

    it("lists every step on All in order, with colours, leaving out steps with nothing", () => {
        const figures = monthFigures(TAB_ALL, [
            { group_key: "Rejected", aggregate_value: 7600 },
            { group_key: "Paid", aggregate_value: "108760" },
            { group_key: "Reconciliation Pending", aggregate_value: 900 },
            { group_key: "Pending Approval", aggregate_value: 21300 },
            { group_key: "Requested", aggregate_value: 0 },
        ]);
        expect(figures.map((f) => [f.key, f.value])).toEqual([
            ["Pending Approval", 21300], ["Reconciliation Pending", 900], ["Paid", 108760], ["Rejected", 7600],
        ]);
        expect(figures.every((f) => !!f.color)).toBe(true);
    });

    it("always shows Travel, Food and Others elsewhere, in that order", () => {
        expect(monthFigures(TAB_APPROVED, [{ group_key: "Others", aggregate_value: 12400 }, { group_key: "Travel", aggregate_value: 4150 }])
            .map((f) => [f.key, f.value])).toEqual([["Travel", 4150], ["Food", 0], ["Others", 12400]]);
        expect(monthFigures(TAB_PAID, null).map((f) => f.value)).toEqual([0, 0, 0]);
    });

    it("gives the quick picks' short month name", () => {
        expect(shortMonth("2026-11")).toBe("Nov");
        expect(shortMonth("2026-01")).toBe("Jan");
        expect(shortMonth("2025-12")).toBe("Dec");
    });

    it("gives last month, and splits and joins a month", () => {
        expect(lastMonth(NOV_19)).toBe("2026-10");
        expect(lastMonth(new Date(2027, 0, 5))).toBe("2026-12");
        expect(splitMonth("2025-12")).toEqual([2025, 12]);
        expect(joinMonth(2025, 3)).toBe("2025-03");
    });

    it("names the month", () => {
        expect(monthTitle("2026-11")).toBe("November 2026");
    });

    it("is on every tab; Raised By Me for everyone, the rest for those who see every claim", () => {
        for (const role of [ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, ACCOUNTANT_PROFILE]) {
            for (const tab of [TAB_PENDING, TAB_APPROVED, TAB_PAID, TAB_ALL, TAB_MINE] as const) {
                expect(filtersByMonth(tab, { role })).toBe(true);
            }
        }
        expect(filtersByMonth(TAB_MINE, { role: "Nirmaan Project Manager Profile" })).toBe(true);
        expect(filtersByMonth(TAB_ALL, { role: "Nirmaan Project Manager Profile" })).toBe(false);
    });

    it("says what the month counts", () => {
        expect(monthHeading(TAB_APPROVED, "2026-11")).toEqual({ name: "Approved", when: "raised in November 2026" });
        expect(monthHeading(TAB_PAID, "2026-11")).toEqual({ name: "Paid", when: "paid in November 2026" });
        expect(monthHeading(TAB_PENDING, "2026-11")).toEqual({ name: "Pending Approval", when: "raised in November 2026" });
        expect(monthHeading(TAB_ALL, ALL_MONTHS)).toEqual({ name: "All", when: "all months" });
        expect(monthHeading(TAB_MINE, ALL_MONTHS)).toEqual({ name: "Mine", when: "all months" });
    });
});
