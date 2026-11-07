// src/pages/outflow-import/cashbookCollect.test.ts

import { describe, expect, it } from "vitest";

import type { BillCheck } from "@/types/NirmaanStack/ExpenseBill";

import { CollectPaymentLine, collectBillOutcome, collectPaymentsHeading, collectPaymentsOf } from "./cashbookCollect";

const line = (transfer_id: string, amount: number): CollectPaymentLine => ({
    row_number: 1,
    transfer_id,
    amount,
    remarks: "Collect request approved",
    beneficiary_name: "Testshop",
    spent_by: "Asha Menon",
    reason: "Shop-requested payment, check it.",
});

describe("collectPaymentsHeading (#1595)", () => {
    it("says nothing when the statement has no Collect payment", () => {
        expect(collectPaymentsHeading([])).toBeNull();
    });

    it("names one Collect payment and what happens to it", () => {
        expect(collectPaymentsHeading([line("A", 480)])).toBe(
            "1 shop-requested payment to check. It is not recorded: it stays open on the main table for Create expense or Skip by hand."
        );
    });

    it("counts several", () => {
        expect(collectPaymentsHeading([line("A", 480), line("B", 199)])).toBe(
            "2 shop-requested payments to check. They are not recorded: they stay open on the main table for Create expense or Skip by hand."
        );
    });
});

describe("collectPaymentsOf", () => {
    it("reads the preview's Collect payments, or none from a server that predates them", () => {
        expect(collectPaymentsOf({})).toEqual([]);
        expect(collectPaymentsOf({ collect_payments: [line("A", 480)] })).toEqual([line("A", 480)]);
    });
});

describe("collectBillOutcome (#1642)", () => {
    const row = (stored_bill: string | null, bill_check: BillCheck | null) => ({
        source: "Cashbook",
        row_kind: "Collect Payment",
        row_status: "Mismatched",
        stored_bill,
        bill_check,
    });

    it("says nothing for a Collect payment with no stored bill", () => {
        expect(collectBillOutcome(row(null, null))).toBeNull();
    });

    it("says nothing for a line that is not a Collect payment", () => {
        expect(collectBillOutcome({ ...row("/private/files/b.jpeg", "Matched"), row_kind: "Wallet Spend" })).toBeNull();
    });

    it("a Matched bill will be auto-approved", () => {
        expect(collectBillOutcome(row("/private/files/b.jpeg", "Matched"))).toEqual({
            heading: "Invoice already available",
            outcome: "Will be auto-approved",
            fileUrl: "/private/files/b.jpeg",
        });
    });

    it.each<BillCheck>(["Mismatched", "Not read", "Not checked"])("a %s bill will go to Pending Approval", (check) => {
        expect(collectBillOutcome(row("/private/files/b.jpeg", check))?.outcome).toBe("Will go to Pending Approval");
    });

    it("a bill still being read says Checking", () => {
        expect(collectBillOutcome(row("/private/files/b.jpeg", "Checking"))?.outcome).toBe("Checking");
    });

    it("a bill stored before its line kept a Bill check will be read on Create", () => {
        expect(collectBillOutcome(row("/private/files/b.jpeg", null))?.outcome).toBe("Will be read on Create");
        const { bill_check: _, ...noCheck } = row("/private/files/b.jpeg", null);
        expect(collectBillOutcome(noCheck)?.outcome).toBe("Will be read on Create");
    });
});
