import { describe, expect, it } from "vitest";

import { cardDetailRows, type CardPlanLine } from "./cardRectify";
import { CARD_SOURCE } from "./creditCardImport";
import { lineMoveLabel, rectifyAffordance, rectifyButtonState, toolbarMoveLabel } from "./porterRectify";

const PE = "Project Expenses";
const NPE = "Non Project Expenses";

const spend: CardPlanLine = {
    row: "OFR-9",
    txn_id: "14225842682",
    refusal: null,
    amount: 1933,
    ledger: NPE,
    project: null,
    project_name: null,
    expense: "NPE-9",
    date: "2026-09-23",
    holder: "TEST HOLDER ONE",
    merchant: "PARK RESIDENCY",
    details: "PARK RESIDENCY Cochin IN",
    statement: "CCS-TEST-0001",
    statement_months: ["2026-09", "2026-10"],
    expense_type: "Misc. Expenses",
};

const card = (name: string, ledger: string, status = "Settled") => ({
    name,
    row_status: status,
    source: CARD_SOURCE,
    suggested_doctype: ledger,
});
const bank = (name: string) => ({ name, row_status: "Settled", source: "ICICI Bank Statement", suggested_doctype: NPE });

describe("the card spend's details (spec #1753 story 43)", () => {
    it("shows the card holder, merchant, statement, amount and date", () => {
        expect(cardDetailRows(spend)).toEqual([
            { label: "Date", value: "23-Sep-2026" },
            { label: "Card holder", value: "TEST HOLDER ONE" },
            { label: "Merchant", value: "PARK RESIDENCY" },
            { label: "Statement", value: "Sep – Oct 2026 · CCS-TEST-0001" },
            { label: "Amount", value: "₹1,933" },
        ]);
    });

    it("shows a dash for what the plan does not know", () => {
        const rows = cardDetailRows({ ...spend, holder: "", merchant: "", date: null });
        expect(rows.find((row) => row.label === "Card holder")?.value).toBe("--");
        expect(rows.find((row) => row.label === "Merchant")?.value).toBe("--");
        expect(rows.find((row) => row.label === "Date")?.value).toBe("--");
    });
});

describe("Move on a card line in Bulk Import (story 4)", () => {
    it("is offered on a Settled card line to the undo roles only", () => {
        expect(rectifyAffordance(card("a", NPE), true)).toBe(true);
        expect(rectifyAffordance(card("a", NPE), false)).toBe(false);
        expect(rectifyAffordance(card("a", NPE, "Skipped"), true)).toBe(false);
    });

    it("labels the button by where its expense is", () => {
        expect(lineMoveLabel(card("a", NPE))).toBe("Move to a project");
        expect(lineMoveLabel(card("a", PE))).toBe("Change project");
    });

    it("moves ticked card lines together, and is off while a line of another kind is ticked", () => {
        const page = [card("a", NPE), card("b", NPE), bank("c")];
        expect(rectifyButtonState(page, new Set(["a", "b"]), new Map(), 1)).toEqual({
            visible: true,
            enabled: true,
            count: 2,
            note: null,
        });
        expect(toolbarMoveLabel(page, new Set(["a", "b"]))).toBe("Move to a project");
        expect(rectifyButtonState(page, new Set(["a", "c"]), new Map(), 1).note).toBe(
            "Moving works on card lines only: untick the 1 other line.",
        );
    });
});
