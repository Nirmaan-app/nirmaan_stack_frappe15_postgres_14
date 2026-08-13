// src/pages/outflow-import/cashbookPreview.test.ts

import { describe, expect, it } from "vitest";

import {
    CashbookPreviewGroup,
    CashbookPreviewRow,
    CashbookStatus,
    NON_PROJECT_LEDGER,
    PROJECT_LEDGER,
    createLabel,
    isLoneRow,
    ledgerSections,
    progressFraction,
    progressText,
    sortGroups,
    typeHint,
    typeLabel,
} from "./cashbookPreview";

const group = (
    ledger: string,
    label: string,
    count: number,
    value: number
): CashbookPreviewGroup => ({ ledger, key: label, label, count, value, rows: [] });

const row = (over: Partial<CashbookPreviewRow> = {}): CashbookPreviewRow => ({
    row_number: 1,
    transfer_id: "OBO1",
    amount: 100,
    remarks: "something",
    beneficiary_name: "A Payee",
    spent_by: "A Spender",
    expense_type: "Material Purchases",
    matched_keyword: "purchase",
    is_fallback_type: false,
    ...over,
});

const status = (over: Partial<CashbookStatus> = {}): CashbookStatus => ({
    batch: "OFI-1",
    created: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    running: false,
    batch_status: "Completed",
    ...over,
});

describe("ordering is the safety feature", () => {
    it("puts the largest value first", () => {
        const sorted = sortGroups([
            group(PROJECT_LEDGER, "Small", 1, 55),
            group(PROJECT_LEDGER, "Big", 16, 21593),
            group(PROJECT_LEDGER, "Middle", 3, 1800),
        ]);
        expect(sorted.map((g) => g.label)).toEqual(["Big", "Middle", "Small"]);
    });

    it("sinks the one-row groups into a block at the bottom", () => {
        // ⚠️ THE WHOLE ARGUMENT FOR A READ-ONLY PREVIEW. A project with one small row is the shape
        // a wrong match takes; sorting by value is what gathers them where a reader will look.
        const sorted = sortGroups([
            group(PROJECT_LEDGER, "Lone A", 1, 70),
            group(PROJECT_LEDGER, "Busy", 16, 21593),
            group(PROJECT_LEDGER, "Lone B", 1, 55),
            group(PROJECT_LEDGER, "Also busy", 10, 13173),
        ]);
        expect(sorted.slice(-2).every(isLoneRow)).toBe(true);
    });

    it("breaks a tie on the label so equal values do not shuffle between renders", () => {
        const sorted = sortGroups([
            group(PROJECT_LEDGER, "Zebra", 1, 500),
            group(PROJECT_LEDGER, "Alpha", 1, 500),
        ]);
        expect(sorted.map((g) => g.label)).toEqual(["Alpha", "Zebra"]);
    });
});

describe("the two ledger sections", () => {
    it("splits the groups and totals each side", () => {
        const sections = ledgerSections([
            group(PROJECT_LEDGER, "Telus", 16, 21593),
            group(PROJECT_LEDGER, "CTS", 16, 11742),
            group(NON_PROJECT_LEDGER, "Petty Cash", 20, 21899),
        ]);
        expect(sections.map((s) => s.ledger)).toEqual([PROJECT_LEDGER, NON_PROJECT_LEDGER]);
        expect(sections[0].count).toBe(32);
        expect(sections[0].value).toBe(33335);
        expect(sections[1].count).toBe(20);
    });

    it("omits a ledger with nothing in it rather than showing a zero", () => {
        // An empty heading reads as a category that failed to fill; a missing one reads as a
        // statement that had none of that kind, which is what happened.
        const sections = ledgerSections([group(NON_PROJECT_LEDGER, "Petty Cash", 2, 100)]);
        expect(sections.map((s) => s.ledger)).toEqual([NON_PROJECT_LEDGER]);
    });

    it("returns nothing at all for an empty statement", () => {
        expect(ledgerSections([])).toEqual([]);
    });

    it("keeps the project side first, because that is the side worth checking", () => {
        const sections = ledgerSections([
            group(NON_PROJECT_LEDGER, "Petty Cash", 20, 21899),
            group(PROJECT_LEDGER, "Telus", 1, 5),
        ]);
        expect(sections[0].ledger).toBe(PROJECT_LEDGER);
    });
});

describe("what a row's expense type says", () => {
    it("names the keyword that chose it, so a surprising type can be traced", () => {
        expect(typeHint(row({ matched_keyword: "locally purchased" }))).toBe(
            "Matched “locally purchased”"
        );
    });

    it("says plainly that nothing matched rather than leaving it blank", () => {
        // "We could not tell" is a real answer; an empty cell is not.
        expect(typeHint(row({ is_fallback_type: true, matched_keyword: "" }))).toBe(
            "No rule matched this remark"
        );
    });

    it("falls back to a dash when there is no type at all", () => {
        expect(typeLabel(row({ expense_type: null }))).toBe("—");
    });
});

describe("the progress line", () => {
    it("counts up while the job runs", () => {
        expect(progressText(status({ created: 40, running: true }), 115)).toBe(
            "Created 40 of 115…"
        );
    });

    it("reports failures on the same line that says it finished", () => {
        // ⚠️ "Created 115 records" beside three quiet failures is the shape that gets failures
        // ignored.
        const text = progressText(status({ created: 112, failed: 3 }), 115);
        expect(text).toContain("112");
        expect(text).toContain("3 could not be created");
    });

    it("says how many were created when nothing failed", () => {
        expect(progressText(status({ created: 115 }), 115)).toBe("Created 115 records.");
    });

    it("uses the singular for one record", () => {
        expect(progressText(status({ created: 1 }), 1)).toBe("Created 1 record.");
        expect(createLabel(1)).toBe("Create 1 record");
        expect(createLabel(115)).toBe("Create 115 records");
    });

    it("shows something before the first poll returns", () => {
        expect(progressText(null, 115)).toBe("Creating 115…");
    });
});

describe("the progress bar never lies about being finished", () => {
    it("is empty before the first poll", () => {
        expect(progressFraction(null, 115)).toBe(0);
    });

    it("counts a failed row as done, because the job will not retry it", () => {
        expect(progressFraction(status({ created: 50, failed: 5 }), 110)).toBeCloseTo(0.5);
    });

    it("never exceeds one", () => {
        expect(progressFraction(status({ created: 200 }), 115)).toBe(1);
    });

    it("does not divide by zero when there is nothing to create", () => {
        expect(progressFraction(status(), 0)).toBe(1);
    });
});
