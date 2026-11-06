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

describe("the TDS register's Paid Amount on an Office Rent row: what left the bank (spec #1613)", () => {
  // The row keeps the base rent as its gross; the bill is the base rent plus the Expense's GST.
  const rent = { non_project_expense: "NPE-TEST-RENT", gross_amount: 100000, tds_amount: 10000, borne_by: TDS_BORNE_BY.VENDOR };

  it("is the bill less the tax: ₹1,18,000 bill, ₹10,000 TDS → ₹1,08,000", () => {
    expect(deductionNetPaid({ ...rent, expense_gst_amount: 18000 })).toBe(108000);
  });

  it("keeps the paise of an uneven bill: ₹50,000 → ₹45,762.71", () => {
    expect(
      deductionNetPaid({ ...rent, gross_amount: 42372.88, expense_gst_amount: 7627.12, tds_amount: 4237.29 })
    ).toBe(45762.71);
  });

  it("is the rent less the tax on a rent withheld before GST existed (GST 0)", () => {
    expect(deductionNetPaid({ ...rent, expense_gst_amount: 0 })).toBe(90000);
  });

  it("leaves a Work Order row as it was: a GST it does not have is never added", () => {
    expect(
      deductionNetPaid({ project_payment: "PAY-TEST", gross_amount: 10000, tds_amount: 200, borne_by: TDS_BORNE_BY.VENDOR })
    ).toBe(9800);
  });
});
