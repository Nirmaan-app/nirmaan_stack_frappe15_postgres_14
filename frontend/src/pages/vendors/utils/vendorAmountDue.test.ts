import { describe, expect, it } from "vitest";
import { vendorAmountDue } from "./vendorAmountDue";

describe("vendorAmountDue (Material Orders 'Invoice Summary (all POs)', #1460)", () => {
  it("is Total Invoiced less the POs' Amount Paid", () => {
    // Invoiced 1,000 + 500; paid 400 + 200 (A's 300 paid less a 100 refund is already in its Amount Paid).
    expect(
      vendorAmountDue([
        { status: "PO Approved", amount_invoiced: 1000, amount_paid: 400 },
        { status: "Delivered", amount_invoiced: "500", amount_paid: "200" },
      ])
    ).toEqual({ totalInvoiced: 1500, amountPaid: 600, amountDue: 900 });
  });

  it("takes no paid figure off a Merged PO, like the Amount Paid card beside it", () => {
    expect(
      vendorAmountDue([
        { status: "PO Approved", amount_invoiced: 1000, amount_paid: 400 },
        { status: "Merged", amount_invoiced: 0, amount_paid: 250 },
      ]).amountDue
    ).toBe(600);
  });

  it("reads blank figures as 0", () => {
    expect(vendorAmountDue([{ status: "Inactive", amount_invoiced: null, amount_paid: undefined }])).toEqual({
      totalInvoiced: 0,
      amountPaid: 0,
      amountDue: 0,
    });
  });
});
