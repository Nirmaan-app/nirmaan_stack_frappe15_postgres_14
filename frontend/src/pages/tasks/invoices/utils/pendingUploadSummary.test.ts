import { describe, expect, it } from "vitest";
import { percentOf, summarisePendingUploadOrders } from "./pendingUploadSummary";

describe("PO / WO pending-upload summary", () => {
    it("totals every column and counts the rows", () => {
        const summary = summarisePendingUploadOrders([
            { totalAmount: 826000, invoiceAmount: 0, basisAmount: 826000 },
            { totalAmount: 1416000, invoiceAmount: 354000, basisAmount: 708000 },
            { totalAmount: 295000, invoiceAmount: 118000, basisAmount: 295000 },
        ]);
        expect(summary).toEqual({
            count: 3,
            totalAmount: 2537000,
            invoiceAmount: 472000,
            basisAmount: 1829000,
            pendingAmount: 1357000,
        });
    });

    it("pending equals the sum of each row's basis − invoice (the table's own column)", () => {
        const rows = [
            { totalAmount: 500, invoiceAmount: 120.5, basisAmount: 400.25 },
            { totalAmount: 900, invoiceAmount: 0, basisAmount: 650 },
        ];
        const columnSum = rows.reduce((s, r) => s + (r.basisAmount - r.invoiceAmount), 0);
        expect(summarisePendingUploadOrders(rows).pendingAmount).toBeCloseTo(columnSum, 6);
    });

    it("is all zeros when the filters leave no rows", () => {
        expect(summarisePendingUploadOrders([])).toEqual({
            count: 0, totalAmount: 0, invoiceAmount: 0, basisAmount: 0, pendingAmount: 0,
        });
    });
});

describe("percentOf", () => {
    it("rounds to a whole percent", () => {
        expect(percentOf(31240800, 64820400)).toBe("48%");
    });

    it("is blank with no order value, never NaN or Infinity", () => {
        expect(percentOf(100, 0)).toBe("");
        expect(percentOf(0, 0)).toBe("");
    });
});
