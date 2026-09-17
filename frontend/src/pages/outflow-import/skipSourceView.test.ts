// The Skip Type cell's reference line and hover body, per kind (owner, 2026-09-17).
import { describe, expect, it } from "vitest";

import type { OutflowImportRow, SkipSource } from "@/types/NirmaanStack/OutflowImportBatch";

import { skipSourceSummary } from "./skipSourceView";

const EMPTY: SkipSource = { earlier_import: null, earlier_line: null, records: [], rule: null };

const row = (over: Partial<OutflowImportRow> = {}): OutflowImportRow =>
    ({
        name: "OFR-1",
        row_status: "Skipped",
        amount: 5000,
        skip_source: EMPTY,
        ...over,
    }) as OutflowImportRow;

const allFacts = (summary: ReturnType<typeof skipSourceSummary>) =>
    Object.fromEntries(summary.groups.flatMap((g) => g.facts).map((f) => [f.label, f.value]));

describe("skipSourceSummary", () => {
    it("★ Already imported names the earlier statement", () => {
        const summary = skipSourceSummary(
            row({
                skip_kind: "Already imported",
                outcome_note: undefined,
                skip_reason: "Already imported in batch OFI-26-00007.",
                skip_source: {
                    ...EMPTY,
                    earlier_import: {
                        name: "OFI-26-00007",
                        filename: "cashfree-aug.xlsx",
                        source: "Cashfree",
                        uploaded_by: "accounts@nirmaan.app",
                        uploaded_at: "2026-08-02 10:00:00",
                        period_from: "2026-08-01",
                        period_to: "2026-08-31",
                    },
                },
            }),
        );
        expect(summary.reference).toBe("In OFI-26-00007");
        expect(summary.groups[0].title).toBe("Import OFI-26-00007");
        expect(allFacts(summary)).toMatchObject({
            File: "cashfree-aug.xlsx",
            "Uploaded by": "accounts@nirmaan.app",
            Why: "Already imported in batch OFI-26-00007.",
        });
    });

    it("★ Repeated in same file names the first line", () => {
        const summary = skipSourceSummary(
            row({
                skip_kind: "Repeated in same file",
                skip_source: {
                    ...EMPTY,
                    earlier_line: {
                        name: "OFR-0",
                        added_on: "2026-09-01 10:00:00",
                        amount: 5000,
                        reference: "UTR123",
                        row_status: "Settled",
                    },
                },
            }),
        );
        expect(summary.reference).toBe("Same as UTR123");
        expect(allFacts(summary)).toMatchObject({ Reference: "UTR123", Status: "Settled" });
    });

    it("★ an already-recorded skip names each record, and an expense by its description", () => {
        const summary = skipSourceSummary(
            row({
                skip_kind: "Outflow Already Recorded",
                skip_source: {
                    ...EMPTY,
                    records: [
                        {
                            doctype: "Project Payments", name: "PAY-1", amount: 3000, date: "2026-09-01",
                            status: "Paid", party: "Sri Sai", project: "Olive", reference: "UTR9", description: "",
                        },
                        {
                            doctype: "Non Project Expenses", name: "ecuu6rldvp", amount: 2000, date: null,
                            status: "Paid", party: null, project: null, reference: "", description: "Office rent",
                        },
                    ],
                },
            }),
        );
        expect(summary.reference).toBe("Project Payment PAY-1 +1 more");
        expect(summary.groups.map((g) => g.title)).toEqual([
            "Project Payment PAY-1",
            "Non-Project Expense Office rent",
        ]);
        expect(summary.groups[0].facts.map((f) => f.label)).toEqual([
            "Amount", "Status", "Date", "Project", "Party", "Reference",
        ]);
    });

    it("★ a bank-rule kind shows what the rule catches", () => {
        const summary = skipSourceSummary(
            row({ skip_kind: "Porter wallet top-up", skip_source: { ...EMPTY, rule: "Money moved into our Porter wallet." } }),
        );
        expect(summary.reference).toBe("");
        expect(allFacts(summary).Rule).toBe("Money moved into our Porter wallet.");
    });

    it("Bank refused shows the bank's own word", () => {
        expect(skipSourceSummary(row({ skip_kind: "Bank refused", status_raw: "FAILED" })).reference).toBe(
            "Bank status: FAILED",
        );
    });

    it("a hand skip shows who and the reason they typed", () => {
        const summary = skipSourceSummary(
            row({
                skip_kind: "Skipped by hand",
                skip_origin: "Manual",
                skip_reason: "not ours",
                decided_by: "priya@nirmaan.app",
            }),
        );
        expect(allFacts(summary)).toMatchObject({ By: "priya@nirmaan.app", Reason: "not ours" });
    });

    it("a missing document falls back to the reason alone", () => {
        const summary = skipSourceSummary(
            row({ skip_kind: "Already imported", skip_reason: "Already imported in batch OFI-9.", skip_source: EMPTY }),
        );
        expect(summary.reference).toBe("");
        expect(summary.groups).toEqual([{ title: "", facts: [{ label: "Why", value: "Already imported in batch OFI-9." }] }]);
    });
});
