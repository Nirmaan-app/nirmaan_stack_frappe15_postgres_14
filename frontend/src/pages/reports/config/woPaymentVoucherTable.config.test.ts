import { describe, expect, it } from "vitest";
import { summariseVoucherAggregates, voucherStatusFilter } from "./woPaymentVoucherTable.config";

describe("summariseVoucherAggregates", () => {
    it("splits the filtered set into uploaded and missing", () => {
        const s = summariseVoucherAggregates(
            { sum_of_amount: "1000", voucher_uploaded_count: 3, voucher_uploaded_amount: "600.5" },
            5,
        );
        expect(s.total).toEqual({ count: 5, amount: 1000 });
        expect(s.uploaded).toEqual({ count: 3, amount: 600.5 });
        expect(s.missing).toEqual({ count: 2, amount: 399.5 });
    });

    it("reads a missing / null aggregate payload as zero, never NaN", () => {
        const s = summariseVoucherAggregates(null, 4);
        expect(s.total).toEqual({ count: 4, amount: 0 });
        expect(s.uploaded).toEqual({ count: 0, amount: 0 });
        expect(s.missing).toEqual({ count: 4, amount: 0 });
    });

    it("never reports a negative missing count", () => {
        expect(summariseVoucherAggregates({ voucher_uploaded_count: 7 }, 5).missing.count).toBe(0);
    });
});

describe("voucherStatusFilter", () => {
    it("maps each choice to a Frappe is-set filter", () => {
        expect(voucherStatusFilter("all")).toEqual([]);
        expect(voucherStatusFilter("uploaded")).toEqual([["voucher_attachment", "is", "set"]]);
        expect(voucherStatusFilter("missing")).toEqual([["voucher_attachment", "is", "not set"]]);
    });
});
