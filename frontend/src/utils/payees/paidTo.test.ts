import { describe, expect, it } from "vitest";

import {
    canChangeExpenseAccount,
    canRemoveExpenseAccount,
    changeAccountRuleLine,
    editDialogPayTo,
    expenseTitle,
    expenseTypeAside,
    namedByText,
    paidToCell,
    paidToExportText,
    payToBoxView,
    switchLine,
    type PaidTo,
} from "./paidTo";

const account = {
    account_name: "Ramesh Kumar Yadav",
    account_number: "36147100982211",
    ifsc: "SBIN0003435",
    bank_name: "State Bank of India",
    bank_branch: "Bhiwandi",
};
/** A row paid into its own account: every expense, every payment whose vendor kept its account. */
const NO_SWITCH = { switch_to: null } as const;
const paid: PaidTo = { account, missing: null, payee_rule: null, ...NO_SWITCH };
const newAccount = {
    account_name: "Ramesh Kumar Yadav",
    account_number: "50100234567812",
    ifsc: "HDFC0000123",
    bank_name: "HDFC Bank",
    bank_branch: "Thane",
};

describe("paidToCell", () => {
    it("shows the holder name with the account number and IFSC under it", () => {
        expect(paidToCell(paid, "Labour Advance", "Approved")).toEqual({
            tone: "account",
            title: "Ramesh Kumar Yadav",
            detail: "A/c 36147100982211, SBIN0003435",
        });
    });

    it("says an expense of a Not asked type has no account because its type doesn't ask", () => {
        expect(paidToCell({ account: null, missing: "expense_has_no_account", payee_rule: "Not asked", ...NO_SWITCH }, "Travel", "Approved")).toEqual({
            tone: "no_account",
            title: "No account",
            detail: "Not asked for this expense type.",
        });
    });

    it("says an expense of an Optional type was raised without one", () => {
        expect(paidToCell({ account: null, missing: "expense_has_no_account", payee_rule: "Optional", ...NO_SWITCH }, "Travel", "Approved")).toEqual({
            tone: "no_account",
            title: "No account",
            detail: "No account given; optional for Travel.",
        });
    });

    it("says when the type requires an account and the expense has none", () => {
        expect(
            paidToCell({ account: null, missing: "expense_has_no_account", payee_rule: "Required", ...NO_SWITCH }, "Labour Advance", "Approved"),
        ).toEqual({
            tone: "no_account",
            title: "No account",
            detail: "Labour Advance requires one. Add it with Change account in Record Payment.",
        });
    });

    it("says a vendor payment has no account, and neither has its vendor", () => {
        expect(paidToCell({ account: null, missing: "payment_has_no_account", payee_rule: null, ...NO_SWITCH }, "", "Approved")).toEqual({
            tone: "payment_no_account",
            title: "No account on this payment",
            detail: "Its vendor has no bank account either. Add one on the vendor's page.",
        });
    });

    it("says a PO payment whose vendor changed account is paid into the vendor's current one, naming the old", () => {
        expect(paidToCell({ ...paid, switch_to: newAccount }, "", "Approved")).toEqual({
            tone: "vendor_account",
            title: "Will be paid into the vendor's current account",
            detail:
                "Ramesh Kumar Yadav, A/c 50100234567812, HDFC0000123. Was Ramesh Kumar Yadav, A/c 36147100982211, SBIN0003435.",
        });
    });

    it("says a PO payment raised with no account is paid into the vendor's current one", () => {
        expect(paidToCell({ account: null, missing: null, payee_rule: null, switch_to: newAccount }, "", "Approved")).toEqual({
            tone: "vendor_account",
            title: "Will be paid into the vendor's current account",
            detail: "Ramesh Kumar Yadav, A/c 50100234567812, HDFC0000123. It was raised with no account.",
        });
    });

    it("reads a row the server sent without paid_to as having no account", () => {
        expect(paidToCell(undefined, "", "Approved").title).toBe("No account");
    });
});

