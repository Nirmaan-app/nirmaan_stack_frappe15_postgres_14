import { describe, expect, it } from "vitest";

import {
    historyEmptyLabel,
    importCountLabel,
    historySubtitle,
    importsInTab,
    initialHistoryMonth,
    initialHistoryTab,
    matchesEveryToken,
    monthKey,
    monthLabel,
    monthsBetween,
    shiftMonth,
    summaryScopeIsDefault,
    tabCounts,
} from "./importHistoryView";

const ICICI = "ICICI Bank Statement";

describe("months", () => {
    it("names the reader's local month", () => {
        expect(monthKey(new Date(2026, 9, 14))).toBe("2026-10");
        expect(monthKey(new Date(2026, 0, 1))).toBe("2026-01");
    });

    it("steps across a year boundary both ways", () => {
        expect(shiftMonth("2026-01", -1)).toBe("2025-12");
        expect(shiftMonth("2025-12", 1)).toBe("2026-01");
        expect(shiftMonth("2026-10", -13)).toBe("2025-09");
    });

    it("leaves a malformed key alone rather than inventing a month", () => {
        expect(shiftMonth("junk", 1)).toBe("junk");
    });

    it("labels a month in words", () => {
        expect(monthLabel("2026-10")).toBe("October 2026");
    });

    it("offers every month from now back to the earliest, newest first", () => {
        expect(monthsBetween("2026-08", "2026-10")).toEqual(["2026-10", "2026-09", "2026-08"]);
        expect(monthsBetween("2025-11", "2026-02")).toEqual([
            "2026-02",
            "2026-01",
            "2025-12",
            "2025-11",
        ]);
    });

    it("always offers at least the current month, and never a future one", () => {
        expect(monthsBetween(null, "2026-10")).toEqual(["2026-10"]);
        expect(monthsBetween("2027-01", "2026-10")).toEqual(["2026-10"]);
        expect(monthsBetween("junk", "2026-10")).toEqual(["2026-10"]);
    });
});

describe("initialHistoryMonth", () => {
    const today = new Date(2026, 9, 14);

    it("opens on this month with nothing selected", () => {
        expect(initialHistoryMonth(undefined, today)).toBe("2026-10");
    });

    it("opens on the selected statement's END month when it spans two", () => {
        expect(
            initialHistoryMonth({ period_from: "2026-03-25", period_to: "2026-04-08" }, today)
        ).toBe("2026-04");
    });

    it("falls back to the start, then to this month", () => {
        expect(initialHistoryMonth({ period_from: "2026-05-02" }, today)).toBe("2026-05");
        expect(initialHistoryMonth({}, today)).toBe("2026-10");
    });
});

describe("initialHistoryTab", () => {
    it("prefers the selected statement's source over the screen's", () => {
        expect(initialHistoryTab(ICICI, ["Cashbook"])).toBe(ICICI);
    });

    it("uses the screen's Source when exactly one is chosen", () => {
        expect(initialHistoryTab(undefined, ["Cashbook"])).toBe("Cashbook");
    });

    it("opens on the first source when the screen spans several or all", () => {
        expect(initialHistoryTab(undefined, [])).toBe("Cashfree");
        expect(initialHistoryTab(undefined, ["Cashbook", ICICI])).toBe("Cashfree");
    });

    it("ignores a source it has no tab for", () => {
        expect(initialHistoryTab("Paytm", ["Cashbook"])).toBe("Cashbook");
    });
});

describe("importsInTab and tabCounts", () => {
    const imports = [
        { name: "A", source: "Cashfree" },
        { name: "B", source: ICICI },
        { name: "C", source: "" },
        { name: "D", source: " Cashfree " },
    ];

    it("lists one source, and a blank source under every tab", () => {
        expect(importsInTab(imports, "Cashfree").map((o) => o.name)).toEqual(["A", "C", "D"]);
        expect(importsInTab(imports, "Cashbook").map((o) => o.name)).toEqual(["C"]);
    });

    it("counts each tab by the same rule it lists by", () => {
        // The blank-source statement is in every tab, the Porter Statement tab (#1443) included.
        expect(tabCounts(imports)).toEqual({ Cashfree: 3, Cashbook: 1, [ICICI]: 2, "Porter Statement": 1 });
    });
});

describe("matchesEveryToken", () => {
    it("needs every word, in any order, ignoring case", () => {
        expect(matchesEveryToken("may-statement.csv shanu 01-May-2026", "Shanu may")).toBe(true);
        expect(matchesEveryToken("may-statement.csv shanu", "shanu june")).toBe(false);
    });

    it("matches everything on an empty search", () => {
        expect(matchesEveryToken("anything", "   ")).toBe(true);
    });
});

describe("dialog text", () => {
    it("states the source and the month", () => {
        expect(historySubtitle(ICICI, "2026-10")).toBe(
            "ICICI Bank statements covering October 2026. Select one to open it."
        );
        expect(historySubtitle("Porter Statement", "2026-09")).toBe(
            "Porter statements covering September 2026. Select one to open it."
        );
        expect(historySubtitle("Cashfree", "2026-09")).toBe(
            "Cashfree statements covering September 2026. Select one to open it."
        );
    });

    it("tells an empty month from a search that matched nothing", () => {
        expect(historyEmptyLabel("Cashbook", "2026-03", "")).toBe(
            "No Cashbook statements cover March 2026."
        );
        expect(historyEmptyLabel("Cashbook", "2026-03", "shanu")).toBe(
            "No Cashbook statements covering March 2026 match that."
        );
    });
});

describe("summaryScopeIsDefault", () => {
    const base = { sources: [] as string[], period: null, selectedImport: undefined };

    it("is default only when Source, Period and Import are all untouched", () => {
        expect(summaryScopeIsDefault(base)).toBe(true);
    });

    it("is not default once any one of the three moves", () => {
        expect(summaryScopeIsDefault({ ...base, sources: ["Cashbook"] })).toBe(false);
        expect(
            summaryScopeIsDefault({ ...base, period: { operator: "Timespan", value: "last 30 days" } })
        ).toBe(false);
        expect(summaryScopeIsDefault({ ...base, selectedImport: "OFI-26-00007" })).toBe(false);
    });
});

describe("the count on an Import History row", () => {
    it("counts a Porter import in orders", () => {
        expect(importCountLabel("Porter Statement", 158)).toBe("158 orders");
        expect(importCountLabel("Porter Statement", 1)).toBe("1 order");
    });

    it("keeps transfers for a bank import, and for one with no source", () => {
        expect(importCountLabel(ICICI, 12)).toBe("12 transfers");
        expect(importCountLabel("Cashfree", 1)).toBe("1 transfer");
        expect(importCountLabel(null, 0)).toBe("0 transfers");
    });
});
