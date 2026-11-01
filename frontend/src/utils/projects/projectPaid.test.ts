import { describe, expect, it } from "vitest";

import { orderPaymentStatus, sumAmountPaid } from "./projectPaid";

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