describe("paidToExportText", () => {
    it("writes the account on one line, or why there is none", () => {
        expect(paidToExportText(paid, "Labour Advance", "Approved")).toBe("Ramesh Kumar Yadav, A/c 36147100982211, SBIN0003435");
        expect(paidToExportText({ account: null, missing: "payment_has_no_account", payee_rule: null, ...NO_SWITCH }, "", "Approved")).toBe(
            "No account on this payment",
        );
        expect(paidToExportText({ ...paid, switch_to: newAccount }, "", "Approved")).toBe(
            "Will be paid into the vendor's current account: Ramesh Kumar Yadav, A/c 50100234567812, HDFC0000123. " +
            "Was Ramesh Kumar Yadav, A/c 36147100982211, SBIN0003435.",
        );
    });

    it("writes why an expense has no account, as the cell says it", () => {
        const noAccount = (payee_rule: string) =>
            paidToExportText({ account: null, missing: "expense_has_no_account", payee_rule, ...NO_SWITCH }, "Travel", "Approved");
        expect(noAccount("Not asked")).toBe("No account: Not asked for this expense type.");
        expect(noAccount("Optional")).toBe("No account: No account given; optional for Travel.");
        expect(noAccount("Required")).toBe("No account: Travel requires one. Add it with Change account in Record Payment.");
    });
});

