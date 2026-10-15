import { describe, expect, it } from "vitest";

import { canChangeExpenseAccount, namedByText, noAccountBoxText, paidToCell, paidToExportText, type PaidTo } from "./paidTo";

const account = {
    account_name: "Ramesh Kumar Yadav",
    account_number: "36147100982211",
    ifsc: "SBIN0003435",
    bank_name: "State Bank of India",
    bank_branch: "Bhiwandi",
};
/** A row the "account changed since" flag passed (every expense, every unchanged payment). */
const UNFLAGGED = { account_changed: false, current_account: null } as const;
const paid: PaidTo = { account, missing: null, payee_rule: null, ...UNFLAGGED };
const newAccount = {
    account_name: "Ramesh Kumar Yadav",
    account_number: "50100234567812",
    ifsc: "HDFC0000123",
    bank_name: "HDFC Bank",
    bank_branch: "Thane",
};

describe("paidToCell", () => {
    it("shows the holder name with the account number and IFSC under it", () => {
        expect(paidToCell(paid, "Labour Advance")).toEqual({
            tone: "account",
            title: "Ramesh Kumar Yadav",
            detail: "A/c 36147100982211, SBIN0003435",
        });
    });

    it("says an expense with no account needs none when its type doesn't require one", () => {
        for (const rule of ["Optional", "Not asked"] as const) {
            expect(paidToCell({ account: null, missing: "expense_has_no_account", payee_rule: rule, ...UNFLAGGED }, "Travel")).toEqual({
                tone: "no_account",
                title: "No account",
                detail: "Travel doesn't require one. Paid by card or cash.",
            });
        }
    });

    it("says when the type requires an account and the expense has none", () => {
        expect(
            paidToCell({ account: null, missing: "expense_has_no_account", payee_rule: "Required", ...UNFLAGGED }, "Labour Advance"),
        ).toEqual({
            tone: "no_account",
            title: "No account",
            detail: "Labour Advance requires one. Add it with Change account in Record Payment.",
        });
    });

    it("says a vendor payment holds no account of its own", () => {
        expect(paidToCell({ account: null, missing: "payment_has_no_account", payee_rule: null, ...UNFLAGGED }, "")).toEqual({
            tone: "payment_no_account",
            title: "No account on this payment",
            detail: "Pay it another way, or reject it and raise it again.",
        });
    });

    it("warns that a PO payment's vendor changed account since, naming the new account", () => {
        expect(paidToCell({ ...paid, account_changed: true, current_account: newAccount }, "")).toEqual({
            tone: "account_changed",
            title: "Vendor's account changed since this was raised",
            detail: "Now Ramesh Kumar Yadav, A/c 50100234567812, HDFC0000123. Reject it and raise it again.",
        });
    });

    it("warns when the PO payment's vendor has no account any more", () => {
        expect(paidToCell({ ...paid, account_changed: true, current_account: null }, "")).toEqual({
            tone: "account_changed",
            title: "Vendor's account changed since this was raised",
            detail: "The vendor has no account now. Reject it and raise it again.",
        });
    });

    it("reads a row the server sent without paid_to as having no account", () => {
        expect(paidToCell(undefined, "").title).toBe("No account");
    });
});

describe("paidToExportText", () => {
    it("writes the account on one line, or why there is none", () => {
        expect(paidToExportText(paid, "Labour Advance")).toBe("Ramesh Kumar Yadav, A/c 36147100982211, SBIN0003435");
        expect(paidToExportText({ account: null, missing: "payment_has_no_account", payee_rule: null, ...UNFLAGGED }, "")).toBe(
            "No account on this payment",
        );
        expect(paidToExportText({ ...paid, account_changed: true, current_account: null }, "")).toBe(
            "Vendor's account changed since this was raised: The vendor has no account now. Reject it and raise it again.",
        );
    });
});

describe("noAccountBoxText", () => {
    it("tells the accountant whether the expense's type needs an account before paying", () => {
        expect(noAccountBoxText("Required", "Labour Advance")).toBe(
            "Labour Advance requires an account. Use Change account to set one before paying.",
        );
        expect(noAccountBoxText("Not asked", "Travel")).toBe(
            "Travel doesn't require one. Pay by card or cash, or use Change account to set one.",
        );
    });
});

describe("namedByText", () => {
    it("names the raiser and the day the request set the account", () => {
        expect(namedByText({ how: "request", user: "priya@nirmaan.app", full_name: "Priya S.", on: "2026-10-13" }, null))
            .toMatch(/^Priya S\. on the request, 13-.+-2026$/);
    });

    it("names the accountant who changed it", () => {
        expect(namedByText({ how: "changed", user: "a@nirmaan.app", full_name: "Anil K.", on: "2026-10-14" }, null))
            .toMatch(/^Changed by Anil K\., 14-.+-2026$/);
    });

    it("says the account was copied from the vendor's", () => {
        expect(namedByText({ how: "vendor", user: null, full_name: null, on: null }, "Kaveri Ductfab")).toBe(
            "Copied from Kaveri Ductfab's account",
        );
    });

    it("says when nothing records who set it", () => {
        expect(namedByText(null, null)).toBe("Not recorded");
    });
});

describe("canChangeExpenseAccount", () => {
    const unpaid = { paid: false, vendor_fixed: false };

    it("lets Accounts change an approved, unpaid expense with no vendor", () => {
        expect(canChangeExpenseAccount("Non Project Expenses", unpaid, true)).toBe(true);
        expect(canChangeExpenseAccount("Project Expenses", unpaid, true)).toBe(true);
    });

    it("keeps the account read-only once paid, with a vendor named, outside Accounts, and on a PO payment", () => {
        expect(canChangeExpenseAccount("Project Expenses", { ...unpaid, paid: true }, true)).toBe(false);
        expect(canChangeExpenseAccount("Project Expenses", { ...unpaid, vendor_fixed: true }, true)).toBe(false);
        expect(canChangeExpenseAccount("Project Expenses", unpaid, false)).toBe(false);
        expect(canChangeExpenseAccount("Project Payments", unpaid, true)).toBe(false);
    });
});
