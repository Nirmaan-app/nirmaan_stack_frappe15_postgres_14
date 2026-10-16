import { describe, expect, it } from "vitest";

import {
    canChangeExpenseAccount,
    canRemoveExpenseAccount,
    changeAccountRuleLine,
    describeSkipped,
    editDialogPayTo,
    expenseTitle,
    expenseTypeAside,
    leaveOutSkipped,
    namedByText,
    paidToCell,
    paidToExportText,
    payToBoxView,
    rowEligibility,
    switchLine,
    unpayableReason,
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
const NO_SWITCH = { switch_to: null, by_cheque: false, vendor_has_no_account: false } as const;
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
            detail: "Not asked for this expense type. Paid by card or cash: kept out of the bank file.",
        });
    });

    it("says an expense of an Optional type was raised without one", () => {
        expect(paidToCell({ account: null, missing: "expense_has_no_account", payee_rule: "Optional", ...NO_SWITCH }, "Travel", "Approved")).toEqual({
            tone: "no_account",
            title: "No account",
            detail: "No account given; optional for Travel. Paid by card or cash: kept out of the bank file.",
        });
    });

    it("says when the type requires an account and the expense has none", () => {
        expect(
            paidToCell({ account: null, missing: "expense_has_no_account", payee_rule: "Required", ...NO_SWITCH }, "Labour Advance", "Approved"),
        ).toEqual({
            tone: "no_account",
            title: "No account",
            detail: "Labour Advance requires an account. Add it with the Edit pencil.",
        });
    });

    it("says a vendor payment has no account, and neither has its vendor", () => {
        expect(paidToCell({ account: null, missing: "payment_has_no_account", payee_rule: null, ...NO_SWITCH }, "", "Approved")).toEqual({
            tone: "payment_no_account",
            title: "No account on this payment",
            detail: "Vendor has no bank account. Add it on the vendor page.",
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
        expect(paidToCell({ account: null, missing: null, payee_rule: null, ...NO_SWITCH, switch_to: newAccount }, "", "Approved")).toEqual({
            tone: "vendor_account",
            title: "Will be paid into the vendor's current account",
            detail: "Ramesh Kumar Yadav, A/c 50100234567812, HDFC0000123. It was raised with no account.",
        });
    });

    it("reads a row the server sent without paid_to as having no account", () => {
        expect(paidToCell(undefined, "", "Approved").title).toBe("No account");
    });

    it("says an unpaid cheque payment is paid by cheque, outside the bank file, with or without an account", () => {
        const cheque = { tone: "cheque", title: "Paid by cheque", detail: "Kept out of the bank file." };
        expect(paidToCell({ ...paid, by_cheque: true }, "", "Approved")).toEqual(cheque);
        expect(paidToCell({ account: null, missing: "payment_has_no_account", payee_rule: null, ...NO_SWITCH, by_cheque: true }, "", "Approved"))
            .toEqual(cheque);
        expect(paidToCell({ ...paid, by_cheque: true }, "", "Reconciliation Pending").title).toBe("Ramesh Kumar Yadav");
    });
});

describe("rowEligibility: which rows of Payment need to paid can be paid, and how (#1464, ADR-0033 decision 10)", () => {
    const expenseWithNone = (rule: string | null): PaidTo =>
        ({ account: null, missing: "expense_has_no_account", payee_rule: rule, ...NO_SWITCH });
    const paymentWithNone: PaidTo = { account: null, missing: "payment_has_no_account", payee_rule: null, ...NO_SWITCH };

    it("pays a row into its own account, or a PO / WO payment into its vendor's current one", () => {
        expect(rowEligibility(paid, "")).toEqual({ kind: "payable" });
        expect(rowEligibility({ ...paid, payee_rule: "Required" }, "Rent Expenses")).toEqual({ kind: "payable" });
        expect(rowEligibility({ ...paymentWithNone, missing: null, switch_to: newAccount }, "")).toEqual({ kind: "payable" });
    });

    it("makes a PO / WO payment with no account whose vendor has none either Ineligible", () => {
        expect(rowEligibility(paymentWithNone, "")).toEqual({
            kind: "ineligible",
            reason: "vendor_has_no_account",
            text: "Vendor has no bank account. Add it on the vendor page.",
        });
    });

    it("makes an expense of a Required type with no account Ineligible, pointing to the Edit pencil", () => {
        expect(rowEligibility(expenseWithNone("Required"), "Rent Expenses")).toEqual({
            kind: "ineligible",
            reason: "required_type_has_no_account",
            text: "Rent Expenses requires an account. Add it with the Edit pencil.",
        });
        expect(rowEligibility(expenseWithNone("Required"), "")).toMatchObject({
            text: "Its type requires an account. Add it with the Edit pencil.",
        });
    });

    it("keeps an Optional or Not asked expense with no account out of the bank file: paid by card or cash", () => {
        const cardOrCash = { kind: "kept_out", reason: "card_or_cash", text: "Paid by card or cash: kept out of the bank file." };
        expect(rowEligibility(expenseWithNone("Optional"), "Travel")).toEqual(cardOrCash);
        expect(rowEligibility(expenseWithNone("Not asked"), "Travel")).toEqual(cardOrCash);
        expect(rowEligibility(expenseWithNone(null), "Travel")).toEqual(cardOrCash);
    });

    it("keeps any row a cheque pays out of the bank file, whatever its account: a payment or an expense", () => {
        const cheque = { kind: "kept_out", reason: "cheque", text: "Paid by cheque: kept out of the bank file." };
        expect(rowEligibility({ ...paid, by_cheque: true }, "")).toEqual(cheque);
        expect(rowEligibility({ ...paymentWithNone, by_cheque: true }, "")).toEqual(cheque);
        // An expense on a cheque: the cheque pays it, so it is not Ineligible even with no account.
        expect(rowEligibility({ ...expenseWithNone("Required"), by_cheque: true }, "Rent Expenses")).toEqual(cheque);
    });
});

