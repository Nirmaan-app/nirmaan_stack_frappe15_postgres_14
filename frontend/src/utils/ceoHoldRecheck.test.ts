import { describe, expect, it } from "vitest";
import { CEO_AUTHORIZED_USER } from "@/constants/ceoHold";
import {
    DEFAULT_RECHECK_OFFSET_DAYS,
    defaultRecheckDate,
    isValidRecheckDate,
    shouldScheduleCeoHoldRecheck,
    todayISO,
} from "./ceoHoldRecheck";

const NITESH = CEO_AUTHORIZED_USER;
const SOMEONE_ELSE = "abhishek@nirmaan.app";

describe("shouldScheduleCeoHoldRecheck", () => {
    it("asks for a date when the CEO moves a held project to an eligible status", () => {
        for (const newStatus of ["WIP", "Handover", "Won"]) {
            expect(
                shouldScheduleCeoHoldRecheck({
                    currentStatus: "CEO Hold",
                    newStatus,
                    userId: NITESH,
                })
            ).toBe(true);
        }
    });

    // Terminal targets never schedule: a finished/abandoned project must not be draggable
    // back onto CEO Hold by a leftover schedule.
    it("does NOT ask when the target is Completed or Halted", () => {
        for (const newStatus of ["Completed", "Halted"]) {
            expect(
                shouldScheduleCeoHoldRecheck({
                    currentStatus: "CEO Hold",
                    newStatus,
                    userId: NITESH,
                })
            ).toBe(false);
        }
    });

    it("does NOT ask for CEO Hold -> CEO Hold", () => {
        expect(
            shouldScheduleCeoHoldRecheck({
                currentStatus: "CEO Hold",
                newStatus: "CEO Hold",
                userId: NITESH,
            })
        ).toBe(false);
    });

    it("does NOT ask when the project is not on CEO Hold", () => {
        expect(
            shouldScheduleCeoHoldRecheck({
                currentStatus: "WIP",
                newStatus: "Completed",
                userId: NITESH,
            })
        ).toBe(false);
    });

    it("does NOT ask any other user, even off CEO Hold", () => {
        expect(
            shouldScheduleCeoHoldRecheck({
                currentStatus: "CEO Hold",
                newStatus: "WIP",
                userId: SOMEONE_ELSE,
            })
        ).toBe(false);
    });

    it("handles missing status / user without throwing", () => {
        expect(shouldScheduleCeoHoldRecheck({})).toBe(false);
        expect(
            shouldScheduleCeoHoldRecheck({ currentStatus: "CEO Hold", userId: NITESH })
        ).toBe(false);
        expect(
            shouldScheduleCeoHoldRecheck({
                currentStatus: null,
                newStatus: "WIP",
                userId: NITESH,
            })
        ).toBe(false);
    });
});

describe("isValidRecheckDate", () => {
    const now = new Date("2026-09-08T10:30:00");

    it("rejects an empty date — the date is mandatory", () => {
        expect(isValidRecheckDate("", now)).toBe(false);
        expect(isValidRecheckDate(undefined, now)).toBe(false);
        expect(isValidRecheckDate(null, now)).toBe(false);
    });

    it("rejects a past date", () => {
        expect(isValidRecheckDate("2026-09-07", now)).toBe(false);
        expect(isValidRecheckDate("2025-01-01", now)).toBe(false);
    });

    // The cron selects on `<= today`, so today is a legitimate "check it on the next run".
    it("accepts today", () => {
        expect(isValidRecheckDate("2026-09-08", now)).toBe(true);
    });

    it("accepts a future date", () => {
        expect(isValidRecheckDate("2026-09-20", now)).toBe(true);
        expect(isValidRecheckDate("2027-01-01", now)).toBe(true);
    });
});

describe("todayISO", () => {
    it("formats the LOCAL date, not the UTC one", () => {
        // Late evening IST is already the next day in UTC — the date input must still
        // offer the user's own today as the minimum.
        expect(todayISO(new Date("2026-09-08T23:30:00"))).toBe("2026-09-08");
        expect(todayISO(new Date("2026-09-08T00:30:00"))).toBe("2026-09-08");
    });
});

describe("defaultRecheckDate", () => {
    it("is the day after tomorrow", () => {
        expect(DEFAULT_RECHECK_OFFSET_DAYS).toBe(2);
        expect(defaultRecheckDate(new Date("2026-09-08T10:30:00"))).toBe("2026-09-10");
    });

    it("rolls over a month end", () => {
        expect(defaultRecheckDate(new Date("2026-09-30T09:00:00"))).toBe("2026-10-02");
    });

    it("rolls over a year end", () => {
        expect(defaultRecheckDate(new Date("2026-12-31T09:00:00"))).toBe("2027-01-02");
    });

    it("handles a leap day", () => {
        expect(defaultRecheckDate(new Date("2028-02-28T09:00:00"))).toBe("2028-03-01");
    });

    // Late evening is already the next day in UTC — the default must still be two days
    // from the user's OWN today, not from the UTC one.
    it("uses the local date, not the UTC one", () => {
        expect(defaultRecheckDate(new Date("2026-09-08T23:30:00"))).toBe("2026-09-10");
        expect(defaultRecheckDate(new Date("2026-09-08T00:30:00"))).toBe("2026-09-10");
    });

    it("is always a valid choice for the picker", () => {
        for (const iso of ["2026-09-08T10:30:00", "2026-12-31T23:59:00", "2027-03-01T00:00:00"]) {
            const now = new Date(iso);
            const d = defaultRecheckDate(now);
            expect(isValidRecheckDate(d, now)).toBe(true);
            expect(d > todayISO(now)).toBe(true);
        }
    });
});
