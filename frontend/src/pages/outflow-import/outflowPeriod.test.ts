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
    it("opens on a worklist window rather than on every row ever staged", () => {
        // The same reasoning as `DEFAULT_TAB = notMatched` (owner ruling 2026-08-09): this screen
        // is a worklist first.
        expect(DEFAULT_PERIOD).toEqual({ operator: "Timespan", value: "last 30 days" });
    });

    it("is a TIMESPAN, so the default can never go stale", () => {
        expect(DEFAULT_PERIOD.operator).toBe("Timespan");
    });

    it("is one of the presets, so the trigger can name it", () => {
        expect(periodLabel(DEFAULT_PERIOD)).toBe("Last 30 days");
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
        // ⚠️ THE LOAD-BEARING ONE. If clearing the period merely removed the key, a reload would
        // fall back to the default window and silently re-narrow a screen somebody deliberately
        // widened. `none` is that choice, spelled out.
        expect(periodToParams(null)[PERIOD_URL_KEYS.operator]).toBe("none");
        expect(roundTrip(null)).toBeNull();
    });

    it("falls back to the DEFAULT when nothing is in the URL", () => {
        expect(periodFromParams({})).toEqual(DEFAULT_PERIOD);
    });

    it("falls back to the DEFAULT — not to All time — for junk", () => {
        // A stale link should show the ordinary worklist, not silently widen to every row staged.
        expect(periodFromParams({ [PERIOD_URL_KEYS.operator]: "Whenever" })).toEqual(DEFAULT_PERIOD);
        expect(periodFromParams({ [PERIOD_URL_KEYS.operator]: "Between" })).toEqual(DEFAULT_PERIOD);
        expect(periodFromParams({ [PERIOD_URL_KEYS.operator]: "Timespan" })).toEqual(DEFAULT_PERIOD);
    });

    it("does not collide with the reports' shared date keys", () => {
        // `useReportDateStore` shares `rpt_date_*` across every report on purpose. This screen is
        // not one of them, and its date means a different thing.
        for (const key of Object.values(PERIOD_URL_KEYS)) {
            expect(key.startsWith("ofl_")).toBe(true);
        }
    });
});
