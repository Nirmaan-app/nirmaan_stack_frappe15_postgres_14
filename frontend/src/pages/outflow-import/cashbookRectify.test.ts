import { describe, expect, it } from "vitest";

import {
    billCheckText,
    cashbookDetailRows,
    cashbookMoveLabel,
    defaultMoveType,
    type CashbookPlanLine,
} from "./cashbookRectify";
import { lineMoveLabel, rectifyAffordance, rectifyButtonState, toolbarMoveLabel } from "./porterRectify";

const PE = "Project Expenses";
const NPE = "Non Project Expenses";

const spend: CashbookPlanLine = {
    row: "OFR-1",
    txn_id: "OBO-TEST-1",
    refusal: null,
    amount: 2380,
    ledger: NPE,
    project: null,
    project_name: null,
    expense: "NPE-1",
    date: "2026-10-05",
    kind: "Wallet Spend",
    money_in: false,
    spender: "Meera Iyer",
    counterparty: "TESTPAYEE COURIER ONE",
    remark: "Courier charges for the site",
    expense_type: "Petty Cash",
    bill: { file: "/private/files/bill.jpeg", check: "Mismatched", check_reason: "The bill says Rs 1,999." },
};

describe("the Move button and title (spec #1753 stories 37-39)", () => {
    it("reads Move to a project on a Non Project Expense", () => {
        expect(cashbookMoveLabel([NPE])).toBe("Move to a project");
        expect(cashbookMoveLabel([NPE, NPE])).toBe("Move to a project");
    });

    it("reads Change project on a Project Expense", () => {
        expect(cashbookMoveLabel([PE])).toBe("Change project");
        expect(cashbookMoveLabel([PE, PE, PE])).toBe("Change project");
    });

    it("reads Move N expenses for a mixed selection", () => {
        expect(cashbookMoveLabel([PE, NPE, NPE])).toBe("Move 3 expenses");
    });
});

describe("the wallet spend's details (story 42)", () => {
    it("shows date, spender, who was paid, amount and Remark", () => {
        expect(cashbookDetailRows(spend)).toEqual([
            { label: "Date", value: "05-Oct-2026" },
            { label: "Spent by", value: "Meera Iyer" },
            { label: "Paid to", value: "TESTPAYEE COURIER ONE" },
            { label: "Amount", value: "₹2,380" },
            { label: "Remark", value: "Courier charges for the site" },
        ]);
    });

    it("says money coming back in its own words, as a negative amount", () => {
        const refund = { ...spend, amount: -640, money_in: true, spender: "Asha Menon", counterparty: "Testshop" };
        expect(cashbookDetailRows(refund).slice(1, 4)).toEqual([
            { label: "Back to", value: "Asha Menon" },
            { label: "From", value: "Testshop" },
            { label: "Amount", value: "-₹640" },
        ]);
    });

    it("gives the Bill check verdict with its remark, or says there is no bill", () => {
        expect(billCheckText(spend.bill)).toBe("Mismatched: The bill says Rs 1,999.");
        expect(billCheckText({ file: "/f", check: "Matched", check_reason: "" })).toBe("Matched");
        expect(billCheckText(null)).toBe("No bill");
    });
});

describe("Move in Bulk Import (stories 1, 3, 7, 9)", () => {
    const cashbook = (name: string, ledger: string, row_status = "Settled") => ({
        name,
        row_status,
        source: "Cashbook",
        suggested_doctype: ledger,
    });
    const porter = (name: string) => ({ name, row_status: "Settled", source: "Porter Statement", suggested_doctype: NPE });
    const bank = (name: string) => ({ name, row_status: "Settled", source: "Cashfree", suggested_doctype: NPE });

    it("is offered on a Settled Cashbook line to the undo roles only", () => {
        expect(rectifyAffordance(cashbook("a", NPE), true)).toBe(true);
        expect(rectifyAffordance(cashbook("a", NPE), false)).toBe(false);
        expect(rectifyAffordance(cashbook("a", NPE, "Skipped"), true)).toBe(false);
    });

    it("labels the line's button by where its expense is; a Porter line keeps its wording", () => {
        expect(lineMoveLabel(cashbook("a", NPE))).toBe("Move to a project");
        expect(lineMoveLabel(cashbook("a", PE))).toBe("Change project");
        expect(lineMoveLabel(porter("p"))).toBe("Move to another project");
    });

    it("moves ticked Cashbook lines together under the label rule", () => {
        const page = [cashbook("a", NPE), cashbook("b", PE), bank("c"), porter("p")];
        expect(rectifyButtonState(page, new Set(["a", "b"]), new Map(), 1)).toEqual({
            visible: true,
            enabled: true,
            count: 2,
            note: null,
        });
        expect(toolbarMoveLabel(page, new Set(["a", "b"]))).toBe("Move 2 expenses");
        expect(toolbarMoveLabel(page, new Set(["a"]))).toBe("Move to a project");
        expect(toolbarMoveLabel(page, new Set(["p"]))).toBe("Move 1 order");
    });

    it("is off while a line of another kind is ticked with them, and says why", () => {
        const page = [cashbook("a", NPE), bank("c"), porter("p")];
        expect(rectifyButtonState(page, new Set(["a", "c"]), new Map(), 1).note).toBe(
            "Moving works on Cashbook lines only: untick the 1 other line.",
        );
        expect(rectifyButtonState(page, new Set(["a", "p"]), new Map(), 1).enabled).toBe(false);
    });
});

describe("the type offered (story 15)", () => {
    const types = { [PE]: ["Material Purchases", "Petty Cash"], [NPE]: ["Petty Cash", "Postage & Courier"] };

    it("is the lines' own type when the destination ledger takes it", () => {
        expect(defaultMoveType([spend], PE, types)).toBe("Petty Cash");
    });

    it("is blank when the destination does not take it, or the lines differ", () => {
        const courier = { ...spend, expense_type: "Postage & Courier" };
        expect(defaultMoveType([courier], PE, types)).toBe("");
        expect(defaultMoveType([spend, courier], NPE, types)).toBe("");
    });
});
