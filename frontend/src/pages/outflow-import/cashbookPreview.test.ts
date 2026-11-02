// src/pages/outflow-import/cashbookPreview.test.ts

import { describe, expect, it } from "vitest";

import {
    CashbookPreviewGroup,
    CashbookPreviewRow,
    CashbookRefundPair,
    CashbookSkippedRow,
    CashbookLateBill,
    CashbookReopenedLine,
    CashbookStatus,
    NON_PROJECT_LEDGER,
    PROJECT_LEDGER,
    billNotCopiedLabel,
    billsNotCopiedHeading,
    canConfirm,
    confirmLabel,
    createLabel,
    duplicateNotice,
    invoiceCountsText,
    isLoneRow,
    lateBillLabel,
    lateBillsDoneText,
    lateBillsHeading,
    ledgerSections,
    openLinesHeading,
    pairSpendLabel,
    pairsHeading,
    progressFraction,
    progressText,
    reopenedHeading,
    reopenedLabel,
    showsResume,
    stoppedText,
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
    stopped: false,
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

describe("a job that stopped part-way (#1589)", () => {
    const stopped = status({ created: 2, pending: 12, stopped: true, batch_status: "Draft" });

    it("says how many lines are still waiting", () => {
        expect(stoppedText(stopped)).toBe("Stopped: 12 lines still waiting");
        expect(stoppedText(status({ pending: 1, stopped: true }))).toBe("Stopped: 1 line still waiting");
    });

    it("is the progress line once the job has stopped", () => {
        expect(progressText(stopped, 14)).toBe("Stopped: 12 lines still waiting");
    });

    it("offers Resume only when lines wait and no job is queued or running", () => {
        expect(showsResume(stopped)).toBe(true);
        expect(showsResume(status({ pending: 12, running: true }))).toBe(false);
        expect(showsResume(status({ created: 14 }))).toBe(false);
        expect(showsResume(null)).toBe(false);
    });

    it("says nothing about stopping while the job runs or after it finished", () => {
        expect(stoppedText(status({ pending: 12, running: true }))).toBeNull();
        expect(stoppedText(status({ created: 14 }))).toBeNull();
    });

    it("counts the bills a stopped job still has to copy (code review S1, S2)", () => {
        expect(stoppedText(status({ pending: 0, bills_waiting: 2, stopped: true }))).toBe(
            "Stopped: 2 bills still to copy"
        );
        expect(stoppedText(status({ pending: 0, bills_waiting: 1, stopped: true }))).toBe("Stopped: 1 bill still to copy");
        expect(stoppedText(status({ pending: 3, bills_waiting: 1, stopped: true }))).toBe(
            "Stopped: 3 lines still waiting, 1 bill still to copy"
        );
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

describe("the already-imported notice (ADR-0031)", () => {
    const dup = (over: Partial<Parameters<typeof duplicateNotice>[0]> = {}) => ({
        duplicate_rows: 0,
        duplicate_message: "",
        refused: false,
        warn: false,
        ...over,
    });

    it("says nothing when no line is already imported", () => {
        expect(duplicateNotice(dup())).toBeNull();
    });

    it("says the repeats will not be saved, in the server's own words", () => {
        const message = "3 of 10 transfers were already imported in batch OFI-7. They will not be saved.";
        expect(duplicateNotice(dup({ duplicate_rows: 3, duplicate_message: message }))).toEqual({
            tone: "info",
            text: message,
        });
    });

    it("warns when most of the file is already imported", () => {
        expect(duplicateNotice(dup({ duplicate_rows: 9, duplicate_message: "m", warn: true }))?.tone).toBe(
            "warn"
        );
    });

    it("marks a refusal as a refusal, not a louder warning", () => {
        expect(
            duplicateNotice(dup({ duplicate_rows: 10, duplicate_message: "Not imported.", refused: true }))
        ).toEqual({ tone: "refused", text: "Not imported." });
    });

    it("falls back to a count when an older server sends no message", () => {
        expect(duplicateNotice(dup({ duplicate_rows: 2 }))?.text).toBe(
            "2 already imported — will not be saved"
        );
    });
});

describe("the invoice counts before Create (#1591)", () => {
    it("says how many spends carry 1 file, how many are merged, and how many will wait", () => {
        expect(
            invoiceCountsText({ creating: 2191, invoices: { one_file: 1243, merged: 62, waiting: 886 } })
        ).toBe("2,191 spends: 1,243 with 1 file, 62 with 2–4 files (merged), 886 will wait for an invoice");
    });

    it("uses the singular for one spend", () => {
        expect(invoiceCountsText({ creating: 1, invoices: { one_file: 0, merged: 0, waiting: 1 } })).toBe(
            "1 spend: 0 with 1 file, 0 with 2–4 files (merged), 1 will wait for an invoice"
        );
    });

    it("says nothing for a server that sends no counts, or nothing to create", () => {
        expect(invoiceCountsText({ creating: 5 })).toBeNull();
        expect(invoiceCountsText({ creating: 0, invoices: { one_file: 0, merged: 0, waiting: 0 } })).toBeNull();
    });
});

describe("each bill not copied, as the import summary lists it (#1591, code review S3)", () => {
    it("names the spend and its Expense, or says the line is an open Collect payment", () => {
        expect(billNotCopiedLabel({ transfer_id: "OBO1", expense: "PE-1", reason: "x" })).toBe("OBO1 (PE-1)");
        expect(billNotCopiedLabel({ transfer_id: "OBO2", expense: null, reason: "x" })).toBe(
            "OBO2 (open Collect payment)"
        );
    });
});

describe("the bills the job could not copy (#1591)", () => {
    const line = { transfer_id: "OBO1", expense: "PE-1", reason: "Bill not copied: the storage refused it (HTTP 403)." };

    it("is silent while the job runs or when every bill was copied", () => {
        expect(billsNotCopiedHeading(status({ created: 3, bills_not_copied: [] }))).toBeNull();
        expect(billsNotCopiedHeading(status({ created: 3, running: true, bills_not_copied: [line] }))).toBeNull();
        expect(billsNotCopiedHeading(null)).toBeNull();
    });

    it("counts the spends whose bills were not copied, once the job is done", () => {
        expect(billsNotCopiedHeading(status({ created: 3, bills_not_copied: [line] }))).toBe(
            "1 spend's bills were not copied. Its Expense waits for an invoice:"
        );
        expect(billsNotCopiedHeading(status({ created: 3, bills_not_copied: [line, line] }))).toBe(
            "2 spends' bills were not copied. Their Expenses wait for an invoice:"
        );
    });

    it("says an open Collect payment stays open to decide, not that an Expense waits (code review R6)", () => {
        const collect = { transfer_id: "OBO2", expense: null, reason: "Bill not copied: the server answered 403." };
        expect(billsNotCopiedHeading(status({ bills_not_copied: [collect] }))).toBe(
            "1 Collect payment's bills were not copied. It stays open on the main table for Create expense or Skip by hand:"
        );
        expect(billsNotCopiedHeading(status({ bills_not_copied: [collect, collect] }))).toBe(
            "2 Collect payments' bills were not copied. They stay open on the main table for Create expense or Skip by hand:"
        );
        expect(billsNotCopiedHeading(status({ created: 3, bills_not_copied: [line, collect] }))).toBe(
            "2 bills were not copied. Each Expense waits for an invoice; each Collect payment stays open on the main table:"
        );
    });
});


describe("the paired wallet refunds and the open lines on Review (#1594)", () => {
    const line = (over: Partial<CashbookSkippedRow> = {}): CashbookSkippedRow => ({
        row_number: 1,
        transfer_id: "OBO3",
        amount: 350,
        remarks: "Collect request approved",
        reason: "",
        beneficiary_name: "Testshop Collect Three",
        row_kind: "Collect Payment",
        ...over,
    });
    const pair: CashbookRefundPair = { refund: line({ transfer_id: "REF-OBO3", row_kind: "Refund to Wallet" }), spend: line() };

    it("heads the pairs, saying neither line is recorded", () => {
        expect(pairsHeading([pair])).toBe(
            "1 paired wallet refund: the refund gives back the whole spend, so neither line is recorded"
        );
        expect(pairsHeading([pair, pair])).toBe(
            "2 paired wallet refunds: each refund gives back a whole spend, so neither line is recorded"
        );
    });

    it("heads the lines that stay open", () => {
        expect(openLinesHeading([line()])).toBe("1 line will stay open for someone to decide on the transactions screen");
        expect(openLinesHeading([line(), line(), line()])).toBe(
            "3 lines will stay open for someone to decide on the transactions screen"
        );
    });

    it("says nothing when a server sends none, or an older server sends no key", () => {
        expect(pairsHeading([])).toBeNull();
        expect(pairsHeading(undefined)).toBeNull();
        expect(openLinesHeading(undefined)).toBeNull();
    });

    it("names a pair's spend by its kind, its Txn Id and who was paid", () => {
        expect(pairSpendLabel(pair)).toBe("Collect Payment OBO3 · Testshop Collect Three");
        expect(pairSpendLabel({ ...pair, spend: line({ row_kind: undefined, beneficiary_name: "" }) })).toBe(
            "Spend OBO3 · Collect request approved"
        );
    });
});

describe("the existing Expenses that get a late bill (#1593)", () => {
    const late = (over: Partial<CashbookLateBill> = {}): CashbookLateBill => ({
        row_number: 2,
        transfer_id: "OBO2",
        amount: 70,
        remarks: "Pay to merchant",
        expense_doctype: "Non Project Expenses",
        expense: "NPE-0042",
        bills: 1,
        ...over,
    });

    it("heads the list by how many Expenses get a bill, and says nothing when none do", () => {
        expect(lateBillsHeading(undefined)).toBeNull();
        expect(lateBillsHeading([])).toBeNull();
        expect(lateBillsHeading([late()])).toBe(
            "1 existing Expense will get its bill. Its line is already imported and is not saved again"
        );
        expect(lateBillsHeading([late(), late({ expense: "NPE-0043" })])).toBe(
            "2 existing Expenses will get their bills. Their lines are already imported and are not saved again"
        );
    });

    it("names the Expense, the line and how many bills", () => {
        expect(lateBillLabel(late())).toBe("NPE-0042 · OBO2 · Pay to merchant");
        expect(lateBillLabel(late({ remarks: "", bills: 3 }))).toBe("NPE-0042 · OBO2 · 3 bills, merged");
    });

    it("offers the confirm for a file whose only work is late bills, named for what it does", () => {
        const onlyLate = { creating: 0, refused: false, late_bills: [late()] };
        expect(canConfirm(onlyLate)).toBe(true);
        expect(confirmLabel(onlyLate)).toBe("Add 1 bill");
        expect(confirmLabel({ ...onlyLate, late_bills: [late(), late()] })).toBe("Add 2 bills");
        expect(confirmLabel({ creating: 3, late_bills: [late()] })).toBe("Create 3 records");
        expect(canConfirm({ creating: 0, refused: false, late_bills: [] })).toBe(false);
        expect(canConfirm({ creating: 3, refused: true })).toBe(false);
    });

    it("says what became of the late bills once the job is done", () => {
        expect(lateBillsDoneText(0, false)).toBeNull();
        expect(lateBillsDoneText(2, true)).toBe("Adding bills to 2 existing Expenses…");
        expect(lateBillsDoneText(1, false)).toBe(
            "Bill added to 1 existing Expense, unless someone had already attached an invoice or marked it No invoice."
        );
    });
});

describe("the lines an earlier import wrongly skipped, re-opened by this statement (#1596)", () => {
    const reopened = (over: Partial<CashbookReopenedLine> = {}): CashbookReopenedLine => ({
        row_number: 20,
        transfer_id: "PTM6",
        amount: 9000,
        remarks: "",
        reason: "Wallet credit: money paid into the wallet from outside. Decide what it is.",
        row_kind: "Wallet Credit",
        earlier_batch: "OFI-26-00237",
        becomes: "open",
        ...over,
    });

    it("heads the list by how many lines come back, and says nothing when none do", () => {
        expect(reopenedHeading(undefined)).toBeNull();
        expect(reopenedHeading([])).toBeNull();
        expect(reopenedHeading([reopened()])).toBe(
            "1 line an earlier import skipped as own balances will be re-opened under the new rules"
        );
        expect(reopenedHeading([reopened(), reopened({ transfer_id: "OBO1" })])).toBe(
            "2 lines earlier imports skipped as own balances will be re-opened under the new rules"
        );
    });

    it("names the line, the import that holds it and what it becomes", () => {
        expect(reopenedLabel(reopened())).toBe("Wallet Credit PTM6 · in OFI-26-00237 · stays open");
        expect(reopenedLabel(reopened({ row_kind: "Collect Payment", transfer_id: "OBO3", becomes: "paired" }))).toBe(
            "Collect Payment OBO3 · in OFI-26-00237 · paired wallet refund"
        );
    });

    it("offers the confirm for a file whose only work is re-opening, named for what it does", () => {
        const onlyReopen = { creating: 0, refused: false, late_bills: [], reopened: [reopened()] };
        expect(canConfirm(onlyReopen)).toBe(true);
        expect(confirmLabel(onlyReopen)).toBe("Re-open 1 line");
        expect(confirmLabel({ ...onlyReopen, reopened: [reopened(), reopened()] })).toBe("Re-open 2 lines");
        expect(confirmLabel({ ...onlyReopen, creating: 3 })).toBe("Create 3 records");
        expect(canConfirm({ ...onlyReopen, refused: true })).toBe(false);
    });
});
