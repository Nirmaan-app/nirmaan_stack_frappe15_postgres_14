// src/pages/outflow-import/cashbookCollect.test.ts

import { describe, expect, it } from "vitest";

import { CollectPaymentLine, collectPaymentsHeading, collectPaymentsOf } from "./cashbookCollect";

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
