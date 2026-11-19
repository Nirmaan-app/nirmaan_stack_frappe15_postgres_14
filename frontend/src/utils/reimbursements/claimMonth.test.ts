import { describe, expect, it } from "vitest";

import { ACCOUNTANT_PROFILE, ADMIN_PROFILE, HR_EXECUTIVE_PROFILE } from "@/constants/roles";

import {
    ALL_MONTHS,
    currentMonth,
    filtersByMonth,
    isMonth,
    joinMonth,
    lastMonth,
    splitMonth,
    monthTitle,
    monthVerb,
    resolveMonth,
    shiftMonth,
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

    it("keeps a month or 'all' from the address, else opens on the current month", () => {
        expect(resolveMonth("2026-09", NOV_19)).toBe("2026-09");
        expect(resolveMonth(ALL_MONTHS, NOV_19)).toBe(ALL_MONTHS);
        for (const bad of [null, "", "2026-13", "Nov 2026", "2026-9"]) {
            expect(resolveMonth(bad, NOV_19)).toBe("2026-11");
        }
        expect(isMonth("2026-00")).toBe(false);
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

    it("is for Paid and All, and only for those who see every claim", () => {
        for (const role of [ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, ACCOUNTANT_PROFILE]) {
            expect(filtersByMonth(TAB_PAID, { role })).toBe(true);
            expect(filtersByMonth(TAB_ALL, { role })).toBe(true);
            expect(filtersByMonth(TAB_PENDING, { role })).toBe(false);
            expect(filtersByMonth(TAB_APPROVED, { role })).toBe(false);
        }
        expect(filtersByMonth(TAB_MINE, { role: "Nirmaan Project Manager Profile" })).toBe(false);
        expect(filtersByMonth(TAB_ALL, { role: "Nirmaan Project Manager Profile" })).toBe(false);
    });

    it("says what the month counts", () => {
        expect(monthVerb(TAB_PAID)).toBe("Paid");
        expect(monthVerb(TAB_ALL)).toBe("Raised");
    });
});