describe("unpayableReason: why Mark as Paid leaves a row out (#1464)", () => {
    const paymentWithNone: PaidTo = { account: null, missing: "payment_has_no_account", payee_rule: null, ...NO_SWITCH };
    const requiredWithNone: PaidTo = { account: null, missing: "expense_has_no_account", payee_rule: "Required", ...NO_SWITCH };
    const optionalWithNone: PaidTo = { ...requiredWithNone, payee_rule: "Optional" };

    it("says nothing for a row that can be paid, kept out of the bank file or not", () => {
        expect(unpayableReason(paid, "", false)).toBeNull();
        expect(unpayableReason({ ...paid, by_cheque: true }, "", false)).toBeNull();
        expect(unpayableReason(optionalWithNone, "Travel", false)).toBeNull();
    });

    it("gives an Ineligible row's reason", () => {
        expect(unpayableReason(paymentWithNone, "", false)).toBe("Vendor has no bank account. Add it on the vendor page.");
        expect(unpayableReason(requiredWithNone, "Rent Expenses", false)).toBe(
            "Rent Expenses requires an account. Add it with the Edit pencil.",
        );
    });

    it("says a held payment is on hold, even one kept out of the bank file", () => {
        expect(unpayableReason(paid, "", true)).toBe("It is on hold.");
        expect(unpayableReason({ ...paid, by_cheque: true }, "", true)).toBe("It is on hold.");
    });
});

