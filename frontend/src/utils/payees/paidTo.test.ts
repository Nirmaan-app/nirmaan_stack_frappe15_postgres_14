import { describe, expect, it } from "vitest";

import {
    canChangeExpenseAccount,
    namedByText,
    noAccountBoxText,
    paidToCell,
    paidToExportText,
    payToBoxView,
    type PaidTo,
} from "./paidTo";

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

    it("says an expense of a Not asked type has no account because its type doesn't ask", () => {
        expect(paidToCell({ account: null, missing: "expense_has_no_account", payee_rule: "Not asked", ...UNFLAGGED }, "Travel")).toEqual({
            tone: "no_account",
            title: "No account",
            detail: "Not asked for this expense type.",
        });
    });

    it("says an expense of an Optional type was raised without one", () => {
        expect(paidToCell({ account: null, missing: "expense_has_no_account", payee_rule: "Optional", ...UNFLAGGED }, "Travel")).toEqual({
            tone: "no_account",
            title: "No account",
            detail: "No account given; optional for Travel.",
        });
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
        expect(noAccountBoxText("Optional", "Travel")).toBe(
            "No account given; optional for Travel. Pay by card or cash, or use Change account to set one.",
        );
        expect(noAccountBoxText("Not asked", "Travel")).toBe(
            "Not asked for this expense type. Pay by card or cash, or use Change account to set one.",
        );
    });
});

describe("payToBoxView", () => {
    const facts = { ...paid, vendor_fixed: false, vendor_name: "Kaveri Ductfab" };
    const none = { ...facts, account: null };

    it("turns red with no small print when a PO payment's vendor changed account since", () => {
        expect(payToBoxView("Project Payments", { ...facts, account_changed: true, current_account: newAccount }, "")).toEqual({
            tone: "account_changed",
            noAccount: null,
            note: null,
        });
    });

    it("says a PO payment's account was copied from its vendor and is never changed", () => {
        expect(payToBoxView("Project Payments", facts, "")).toEqual({
            tone: "account",
            noAccount: null,
            note:
                "Copied from Kaveri Ductfab's account when this payment was raised. A payment's account is never " +
                "changed: if it is wrong, reject the payment and raise it again.",
        });
    });

    it("says an expense naming a vendor is paid into the vendor's account", () => {
        expect(payToBoxView("Project Expenses", { ...facts, vendor_fixed: true }, "").note).toBe(
            "Copied from Kaveri Ductfab's account. To pay someone else, the expense's vendor has to change.",
        );
        expect(payToBoxView("Non Project Expenses", facts, "")).toEqual({ tone: "account", noAccount: null, note: null });
    });

    it("says why a PO payment has no account", () => {
        expect(payToBoxView("Project Payments", { ...none, missing: "payment_has_no_account" }, "")).toEqual({
            tone: "no_account",
            noAccount: {
                title: "No account on this payment.",
                detail: "Pay it another way, or reject it and raise it again once Kaveri Ductfab has a bank account.",
            },
            note: null,
        });
    });

    it("says an expense naming a vendor had no vendor account when it was raised", () => {
        expect(payToBoxView("Project Expenses", { ...none, missing: "expense_has_no_account", vendor_fixed: true }, "").noAccount)
            .toEqual({ title: "No account.", detail: "Kaveri Ductfab had no bank account on record when this was raised." });
    });

    it("says an expense with no vendor and no account why, by its type's rule", () => {
        expect(
            payToBoxView("Non Project Expenses", { ...none, missing: "expense_has_no_account", payee_rule: "Not asked" }, "Travel"),
        ).toEqual({
            tone: "no_account",
            noAccount: { title: "No account.", detail: noAccountBoxText("Not asked", "Travel") },
            note: null,
        });
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
