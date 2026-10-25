import { describe, expect, it } from "vitest";
import { lacksExpense, linkableExpenses } from "./challanExpense";

const expense = (name: string) => ({ name, amount: 1000 });

describe("lacksExpense: the warning on a challan", () => {
    it("warns while a challan has no TDS Payment expense", () => {
        expect(lacksExpense({ name: "TDC-26-00001", tds_payment_expense: null })).toBe(true);
        expect(lacksExpense({ name: "TDC-26-00001" })).toBe(true);
        expect(lacksExpense({ name: "TDC-26-00001", tds_payment_expense: "" })).toBe(true);
    });

    it("clears once one is linked", () => {
        expect(lacksExpense({ name: "TDC-26-00001", tds_payment_expense: "NPE-0042" })).toBe(false);
    });
});

describe("linkableExpenses: what the picker offers for one challan", () => {
    const expenses = [expense("NPE-1"), expense("NPE-2"), expense("NPE-3")];
    const challans = [
        { name: "TDC-A", tds_payment_expense: "NPE-1" },
        { name: "TDC-B", tds_payment_expense: null },
        { name: "TDC-C", tds_payment_expense: "NPE-3" },
    ];

    it("leaves out an expense already on another challan", () => {
        expect(linkableExpenses(expenses, challans, "TDC-B").map((e) => e.name)).toEqual(["NPE-2"]);
    });

    it("keeps the challan's own expense, so a relink to it is a no-op rather than a missing option", () => {
        expect(linkableExpenses(expenses, challans, "TDC-A").map((e) => e.name)).toEqual(["NPE-1", "NPE-2"]);
    });
});