describe("leaveOutSkipped: rows take_vendor_accounts found no longer Approved (#1463)", () => {
    const payment = (name: string) => ({ doctype: "Project Payments", name, against_primary: name });
    const isVendorPayment = (row: { doctype: string }) => row.doctype === "Project Payments";

    it("leaves out each skipped PO / WO payment with the status the server found, and keeps the rest in order", () => {
        const rows = [payment("PAY-1"), { doctype: "Project Expenses", name: "PAY-2", against_primary: "Travel" }, payment("PAY-3")];

        const { kept, skipped } = leaveOutSkipped(rows, [
            { name: "PAY-1", status: "Reconciliation Pending" },
            { name: "PAY-2", status: "Paid" },
        ], isVendorPayment);

        expect(kept.map((r) => r.name)).toEqual(["PAY-2", "PAY-3"]);
        expect(skipped).toEqual([{ row: rows[0], status: "Reconciliation Pending" }]);
        expect(describeSkipped(skipped, (row) => row.against_primary))
            .toBe("Left out, no longer Approved: PAY-1 (Reconciliation Pending)");
    });

    it("keeps every row when nothing was skipped", () => {
        const rows = [payment("PAY-1")];
        expect(leaveOutSkipped(rows, [], isVendorPayment)).toEqual({ kept: rows, skipped: [] });
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
        expect(noAccount("Not asked")).toBe("No account: Not asked for this expense type. Paid by card or cash: kept out of the bank file.");
        expect(noAccount("Optional")).toBe("No account: No account given; optional for Travel. Paid by card or cash: kept out of the bank file.");
        expect(noAccount("Required")).toBe("No account: Travel requires an account. Add it with the Edit pencil.");
        expect(paidToExportText({ ...paid, by_cheque: true }, "", "Approved")).toBe("Paid by cheque: Kept out of the bank file.");
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
    const RAISER = "raiser@nirmaan.app";
    const OTHER = "someone.else@nirmaan.app";
    /** A Direct Expense RAISER recorded: no Expense Request behind it. */
    const direct = (status: string) => ({ status, owner: RAISER, request_id: null });
    /** An expense an Expense Request's approval created: its raiser changes the account on the request. */
    const fromRequest = (status: string) => ({ status, owner: RAISER, request_id: "EXR-0042" });
    const accounts = { user: "accountant@nirmaan.app", isAccounts: true };
    const raiser = { user: RAISER, isAccounts: false };
    const other = { user: OTHER, isAccounts: false };

    it("offers Accounts Change account's picker on an approved expense with no vendor", () => {
        expect(editDialogPayTo(direct("Approved"), accounts, false)).toBe("change");
        expect(editDialogPayTo(fromRequest("Approved"), accounts, false)).toBe("change");
    });

    it("shows the vendor's account read-only while a vendor is named", () => {
        expect(editDialogPayTo(direct("Approved"), accounts, true)).toBe("vendor");
    });

    it("lets the raiser of a Direct Expense change its account while it is Requested", () => {
        expect(editDialogPayTo(direct("Requested"), raiser, false)).toBe("change");
        expect(editDialogPayTo(direct(" Requested "), raiser, false)).toBe("change");
    });

    it("shows the raiser the vendor's account read-only while a vendor is named", () => {
        expect(editDialogPayTo(direct("Requested"), raiser, true)).toBe("vendor");
    });

    it("gives the raiser nothing once the expense is past Requested", () => {
        for (const status of ["CEO Pending", "Approved", "Reconciliation Pending", "Paid", "Rejected"]) {
            expect(editDialogPayTo(direct(status), raiser, false)).toBe("none");
        }
    });

    it("gives someone who did not raise it nothing while it is Requested", () => {
        expect(editDialogPayTo(direct("Requested"), other, false)).toBe("none");
        expect(editDialogPayTo(direct("Requested"), { user: null, isAccounts: false }, false)).toBe("none");
        expect(editDialogPayTo({ status: "Requested", owner: null, request_id: null }, { user: null, isAccounts: false }, false)).toBe("none");
    });

    it("gives an expense from an Expense Request nothing while it is Requested, even to its raiser", () => {
        expect(editDialogPayTo(fromRequest("Requested"), raiser, false)).toBe("none");
    });

    it("gives Accounts nothing before approval on an expense they did not raise, once paid, or to anyone outside Accounts", () => {
        for (const status of ["Requested", "CEO Pending", "Reconciliation Pending", "Paid", "Rejected"]) {
            expect(editDialogPayTo(direct(status), accounts, false)).toBe("none");
        }
        expect(editDialogPayTo(direct("Approved"), other, false)).toBe("none");
        expect(editDialogPayTo(direct("Approved"), other, true)).toBe("none");
    });

    it("lets Accounts who raised a Direct Expense change it while it is Requested, as any raiser can", () => {
        expect(editDialogPayTo({ status: "Requested", owner: accounts.user, request_id: "" }, accounts, false)).toBe("change");
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

describe("a PO / WO payment whose vendor has no account now is paid to the account it was raised with", () => {
    const LINE = "The vendor has no bank account on record now. Paid to the account it was raised with.";
    const lost = { ...paid, vendor_has_no_account: true };

    it("says so in the Paid to cell and its CSV", () => {
        expect(paidToCell(lost, "", "Approved")).toEqual({
            tone: "account",
            title: "Ramesh Kumar Yadav",
            detail: `A/c 36147100982211, SBIN0003435. ${LINE}`,
        });
        expect(paidToExportText(lost, "", "Approved")).toBe(`Ramesh Kumar Yadav, A/c 36147100982211, SBIN0003435. ${LINE}`);
    });

    it("says so in the Pay box, in place of the copied-from note", () => {
        const box = { ...lost, vendor_fixed: false, vendor_name: "Kaveri Ductfab", paid: false };
        expect(payToBoxView("Project Payments", box, "")).toEqual({ tone: "account", noAccount: null, note: LINE });
    });

    it("is still payable", () => {
        expect(rowEligibility(lost, "")).toEqual({ kind: "payable" });
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
        expect(paidToCell(required, "Rent", "Approved").detail).toBe("Rent requires an account. Add it with the Edit pencil.");
    });
});
