import { describe, expect, it } from "vitest";

import { namedByText, noPayeeBoxText, paidToCell, paidToExportText, type PaidTo } from "./paidTo";

const account = {
    payee: "PYE-0690",
    account_name: "Ramesh Kumar Yadav",
    account_number: "36147100982211",
    ifsc: "SBIN0003435",
    bank_name: "State Bank of India",
    bank_branch: "Bhiwandi",
};
const paid: PaidTo = { account, missing: null, payee_rule: null };

describe("paidToCell", () => {
    it("shows the holder name with the account number and IFSC under it", () => {
        expect(paidToCell(paid, "Labour Advance")).toEqual({
            tone: "account",
            title: "Ramesh Kumar Yadav",
            detail: "A/c 36147100982211, SBIN0003435",
        });
    });

    it("says an expense with no payee needs none when its type doesn't require one", () => {
        for (const rule of ["Optional", "Not asked"] as const) {
            expect(paidToCell({ account: null, missing: "expense_has_no_payee", payee_rule: rule }, "Travel")).toEqual({
                tone: "no_payee",
                title: "No payee",
                detail: "Travel doesn't require one. Paid by card or cash.",
            });
        }
    });

    it("says when the type requires a payee and the expense has none", () => {
        expect(
            paidToCell({ account: null, missing: "expense_has_no_payee", payee_rule: "Required" }, "Labour Advance"),
        ).toEqual({
            tone: "no_payee",
            title: "No payee",
            detail: "Labour Advance requires one. Add it with Change payee in Record Payment.",
        });
    });

    it("says a vendor payment's vendor has no bank account", () => {
        expect(paidToCell({ account: null, missing: "vendor_has_no_payee", payee_rule: null }, "")).toEqual({
            tone: "vendor_no_payee",
            title: "Vendor has no bank account",
            detail: "Add one on the vendor page before paying.",
        });
    });

    it("reads a row the server sent without paid_to as having no account", () => {
        expect(paidToCell(undefined, "").title).toBe("No payee");
    });
});

describe("paidToExportText", () => {
    it("writes the account on one line, or why there is none", () => {
        expect(paidToExportText(paid, "Labour Advance")).toBe("Ramesh Kumar Yadav, A/c 36147100982211, SBIN0003435");
        expect(paidToExportText({ account: null, missing: "vendor_has_no_payee", payee_rule: null }, "")).toBe(
            "Vendor has no bank account",
        );
    });
});

describe("noPayeeBoxText", () => {
    it("tells the accountant whether the expense's type needs a payee before paying", () => {
        expect(noPayeeBoxText("Required", "Labour Advance")).toBe(
            "Labour Advance requires a payee. Use Change payee to name one before paying.",
        );
        expect(noPayeeBoxText("Not asked", "Travel")).toBe(
            "Travel doesn't require one. Pay by card or cash, or use Change payee to name one.",
        );
    });
});

describe("namedByText", () => {
    it("names the raiser and the day the request named the payee", () => {
        expect(namedByText({ how: "request", user: "priya@nirmaan.app", full_name: "Priya S.", on: "2026-10-13" }, null))
            .toMatch(/^Priya S\. on the request, 13-.+-2026$/);
    });

    it("names the accountant who changed it", () => {
        expect(namedByText({ how: "changed", user: "a@nirmaan.app", full_name: "Anil K.", on: "2026-10-14" }, null))
            .toMatch(/^Changed by Anil K\., 14-.+-2026$/);
    });

    it("says a vendor-linked expense is paid into the vendor's account", () => {
        expect(namedByText({ how: "vendor", user: null, full_name: null, on: null }, "Kaveri Ductfab")).toBe(
            "Kaveri Ductfab's account (the expense's vendor)",
        );
    });

    it("says when nothing records who named it", () => {
        expect(namedByText(null, null)).toBe("Not recorded");
    });
});
