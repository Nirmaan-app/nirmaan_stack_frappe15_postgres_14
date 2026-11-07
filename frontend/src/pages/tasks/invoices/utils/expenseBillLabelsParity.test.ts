// The Bill check results and approval statuses the expense lists show and filter by (#1640), spelled in two
// languages: the Expense Bill doctype's options and `services/expense_bills/bill_list.py` (which fills and filters
// them) on one side, `expenseBillApprovalView.ts` on the other. Neither side can import the other, so this reads the
// server files as text (the `cardInvoiceAccessParity.test.ts` shape). A value on one side only would be a filter
// choice that never matches, or a cell the column cannot label -- and nothing else would fail.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BILL_APPROVAL_STATUSES, BILL_CHECK_RESULTS } from "./expenseBillApprovalView";

const serverFile = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../../../../../../nirmaan_stack/${path}`, import.meta.url)), "utf8");

const doctype = JSON.parse(serverFile("nirmaan_stack/doctype/expense_bill/expense_bill.json")) as {
    fields: { fieldname: string; options?: string }[];
};
const options = (fieldname: string): string[] =>
    (doctype.fields.find((f) => f.fieldname === fieldname)?.options ?? "").split("\n").filter(Boolean);
const autoApproved = serverFile("services/expense_bills/bill_list.py").match(/^AUTO_APPROVED = "([^"]+)"$/m)?.[1];

describe("the expense lists' Bill check labels", () => {
    it("read the server files (a moved file would compare nothing)", () => {
        expect(options("bill_check").length).toBeGreaterThan(0);
        expect(options("status").length).toBeGreaterThan(0);
        expect(autoApproved).toBeDefined();
    });

    it("are the Expense Bill's Bill check results", () => {
        expect([...BILL_CHECK_RESULTS]).toEqual(options("bill_check"));
    });

    it("are the Expense Bill's statuses, with the lists' Auto-approved first", () => {
        expect([...BILL_APPROVAL_STATUSES]).toEqual([autoApproved, ...options("status")]);
    });
});
