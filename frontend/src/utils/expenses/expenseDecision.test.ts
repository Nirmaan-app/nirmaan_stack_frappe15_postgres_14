import { describe, expect, it } from "vitest";

import { splitMarkPaid } from "./expenseDecision";

describe("splitMarkPaid", () => {
  it("sends the payment through the decision call and keeps the invoice for the plain save", () => {
    const { payment, details } = splitMarkPaid({
      payment_date: "2026-10-19",
      payment_ref: "UTR-1",
      payment_attachment: "/private/files/r.pdf",
      invoice_date: "2026-10-01",
      invoice_ref: "INV-9",
    });
    expect(payment).toEqual({
      payment_date: "2026-10-19",
      payment_ref: "UTR-1",
      payment_attachment: "/private/files/r.pdf",
    });
    expect(details).toEqual({ invoice_date: "2026-10-01", invoice_ref: "INV-9" });
  });

  it("leaves out a receipt the dialog kept, so the stored one stands", () => {
    const { payment } = splitMarkPaid({ payment_date: "2026-10-19", payment_ref: "UTR-1", invoice_ref: null });
    expect(payment).toEqual({ payment_date: "2026-10-19", payment_ref: "UTR-1" });
  });

  it("never carries a status into the plain save", () => {
    const { details } = splitMarkPaid({ payment_date: "2026-10-19", status: "Paid", payment_by: "x" });
    expect(details).toEqual({});
  });
});
