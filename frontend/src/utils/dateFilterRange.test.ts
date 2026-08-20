import { describe, expect, it } from "vitest";

import { hasDateFilter, resolveDateFilter, resolveTimespan } from "./dateFilterRange";

/**
 * ⚠️ EVERY TEST PASSES AN EXPLICIT `today`. A relative window resolved against the real clock makes
 * the assertion true on the day it was written and false afterwards -- which is the same trap the
 * module itself documents about freezing "today" at import time, arriving from the other direction.
 */
const TODAY = new Date("2026-07-15T00:00:00"); // a Wednesday, Q3, mid-month

describe("resolveTimespan", () => {
    it("resolves the single days", () => {
        expect(resolveTimespan("today", TODAY)).toEqual({ from: "2026-07-15", to: "2026-07-15" });
        expect(resolveTimespan("yesterday", TODAY)).toEqual({
            from: "2026-07-14",
            to: "2026-07-14",
        });
    });

    it("rolls the rolling windows back from today, inclusive of today", () => {
        expect(resolveTimespan("last 7 days", TODAY)).toEqual({
            from: "2026-07-08",
            to: "2026-07-15",
        });
        expect(resolveTimespan("last 30 days", TODAY)).toEqual({
            from: "2026-06-15",
            to: "2026-07-15",
        });
        expect(resolveTimespan("last 90 days", TODAY)).toEqual({
            from: "2026-04-16",
            to: "2026-07-15",
        });
    });

    it("ends the CURRENT periods at today, not at the end of the period", () => {
        // ⚠️ THE LOAD-BEARING HALF OF THE FRAPPE MIRROR. "This month" is "so far this month" -- it
        // must not select future dates, or a summary of July on the 15th reports a whole month of
        // work that has not happened. This is also the exact point where the reports' `datePresets`
        // disagree (theirs runs to `endOfMonth`), which is why the two vocabularies are not mixed.
        expect(resolveTimespan("this month", TODAY)).toEqual({
            from: "2026-07-01",
            to: "2026-07-15",
        });
        expect(resolveTimespan("this quarter", TODAY)).toEqual({
            from: "2026-07-01",
            to: "2026-07-15",
        });
        expect(resolveTimespan("this year", TODAY)).toEqual({
            from: "2026-01-01",
            to: "2026-07-15",
        });
    });

    it("uses the PREVIOUS complete period for the 'last <period>' words", () => {
        expect(resolveTimespan("last month", TODAY)).toEqual({
            from: "2026-06-01",
            to: "2026-06-30",
        });
        expect(resolveTimespan("last quarter", TODAY)).toEqual({
            from: "2026-04-01",
            to: "2026-06-30",
        });
        expect(resolveTimespan("last year", TODAY)).toEqual({
            from: "2025-01-01",
            to: "2025-12-31",
        });
    });

    it("keeps 'last 6 months' QUARTER-ALIGNED, which is not 180 days", () => {
        // Frappe's own definition, mirrored deliberately. Stated as a test so nobody "corrects" it
        // into a rolling window and silently moves every screen that offers the label.
        expect(resolveTimespan("last 6 months", TODAY)).toEqual({
            from: "2026-01-01",
            to: "2026-06-30",
        });
    });

    it("is case- and space-insensitive about the word", () => {
        expect(resolveTimespan("  Last 30 Days ", TODAY)).toEqual(
            resolveTimespan("last 30 days", TODAY)
        );
    });

    it("resolves an UNKNOWN word to nothing rather than to a guess", () => {
        // A stale bookmark carrying a word this build dropped must show an UNFILTERED table --
        // visibly odd -- rather than a silently wrong window, which is not visible at all.
        expect(resolveTimespan("last fortnight", TODAY)).toBeUndefined();
        expect(resolveTimespan("", TODAY)).toBeUndefined();
    });
});

describe("resolveDateFilter", () => {
    it("turns `Is` into a closed one-day range, not an equality", () => {
        // `added_on` is a Datetime, so `= '2026-07-01'` matches only a transfer at exactly midnight.
        expect(resolveDateFilter({ operator: "Is", value: "2026-07-01" }, TODAY)).toEqual({
            from: "2026-07-01",
            to: "2026-07-01",
        });
    });

    it("leaves `<=` and `>=` open-ended rather than inventing the other bound", () => {
        expect(resolveDateFilter({ operator: "<=", value: "2026-07-01" }, TODAY)).toEqual({
            to: "2026-07-01",
        });
        expect(resolveDateFilter({ operator: ">=", value: "2026-07-01" }, TODAY)).toEqual({
            from: "2026-07-01",
        });
    });

    it("passes `Between` through in order", () => {
        expect(
            resolveDateFilter({ operator: "Between", value: ["2026-07-01", "2026-07-31"] }, TODAY)
        ).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    });

    it("swaps a back-to-front `Between` rather than returning an empty table", () => {
        // Only reachable from a hand-edited URL. Swapping is the reading that returns rows.
        expect(
            resolveDateFilter({ operator: "Between", value: ["2026-07-31", "2026-07-01"] }, TODAY)
        ).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    });

    it("resolves a Timespan through `resolveTimespan`", () => {
        expect(resolveDateFilter({ operator: "Timespan", value: "last month" }, TODAY)).toEqual(
            resolveTimespan("last month", TODAY)
        );
    });

    it("treats an absent or empty filter as no filter at all", () => {
        expect(resolveDateFilter(undefined, TODAY)).toEqual({});
        expect(resolveDateFilter(null, TODAY)).toEqual({});
        expect(resolveDateFilter({ operator: "Is", value: null }, TODAY)).toEqual({});
    });

    it("returns nothing for an operator it does not know", () => {
        expect(resolveDateFilter({ operator: "Sometime", value: "2026-07-01" }, TODAY)).toEqual({});
    });
});

describe("hasDateFilter", () => {
    it("is false for anything that would not narrow the query", () => {
        expect(hasDateFilter(undefined)).toBe(false);
        expect(hasDateFilter({ operator: "Timespan", value: "last fortnight" })).toBe(false);
    });

    it("is true as soon as either bound resolves", () => {
        expect(hasDateFilter({ operator: ">=", value: "2026-07-01" })).toBe(true);
        expect(hasDateFilter({ operator: "Timespan", value: "today" })).toBe(true);
    });
});