describe("payToBoxView", () => {
    const facts = { ...paid, vendor_fixed: false, vendor_name: "Kaveri Ductfab", paid: false };
    const none = { ...facts, account: null };

    it("pays a PO payment into its vendor's current account, saying the payment takes it when paid", () => {
        const note =
            "Kaveri Ductfab's current account. Exporting this payment or marking it paid records it on the payment.";
        expect(payToBoxView("Project Payments", { ...facts, switch_to: newAccount }, "")).toEqual({
            tone: "vendor_account",
            noAccount: null,
            note,
        });
        expect(payToBoxView("Project Payments", { ...none, switch_to: newAccount }, "").note).toBe(note);
    });

    it("says a PO payment's account was copied from its vendor and follows the vendor's account", () => {
        expect(payToBoxView("Project Payments", facts, "")).toEqual({
            tone: "account",
            noAccount: null,
            note:
                "Copied from Kaveri Ductfab's account when this payment was raised. It is never edited by hand: if " +
                "Kaveri Ductfab's account changes, the payment is paid into the new one.",
        });
    });

    it("gives a paid PO payment no advice to act: its account is where the money went", () => {
        expect(payToBoxView("Project Payments", { ...facts, paid: true }, "")).toEqual({
            tone: "account",
            noAccount: null,
            note: null,
        });
        expect(payToBoxView("Project Payments", { ...none, missing: "payment_has_no_account", paid: true }, "").noAccount)
            .toEqual({ title: "No account on this payment.", detail: "It was paid without one on record." });
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
                detail: "Kaveri Ductfab has no bank account either. Add one on the vendor's page, and this payment is paid into it.",
            },
            note: null,
        });
    });

    it("says an expense naming a vendor had no vendor account when it was raised", () => {
        expect(payToBoxView("Project Expenses", { ...none, missing: "expense_has_no_account", vendor_fixed: true }, "").noAccount)
            .toEqual({ title: "No account.", detail: "Kaveri Ductfab had no bank account on record when this was raised." });
    });

    it("says an expense with no vendor and no account why, by its type's rule", () => {
        const box = (payee_rule: string, type: string) =>
            payToBoxView("Non Project Expenses", { ...none, missing: "expense_has_no_account", payee_rule }, type);
        expect(box("Not asked", "Travel")).toEqual({
            tone: "no_account",
            noAccount: {
                title: "No account.",
                detail: "Not asked for this expense type. Pay by card or cash, or use Change account to set one.",
            },
            note: null,
        });
        expect(box("Optional", "Travel").noAccount?.detail).toBe(
            "No account given; optional for Travel. Pay by card or cash, or use Change account to set one.",
        );
        expect(box("Required", "Labour Advance").noAccount?.detail).toBe(
            "Labour Advance requires an account. Use Change account to set one before paying.",
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

describe("editDialogPayTo: Who gets paid in the expense Edit dialog", () => {
    it("offers Accounts Change account's picker on an approved expense with no vendor", () => {
        expect(editDialogPayTo("Approved", true, false)).toBe("change");
    });

    it("shows the vendor's account read-only while a vendor is named", () => {
        expect(editDialogPayTo("Approved", true, true)).toBe("vendor");
    });

    it("shows nothing before approval, once paid, or to anyone outside Accounts", () => {
        for (const status of ["Requested", "CEO Pending", "Reconciliation Pending", "Paid", "Rejected"]) {
            expect(editDialogPayTo(status, true, false)).toBe("none");
        }
        expect(editDialogPayTo("Approved", false, false)).toBe("none");
        expect(editDialogPayTo("Approved", false, true)).toBe("none");
    });
});

describe("Change account names the expense and words its type's rule", () => {
    it("names an expense by its description's first line, never its ID", () => {
        expect(expenseTitle("Advance for shuttering labour\nA/c 1234, SBIN0003435", "Labour Advance")).toBe(
            "Advance for shuttering labour",
        );
    });

    it("cuts a long description and falls back to the type, then to 'This expense'", () => {
        expect(expenseTitle(`${"Hotel stay for the site team at Pune ".repeat(3)}`, "Accommodation")).toBe(
            "Hotel stay for the site team at Pune Hotel stay for the site…",
        );
        expect(expenseTitle("  ", "Accommodation Deposit")).toBe("Accommodation Deposit");
        expect(expenseTitle(null, "")).toBe("This expense");
    });

    it("says a Required type always has an account, so it can be changed, not removed", () => {
        expect(changeAccountRuleLine("Required", "Accommodation Deposit", true)).toBe(
            "Accommodation Deposit requires an account: it can be changed, not removed.",
        );
        expect(changeAccountRuleLine("Required", "Accommodation Deposit", false)).toBe(
            "Accommodation Deposit requires an account.",
        );
        expect(canRemoveExpenseAccount("Required", true)).toBe(false);
    });

    it("adds the type after the title, unless the title already is the type or there is none", () => {
        expect(expenseTypeAside("Labor Accommodation Deposit", "Accommodation Deposit")).toBe(" (Accommodation Deposit)");
        expect(expenseTypeAside("Accommodation Deposit", "Accommodation Deposit")).toBe("");
        expect(expenseTypeAside("This expense", "")).toBe("");
    });

    it("words an unknown type the same way in every rule", () => {
        expect(changeAccountRuleLine("Optional", "", false)).toBe("An account is optional for its type.");
        expect(changeAccountRuleLine("Required", "", false)).toBe("Its type requires an account.");
        expect(changeAccountRuleLine("Not asked", "", false)).toBe("Its type doesn't ask for an account.");
    });

    it("offers removing the account of an Optional or Not asked type that has one", () => {
        expect(changeAccountRuleLine("Optional", "Travel", true)).toBe(
            "An account is optional for Travel. Remove it if this is paid by card or cash.",
        );
        expect(changeAccountRuleLine("Not asked", "Travel", true)).toBe(
            "Travel doesn't ask for an account. Remove it if this is paid by card or cash.",
        );
        expect(changeAccountRuleLine("Optional", "Travel", false)).toBe("An account is optional for Travel.");
        expect(canRemoveExpenseAccount("Optional", true)).toBe(true);
        expect(canRemoveExpenseAccount(null, true)).toBe(true);
        expect(canRemoveExpenseAccount("Optional", false)).toBe(false);
    });
});

describe("switchLine (Mark as Paid's confirmation)", () => {
    it("names the account a switching payment will now go to, and the old one", () => {
        expect(switchLine({ ...paid, switch_to: newAccount })).toBe(
            "Will be paid into the vendor's current account: Ramesh Kumar Yadav, A/c 50100234567812, HDFC0000123. " +
            "Was Ramesh Kumar Yadav, A/c 36147100982211, SBIN0003435.",
        );
    });

    it("says nothing for a row paid into its own account", () => {
        expect(switchLine(paid)).toBeNull();
        expect(switchLine(undefined)).toBeNull();
    });
});

describe("Paid to on a paid row (Reconciliation Pending, Paid)", () => {
    // The server never switches a paid row (`paid_to._may_switch`): it shows the account its money went into.
    it("never tells the payer to act on a paid row with no account", () => {
        const required: PaidTo = { account: null, missing: "expense_has_no_account", payee_rule: "Required", ...NO_SWITCH };
        const payment: PaidTo = { account: null, missing: "payment_has_no_account", payee_rule: null, ...NO_SWITCH };

        expect(paidToCell(required, "Rent", "Paid")).toEqual({ tone: "no_account", title: "No account", detail: "Rent requires one." });
        expect(paidToCell(payment, "", "Reconciliation Pending")).toEqual({
            tone: "payment_no_account",
            title: "No account on this payment",
            detail: "It was paid without one on record.",
        });
        expect(paidToCell(required, "Rent", "Approved").detail).toBe("Rent requires one. Add it with Change account in Record Payment.");
    });
});
