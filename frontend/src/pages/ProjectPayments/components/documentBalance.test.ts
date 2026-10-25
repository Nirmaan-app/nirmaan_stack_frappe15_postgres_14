import { describe, expect, it } from "vitest";

import { documentBalance } from "./documentBalance";

describe("documentBalance", () => {
  it("is a Work Order's stored Amount Due", () => {
    // ₹10,000 settled: ₹9,800 to the vendor and ₹200 withheld from them (ADR-0034 Amendment A).
    expect(documentBalance("Service Requests", { total_amount: 50000, amount_paid: 10000, amount_due: 40000 })).toBe(40000);
  });

  it("never re-derives a Work Order's balance in the browser", () => {
    // The server owns the rule; a figure off total − paid here is the page disagreeing with the WO.
    expect(documentBalance("Service Requests", { total_amount: 50000, amount_paid: 9800, amount_due: 40000 })).toBe(40000);
  });

  it("reads an overpaid Work Order's negative Amount Due as it is", () => {
    expect(documentBalance("Service Requests", { total_amount: 5000, amount_paid: 5500, amount_due: -500 })).toBe(-500);
  });

  it("is a Purchase Order's value less its Amount Paid", () => {
    // A PO's stored Amount Due is against what was invoiced, not its value.
    expect(documentBalance("Procurement Orders", { total_amount: 1000, amount_paid: 300, amount_due: 100 })).toBe(700);
  });

  it("is zero before the document has loaded", () => {
    expect(documentBalance("Service Requests", undefined)).toBe(0);
  });
});
