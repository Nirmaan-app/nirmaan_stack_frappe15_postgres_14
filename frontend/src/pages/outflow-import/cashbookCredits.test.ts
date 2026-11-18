// The Wallet Credits on the Cashbook import's Review (#1720, ADR-0015 Amendment E): their own group, each with where
// it goes. Pure functions; the screen renders these strings.
import { describe, expect, it } from "vitest";

import { creditLabel, creditsHeading } from "./cashbookCredits";
import type { CashbookCreditLine } from "./cashbookPreview";

const credit = (over: Partial<CashbookCreditLine> = {}): CashbookCreditLine => ({
    row_number: 20,
    transfer_id: "PTM9000000006",
    amount: 9000,
    remarks: "site scrap amount",
    reason: "",
    row_kind: "Wallet Credit",
    ledger: "Non Project Expenses",
    project_name: "",
    expense_type: "Petty Cash",
    ...over,
});

describe("the Wallet Credits on Review (#1720)", () => {
    it("heads them, saying each is booked as a minus expense", () => {
        expect(creditsHeading([credit()])).toBe(
            "1 wallet credit (money paid in from outside) will be booked as a minus expense"
        );
        expect(creditsHeading([credit(), credit()])).toBe(
            "2 wallet credits (money paid in from outside) will be booked as minus expenses"
        );
        expect(creditsHeading([])).toBeNull();
        expect(creditsHeading(undefined)).toBeNull();
    });

    it("names each credit, its remark and where it goes", () => {
        expect(creditLabel(credit())).toBe(
            "Wallet Credit PTM9000000006 · site scrap amount · Non Project Expenses · Petty Cash"
        );
        expect(
            creditLabel(credit({ remarks: "", ledger: "Project Expenses", project_name: "Telus GIFT City" }))
        ).toBe("Wallet Credit PTM9000000006 · Project Expenses · Telus GIFT City · Petty Cash");
    });
});
