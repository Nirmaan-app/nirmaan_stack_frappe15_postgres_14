import { describe, expect, it } from "vitest";

import { pendingInvoiceAmount } from "./workOrderPendingInvoice";

describe("pendingInvoiceAmount", () => {
  it("is what was paid and not yet invoiced", () => {
    expect(pendingInvoiceAmount({ amount_paid: 1098, amount_invoiced: 0 })).toBe(1098);
    expect(pendingInvoiceAmount({ amount_paid: 150000, amount_invoiced: 40000 })).toBe(110000);
  });

  it("is 0 when every payment is invoiced", () => {
    expect(pendingInvoiceAmount({ amount_paid: 792, amount_invoiced: 792 })).toBe(0);
  });

  it("is 0, never negative, when more is invoiced than paid", () => {
    expect(pendingInvoiceAmount({ amount_paid: 500, amount_invoiced: 800 })).toBe(0);
    expect(pendingInvoiceAmount({ amount_paid: 0, amount_invoiced: 2567 })).toBe(0);
  });

  it("reads blank and string figures the way the list's other money columns do", () => {
    expect(pendingInvoiceAmount({})).toBe(0);
    expect(pendingInvoiceAmount({ amount_paid: null, amount_invoiced: undefined })).toBe(0);
    expect(pendingInvoiceAmount({ amount_paid: "1200.5", amount_invoiced: "200.5" })).toBe(1000);
  });
});
