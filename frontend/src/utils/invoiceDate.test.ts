import { describe, expect, it } from "vitest";
import {
    isFutureInvoiceDate,
    toLocalDateString,
} from "./invoiceDate";

// Fixed reference point: 27-Jul-2026, midday local.
const NOW = new Date(2026, 6, 27, 12, 0, 0);

describe("toLocalDateString", () => {
    it("formats a local date as YYYY-MM-DD", () => {
        expect(toLocalDateString(NOW)).toBe("2026-07-27");
    });

    it("zero-pads single-digit months and days", () => {
        expect(toLocalDateString(new Date(2026, 0, 5, 9, 0, 0))).toBe("2026-01-05");
    });

    // The bug this module exists to avoid: toISOString() would report the UTC
    // date, which is still the previous day in the early hours of an IST morning.
    it("uses LOCAL time, not UTC, just after local midnight", () => {
        const justAfterMidnight = new Date(2026, 6, 28, 0, 30, 0);
        expect(toLocalDateString(justAfterMidnight)).toBe("2026-07-28");
    });
});

describe("isFutureInvoiceDate", () => {
    it("rejects a date after today", () => {
        expect(isFutureInvoiceDate("2026-07-28", NOW)).toBe(true);
    });

    it("accepts today", () => {
        expect(isFutureInvoiceDate("2026-07-27", NOW)).toBe(false);
    });

    it("accepts a past date", () => {
        expect(isFutureInvoiceDate("2026-07-26", NOW)).toBe(false);
    });

    it("catches the real production cases", () => {
        // The three future-dated rows that reached Approved.
        expect(isFutureInvoiceDate("2026-12-13", NOW)).toBe(true);
        expect(isFutureInvoiceDate("2026-09-09", NOW)).toBe(true);
        expect(isFutureInvoiceDate("2026-08-05", NOW)).toBe(true);
    });

    it("crosses year and month boundaries correctly", () => {
        expect(isFutureInvoiceDate("2027-01-01", NOW)).toBe(true);
        expect(isFutureInvoiceDate("2026-08-01", NOW)).toBe(true);
        expect(isFutureInvoiceDate("2025-12-31", NOW)).toBe(false);
    });

    it("tolerates a datetime string by reading only the date part", () => {
        expect(isFutureInvoiceDate("2026-07-28 09:15:00", NOW)).toBe(true);
        expect(isFutureInvoiceDate("2026-07-27 23:59:59", NOW)).toBe(false);
    });

    // Empty is the required-field check's job, not this rule's.
    it.each([undefined, null, "", "   "])("returns false for empty input %p", (input) => {
        expect(isFutureInvoiceDate(input as string | undefined, NOW)).toBe(false);
    });

    // An unparseable date is not a FUTURE date — the server's stricter parse
    // is what rejects it, and reporting it as "future" would mislead.
    it.each(["not-a-date", "27/07/2026", "2026-7-2"])(
        "returns false for unparseable input %p",
        (input) => {
            expect(isFutureInvoiceDate(input, NOW)).toBe(false);
        }
    );
});
