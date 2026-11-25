import { describe, expect, it } from "vitest";

import { bankDetailRows, type BankPlanLine } from "./bankRectify";
import { lineMoveLabel, rectifyAffordance, rectifyButtonState, toolbarMoveLabel } from "./porterRectify";

const PE = "Project Expenses";
const NPE = "Non Project Expenses";

const transfer: BankPlanLine = {
    row: "OFR-1",
    txn_id: "TESTUTR0001",
    refusal: null,
    amount: 4250,
    ledger: NPE,
    project: null,
    project_name: null,
    expense: "NPE-1",
    date: "2026-10-14",
    utr: "TESTUTR0001",
    beneficiary: "Testvendor Hardware Stores",
    remark: "site cement Testorchid",
    expense_type: "Material Purchases",
};

describe("the bank or Cashfree line's details (spec #1753 story 44)", () => {
    it("shows its date, UTR, beneficiary, amount and remark", () => {
        expect(bankDetailRows(transfer)).toEqual([
            { label: "Date", value: "14-Oct-2026" },
            { label: "UTR", value: "TESTUTR0001" },
            { label: "Beneficiary", value: "Testvendor Hardware Stores" },
            { label: "Amount", value: "₹4,250" },
            { label: "Remark", value: "site cement Testorchid" },
        ]);
    });

    it("shows a dash for what the statement left blank", () => {
        expect(bankDetailRows({ ...transfer, date: null, beneficiary: "", remark: "  " })).toEqual([
            { label: "Date", value: "--" },
            { label: "UTR", value: "TESTUTR0001" },
            { label: "Beneficiary", value: "--" },
            { label: "Amount", value: "₹4,250" },
            { label: "Remark", value: "--" },
        ]);
    });
});

describe("Move on a bank or Cashfree line in Bulk Import (story 5)", () => {
    const line = (name: string, source: string, created: 0 | 1, ledger = NPE) => ({
        name,
        row_status: "Settled",
        source,
        suggested_doctype: ledger,
        matches: [{ target_doctype: ledger, created_by_import: created }],
    });

    it("is offered where the line's expense was created with Create, to the undo roles only", () => {
        expect(rectifyAffordance(line("a", "ICICI Bank Statement", 1), true)).toBe(true);
        expect(rectifyAffordance(line("a", "Cashfree", 1), true)).toBe(true);
        expect(rectifyAffordance(line("a", "Cashfree", 1), false)).toBe(false);
    });

    it("is not offered where the line was Linked to a record that already existed", () => {
        expect(rectifyAffordance(line("a", "Cashfree", 0), true)).toBe(false);
        expect(rectifyAffordance({ row_status: "Settled", source: "Cashfree" }, true)).toBe(false);
    });

    it("labels the button by where the expense is", () => {
        expect(lineMoveLabel(line("a", "Cashfree", 1))).toBe("Move to a project");
        expect(lineMoveLabel(line("a", "ICICI Bank Statement", 1, PE))).toBe("Change project");
    });

    it("moves ticked lines of one statement together, and is off with another statement's line", () => {
        const page = [
            line("a", "Cashfree", 1),
            line("b", "Cashfree", 1, PE),
            line("c", "ICICI Bank Statement", 1),
            line("d", "Cashfree", 0),
        ];
        expect(rectifyButtonState(page, new Set(["a", "b"]), new Map(), 1)).toEqual({
            visible: true,
            enabled: true,
            count: 2,
            note: null,
        });
        expect(toolbarMoveLabel(page, new Set(["a", "b"]))).toBe("Move 2 expenses");
        expect(rectifyButtonState(page, new Set(["a", "c"]), new Map(), 1).note).toBe(
            "Moving works on Cashfree lines only: untick the 1 other line.",
        );
        expect(rectifyButtonState(page, new Set(["a", "d"]), new Map(), 1).enabled).toBe(false);
    });
});
