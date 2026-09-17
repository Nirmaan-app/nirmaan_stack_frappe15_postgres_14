import { describe, expect, it } from "vitest";

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";

import {
    afterLinking,
    bulkIdOf,
    filterLinkableExpenses,
    fitMark,
    linkActionLabel,
    linkButtonState,
    linkedNotice,
    linkedSoFarNote,
    selectedMoneyIn,
    tickedLines,
    tickedSubline,
    type LinkableExpense,
} from "./linkLinesView";

const row = (name: string, amount: number, extra: Partial<OutflowImportRow> = {}): OutflowImportRow =>
    ({
        name,
        transfer_id: name,
        amount,
        service_charge: 0,
        service_tax: 0,
        row_status: "Matched",
        direction: "Debit",
        ...extra,
    }) as OutflowImportRow;

const expense = (extra: Partial<LinkableExpense> = {}): LinkableExpense => ({
    target_doctype: "Non Project Expenses",
    name: "toj650dsqd",
    expense_type: "Staff Welfare",
    description: "Reimbursement for july 2026",
    project: "",
    project_name: "",
    amount: 160113,
    linked_total: 138633,
    line_count: 25,
    remaining: 21480,
    payment_ref: "",
    ...extra,
});

describe("linkButtonState", () => {
    const rows = [row("a", 6240), row("b", 3870), row("c", 1905, { direction: "Credit" })];

    it("is ready when every ticked line is money out and on this page", () => {
        const state = linkButtonState(rows, new Set(["a", "b"]), new Map(), 0);
        expect(state).toEqual({ enabled: true, count: 2, note: null, offPage: null });
    });

    it("is off with nothing ticked, and says nothing", () => {
        expect(linkButtonState(rows, new Set(), new Map(), 0)).toMatchObject({
            enabled: false,
            count: 0,
            note: null,
        });
    });

    it("names the page the other ticks are on", () => {
        const state = linkButtonState(
            rows,
            new Set(["a", "x", "y"]),
            new Map([
                ["x", 0],
                ["y", 0],
            ]),
            1
        );
        expect(state.enabled).toBe(false);
        expect(state.offPage).toBe("2 on page 1");
        expect(state.note).toBe(
            "2 ticked lines are on page 1. Linking works on one page at a time: go back to page 1, or untick those 2."
        );
    });

    it("words one off-page line and several pages", () => {
        expect(linkButtonState(rows, new Set(["a", "x"]), new Map([["x", 2]]), 0).note).toBe(
            "1 ticked line is on page 3. Linking works on one page at a time: go back to page 3, or untick it."
        );
        expect(
            linkButtonState(
                rows,
                new Set(["x", "y", "z"]),
                new Map([
                    ["x", 0],
                    ["y", 2],
                    ["z", 0],
                ]),
                1
            ).note
        ).toBe(
            "3 ticked lines are on pages 1 and 3. Linking works on one page at a time: go back to those pages, or untick those 3."
        );
    });

    it("says another page when it does not know which", () => {
        expect(linkButtonState(rows, new Set(["a", "x"]), new Map(), 0).note).toBe(
            "1 ticked line is on another page. Linking works on one page at a time: go back to it, or untick it."
        );
    });

    it("refuses a ticked money-in line", () => {
        const state = linkButtonState(rows, new Set(["a", "c"]), new Map(), 0);
        expect(state.enabled).toBe(false);
        expect(state.note).toBe(
            "An expense only takes money-out lines. Untick the 1 money-in line to link the rest."
        );
        expect(linkButtonState([...rows, row("d", 5, { direction: "Credit" })], new Set(["a", "c", "d"]), new Map(), 0).note).toBe(
            "An expense only takes money-out lines. Untick the 2 money-in lines to link the rest."
        );
    });

    it("reports the other page before the money-in line", () => {
        const state = linkButtonState(rows, new Set(["c", "x"]), new Map([["x", 0]]), 1);
        expect(state.note).toMatch(/^1 ticked line is on page 1\./);
    });

    it("counts a blank direction as money out, as the Amount cell does", () => {
        const blank = [row("g", 100, { direction: "" })];
        expect(linkButtonState(blank, new Set(["g"]), new Map(), 0).enabled).toBe(true);
    });
});

