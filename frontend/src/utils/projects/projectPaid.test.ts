import { describe, expect, it } from "vitest";

import { amountPaidByWorkPackage, orderPaymentStatus, sumAmountPaid } from "./projectPaid";

describe("orderPaymentStatus", () => {
  it("is Unpaid when nothing is paid, or a refund took the Amount Paid back to zero", () => {
    expect(orderPaymentStatus(0, 1000)).toBe("Unpaid");
    expect(orderPaymentStatus(0, 0)).toBe("Unpaid");
  });

  it("is Partially Paid once a refund lowers a fully paid order's Amount Paid", () => {
    // Paid 1,000 on a 1,000 order, then a Received refund of 100: Amount Paid is 900.
    expect(orderPaymentStatus(900, 1000)).toBe("Partially Paid");
  });

  it("is Fully Paid at or above the order total", () => {
    expect(orderPaymentStatus(1000, 1000)).toBe("Fully Paid");
    expect(orderPaymentStatus(1200, 1000)).toBe("Fully Paid");
  });

  it("is Fully Paid when short of the total by paisa rounding only (under ₹1)", () => {
    // A stored total of 1,00,255.9624 against an Amount Paid of 1,00,255.96.
    expect(orderPaymentStatus(100255.96, 100255.9624)).toBe("Fully Paid");
    expect(orderPaymentStatus(999, 1000)).toBe("Partially Paid");
  });
});

describe("sumAmountPaid", () => {
  it("adds the orders' stored Amount Paid, a blank one as zero", () => {
    expect(sumAmountPaid([{ amount_paid: 300 }, { amount_paid: "150.5" }, { amount_paid: undefined }])).toBe(450.5);
  });
});

describe("amountPaidByWorkPackage", () => {
  it("puts a PO's Amount Paid under the work package of its items", () => {
    const pos = [
      { name: "PO-1", amount_paid: 300 },
      { name: "PO-2", amount_paid: 200 },
    ];
    const items = [
      { po_number: "PO-1", work_package: "Electrical", quote: 100, quantity: 5, tax: 18 },
      { po_number: "PO-2", work_package: "HVAC", quote: 50, quantity: 2, tax: 18 },
    ];
    expect(amountPaidByWorkPackage(pos, items)).toEqual({ Electrical: 300, HVAC: 200 });
  });

  it("shares a PO's Amount Paid across its packages by item value incl. GST", () => {
    // Electrical 1,000 + 18% = 1,180; HVAC 500 + 0% = 500; total 1,680. Paid 840 is half of it.
    const items = [
      { po_number: "PO-1", work_package: "Electrical", quote: 100, quantity: 10, tax: 18 },
      { po_number: "PO-1", work_package: "HVAC", quote: 250, quantity: 2, tax: 0 },
    ];
    expect(amountPaidByWorkPackage([{ name: "PO-1", amount_paid: 840 }], items)).toEqual({ Electrical: 590, HVAC: 250 });
  });

  it("puts a custom PO's items under Custom, and leaves out a PO with no items", () => {
    const items = [{ po_number: "PO-1", work_package: "Electrical", quote: 10, quantity: 1, tax: 0, isCustom: true }];
    const pos = [{ name: "PO-1", amount_paid: 70 }, { name: "PO-9", amount_paid: 999 }];
    expect(amountPaidByWorkPackage(pos, items)).toEqual({ Custom: 70 });
  });

  it("splits evenly by item count when every item of the PO is priced at zero", () => {
    const items = [
      { po_number: "PO-1", work_package: "A", quote: 0, quantity: 1, tax: 0 },
      { po_number: "PO-1", work_package: "B", quote: 0, quantity: 1, tax: 0 },
    ];
    expect(amountPaidByWorkPackage([{ name: "PO-1", amount_paid: 100 }], items)).toEqual({ A: 50, B: 50 });
  });
});
