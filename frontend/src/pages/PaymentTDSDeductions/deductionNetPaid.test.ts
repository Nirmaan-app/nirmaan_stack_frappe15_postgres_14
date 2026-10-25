import { describe, expect, it } from "vitest";
import { TDS_BORNE_BY } from "@/types/NirmaanStack/PaymentTDSDeduction";
import { deductionNetPaid } from "./deductionNetPaid";

describe("the TDS register's Net Paid: what the vendor got (#1543, owner ruling Q31-A)", () => {
  it("is the gross less the tax when the tax was withheld from the vendor", () => {
    expect(deductionNetPaid({ gross_amount: 10000, tds_amount: 200, borne_by: TDS_BORNE_BY.VENDOR })).toBe(9800);
  });

  it("is the whole gross when the company paid the tax on top", () => {
    // The decision record's case: ₹800 kept whole, ₹16 paid by the company. The vendor got ₹800, not ₹784.
    expect(deductionNetPaid({ gross_amount: 800, tds_amount: 16, borne_by: TDS_BORNE_BY.COMPANY })).toBe(800);
  });

  it("reads a blank borne_by as Vendor, the column default", () => {
    expect(deductionNetPaid({ gross_amount: 5000, tds_amount: 100 })).toBe(4900);
  });
});