describe("selectedMoneyIn", () => {
    it("sums only ticked credits", () => {
        const rows = [row("a", 6240), row("c", 1905, { direction: "Credit" }), row("d", 10, { direction: "Credit" })];
        expect(selectedMoneyIn(rows, new Set(["a", "c"]))).toBe(1905);
    });
});

describe("fitMark", () => {
    it("fills it when the lines cover what is left", () => {
        expect(fitMark(21480, expense())).toEqual({
            kind: "fills",
            pickable: true,
            label: "fills it · becomes Paid",
        });
    });

    it("fills it within five rupees either side", () => {
        expect(fitMark(21475, expense()).kind).toBe("fills");
        expect(fitMark(21485, expense()).kind).toBe("fills");
    });

    it("fits with what is left after", () => {
        expect(fitMark(21480, expense({ remaining: 3359999, linked_total: 0, line_count: 0, amount: 3359999 }))).toEqual({
            kind: "fits",
            pickable: true,
            label: "fits · ₹33,38,519 left after",
        });
    });

    it("is too big past five rupees over, and not pickable", () => {
        expect(fitMark(21480, expense({ remaining: 20000, linked_total: 0, amount: 20000 }))).toEqual({
            kind: "too_big",
            pickable: false,
            label: "too big by ₹1,480",
        });
        expect(fitMark(21485.01, expense()).kind).toBe("too_big");
    });
});

describe("afterLinking", () => {
    const lines = { total: 21480, count: 5, latestDate: "2026-08-18 10:31:00", bulkId: "BULD76992401" };

    it("says Paid, the date and the kept reference when the lines fill it", () => {
        expect(afterLinking(lines, expense({ payment_ref: "SALARY-JULY" }))).toEqual({
            tone: "ok",
            summary: "After linking: ₹1,60,113 of ₹1,60,113 linked · left ₹0",
            detail: "toj650dsqd becomes Paid, dated 18-Aug-2026 (the latest line). Its reference stays as it is.",
        });
    });

    it("keeps the run's reference rules for one line that only part-fills a fresh expense", () => {
        const fresh = expense({ amount: 27000, linked_total: 0, line_count: 0, remaining: 27000 });
        expect(afterLinking({ total: 5000, count: 1, latestDate: "2026-07-28", bulkId: "BULD1" }, fresh).detail).toBe(
            "toj650dsqd stays Reconciliation Pending until the rest is linked. No payment date yet. Its blank reference gets the bulk id BULD1."
        );
    });

    it("says it stays pending with no date on a part-fill", () => {
        expect(afterLinking({ ...lines, total: 10000 }, expense()).detail).toBe(
            "toj650dsqd stays Reconciliation Pending until the rest is linked. No payment date yet. Its blank reference gets the bulk id BULD76992401."
        );
        expect(afterLinking({ ...lines, total: 10000 }, expense()).summary).toBe(
            "After linking: ₹1,48,633 of ₹1,60,113 linked · left ₹11,480"
        );
    });

    it("says the line's own reference is written on a one-line fresh expense", () => {
        const fresh = expense({ amount: 5000, linked_total: 0, line_count: 0, remaining: 5000 });
        expect(afterLinking({ total: 5000, count: 1, latestDate: "2026-07-28", bulkId: null }, fresh).detail).toBe(
            "toj650dsqd becomes Paid, dated 28-Jul-2026 (the latest line). It takes this line's reference."
        );
    });

    it("leaves a blank reference blank when the lines share no bulk id", () => {
        expect(afterLinking({ ...lines, bulkId: null }, expense()).detail).toBe(
            "toj650dsqd becomes Paid, dated 18-Aug-2026 (the latest line). Its reference stays blank."
        );
    });

    it("says over by when the lines do not fit", () => {
        expect(afterLinking(lines, expense({ remaining: 12480, linked_total: 147633 }))).toEqual({
            tone: "over",
            summary: "After linking: ₹1,69,113 of ₹1,60,113 linked · over by ₹9,000",
            detail: null,
        });
    });
});

describe("linkActionLabel", () => {
    it("says how many lines and whether the expense becomes Paid", () => {
        expect(linkActionLabel(5, true)).toBe("Link 5 lines · becomes Paid");
        expect(linkActionLabel(25, false)).toBe("Link 25 lines");
        expect(linkActionLabel(1, false)).toBe("Link 1 line");
    });
});

