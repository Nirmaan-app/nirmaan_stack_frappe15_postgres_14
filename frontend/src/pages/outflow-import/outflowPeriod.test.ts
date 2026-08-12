import { describe, expect, it } from "vitest";

import {
    DEFAULT_PERIOD,
    PERIOD_PRESETS,
    PERIOD_URL_KEYS,
    periodFromParams,
    periodLabel,
    periodToParams,
} from "./outflowPeriod";

describe("PERIOD_PRESETS", () => {
    it("offers 'All time' as a real choice, not as the absence of one", () => {
        expect(PERIOD_PRESETS[0]).toEqual({ label: "All time", value: null });
    });

    it("stores every RELATIVE preset as a word, never as dates", () => {
        // ⚠️ THIS IS WHAT KEEPS A RELATIVE WINDOW RELATIVE. A preset frozen into two dates at the
        // moment it was clicked is a bookmark that means something different tomorrow.
        const relative = PERIOD_PRESETS.filter(
            (p) => p.value && p.value.operator === "Timespan"
        );
        expect(relative.length).toBeGreaterThan(10);
        for (const preset of relative) {
            expect(typeof preset.value!.value).toBe("string");
        }
    });

    it("stores the financial years as fixed dates, because they ARE fixed", () => {
        const fy = PERIOD_PRESETS.find((p) => p.label === "FY 25-26");
        expect(fy?.value).toEqual({ operator: "Between", value: ["2025-04-01", "2026-03-31"] });
    });

    it("has no duplicate labels", () => {
        const labels = PERIOD_PRESETS.map((p) => p.label);
        expect(new Set(labels).size).toBe(labels.length);
    });
});

describe("DEFAULT_PERIOD", () => {
    it("opens on ALL TIME, so nothing is hidden by a filter nobody chose", () => {
        // ⚠️ REVERSES the 2026-08-09 worklist ruling (owner, 2026-08-12). It used to be
        // `{ operator: "Timespan", value: "last 30 days" }`; a reviewer looking for an older
        // transfer was shown nothing, with no reason to suspect a date filter.
        expect(DEFAULT_PERIOD).toBeNull();
    });

    it("is the SAME value the control produces when cleared", () => {
        // Opening and clearing must land on one state, or "all time" would mean two different
        // things depending on how you got there.
        expect(DEFAULT_PERIOD).toBe(periodFromParams({ [PERIOD_URL_KEYS.operator]: "none" }));
    });

    it("the trigger names it", () => {
        expect(periodLabel(DEFAULT_PERIOD)).toBe("All time");
    });
});

describe("periodLabel", () => {
    it("names a preset by its own label, not by the dates it resolves to", () => {
        expect(periodLabel({ operator: "Timespan", value: "this month" })).toBe("This Month");
    });

    it("describes a hand-picked range as dates", () => {
        expect(periodLabel({ operator: "Between", value: ["2026-07-01", "2026-07-31"] })).toBe(
            "01-Jul-2026 – 31-Jul-2026"
        );
    });

    it("describes an open-ended bound with its operator", () => {
        expect(periodLabel({ operator: ">=", value: "2026-07-01" })).toBe(
            "On or After 01-Jul-2026"
        );
    });

    it("reads as 'All time' when nothing is set", () => {
        expect(periodLabel(null)).toBe("All time");
        expect(periodLabel(undefined)).toBe("All time");
    });
});

describe("URL round-trip", () => {
    const roundTrip = (value: Parameters<typeof periodToParams>[0]) => {
        const params = periodToParams(value);
        // The store writes `null` to REMOVE a key; the reader sees an absent one.
        const asRead: Record<string, string | null> = {};
        for (const [key, param] of Object.entries(params)) asRead[key] = param;
        return periodFromParams(asRead);
    };

    it("round-trips a timespan", () => {
        const value = { operator: "Timespan", value: "last 90 days" };
        expect(roundTrip(value)).toEqual(value);
    });

    it("round-trips a custom range", () => {
        const value = { operator: "Between", value: ["2026-07-01", "2026-07-31"] };
        expect(roundTrip(value)).toEqual(value);
    });

    it("round-trips an open-ended bound", () => {
        const value = { operator: "<=", value: "2026-07-01" };
        expect(roundTrip(value)).toEqual(value);
    });

    it("round-trips 'All time' as a CHOICE, not as an absence", () => {
        // The default IS all time since 2026-08-12, so this no longer guards against a reload
        // re-narrowing the screen. It is kept because the URL should say what is on screen rather
        // than rely on the reader knowing the default -- and because if a default period is ever
        // reintroduced, this is what stops a cleared filter snapping back to it.
        expect(periodToParams(null)[PERIOD_URL_KEYS.operator]).toBe("none");
        expect(roundTrip(null)).toBeNull();
    });

    it("falls back to the DEFAULT when nothing is in the URL", () => {
        expect(periodFromParams({})).toEqual(DEFAULT_PERIOD);
    });

    it("falls back to the DEFAULT for junk, which now means ALL TIME", () => {
        // ⚠️ THE DIRECTION FLIPPED WITH THE DEFAULT. This used to assert that a stale link showed
        // the worklist window rather than "silently widening to every row staged". Widening is now
        // the safe direction: everything is visibly everything, whereas a stale link resolving to
        // a narrow window hides rows with nothing on screen to say so.
        expect(periodFromParams({ [PERIOD_URL_KEYS.operator]: "Whenever" })).toEqual(DEFAULT_PERIOD);
        expect(periodFromParams({ [PERIOD_URL_KEYS.operator]: "Between" })).toEqual(DEFAULT_PERIOD);
        expect(periodFromParams({ [PERIOD_URL_KEYS.operator]: "Timespan" })).toEqual(DEFAULT_PERIOD);
        expect(periodFromParams({ [PERIOD_URL_KEYS.operator]: "Whenever" })).toBeNull();
    });

    it("does not collide with the reports' shared date keys", () => {
        // `useReportDateStore` shares `rpt_date_*` across every report on purpose. This screen is
        // not one of them, and its date means a different thing.
        for (const key of Object.values(PERIOD_URL_KEYS)) {
            expect(key.startsWith("ofl_")).toBe(true);
        }
    });
});
