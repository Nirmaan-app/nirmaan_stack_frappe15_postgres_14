import { describe, expect, it } from "vitest";
import { vendorPaidFigures, type VendorPaidSources } from "./vendorReportPaid";

// One vendor: PO A paid 400 then refunded 100 (Amount Paid 300), WO W paid 300.
const ORDERS = [{ amount_paid: 300 }, { amount_paid: "300" }, { amount_paid: null }];
const OPENING = { invoice: 1000, payment: 200 };

const sources = (over: Partial<VendorPaidSources> = {}): VendorPaidSources => ({
  periodPaid: null,
  currentFYPaid: { V1: 450 },
  paidSinceLedgerStart: { V1: 600 },
  ...over,
});

describe("vendorPaidFigures", () => {
  it("with no date range, Total Paid adds up the orders' Amount Paid", () => {
    const f = vendorPaidFigures("V1", ORDERS, sources(), OPENING, 2000);
    expect(f.totalPaid).toBe(600);
  });

  it("with a date range, Total Paid is the server's dated figure, refunds on their own date", () => {
    // A range holding only the refund: the vendor gave money back in it.
    const f = vendorPaidFigures("V1", ORDERS, sources({ periodPaid: { V1: -100 } }), OPENING, 2000);
    expect(f.totalPaid).toBe(-100);
  });

  it("a vendor with nothing paid in the range reads 0, not its all-time Amount Paid", () => {
    const f = vendorPaidFigures("V1", ORDERS, sources({ periodPaid: { OTHER: 5 } }), OPENING, 2000);
    expect(f.totalPaid).toBe(0);
  });

  it("Current FY Paid is the server's figure for the year, 0 when the vendor is missing", () => {
    expect(vendorPaidFigures("V1", ORDERS, sources(), OPENING, 2000).currentFYPaid).toBe(450);
    expect(vendorPaidFigures("V2", [], sources(), OPENING, 0).currentFYPaid).toBe(0);
  });

  it("Balance Payable is the ledger's: opening + invoiced since the ledger start - paid since it", () => {
    // 1000 - 200 + 2000 - 600
    expect(vendorPaidFigures("V1", ORDERS, sources(), OPENING, 2000).balance).toBe(2200);
  });
});