describe("linkedSoFarNote", () => {
    it("counts the lines", () => {
        expect(linkedSoFarNote(expense({ line_count: 0 }))).toBe("no lines yet");
        expect(linkedSoFarNote(expense({ line_count: 1 }))).toBe("1 line");
        expect(linkedSoFarNote(expense())).toBe("25 lines");
    });
});

describe("bulkIdOf", () => {
    it("names the one run every line carries", () => {
        expect(
            bulkIdOf(["MMT/IMPS/623018455120/BULD76992401/Anil/ICIC0000001", "MMT/IMPS/6230/BULD76992401/Priya/X"])
        ).toBe("BULD76992401");
    });

    it("ignores a truncated repeat of the id", () => {
        expect(bulkIdOf(["RTGS/ICICR42026/UTIB0000468/67453750/BULD67453750  /TARANGFIRESOLUTI/BULD67"])).toBe(
            "BULD67453750"
        );
    });

    it("names none when lines disagree, one has none, or there are none", () => {
        expect(bulkIdOf(["x/BULD111/y", "x/BULD222/y"])).toBeNull();
        expect(bulkIdOf(["x/BULD111/y", "Sample Project materials"])).toBeNull();
        expect(bulkIdOf([])).toBeNull();
    });
});

describe("filterLinkableExpenses", () => {
    const records = [
        expense(),
        expense({ name: "pe7c2m90xa", target_doctype: "Project Expenses", expense_type: "Labour", description: "Site labour advance", project_name: "Prestige Lakeside" }),
    ];

    it("passes everything through on a blank search", () => {
        expect(filterLinkableExpenses(records, "  ")).toHaveLength(2);
    });

    it("matches id, type, description or project, every word", () => {
        expect(filterLinkableExpenses(records, "toj650").map((r) => r.name)).toEqual(["toj650dsqd"]);
        expect(filterLinkableExpenses(records, "labour").map((r) => r.name)).toEqual(["pe7c2m90xa"]);
        expect(filterLinkableExpenses(records, "prestige advance").map((r) => r.name)).toEqual(["pe7c2m90xa"]);
        expect(filterLinkableExpenses(records, "july welfare").map((r) => r.name)).toEqual(["toj650dsqd"]);
    });
});

describe("linkedNotice", () => {
    it("says where the lines went and what the expense is now", () => {
        expect(linkedNotice(5, { name: "toj650dsqd", status: "Paid", remaining: 0 })).toEqual({
            title: "Linked.",
            body: "5 lines are on toj650dsqd, which is now Paid.",
        });
        expect(linkedNotice(1, { name: "toj650dsqd", status: "Reconciliation Pending", remaining: 21480 })).toEqual({
            title: "Linked.",
            body: "1 line is on toj650dsqd, which stays Reconciliation Pending with ₹21,480 left.",
        });
    });
});

describe("tickedLines and tickedSubline", () => {
    const run = [
        row("a", 6240, { added_on: "2026-08-18 10:31:00", source: "ICICI Bank Statement", import_batch: "OFI-26-04616", remarks: "MMT/IMPS/1/BULD76992401/Anil/X" }),
        row("b", 3870, { added_on: "2026-08-18 10:35:00", source: "ICICI Bank Statement", import_batch: "OFI-26-04616", remarks: "MMT/IMPS/2/BULD76992401/Priya/X" }),
    ];

    it("totals the lines and finds the latest date and the shared bulk id", () => {
        expect(tickedLines(run)).toEqual({
            total: 10110,
            count: 2,
            latestDate: "2026-08-18 10:35:00",
            bulkId: "BULD76992401",
        });
    });

    it("reads date · import · bulk id", () => {
        expect(tickedSubline(run)).toBe("18-Aug-2026 · ICICI Bank Statement · OFI-26-04616 · bulk id BULD76992401");
    });

    it("shows a date range and an import count when the lines span them, and no bank when they differ", () => {
        const mixed = [...run, row("c", 10, { added_on: "2026-08-19 09:00:00", source: "Cashfree", import_batch: "OFI-26-04617" })];
        expect(tickedSubline(mixed)).toBe("18-Aug-2026 – 19-Aug-2026 · 2 imports");
    });
});
